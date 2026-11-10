package cmd

import (
	"context"

	"github.com/gogf/gf/v2/frame/g"
	"github.com/gogf/gf/v2/net/ghttp"
	"github.com/gogf/gf/v2/os/gcmd"
	"github.com/gogf/gf/v2/os/gcfg"
	"github.com/gogf/gf/v2/os/gfile"

	"backend/internal/controller/hello"
	"backend/internal/controller/mobile"
	"backend/internal/controller/tryon"
	"backend/internal/imagevalidate"
	"backend/internal/middleware"
	"backend/internal/security"
)

// InitConfigFallback 检查并保障配置文件就绪：
// 若当前没有可用的 config.yaml，自动尝试回退加载 config.example.yaml。
func InitConfigFallback(ctx context.Context) {
	if !g.Cfg().Available(ctx) {
		candidates := []string{
			"manifest/config/config.example.yaml",
			"config/config.example.yaml",
			"config.example.yaml",
		}
		for _, path := range candidates {
			if gfile.Exists(path) {
				if adapter, ok := g.Cfg().GetAdapter().(*gcfg.AdapterFile); ok {
					adapter.SetFileName(path)
					g.Log().Infof(ctx, "未找到 config.yaml，已自动加载模板配置: %s", path)
				}
				break
			}
		}
	}
}

// EnsureServerPort 确保 Server 具备显式监听端口，避免未配置时随机分配高位端口 (:0)
func EnsureServerPort(ctx context.Context, s *ghttp.Server) {
	addr, err := g.Cfg().Get(ctx, "server.address")
	if err != nil || addr.IsEmpty() {
		s.SetPort(8000)
		g.Log().Info(ctx, "未指定 server.address 配置，已显式绑定默认端口 :8000")
	}
}

var (
	Main = gcmd.Command{
		Name:  "main",
		Usage: "main",
		Brief: "start http server",
		Func: func(ctx context.Context, parser *gcmd.Parser) (err error) {
			InitConfigFallback(ctx)

			secService, err := security.InitService(ctx)
			if err != nil {
				return err
			}

			imgLimits := imagevalidate.LoadImageLimits(ctx)
			corsMw := middleware.NewCORSMiddleware(secService.Config)
			bodyLimitMw := middleware.NewBodyLimitMiddleware(imgLimits.MaxRequestBodyBytes)
			authMw := middleware.NewAuthMiddleware(secService.TokenStore)
			rateLimitMw := middleware.NewRateLimitMiddleware(secService.RateLimiter)

			s := g.Server()
			EnsureServerPort(ctx, s)

			// 全局挂载 RequestID 与 CORS 中间件，确保未命中路由的 OPTIONS 预检与 404 响应也能返回 CORS 头
			s.Use(
				middleware.RequestID,
				corsMw.Handler,
			)

			s.Group("/", func(group *ghttp.RouterGroup) {
				group.Middleware(
					ghttp.MiddlewareHandlerResponse,
					bodyLimitMw.Handler,
					authMw.Handler,
					rateLimitMw.Handler,
				)
				group.Bind(
					hello.NewV1(),
					tryon.NewV1(),
				)
				mobile.New().RegisterRoutes(group)
			})
			s.Run()
			return nil
		},
	}
)
