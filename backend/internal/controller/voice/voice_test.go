package voice

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	voicelogic "backend/internal/logic/voice"
	"github.com/gorilla/websocket"
)

func testConnection(t *testing.T) *websocket.Conn {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		serveConnection(context.Background(), conn)
	}))
	t.Cleanup(server.Close)
	client, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = client.Close() })
	_ = client.SetReadDeadline(time.Now().Add(3 * time.Second))
	return client
}

func readEvent(t *testing.T, conn *websocket.Conn) voicelogic.ServerEvent {
	t.Helper()
	var event voicelogic.ServerEvent
	if err := conn.ReadJSON(&event); err != nil {
		t.Fatal(err)
	}
	return event
}

func TestSeedDuplexStartValidatesAudioAndClientKey(t *testing.T) {
	for _, tc := range []struct {
		name string
		rate int
		key  string
		code string
	}{
		{"bad rate", 24000, "fixture-value", "unsupported_audio"},
		{"bad client key", 16000, "fixture\r\nprivate-value", "seeduplex_unavailable"},
		{"missing key", 16000, "", "seeduplex_unavailable"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("SEEDUPLEX_API_KEY", "")
			t.Setenv("VOLCENGINE_REALTIME_API_KEY", "")
			conn := testConnection(t)
			if err := conn.WriteJSON(map[string]any{"type": "session.start", "provider": "seeduplex", "codec": "pcm_s16le", "input_rate": tc.rate, "api_key": tc.key}); err != nil {
				t.Fatal(err)
			}
			event := readEvent(t, conn)
			if event.Type != "error" || event.Code != tc.code || strings.Contains(event.Message, "private-value") {
				t.Fatalf("invalid startup response: %+v", event)
			}
			if tc.name == "bad client key" && !strings.Contains(event.Message, "格式无效") {
				t.Fatal("controller did not pass the client Key to the adapter")
			}
		})
	}
}

func TestSessionResetClearsInputAndAcknowledges(t *testing.T) {
	conn := testConnection(t)
	if err := conn.WriteJSON(map[string]any{"type": "session.start", "input_rate": 16000, "codec": "pcm_s16le"}); err != nil {
		t.Fatal(err)
	}
	if event := readEvent(t, conn); event.Type != "session.ready" {
		t.Fatalf("unexpected ready: %+v", event)
	}
	_ = conn.WriteMessage(websocket.BinaryMessage, make([]byte, 3200))
	_ = conn.WriteJSON(map[string]string{"type": "session.reset"})
	if event := readEvent(t, conn); event.Type != "session.reset" || event.TurnID != "" {
		t.Fatalf("unexpected reset: %+v", event)
	}
	_ = conn.WriteJSON(map[string]string{"type": "input.end", "turn_id": "after-reset"})
	if event := readEvent(t, conn); event.Type != "error" || event.Code != "empty_audio" {
		t.Fatalf("reset retained audio: %+v", event)
	}
}

func TestResetPreventsObsoleteTurnEventsAfterAcknowledgment(t *testing.T) {
	conn := testConnection(t)
	_ = conn.WriteJSON(map[string]any{"type": "session.start", "input_rate": 16000, "codec": "pcm_s16le"})
	readEvent(t, conn)
	// Invalid PCM fails asynchronously; every output from it must precede the reset acknowledgment.
	for i := 0; i < 30; i++ {
		_ = conn.WriteMessage(websocket.BinaryMessage, []byte{1})
		_ = conn.WriteJSON(map[string]string{"type": "input.end", "turn_id": "old-turn"})
		_ = conn.WriteJSON(map[string]string{"type": "session.reset"})
		for event := readEvent(t, conn); event.Type != "session.reset"; event = readEvent(t, conn) {
		}
	}
	_ = conn.SetReadDeadline(time.Now().Add(150 * time.Millisecond))
	if _, payload, err := conn.ReadMessage(); err == nil {
		t.Fatalf("obsolete output after reset: %s", payload)
	}
}

