package voice

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gogf/gf/v2/frame/g"
	"github.com/gorilla/websocket"
)

const openLLMVTuberMaxOutput = 32 * 1024 * 1024

func openLLMVTuberURL(ctx context.Context) (string, error) {
	address := os.Getenv("OPEN_LLM_VTUBER_WS_URL")
	if address == "" {
		address = g.Cfg().MustGet(ctx, "voice.open_llm_vtuber_ws_url", "ws://127.0.0.1:12393/client-ws").String()
	}
	return validateOpenLLMVTuberURL(address)
}

func validateOpenLLMVTuberURL(address string) (string, error) {
	u, err := url.Parse(address)
	invalid := errors.New("Open-LLM-VTuber 地址无效，仅允许无认证及查询参数的本机 ws/wss 地址")
	if err != nil || u == nil || (u.Scheme != "ws" && u.Scheme != "wss") || u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || strings.Contains(address, "#") || u.Opaque != "" {
		return "", invalid
	}
	switch strings.ToLower(u.Hostname()) {
	case "localhost", "127.0.0.1", "::1":
	default:
		return "", invalid
	}
	if strings.HasSuffix(u.Host, ":") {
		return "", invalid
	}
	if port := u.Port(); port != "" {
		n, err := strconv.Atoi(port)
		if err != nil || n < 1 || n > 65535 {
			return "", invalid
		}
	}
	return u.String(), nil
}

