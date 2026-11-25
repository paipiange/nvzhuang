package voice

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func streamTestSetup(t *testing.T, conn *websocket.Conn) bool {
	t.Helper()
	if !seedTestReceive(t, conn, "session.create") {
		return false
	}
	if conn.WriteJSON(seedEvent{Type: "session.created"}) != nil {
		return false
	}
	return seedTestReceive(t, conn, "input_audio_unmute.commit")
}

func streamTestClient(t *testing.T, upstream string) *websocket.Conn {
	t.Helper()
	return seedTestClient(t, upstream, map[string]any{"codec": "pcm_s16le", "api_key": "fixture-value", "streaming": true})
}

func streamTestReadPCM(t *testing.T, conn *websocket.Conn, pcm []byte) {
	t.Helper()
	kind, data, err := conn.ReadMessage()
	if err != nil || kind != websocket.BinaryMessage || !bytes.Equal(data, pcm) {
		t.Fatalf("raw PCM: kind=%d size=%d err=%v", kind, len(data), err)
	}
}

func streamWaitClose(conn *websocket.Conn) {
	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			return
		}
	}
}

func TestSeedStreamImmediatePCMAndNegotiatedMultiTurn(t *testing.T) {
	pcm := []byte{1, 2, 3, 4}
	upstream := seedTestSocket(t, func(conn *websocket.Conn, _ *http.Request) {
		if !streamTestSetup(t, conn) {
			return
		}
		for range 2 {
			var frame struct{ Type, Audio string }
			if err := conn.ReadJSON(&frame); err != nil {
				t.Error(err)
				return
			}
			input, err := base64.StdEncoding.DecodeString(frame.Audio)
			if frame.Type != "input_audio_buffer.append" || err != nil || !bytes.Equal(input, pcm) {
				t.Errorf("input was not immediately forwarded: %+v", frame)
				return
			}
			for _, event := range []seedEvent{
				{Type: "input_audio_buffer.speech_started"},
				{Type: "input_audio_buffer.speech_stopped"},
				{Type: "conversation.item.input_audio_transcription.delta", Delta: "你好"},
				{Type: "conversation.item.input_audio_transcription.completed"},
				{Type: "response.output_text.delta", Delta: "我"},
				{Type: "response.output_text.delta", Delta: "在"},
				{Type: "response.output_audio.delta", Delta: base64.StdEncoding.EncodeToString(pcm)},
				{Type: "response.output_audio.done"}, {Type: "response.done"},
			} {
				if conn.WriteJSON(event) != nil {
					return
				}
			}
		}
		streamWaitClose(conn)
	})
	client := streamTestClient(t, upstream)
	ready := readSeedTestEvent(t, client, "session.ready", "")
	if ready.Provider != "seeduplex" || !ready.Streaming || ready.InputRate != 16000 || ready.OutputRate != 24000 || ready.Codec != "pcm_s16le" || ready.Channels != 1 {
		t.Fatalf("missing negotiated capabilities: %+v", ready)
	}
	for _, id := range []string{"first", "second"} {
		_ = client.WriteJSON(seedEvent{Type: "input.activity", TurnID: id})
		_ = client.WriteMessage(websocket.BinaryMessage, pcm)
		readSeedTestEvent(t, client, "input.speech.started", id)
		readSeedTestEvent(t, client, "input.speech.stopped", id)
		if event := readSeedTestEvent(t, client, "asr.delta", id); event.Text != "你好" {
			t.Fatalf("ASR delta = %+v", event)
		}
		readSeedTestEvent(t, client, "asr.final", id)
		for _, text := range []string{"我", "在"} {
			if event := readSeedTestEvent(t, client, "assistant.text.delta", id); event.Text != text {
				t.Fatalf("text delta = %+v", event)
			}
		}
		if event := readSeedTestEvent(t, client, "assistant.audio.start", id); !event.Streaming || event.Segment || event.SampleRate != 24000 {
			t.Fatalf("streaming audio context = %+v", event)
		}
		streamTestReadPCM(t, client, pcm)
		readSeedTestEvent(t, client, "assistant.audio.end", id)
		if event := readSeedTestEvent(t, client, "assistant.text.final", id); event.Text != "我在" {
			t.Fatalf("text final = %+v", event)
		}
		readSeedTestEvent(t, client, "turn.end", id)
	}
	_ = client.WriteJSON(seedEvent{Type: "session.stop"})
	readSeedTestEvent(t, client, "session.stopped", "")
}

