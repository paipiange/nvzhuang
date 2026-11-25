package tryon

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestValidateProviderHealthConfig(t *testing.T) {
	for _, tc := range []struct {
		name string
		cfg  *ModelConfig
		ok   bool
	}{
		{"cloud https", &ModelConfig{Provider: "gemini", APIKey: "test-key", BaseURL: "https://example.invalid/v1", Model: "image-model"}, true},
		{"cloud http rejected", &ModelConfig{Provider: "openai", APIKey: "test-key", BaseURL: "http://example.invalid/v1", Model: "image-model"}, false},
		{"cloud key required", &ModelConfig{Provider: "doubao", BaseURL: "https://example.invalid/v1", Model: "image-model"}, false},
		{"local loopback", &ModelConfig{Provider: "comfyui", BaseURL: "http://127.0.0.1:8188", Model: "workflow"}, true},
		{"remote comfy rejected", &ModelConfig{Provider: "comfyui", BaseURL: "https://example.invalid", Model: "workflow"}, false},
		{"credential in url rejected", &ModelConfig{Provider: "openai", APIKey: "test-key", BaseURL: "https://user@example.invalid/v1", Model: "image-model"}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := validateProviderHealthConfig(tc.cfg)
			if (err == nil) != tc.ok {
				t.Fatalf("ok=%v, got error %v", tc.ok, err)
			}
		})
	}
}

func TestProbeCloudImageProviderUsesAuthWithoutGeneration(t *testing.T) {
	for _, provider := range []string{"gemini", "openai"} {
		t.Run(provider, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodGet || r.URL.Path != "/v1/models/image-model" {
					t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
				}
				if provider == "gemini" && r.Header.Get("x-goog-api-key") != "test-key" {
					t.Fatal("missing Gemini auth header")
				}
				if provider == "openai" && r.Header.Get("Authorization") != "Bearer test-key" {
					t.Fatal("missing bearer auth header")
				}
				w.WriteHeader(http.StatusOK)
			}))
			defer server.Close()

			status, err := probeCloudImageProvider(context.Background(), &ModelConfig{
				Provider: provider,
				APIKey:   "test-key",
				BaseURL:  server.URL + "/v1",
				Model:    "image-model",
			}, server.Client())
			if err != nil || status != http.StatusOK {
				t.Fatalf("status=%d err=%v", status, err)
			}
		})
	}
}

func TestClassifyProviderHealthStatusDoesNotExposeResponseBodies(t *testing.T) {
	for _, tc := range []struct {
		status    int
		reachable bool
	}{
		{http.StatusOK, true},
		{http.StatusUnauthorized, false},
		{http.StatusNotFound, true},
		{http.StatusTooManyRequests, true},
		{http.StatusBadGateway, false},
	} {
		reachable, message := classifyProviderHealthStatus(tc.status)
		if reachable != tc.reachable || message == "" {
			t.Fatalf("status=%d reachable=%v message=%q", tc.status, reachable, message)
		}
	}
}