func TestTextInputValidatesSessionAndLimits(t *testing.T) {
	conn := testConnection(t)
	_ = conn.WriteJSON(map[string]string{"type": "text.input", "text": "你好"})
	if event := readEvent(t, conn); event.Code != "session_not_started" {
		t.Fatalf("text accepted before session: %+v", event)
	}
	_ = conn.WriteJSON(map[string]any{"type": "session.start", "input_rate": 16000, "codec": "pcm_s16le"})
	readEvent(t, conn)
	for _, item := range []struct{ text, turnID, code string }{
		{strings.Repeat("你", 2001), "long-text", "text_too_large"},
		{"你好", strings.Repeat("x", 65), "invalid_turn_id"},
	} {
		_ = conn.WriteJSON(map[string]string{"type": "text.input", "text": item.text, "turn_id": item.turnID})
		if event := readEvent(t, conn); event.Type != "error" || event.Code != item.code {
			t.Fatalf("unexpected validation response: %+v", event)
		}
	}
	_ = conn.WriteJSON(map[string]string{"type": "text.input", "text": "   ", "turn_id": "empty-text"})
	if event := readEvent(t, conn); event.Type != "error" || event.TurnID != "empty-text" {
		t.Fatalf("empty text should fail with its turn ID: %+v", event)
	}
	if event := readEvent(t, conn); event.Type != "turn.end" || event.TurnID != "empty-text" {
		t.Fatalf("empty text should finish its turn: %+v", event)
	}
}

func TestAudioRequiresSessionAndDoesNotRetainPreSessionFrames(t *testing.T) {
	conn := testConnection(t)
	_ = conn.WriteMessage(websocket.BinaryMessage, []byte{1})
	if event := readEvent(t, conn); event.Code != "session_not_started" {
		t.Fatalf("audio accepted before handshake: %+v", event)
	}
	_ = conn.WriteJSON(map[string]string{"type": "input.end", "turn_id": "before-session"})
	if event := readEvent(t, conn); event.Code != "session_not_started" {
		t.Fatalf("audio end accepted before handshake: %+v", event)
	}
	_ = conn.WriteJSON(map[string]any{"type": "session.start", "input_rate": 16000, "codec": "pcm_s16le"})
	readEvent(t, conn)
	_ = conn.WriteJSON(map[string]string{"type": "input.end", "turn_id": "after-session"})
	if event := readEvent(t, conn); event.Code != "empty_audio" {
		t.Fatalf("pre-session audio retained: %+v", event)
	}
}

func TestOversizedAudioDiscardsRemainderOfUtterance(t *testing.T) {
	conn := testConnection(t)
	_ = conn.WriteJSON(map[string]any{"type": "session.start", "input_rate": 16000, "codec": "pcm_s16le"})
	readEvent(t, conn)
	for i := 0; i < 2; i++ {
		if err := conn.WriteMessage(websocket.BinaryMessage, make([]byte, 1024*1024)); err != nil {
			t.Fatal(err)
		}
	}
	_ = conn.WriteMessage(websocket.BinaryMessage, []byte{1})
	if event := readEvent(t, conn); event.Code != "audio_too_large" {
		t.Fatalf("oversized utterance accepted: %+v", event)
	}
	// A valid-looking tail must never become an independent model request.
	_ = conn.WriteMessage(websocket.BinaryMessage, make([]byte, 3200))
	_ = conn.WriteJSON(map[string]string{"type": "input.end", "turn_id": "oversized"})
	if event := readEvent(t, conn); event.Code != "audio_too_large" || event.TurnID != "oversized" {
		t.Fatalf("oversized tail was processed: %+v", event)
	}
	_ = conn.WriteJSON(map[string]string{"type": "input.end", "turn_id": "fresh"})
	if event := readEvent(t, conn); event.Code != "empty_audio" {
		t.Fatalf("rejected audio remained buffered: %+v", event)
	}
	_ = conn.WriteMessage(websocket.BinaryMessage, []byte{1})
	_ = conn.WriteJSON(map[string]string{"type": "input.end", "turn_id": "invalid-pcm"})
	for _, expected := range []string{"asr.processing", "error", "turn.end"} {
		if event := readEvent(t, conn); event.Type != expected || event.TurnID != "invalid-pcm" {
			t.Fatalf("next utterance did not recover: expected %s got %+v", expected, event)
		}
	}
}