func TestSeedStreamCancelIsIdempotentAndRejectsOldSocketEvents(t *testing.T) {
	var connections atomic.Int32
	cancelSeen := make(chan struct{}, 1)
	upstream := seedTestSocket(t, func(conn *websocket.Conn, _ *http.Request) {
		n := connections.Add(1)
		if !streamTestSetup(t, conn) || !seedTestReceive(t, conn, "input_audio_buffer.append") {
			return
		}
		_ = conn.WriteJSON(seedEvent{Type: "input_audio_buffer.speech_started"})
		_ = conn.WriteJSON(seedEvent{Type: "input_audio_buffer.speech_stopped"})
		_ = conn.WriteJSON(seedEvent{Type: "response.output_text.delta", ResponseID: "reused-after-reconnect", Delta: "reply"})
		if n == 1 {
			if !seedTestReceive(t, conn, "response.cancel") {
				return
			}
			cancelSeen <- struct{}{}
			for range 20 {
				_ = conn.WriteJSON(seedEvent{Type: "response.output_audio.delta", Delta: "AQIDBA=="})
				_ = conn.WriteJSON(seedEvent{Type: "response.done"})
			}
			return
		}
		if !seedTestReceive(t, conn, "input_audio_buffer.append") {
			return
		}
		_ = conn.WriteJSON(seedEvent{Type: "response.output_audio.delta", Delta: "BQYHCA=="})
		_ = conn.WriteJSON(seedEvent{Type: "response.done"})
		streamWaitClose(conn)
	})
	client := streamTestClient(t, upstream)
	readSeedTestEvent(t, client, "session.ready", "")
	_ = client.WriteJSON(seedEvent{Type: "input.activity", TurnID: "old"})
	_ = client.WriteMessage(websocket.BinaryMessage, []byte{1, 2})
	readSeedTestEvent(t, client, "input.speech.started", "old")
	readSeedTestEvent(t, client, "input.speech.stopped", "old")
	readSeedTestEvent(t, client, "assistant.text.delta", "old")
	_ = client.WriteJSON(seedEvent{Type: "assistant.cancel"})
	if event := readSeedTestEvent(t, client, "error", ""); event.Code != "invalid_turn_id" {
		t.Fatalf("missing cancel turn accepted: %+v", event)
	}
	_ = client.WriteJSON(seedEvent{Type: "assistant.cancel", TurnID: "old"})
	readSeedTestEvent(t, client, "assistant.cancel", "old")
	select {
	case <-cancelSeen:
	case <-time.After(time.Second):
		t.Fatal("cancel not forwarded upstream")
	}
	readSeedTestEvent(t, client, "session.ready", "")
	_ = client.WriteJSON(seedEvent{Type: "input.activity", TurnID: "old"})
	_ = client.WriteMessage(websocket.BinaryMessage, []byte{3, 4})
	var started ServerEvent
	if err := client.ReadJSON(&started); err != nil || started.Type != "input.speech.started" || started.TurnID == "" || started.TurnID == "old" {
		t.Fatalf("canceled turn ID was reused: %+v %v", started, err)
	}
	newID := started.TurnID
	readSeedTestEvent(t, client, "input.speech.stopped", newID)
	readSeedTestEvent(t, client, "assistant.text.delta", newID)
	_ = client.WriteJSON(seedEvent{Type: "assistant.cancel", TurnID: "old"})
	readSeedTestEvent(t, client, "assistant.cancel", "old")
	_ = client.WriteMessage(websocket.BinaryMessage, []byte{9, 10})
	readSeedTestEvent(t, client, "assistant.audio.start", newID)
	streamTestReadPCM(t, client, []byte{5, 6, 7, 8})
	readSeedTestEvent(t, client, "assistant.text.final", newID)
	readSeedTestEvent(t, client, "assistant.audio.end", newID)
	readSeedTestEvent(t, client, "turn.end", newID)
	_ = client.WriteJSON(seedEvent{Type: "assistant.cancel", TurnID: "old"})
	readSeedTestEvent(t, client, "assistant.cancel", "old")
	_ = client.WriteJSON(seedEvent{Type: "session.stop"})
	readSeedTestEvent(t, client, "session.stopped", "")
	if connections.Load() != 2 {
		t.Fatalf("stale cancel reconnected active socket: %d", connections.Load())
	}
}

