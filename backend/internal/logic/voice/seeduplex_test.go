package voice

import (
	"context"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gogf/gf/v2/frame/g"
	"github.com/gogf/gf/v2/os/gcfg"
	"github.com/gorilla/websocket"
)

func seedTestSocket(t *testing.T, handle func(*websocket.Conn, *http.Request)) string {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if err != nil {
			t.Error(err)
			return
		}
		defer conn.Close()
		_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
		handle(conn, r)
	}))
	t.Cleanup(server.Close)
	return "ws" + strings.TrimPrefix(server.URL, "http")
}

func seedTestClient(t *testing.T, upstream string, start map[string]any) *websocket.Conn {
	t.Helper()
	endpoint := seedTestSocket(t, func(conn *websocket.Conn, r *http.Request) {
		var mu sync.Mutex
		if err := handleSeedDuplex(r.Context(), conn, &mu, start, upstream); err != nil && !errors.Is(err, context.Canceled) {
			_ = writeSeedJSON(conn, &mu, ServerEvent{Type: "error", Message: err.Error()})
		}
	})
	conn, _, err := websocket.DefaultDialer.Dial(endpoint, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	return conn
}

func readSeedTestEvent(t *testing.T, conn *websocket.Conn, kind, turn string) ServerEvent {
	t.Helper()
	var event ServerEvent
	if err := conn.ReadJSON(&event); err != nil {
		t.Fatal(err)
	}
	if event.Type != kind || event.TurnID != turn {
		t.Fatalf("event = %+v, want %s turn %q", event, kind, turn)
	}
	return event
}

func sendSeedTestTurn(t *testing.T, conn *websocket.Conn, turn string, input []byte) {
	t.Helper()
	if err := conn.WriteMessage(websocket.BinaryMessage, input); err != nil {
		t.Fatal(err)
	}
	if err := conn.WriteJSON(seedEvent{Type: "input.end", TurnID: turn}); err != nil {
		t.Fatal(err)
	}
}

func seedTestSetup(t *testing.T, conn *websocket.Conn) bool {
	t.Helper()
	var create struct {
		Type    string
		Session struct {
			Model string
			Audio struct {
				Input, Output struct {
					Voice  string
					Format struct {
						Type string
						Rate int
					}
				}
			}
		}
	}
	if err := conn.ReadJSON(&create); err != nil {
		t.Error(err)
		return false
	}
	if create.Type != "session.create" || create.Session.Model != "1.2.6.1" || create.Session.Audio.Input.Format.Type != "pcm" || create.Session.Audio.Input.Format.Rate != 16000 || create.Session.Audio.Output.Format.Type != "pcm_s16le" || create.Session.Audio.Output.Format.Rate != 24000 || create.Session.Audio.Output.Voice == "" {
		t.Errorf("unexpected session format: %+v", create)
		return false
	}
	if err := conn.WriteJSON(seedEvent{Type: "session.created"}); err != nil {
		t.Error(err)
		return false
	}
	return seedTestReceive(t, conn, "input_audio_mute.commit")
}

func seedTestReceive(t *testing.T, conn *websocket.Conn, kind string) bool {
	t.Helper()
	var event seedEvent
	if err := conn.ReadJSON(&event); err != nil {
		t.Error(err)
		return false
	}
	if event.Type != kind {
		t.Errorf("upstream event %q, want %q", event.Type, kind)
		return false
	}
	return true
}

func TestSeedDuplexHandshakeAndPacedMultiTurn(t *testing.T) {
	t.Setenv("SEEDUPLEX_API_KEY", "fixture-env-value")
	upstream := seedTestSocket(t, func(conn *websocket.Conn, r *http.Request) {
		if r.Header.Get("X-Api-Key") != "fixture-client-value" {
			t.Error("frontend key did not take precedence")
		}
		if !seedTestSetup(t, conn) {
			return
		}
		for range 2 {
			if !seedTestReceive(t, conn, "input_audio_unmute.commit") {
				return
			}
			var previous time.Time
			for i := range 6 {
				var frame struct{ Type, Audio string }
				if err := conn.ReadJSON(&frame); err != nil {
					t.Error(err)
					return
				}
				pcm, err := base64.StdEncoding.DecodeString(frame.Audio)
				if frame.Type != "input_audio_buffer.append" || err != nil || len(pcm) != 640 {
					t.Error("expected a 640-byte PCM frame")
					return
				}
				if i == 5 && (pcm[0] != 7 || pcm[1] != 8 || pcm[2] != 0) {
					t.Error("last frame not padded correctly")
				}
				now := time.Now()
				if !previous.IsZero() && now.Sub(previous) < 10*time.Millisecond {
					t.Error("audio frames sent in a burst")
				}
				previous = now
			}
			if !seedTestReceive(t, conn, "input_audio_buffer.commit") || !seedTestReceive(t, conn, "input_audio_mute.commit") {
				return
			}
			for _, event := range []seedEvent{
				{Type: "conversation.item.input_audio_transcription.completed", Transcript: "你好"},
				{Type: "response.output_text.delta", Delta: "嗨"},
				{Type: "response.output_audio.delta", Delta: base64.StdEncoding.EncodeToString(make([]byte, seedSegmentBytes+2))},
				{Type: "response.output_audio.done"}, {Type: "response.done"},
			} {
				if err := conn.WriteJSON(event); err != nil {
					t.Error(err)
					return
				}
			}
		}
	})
	client := seedTestClient(t, upstream, map[string]any{"codec": "pcm_s16le", "api_key": "fixture-client-value"})
	readSeedTestEvent(t, client, "session.ready", "")
	input := append(make([]byte, 3200), 7, 8)
	for _, turn := range []string{"first", "second"} {
		sendSeedTestTurn(t, client, turn, input)
		if readSeedTestEvent(t, client, "asr.final", turn).Text != "你好" {
			t.Fatal("missing transcript")
		}
		if readSeedTestEvent(t, client, "assistant.text.delta", turn).Text != "嗨" {
			t.Fatal("missing reply")
		}
		for _, expected := range []int{seedSegmentBytes, 2} {
			event := readSeedTestEvent(t, client, "assistant.audio.start", turn)
			kind, frame, err := client.ReadMessage()
			if err != nil || kind != websocket.BinaryMessage || len(frame) != expected+44 || string(frame[:4]) != "RIFF" || binary.LittleEndian.Uint32(frame[24:]) != 24000 || !event.Segment {
				t.Fatalf("invalid WAV: kind=%d bytes=%d err=%v", kind, len(frame), err)
			}
			readSeedTestEvent(t, client, "assistant.audio.end", turn)
		}
		readSeedTestEvent(t, client, "turn.end", turn)
	}
}

func TestSeedDuplexTranscriptDeltaFallback(t *testing.T) {
	t.Setenv("SEEDUPLEX_API_KEY", "fixture-env-value")
	upstream := seedTestSocket(t, func(conn *websocket.Conn, _ *http.Request) {
		if !seedTestSetup(t, conn) || !seedTestReceive(t, conn, "input_audio_unmute.commit") {
			return
		}
		for range 5 {
			if !seedTestReceive(t, conn, "input_audio_buffer.append") {
				return
			}
		}
		if !seedTestReceive(t, conn, "input_audio_buffer.commit") || !seedTestReceive(t, conn, "input_audio_mute.commit") {
			return
		}
		for _, event := range []seedEvent{
			{Type: "conversation.item.input_audio_transcription.delta", Delta: "你好"},
			{Type: "conversation.item.input_audio_transcription.delta", Delta: "，知夏"},
			{Type: "conversation.item.input_audio_transcription.completed"},
			{Type: "response.output_text.delta", Delta: "我在"},
			{Type: "response.done"},
		} {
			if err := conn.WriteJSON(event); err != nil {
				t.Error(err)
				return
			}
		}
	})
	client := seedTestClient(t, upstream, map[string]any{"codec": "pcm_s16le", "api_key": "fixture-client-value"})
	readSeedTestEvent(t, client, "session.ready", "")
	sendSeedTestTurn(t, client, "fallback", make([]byte, 3200))
	if event := readSeedTestEvent(t, client, "asr.partial", "fallback"); event.Text != "你好" {
		t.Fatalf("first partial = %q", event.Text)
	}
	if event := readSeedTestEvent(t, client, "asr.partial", "fallback"); event.Text != "，知夏" {
		t.Fatalf("second partial = %q", event.Text)
	}
	if event := readSeedTestEvent(t, client, "asr.final", "fallback"); event.Text != "你好，知夏" {
		t.Fatalf("final transcript = %q", event.Text)
	}
	readSeedTestEvent(t, client, "assistant.text.delta", "fallback")
	readSeedTestEvent(t, client, "turn.end", "fallback")
}

func TestSeedDuplexCancelDuringUploadAndReconnect(t *testing.T) {
	t.Setenv("SEEDUPLEX_API_KEY", "fixture-env-value")
	firstFrame := make(chan struct{}, 1)
	upstream := seedTestSocket(t, func(conn *websocket.Conn, r *http.Request) {
		if r.Header.Get("X-Api-Key") != "fixture-env-value" {
			t.Error("environment fallback missing")
		}
		if !seedTestSetup(t, conn) || !seedTestReceive(t, conn, "input_audio_unmute.commit") {
			return
		}
		var frames int
		for {
			var event seedEvent
			if conn.ReadJSON(&event) != nil {
				return
			}
			if event.Type == "input_audio_buffer.append" {
				frames++
				if frames == 1 {
					select {
					case firstFrame <- struct{}{}:
					default:
					}
				}
			}
			if event.Type == "input_audio_buffer.commit" {
				if frames != 5 {
					t.Errorf("canceled upload committed %d frames", frames)
				}
				if !seedTestReceive(t, conn, "input_audio_mute.commit") {
					return
				}
				_ = conn.WriteJSON(seedEvent{Type: "response.output_text.delta", Delta: "重新连接"})
				_ = conn.WriteJSON(seedEvent{Type: "response.done"})
				return
			}
		}
	})
	client := seedTestClient(t, upstream, map[string]any{"codec": "pcm_s16le"})
	readSeedTestEvent(t, client, "session.ready", "")
	sendSeedTestTurn(t, client, "cancel-me", make([]byte, 32000))
	select {
	case <-firstFrame:
	case <-time.After(2 * time.Second):
		t.Fatal("upload did not start")
	}
	if err := client.WriteJSON(seedEvent{Type: "assistant.cancel"}); err != nil {
		t.Fatal(err)
	}
	readSeedTestEvent(t, client, "assistant.cancel", "cancel-me")
	sendSeedTestTurn(t, client, "next", make([]byte, 3200))
	readSeedTestEvent(t, client, "assistant.text.delta", "next")
	readSeedTestEvent(t, client, "turn.end", "next")
}

func TestSeedDuplexEarlyFailuresAndUnsupportedText(t *testing.T) {
	t.Setenv("SEEDUPLEX_API_KEY", "")
	t.Setenv("VOLCENGINE_REALTIME_API_KEY", "")
	if err := HandleSeedDuplex(context.Background(), nil, nil, nil); err == nil || !strings.Contains(err.Error(), "API Key") {
		t.Fatalf("missing key diagnostic: %v", err)
	}
	if _, err := seedDial(context.Background(), "wss://example.invalid/api/v3/duplex/realtime/dialogue", "fixture-value"); err == nil {
		t.Fatal("unapproved endpoint accepted")
	}
	upstream := seedTestSocket(t, func(conn *websocket.Conn, r *http.Request) {
		if seedTestSetup(t, conn) {
			_, _, _ = conn.ReadMessage()
		}
	})
	client := seedTestClient(t, upstream, map[string]any{"codec": "pcm_s16le", "api_key": "fixture-value"})
	readSeedTestEvent(t, client, "session.ready", "")
	if err := client.WriteJSON(seedEvent{Type: "text.input", TurnID: "text", Text: "hello"}); err != nil {
		t.Fatal(err)
	}
	if got := readSeedTestEvent(t, client, "error", "text"); got.Code != "unsupported_text" {
		t.Fatalf("wrong error: %+v", got)
	}
	readSeedTestEvent(t, client, "turn.end", "text")
	if err := client.WriteMessage(websocket.BinaryMessage, make([]byte, maxUtteranceBytes)); err != nil {
		t.Fatal(err)
	}
	sendSeedTestTurn(t, client, "too-large", []byte{1, 2})
	if got := readSeedTestEvent(t, client, "error", "too-large"); got.Code != "audio_too_large" {
		t.Fatalf("wrong error: %+v", got)
	}
	readSeedTestEvent(t, client, "turn.end", "too-large")
}

func TestSeedDuplexDoesNotFollowRedirect(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("adapter followed upstream redirect")
		w.WriteHeader(http.StatusForbidden)
	}))
	defer target.Close()
	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusFound)
	}))
	defer redirect.Close()
	if conn, err := seedDial(context.Background(), "ws"+strings.TrimPrefix(redirect.URL, "http"), "fixture-value"); err == nil {
		_ = conn.Close()
		t.Fatal("redirect unexpectedly accepted")
	}
}

