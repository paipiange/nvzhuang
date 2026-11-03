package security

import (
	"context"

	"github.com/gogf/gf/v2/frame/g"
)

type SecurityConfig struct {
	AuthRequired        bool              `json:"authRequired"`
	APIKeysEnv          string            `json:"apiKeysEnv"`
	TrustedOrigins      []string          `json:"trustedOrigins"`
	AllowPrivateNetwork bool              `json:"allowPrivateNetwork"`
	RateLimit           RateLimitConfig   `json:"rateLimit"`
	Concurrency         ConcurrencyConfig `json:"concurrency"`
}

type RateLimitConfig struct {
	RequestsPerMinute         int `json:"requestsPerMinute"`
	Burst                     int `json:"burst"`
	LimiterIdleMinutes        int `json:"limiterIdleMinutes"`
	DailyRequestsPerPrincipal int `json:"dailyRequestsPerPrincipal"`
}

type ConcurrencyConfig struct {
	Global       int `json:"global"`
	PerPrincipal int `json:"perPrincipal"`
}

func DefaultSecurityConfig() *SecurityConfig {
	return &SecurityConfig{
		AuthRequired: true,
		APIKeysEnv:   "TRYON_API_KEYS",
		TrustedOrigins: []string{
			"https://paipiange.github.io",
			"http://localhost:3000",
			"http://127.0.0.1:3000",
			"http://localhost:8080",
			"http://127.0.0.1:8080",
			"http://localhost:5173",
			"http://127.0.0.1:5173",
		},
		AllowPrivateNetwork: false,
		RateLimit: RateLimitConfig{
			RequestsPerMinute:         10,
			Burst:                     3,
			LimiterIdleMinutes:        30,
			DailyRequestsPerPrincipal: 100,
		},
		Concurrency: ConcurrencyConfig{
			Global:       2,
			PerPrincipal: 1,
		},
	}
}

func LoadSecurityConfig(ctx context.Context) (*SecurityConfig, error) {
	cfg := DefaultSecurityConfig()
	val, err := g.Cfg().Get(ctx, "security")
	if err != nil || val.IsEmpty() {
		return cfg, nil
	}

	if err := val.Scan(cfg); err != nil {
		return nil, err
	}

	if cfg.APIKeysEnv == "" {
		cfg.APIKeysEnv = "TRYON_API_KEYS"
	}
	if len(cfg.TrustedOrigins) == 0 {
		cfg.TrustedOrigins = []string{
			"https://paipiange.github.io",
			"http://localhost:3000",
			"http://127.0.0.1:3000",
			"http://localhost:8080",
			"http://127.0.0.1:8080",
			"http://localhost:5173",
			"http://127.0.0.1:5173",
		}
	}
	if cfg.RateLimit.RequestsPerMinute <= 0 {
		cfg.RateLimit.RequestsPerMinute = 10
	}
	if cfg.RateLimit.Burst <= 0 {
		cfg.RateLimit.Burst = 3
	}
	if cfg.RateLimit.LimiterIdleMinutes <= 0 {
		cfg.RateLimit.LimiterIdleMinutes = 30
	}
	if cfg.RateLimit.DailyRequestsPerPrincipal <= 0 {
		cfg.RateLimit.DailyRequestsPerPrincipal = 100
	}
	if cfg.Concurrency.Global <= 0 {
		cfg.Concurrency.Global = 2
	}
	if cfg.Concurrency.PerPrincipal <= 0 {
		cfg.Concurrency.PerPrincipal = 1
	}

	return cfg, nil
}