func TestSeedStreamServerVADBargeInHasFreshTurn(t *testing.T) {
	var connections atomic.Int32
	upstream := seedTestSocket(t, func(conn *websocket.Conn, _ *http.Request) {
		n := connections.Add(1)
		if !streamTestSetup(t, conn) {
			return
		}
		if n == 1 {
			if !seedTestReceive(t, conn, "input_audio_buffer.append") {
				return
			}
			for _, event := range []seedEvent{{Type: "input_audio_buffer.speech_started"}, {Type: "input_audio_buffer.speech_stopped"}, {Type: "response.output_text.delta", Delta: "old"}} {
				_ = conn.WriteJSON(event)
			}
			if !seedTestReceive(t, conn, "input_audio_buffer.append") {
				return
			}
			_ = conn.WriteJSON(seedEvent{Type: "input_audio_buffer.speech_started"})
			if !seedTestReceive(t, conn, "response.cancel") {
				return
			}
			_ = conn.WriteJSON(seedEvent{Type: "response.output_text.delta", Delta: "late"})
		}
		streamWaitClose(conn)
	})
	client := streamTestClient(t, upstream)
	readSeedTestEvent(t, client, "session.ready", "")
	_ = client.WriteJSON(seedEvent{Type: "input.activity", TurnID: "old"})
	_ = client.WriteMessage(websocket.BinaryMessage, []byte{1, 2})
	readSeedTestEvent(t, client, "input.speech.started", "old")
	readSeedTestEvent(t, client, "input.speech.stopped", "old")
	readSeedTestEvent(t, client, "assistant.text.delta", "old")
	_ = client.WriteMessage(websocket.BinaryMessage, []byte{3, 4})
	readSeedTestEvent(t, client, "assistant.cancel", "old")
	var event ServerEvent
	if err := client.ReadJSON(&event); err != nil || event.Type != "input.speech.started" || event.TurnID == "" || event.TurnID == "old" {
		t.Fatalf("barge-in did not create a fresh turn: %+v %v", event, err)
	}
	readSeedTestEvent(t, client, "session.ready", "")
	_ = client.WriteJSON(seedEvent{Type: "session.stop"})
	readSeedTestEvent(t, client, "session.stopped", "")
}

func TestSeedStreamResetDiscardsOldGenerationAndStopClosesUpstream(t *testing.T) {
	var connections atomic.Int32
	closed := make(chan struct{}, 2)
	upstream := seedTestSocket(t, func(conn *websocket.Conn, _ *http.Request) {
		connections.Add(1)
		if !streamTestSetup(t, conn) {
			return
		}
		streamWaitClose(conn)
		closed <- struct{}{}
	})
	client := streamTestClient(t, upstream)
	readSeedTestEvent(t, client, "session.ready", "")
	_ = client.WriteJSON(seedEvent{Type: "session.reset"})
	readSeedTestEvent(t, client, "session.reset", "")
	readSeedTestEvent(t, client, "session.ready", "")
	_ = client.WriteJSON(seedEvent{Type: "session.stop"})
	readSeedTestEvent(t, client, "session.stopped", "")
	for range 2 {
		select {
		case <-closed:
		case <-time.After(time.Second):
			t.Fatal("reset/stop retained upstream socket")
		}
	}
	if connections.Load() != 2 {
		t.Fatalf("reset did not replace connection: %d", connections.Load())
	}
}

