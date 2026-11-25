package voice

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/gogf/gf/v2/frame/g"
	"github.com/gogf/gf/v2/net/ghttp"
	"github.com/gorilla/websocket"

	"backend/internal/logic/todos"
	voicelogic "backend/internal/logic/voice"
	"backend/internal/middleware"
)

type Controller struct{}

func New() *Controller { return &Controller{} }
func (c *Controller) RegisterRoutes(group *ghttp.RouterGroup) {
	group.Group("/api/v1", func(v1 *ghttp.RouterGroup) {
		v1.GET("/voice/status", c.Status)
		v1.GET("/voice/tasks", c.Tasks)
		v1.POST("/voice/tasks/:action", c.StartTask)
		v1.GET("/voice/ws", c.WebSocket)
		v1.GET("/companions/voice/ws", c.WebSocket)
		v1.GET("/voice/todos", c.Todos)
		v1.PUT("/voice/todos/:id", c.ToggleTodo)
	})
}
func (c *Controller) WebSocket(r *ghttp.Request) {
	ws, err := r.WebSocket()
	if err != nil {
		return
	}
	defer ws.Close()
	serveConnection(r.Context(), ws.Conn)
}

func serveConnection(ctx context.Context, ws *websocket.Conn) {
	ws.SetReadLimit(2 * 1024 * 1024)
	var writeMu sync.Mutex
	var audio []byte
	var audioRejected bool
	var turnID string
	inputCodec := "mp3"
	var cancel context.CancelFunc
	var session voicelogic.Session
	var generation uint64
	var sessionStarted bool
	var selectedProfile voicelogic.VoiceProfile
	invalidate := func(reset bool) uint64 {
		writeMu.Lock()
		defer writeMu.Unlock()
		if reset {
			generation = session.Reset()
		} else {
			generation = session.Begin()
		}
		if cancel != nil {
			cancel()
			cancel = nil
		}
		return generation
	}
	defer invalidate(true)
	write := func(messageType int, payload []byte) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		_ = ws.SetWriteDeadline(time.Now().Add(10 * time.Second))
		return ws.WriteMessage(messageType, payload)
	}
	emit := func(activeGeneration uint64, id string, value any) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		if activeGeneration != generation {
			return context.Canceled
		}
		_ = ws.SetWriteDeadline(time.Now().Add(10 * time.Second))
		if item, ok := value.(voicelogic.AudioWAV); ok {
			return ws.WriteMessage(websocket.BinaryMessage, item.Data)
		}
		if event, ok := value.(voicelogic.ServerEvent); ok {
			event.TurnID = id
			value = event
		}
		payload, err := json.Marshal(value)
		if err != nil {
			return err
		}
		return ws.WriteMessage(websocket.TextMessage, payload)
	}
	for {
		messageType, payload, readErr := ws.ReadMessage()
		if readErr != nil {
			if cancel != nil {
				cancel()
			}
			return
		}
		if messageType == websocket.BinaryMessage {
			if !sessionStarted {
				_ = emitError(write, "", "session_not_started", "请先建立本地语音会话")
				continue
			}
			if audioRejected {
				continue
			}
			invalidate(false)
			if len(audio)+len(payload) > 2*1024*1024 {
				audio = nil
				audioRejected = true
				_ = emitError(write, turnID, "audio_too_large", "单轮录音不能超过约 64 秒")
				continue
			}
			audio = append(audio, payload...)
			continue
		}
		if messageType != websocket.TextMessage || len(payload) > 12*1024 {
			_ = emitError(write, turnID, "invalid_message", "只接受不超过 12 KiB 的 JSON 控制消息和文字消息")
			continue
		}
		var event struct {
			Type        string `json:"type"`
			Provider    string `json:"provider"`
			TurnID      string `json:"turn_id"`
			InputRate   int    `json:"input_rate"`
			OutputRate  int    `json:"output_rate"`
			Streaming   bool   `json:"streaming"`
			Codec       string `json:"codec"`
			Text        string `json:"text"`
			ApiKey      string `json:"api_key"`
			CharacterID string `json:"character_id"`
			PersonaID   string `json:"persona_id"`
			VoiceID     string `json:"voice_id"`
		}
		if json.Unmarshal(payload, &event) != nil {
			_ = emitError(write, turnID, "invalid_json", "控制消息格式错误")
			continue
		}
		if event.Type == "session.start" && event.Streaming && event.Provider != "seeduplex" {
			_ = emitError(write, "", "unsupported_streaming", "当前 provider 不支持持续 PCM 通话")
			continue
		}
		var requestedProfile voicelogic.VoiceProfile
		if event.Type == "session.start" {
			var err error
			requestedProfile, err = voicelogic.SelectVoiceProfile(event.Provider, event.CharacterID, event.PersonaID, event.VoiceID)
			if err != nil {
				code := "unsupported_character"
				var protocolErr *voicelogic.VoiceProtocolError
				if errors.As(err, &protocolErr) {
					code = protocolErr.Code
				}
				_ = emitError(write, "", code, err.Error())
				continue
			}
		}
		if event.Type == "session.start" && event.Provider == "open-llm-vtuber" {
			if event.InputRate != 16000 || (event.Codec != "mp3" && event.Codec != "pcm_s16le") {
				_ = emitError(write, turnID, "unsupported_audio", "仅支持 16kHz 单声道 MP3 或 PCM")
				continue
			}
			invalidate(true)
			if err := voicelogic.HandleOpenLLMVTuber(ctx, ws, &writeMu, event.Codec); err != nil && !errors.Is(err, context.Canceled) {
				_ = emitError(write, event.TurnID, "open_llm_vtuber_unavailable", err.Error())
			}
			return
		}
		if event.Type == "session.start" && event.Provider == "seeduplex" {
			if event.InputRate != 16000 || (event.Codec != "mp3" && event.Codec != "pcm_s16le") || (event.Streaming && (event.Codec != "pcm_s16le" || (event.OutputRate != 0 && event.OutputRate != 24000))) {
				_ = emitError(write, "", "unsupported_audio", "持续通话仅支持 16kHz 输入、24kHz 输出的单声道 PCM16LE；按轮模式另支持 MP3")
				continue
			}
			invalidate(true)
			if err := voicelogic.HandleSeedDuplex(ctx, ws, &writeMu, map[string]any{"codec": event.Codec, "api_key": event.ApiKey, "streaming": event.Streaming, "character_id": event.CharacterID, "persona_id": event.PersonaID, "voice_id": event.VoiceID}); err != nil && !errors.Is(err, context.Canceled) {
				_ = emitError(write, "", "seeduplex_unavailable", err.Error())
			}
			return
		}
		switch event.Type {
		case "session.start":
			if event.InputRate != 16000 || (event.Codec != "mp3" && event.Codec != "pcm_s16le") {
				_ = emitError(write, turnID, "unsupported_audio", "仅支持 16kHz 单声道 MP3 或 PCM")
				continue
			}
			invalidate(true)
			inputCodec = event.Codec
			selectedProfile = requestedProfile
			audio = nil
			audioRejected = false
			turnID = event.TurnID
			sessionStarted = true
			if len(turnID) > 64 {
				turnID = ""
			}
			_ = write(websocket.TextMessage, marshalEvent(voicelogic.ServerEvent{Type: "session.ready", Provider: "local", CharacterID: selectedProfile.CharacterID, PersonaID: selectedProfile.PersonaID, VoiceID: selectedProfile.VoiceID}))
		case "session.reset":
			invalidate(true)
			audio = nil
			audioRejected = false
			turnID = ""
			_ = write(websocket.TextMessage, marshalEvent(voicelogic.ServerEvent{Type: "session.reset"}))
		case "text.input":
			if !sessionStarted {
				_ = emitError(write, turnID, "session_not_started", "请先建立本地语音会话")
				continue
			}
			if utf8.RuneCountInString(event.Text) > 2000 {
				_ = emitError(write, turnID, "text_too_large", "单条文字不能超过 2000 字")
				continue
			}
			if len(event.TurnID) > 64 {
				_ = emitError(write, turnID, "invalid_turn_id", "对话回合标识过长")
				continue
			}
			turnID = event.TurnID
			if turnID == "" {
				turnID = fmt.Sprintf("turn-%d", time.Now().UnixNano())
			}
			audio = nil
			audioRejected = false
			activeGeneration := invalidate(false)
			activeID := turnID
			turnCtx, turnCancel := context.WithCancel(voicelogic.WithVoiceProfile(ctx, selectedProfile))
			cancel = turnCancel
			go func() {
				err := session.ProcessText(turnCtx, activeGeneration, event.Text, func(value any) error { return emit(activeGeneration, activeID, value) })
				if err != nil && !errors.Is(err, context.Canceled) {
					_ = emit(activeGeneration, activeID, voicelogic.ServerEvent{Type: "error", Code: "voice_pipeline_failed", Message: err.Error()})
				}
				_ = emit(activeGeneration, activeID, voicelogic.ServerEvent{Type: "turn.end"})
				turnCancel()
			}()
		case "input.end":
			if !sessionStarted {
				_ = emitError(write, "", "session_not_started", "请先建立本地语音会话")
				continue
			}
			if audioRejected {
				audio = nil
				audioRejected = false
				_ = emitError(write, event.TurnID, "audio_too_large", "本轮录音已超限，请重新录音")
				continue
			}
			if len(audio) == 0 {
				_ = emitError(write, turnID, "empty_audio", "没有录音数据")
				continue
			}
			if len(event.TurnID) > 64 {
				audio = nil
				_ = emitError(write, "", "invalid_turn_id", "对话回合标识过长")
				continue
			}
			if event.TurnID != "" {
				turnID = event.TurnID
			}
			if turnID == "" {
				turnID = fmt.Sprintf("turn-%d", time.Now().UnixNano())
			}
			activeGeneration := invalidate(false)
			activeID := turnID
			activeCodec := inputCodec
			activeAudio := append([]byte(nil), audio...)
			audio = nil
			turnCtx, turnCancel := context.WithCancel(voicelogic.WithVoiceProfile(ctx, selectedProfile))
			cancel = turnCancel
			_ = write(websocket.TextMessage, marshalEvent(voicelogic.ServerEvent{Type: "asr.processing", TurnID: activeID}))
			go func() {
				err := session.Process(turnCtx, activeGeneration, activeAudio, activeCodec, func(value any) error { return emit(activeGeneration, activeID, value) })
				if err != nil && !errors.Is(err, context.Canceled) {
					_ = emit(activeGeneration, activeID, voicelogic.ServerEvent{Type: "error", Code: "voice_pipeline_failed", Message: err.Error()})
				}
				_ = emit(activeGeneration, activeID, voicelogic.ServerEvent{Type: "turn.end"})
				turnCancel()
			}()
		case "playback.interrupted", "assistant.cancel":
			invalidate(false)
			_ = write(websocket.TextMessage, marshalEvent(voicelogic.ServerEvent{Type: "assistant.cancel", TurnID: turnID}))
			audio = nil
			audioRejected = false
		case "input.cancel":
			invalidate(false)
			audio = nil
			audioRejected = false
		default:
			_ = emitError(write, turnID, "unknown_event", "不支持的语音控制消息")
		}
	}
}