func TestSeedDuplexSanitizesUpstreamError(t *testing.T) {
	upstream := seedTestSocket(t, func(conn *websocket.Conn, r *http.Request) {
		var create seedEvent
		if conn.ReadJSON(&create) == nil {
			_ = conn.WriteJSON(map[string]string{"type": "error", "message": "private upstream diagnostic"})
		}
	})
	client := seedTestClient(t, upstream, map[string]any{"codec": "pcm_s16le", "api_key": "fixture-value"})
	got := readSeedTestEvent(t, client, "error", "")
	if strings.Contains(got.Message, "private upstream diagnostic") {
		t.Fatal("upstream details leaked")
	}
	if _, _, err := client.ReadMessage(); !websocket.IsCloseError(err, websocket.CloseAbnormalClosure, websocket.CloseNormalClosure) {
		t.Fatalf("startup failure must close without reporting ready, got %v", err)
	}
}

func seedTestDrainUpload(t *testing.T, conn *websocket.Conn) bool {
	t.Helper()
	for _, event := range []string{"input_audio_unmute.commit", "input_audio_buffer.append", "input_audio_buffer.append", "input_audio_buffer.append", "input_audio_buffer.append", "input_audio_buffer.append", "input_audio_buffer.commit", "input_audio_mute.commit"} {
		if !seedTestReceive(t, conn, event) {
			return false
		}
	}
	return true
}