// HandleOpenLLMVTuber owns client reads until the session ends. Input is 16kHz mono;
// output contains one merged WAV per turn and cumulative assistant text.
func HandleOpenLLMVTuber(ctx context.Context, client *websocket.Conn, writeMu *sync.Mutex, codec string) error {
	if codec != "pcm_s16le" && codec != "mp3" {
		return errors.New("Open-LLM-VTuber 不支持的音频格式")
	}
	address, err := openLLMVTuberURL(ctx)
	if err != nil {
		return err
	}
	// Do not use environment proxies or forward client headers/credentials.
	upstream, response, err := (&websocket.Dialer{HandshakeTimeout: 5 * time.Second}).DialContext(ctx, address, nil)
	if response != nil && response.Body != nil {
		_ = response.Body.Close()
	}
	if err != nil {
		return errors.New("Open-LLM-VTuber 连接失败，请检查本机服务")
	}
	sessionCtx, cancel := context.WithCancel(ctx)
	type message struct {
		upstream bool
		kind     int
		data     []byte
		err      error
	}
	incoming := make(chan message, 2)
	var readers sync.WaitGroup
	var deadlineMu sync.Mutex
	read := func(conn *websocket.Conn, fromUpstream bool) {
		defer readers.Done()
		for {
			deadlineMu.Lock()
			if sessionCtx.Err() != nil {
				deadlineMu.Unlock()
				return
			}
			_ = conn.SetReadDeadline(time.Now().Add(2 * time.Minute))
			deadlineMu.Unlock()
			kind, data, err := conn.ReadMessage()
			select {
			case incoming <- message{fromUpstream, kind, data, err}:
			case <-sessionCtx.Done():
				return
			}
			if err != nil {
				return
			}
		}
	}
	client.SetReadLimit(maxUtteranceBytes)
	upstream.SetReadLimit(int64(base64.StdEncoding.EncodedLen(openLLMVTuberMaxOutput) + 64*1024))
	readers.Add(2)
	go read(client, false)
	go read(upstream, true)
	defer func() {
		cancel()
		_ = upstream.Close()
		// Wake the reader without closing client, so the controller can emit its error.
		deadlineMu.Lock()
		_ = client.SetReadDeadline(time.Now())
		deadlineMu.Unlock()
		readers.Wait()
	}()
	writeUpstream := func(value any) error {
		_ = upstream.SetWriteDeadline(time.Now().Add(10 * time.Second))
		if upstream.WriteJSON(value) != nil {
			return errors.New("Open-LLM-VTuber 发送失败")
		}
		return nil
	}
	writeClient := func(value any) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		_ = client.SetWriteDeadline(time.Now().Add(10 * time.Second))
		if audio, ok := value.(AudioWAV); ok {
			return client.WriteMessage(websocket.BinaryMessage, audio.Data)
		}
		return client.WriteJSON(value)
	}
	if err := writeClient(ServerEvent{Type: "session.ready"}); err != nil {
		return errors.New("语音客户端发送失败")
	}
	var input, wavFormat, audio []byte
	var turnID, text string
	outputBytes := 0
	active, started, finished, interrupted := false, false, false, false
	silentTurn, playbackComplete := false, false
	emit := func(event ServerEvent) error {
		event.TurnID = turnID
		return writeClient(event)
	}
	finish := func() error {
		if !active || finished || interrupted {
			return nil
		}
		finished = true
		silentTurn = len(audio) == 0
		if len(audio) > 0 {
			wav := openLLMVTuberWAV(wavFormat, audio)
			if len(wav) > openLLMVTuberMaxOutput {
				return errors.New("Open-LLM-VTuber 输出音频超过限制")
			}
			if err := emit(ServerEvent{Type: "assistant.audio.start", Codec: "wav", SampleRate: int(binary.LittleEndian.Uint32(wavFormat[4:8])), Channels: int(binary.LittleEndian.Uint16(wavFormat[2:4]))}); err != nil {
				return err
			}
			if err := writeClient(AudioWAV{Data: wav}); err != nil {
				return err
			}
			if err := emit(ServerEvent{Type: "assistant.audio.end"}); err != nil {
				return err
			}
		}
		audio, wavFormat = nil, nil
		return emit(ServerEvent{Type: "turn.end"})
	}
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case msg := <-incoming:
			if msg.err != nil {
				if ctx.Err() != nil {
					return ctx.Err()
				}
				if msg.upstream {
					return errors.New("Open-LLM-VTuber 连接已断开或读取超限")
				}
				return errors.New("语音客户端连接已断开或读取超限")
			}
			if !msg.upstream && msg.kind == websocket.BinaryMessage {
				if len(input)+len(msg.data) > maxUtteranceBytes {
					return errors.New("单轮输入音频超过 2MB 限制")
				}
				input = append(input, msg.data...)
				continue
			}
			if msg.kind != websocket.TextMessage || (!msg.upstream && len(msg.data) > 4096) {
				return errors.New("语音消息格式无效")
			}
			var event struct {
				Type        string `json:"type"`
				Text        string `json:"text"`
				TurnID      string `json:"turn_id"`
				Audio       string `json:"audio"`
				DisplayText *struct {
					Text string `json:"text"`
				} `json:"display_text"`
			}
			if json.Unmarshal(msg.data, &event) != nil {
				return errors.New("语音 JSON 消息无效")
			}
			if !msg.upstream {
				switch event.Type {
				case "input.end":
					pcm, err := normalizeAudio(ctx, input, codec)
					input = nil
					if err != nil {
						return err
					}
					if active && !finished && !interrupted {
						return errors.New("请先结束或打断当前语音回合")
					}
					turnID = event.TurnID
					if turnID == "" || len(turnID) > 64 {
						turnID = randomID()
					}
					text, outputBytes = "", 0
					audio, wavFormat = nil, nil
					active, started, finished, interrupted = true, false, false, false
					silentTurn, playbackComplete = false, false
					if err := emit(ServerEvent{Type: "asr.processing"}); err != nil {
						return err
					}
					for offset := 0; offset < len(pcm); offset += 4096 {
						end := offset + 4096
						if end > len(pcm) {
							end = len(pcm)
						}
						samples := make([]float32, (end-offset)/2)
						for i := range samples {
							samples[i] = float32(int16(binary.LittleEndian.Uint16(pcm[offset+2*i:]))) / 32768
						}
						if err := writeUpstream(map[string]any{"type": "mic-audio-data", "audio": samples}); err != nil {
							return err
						}
					}
					if err := writeUpstream(map[string]string{"type": "mic-audio-end"}); err != nil {
						return err
					}
				case "playback.interrupted", "assistant.cancel":
					input, audio, wavFormat = nil, nil, nil
					interrupted = true
					if err := writeUpstream(map[string]string{"type": "interrupt-signal", "text": ""}); err != nil {
						return err
					}
					if err := emit(ServerEvent{Type: "assistant.cancel"}); err != nil {
						return err
					}
				case "input.cancel":
					input = nil
				case "playback.complete":
					if finished && !interrupted && !playbackComplete && event.TurnID == turnID {
						playbackComplete = true
						if err := writeUpstream(map[string]string{"type": "frontend-playback-complete"}); err != nil {
							return err
						}
					}
				}
				continue
			}
			switch event.Type {
			case "error":
				return errors.New("Open-LLM-VTuber 返回错误")
			case "control":
				if event.Text == "conversation-chain-start" && active && !interrupted && !finished {
					started = true
				}
				if event.Text == "conversation-chain-end" && started {
					if err := finish(); err != nil {
						return err
					}
				}
			case "backend-synth-complete":
				if !started || interrupted {
					continue
				}
				// Current upstream sends this twice before waiting for playback completion.
				if err := finish(); err != nil {
					return err
				}
				// A short/silent reply may finish before upstream starts waiting after its second marker.
				if silentTurn || playbackComplete {
					if err := writeUpstream(map[string]string{"type": "frontend-playback-complete"}); err != nil {
						return err
					}
				}
			case "user-input-transcription":
				if started && !finished && !interrupted {
					outputBytes += len(event.Text)
					if outputBytes > openLLMVTuberMaxOutput {
						return errors.New("Open-LLM-VTuber 输出超过限制")
					}
					if err := emit(ServerEvent{Type: "asr.final", Text: event.Text}); err != nil {
						return err
					}
				}
			case "audio":
				if !started || finished || interrupted {
					continue
				}
				outputBytes += base64.StdEncoding.DecodedLen(len(event.Audio))
				if event.DisplayText != nil {
					outputBytes += len(event.DisplayText.Text)
				}
				if outputBytes > openLLMVTuberMaxOutput {
					return errors.New("Open-LLM-VTuber 输出超过 32MB 限制")
				}
				if event.Audio != "" {
					wav, err := base64.StdEncoding.DecodeString(event.Audio)
					if err != nil {
						return errors.New("Open-LLM-VTuber 音频编码无效")
					}
					format, data, err := parseOpenLLMVTuberWAV(wav)
					if err != nil {
						return err
					}
					if wavFormat != nil && !bytes.Equal(wavFormat, format) {
						return errors.New("Open-LLM-VTuber 同轮 WAV 格式不一致")
					}
					wavFormat = append(wavFormat[:0], format...)
					audio = append(audio, data...)
				}
				if event.DisplayText != nil && event.DisplayText.Text != "" {
					text += event.DisplayText.Text
					if err := emit(ServerEvent{Type: "assistant.text.delta", Text: text}); err != nil {
						return err
					}
				}
			}
		}
	}
}