func TestStreamingAndCharacterNegotiationRejectsUnsupportedCapabilities(t *testing.T) {
	t.Setenv("VOICE_LOCAL_LINXI", "")
	t.Setenv("SEEDUPLEX_VOICE_LINXI", "")
	for _, tc := range []struct {
		name, provider, codec, character, persona, voice, code string
		streaming                                              bool
		outputRate                                             int
	}{
		{name: "local streaming", provider: "local", codec: "pcm_s16le", streaming: true, code: "unsupported_streaming"},
		{name: "streaming mp3", provider: "seeduplex", codec: "mp3", streaming: true, code: "unsupported_audio"},
		{name: "streaming wrong output", provider: "seeduplex", codec: "pcm_s16le", streaming: true, outputRate: 16000, code: "unsupported_audio"},
		{name: "unknown character", provider: "local", codec: "pcm_s16le", character: "unknown", code: "unsupported_character"},
		{name: "mixed profile", provider: "local", codec: "pcm_s16le", character: "zhixia", persona: "linxi", code: "unsupported_character"},
		{name: "unconfigured local voice", provider: "local", codec: "pcm_s16le", character: "linxi", code: "voice_not_configured"},
		{name: "unconfigured seed voice", provider: "seeduplex", codec: "pcm_s16le", character: "linxi", code: "voice_not_configured"},
		{name: "external vtuber character", provider: "open-llm-vtuber", codec: "pcm_s16le", character: "zhixia", code: "unsupported_character"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			conn := testConnection(t)
			_ = conn.WriteJSON(map[string]any{"type": "session.start", "provider": tc.provider, "codec": tc.codec, "input_rate": 16000, "output_rate": tc.outputRate, "streaming": tc.streaming, "character_id": tc.character, "persona_id": tc.persona, "voice_id": tc.voice})
			if event := readEvent(t, conn); event.Type != "error" || event.Code != tc.code {
				t.Fatalf("unsupported capability accepted: %+v", event)
			}
		})
	}
}

func TestLocalReadyAcknowledgesSelectedProfileAndSwitchClearsHistory(t *testing.T) {
	t.Setenv("VOICE_LOCAL_LINXI", "linxi-reference")
	conn := testConnection(t)
	for _, id := range []string{"xiaotao", "zhixia", "linxi"} {
		persona, voice, expected := id, id, id
		if id == "xiaotao" {
			persona, voice, expected = "", "", "zhixia"
		}
		_ = conn.WriteJSON(map[string]any{"type": "session.start", "provider": "local", "codec": "pcm_s16le", "input_rate": 16000, "character_id": id, "persona_id": persona, "voice_id": voice})
		if event := readEvent(t, conn); event.Type != "session.ready" || event.CharacterID != expected || event.PersonaID != expected || event.VoiceID != expected || event.Streaming {
			t.Fatalf("profile negotiation failed: %+v", event)
		}
	}
}

func TestSegmentMarkerDoesNotAlterOtherProviderEvents(t *testing.T) {
	plain := marshalEvent(voicelogic.ServerEvent{Type: "assistant.audio.start"})
	if strings.Contains(string(plain), "segment") {
		t.Fatalf("legacy event changed: %s", plain)
	}
	var event map[string]any
	if err := json.Unmarshal(marshalEvent(voicelogic.ServerEvent{Type: "assistant.audio.start", Segment: true}), &event); err != nil || event["segment"] != true {
		t.Fatalf("missing segment marker: %+v %v", event, err)
	}
}