func TestSeedDuplexRejectsFailedRecognitionAndMalformedAudio(t *testing.T) {
	for _, scenario := range []struct {
		name, code string
		events     []seedEvent
	}{
		{"asr failed", "seeduplex_asr", []seedEvent{{Type: "conversation.item.input_audio_transcription.failed"}}},
		{"bad base64", "seeduplex_audio", []seedEvent{{Type: "response.output_audio.delta", Delta: "!bad!"}}},
		{"odd PCM", "seeduplex_audio", []seedEvent{{Type: "response.output_audio.delta", Delta: "AQ=="}, {Type: "response.output_audio.done"}}},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			upstream := seedTestSocket(t, func(conn *websocket.Conn, _ *http.Request) {
				if !seedTestSetup(t, conn) || !seedTestDrainUpload(t, conn) {
					return
				}
				for _, event := range scenario.events {
					if err := conn.WriteJSON(event); err != nil {
						t.Error(err)
						return
					}
				}
			})
			client := seedTestClient(t, upstream, map[string]any{"codec": "pcm_s16le", "api_key": "fixture-value"})
			readSeedTestEvent(t, client, "session.ready", "")
			sendSeedTestTurn(t, client, "bad-turn", make([]byte, 3200))
			if event := readSeedTestEvent(t, client, "error", "bad-turn"); event.Code != scenario.code {
				t.Fatalf("wrong error: %+v", event)
			}
			readSeedTestEvent(t, client, "turn.end", "bad-turn")
		})
	}
}

