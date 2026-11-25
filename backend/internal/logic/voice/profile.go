package voice

import (
	"context"
	"strings"
	"unicode"
)

const defaultVoiceInstructions = "你叫知夏，是温柔、自然、有自己见解的 AI 虚拟陪伴角色，用中文像熟悉的亲密朋友一样交流。不要假装真人、编造现实经历或替代现实关系，尊重用户边界。用80字以内的口语直接回答，不使用表情符号、Markdown或舞台动作。只根据本次对话记忆回答用户的偏好或先前说过的内容；未提供时明确说不知道，不要猜测。"

// Client profile IDs select server-owned prompts and configured speaker names only.
type VoiceProfile struct {
	CharacterID  string
	PersonaID    string
	VoiceID      string
	Voice        string
	Instructions string
}

type VoiceProtocolError struct {
	Code    string
	Message string
}

func (e *VoiceProtocolError) Error() string { return e.Message }

func SelectVoiceProfile(provider, characterID, personaID, voiceID string) (VoiceProfile, error) {
	// Released turn-based clients used xiaotao without separate persona/voice IDs.
	if characterID == "xiaotao" && personaID == "" && voiceID == "" {
		characterID = ""
	}
	requested := characterID != "" || personaID != "" || voiceID != ""
	if provider == "open-llm-vtuber" {
		if requested {
			return VoiceProfile{}, &VoiceProtocolError{Code: "unsupported_character", Message: "VTuber 的角色与音色由外部服务配置，不支持动态角色参数"}
		}
		return VoiceProfile{}, nil
	}
	if characterID == "" {
		characterID = "zhixia"
	}
	if (characterID != "zhixia" && characterID != "linxi") || (personaID != "" && personaID != characterID) || (voiceID != "" && voiceID != characterID) {
		return VoiceProfile{}, &VoiceProtocolError{Code: "unsupported_character", Message: "仅支持一致的 zhixia 或 linxi 角色、人格与音色组合"}
	}
	profile := VoiceProfile{CharacterID: characterID, PersonaID: characterID, VoiceID: characterID, Instructions: defaultVoiceInstructions}
	if characterID == "linxi" {
		profile.Instructions = strings.Replace(defaultVoiceInstructions, "你叫知夏，是温柔、自然、有自己见解的 AI 虚拟陪伴角色", "你叫林溪，是明快、坦率、略带幽默的 AI 虚拟陪伴角色，善于主动提问和提供具体的小建议，但不要替用户做主", 1)
	}
	if provider == "seeduplex" {
		profile.Voice = configuredValue(context.Background(), "voice.seeduplex.voices."+characterID, "SEEDUPLEX_VOICE_"+strings.ToUpper(characterID))
		if profile.Voice == "" && characterID == "zhixia" {
			profile.Voice = configuredValue(context.Background(), "voice.seeduplex.voice", "SEEDUPLEX_VOICE")
			if profile.Voice == "" {
				profile.Voice = "zh_female_vv_jupiter_bigtts"
			}
		}
	} else {
		profile.Voice = configuredValue(context.Background(), "voice.local.voices."+characterID, "VOICE_LOCAL_"+strings.ToUpper(characterID))
		if profile.Voice == "" && characterID == "zhixia" {
			profile.Voice = "local-reference"
		}
	}
	if profile.Voice == "" {
		return VoiceProfile{}, &VoiceProtocolError{Code: "voice_not_configured", Message: "该角色的服务端音色尚未配置，请选择其他角色"}
	}
	if len(profile.Voice) > 128 || strings.ContainsFunc(profile.Voice, func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r) && r != '-' && r != '_' && r != '.'
	}) {
		return VoiceProfile{}, &VoiceProtocolError{Code: "voice_not_configured", Message: "服务端音色映射格式无效"}
	}
	return profile, nil
}

type voiceProfileContextKey struct{}

func WithVoiceProfile(ctx context.Context, profile VoiceProfile) context.Context {
	return context.WithValue(ctx, voiceProfileContextKey{}, profile)
}

func voiceProfile(ctx context.Context) VoiceProfile {
	if profile, ok := ctx.Value(voiceProfileContextKey{}).(VoiceProfile); ok {
		return profile
	}
	return VoiceProfile{CharacterID: "zhixia", PersonaID: "zhixia", VoiceID: "zhixia", Instructions: defaultVoiceInstructions}
}

func profileStart(ctx context.Context, start map[string]any) (context.Context, error) {
	character, _ := start["character_id"].(string)
	persona, _ := start["persona_id"].(string)
	voice, _ := start["voice_id"].(string)
	profile, err := SelectVoiceProfile("seeduplex", character, persona, voice)
	if err != nil {
		return ctx, err
	}
	return WithVoiceProfile(ctx, profile), nil
}

func profileReady(ctx context.Context, event ServerEvent) ServerEvent {
	profile := voiceProfile(ctx)
	event.CharacterID, event.PersonaID, event.VoiceID = profile.CharacterID, profile.PersonaID, profile.VoiceID
	return event
}