func emitError(write func(int, []byte) error, turnID, code, message string) error {
	return write(websocket.TextMessage, marshalEvent(voicelogic.ServerEvent{Type: "error", TurnID: turnID, Code: code, Message: message}))
}

func marshalEvent(event voicelogic.ServerEvent) []byte {
	payload, _ := json.Marshal(event)
	return payload
}

func (c *Controller) Tasks(r *ghttp.Request) {
	r.Response.WriteJson(g.Map{"code": 0, "message": "ok", "data": voicelogic.TaskStatusSnapshot(), "request_id": middleware.GetRequestID(r)})
}

func (c *Controller) StartTask(r *ghttp.Request) {
	action := r.Get("action").String()
	if !voicelogic.StartTask(action) {
		r.Response.WriteHeader(409)
		r.Response.WriteJson(g.Map{"code": 409, "message": "不支持的任务，或该任务正在运行"})
		return
	}
	r.Response.WriteJson(g.Map{"code": 0, "message": "ok", "data": voicelogic.TaskStatusSnapshot(), "request_id": middleware.GetRequestID(r)})
}

func (c *Controller) Status(r *ghttp.Request) {
	r.Response.WriteJson(g.Map{"code": 0, "message": "ok", "data": voicelogic.LocalStatus(r.Context()), "request_id": middleware.GetRequestID(r)})
}
func (c *Controller) Todos(r *ghttp.Request) {
	summary, err := todos.SummaryFor(r.Context())
	if err != nil {
		r.Response.WriteHeader(500)
		r.Response.WriteJson(g.Map{"code": 500, "message": "无法读取待办记录，请检查数据库或本机待办文件"})
		return
	}
	r.Response.WriteJson(g.Map{"code": 0, "message": "ok", "data": summary, "request_id": middleware.GetRequestID(r)})
}
func (c *Controller) ToggleTodo(r *ghttp.Request) {
	id, err := strconv.ParseInt(r.Get("id").String(), 10, 64)
	if err != nil {
		r.Response.WriteHeader(400)
		r.Response.WriteJson(g.Map{"code": 400, "message": "TODO id 无效"})
		return
	}
	var payload struct {
		Completed *bool `json:"completed"`
	}
	if err := r.Parse(&payload); err != nil || payload.Completed == nil {
		r.Response.WriteHeader(400)
		r.Response.WriteJson(g.Map{"code": 400, "message": "completed 必须是布尔值"})
		return
	}
	summary, ok, err := todos.SetCompleted(r.Context(), id, *payload.Completed)
	if err != nil {
		r.Response.WriteHeader(500)
		r.Response.WriteJson(g.Map{"code": 500, "message": "待办保存失败，请检查数据库连接或本机数据目录写入权限"})
		return
	}
	if !ok {
		r.Response.WriteHeader(404)
		r.Response.WriteJson(g.Map{"code": 404, "message": "未找到 TODO"})
		return
	}
	r.Response.WriteJson(g.Map{"code": 0, "message": "ok", "data": summary, "request_id": middleware.GetRequestID(r)})
}
