package mobile

import (
	"io"
	"strings"

	"github.com/gogf/gf/v2/frame/g"
	"github.com/gogf/gf/v2/net/ghttp"

	"backend/internal/logic/catalog"
	"backend/internal/logic/jobs"
	"backend/internal/logic/tryon"
	"backend/internal/middleware"
)

type Controller struct{}

func New() *Controller {
	return &Controller{}
}

// RegisterRoutes 注册移动端 /api/v1 路由组
func (c *Controller) RegisterRoutes(group *ghttp.RouterGroup) {
	group.Group("/api/v1", func(v1 *ghttp.RouterGroup) {
		v1.GET("/catalog/categories", c.GetCategories)
		v1.GET("/garments", c.GetGarments)
		v1.GET("/garments/:id", c.GetGarmentDetail)
		v1.GET("/models", c.GetModels)
		v1.GET("/tryon/options", c.GetTryonOptions)
		v1.POST("/uploads", c.UploadImage)
		v1.POST("/tryon/jobs", c.CreateTryonJob)
		v1.GET("/tryon/jobs/:id", c.GetTryonJob)
		v1.DELETE("/tryon/history/:id", c.DeleteTryonHistory)
	})
}

func (c *Controller) GetCategories(r *ghttp.Request) {
	ctx := r.Context()
	cats := catalog.GetCategories(ctx)
	r.Response.WriteJson(g.Map{
		"code":       0,
		"message":    "ok",
		"data":       cats,
		"request_id": middleware.GetRequestID(r),
	})
}

func (c *Controller) GetGarments(r *ghttp.Request) {
	ctx := r.Context()
	library := r.GetQuery("library").String()
	category := r.GetQuery("category").String()
	q := r.GetQuery("q").String()
	page := r.GetQuery("page", 1).Int()
	pageSize := r.GetQuery("page_size", 20).Int()

	result := catalog.GetGarments(ctx, library, category, q, page, pageSize)
	r.Response.WriteJson(g.Map{
		"code":       0,
		"message":    "ok",
		"data":       result,
		"request_id": middleware.GetRequestID(r),
	})
}

func (c *Controller) GetGarmentDetail(r *ghttp.Request) {
	ctx := r.Context()
	id := r.Get("id").String()
	if id == "" {
		id = r.GetQuery("id").String()
	}

	garment, ok := catalog.GetGarmentByID(ctx, id)
	if !ok {
		r.Response.WriteHeader(404)
		r.Response.WriteJson(g.Map{
			"code":       404,
			"message":    "未找到该服装款式",
			"request_id": middleware.GetRequestID(r),
		})
		return
	}

	r.Response.WriteJson(g.Map{
		"code":       0,
		"message":    "ok",
		"data":       garment,
		"request_id": middleware.GetRequestID(r),
	})
}

func (c *Controller) GetModels(r *ghttp.Request) {
	ctx := r.Context()
	hairstyle := r.GetQuery("hairstyle").String()
	page := r.GetQuery("page", 1).Int()
	pageSize := r.GetQuery("page_size", 20).Int()

	result := catalog.GetModels(ctx, hairstyle, page, pageSize)
	r.Response.WriteJson(g.Map{
		"code":       0,
		"message":    "ok",
		"data":       result,
		"request_id": middleware.GetRequestID(r),
	})
}

func (c *Controller) GetTryonOptions(r *ghttp.Request) {
	ctx := r.Context()
	options := jobs.AvailableModelOptions(ctx)
	r.Response.WriteJson(g.Map{
		"code":       0,
		"message":    "ok",
		"data":       options,
		"request_id": middleware.GetRequestID(r),
	})
}

func (c *Controller) UploadImage(r *ghttp.Request) {
	uploadFile := r.GetUploadFile("file")
	if uploadFile == nil {
		uploadFile = r.GetUploadFile("image")
	}

	var data []byte
	var mimeType string

	if uploadFile != nil {
		file, err := uploadFile.Open()
		if err != nil {
			r.Response.WriteHeader(400)
			r.Response.WriteJson(g.Map{"code": 400, "message": "无法打开上传的文件"})
			return
		}
		defer file.Close()

		data, err = io.ReadAll(file)
		if err != nil {
			r.Response.WriteHeader(400)
			r.Response.WriteJson(g.Map{"code": 400, "message": "读取上传文件失败"})
			return
		}
		mimeType = uploadFile.Header.Get("Content-Type")
	} else {
		// 备用：从 JSON 请求体读取
		type JsonUploadReq struct {
			Data     string `json:"data"`
			MIMEType string `json:"mime_type"`
		}
		var req JsonUploadReq
		if err := r.Parse(&req); err == nil && req.Data != "" {
			data = []byte(req.Data)
			mimeType = req.MIMEType
		}
	}

	if len(data) == 0 {
		r.Response.WriteHeader(400)
		r.Response.WriteJson(g.Map{"code": 400, "message": "上传内容为空"})
		return
	}

	if mimeType == "" {
		mimeType = "image/jpeg"
	}

	fileID, err := jobs.SaveUploadedFile(data, mimeType)
	if err != nil {
		r.Response.WriteHeader(400)
		r.Response.WriteJson(g.Map{"code": 400, "message": err.Error()})
		return
	}

	r.Response.WriteJson(g.Map{
		"code":    0,
		"message": "ok",
		"data": g.Map{
			"file_id": fileID,
			"mime":    mimeType,
			"size":    len(data),
		},
		"request_id": middleware.GetRequestID(r),
	})
}

