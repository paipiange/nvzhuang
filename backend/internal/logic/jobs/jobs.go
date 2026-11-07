package jobs

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"backend/internal/imagevalidate"
	"backend/internal/logic/catalog"
	"backend/internal/logic/tryon"
)

type TryonJob struct {
	ID              string `json:"id"`
	Status          string `json:"status"` // queued | processing | success | failed
	Progress        int    `json:"progress"`
	ResultURL       string `json:"result_url,omitempty"`
	GarmentID       string `json:"garment_id"`
	GarmentImageURL string `json:"garment_image_url,omitempty"`
	PersonFileID    string `json:"person_file_id,omitempty"`
	PortraitID      string `json:"portrait_id,omitempty"`
	PersonImageURL  string `json:"person_image_url,omitempty"`
	ModelKey        string `json:"model_key"`
	Size            string `json:"size"`
	KeepFace        bool   `json:"keep_face"`
	CreatedAt       string `json:"created_at"`
	ErrorMessage    string `json:"error_message,omitempty"`
}

type UploadedFile struct {
	Data      []byte
	MIMEType  string
	CreatedAt time.Time
}

var (
	jobsMutex    sync.RWMutex
	jobsStore    = make(map[string]*TryonJob)
	uploadsMutex sync.RWMutex
	uploadsStore = make(map[string]*UploadedFile)
	httpClient   = &http.Client{Timeout: 12 * time.Second}
)

func generateID(prefix string) string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return fmt.Sprintf("%s_%d_%s", prefix, time.Now().Unix(), hex.EncodeToString(b))
}

// SaveUploadedFile 保存临时上传的图片文件
func SaveUploadedFile(data []byte, mimeType string) (string, error) {
	if len(data) == 0 {
		return "", errors.New("上传文件内容为空")
	}
	if len(data) > 10*1024*1024 {
		return "", errors.New("上传文件超过 10MB 大小限制")
	}

	id := generateID("file")
	uploadsMutex.Lock()
	defer uploadsMutex.Unlock()

	// 清理超过 2 小时的临时上传
	now := time.Now()
	for k, v := range uploadsStore {
		if now.Sub(v.CreatedAt) > 2*time.Hour {
			delete(uploadsStore, k)
		}
	}

	uploadsStore[id] = &UploadedFile{
		Data:      data,
		MIMEType:  mimeType,
		CreatedAt: now,
	}

	return id, nil
}

// GetUploadedFile 获取上传的临时图片
func GetUploadedFile(id string) ([]byte, string, bool) {
	uploadsMutex.RLock()
	defer uploadsMutex.RUnlock()
	f, ok := uploadsStore[id]
	if !ok {
		return nil, "", false
	}
	return f.Data, f.MIMEType, true
}

// CreateJob 创建新的换装任务
func CreateJob(
	garmentID string,
	garmentImgURL string,
	personFileID string,
	portraitID string,
	personImgURL string,
	modelKey string,
	size string,
	keepFace bool,
) *TryonJob {
	if modelKey == "" {
		modelKey = "gemini"
	}
	if size == "" {
		size = "1024x1536"
	}

	job := &TryonJob{
		ID:              generateID("job"),
		Status:          "queued",
		Progress:        10,
		GarmentID:       garmentID,
		GarmentImageURL: garmentImgURL,
		PersonFileID:    personFileID,
		PortraitID:      portraitID,
		PersonImageURL:  personImgURL,
		ModelKey:        modelKey,
		Size:            size,
		KeepFace:        keepFace,
		CreatedAt:       time.Now().Format(time.RFC3339),
	}

	jobsMutex.Lock()
	// 控制内存最多存储 500 个任务
	if len(jobsStore) > 500 {
		for k := range jobsStore {
			delete(jobsStore, k)
			break
		}
	}
	jobsStore[job.ID] = job
	jobsMutex.Unlock()

	return job
}

// GetJob 查询任务状态
func GetJob(id string) (*TryonJob, bool) {
	jobsMutex.RLock()
	defer jobsMutex.RUnlock()
	j, ok := jobsStore[id]
	return j, ok
}