func TestSeedStreamFrameLimitsAndMalformedAudio(t *testing.T) {
	for _, tc := range []struct {
		name  string
		input []byte
		delta string
		code  string
	}{
		{name: "odd input", input: []byte{1}, code: "invalid_audio_frame"},
		{name: "large input", input: make([]byte, seedStreamInputFrame+2), code: "invalid_audio_frame"},
		{name: "bad base64", delta: "!invalid!", code: "seeduplex_audio"},
		{name: "odd output", delta: "AQ==", code: "seeduplex_audio"},
		{name: "large output", delta: base64.StdEncoding.EncodeToString(make([]byte, seedStreamOutputFrame+2)), code: "seeduplex_audio"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			upstream := seedTestSocket(t, func(conn *websocket.Conn, _ *http.Request) {
				if !streamTestSetup(t, conn) {
					return
				}
				if tc.delta != "" {
					if !seedTestReceive(t, conn, "input_audio_buffer.append") {
						return
					}
					_ = conn.WriteJSON(seedEvent{Type: "response.output_audio.delta", Delta: tc.delta})
				}
				streamWaitClose(conn)
			})
			client := streamTestClient(t, upstream)
			readSeedTestEvent(t, client, "session.ready", "")
			input := tc.input
			if tc.delta != "" {
				input = []byte{1, 2}
			}
			_ = client.WriteMessage(websocket.BinaryMessage, input)
			var event ServerEvent
			if err := client.ReadJSON(&event); err != nil || event.Type != "error" || event.Code != tc.code {
				t.Fatalf("expected limit error %s, got %+v %v", tc.code, event, err)
			}
		})
	}
}

func TestSeedStreamInputTurnLimitAndQueueBackpressure(t *testing.T) {
	for _, handshake := range []bool{true, false} {
		t.Run(map[bool]string{true: "turn input", false: "handshake queue"}[handshake], func(t *testing.T) {
			upstream := seedTestSocket(t, func(conn *websocket.Conn, _ *http.Request) {
				if handshake {
					if !streamTestSetup(t, conn) {
						return
					}
					_ = conn.WriteJSON(seedEvent{Type: "input_audio_buffer.speech_started"})
				} else if !seedTestReceive(t, conn, "session.create") {
					return
				}
				streamWaitClose(conn)
			})
			client := streamTestClient(t, upstream)
			if handshake {
				readSeedTestEvent(t, client, "session.ready", "")
				var started ServerEvent
				if err := client.ReadJSON(&started); err != nil || started.Type != "input.speech.started" {
					t.Fatalf("missing speaking interval: %+v %v", started, err)
				}
			}
			frame := make([]byte, seedStreamInputFrame)
			frames := seedStreamQueue + 1
			if handshake {
				frames = maxUtteranceBytes/len(frame) + 1
			}
			for i := 0; i < frames; i++ {
				if client.WriteMessage(websocket.BinaryMessage, frame) != nil {
					break
				}
				if handshake {
					time.Sleep(time.Millisecond)
				}
			}
			var event ServerEvent
			if err := client.ReadJSON(&event); err != nil || event.Type != "error" {
				t.Fatalf("limit did not fail safely: %+v %v", event, err)
			}
			want := "seeduplex_backpressure"
			if handshake {
				want = "audio_too_large"
			}
			if event.Code != want {
				t.Fatalf("limit = %+v, want %s", event, want)
			}
		})
	}
}