func TestSeedDuplexRejectsCumulativeOutputOverLimit(t *testing.T) {
	upstream := seedTestSocket(t, func(conn *websocket.Conn, _ *http.Request) {
		if !seedTestSetup(t, conn) || !seedTestDrainUpload(t, conn) {
			return
		}
		const chunk = 512 << 10
		pcm := seedEvent{Type: "response.output_audio.delta", Delta: base64.StdEncoding.EncodeToString(make([]byte, chunk))}
		for range maxAudioBytes / chunk {
			if err := conn.WriteJSON(pcm); err != nil {
				t.Error(err)
				return
			}
		}
		if err := conn.WriteJSON(seedEvent{Type: pcm.Type, Delta: "AAA="}); err != nil {
			t.Error(err)
		}
	})
	client := seedTestClient(t, upstream, map[string]any{"codec": "pcm_s16le", "api_key": "fixture-value"})
	_ = client.SetReadDeadline(time.Now().Add(15 * time.Second))
	readSeedTestEvent(t, client, "session.ready", "")
	sendSeedTestTurn(t, client, "oversize", make([]byte, 3200))
	for range maxAudioBytes / seedSegmentBytes {
		readSeedTestEvent(t, client, "assistant.audio.start", "oversize")
		kind, frame, err := client.ReadMessage()
		if err != nil || kind != websocket.BinaryMessage || len(frame) != seedSegmentBytes+44 {
			t.Fatalf("invalid bounded WAV frame, type %d, bytes %d, err %v", kind, len(frame), err)
		}
		readSeedTestEvent(t, client, "assistant.audio.end", "oversize")
	}
	event := readSeedTestEvent(t, client, "error", "oversize")
	if event.Code != "seeduplex_audio" || !strings.Contains(event.Message, "32 MiB") {
		t.Fatalf("wrong limit error: %+v", event)
	}
	readSeedTestEvent(t, client, "turn.end", "oversize")
}

