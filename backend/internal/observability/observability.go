package observability

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gogf/gf/v2/frame/g"
	"github.com/gogf/gf/v2/net/ghttp"
)

type Config struct {
	MetricsEnabled     bool
	AllowRemoteMetrics bool
}

type metricKey struct {
	Route       string
	StatusClass string
}

type metricBucket struct {
	Requests       uint64
	DurationMicros uint64
}

type Service struct {
	config    Config
	startedAt time.Time
	ready     atomic.Bool
	active    atomic.Int64
	mu        sync.RWMutex
	buckets   map[metricKey]metricBucket
}

func LoadConfig(ctx context.Context) Config {
	return Config{
		MetricsEnabled:     g.Cfg().MustGet(ctx, "observability.metricsEnabled", true).Bool(),
		AllowRemoteMetrics: g.Cfg().MustGet(ctx, "observability.allowRemoteMetrics", false).Bool(),
	}
}

func NewService(config Config) *Service {
	service := &Service{
		config:    config,
		startedAt: time.Now().UTC(),
		buckets:   make(map[metricKey]metricBucket),
	}
	service.ready.Store(true)
	return service
}

func (s *Service) SetReady(ready bool) {
	s.ready.Store(ready)
}

func (s *Service) Middleware(r *ghttp.Request) {
	s.active.Add(1)
	started := time.Now()
	defer func() {
		s.active.Add(-1)
		status := r.Response.Status
		if status == 0 {
			status = http.StatusOK
		}
		s.record(routeLabel(r.URL.Path), statusClass(status), time.Since(started))
	}()
	r.Middleware.Next()
}

func (s *Service) RegisterRoutes(group *ghttp.RouterGroup) {
	group.GET("/healthz", s.Health)
	group.GET("/readyz", s.Ready)
	group.GET("/metrics", s.Metrics)
}

func (s *Service) Health(r *ghttp.Request) {
	r.Response.WriteJson(g.Map{
		"status":         "ok",
		"uptime_seconds": int64(time.Since(s.startedAt).Seconds()),
	})
}

func (s *Service) Ready(r *ghttp.Request) {
	if !s.ready.Load() {
		r.Response.WriteHeader(http.StatusServiceUnavailable)
		r.Response.WriteJson(g.Map{"status": "not_ready"})
		return
	}
	r.Response.WriteJson(g.Map{"status": "ready"})
}

func (s *Service) Metrics(r *ghttp.Request) {
	if !s.config.MetricsEnabled {
		r.Response.WriteStatus(http.StatusNotFound)
		return
	}
	if !s.config.AllowRemoteMetrics && !isLoopbackRemote(r.Request.RemoteAddr) {
		r.Response.WriteStatus(http.StatusForbidden)
		return
	}
	r.Response.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	r.Response.Write(s.RenderMetrics())
}

func (s *Service) record(route, class string, duration time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	key := metricKey{Route: route, StatusClass: class}
	bucket := s.buckets[key]
	bucket.Requests++
	bucket.DurationMicros += uint64(max(duration.Microseconds(), 0))
	s.buckets[key] = bucket
}

func (s *Service) RenderMetrics() string {
	s.mu.RLock()
	keys := make([]metricKey, 0, len(s.buckets))
	for key := range s.buckets {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(i, j int) bool {
		if keys[i].Route == keys[j].Route {
			return keys[i].StatusClass < keys[j].StatusClass
		}
		return keys[i].Route < keys[j].Route
	})
	buckets := make(map[metricKey]metricBucket, len(s.buckets))
	for _, key := range keys {
		buckets[key] = s.buckets[key]
	}
	s.mu.RUnlock()

	var output strings.Builder
	output.WriteString("# HELP nvzhuang_process_uptime_seconds Backend process uptime.\n")
	output.WriteString("# TYPE nvzhuang_process_uptime_seconds gauge\n")
	fmt.Fprintf(&output, "nvzhuang_process_uptime_seconds %d\n", int64(time.Since(s.startedAt).Seconds()))
	output.WriteString("# HELP nvzhuang_http_active_requests Current in-flight HTTP requests.\n")
	output.WriteString("# TYPE nvzhuang_http_active_requests gauge\n")
	fmt.Fprintf(&output, "nvzhuang_http_active_requests %d\n", s.active.Load())
	output.WriteString("# HELP nvzhuang_http_requests_total Aggregated HTTP requests by fixed route and status class.\n")
	output.WriteString("# TYPE nvzhuang_http_requests_total counter\n")
	for _, key := range keys {
		bucket := buckets[key]
		fmt.Fprintf(&output, "nvzhuang_http_requests_total{route=%q,status_class=%q} %d\n", key.Route, key.StatusClass, bucket.Requests)
	}
	output.WriteString("# HELP nvzhuang_http_request_duration_seconds_sum Aggregated HTTP request duration by fixed route and status class.\n")
	output.WriteString("# TYPE nvzhuang_http_request_duration_seconds_sum counter\n")
	for _, key := range keys {
		bucket := buckets[key]
		fmt.Fprintf(&output, "nvzhuang_http_request_duration_seconds_sum{route=%q,status_class=%q} %.6f\n", key.Route, key.StatusClass, float64(bucket.DurationMicros)/1_000_000)
	}
	return output.String()
}

func routeLabel(path string) string {
	switch {
	case path == "/healthz", path == "/readyz", path == "/metrics", path == "/tryon", path == "/tryon/providers/health":
		return path
	case strings.HasPrefix(path, "/api/v1/voice/"):
		return "/api/v1/voice"
	case strings.HasPrefix(path, "/api/v1/tryon/jobs"):
		return "/api/v1/tryon/jobs"
	case strings.HasPrefix(path, "/api/v1/garments"):
		return "/api/v1/garments"
	default:
		return "/other"
	}
}

func statusClass(status int) string {
	if status < 100 || status > 599 {
		return "unknown"
	}
	return fmt.Sprintf("%dxx", status/100)
}

func isLoopbackRemote(remoteAddress string) bool {
	host, _, err := net.SplitHostPort(remoteAddress)
	if err != nil {
		host = remoteAddress
	}
	host = strings.Trim(host, "[]")
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
