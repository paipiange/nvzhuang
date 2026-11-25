package voice

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/gogf/gf/v2/frame/g"
	"github.com/gorilla/websocket"
)

type Component struct {
	Name      string `json:"name"`
	URL       string `json:"url"`
	Available bool   `json:"available"`
	Message   string `json:"message,omitempty"`
}
type Model struct {
	Name         string   `json:"name"`
	Path         string   `json:"path"`
	Exists       bool     `json:"exists"`
	Size         int64    `json:"size"`
	Progress     int      `json:"progress"`
	Message      string   `json:"message,omitempty"`
	MissingFiles []string `json:"missing_files,omitempty"`
}
type Status struct {
	Components       []Component `json:"components"`
	Models           []Model     `json:"models"`
	Downloading      bool        `json:"downloading"`
	DownloadProgress int         `json:"download_progress"`
	Message          string      `json:"message"`
}

var cosyRequired = []string{
	"cosyvoice3.yaml", "llm.pt", "flow.pt", "hift.pt", "campplus.onnx", "speech_tokenizer_v3.onnx",
	"CosyVoice-BlankEN/config.json", "CosyVoice-BlankEN/tokenizer_config.json", "CosyVoice-BlankEN/vocab.json", "CosyVoice-BlankEN/merges.txt", "CosyVoice-BlankEN/model.safetensors",
}
var funasrRequired = []string{
	"damo/speech_fsmn_vad_zh-cn-16k-common-onnx/model_quant.onnx",
	"damo/speech_fsmn_vad_zh-cn-16k-common-onnx/config.yaml",
	"damo/speech_fsmn_vad_zh-cn-16k-common-onnx/am.mvn",
	"damo/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-onnx/model_quant.onnx",
	"damo/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-onnx/config.yaml",
	"damo/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-onnx/tokens.json",
	"damo/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-onnx/am.mvn",
	"damo/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-online-onnx/model_quant.onnx",
	"damo/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-online-onnx/decoder_quant.onnx",
	"damo/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-online-onnx/config.yaml",
	"damo/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-online-onnx/tokens.json",
	"damo/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-online-onnx/am.mvn",
	"damo/punc_ct-transformer_zh-cn-common-vad_realtime-vocab272727-onnx/model_quant.onnx",
	"damo/punc_ct-transformer_zh-cn-common-vad_realtime-vocab272727-onnx/config.yaml",
	"damo/punc_ct-transformer_zh-cn-common-vad_realtime-vocab272727-onnx/tokens.json",
	"damo/speech_ngram_lm_zh-cn-ai-wesp-fst/TLG.fst",
	"damo/speech_ngram_lm_zh-cn-ai-wesp-fst/config.yaml",
	"damo/speech_ngram_lm_zh-cn-ai-wesp-fst/lexicon.txt",
	"thuduj12/fst_itn_zh/zh_itn_tagger.fst", "thuduj12/fst_itn_zh/zh_itn_verbalizer.fst",
}

func LocalStatus(ctx context.Context) Status {
	root := "D:/ai/ai/nvzhuang"
	if configured, err := g.Cfg().Get(ctx, "voice.root"); err == nil && !configured.IsEmpty() {
		root = configured.String()
	}
	qwen := qwenModel(filepath.Join(root, "models/qwen", qwenFile))
	funasr := requiredModel("FunASR Paraformer", filepath.Join(root, "models/funasr"), "models/funasr", funasrRequired)
	cosy := requiredModel("CosyVoice 3", filepath.Join(root, "models/cosyvoice3/Fun-CosyVoice3-0.5B"), "models/cosyvoice3/Fun-CosyVoice3-0.5B", cosyRequired)
	return Status{
		Components: []Component{component("Qwen LLM", "http://127.0.0.1:8080/health"), component("FunASR", "ws://127.0.0.1:10096"), component("CosyVoice TTS", "http://127.0.0.1:50000/health")},
		Models:     []Model{qwen, funasr, cosy}, DownloadProgress: (qwen.Progress + funasr.Progress + cosy.Progress) / 3,
		Message: "仅检查配置指定的关键文件、GGUF 基础头部和本机服务；未执行密码学哈希或完整权重校验。",
	}
}