func TestSeedStreamParentCancellationClosesBothSockets(t *testing.T) {
	upstreamClosed := make(chan struct{})
	upstream := seedTestSocket(t, func(conn *websocket.Conn, _ *http.Request) {
		if !streamTestSetup(t, conn) {
			return
		}
		streamWaitClose(conn)
		close(upstreamClosed)
	})
	ctx, stop := context.WithCancel(context.Background())
	returned := make(chan error, 1)
	endpoint := seedTestSocket(t, func(conn *websocket.Conn, _ *http.Request) {
		var mu sync.Mutex
		returned <- runSeedStream(ctx, conn, &mu, upstream, "fixture-value")
	})
	client, _, err := websocket.DefaultDialer.Dial(endpoint, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	readSeedTestEvent(t, client, "session.ready", "")
	stop()
	select {
	case <-returned:
	case <-time.After(time.Second):
		t.Fatal("stream handler did not terminate")
	}
	select {
	case <-upstreamClosed:
	case <-time.After(time.Second):
		t.Fatal("parent cancellation leaked upstream")
	}
}

func TestSeedStreamRejectsLateResponseIDInSameConnection(t *testing.T) {
	upstream := seedTestSocket(t, func(conn *websocket.Conn, _ *http.Request) {
		if !streamTestSetup(t, conn) {
			return
		}
		for _, response := range []string{"first-response", "second-response"} {
			if !seedTestReceive(t, conn, "input_audio_buffer.append") {
				return
			}
			_ = conn.WriteJSON(seedEvent{Type: "input_audio_buffer.speech_started"})
			_ = conn.WriteJSON(seedEvent{Type: "input_audio_buffer.speech_stopped"})
			if response == "second-response" {
				_ = conn.WriteJSON(seedEvent{Type: "response.output_audio.delta", ResponseID: "first-response", Delta: "AQIDBA=="})
			}
			_ = conn.WriteJSON(seedEvent{Type: "response.output_text.delta", ResponseID: response, Delta: response})
			_ = conn.WriteJSON(seedEvent{Type: "response.done", ResponseID: response})
		}
		streamWaitClose(conn)
	})
	client := streamTestClient(t, upstream)
	readSeedTestEvent(t, client, "session.ready", "")
	for _, id := range []string{"first", "second"} {
		_ = client.WriteJSON(seedEvent{Type: "input.activity", TurnID: id})
		_ = client.WriteMessage(websocket.BinaryMessage, []byte{1, 2})
		readSeedTestEvent(t, client, "input.speech.started", id)
		readSeedTestEvent(t, client, "input.speech.stopped", id)
		readSeedTestEvent(t, client, "assistant.text.delta", id)
		readSeedTestEvent(t, client, "assistant.text.final", id)
		readSeedTestEvent(t, client, "turn.end", id)
	}
	_ = client.WriteJSON(seedEvent{Type: "session.stop"})
	readSeedTestEvent(t, client, "session.stopped", "")
}

func TestSeedStreamControlValidationAndOldIDHint(t *testing.T) {
	upstream := seedTestSocket(t, func(conn *websocket.Conn, _ *http.Request) {
		if !streamTestSetup(t, conn) {
			return
		}
		streamWaitClose(conn)
	})
	client := streamTestClient(t, upstream)
	readSeedTestEvent(t, client, "session.ready", "")
	for _, tc := range []struct{ payload, code string }{
		{`{`, "invalid_message"},
		{`{"type":"input.end"}`, "unsupported_streaming_event"},
		{`{"type":"text.input","text":"hello"}`, "unsupported_streaming_event"},
		{`{"type":"unknown"}`, "unknown_event"},
		{`{"type":"input.activity","turn_id":"` + strings.Repeat("x", 65) + `"}`, "invalid_turn_id"},
	} {
		_ = client.WriteMessage(websocket.TextMessage, []byte(tc.payload))
		if event := readSeedTestEvent(t, client, "error", ""); event.Code != tc.code {
			t.Fatalf("control validation: %+v, want %s", event, tc.code)
		}
	}
	_ = client.WriteJSON(seedEvent{Type: "playback.complete", TurnID: "completed"})
	_ = client.WriteJSON(seedEvent{Type: "playback.complete", TurnID: "completed"})
	_ = client.WriteJSON(seedEvent{Type: "session.stop"})
	readSeedTestEvent(t, client, "session.stopped", "")
}

func TestSeedStreamBudgetsCoverTurnSessionAndQuietInput(t *testing.T) {
	for _, tc := range []struct {
		name                     string
		budget                   seedStreamBudget
		size, frame, turn, total int
		code                     string
	}{
		{"input turn", seedStreamBudget{turn: maxUtteranceBytes}, 2, seedStreamInputFrame, maxUtteranceBytes, seedStreamInputTotal, "audio_too_large"},
		{"output turn", seedStreamBudget{turn: maxAudioBytes}, 2, seedStreamOutputFrame, maxAudioBytes, seedStreamOutputTotal, "audio_too_large"},
		{"input session", seedStreamBudget{total: seedStreamInputTotal}, 2, seedStreamInputFrame, maxUtteranceBytes, seedStreamInputTotal, "session_audio_limit"},
		{"output session", seedStreamBudget{total: seedStreamOutputTotal}, 2, seedStreamOutputFrame, maxAudioBytes, seedStreamOutputTotal, "session_audio_limit"},
		{"silence over old turn cap", seedStreamBudget{turn: maxUtteranceBytes, total: maxUtteranceBytes}, 2, seedStreamInputFrame, 0, seedStreamInputTotal, ""},
		{"exact frame and turn boundary", seedStreamBudget{turn: maxAudioBytes - seedStreamOutputFrame}, seedStreamOutputFrame, seedStreamOutputFrame, maxAudioBytes, seedStreamOutputTotal, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			before := tc.budget
			if code := tc.budget.accept(tc.size, tc.frame, tc.turn, tc.total); code != tc.code {
				t.Fatalf("limit code = %q, want %q", code, tc.code)
			}
			if tc.code != "" && tc.budget != before {
				t.Fatal("rejected frame mutated budget")
			}
			if tc.code == "" && (tc.budget.total != before.total+tc.size || tc.budget.turn != before.turn+tc.size) {
				t.Fatal("accepted frame was not counted")
			}
		})
	}
}

