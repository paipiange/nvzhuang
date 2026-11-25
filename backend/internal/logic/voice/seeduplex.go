package voice

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/gogf/gf/v2/frame/g"
	"github.com/gorilla/websocket"
)

const (
	seedEndpoint     = "wss://openspeech.bytedance.com/api/v3/duplex/realtime/dialogue"
	seedFrameBytes   = 640
	seedSegmentBytes = 24000
)

type seedEvent struct {
	Type       string `json:"type"`
	TurnID     string `json:"turn_id"`
	Delta      string `json:"delta"`
	Transcript string `json:"transcript"`
	Text       string `json:"text"`
	Active     *bool  `json:"active,omitempty"`
	ResponseID string `json:"response_id,omitempty"`
	Response   struct {
		ID string `json:"id"`
	} `json:"response,omitempty"`
}

func HandleSeedDuplex(ctx context.Context, client *websocket.Conn, writeMu *sync.Mutex, start map[string]any) error {
	return handleSeedDuplex(ctx, client, writeMu, start, seedEndpoint)
}

func handleSeedDuplex(ctx context.Context, client *websocket.Conn, writeMu *sync.Mutex, start map[string]any, endpoint string) error {
	key, _ := start["api_key"].(string)
	key = strings.TrimSpace(key)
	if key == "" {
		key = seedDuplexAPIKey(ctx)
	}
	if key == "" {
		return errors.New("请填写豆包语音 API Key，或在 .env / config.yaml 中配置 SeedDuplex")
	}
	if len(key) > 2048 || strings.ContainsFunc(key, func(r rune) bool { return r < 33 || r > 126 }) {
		return errors.New("豆包语音 API Key 格式无效")
	}
	ctx, err := profileStart(ctx, start)
	if err != nil {
		return err
	}
	codec, _ := start["codec"].(string)
	if streaming, _ := start["streaming"].(bool); streaming {
		if codec != "pcm_s16le" {
			return errors.New("持续通话仅支持 PCM16LE")
		}
		return runSeedStream(ctx, client, writeMu, endpoint, key)
	}
	return runSeedDuplex(ctx, client, writeMu, codec, endpoint, key)
}

func seedDial(ctx context.Context, endpoint, key string) (*websocket.Conn, error) {
	// The public entry point always uses seedEndpoint. Only in-process tests can select loopback.
	if endpoint != seedEndpoint {
		u, err := url.Parse(endpoint)
		if err != nil || u.Scheme != "ws" || (u.Hostname() != "127.0.0.1" && u.Hostname() != "::1") || u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" {
			return nil, errors.New("豆包语音连接地址无效")
		}
	}
	header := http.Header{"X-Api-Key": {key}}
	conn, response, err := (&websocket.Dialer{HandshakeTimeout: 10 * time.Second, Proxy: http.ProxyFromEnvironment}).DialContext(ctx, endpoint, header)
	if err != nil {
		if response != nil {
			_ = response.Body.Close()
		}
		return nil, errors.New("豆包语音连接失败，请检查权限和网络")
	}
	conn.SetReadLimit(1 << 20)
	return conn, nil
}

func seedSessionCreate(ctx context.Context) map[string]any {
	profile := voiceProfile(ctx)
	voice := profile.Voice
	if voice == "" {
		voice = configuredValue(ctx, "voice.seeduplex.voice", "SEEDUPLEX_VOICE")
		if voice == "" {
			voice = "zh_female_vv_jupiter_bigtts"
		}
	}
	return map[string]any{"type": "session.create", "session": map[string]any{
		"model": "1.2.6.1", "instructions": profile.Instructions,
		"audio": map[string]any{"input": map[string]any{"format": map[string]any{"type": "pcm", "rate": 16000}},
			"output": map[string]any{"format": map[string]any{"type": "pcm_s16le", "rate": 24000}, "voice": voice}},
	}}
}

func seedWrite(conn *websocket.Conn, value any) error {
	_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	return conn.WriteJSON(value)
}

