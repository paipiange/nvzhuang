package configenv

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/gogf/gf/v2/frame/g"
	"github.com/gogf/gf/v2/os/gcfg"
)

func TestEnvName(t *testing.T) {
	cases := map[string]string{
		EnvName("server", "address"):                     "NVZHUANG_SERVER_ADDRESS",
		EnvName("llm", "models", "gpt-image", "baseURL"): "NVZHUANG_LLM_MODELS_GPT_IMAGE_BASE_URL",
		EnvName("upload", "maxRequestBodyBytes"):         "NVZHUANG_UPLOAD_MAX_REQUEST_BODY_BYTES",
		EnvName("security", "apiKeysEnv"):                "NVZHUANG_SECURITY_API_KEYS_ENV",
	}
	for actual, expected := range cases {
		if actual != expected {
			t.Fatalf("expected %s, got %s", expected, actual)
		}
	}
}

func TestLoadDotEnvFileKeepsProcessEnvironment(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".env")
	content := "EXISTING_VALUE=from-file\nQUOTED_VALUE=\"hello world\"\nLIST_VALUE=a,b # comment\n"
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("EXISTING_VALUE", "from-process")
	os.Unsetenv("QUOTED_VALUE")
	os.Unsetenv("LIST_VALUE")
	t.Cleanup(func() {
		os.Unsetenv("QUOTED_VALUE")
		os.Unsetenv("LIST_VALUE")
	})
	if err := loadDotEnvFile(path); err != nil {
		t.Fatal(err)
	}
	if actual := os.Getenv("EXISTING_VALUE"); actual != "from-process" {
		t.Fatalf("process environment must win, got %q", actual)
	}
	if actual := os.Getenv("QUOTED_VALUE"); actual != "hello world" {
		t.Fatalf("unexpected quoted value %q", actual)
	}
	if actual := os.Getenv("LIST_VALUE"); actual != "a,b" {
		t.Fatalf("unexpected comment handling %q", actual)
	}
}

func TestApplyOverrides(t *testing.T) {
	configDir := t.TempDir()
	configPath := filepath.Join(configDir, "config.yaml")
	content := []byte("server:\n  address: ':8000'\nsecurity:\n  authRequired: true\n  trustedOrigins:\n    - https://example.invalid\nllm:\n  models:\n    gpt-image:\n      baseURL: https://api.example.invalid/v1\n")
	if err := os.WriteFile(configPath, content, 0o600); err != nil {
		t.Fatal(err)
	}
	adapter, err := gcfg.NewAdapterFile("config.yaml")
	if err != nil {
		t.Fatal(err)
	}
	if err := adapter.SetPath(configDir); err != nil {
		t.Fatal(err)
	}
	previous := g.Cfg().GetAdapter()
	g.Cfg().SetAdapter(adapter)
	t.Cleanup(func() { g.Cfg().SetAdapter(previous) })
	t.Setenv("NVZHUANG_SERVER_ADDRESS", ":9000")
	t.Setenv("NVZHUANG_SECURITY_AUTH_REQUIRED", "false")
	t.Setenv("NVZHUANG_SECURITY_TRUSTED_ORIGINS", "https://one.invalid,https://two.invalid")
	t.Setenv("NVZHUANG_LLM_MODELS_GPT_IMAGE_BASE_URL", "https://override.invalid/v1")

	count, err := ApplyOverrides(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if count != 4 {
		t.Fatalf("expected 4 overrides, got %d", count)
	}
	if actual := g.Cfg().MustGet(context.Background(), "server.address").String(); actual != ":9000" {
		t.Fatalf("unexpected address %q", actual)
	}
	if actual := g.Cfg().MustGet(context.Background(), "security.authRequired").Bool(); actual {
		t.Fatal("expected authRequired override to be false")
	}
	if actual := g.Cfg().MustGet(context.Background(), "security.trustedOrigins").Strings(); !reflect.DeepEqual(actual, []string{"https://one.invalid", "https://two.invalid"}) {
		t.Fatalf("unexpected origins %#v", actual)
	}
	if actual := g.Cfg().MustGet(context.Background(), "llm.models.gpt-image.baseURL").String(); actual != "https://override.invalid/v1" {
		t.Fatalf("unexpected base URL %q", actual)
	}
}
