package voice

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestOpenLLMVTuberURL(t *testing.T) {
	for _, address := range []string{"ws://127.0.0.1:12393/client-ws", "wss://localhost/client-ws", "ws://[::1]:12393/client-ws", "ws://LOCALHOST:80/client-ws"} {
		if _, err := validateOpenLLMVTuberURL(address); err != nil {
			t.Errorf("rejected loopback address %q: %v", address, err)
		}
	}
	for _, address := range []string{"", "https://localhost/client-ws", "ws://example.com/client-ws", "ws://192.0.2.10/client-ws", "ws://127.0.0.2/client-ws", "ws://127.1/client-ws", "ws://localhost.example.com/client-ws", "ws://localhost./client-ws", "ws://user:secret@localhost/client-ws", "ws://localhost/client-ws?token=secret", "ws://localhost/client-ws?", "ws://localhost/client-ws#secret", "ws://localhost/client-ws#", "ws://[::ffff:127.0.0.1]/client-ws", "ws://localhost:0/", "ws://localhost:65536/", "ws://localhost:/", "ws://localhost:bad/", "ws://localhost\\@example.com/", "ws://[::1%25eth0]/"} {
		if _, err := validateOpenLLMVTuberURL(address); err == nil || strings.Contains(err.Error(), "secret") {
			t.Errorf("invalid address was accepted or leaked: %q, %v", address, err)
		}
	}
	t.Setenv("OPEN_LLM_VTUBER_WS_URL", "ws://secret:password@example.com/private")
	if _, err := openLLMVTuberURL(context.Background()); err == nil || strings.Contains(err.Error(), "password") {
		t.Fatalf("environment URL not validated safely: %v", err)
	}
}

type vtuberHarness struct {
	client   *websocket.Conn
	upstream *websocket.Conn
	cancel   context.CancelFunc
	result   chan error
}

func newVTuberHarness(t *testing.T) *vtuberHarness {
	t.Helper()
	upgrader := websocket.Upgrader{}
	accepted := make(chan *websocket.Conn, 1)
	var connections atomic.Int32
	upstreamServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "" {
			t.Error("credentials forwarded upstream")
		}
		conn, err := upgrader.Upgrade(w, r, nil)
		if err == nil {
			connections.Add(1)
			accepted <- conn
		}
	}))
	t.Setenv("OPEN_LLM_VTUBER_WS_URL", "ws"+strings.TrimPrefix(upstreamServer.URL, "http")+"/client-ws")
	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan error, 1)
	bridge := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			result <- err
			return
		}
		defer conn.Close()
		result <- HandleOpenLLMVTuber(ctx, conn, &sync.Mutex{}, "pcm_s16le")
	}))
	client, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(bridge.URL, "http"), http.Header{"Authorization": []string{"test-private-token"}, "Cookie": []string{"test-private-cookie"}})
	if err != nil {
		t.Fatal(err)
	}
	var upstream *websocket.Conn
	select {
	case upstream = <-accepted:
	case <-time.After(3 * time.Second):
		t.Fatal("upstream connection not established")
	}
	h := &vtuberHarness{client: client, upstream: upstream, cancel: cancel, result: result}
	t.Cleanup(func() {
		cancel()
		client.Close()
		upstream.Close()
		bridge.Close()
		upstreamServer.Close()
		if connections.Load() != 1 {
			t.Errorf("expected one upstream session, got %d", connections.Load())
		}
	})
	if got := readVTuberEvent(t, client); got.Type != "session.ready" {
		t.Fatalf("missing session.ready: %+v", got)
	}
	return h
}

func readVTuberEvent(t *testing.T, conn *websocket.Conn) ServerEvent {
	t.Helper()
	conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	var event ServerEvent
	if err := conn.ReadJSON(&event); err != nil {
		t.Fatal(err)
	}
	return event
}

func writeVTuberJSON(t *testing.T, conn *websocket.Conn, value any) {
	t.Helper()
	conn.SetWriteDeadline(time.Now().Add(3 * time.Second))
	if err := conn.WriteJSON(value); err != nil {
		t.Fatal(err)
	}
}