func TestSeedDuplexClosesUpstreamOnContextCancelOrDisconnect(t *testing.T) {
	for _, disconnect := range []bool{false, true} {
		name := "context canceled"
		if disconnect {
			name = "downstream disconnected"
		}
		t.Run(name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			upstreamClosed := make(chan error, 1)
			upstream := seedTestSocket(t, func(conn *websocket.Conn, _ *http.Request) {
				if !seedTestSetup(t, conn) {
					return
				}
				_, _, err := conn.ReadMessage()
				upstreamClosed <- err
			})
			returned := make(chan error, 1)
			endpoint := seedTestSocket(t, func(conn *websocket.Conn, _ *http.Request) {
				var mu sync.Mutex
				returned <- runSeedDuplex(ctx, conn, &mu, "pcm_s16le", upstream, "fixture-value")
			})
			client, _, err := websocket.DefaultDialer.Dial(endpoint, nil)
			if err != nil {
				t.Fatal(err)
			}
			defer client.Close()
			_ = client.SetReadDeadline(time.Now().Add(2 * time.Second))
			readSeedTestEvent(t, client, "session.ready", "")
			if disconnect {
				_ = client.Close()
			} else {
				cancel()
			}
			timeout := time.NewTimer(time.Second)
			defer timeout.Stop()
			select {
			case err := <-upstreamClosed:
				if !websocket.IsCloseError(err, websocket.CloseAbnormalClosure, websocket.CloseNormalClosure) {
					t.Fatalf("upstream socket was not closed, got %v", err)
				}
			case <-timeout.C:
				t.Fatal("upstream socket remained open")
			}
			select {
			case <-returned:
			case <-timeout.C:
				t.Fatal("adapter did not return")
			}
			if !disconnect {
				if _, _, err := client.ReadMessage(); !websocket.IsCloseError(err, websocket.CloseAbnormalClosure, websocket.CloseNormalClosure) {
					t.Fatalf("downstream socket was not closed, got %v", err)
				}
			}
		})
	}
}