func TestSeedStreamTimeoutRecoversWithFreshUpstream(t *testing.T) {
	var connections atomic.Int32
	upstream := seedTestSocket(t, func(conn *websocket.Conn, _ *http.Request) {
		n := connections.Add(1)
		if !streamTestSetup(t, conn) {
			return
		}
		if n == 1 {
			if !seedTestReceive(t, conn, "input_audio_buffer.append") {
				return
			}
			_ = conn.WriteJSON(seedEvent{Type: "input_audio_buffer.speech_started"})
			_ = conn.WriteJSON(seedEvent{Type: "input_audio_buffer.speech_stopped"})
		}
		streamWaitClose(conn)
	})
	endpoint := seedTestSocket(t, func(conn *websocket.Conn, r *http.Request) {
		var mu sync.Mutex
		_ = runSeedStreamWithTimeout(r.Context(), conn, &mu, upstream, "fixture-value", 30*time.Millisecond)
	})
	client, _, err := websocket.DefaultDialer.Dial(endpoint, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	_ = client.SetReadDeadline(time.Now().Add(3 * time.Second))
	readSeedTestEvent(t, client, "session.ready", "")
	_ = client.WriteJSON(seedEvent{Type: "input.activity", TurnID: "timeout"})
	_ = client.WriteMessage(websocket.BinaryMessage, []byte{1, 2})
	readSeedTestEvent(t, client, "input.speech.started", "timeout")
	readSeedTestEvent(t, client, "input.speech.stopped", "timeout")
	if event := readSeedTestEvent(t, client, "error", "timeout"); event.Code != "seeduplex_timeout" {
		t.Fatalf("wrong timeout code: %+v", event)
	}
	readSeedTestEvent(t, client, "assistant.cancel", "timeout")
	readSeedTestEvent(t, client, "turn.end", "timeout")
	readSeedTestEvent(t, client, "session.ready", "")
	_ = client.WriteJSON(seedEvent{Type: "session.stop"})
	readSeedTestEvent(t, client, "session.stopped", "")
	if connections.Load() != 2 {
		t.Fatalf("timeout did not reconnect: %d", connections.Load())
	}
}

func TestSeedStreamLegacyAudioFieldsRemainAbsent(t *testing.T) {
	data, err := json.Marshal(ServerEvent{Type: "session.ready"})
	if err != nil || string(data) != `{"type":"session.ready"}` {
		t.Fatalf("legacy event changed: %s %v", data, err)
	}
}