type ClientConfigPayload struct {
	Provider string `json:"provider"`
	APIKey   string `json:"api_key"`
	BaseURL  string `json:"base_url"`
	Model    string `json:"model"`
}

type CreateJobPayload struct {
	GarmentID        string               `json:"garment_id"`
	GarmentImageURL  string               `json:"garment_image_url"`
	PersonFileID     string               `json:"person_file_id"`
	PortraitID       string               `json:"portrait_id"`
	PersonImageURL   string               `json:"person_image_url"`
	ModelKey         string               `json:"model_key"`
	Size             string               `json:"size"`
	KeepFace         bool                 `json:"keep_face"`
	ClientRequestID  string               `json:"client_request_id"`
	ClientConfig     *ClientConfigPayload `json:"client_config"`
}

func (c *Controller) CreateTryonJob(r *ghttp.Request) {
	ctx := r.Context()
	var payload CreateJobPayload
	if err := r.Parse(&payload); err != nil {
		r.Response.WriteHeader(400)
		r.Response.WriteJson(g.Map{
			"code":       400,
			"message":    "请求参数格式错误: " + err.Error(),
			"request_id": middleware.GetRequestID(r),
		})
		return
	}

	if payload.GarmentID == "" && payload.GarmentImageURL == "" {
		r.Response.WriteHeader(400)
		r.Response.WriteJson(g.Map{"code": 400, "message": "服装款式不能为空"})
		return
	}

	if payload.PersonFileID == "" && payload.PortraitID == "" && payload.PersonImageURL == "" {
		r.Response.WriteHeader(400)
		r.Response.WriteJson(g.Map{"code": 400, "message": "模特人像或拍摄照片不能为空"})
		return
	}

	var clientConfig *tryon.ModelConfig
	if payload.ClientConfig != nil && strings.TrimSpace(payload.ClientConfig.APIKey) != "" {
		clientConfig = &tryon.ModelConfig{
			Name:     "client-override",
			Provider: payload.ClientConfig.Provider,
			APIKey:   payload.ClientConfig.APIKey,
			BaseURL:  payload.ClientConfig.BaseURL,
			Model:    payload.ClientConfig.Model,
		}
	}

	job := jobs.CreateJob(
		payload.GarmentID,
		payload.GarmentImageURL,
		payload.PersonFileID,
		payload.PortraitID,
		payload.PersonImageURL,
		payload.ModelKey,
		payload.Size,
		payload.KeepFace,
	)

	// 同步执行任务，保障移动端直接得到结果
	jobs.ExecuteJob(ctx, job, clientConfig)

	if job.Status == "failed" {
		r.Response.WriteHeader(500)
		r.Response.WriteJson(g.Map{
			"code":       500,
			"message":    job.ErrorMessage,
			"data":       job,
			"request_id": middleware.GetRequestID(r),
		})
		return
	}

	r.Response.WriteJson(g.Map{
		"code":       0,
		"message":    "ok",
		"data":       job,
		"request_id": middleware.GetRequestID(r),
	})
}

func (c *Controller) GetTryonJob(r *ghttp.Request) {
	id := r.Get("id").String()
	if id == "" {
		id = r.GetQuery("id").String()
	}

	job, ok := jobs.GetJob(id)
	if !ok {
		r.Response.WriteHeader(404)
		r.Response.WriteJson(g.Map{
			"code":       404,
			"message":    "未找到该换装任务",
			"request_id": middleware.GetRequestID(r),
		})
		return
	}

	r.Response.WriteJson(g.Map{
		"code":       0,
		"message":    "ok",
		"data":       job,
		"request_id": middleware.GetRequestID(r),
	})
}

func (c *Controller) DeleteTryonHistory(r *ghttp.Request) {
	r.Response.WriteJson(g.Map{
		"code":       0,
		"message":    "ok",
		"data":       true,
		"request_id": middleware.GetRequestID(r),
	})
}
