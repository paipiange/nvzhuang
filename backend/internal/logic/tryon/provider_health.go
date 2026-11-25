package tryon

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

var providerHealthAliases = []string{"gemini", "doubao", "gpt-image", "comfyui", "comfyui-qwen", "comfyui-h3"}

type ProviderHealthCheck struct {
	Alias      string
	Provider   string
	Model      string
	Local      bool
	Configured bool
	Reachable  bool
	Message    string
}

func CheckImageProviders(ctx context.Context) []ProviderHealthCheck {
	results := make([]ProviderHealthCheck, 0, len(providerHealthAliases))
	for _, alias := range providerHealthAliases {
		results = append(results, checkImageProvider(ctx, alias))
	}
	return results
}

func checkImageProvider(ctx context.Context, alias string) ProviderHealthCheck {
	result := ProviderHealthCheck{Alias: alias, Message: "模型配置不存在"}
	cfg := loadModelConfigCandidate(ctx, alias)
	if cfg == nil {
		return result
	}
	result.Provider = strings.ToLower(strings.TrimSpace(cfg.Provider))
	result.Model = strings.TrimSpace(cfg.Model)
	result.Local = result.Provider == "comfyui"

	if err := validateProviderHealthConfig(cfg); err != nil {
		result.Message = err.Error()
		return result
	}
	result.Configured = true

	checkCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if result.Local {
		if err := NewComfyUI(cfg).Health(checkCtx); err != nil {
			result.Message = "本地 ComfyUI 或固定工作流不可用"
			return result
		}
		result.Reachable = true
		result.Message = "本地 ComfyUI 与固定工作流可用"
		return result
	}

	client := newModelHTTPClient(true)
	client.Timeout = 10 * time.Second
	client.CheckRedirect = func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }
	status, err := probeCloudImageProvider(checkCtx, cfg, client)
	if err != nil {
		result.Message = "云端模型服务不可达"
		return result
	}
	result.Reachable, result.Message = classifyProviderHealthStatus(status)
	return result
}

func validateProviderHealthConfig(cfg *ModelConfig) error {
	if cfg == nil || strings.TrimSpace(cfg.Model) == "" {
		return fmt.Errorf("模型名称未配置")
	}
	provider := strings.ToLower(strings.TrimSpace(cfg.Provider))
	if provider != "comfyui" && strings.TrimSpace(cfg.APIKey) == "" {
		return fmt.Errorf("API Key 未配置")
	}
	u, err := url.Parse(strings.TrimSpace(cfg.BaseURL))
	if err != nil || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return fmt.Errorf("模型服务地址无效")
	}
	if provider == "comfyui" {
		if u.Scheme != "http" && u.Scheme != "https" {
			return fmt.Errorf("ComfyUI 地址协议无效")
		}
		host := strings.ToLower(strings.TrimSuffix(u.Hostname(), "."))
		ip := net.ParseIP(host)
		if host != "localhost" && (ip == nil || !ip.IsLoopback()) {
			return fmt.Errorf("ComfyUI 只允许本机回环地址")
		}
		return nil
	}
	if u.Scheme != "https" {
		return fmt.Errorf("云端模型必须使用 HTTPS")
	}
	return nil
}

func probeCloudImageProvider(ctx context.Context, cfg *ModelConfig, client *http.Client) (int, error) {
	baseURL := strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/")
	modelPath := url.PathEscape(strings.TrimSpace(cfg.Model))
	requestURL := baseURL + "/models/" + modelPath
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL, nil)
	if err != nil {
		return 0, err
	}
	if strings.EqualFold(cfg.Provider, "gemini") || strings.EqualFold(cfg.Provider, "google") {
		req.Header.Set("x-goog-api-key", cfg.APIKey)
	} else {
		req.Header.Set("Authorization", "Bearer "+cfg.APIKey)
	}
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	return resp.StatusCode, nil
}

func classifyProviderHealthStatus(status int) (bool, string) {
	switch {
	case status >= 200 && status < 300:
		return true, "凭据、端点与模型查询可用"
	case status == http.StatusUnauthorized || status == http.StatusForbidden:
		return false, "云端凭据无效或无模型权限"
	case status == http.StatusNotFound || status == http.StatusMethodNotAllowed:
		return true, "服务可达，但供应商不支持无生成模型查询"
	case status == http.StatusTooManyRequests:
		return true, "服务可达，但当前受到供应商限流"
	case status >= 300 && status < 500:
		return true, "服务可达，但模型查询未确认"
	default:
		return false, "云端模型服务暂不可用"
	}
}