func vtuberInput(t *testing.T, h *vtuberHarness, id string) {
	t.Helper()
	pcm := make([]byte, 6400)
	binary.LittleEndian.PutUint16(pcm, 0x8000)
	binary.LittleEndian.PutUint16(pcm[2:], 0x7fff)
	binary.LittleEndian.PutUint16(pcm[4:], 0x4000)
	if err := h.client.WriteMessage(websocket.BinaryMessage, pcm[:1]); err != nil {
		t.Fatal(err)
	}
	if err := h.client.WriteMessage(websocket.BinaryMessage, pcm[1:]); err != nil {
		t.Fatal(err)
	}
	writeVTuberJSON(t, h.client, map[string]string{"type": "input.end", "turn_id": id})
	if event := readVTuberEvent(t, h.client); event.Type != "asr.processing" || event.TurnID != id {
		t.Fatalf("unexpected input acknowledgement: %+v", event)
	}
	var samples []float32
	chunks := 0
	for {
		h.upstream.SetReadDeadline(time.Now().Add(3 * time.Second))
		var event struct {
			Type  string    `json:"type"`
			Audio []float32 `json:"audio"`
		}
		if err := h.upstream.ReadJSON(&event); err != nil {
			t.Fatal(err)
		}
		if event.Type == "mic-audio-end" {
			break
		}
		if event.Type != "mic-audio-data" || len(event.Audio) > 2048 {
			t.Fatalf("unexpected microphone event: %+v", event)
		}
		chunks++
		samples = append(samples, event.Audio...)
	}
	if chunks != 2 || len(samples) != 3200 || samples[0] != -1 || samples[1] != float32(32767)/32768 || samples[2] != .5 {
		t.Fatalf("PCM conversion/chunks incorrect: chunks=%d samples=%d first=%v", chunks, len(samples), samples[:3])
	}
	writeVTuberJSON(t, h.upstream, map[string]string{"type": "control", "text": "conversation-chain-start"})
}

func waitVTuberResult(t *testing.T, h *vtuberHarness) error {
	t.Helper()
	select {
	case err := <-h.result:
		return err
	case <-time.After(3 * time.Second):
		t.Fatal("session or reader goroutine did not stop")
		return nil
	}
}

func TestOpenLLMVTuberMultipleTurnsAudioAndPlayback(t *testing.T) {
	h := newVTuberHarness(t)
	for _, id := range []string{"first", "second"} {
		vtuberInput(t, h, id)
		writeVTuberJSON(t, h.upstream, map[string]string{"type": "user-input-transcription", "text": "你好"})
		if event := readVTuberEvent(t, h.client); event.Type != "asr.final" || event.Text != "你好" || event.TurnID != id {
			t.Fatalf("unexpected transcription: %+v", event)
		}
		for _, text := range []string{"你", "好"} {
			writeVTuberJSON(t, h.upstream, map[string]any{"type": "audio", "audio": base64.StdEncoding.EncodeToString(waveFile([]byte{1, 2, 3, 4}, 24000, 1)), "display_text": map[string]string{"text": text}})
		}
		for _, want := range []string{"你", "你好"} {
			if event := readVTuberEvent(t, h.client); event.Type != "assistant.text.delta" || event.Text != want {
				t.Fatalf("expected cumulative text %q, got %+v", want, event)
			}
		}
		for i := 0; i < 2; i++ {
			writeVTuberJSON(t, h.upstream, map[string]string{"type": "backend-synth-complete"})
		}
		if event := readVTuberEvent(t, h.client); event.Type != "assistant.audio.start" || event.Codec != "wav" || event.SampleRate != 24000 || event.Channels != 1 {
			t.Fatalf("unexpected audio metadata: %+v", event)
		}
		kind, wav, err := h.client.ReadMessage()
		if err != nil || kind != websocket.BinaryMessage || !bytes.Equal(wav, waveFile([]byte{1, 2, 3, 4, 1, 2, 3, 4}, 24000, 1)) {
			t.Fatalf("merged WAV incorrect: kind=%d size=%d err=%v", kind, len(wav), err)
		}
		if event := readVTuberEvent(t, h.client); event.Type != "assistant.audio.end" {
			t.Fatalf("missing audio.end: %+v", event)
		}
		if event := readVTuberEvent(t, h.client); event.Type != "turn.end" || event.TurnID != id {
			t.Fatalf("missing turn.end: %+v", event)
		}
		writeVTuberJSON(t, h.client, map[string]string{"type": "playback.complete", "turn_id": id})
		if event := readVTuberEvent(t, h.upstream); event.Type != "frontend-playback-complete" {
			t.Fatalf("missing playback acknowledgement: %+v", event)
		}
		writeVTuberJSON(t, h.upstream, map[string]string{"type": "control", "text": "conversation-chain-end"})
	}
	h.cancel()
	if err := waitVTuberResult(t, h); !errors.Is(err, context.Canceled) {
		t.Fatalf("expected cancellation, got %v", err)
	}
	h.upstream.SetReadDeadline(time.Now().Add(time.Second))
	if _, _, err := h.upstream.ReadMessage(); err == nil {
		t.Fatal("upstream socket not closed after cancellation")
	}
}

