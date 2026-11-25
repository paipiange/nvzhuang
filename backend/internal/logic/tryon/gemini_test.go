package tryon

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGeminiSendsKeyInHeaderNotURL(t *testing.T) {
	const apiKey = "secret-test-key"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.URL.Query().Get("key"); got != "" {
			t.Fatalf("API key must not be sent in URL query, got %q", got)
		}
		if got := r.Header.Get("x-goog-api-key"); got != apiKey {
			t.Fatalf("expected API key header, got %q", got)
		}
		var payload geminiRequest
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Error(err)
			return
		}
		parts := payload.Contents[0].Parts
		if parts[0].Text != buildPortraitPrompt("wave") || parts[1].InlineData.MimeType != "image/webp" || parts[2].InlineData.MimeType != "image/jpeg" {
			t.Error("provider request discarded portrait pose or labeled gallery inputs as PNG")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"candidates":[{"content":{"parts":[{"inlineData":{"mimeType":"image/png","data":"aW1hZ2U="}}]}}]}`))
	}))
	defer server.Close()

	gen := NewGemini(&ModelConfig{
		Name:    "browser-custom",
		APIKey:  apiKey,
		BaseURL: server.URL,
		Model:   "test-model",
	})
	result, err := gen.Generate(context.Background(), "data:image/webp;base64,cGVyc29u", "data:image/jpeg;base64,Z2FybWVudA==", buildPortraitPrompt("wave"), "1024x1536")
	if err != nil {
		t.Fatalf("Generate returned error: %v", err)
	}
	if result != "aW1hZ2U=" {
		t.Fatalf("unexpected image result: %q", result)
	}
}
