package voice

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/gogf/gf/v2/frame/g"
	"github.com/gogf/gf/v2/os/gcfg"
	"github.com/gorilla/websocket"
)

func TestVoiceProfileReadsConfigFileWhenEnvironmentIsEmpty(t *testing.T) {
	adapter, err := gcfg.NewAdapterContent(`{"voice":{"seeduplex":{"voices":{"linxi":"yaml-linxi-speaker"}},"local":{"voices":{"linxi":"yaml-local-speaker"}}}}`)
	if err != nil {
		t.Fatal(err)
	}
	previous := g.Cfg().GetAdapter()
	g.Cfg().SetAdapter(adapter)
	t.Cleanup(func() { g.Cfg().SetAdapter(previous) })
	t.Setenv("SEEDUPLEX_VOICE_LINXI", "")
	t.Setenv("VOICE_LOCAL_LINXI", "")

	seed, err := SelectVoiceProfile("seeduplex", "linxi", "linxi", "linxi")
	if err != nil || seed.Voice != "yaml-linxi-speaker" {
		t.Fatalf("unexpected SeedDuplex profile: %+v %v", seed, err)
	}
	local, err := SelectVoiceProfile("local", "linxi", "linxi", "linxi")
	if err != nil || local.Voice != "yaml-local-speaker" {
		t.Fatalf("unexpected local profile: %+v %v", local, err)
	}
}

func TestVoiceProfileAllowlistAndConfiguredVoiceMapping(t *testing.T) {
	t.Setenv("VOICE_LOCAL_LINXI", "linxi-reference")
	t.Setenv("SEEDUPLEX_VOICE_LINXI", "configured-linxi-speaker")
	for _, provider := range []string{"local", "seeduplex", "open-llm-vtuber"} {
		profile, err := SelectVoiceProfile(provider, "xiaotao", "", "")
		if err != nil || (provider != "open-llm-vtuber" && profile.CharacterID != "zhixia") {
			t.Fatalf("released xiaotao client rejected for %s: %+v %v", provider, profile, err)
		}
	}
	for _, provider := range []string{"local", "seeduplex"} {
		profile, err := SelectVoiceProfile(provider, "linxi", "linxi", "linxi")
		if err != nil || !strings.Contains(profile.Instructions, "林溪") || profile.CharacterID != "linxi" || profile.Voice == "linxi" {
			t.Fatalf("profile did not resolve to a server-owned persona/voice: %+v %v", profile, err)
		}
		if strings.Contains(profile.Instructions, "你叫知夏") {
			t.Fatal("new persona retained the old identity")
		}
	}
	for _, tc := range []struct{ provider, character, persona, voice, code string }{
		{"local", "injected", "", "", "unsupported_character"},
		{"local", "xiaotao", "zhixia", "", "unsupported_character"},
		{"seeduplex", "xiaotao", "", "zhixia", "unsupported_character"},
		{"open-llm-vtuber", "xiaotao", "zhixia", "", "unsupported_character"},
		{"local", "zhixia", "linxi", "zhixia", "unsupported_character"},
		{"seeduplex", "zhixia", "zhixia", "arbitrary-upstream-name", "unsupported_character"},
		{"open-llm-vtuber", "zhixia", "zhixia", "zhixia", "unsupported_character"},
	} {
		_, err := SelectVoiceProfile(tc.provider, tc.character, tc.persona, tc.voice)
		var protocolErr *VoiceProtocolError
		if !errors.As(err, &protocolErr) || protocolErr.Code != tc.code {
			t.Fatalf("profile boundary accepted %+v: %v", tc, err)
		}
	}
	if _, err := SelectVoiceProfile("open-llm-vtuber", "", "", ""); err != nil {
		t.Fatal("legacy VTuber was rejected")
	}
	for _, provider := range []string{"local", "seeduplex"} {
		t.Setenv("VOICE_LOCAL_LINXI", "")
		t.Setenv("SEEDUPLEX_VOICE_LINXI", "")
		_, err := SelectVoiceProfile(provider, "linxi", "linxi", "linxi")
		var protocolErr *VoiceProtocolError
		if !errors.As(err, &protocolErr) || protocolErr.Code != "voice_not_configured" {
			t.Fatalf("unconfigured voice silently fell back: %v", err)
		}
	}
}

