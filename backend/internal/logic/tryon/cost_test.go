package tryon

import (
	"context"
	"testing"
)

func TestIsCloudGenerationValidatesClientConfig(t *testing.T) {
	cloud, err := IsCloudGeneration(context.Background(), "", &ModelConfig{
		Provider: "gemini",
		APIKey:   "test-key",
		BaseURL:  "https://example.invalid/v1",
		Model:    "image-model",
	})
	if err != nil || !cloud {
		t.Fatalf("cloud=%v err=%v", cloud, err)
	}
	if _, err := IsCloudGeneration(context.Background(), "", &ModelConfig{
		Provider: "gemini",
		APIKey:   "test-key",
		BaseURL:  "http://127.0.0.1:8188",
		Model:    "image-model",
	}); err == nil {
		t.Fatal("client-provided loopback endpoint must be rejected before budget deduction")
	}
}

func TestIsCloudGenerationRecognizesConfiguredComfyUI(t *testing.T) {
	cloud, err := IsCloudGeneration(context.Background(), "comfyui", nil)
	if err != nil {
		t.Fatal(err)
	}
	if cloud {
		t.Fatal("configured ComfyUI generation must not consume cloud budget")
	}
}
