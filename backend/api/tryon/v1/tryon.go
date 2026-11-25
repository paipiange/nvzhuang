package v1

import "github.com/gogf/gf/v2/frame/g"

// TryonReq 换装请求
type TryonReq struct {
	g.Meta `path:"/tryon" method:"post" tags:"换装" summary:"AI换装图生成"`
	// 人像照片（全身/半身站立照，base64 或 上传文件）
	PersonImage string `json:"person_image" v:"required" dc:"人像照片，base64编码"`
	// 服装图（base64）
	GarmentImage string `json:"garment_image" v:"required" dc:"服装图，base64编码"`
	// 模型选择：gemini / gpt-image / doubao（可在后端 config.yaml 的 llm.models 中扩展），默认 gemini
	Model string `json:"model" d:"gemini" dc:"模型别名：gemini / gpt-image / doubao（可在 config.yaml 扩展）"`
	// 生成尺寸：1024x1024 / 1024x1536 / 1536x1024
	Size string `json:"size" d:"1024x1536" dc:"输出尺寸"`
	// 是否保留人物面部（保持同一个人）
	KeepFace bool `json:"keep_face" d:"true" dc:"是否保持人物面部一致"`
	// 语言：zh / en
	Lang string `json:"lang" d:"zh" dc:"提示词语言"`
	// 未指定时保留普通换装流程；指定时仅接受固定的写真姿势 ID。
	PoseID *string `json:"pose_id,omitempty" dc:"写真姿势：natural / wave / heart / peace / sitting / profile"`
	// 浏览器端自定义模型配置。仅用于当前请求，后端不得持久化或记录其中的 Key/Base URL。
	ClientConfig *ClientModelConfig `json:"client_config,omitempty" dc:"当前请求临时使用的用户模型配置"`
	// 云端模型可能产生费用；客户端必须对每次云端生成显式确认。本地 ComfyUI 不要求。
	CostAcknowledged bool `json:"cost_acknowledged" dc:"已确认本次云端生成可能消耗模型额度"`
}

// ClientModelConfig 用户在浏览器设置中心保存的模型配置。
// 该结构只在一次请求的内存中使用，不写入配置文件、数据库或日志。
type ClientModelConfig struct {
	Provider string `json:"provider" v:"in:openai,doubao,gemini" dc:"协议类型：openai / doubao / gemini"`
	BaseURL  string `json:"base_url" dc:"模型服务 Base URL"`
	APIKey   string `json:"api_key" dc:"模型服务 API Key（敏感，仅本次请求使用）"`
	Model    string `json:"model" dc:"模型服务侧真实模型名"`
}

// TryonRes 换装响应
type TryonRes struct {
	// 生成的换装结果图（base64）
	Image string `json:"image" dc:"换装结果图，base64"`
	// 结果图片的真实 MIME 类型（根据文件签名字节检测）
	MIME string `json:"mime" dc:"结果图片 MIME 类型"`
	// 使用的模型
	Model string `json:"model" dc:"实际使用的模型"`
	// 提示词（调试用，可空）
	Prompt string `json:"prompt,omitempty" dc:"实际使用的提示词"`
}

type ComfyUIHealthReq struct {
	g.Meta `path:"/comfyui/health" method:"get" tags:"换装" summary:"检查本地 ComfyUI 固定工作流"`
}

type ComfyUIHealthRes struct {
	Available bool   `json:"available"`
	Model     string `json:"model,omitempty"`
	Message   string `json:"message"`
}

type ProviderHealthReq struct {
	g.Meta `path:"/providers/health" method:"get" tags:"换装" summary:"无生成检查图片模型配置与连通性"`
}

type ProviderHealthItem struct {
	Alias      string `json:"alias"`
	Provider   string `json:"provider"`
	Model      string `json:"model,omitempty"`
	Local      bool   `json:"local"`
	Configured bool   `json:"configured"`
	Reachable  bool   `json:"reachable"`
	Message    string `json:"message"`
}

type ProviderHealthRes struct {
	GenerationRequestMade bool                 `json:"generation_request_made"`
	Providers             []ProviderHealthItem `json:"providers"`
}