func TestOpenLLMVTuberEarlyPlaybackCompletion(t *testing.T) {
	h := newVTuberHarness(t)
	vtuberInput(t, h, "short-reply")
	writeVTuberJSON(t, h.upstream, map[string]string{"type": "audio", "audio": base64.StdEncoding.EncodeToString(waveFile([]byte{1, 2}, 24000, 1))})
	writeVTuberJSON(t, h.upstream, map[string]string{"type": "backend-synth-complete"})
	if event := readVTuberEvent(t, h.client); event.Type != "assistant.audio.start" {
		t.Fatalf("missing audio start: %+v", event)
	}
	if kind, _, err := h.client.ReadMessage(); err != nil || kind != websocket.BinaryMessage {
		t.Fatalf("missing WAV: kind=%d err=%v", kind, err)
	}
	for _, want := range []string{"assistant.audio.end", "turn.end"} {
		if event := readVTuberEvent(t, h.client); event.Type != want {
			t.Fatalf("expected %s: %+v", want, event)
		}
	}
	for _, id := range []string{"previous-turn", "", "short-reply", "short-reply"} {
		writeVTuberJSON(t, h.client, map[string]string{"type": "playback.complete", "turn_id": id})
	}
	if event := readVTuberEvent(t, h.upstream); event.Type != "frontend-playback-complete" {
		t.Fatalf("missing playback acknowledgement: %+v", event)
	}
	// The second upstream marker can arrive after a very short reply has played.
	writeVTuberJSON(t, h.upstream, map[string]string{"type": "backend-synth-complete"})
	if event := readVTuberEvent(t, h.upstream); event.Type != "frontend-playback-complete" {
		t.Fatalf("completion was not replayed for the late synthesis marker: %+v", event)
	}
	// This sentinel also detects acknowledgements leaked by stale/duplicate client events.
	writeVTuberJSON(t, h.client, map[string]string{"type": "assistant.cancel"})
	if event := readVTuberEvent(t, h.upstream); event.Type != "interrupt-signal" {
		t.Fatalf("unexpected extra playback acknowledgement: %+v", event)
	}
	h.cancel()
	waitVTuberResult(t, h)
}

func TestOpenLLMVTuberInterruptAndSilentTurn(t *testing.T) {
	h := newVTuberHarness(t)
	vtuberInput(t, h, "interrupted")
	writeVTuberJSON(t, h.client, map[string]string{"type": "assistant.cancel"})
	if event := readVTuberEvent(t, h.upstream); event.Type != "interrupt-signal" {
		t.Fatalf("missing interrupt: %+v", event)
	}
	if event := readVTuberEvent(t, h.client); event.Type != "assistant.cancel" {
		t.Fatalf("missing cancel acknowledgement: %+v", event)
	}
	writeVTuberJSON(t, h.upstream, map[string]any{"type": "audio", "audio": base64.StdEncoding.EncodeToString(waveFile([]byte{1, 2}, 24000, 1)), "display_text": map[string]string{"text": "stale"}})
	writeVTuberJSON(t, h.upstream, map[string]string{"type": "backend-synth-complete"})
	vtuberInput(t, h, "silent")
	writeVTuberJSON(t, h.upstream, map[string]any{"type": "audio", "audio": nil, "display_text": map[string]string{"text": "纯文本"}})
	if event := readVTuberEvent(t, h.client); event.Type != "assistant.text.delta" || event.Text != "纯文本" {
		t.Fatalf("unexpected silent text or stale output: %+v", event)
	}
	for i := 0; i < 2; i++ {
		writeVTuberJSON(t, h.upstream, map[string]string{"type": "backend-synth-complete"})
		if event := readVTuberEvent(t, h.upstream); event.Type != "frontend-playback-complete" {
			t.Fatalf("silent turn not acknowledged: %+v", event)
		}
	}
	if event := readVTuberEvent(t, h.client); event.Type != "turn.end" || event.TurnID != "silent" {
		t.Fatalf("silent turn not finished: %+v", event)
	}
	h.cancel()
	waitVTuberResult(t, h)
}

