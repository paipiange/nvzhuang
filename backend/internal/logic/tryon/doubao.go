package tryon

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// Doubao 火山方舟（豆包 Seedream）图像生成适配器。
// 注意：豆包虽复用 /images/generations 路径，但请求体是火山自定义格式：
//   - prompt + image[]（多图生图，做换装用）
//   - 返回 data[].url（不是 b64_json）
type Doubao struct {
	apiKey  string
	baseURL string
	model   string
	name    string
	client  *http.Client
}

func NewDoubao(cfg *ModelConfig) *Doubao {
	return &Doubao{
		apiKey:  cfg.APIKey,
		baseURL: strings.TrimRight(cfg.BaseURL, "/"),
		model:   cfg.Model,
		name:    cfg.Name,
		client:  newModelHTTPClient(cfg.ClientProvided),
	}
}

func (d *Doubao) Name() string {
	if d.name == "" {
		return "doubao"
	}
	return d.name
}

// doubaoRequest 豆包图片生成请求体（多图生图）
type doubaoRequest struct {
	Model          string   `json:"model"`
	Prompt         string   `json:"prompt"`
	Image          []string `json:"image,omitempty"`           // 参考图 URL（多图生图）
	Size           string   `json:"size,omitempty"`            // 如 "2048x2048" / "1024x1536"
	ResponseFormat string   `json:"response_format,omitempty"` // url / b64_json
	Watermark      bool     `json:"watermark,omitempty"`
}

// doubaoResponse 豆包图片生成响应
type doubaoResponse struct {
	Data  []doubaoData `json:"data"`
	Error *struct {
		Message string `json:"message"`
		Code    string `json:"code"`
	} `json:"error,omitempty"`
}

type doubaoData struct {
	URL     string `json:"url"`
	B64JSON string `json:"b64_json"`
}

func (d *Doubao) Generate(ctx context.Context, personB64, garmentB64, prompt, size string) (string, error) {
	if d.apiKey == "" {
		return "", fmt.Errorf("豆包 API Key 未配置（llm.models.%s.apiKey 或环境变量 ARK_API_KEY）", d.name)
	}

	// 豆包多图生图用 data URL 传参考图
	reqBody := doubaoRequest{
		Model:  d.model,
		Prompt: prompt,
		Image: []string{
			providerReferenceURL(personB64),
			providerReferenceURL(garmentB64),
		},
		Size:           normalizeDoubaoSize(size),
		ResponseFormat: "url",
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", d.baseURL+"/images/generations", bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("模型服务请求创建失败")
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+d.apiKey)

	resp, err := d.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("无法连接模型服务")
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("豆包 API 错误 (status %d): %s", resp.StatusCode, truncate(string(respBody), 500))
	}

	var result doubaoResponse
	if err := json.Unmarshal(respBody, &result); err != nil {
		return "", err
	}
	if result.Error != nil {
		return "", fmt.Errorf("豆包 API 错误: %s", result.Error.Message)
	}
	if len(result.Data) == 0 {
		return "", fmt.Errorf("豆包 API 未返回图片")
	}

	// 优先 b64，其次下载 url
	if result.Data[0].B64JSON != "" {
		return result.Data[0].B64JSON, nil
	}
	if result.Data[0].URL != "" {
		return d.downloadImage(ctx, result.Data[0].URL)
	}
	return "", fmt.Errorf("豆包 API 返回格式无法解析")
}

// downloadImage 下载 URL 图片并转 base64
func (d *Doubao) downloadImage(ctx context.Context, url string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return "", fmt.Errorf("结果图片地址无效")
	}
	resp, err := d.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("无法下载模型结果图片")
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	return encodeB64(data), nil
}

// normalizeDoubaoSize 把 OpenAI 风格的尺寸转成豆包支持的像素格式
// 豆包 Seedream 支持 "2048x2048"、"1024x1536"、"1536x1024" 等；OpenAI 用 "1024x1024" 等
func normalizeDoubaoSize(size string) string {
	switch size {
	case "", "auto", "1024x1024", "1024x1792", "1792x1024":
		// 换装默认用竖版半身/全身：1024x1536（2:3）
		return "1024x1536"
	case "1024x1536", "1536x1024", "2048x2048", "2048x3072", "3072x2048", "4096x4096":
		return size
	default:
		return "1024x1536"
	}
}