func parseOpenLLMVTuberWAV(wav []byte) ([]byte, []byte, error) {
	invalid := errors.New("Open-LLM-VTuber WAV 音频无效")
	if len(wav) < 12 || string(wav[:4]) != "RIFF" || string(wav[8:12]) != "WAVE" || uint64(binary.LittleEndian.Uint32(wav[4:8]))+8 != uint64(len(wav)) {
		return nil, nil, invalid
	}
	var format, data []byte
	for offset := 12; offset < len(wav); {
		if len(wav)-offset < 8 {
			return nil, nil, invalid
		}
		n := uint64(binary.LittleEndian.Uint32(wav[offset+4 : offset+8]))
		end := uint64(offset) + 8 + n
		if end+(n&1) > uint64(len(wav)) {
			return nil, nil, invalid
		}
		switch string(wav[offset : offset+4]) {
		case "fmt ":
			if format != nil {
				return nil, nil, invalid
			}
			format = wav[offset+8 : int(end)]
		case "data":
			if data != nil {
				return nil, nil, invalid
			}
			data = wav[offset+8 : int(end)]
		}
		offset = int(end + (n & 1))
	}
	if len(format) < 16 || len(data) == 0 {
		return nil, nil, invalid
	}
	encoding, channels := binary.LittleEndian.Uint16(format), binary.LittleEndian.Uint16(format[2:])
	rate, byteRate := binary.LittleEndian.Uint32(format[4:]), binary.LittleEndian.Uint32(format[8:])
	align, bits := binary.LittleEndian.Uint16(format[12:]), binary.LittleEndian.Uint16(format[14:])
	if (encoding != 1 && encoding != 3) || channels == 0 || channels > 8 || rate == 0 || rate > 384000 || bits == 0 || bits%8 != 0 || bits > 64 || (encoding == 3 && bits != 32 && bits != 64) || align != channels*(bits/8) || byteRate != rate*uint32(align) || len(data)%int(align) != 0 {
		return nil, nil, invalid
	}
	return format, data, nil
}

func openLLMVTuberWAV(format, audio []byte) []byte {
	dataOffset := 20 + len(format) + len(format)%2
	wav := make([]byte, dataOffset+8+len(audio)+len(audio)%2)
	copy(wav, "RIFF")
	binary.LittleEndian.PutUint32(wav[4:], uint32(len(wav)-8))
	copy(wav[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(wav[16:], uint32(len(format)))
	copy(wav[20:], format)
	copy(wav[dataOffset:], "data")
	binary.LittleEndian.PutUint32(wav[dataOffset+4:], uint32(len(audio)))
	copy(wav[dataOffset+8:], audio)
	return wav
}