func TestOpenLLMVTuberErrors(t *testing.T) {
	for _, tc := range []struct {
		name string
		send func(*testing.T, *vtuberHarness)
		want string
	}{
		{"upstream-error", func(t *testing.T, h *vtuberHarness) {
			writeVTuberJSON(t, h.upstream, map[string]string{"type": "error", "message": "private upstream credential"})
		}, "返回错误"},
		{"invalid-base64", func(t *testing.T, h *vtuberHarness) {
			writeVTuberJSON(t, h.upstream, map[string]string{"type": "audio", "audio": "bad!"})
		}, "编码无效"},
		{"invalid-wav", func(t *testing.T, h *vtuberHarness) {
			writeVTuberJSON(t, h.upstream, map[string]string{"type": "audio", "audio": base64.StdEncoding.EncodeToString([]byte("invalid"))})
		}, "WAV 音频无效"},
		{"mismatched-wav", func(t *testing.T, h *vtuberHarness) {
			for _, rate := range []int{24000, 16000} {
				writeVTuberJSON(t, h.upstream, map[string]string{"type": "audio", "audio": base64.StdEncoding.EncodeToString(waveFile([]byte{0, 0}, rate, 1))})
			}
		}, "格式不一致"},
		{"output-limit", func(t *testing.T, h *vtuberHarness) {
			chunk := base64.StdEncoding.EncodeToString(waveFile(make([]byte, 1024*1024), 24000, 1))
			for i := 0; i < 32; i++ {
				writeVTuberJSON(t, h.upstream, map[string]string{"type": "audio", "audio": chunk})
			}
		}, "32MB"},
		{"disconnect", func(t *testing.T, h *vtuberHarness) { h.upstream.Close() }, "连接已断开"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := newVTuberHarness(t)
			vtuberInput(t, h, "test")
			tc.send(t, h)
			if err := waitVTuberResult(t, h); err == nil || !strings.Contains(err.Error(), tc.want) || strings.Contains(err.Error(), "private") {
				t.Fatalf("unexpected or unsafe error: %v", err)
			}
		})
	}
}

func TestOpenLLMVTuberInputLimit(t *testing.T) {
	h := newVTuberHarness(t)
	for i := 0; i < 3; i++ {
		if err := h.client.WriteMessage(websocket.BinaryMessage, make([]byte, maxUtteranceBytes/2)); err != nil {
			t.Fatal(err)
		}
	}
	if err := waitVTuberResult(t, h); err == nil || !strings.Contains(err.Error(), "2MB") {
		t.Fatalf("input limit not enforced: %v", err)
	}
}

func TestOpenLLMVTuberWAVValidation(t *testing.T) {
	for _, wav := range [][]byte{nil, waveFile(nil, 24000, 1), waveFile([]byte{1}, 24000, 1), []byte("RIFFxxxxxxxxWAVE")} {
		if _, _, err := parseOpenLLMVTuberWAV(wav); err == nil {
			t.Fatal("accepted invalid WAV")
		}
	}
	wav := waveFile([]byte{1, 2}, 24000, 1)
	// Unknown chunks and odd padding are valid RIFF and should survive parsing.
	wav = append(wav, []byte{'J', 'U', 'N', 'K', 1, 0, 0, 0, 42, 0}...)
	binary.LittleEndian.PutUint32(wav[4:], uint32(len(wav)-8))
	format, audio, err := parseOpenLLMVTuberWAV(wav)
	if err != nil || !bytes.Equal(openLLMVTuberWAV(format, audio), waveFile([]byte{1, 2}, 24000, 1)) {
		t.Fatalf("valid RIFF chunks rejected: %v", err)
	}
	malformed := waveFile([]byte{1, 2}, 24000, 1)
	binary.LittleEndian.PutUint32(malformed[40:], 0xffffffff)
	if _, _, err := parseOpenLLMVTuberWAV(malformed); err == nil {
		t.Fatal("accepted overflowing chunk")
	}
	_ = json.Valid // JSON transport intentionally uses the standard websocket helpers.
}
