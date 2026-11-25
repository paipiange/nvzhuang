package tryon

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gogf/gf/v2/frame/g"
)

// ImageGenerator 图像生成模型适配器接口
type ImageGenerator interface {
	// Generate 生成换装图。入参为两张图的 base64（人像 + 服装），返回结果图 base64
	Generate(ctx context.Context, personB64, garmentB64, prompt, size string) (string, error)
	// Name 模型别名（对外暴露的名称）
	Name() string
}

// ModelConfig 单个模型的配置项
type ModelConfig struct {
	Name     string // 模型别名（前端请求用），如 gpt-image / doubao / gemini
	Provider string // 协议类型：openai（OpenAI Images 兼容）/ gemini
	APIKey   string // API Key（可被环境变量覆盖）
	BaseURL  string // 接口地址（可配置，支持第三方/国内服务商）
	Model    string // 服务商侧真实模型名
	EnvKey   string // 覆盖用的环境变量名
	// ComfyUI 固定工作流配置。路径和节点映射只允许来自服务端配置，避免公网后端访问用户指定的内网地址。
	WorkflowPath   string
	PersonNode     string
	GarmentNode    string
	PromptNode     string
	SeedNode       string
	Seed           int64
	OutputNode     string
	PollInterval   time.Duration
	RequestTimeout time.Duration
	// ClientProvided 表示配置来自浏览器；启用后 HTTP 客户端会阻止内网/保留地址，降低 SSRF 风险。
	ClientProvided bool
}

// loadModelConfig 从配置文件加载指定模型的配置，并允许环境变量覆盖
func loadModelConfig(ctx context.Context, alias string) (*ModelConfig, error) {
	cfg := loadModelConfigCandidate(ctx, alias)
	if cfg == nil {
		return nil, fmt.Errorf("模型 %s 未配置（当前请求可能来自不支持个人模型配置的旧前端或旧后端）", alias)
	}

	provider := strings.ToLower(strings.TrimSpace(cfg.Provider))
	if provider != "comfyui" && cfg.APIKey == "" {
		return nil, fmt.Errorf("模型 %s 未配置 API Key（请在 config.yaml 的 llm.models.%s.apiKey 或环境变量中配置）", alias, alias)
	}
	if cfg.Model == "" {
		return nil, fmt.Errorf("模型 %s 未配置 model 名（llm.models.%s.model）", alias, alias)
	}
	return cfg, nil
}

// loadModelConfigCandidate reads configuration without requiring credentials. It is used by
// the no-generation provider preflight so missing keys can be reported without exposing them.
func loadModelConfigCandidate(ctx context.Context, alias string) *ModelConfig {
	// 按列表读取：llm.models.[alias]
	prefix := "llm.models." + alias
	cfg := &ModelConfig{
		Name:           alias,
		Provider:       g.Cfg().MustGet(ctx, prefix+".provider", "openai").String(),
		APIKey:         g.Cfg().MustGet(ctx, prefix+".apiKey", "").String(),
		BaseURL:        g.Cfg().MustGet(ctx, prefix+".baseURL", "").String(),
		Model:          g.Cfg().MustGet(ctx, prefix+".model", "").String(),
		EnvKey:         g.Cfg().MustGet(ctx, prefix+".envKey", "").String(),
		WorkflowPath:   g.Cfg().MustGet(ctx, prefix+".workflowPath", "").String(),
		PersonNode:     g.Cfg().MustGet(ctx, prefix+".personNode", "").String(),
		GarmentNode:    g.Cfg().MustGet(ctx, prefix+".garmentNode", "").String(),
		PromptNode:     g.Cfg().MustGet(ctx, prefix+".promptNode", "").String(),
		SeedNode:       g.Cfg().MustGet(ctx, prefix+".seedNode", "").String(),
		Seed:           g.Cfg().MustGet(ctx, prefix+".seed", 246813579).Int64(),
		OutputNode:     g.Cfg().MustGet(ctx, prefix+".outputNode", "").String(),
		PollInterval:   time.Duration(g.Cfg().MustGet(ctx, prefix+".pollIntervalMs", 1000).Int()) * time.Millisecond,
		RequestTimeout: time.Duration(g.Cfg().MustGet(ctx, prefix+".timeoutSeconds", 900).Int()) * time.Second,
	}

	// 环境变量覆盖（优先级最高）
	if cfg.EnvKey != "" {
		if v := lookupEnv(cfg.EnvKey); v != "" {
			cfg.APIKey = v
		}
	}

	// 未在 models 列表找到时，回退到旧的固定 key（兼容）
	if cfg.Model == "" && cfg.BaseURL == "" && cfg.APIKey == "" {
		cfg = loadLegacyConfig(ctx, alias)
	}
	return cfg
}

// loadLegacyConfig 兼容旧的 llm.openai / llm.gemini 配置写法
func loadLegacyConfig(ctx context.Context, alias string) *ModelConfig {
	switch alias {
	case "gpt-image":
		return &ModelConfig{
			Name:     alias,
			Provider: "openai",
			APIKey:   getKey("OPENAI_API_KEY", "llm.openai.apiKey"),
			BaseURL:  g.Cfg().MustGet(ctx, "llm.openai.baseURL", "https://api.openai.com/v1").String(),
			Model:    g.Cfg().MustGet(ctx, "llm.openai.model", "gpt-image-2").String(),
		}
	case "gemini", "gemini-3.1-flash-image", "banana", "nano-banana", "gemini-2.5-flash-image":
		return &ModelConfig{
			Name:     "gemini",
			Provider: "gemini",
			APIKey:   getKey("GEMINI_API_KEY", "llm.gemini.apiKey"),
			BaseURL:  g.Cfg().MustGet(ctx, "llm.gemini.baseURL", "https://generativelanguage.googleapis.com/v1beta").String(),
			Model:    g.Cfg().MustGet(ctx, "llm.gemini.model", "gemini-3.1-flash-image").String(),
		}
	}
	return nil
}

