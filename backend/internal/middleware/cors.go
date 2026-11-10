package middleware

import (
	"net"
	"net/http"
	"net/url"
	"strings"

	"github.com/gogf/gf/v2/net/ghttp"

	"backend/internal/security"
)

type CORSMiddleware struct {
	trustedOrigins      map[string]bool
	allowPrivateNetwork bool
}

func NewCORSMiddleware(cfg *security.SecurityConfig) *CORSMiddleware {
	origins := make(map[string]bool)
	for _, o := range cfg.TrustedOrigins {
		trimmed := strings.TrimRight(strings.TrimSpace(o), "/")
		if trimmed != "" && trimmed != "*" {
			origins[trimmed] = true
		}
	}
	return &CORSMiddleware{
		trustedOrigins:      origins,
		allowPrivateNetwork: cfg.AllowPrivateNetwork,
	}
}

func (m *CORSMiddleware) isAllowedOrigin(origin string) bool {
	if m.trustedOrigins[origin] {
		return true
	}
	// 支持微信小程序来源
	if origin == "https://servicewechat.com" || strings.HasPrefix(origin, "https://servicewechat.com/") {
		return true
	}
	// 支持 Android 离线 WebView 来源
	if origin == "https://appassets.androidplatform.net" || strings.HasPrefix(origin, "https://appassets.androidplatform.net/") {
		return true
	}
	// 解析 URL
	u, err := url.Parse(origin)
	if err == nil {
		hostname := strings.ToLower(u.Hostname())
		// 允许本机回环 127.0.0.1 和 localhost 的所有端口访问
		if hostname == "127.0.0.1" || hostname == "localhost" {
			return true
		}
		// 允许局域网私有 IP 访问（当开启私有网络或本地调试模式时）
		ip := net.ParseIP(hostname)
		if ip != nil && (ip.IsLoopback() || ip.IsPrivate()) {
			return true
		}
		// 允许通过 ngrok 穿透的域名来源
		if strings.HasSuffix(hostname, ".ngrok-free.dev") || strings.HasSuffix(hostname, ".ngrok.app") || strings.HasSuffix(hostname, ".ngrok.io") {
			return true
		}
	}
	return false
}

func (m *CORSMiddleware) Handler(r *ghttp.Request) {
	origin := r.Header.Get("Origin")
	if origin == "" {
		// 非浏览器请求（例如 cURL/自动化测试等无 Origin 场景），放行至鉴权中间件处理
		r.Middleware.Next()
		return
	}

	normOrigin := strings.TrimRight(strings.TrimSpace(origin), "/")
	if !m.isAllowedOrigin(normOrigin) {
		WriteAPIError(r, security.ErrOriginNotAllowed)
		return
	}

	r.Response.Header().Set("Access-Control-Allow-Origin", origin)
	r.Response.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS, DELETE, PUT, HEAD")
	r.Response.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Request-ID, Accept, Origin, X-Requested-With, ngrok-skip-browser-warning")
	r.Response.Header().Set("Access-Control-Expose-Headers", "X-Request-ID, Retry-After")

	if m.allowPrivateNetwork && r.Header.Get("Access-Control-Request-Private-Network") == "true" {
		r.Response.Header().Set("Access-Control-Allow-Private-Network", "true")
	}

	if r.Method == http.MethodOptions {
		r.Response.WriteStatus(http.StatusOK)
		r.ExitAll()
		return
	}

	r.Middleware.Next()
}