func requiredModel(name, root, display string, required []string) Model {
	m := Model{Name: name, Path: display}
	for _, rel := range required {
		info, err := os.Stat(filepath.Join(root, filepath.FromSlash(rel)))
		if err != nil || !info.Mode().IsRegular() || info.Size() == 0 {
			m.MissingFiles = append(m.MissingFiles, rel)
			continue
		}
		m.Size += info.Size()
	}
	m.Progress = (len(required) - len(m.MissingFiles)) * 100 / len(required)
	m.Exists = len(m.MissingFiles) == 0
	if m.Exists {
		m.Message = "关键文件齐备；未执行哈希或权重内容校验"
	} else {
		m.Message = "关键文件缺失或为空，请补全模型下载"
	}
	return m
}

const (
	qwenFile         = "Qwen_Qwen3-4B-Instruct-2507-Q4_K_M.gguf"
	qwenExpectedSize = 2497280736 // Expected byte length for this fixed download version.
)

func qwenModel(path string) Model {
	m := Model{Name: "Qwen3 4B GGUF", Path: "models/qwen/" + qwenFile, Message: "GGUF 缺失、大小不符或头部无效。若已存在，请先移走异常文件再重新下载。"}
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Size() == 0 {
		m.MissingFiles = []string{qwenFile}
		return m
	}
	m.Size = info.Size()
	if m.Size != qwenExpectedSize {
		return m
	}
	file, err := os.Open(path)
	if err != nil {
		return m
	}
	defer file.Close()
	if !validGGUFHeader(file) {
		return m
	}
	m.Exists, m.Progress, m.Message = true, 100, "固定版本 GGUF 基础头部与长度有效。未执行哈希或完整权重校验。"
	return m
}

func validGGUFHeader(file io.Reader) bool {
	var header [24]byte
	if _, err := io.ReadFull(file, header[:]); err != nil {
		return false
	}
	version := binary.LittleEndian.Uint32(header[4:8])
	return string(header[:4]) == "GGUF" && (version == 2 || version == 3) && binary.LittleEndian.Uint64(header[8:16]) > 0 && binary.LittleEndian.Uint64(header[16:24]) > 0
}

func component(name, address string) Component {
	c := Component{Name: name, URL: address}
	c.Available, c.Message = componentHealth(address)
	return c
}

func componentHealth(address string) (bool, string) {
	ctx, cancel := context.WithTimeout(context.Background(), 800*time.Millisecond)
	defer cancel()
	if address == "ws://127.0.0.1:10096" {
		conn, _, err := (&websocket.Dialer{HandshakeTimeout: 800 * time.Millisecond}).DialContext(ctx, address, nil)
		if err != nil {
			return false, "未启动或连接超时，请检查 FunASR 服务与端口"
		}
		_ = conn.Close()
		return true, "WebSocket 握手正常"
	}
	if address != "http://127.0.0.1:8080/health" && address != "http://127.0.0.1:50000/health" {
		return false, "不支持的服务地址"
	}
	return httpHealth(ctx, address, address == "http://127.0.0.1:50000/health")
}

func httpHealth(ctx context.Context, address string, tts bool) (bool, string) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, address, nil)
	if err != nil {
		return false, "服务检查失败"
	}
	client := &http.Client{Timeout: 800 * time.Millisecond, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := client.Do(req)
	if err != nil {
		return false, "未启动或健康检查超时，请检查服务进程与端口"
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusServiceUnavailable {
		return false, "模型加载中或服务未就绪，请稍后重试并检查服务日志"
	}
	if resp.StatusCode != http.StatusOK {
		return false, "健康接口异常，请检查服务日志及端口是否被占用"
	}
	var payload struct {
		Status     string `json:"status"`
		SampleRate int    `json:"sample_rate"`
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4097))
	if err != nil || len(body) > 4096 || json.Unmarshal(body, &payload) != nil || payload.Status != "ok" || (tts && payload.SampleRate != 24000) {
		return false, "健康响应无效，请检查服务版本及端口是否被其他程序占用"
	}
	return true, "服务已就绪"
}
