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

// Gemini Google Gemini 图像生成适配器
type Gemini struct {
	apiKey  string
	baseURL string
	model   string
	name    string
	client  *http.Client
}

// NewGemini 从配置创建适配器
func NewGemini(cfg *ModelConfig) *Gemini {
	return &Gemini{
		apiKey:  cfg.APIKey,
		baseURL: strings.TrimRight(cfg.BaseURL, "/"),
		model:   cfg.Model,
		name:    cfg.Name,
		client:  newModelHTTPClient(cfg.ClientProvided),
	}
}

func (g *Gemini) Name() string {
	if g.name == "" {
		return "gemini"
	}
	return g.name
}

// geminiRequest Gemini generateContent 请求体
type geminiRequest struct {
	Contents         []geminiContent  `json:"contents"`
	GenerationConfig *geminiGenConfig `json:"generationConfig,omitempty"`
}

type geminiContent struct {
	Role  string       `json:"role,omitempty"`
	Parts []geminiPart `json:"parts"`
}

type geminiPart struct {
	Text       string            `json:"text,omitempty"`
	InlineData *geminiInlineData `json:"inlineData,omitempty"`
}

type geminiInlineData struct {
	MimeType string `json:"mimeType"`
	Data     string `json:"data"`
}

type geminiGenConfig struct {
	ResponseModalities []string `json:"responseModalities,omitempty"`
}

type geminiResponse struct {
	Candidates []geminiCandidate `json:"candidates"`
	Error      *geminiError      `json:"error,omitempty"`
}

type geminiCandidate struct {
	Content geminiContent `json:"content"`
}

type geminiError struct {
	Message string `json:"message"`
	Code    int    `json:"code"`
}

func (g *Gemini) Generate(ctx context.Context, personB64, garmentB64, prompt, size string) (string, error) {
	if g.apiKey == "" {
		return "", fmt.Errorf("Gemini API key not configured")
	}

	personMIME, person := providerReferenceParts(personB64)
	garmentMIME, garment := providerReferenceParts(garmentB64)
	reqBody := geminiRequest{
		Contents: []geminiContent{
			{
				Role: "user",
				Parts: []geminiPart{
					{Text: prompt},
					{InlineData: &geminiInlineData{MimeType: personMIME, Data: person}},
					{InlineData: &geminiInlineData{MimeType: garmentMIME, Data: garment}},
				},
			},
		},
		GenerationConfig: &geminiGenConfig{
			ResponseModalities: []string{"TEXT", "IMAGE"},
		},
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return "", err
	}

	url := fmt.Sprintf("%s/models/%s:generateContent", g.baseURL, g.model)
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("模型服务请求创建失败")
	}
	req.Header.Set("Content-Type", "application/json")
	// Key 放在请求头，避免出现在 URL、代理访问日志或网络错误文本中。
	req.Header.Set("x-goog-api-key", g.apiKey)

	resp, err := g.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("无法连接模型服务")
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("Gemini API error (status %d): %s", resp.StatusCode, truncate(string(respBody), 500))
	}

	var result geminiResponse
	if err := json.Unmarshal(respBody, &result); err != nil {
		return "", err
	}
	if result.Error != nil {
		return "", fmt.Errorf("Gemini API error: %s", result.Error.Message)
	}

	// 从候选内容中提取图片（inline_data）
	for _, cand := range result.Candidates {
		for _, part := range cand.Content.Parts {
			if part.InlineData != nil && part.InlineData.Data != "" {
				return part.InlineData.Data, nil
			}
		}
	}
	return "", fmt.Errorf("Gemini returned no image in response")
}