func seedSendAudio(ctx context.Context, conn *websocket.Conn, input []byte, codec string) error {
	pcm, err := normalizeAudio(ctx, input, codec)
	if err != nil {
		return errors.New("豆包录音无效或转码失败")
	}
	if seedWrite(conn, map[string]string{"type": "input_audio_unmute.commit"}) != nil {
		return errors.New("豆包语音发送失败")
	}
	for len(pcm) > 0 {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		var frame [seedFrameBytes]byte
		n := copy(frame[:], pcm)
		pcm = pcm[n:]
		if seedWrite(conn, map[string]string{"type": "input_audio_buffer.append", "audio": base64.StdEncoding.EncodeToString(frame[:])}) != nil {
			return errors.New("豆包语音发送失败")
		}
		// Measure from the actual previous send so a slow write does not cause catch-up bursts.
		timer := time.NewTimer(20 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
	}
	if seedWrite(conn, map[string]string{"type": "input_audio_buffer.commit"}) != nil || seedWrite(conn, map[string]string{"type": "input_audio_mute.commit"}) != nil {
		return errors.New("豆包语音提交失败")
	}
	return nil
}

func runSeedDuplex(parent context.Context, client *websocket.Conn, writeMu *sync.Mutex, codec, endpoint, key string) error {
	ctx, cancel := context.WithCancel(parent)
	stopClient := context.AfterFunc(parent, func() { _ = client.Close() })
	type message struct {
		kind int
		data []byte
	}
	incoming := make(chan message)
	defer func() {
		cancel()
		stopClient()
		if parent.Err() != nil {
			_ = client.Close()
			<-incoming
		}
	}()
	go func() {
		defer close(incoming)
		for {
			kind, data, err := client.ReadMessage()
			if err != nil {
				return
			}
			select {
			case incoming <- message{kind, data}:
			case <-ctx.Done():
				return
			}
		}
	}()
	var upstream *websocket.Conn
	var upstreamEvents <-chan seedEvent
	var stopUpstream context.CancelFunc
	closeUpstream := func() {
		if stopUpstream != nil {
			stopUpstream()
		}
		if upstream != nil {
			_ = upstream.Close()
		}
		upstream, upstreamEvents, stopUpstream = nil, nil, nil
	}
	defer closeUpstream()
	// All connection and turn state belongs to this loop. A replacement connection has a fresh event channel.
	openUpstream := func() error {
		conn, err := seedDial(ctx, endpoint, key)
		if err != nil {
			return err
		}
		upstream = conn
		if seedWrite(conn, seedSessionCreate(ctx)) != nil {
			closeUpstream()
			return errors.New("豆包语音会话创建失败")
		}
		_ = conn.SetReadDeadline(time.Now().Add(10 * time.Second))
		upCtx, stop := context.WithCancel(ctx)
		stopUpstream = stop
		events := make(chan seedEvent)
		upstreamEvents = events
		go func() {
			defer close(events)
			for {
				kind, data, err := conn.ReadMessage()
				if err != nil {
					return
				}
				var event seedEvent
				if kind != websocket.TextMessage || json.Unmarshal(data, &event) != nil || event.Type == "" {
					return
				}
				if event.Type == "session.created" {
					_ = conn.SetReadDeadline(time.Time{})
				}
				select {
				case events <- event:
				case <-upCtx.Done():
					return
				}
			}
		}()
		return nil
	}
	if err := openUpstream(); err != nil {
		return err
	}
	var buffered, pending, output []byte
	var transcription strings.Builder
	var rejected, ready, announced, responseDone bool
	var turnID string
	var replyBytes int
	var sending <-chan error
	var stopSend context.CancelFunc
	var timer *time.Timer
	var deadline <-chan time.Time
	endTurn := func() {
		if stopSend != nil {
			stopSend()
		}
		if timer != nil {
			timer.Stop()
		}
		sending, stopSend, deadline = nil, nil, nil
		buffered, pending, output = nil, nil, nil
		transcription.Reset()
		turnID, replyBytes, rejected, responseDone = "", 0, false, false
	}
	defer endTurn()
	emit := func(kind, text string) error {
		event := ServerEvent{Type: kind, TurnID: turnID, Text: text}
		if kind == "session.ready" {
			event = profileReady(ctx, event)
		}
		return writeSeedJSON(client, writeMu, event)
	}
	fail := func(code, message string) error {
		return writeSeedJSON(client, writeMu, ServerEvent{Type: "error", TurnID: turnID, Code: code, Message: message})
	}
	segment := func(pcm []byte) error {
		if err := writeSeedJSON(client, writeMu, ServerEvent{Type: "assistant.audio.start", TurnID: turnID, SampleRate: 24000, Codec: "pcm_s16le", Channels: 1, Segment: true}); err != nil {
			return err
		}
		writeMu.Lock()
		_ = client.SetWriteDeadline(time.Now().Add(5 * time.Second))
		err := client.WriteMessage(websocket.BinaryMessage, waveFile(pcm, 24000, 1))
		writeMu.Unlock()
		if err != nil {
			return err
		}
		return writeSeedJSON(client, writeMu, ServerEvent{Type: "assistant.audio.end", TurnID: turnID, Segment: true})
	}
	startAudio := func() {
		sendCtx, stop := context.WithCancel(ctx)
		stopSend = stop
		result := make(chan error, 1)
		sending = result
		pcm, conn := pending, upstream
		pending = nil
		go func() { result <- seedSendAudio(sendCtx, conn, pcm, codec) }()
	}
	failTurn := func(code, message string) error {
		defer endTurn()
		closeUpstream()
		ready = false
		if err := fail(code, message); err != nil {
			return err
		}
		return emit("turn.end", "")
	}
	finishTurn := func() error {
		defer endTurn()
		return emit("turn.end", "")
	}
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-deadline:
			if err := failTurn("seeduplex_timeout", "豆包语音本轮处理超时"); err != nil {
				return err
			}
		case err := <-sending:
			sending = nil
			if err != nil {
				if err := failTurn("seeduplex_audio", "豆包录音无效或发送失败"); err != nil {
					return err
				}
			} else if responseDone {
				if err := finishTurn(); err != nil {
					return err
				}
			}
		case packet, ok := <-incoming:
			if !ok {
				return nil
			}
			if packet.kind == websocket.BinaryMessage {
				if turnID != "" || rejected {
					continue
				}
				if len(packet.data) > maxUtteranceBytes-len(buffered) {
					buffered, rejected = nil, true
					continue
				}
				buffered = append(buffered, packet.data...)
				continue
			}
			var event seedEvent
			if packet.kind != websocket.TextMessage || len(packet.data) > 12*1024 || json.Unmarshal(packet.data, &event) != nil {
				continue
			}
			switch event.Type {
			case "assistant.cancel", "playback.interrupted", "input.cancel", "session.reset":
				// Closing the provider socket stops the paced writer and isolates late events from a canceled turn.
				closeUpstream()
				ready = false
				if event.Type == "session.reset" {
					endTurn()
					if err := emit("session.reset", ""); err != nil {
						return err
					}
				} else {
					err := emit("assistant.cancel", "")
					endTurn()
					if err != nil {
						return err
					}
				}
			case "text.input", "input.end":
				if len(event.TurnID) > 64 {
					continue
				}
				if turnID != "" {
					if err := writeSeedJSON(client, writeMu, ServerEvent{Type: "error", TurnID: event.TurnID, Code: "seeduplex_busy", Message: "请先完成或打断当前豆包语音回合"}); err != nil {
						return err
					}
					continue
				}
				turnID = event.TurnID
				if turnID == "" {
					turnID = randomID()
				}
				if event.Type == "text.input" || rejected || len(buffered) == 0 {
					code, message := "empty_audio", "没有可发送的录音"
					if rejected {
						code, message = "audio_too_large", "单轮录音不能超过 2 MiB"
					}
					if event.Type == "text.input" {
						code, message = "unsupported_text", "豆包语音模式仅支持录音输入"
					}
					if err := fail(code, message); err != nil {
						return err
					}
					if err := finishTurn(); err != nil {
						return err
					}
					continue
				}
				pending, buffered = buffered, nil
				timer = time.NewTimer(110 * time.Second)
				deadline = timer.C
				if upstream == nil {
					if err := openUpstream(); err != nil {
						if err := failTurn("seeduplex_unavailable", "豆包语音无法重新连接"); err != nil {
							return err
						}
						continue
					}
				}
				if ready {
					startAudio()
				}
			}
		case event, ok := <-upstreamEvents:
			if !ok && responseDone {
				closeUpstream()
				ready = false
				continue
			}
			if !ok || event.Type == "error" || event.Type == "session.closed" {
				if !announced {
					return errors.New("豆包语音会话未能建立，请检查 API Key、音色权限和网络")
				}
				if turnID != "" {
					if err := failTurn("seeduplex_error", "豆包语音连接中断或返回错误"); err != nil {
						return err
					}
				} else {
					closeUpstream()
					ready = false
				}
				continue
			}
			if event.Type == "session.created" && !ready {
				if seedWrite(upstream, map[string]string{"type": "input_audio_mute.commit"}) != nil {
					return errors.New("豆包语音会话初始化失败")
				}
				ready = true
				if !announced {
					if err := emit("session.ready", ""); err != nil {
						return err
					}
					announced = true
				}
				if pending != nil {
					startAudio()
				}
				continue
			}
			if !ready || turnID == "" || responseDone {
				continue
			}
			switch event.Type {
			case "conversation.item.input_audio_transcription.delta":
				if event.Delta != "" {
					if len(event.Delta) > maxInputTextRunes*4-transcription.Len() {
						if err := failTurn("seeduplex_asr", "豆包语音识别超过单轮长度限制，请缩短后重试"); err != nil {
							return err
						}
						continue
					}
					transcription.WriteString(event.Delta)
					if err := emit("asr.partial", event.Delta); err != nil {
						return err
					}
				}
			case "conversation.item.input_audio_transcription.completed":
				text := strings.TrimSpace(event.Transcript)
				if text == "" {
					text = strings.TrimSpace(transcription.String())
				}
				if text == "" || utf8.RuneCountInString(text) > maxInputTextRunes {
					if err := failTurn("seeduplex_asr", "豆包语音未返回有效识别文本，请重新录制"); err != nil {
						return err
					}
					continue
				}
				if err := emit("asr.final", text); err != nil {
					return err
				}
			case "conversation.item.input_audio_transcription.failed":
				if err := failTurn("seeduplex_asr", "豆包语音未能识别录音，请重新录制"); err != nil {
					return err
				}
			case "response.output_text.delta":
				if event.Delta != "" {
					if err := emit("assistant.text.delta", event.Delta); err != nil {
						return err
					}
				}
			case "response.output_audio.delta":
				pcm, err := base64.StdEncoding.DecodeString(event.Delta)
				if err != nil || len(pcm) > maxAudioBytes-replyBytes {
					if err := failTurn("seeduplex_audio", "豆包语音回复无效或超过 32 MiB"); err != nil {
						return err
					}
					continue
				}
				replyBytes += len(pcm)
				output = append(output, pcm...)
				for len(output) >= seedSegmentBytes {
					if err := segment(output[:seedSegmentBytes]); err != nil {
						return err
					}
					output = output[seedSegmentBytes:]
				}
			case "response.output_audio.done", "response.done":
				if len(output)%2 != 0 {
					if err := failTurn("seeduplex_audio", "豆包语音回复音频长度无效"); err != nil {
						return err
					}
					continue
				}
				if len(output) > 0 {
					if err := segment(output); err != nil {
						return err
					}
					output = nil
				}
				if event.Type == "response.done" {
					responseDone = true
					if sending == nil {
						if err := finishTurn(); err != nil {
							return err
						}
					}
				}
			case "response.canceled":
				err := emit("assistant.cancel", "")
				endTurn()
				closeUpstream()
				ready = false
				if err != nil {
					return err
				}
			}
		}
	}
}

func writeSeedJSON(client *websocket.Conn, writeMu *sync.Mutex, event ServerEvent) error {
	writeMu.Lock()
	defer writeMu.Unlock()
	_ = client.SetWriteDeadline(time.Now().Add(5 * time.Second))
	return client.WriteJSON(event)
}

func firstEnv(names ...string) string {
	for _, name := range names {
		if value := strings.TrimSpace(os.Getenv(name)); value != "" {
			return value
		}
	}
	return ""
}

func configuredValue(ctx context.Context, configPath string, envNames ...string) string {
	if value := firstEnv(envNames...); value != "" {
		return value
	}
	if value, err := g.Cfg().Get(ctx, configPath); err == nil && value != nil {
		return strings.TrimSpace(value.String())
	}
	return ""
}

func seedDuplexAPIKey(ctx context.Context) string {
	return configuredValue(ctx, "voice.seeduplex.apiKey", "SEEDUPLEX_API_KEY", "VOLCENGINE_REALTIME_API_KEY")
}

func randomID() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("voice-%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(buf)
}
