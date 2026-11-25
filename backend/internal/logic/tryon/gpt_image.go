package tryon

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

// OpenAIImages OpenAI Images API 兼容适配器。
// 覆盖 GPT-Image-1、豆包（火山方舟）、通义万相、智谱 CogView、硅基流动等
// 所有走 POST {baseURL}/images/generations 协议的服务商。
type OpenAIImages struct {
	apiKey  string
	baseURL string
	model   string
	name    string
	client  *http.Client
}

// NewOpenAIImages 从配置创建适配器
func NewOpenAIImages(cfg *ModelConfig) *OpenAIImages {
	return &OpenAIImages{
		apiKey:  cfg.APIKey,
		baseURL: strings.TrimRight(cfg.BaseURL, "/"),
		model:   cfg.Model,
		name:    cfg.Name,
		client:  newModelHTTPClient(cfg.ClientProvided),
	}
}

func (o *OpenAIImages) Name() string { return o.name }

// gptImageRequest 图片生成请求体。
// 同时兼容两种协议：
//   - prompt + image[]（火山方舟 / 多数 OpenAI 兼容中转站的多图生图格式，换装必须用这个）
//   - input 数组（OpenAI 官方 gpt-image 格式，作为兜底）
type gptImageRequest struct {
	Model   string          `json:"model"`
	Prompt  string          `json:"prompt,omitempty"`
	Image   []string        `json:"image,omitempty"`
	Input   []gptImageInput `json:"input,omitempty"`
	Size    string          `json:"size,omitempty"`
	Quality string          `json:"quality,omitempty"`
	N       int             `json:"n,omitempty"`
}

type gptImageInput struct {
	Role    string            `json:"role"`
	Content []gptImageContent `json:"content"`
}

type gptImageContent struct {
	Type     string    `json:"type"`
	Text     string    `json:"text,omitempty"`
	ImageURL *imageURL `json:"image_url,omitempty"`
}

type imageURL struct {
	URL string `json:"url"`
}

// gptImageResponse OpenAI Images API 响应
type gptImageResponse struct {
	Data  []gptImageData `json:"data"`
	Error *gptAPIError   `json:"error,omitempty"`
}

type gptImageData struct {
	B64JSON string `json:"b64_json"`
	URL     string `json:"url"`
}

type gptAPIError struct {
	Message string `json:"message"`
	Type    string `json:"type"`
	Code    string `json:"code"`
}

type chatVisionRequest struct {
	Model     string          `json:"model"`
	Messages  []chatVisionMsg `json:"messages"`
	MaxTokens int             `json:"max_tokens,omitempty"`
}

type chatVisionMsg struct {
	Role    string              `json:"role"`
	Content []chatVisionContent `json:"content"`
}

type chatVisionContent struct {
	Type     string        `json:"type"`
	Text     string        `json:"text,omitempty"`
	ImageURL *chatImageURL `json:"image_url,omitempty"`
}

type chatImageURL struct {
	URL string `json:"url"`
}

type chatVisionResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	Error *gptAPIError `json:"error,omitempty"`
}

// describeVisualFeatures 调用中转站/OpenAI 的轻量视觉模型提取人像与服装精确特征
func (o *OpenAIImages) describeVisualFeatures(ctx context.Context, personB64, garmentB64 string) string {
	visionModel := "gemini-3.5-flash-lite"
	if strings.Contains(o.baseURL, "api.openai.com") {
		visionModel = "gpt-4o-mini"
	}

	reqBody := chatVisionRequest{
		Model: visionModel,
		Messages: []chatVisionMsg{
			{
				Role: "user",
				Content: []chatVisionContent{
					{
						Type: "text",
						Text: "Describe Image 1 (the person: adult East Asian/ethnicity, age, hair style and color, facial features, gentle expression) and Image 2 (the exact clothing outfit: every single garment item, colors, patterns, materials, cut, shoes, accessories). Return a concise 2-sentence visual description for a fashion catalog image generator.",
					},
					{
						Type: "image_url",
						ImageURL: &chatImageURL{
							URL: providerReferenceURL(personB64),
						},
					},
					{
						Type: "image_url",
						ImageURL: &chatImageURL{
							URL: providerReferenceURL(garmentB64),
						},
					},
				},
			},
		},
		MaxTokens: 300,
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return ""
	}

	// 限制视觉分析最长 8 秒，避免长时间等待
	vCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(vCtx, "POST", o.baseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return ""
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+o.apiKey)

	resp, err := o.client.Do(req)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return ""
	}

	var res chatVisionResponse
	if err := json.NewDecoder(resp.Body).Decode(&res); err != nil {
		return ""
	}
	if len(res.Choices) > 0 {
		return strings.TrimSpace(res.Choices[0].Message.Content)
	}
	return ""
}