func TestSeedDuplexNormalizesMP3PerTurn(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("FFmpeg unavailable")
	}
	adapter, err := gcfg.NewAdapterContent(`{"voice":{"ffmpeg":"ffmpeg"}}`)
	if err != nil {
		t.Fatal(err)
	}
	previous := g.Cfg().GetAdapter()
	g.Cfg().SetAdapter(adapter)
	t.Cleanup(func() { g.Cfg().SetAdapter(previous) })
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	fixture, err := exec.CommandContext(ctx, ffmpeg, "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=16000:duration=0.15", "-ac", "1", "-f", "mp3", "pipe:1").Output()
	if err != nil {
		t.Fatalf("could not generate synthetic MP3 fixture: %v", err)
	}
	upstream := seedTestSocket(t, func(conn *websocket.Conn, _ *http.Request) {
		if !seedTestSetup(t, conn) {
			return
		}
		for range 2 {
			if !seedTestReceive(t, conn, "input_audio_unmute.commit") {
				return
			}
			var packets int
			var nonzero bool
			for {
				var event struct{ Type, Audio string }
				if err := conn.ReadJSON(&event); err != nil {
					t.Error(err)
					return
				}
				if event.Type == "input_audio_buffer.commit" {
					break
				}
				frame, err := base64.StdEncoding.DecodeString(event.Audio)
				if event.Type != "input_audio_buffer.append" || err != nil || len(frame) != seedFrameBytes {
					t.Error("expected normalized PCM frame")
					return
				}
				packets++
				for _, sample := range frame {
					nonzero = nonzero || sample != 0
				}
			}
			if packets < 5 || !nonzero {
				t.Errorf("incomplete MP3 decode: %d packets with signal=%t", packets, nonzero)
				return
			}
			if !seedTestReceive(t, conn, "input_audio_mute.commit") {
				return
			}
			if err := conn.WriteJSON(seedEvent{Type: "response.done"}); err != nil {
				t.Error(err)
				return
			}
		}
	})
	client := seedTestClient(t, upstream, map[string]any{"codec": "mp3", "api_key": "fixture-value"})
	readSeedTestEvent(t, client, "session.ready", "")
	for _, id := range []string{"mp3-first", "mp3-second"} {
		split := len(fixture) / 2
		if err := client.WriteMessage(websocket.BinaryMessage, fixture[:split]); err != nil {
			t.Fatal(err)
		}
		sendSeedTestTurn(t, client, id, fixture[split:])
		readSeedTestEvent(t, client, "turn.end", id)
	}
}

func TestSeedDuplexAPIKeyReadsConfigFile(t *testing.T) {
	adapter, err := gcfg.NewAdapterContent(`{"voice":{"seeduplex":{"apiKey":"yaml-seed-key"}}}`)
	if err != nil {
		t.Fatal(err)
	}
	previous := g.Cfg().GetAdapter()
	g.Cfg().SetAdapter(adapter)
	t.Cleanup(func() { g.Cfg().SetAdapter(previous) })
	t.Setenv("SEEDUPLEX_API_KEY", "")
	t.Setenv("VOLCENGINE_REALTIME_API_KEY", "")
	if actual := seedDuplexAPIKey(context.Background()); actual != "yaml-seed-key" {
		t.Fatalf("unexpected config API key %q", actual)
	}
	t.Setenv("SEEDUPLEX_API_KEY", "env-seed-key")
	if actual := seedDuplexAPIKey(context.Background()); actual != "env-seed-key" {
		t.Fatalf("environment must win, got %q", actual)
	}
}