func TestSeedProfileIsAppliedInLegacyAndStreamingHandshake(t *testing.T) {
	t.Setenv("SEEDUPLEX_VOICE_LINXI", "configured-linxi-speaker")
	for _, tc := range []struct {
		name, character, persona, voice, expected string
		streaming                                 bool
	}{
		{name: "released alias", character: "xiaotao", expected: "zhixia"},
		{name: "streaming profile", character: "linxi", persona: "linxi", voice: "linxi", expected: "linxi", streaming: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			upstream := seedTestSocket(t, func(conn *websocket.Conn, _ *http.Request) {
				var create struct {
					Type    string
					Session struct {
						Instructions string
						Audio        struct{ Output struct{ Voice string } }
					}
				}
				if err := conn.ReadJSON(&create); err != nil {
					t.Error(err)
					return
				}
				if tc.expected == "linxi" && (!strings.Contains(create.Session.Instructions, "你叫林溪") || create.Session.Audio.Output.Voice != "configured-linxi-speaker") {
					t.Errorf("Seed role was not applied: %+v", create)
				}
				if tc.expected == "zhixia" && !strings.Contains(create.Session.Instructions, "你叫知夏") {
					t.Errorf("legacy alias selected another persona: %+v", create)
				}
				_ = conn.WriteJSON(seedEvent{Type: "session.created"})
				microphone := "input_audio_mute.commit"
				if tc.streaming {
					microphone = "input_audio_unmute.commit"
				}
				if !seedTestReceive(t, conn, microphone) {
					return
				}
				streamWaitClose(conn)
			})
			client := seedTestClient(t, upstream, map[string]any{"codec": "pcm_s16le", "api_key": "fixture-value", "streaming": tc.streaming, "character_id": tc.character, "persona_id": tc.persona, "voice_id": tc.voice})
			if event := readSeedTestEvent(t, client, "session.ready", ""); event.CharacterID != tc.expected || event.PersonaID != tc.expected || event.VoiceID != tc.expected || event.Streaming != tc.streaming {
				t.Fatalf("wrong profile negotiation: %+v", event)
			}
		})
	}
}

func TestLocalProfileChangesActualPromptAndSynthesizedVoice(t *testing.T) {
	t.Setenv("VOICE_LOCAL_LINXI", "linxi-reference")
	profile, err := SelectVoiceProfile("local", "linxi", "linxi", "linxi")
	if err != nil {
		t.Fatal(err)
	}
	var gotPrompt, gotSpeaker string
	routeModels(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/chat/completions" {
			var body struct{ Messages []chatMessage }
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Error(err)
			}
			gotPrompt = body.Messages[0].Content
			_, _ = io.WriteString(w, `{"choices":[{"message":{"content":"好的"}}]}`)
		} else {
			var body map[string]string
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Error(err)
			}
			gotSpeaker = body["voice_id"]
			pcmHeaders(w)
			_, _ = w.Write([]byte{1, 2})
		}
	})
	var session Session
	ctx := WithVoiceProfile(context.Background(), profile)
	if err := session.ProcessText(ctx, session.Begin(), "你好", func(any) error { return nil }); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(gotPrompt, "你叫林溪") || !strings.Contains(gotPrompt, "不要假装真人") || gotSpeaker != "linxi-reference" {
		t.Fatalf("profile was cosmetic: prompt=%q speaker=%q", gotPrompt, gotSpeaker)
	}
	create := seedSessionCreate(WithVoiceProfile(context.Background(), profile))
	seedSession := create["session"].(map[string]any)
	if seedSession["instructions"] != profile.Instructions {
		t.Fatal("SeedDuplex did not apply the persona")
	}
	audio := seedSession["audio"].(map[string]any)
	if audio["output"].(map[string]any)["voice"] != profile.Voice {
		t.Fatal("SeedDuplex did not use the configured speaker mapping")
	}
}
