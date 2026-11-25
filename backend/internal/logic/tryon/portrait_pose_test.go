package tryon

import (
	"strings"
	"testing"
)

func TestPortraitPoseCatalogAndPrompts(t *testing.T) {
	want := map[string]string{
		"natural": "standing naturally", "wave": "friendly wave", "heart": "forming a small heart",
		"peace": "peace sign", "sitting": "sitting gracefully", "profile": "three-quarter profile",
	}
	if len(portraitPoses) != len(want) {
		t.Fatalf("unexpected pose catalog size: %d", len(portraitPoses))
	}
	for id, detail := range want {
		prompt := buildPortraitPrompt(id)
		if !ValidPoseID(id) || !strings.HasPrefix(prompt, portraitPromptPrefix) || !strings.Contains(prompt, detail) {
			t.Errorf("pose %q not correctly mapped", id)
		}
		for _, model := range []string{"qwen", "h3"} {
			if got := (&ComfyUI{model: model}).buildPrompt(prompt); got != prompt {
				t.Errorf("%s workflow discarded portrait pose %q", model, id)
			}
		}
	}
	for _, id := range []string{"", "SITTING", " wave ", "../wave", "https://example.invalid/wave", "constructor"} {
		if ValidPoseID(id) {
			t.Errorf("unlisted pose %q accepted", id)
		}
	}
}