func (o *OpenAIImages) Generate(ctx context.Context, personB64, garmentB64, prompt, size string) (string, error) {
	if o.apiKey == "" {
		return "", fmt.Errorf("模型 %s 未配置 API Key", o.name)
	}

	// 针对 GPT-Image 系列：由于 OpenAI / 中转站生图接口会静默忽略 image[] 传参，
	// 此处先通过极速视觉分析提取人像神态与服装精确单品特征，再透传给 GPT-Image-2，
	// 确保衣服款式 100% 对齐、人脸神貌高度匹配。
	isGPT := strings.Contains(strings.ToLower(o.model), "gpt-image") || strings.Contains(strings.ToLower(o.name), "gpt-image")
	if isGPT {
		if visualDesc := o.describeVisualFeatures(ctx, personB64, garmentB64); visualDesc != "" {
			if strings.HasPrefix(prompt, portraitPromptPrefix) {
				prompt += "\nReference appearance and outfit details: " + visualDesc
			} else {
				prompt = fmt.Sprintf("Full-body commercial fashion catalog photograph:\n%s\nStrict requirements:\n1. The adult female model from Image 1 is wearing the complete outfit from Image 2 faithfully.\n2. Fully clothed, modest neckline, standard comfortable fit, elegant posture.\n3. Clean daylight studio, neutral minimal background, photorealistic 8k, crisp fabric textures.\nOutput: ONLY the final dressed-up photograph.", visualDesc)
			}
		}
	}

	// 换装场景需要「人像 + 服装」两张参考图。
	// 绝大多数 OpenAI 兼容中转站（含用户的中转站 cpa.paipiange.com）对 gpt-image-2 走
	// 火山方舟式多图生图协议：prompt 必填 + image[] 传参考图，返回 b64_json。
	// 这里统一用 prompt + image[]，对官方 OpenAI 协议则由后端中转站自行兼容。
	reqBody := gptImageRequest{
		Model:  o.model,
		Prompt: prompt,
		Image: []string{
			providerReferenceURL(personB64),
			providerReferenceURL(garmentB64),
		},
		Size:    normalizeOpenAISize(size),
		Quality: "high",
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", o.baseURL+"/images/generations", bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("模型服务请求创建失败")
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+o.apiKey)

	resp, err := o.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("无法连接模型服务")
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("图像 API 错误 (status %d): %s", resp.StatusCode, truncate(string(respBody), 500))
	}

	var result gptImageResponse
	if err := json.Unmarshal(respBody, &result); err != nil {
		return "", err
	}
	if result.Error != nil {
		return "", fmt.Errorf("图像 API 错误: %s", result.Error.Message)
	}
	if len(result.Data) == 0 {
		return "", fmt.Errorf("图像 API 未返回图片")
	}
	// 优先 b64_json，其次 url（部分服务商返回 URL）
	if result.Data[0].B64JSON != "" {
		return result.Data[0].B64JSON, nil
	}
	if result.Data[0].URL != "" {
		return o.downloadImage(ctx, result.Data[0].URL)
	}
	return "", fmt.Errorf("图像 API 返回格式无法解析")
}

// downloadImage 下载 URL 图片并转 base64（部分服务商只返回 URL）
func (o *OpenAIImages) downloadImage(ctx context.Context, url string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return "", fmt.Errorf("结果图片地址无效")
	}
	resp, err := o.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("无法下载模型结果图片")
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(data), nil
}

// providerReferenceParts preserves the MIME of a validated reference. Older
// code calling a provider with raw base64 continues to get the PNG default.
func providerReferenceParts(s string) (mime, data string) {
	data = ensureBase64(s)
	header, _, _ := strings.Cut(s, ",")
	switch header {
	case "data:image/jpeg;base64":
		return "image/jpeg", data
	case "data:image/webp;base64":
		return "image/webp", data
	default:
		return "image/png", data
	}
}

func providerReferenceURL(s string) string {
	mime, data := providerReferenceParts(s)
	return "data:" + mime + ";base64," + data
}

// ensureBase64 兼容：如果传入的是 data URL，去掉前缀
func ensureBase64(s string) string {
	if len(s) > 22 && s[:5] == "data:" {
		if idx := bytes.IndexByte([]byte(s), ','); idx >= 0 {
			return s[idx+1:]
		}
	}
	return s
}

// decodeB64 辅助：校验 base64 合法性
func decodeB64(s string) error {
	s = ensureBase64(s)
	_, err := base64.StdEncoding.DecodeString(s)
	return err
}

// truncate 截断字符串，避免错误信息过长
func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}

// normalizeOpenAISize 归一化尺寸。换装默认竖版 1024x1536（2:3）。
// GPT-Image 支持 1024x1024 / 1536x1024 / 1024x1536 / auto。
func normalizeOpenAISize(size string) string {
	switch size {
	case "1024x1024", "1536x1024", "1024x1536", "auto":
		return size
	case "", "1024x1792", "1792x1024":
		return "1024x1536"
	default:
		return "1024x1536"
	}
}

// osGetenv 读取环境变量
func osGetenv(name string) string { return os.Getenv(name) }

// encodeB64 字节转标准 base64
func encodeB64(data []byte) string { return base64.StdEncoding.EncodeToString(data) }