// NewGenerator 根据模型别名创建适配器
func NewGenerator(ctx context.Context, alias string) (ImageGenerator, error) {
	if strings.HasPrefix(strings.ToLower(strings.TrimSpace(alias)), "comfyui") {
		cfg, err := resolveComfyUIConfig(ctx, alias)
		if err != nil {
			return nil, err
		}
		return newGeneratorFromConfig(cfg)
	}
	cfg, err := loadModelConfig(ctx, alias)
	if err != nil {
		return nil, err
	}
	return newGeneratorFromConfig(cfg)
}

// NewGeneratorFromClientConfig 创建仅用于当前请求的模型适配器。
// 配置来自浏览器，必须完整校验；函数不会把配置写入任何全局状态或持久化存储。
func NewGeneratorFromClientConfig(cfg *ModelConfig) (ImageGenerator, error) {
	if cfg == nil {
		return nil, fmt.Errorf("个人模型配置不能为空")
	}

	clean := &ModelConfig{
		Name:           "browser-custom",
		Provider:       strings.ToLower(strings.TrimSpace(cfg.Provider)),
		APIKey:         strings.TrimSpace(cfg.APIKey),
		BaseURL:        strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/"),
		Model:          strings.TrimSpace(cfg.Model),
		ClientProvided: true,
	}
	if err := validateClientModelConfig(clean); err != nil {
		return nil, err
	}
	return newGeneratorFromConfig(clean)
}

func newModelHTTPClient(restrictPrivateNetwork bool) *http.Client {
	client := &http.Client{Timeout: 180 * time.Second}
	if !restrictPrivateNetwork {
		return client
	}

	dialer := &net.Dialer{Timeout: 30 * time.Second, KeepAlive: 30 * time.Second}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	// 用户可控 URL 不走系统代理，避免代理代为访问内网地址而绕过下面的目标 IP 校验。
	transport.Proxy = nil
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, fmt.Errorf("模型服务地址无效")
		}
		ips, err := net.DefaultResolver.LookupIP(ctx, "ip", host)
		if err != nil || len(ips) == 0 {
			return nil, fmt.Errorf("模型服务域名解析失败")
		}
		foundPublic := false
		for _, ip := range ips {
			if isForbiddenClientIP(ip) {
				continue
			}
			foundPublic = true
			conn, dialErr := dialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
			if dialErr == nil {
				return conn, nil
			}
		}
		if !foundPublic {
			return nil, fmt.Errorf("模型服务地址不允许访问")
		}
		return nil, fmt.Errorf("无法连接模型服务")
	}
	client.Transport = transport
	return client
}

func isForbiddenClientIP(ip net.IP) bool {
	return !ip.IsGlobalUnicast() || ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast()
}

func newGeneratorFromConfig(cfg *ModelConfig) (ImageGenerator, error) {

	switch strings.ToLower(cfg.Provider) {
	case "doubao", "ark", "volc", "volcengine", "huoshan":
		// 火山方舟（豆包 Seedream）：复用 /images/generations 路径但请求体为火山自定义格式
		return NewDoubao(cfg), nil
	case "openai", "qwen", "wanx", "zhipu", "siliconflow", "openai-compatible":
		// 所有 OpenAI Images 兼容协议（GPT-Image、通义万相、智谱等）走同一适配器
		return NewOpenAIImages(cfg), nil
	case "gemini", "google":
		return NewGemini(cfg), nil
	case "comfyui":
		return NewComfyUI(cfg), nil
	default:
		return nil, fmt.Errorf("unsupported provider: %s (supported: openai, doubao, gemini, comfyui)", cfg.Provider)
	}
}

func validateClientModelConfig(cfg *ModelConfig) error {
	if cfg.Provider != "openai" && cfg.Provider != "doubao" && cfg.Provider != "gemini" {
		return fmt.Errorf("不支持的协议类型")
	}
	if cfg.APIKey == "" || len(cfg.APIKey) > 4096 {
		return fmt.Errorf("API Key 不能为空或过长")
	}
	if cfg.Model == "" || len(cfg.Model) > 200 || strings.ContainsAny(cfg.Model, "\r\n\t ?#%\\") {
		return fmt.Errorf("模型名不能为空或格式不正确")
	}
	if cfg.BaseURL == "" || len(cfg.BaseURL) > 2048 {
		return fmt.Errorf("Base URL 不能为空或过长")
	}

	u, err := url.Parse(cfg.BaseURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" {
		return fmt.Errorf("Base URL 必须是有效的 HTTP/HTTPS 地址")
	}
	if u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return fmt.Errorf("Base URL 不能包含账号、查询参数或片段")
	}

	host := strings.ToLower(strings.TrimSuffix(u.Hostname(), "."))
	if host == "localhost" || strings.HasSuffix(host, ".localhost") {
		return fmt.Errorf("Base URL 不允许指向本机地址")
	}
	if ip := net.ParseIP(host); ip != nil && (ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast()) {
		return fmt.Errorf("Base URL 不允许指向内网或保留地址")
	}
	return nil
}

// getKey 优先取环境变量，其次取配置文件
func getKey(envName, cfgPath string) string {
	if v := lookupEnv(envName); v != "" {
		return v
	}
	return g.Cfg().MustGet(context.Background(), cfgPath).String()
}

// lookupEnv 兼容多个环境变量名（大小写不敏感地查找首个非空值）
func lookupEnv(names ...string) string {
	for _, n := range names {
		if n == "" {
			continue
		}
		if v := osGetenv(n); v != "" {
			return v
		}
	}
	return ""
}