func readLocalAssetIfExists(input string) ([]byte, bool) {
	candidates := []string{input, filepath.Join("..", input)}
	if u, err := url.Parse(input); err == nil && (u.Scheme == "http" || u.Scheme == "https") {
		cleanPath := strings.TrimPrefix(u.Path, "/nvzhuang/")
		cleanPath = strings.TrimPrefix(cleanPath, "/")
		cleanNoAssets := strings.TrimPrefix(cleanPath, "assets/")
		cleanNoAssets = strings.TrimPrefix(cleanNoAssets, "/")
		candidates = append(candidates,
			filepath.Join("assets", cleanNoAssets),
			filepath.Join("..", "assets", cleanNoAssets),
			cleanPath,
			filepath.Join("..", cleanPath),
		)
	}
	for _, p := range candidates {
		if fi, err := os.Stat(p); err == nil && !fi.IsDir() {
			data, err := os.ReadFile(p)
			if err == nil && len(data) > 0 {
				return data, true
			}
		}
	}
	return nil, false
}

// fetchOrDecodeBase64 将远程 URL、本地资源、临时文件或 Base64 统一解析为 Raw Base64
func fetchOrDecodeBase64(ctx context.Context, input string) (string, error) {
	input = strings.TrimSpace(input)
	if input == "" {
		return "", errors.New("图片地址或内容不能为空")
	}

	// 1. 如果是 Data URL
	if strings.HasPrefix(input, "data:image/") {
		idx := strings.Index(input, ",")
		if idx > 0 {
			return input[idx+1:], nil
		}
	}

	// 2. 检查本地是否存在对应素材，优先本地极速读取
	if localData, ok := readLocalAssetIfExists(input); ok {
		return base64.StdEncoding.EncodeToString(localData), nil
	}

	// 3. 如果是 HTTP/HTTPS 远程资源
	if strings.HasPrefix(input, "http://") || strings.HasPrefix(input, "https://") {
		req, err := http.NewRequestWithContext(ctx, "GET", input, nil)
		if err != nil {
			return "", fmt.Errorf("构造请求失败: %w", err)
		}
		resp, err := httpClient.Do(req)
		if err != nil {
			return "", fmt.Errorf("拉取素材失败: %w", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			return "", fmt.Errorf("拉取素材 HTTP 状态码异常: %d", resp.StatusCode)
		}

		bodyBytes, err := io.ReadAll(io.LimitReader(resp.Body, 10*1024*1024))
		if err != nil {
			return "", fmt.Errorf("读取素材内容失败: %w", err)
		}
		return base64.StdEncoding.EncodeToString(bodyBytes), nil
	}

	// 4. 假定为原始 Base64 字符串
	return input, nil
}

// ExecuteJob 同步执行换装任务（在后台或协程中调度）
func ExecuteJob(ctx context.Context, job *TryonJob, clientConfig *tryon.ModelConfig) {
	jobsMutex.Lock()
	job.Status = "processing"
	job.Progress = 35
	jobsMutex.Unlock()

	// 1. 解析人像图片 Base64
	var personB64 string
	if job.PersonFileID != "" {
		fileData, _, ok := GetUploadedFile(job.PersonFileID)
		if !ok {
			failJob(job, "上传的人像临时文件已失效，请重新选择")
			return
		}
		personB64 = base64.StdEncoding.EncodeToString(fileData)
	} else if job.PortraitID != "" {
		p, ok := catalog.GetModelByID(ctx, job.PortraitID)
		if ok && p.ImageURL != "" {
			b64, err := fetchOrDecodeBase64(ctx, p.ImageURL)
			if err != nil {
				failJob(job, fmt.Sprintf("加载模特图片失败: %v", err))
				return
			}
			personB64 = b64
		} else if job.PersonImageURL != "" {
			b64, err := fetchOrDecodeBase64(ctx, job.PersonImageURL)
			if err != nil {
				failJob(job, fmt.Sprintf("加载人像图片失败: %v", err))
				return
			}
			personB64 = b64
		} else {
			failJob(job, "未找到指定模特人像数据")
			return
		}
	} else if job.PersonImageURL != "" {
		b64, err := fetchOrDecodeBase64(ctx, job.PersonImageURL)
		if err != nil {
			failJob(job, fmt.Sprintf("加载人像图片失败: %v", err))
			return
		}
		personB64 = b64
	} else {
		failJob(job, "缺少有效的人像素材")
		return
	}

	// 2. 解析服装图片 Base64
	var garmentB64 string
	if job.GarmentID != "" {
		g, ok := catalog.GetGarmentByID(ctx, job.GarmentID)
		if ok && g.ImageURL != "" {
			b64, err := fetchOrDecodeBase64(ctx, g.ImageURL)
			if err != nil {
				failJob(job, fmt.Sprintf("加载服装款式图片失败: %v", err))
				return
			}
			garmentB64 = b64
		} else if job.GarmentImageURL != "" {
			b64, err := fetchOrDecodeBase64(ctx, job.GarmentImageURL)
			if err != nil {
				failJob(job, fmt.Sprintf("加载服装款式图片失败: %v", err))
				return
			}
			garmentB64 = b64
		} else {
			failJob(job, "未找到指定服装款式")
			return
		}
	} else if job.GarmentImageURL != "" {
		b64, err := fetchOrDecodeBase64(ctx, job.GarmentImageURL)
		if err != nil {
			failJob(job, fmt.Sprintf("加载服装款式图片失败: %v", err))
			return
		}
		garmentB64 = b64
	} else {
		failJob(job, "缺少有效的服装素材")
		return
	}

	jobsMutex.Lock()
	job.Progress = 60
	jobsMutex.Unlock()

	// 3. 校验图片合法性
	imgLimits := imagevalidate.LoadImageLimits(ctx)
	personImg, garmentImg, imgErr := imagevalidate.ValidateImagesPair(personB64, garmentB64, imgLimits)
	if imgErr != nil {
		failJob(job, fmt.Sprintf("图片校验未通过: %v", imgErr))
		return
	}

	// 4. 调用底层换装生成
	resultB64, _, _, err := tryon.DoTryonWithValidatedImages(
		ctx,
		personImg,
		garmentImg,
		job.ModelKey,
		job.Size,
		"zh",
		clientConfig,
	)
	if err != nil {
		failJob(job, fmt.Sprintf("换装生成失败: %v", err))
		return
	}

	mimeType, err := tryon.DetectGeneratedImageMIME(resultB64)
	if err != nil {
		mimeType = "image/png"
	}

	jobsMutex.Lock()
	job.Status = "success"
	job.Progress = 100
	job.ResultURL = fmt.Sprintf("data:%s;base64,%s", mimeType, resultB64)
	jobsMutex.Unlock()
}

func failJob(job *TryonJob, reason string) {
	jobsMutex.Lock()
	defer jobsMutex.Unlock()
	job.Status = "failed"
	job.ErrorMessage = reason
	job.Progress = 0
}

type ModelOption struct {
	Key         string `json:"key"`
	Name        string `json:"name"`
	Icon        string `json:"icon"`
	Description string `json:"description"`
	Badge       string `json:"badge,omitempty"`
	Enabled     bool   `json:"enabled"`
}

// AvailableModelOptions 返回后端支持的预置模型清单
func AvailableModelOptions(ctx context.Context) []ModelOption {
	return []ModelOption{
		{
			Key:         "gemini",
			Name:        "Gemini",
			Icon:        "✦",
			Description: "Nano Banana 2 · 稳定推荐",
			Badge:       "推荐",
			Enabled:     true,
		},
		{
			Key:         "doubao",
			Name:        "豆包",
			Icon:        "◕",
			Description: "火山方舟文生图 · 速度快",
			Enabled:     true,
		},
		{
			Key:         "gpt-image",
			Name:        "GPT Image",
			Icon:        "✧",
			Description: "OpenAI 图像系列 · 细节丰富",
			Enabled:     true,
		},
		{
			Key:         "comfyui",
			Name:        "ComfyUI",
			Icon:        "◇",
			Description: "自建本地工作流 · 高可控",
			Badge:       "本地",
			Enabled:     true,
		},
	}
}
