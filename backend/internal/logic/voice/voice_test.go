package voice

import (
	"bytes"
	"context"
	"encoding/binary"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func TestRequiredModelUsesNonemptyRegularFiles(t *testing.T) {
	root := t.TempDir()
	required := []string{"ready.bin", "missing.bin", "empty.bin", "directory.bin"}
	for name, data := range map[string]string{"ready.bin": "model", "empty.bin": "", "unrelated.txt": "unrelated"} {
		if err := os.WriteFile(filepath.Join(root, name), []byte(data), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Mkdir(filepath.Join(root, "directory.bin"), 0700); err != nil {
		t.Fatal(err)
	}
	got := requiredModel("test", root, "models/test", required)
	if got.Exists || got.Size != 5 || got.Progress != 25 || !slices.Equal(got.MissingFiles, required[1:]) || strings.Contains(got.Message, root) {
		t.Fatalf("unexpected model diagnostic: %+v", got)
	}
	got = requiredModel("test", root, "models/test", required[:1])
	if !got.Exists || got.Progress != 100 || len(got.MissingFiles) != 0 {
		t.Fatalf("unexpected ready model: %+v", got)
	}
}

func TestQwenRequiresFixedLengthAndGGUFHeader(t *testing.T) {
	header := make([]byte, 24)
	copy(header, "GGUF")
	binary.LittleEndian.PutUint32(header[4:], 3)
	binary.LittleEndian.PutUint64(header[8:], 398)
	binary.LittleEndian.PutUint64(header[16:], 36)
	if !validGGUFHeader(bytes.NewReader(header)) {
		t.Fatal("valid GGUF header rejected")
	}
	if validGGUFHeader(bytes.NewReader(header[:23])) {
		t.Fatal("truncated header accepted")
	}
	path := filepath.Join(t.TempDir(), qwenFile)
	if err := os.WriteFile(path, header, 0600); err != nil {
		t.Fatal(err)
	}
	if got := qwenModel(path); got.Exists || got.Progress != 0 {
		t.Fatalf("accepted incomplete artifact %+v", got)
	}
	header[0] = 'X'
	if validGGUFHeader(bytes.NewReader(header)) {
		t.Fatal("bad magic accepted")
	}
}

func TestHTTPHealthValidatesResponse(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		status     int
		tts, want  bool
	}{
		{"qwen", `{"status":"ok"}`, 200, false, true},
		{"tts", `{"status":"ok","sample_rate":24000}`, 200, true, true},
		{"wrong sample rate", `{"status":"ok","sample_rate":16000}`, 200, true, false},
		{"page", "<html>other service</html>", 200, false, false},
		{"status", `{"status":"loading"}`, 200, false, false},
		{"starting", `{"status":"ok"}`, 503, false, false},
		{"oversized", `{"status":"ok"}` + strings.Repeat(" ", 4096), 200, false, false},
		{"trailing data", `{"status":"ok"} {}`, 200, false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer server.Close()
			got, message := httpHealth(context.Background(), server.URL, tc.tts)
			if got != tc.want || message == "" || strings.Contains(message, server.URL) {
				t.Fatalf("ready=%t, message=%q", got, message)
			}
		})
	}
}

func TestInstalledVoiceReadiness(t *testing.T) {
	if os.Getenv("NVZHUANG_TEST_INSTALLED_VOICE") != "1" {
		t.Skip("requires the configured local models and running services")
	}
	status := LocalStatus(context.Background())
	for _, model := range status.Models {
		if !model.Exists {
			t.Errorf("%s readiness failed: %v", model.Name, model.MissingFiles)
		} else {
			t.Logf("%s ready", model.Name)
		}
	}
	for _, component := range status.Components {
		if !component.Available {
			t.Errorf("%s readiness failed: %s", component.Name, component.Message)
		} else {
			t.Logf("%s ready", component.Name)
		}
	}
}
