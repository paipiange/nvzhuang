package observability

import (
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gogf/gf/v2/net/ghttp"
)

func TestMetricsUseFixedPrivacySafeLabels(t *testing.T) {
	service := NewService(Config{MetricsEnabled: true})
	service.record(routeLabel("/api/v1/tryon/jobs/private-job-id?token=secret"), statusClass(http.StatusOK), 25*time.Millisecond)
	service.record(routeLabel("/unknown/private/path"), statusClass(http.StatusInternalServerError), 10*time.Millisecond)
	metrics := service.RenderMetrics()
	for _, forbidden := range []string{"private-job-id", "token=secret", "/unknown/private/path"} {
		if strings.Contains(metrics, forbidden) {
			t.Fatalf("metrics leaked dynamic input %q: %s", forbidden, metrics)
		}
	}
	if !strings.Contains(metrics, `route="/api/v1/tryon/jobs",status_class="2xx"`) || !strings.Contains(metrics, `route="/other",status_class="5xx"`) {
		t.Fatalf("missing normalized metrics: %s", metrics)
	}
}

func TestLoopbackMetricsPolicy(t *testing.T) {
	for address, allowed := range map[string]bool{
		"127.0.0.1:8000":  true,
		"[::1]:8000":      true,
		"192.0.2.10:8000": false,
		"invalid":         false,
	} {
		if actual := isLoopbackRemote(address); actual != allowed {
			t.Fatalf("address %s allowed=%t, want %t", address, actual, allowed)
		}
	}
}

func TestHealthReadyAndMetricsRoutes(t *testing.T) {
	service := NewService(Config{MetricsEnabled: true, AllowRemoteMetrics: true})
	server := ghttp.GetServer("test-observability")
	server.Group("/", func(group *ghttp.RouterGroup) {
		group.Middleware(service.Middleware)
		service.RegisterRoutes(group)
	})
	server.SetPort(0)
	if err := server.Start(); err != nil {
		t.Fatal(err)
	}
	defer server.Shutdown()
	address := fmt.Sprintf("http://127.0.0.1:%d", server.GetListenedPort())

	for path, expected := range map[string]string{"/healthz": `"status":"ok"`, "/readyz": `"status":"ready"`} {
		response, err := http.Get(address + path)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(response.Body)
		response.Body.Close()
		if response.StatusCode != http.StatusOK || !strings.Contains(string(body), expected) {
			t.Fatalf("%s returned %d %s", path, response.StatusCode, body)
		}
	}

	response, err := http.Get(address + "/metrics")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(response.Body)
	response.Body.Close()
	if response.StatusCode != http.StatusOK || !strings.Contains(string(body), "nvzhuang_http_requests_total") {
		t.Fatalf("metrics returned %d %s", response.StatusCode, body)
	}

	service.SetReady(false)
	response, err = http.Get(address + "/readyz")
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("not-ready status=%d", response.StatusCode)
	}
}
