package voice

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/gorilla/websocket"
)

const (
	seedStreamInputFrame  = 16 * 1024
	seedStreamOutputFrame = 64 * 1024
	seedStreamQueue       = 32
	seedStreamInputTotal  = 64 * 1024 * 1024
	seedStreamOutputTotal = 128 * 1024 * 1024
)

type seedStreamBudget struct{ turn, total int }

func (b *seedStreamBudget) accept(size, frameLimit, turnLimit, totalLimit int) string {
	if size == 0 || size%2 != 0 || size > frameLimit {
		return "invalid_audio_frame"
	}
	if turnLimit > 0 && size > turnLimit-b.turn {
		return "audio_too_large"
	}
	if size > totalLimit-b.total {
		return "session_audio_limit"
	}
	b.turn += size
	b.total += size
	return ""
}

type seedStreamCommand struct {
	value any
	done  chan error
}

type seedStreamUpstream struct {
	conn        *websocket.Conn
	send        chan seedStreamCommand
	events      chan seedEvent
	active      chan struct{}
	initialized chan error
	stop        context.CancelFunc
}

func openSeedStream(ctx context.Context, endpoint, key string) (*seedStreamUpstream, error) {
	conn, err := seedDial(ctx, endpoint, key)
	if err != nil {
		return nil, err
	}
	if err := seedWrite(conn, seedSessionCreate(ctx)); err != nil {
		_ = conn.Close()
		return nil, errors.New("豆包语音会话创建失败")
	}
	upCtx, stop := context.WithCancel(ctx)
	up := &seedStreamUpstream{conn: conn, send: make(chan seedStreamCommand, seedStreamQueue), events: make(chan seedEvent), active: make(chan struct{}), initialized: make(chan error, 1), stop: stop}
	_ = conn.SetReadDeadline(time.Now().Add(10 * time.Second))
	context.AfterFunc(upCtx, func() { _ = conn.Close() })
	go func() {
		defer conn.Close()
		select {
		case <-up.active:
		case <-upCtx.Done():
			return
		}
		// Streaming keeps the microphone unmuted; provider VAD owns turn boundaries.
		err := seedWrite(conn, map[string]string{"type": "input_audio_unmute.commit"})
		up.initialized <- err
		if err != nil {
			return
		}
		for {
			select {
			case <-upCtx.Done():
				return
			case command := <-up.send:
				err := seedWrite(conn, command.value)
				if command.done != nil {
					command.done <- err
				}
				if err != nil {
					return
				}
			}
		}
	}()
	go func() {
		defer close(up.events)
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
			case up.events <- event:
			case <-upCtx.Done():
				return
			}
		}
	}()
	return up, nil
}

// One bounded writer owns downstream JSON and binary ordering. Invalidating its
// generation under the same lock is a barrier against queued, late PCM writes.
type seedStreamOutput struct {
	generation uint64
	event      ServerEvent
	pcm        []byte
	done       chan error
}

func runSeedStream(parent context.Context, client *websocket.Conn, writeMu *sync.Mutex, endpoint, key string) error {
	return runSeedStreamWithTimeout(parent, client, writeMu, endpoint, key, 110*time.Second)
}

func runSeedStreamWithTimeout(parent context.Context, client *websocket.Conn, writeMu *sync.Mutex, endpoint, key string, replyTimeout time.Duration) error {
	ctx, cancel := context.WithCancel(parent)
	defer cancel()
	defer client.Close()
	stopClient := context.AfterFunc(ctx, func() { _ = client.Close() })
	defer stopClient()
	client.SetReadLimit(64 * 1024)
	type packet struct {
		kind int
		data []byte
	}
	incoming := make(chan packet)
	go func() {
		defer close(incoming)
		for {
			kind, data, err := client.ReadMessage()
			if err != nil {
				return
			}
			select {
			case incoming <- packet{kind, data}:
			case <-ctx.Done():
				return
			}
		}
	}()
	var generationMu sync.Mutex
	generation := uint64(1)
	outgoing := make(chan seedStreamOutput, seedStreamQueue)
	writeError := make(chan error, 1)
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case output := <-outgoing:
				generationMu.Lock()
				var err error
				if output.generation == 0 || output.generation == generation {
					writeMu.Lock()
					_ = client.SetWriteDeadline(time.Now().Add(5 * time.Second))
					if output.pcm != nil {
						err = client.WriteMessage(websocket.BinaryMessage, output.pcm)
					} else {
						err = client.WriteJSON(output.event)
					}
					writeMu.Unlock()
				}
				generationMu.Unlock()
				if output.done != nil {
					output.done <- err
				}
				if err != nil {
					writeError <- err
					return
				}
			}
		}
	}()
	invalidate := func() {
		generationMu.Lock()
		generation++
		generationMu.Unlock()
	}
	emit := func(event ServerEvent, pcm []byte, wait bool) error {
		output := seedStreamOutput{generation: generation, event: event, pcm: pcm}
		if event.Type == "session.ready" || event.Type == "session.reset" || event.Type == "session.stopped" || event.Type == "assistant.cancel" || event.Type == "error" {
			output.generation = 0
		}
		if wait {
			output.done = make(chan error, 1)
		}
		select {
		case outgoing <- output:
		case err := <-writeError:
			return err
		case <-ctx.Done():
			return ctx.Err()
		default:
			return errors.New("语音客户端接收过慢")
		}
		if wait {
			select {
			case err := <-output.done:
				return err
			case err := <-writeError:
				return err
			case <-ctx.Done():
				return ctx.Err()
			}
		}
		return nil
	}
	upstream, err := openSeedStream(ctx, endpoint, key)
	if err != nil {
		return err
	}
	var events <-chan seedEvent = upstream.events
	var retiredResponses []string
	ready := false
	closeUpstream := func(sendCancel bool) {
		if upstream == nil {
			return
		}
		if sendCancel && ready {
			done := make(chan error, 1)
			select {
			case upstream.send <- seedStreamCommand{value: map[string]string{"type": "response.cancel"}, done: done}:
				timer := time.NewTimer(250 * time.Millisecond)
				select {
				case <-done:
				case <-timer.C:
				case <-ctx.Done():
				}
				timer.Stop()
			default:
			}
		}
		upstream.stop()
		_ = upstream.conn.Close()
		upstream, events, ready = nil, nil, false
	}
	defer func() { closeUpstream(false) }()
	openUpstream := func() error {
		var err error
		upstream, err = openSeedStream(ctx, endpoint, key)
		if err == nil {
			events = upstream.events
			retiredResponses = nil
		}
		return err
	}

	var inputID, outputID, retiredID, responseID string
	var inputBudget, outputBudget seedStreamBudget
	var speaking, audioStarted, audioDone, textFinal bool
	var transcript, reply strings.Builder
	var turnTimer *time.Timer
	var deadline <-chan time.Time
	stopDeadline := func() {
		if turnTimer != nil {
			turnTimer.Stop()
		}
		deadline = nil
	}
	defer stopDeadline()
	startDeadline := func() {
		stopDeadline()
		turnTimer = time.NewTimer(replyTimeout)
		deadline = turnTimer.C
	}
	// Response identities are scoped to one upstream connection.
	currentID := func() string {
		if outputID != "" {
			return outputID
		}
		return inputID
	}
	newInputID := func(requested string) string {
		if requested == "" || requested == retiredID || requested == outputID {
			return randomID()
		}
		return requested
	}
	retireResponse := func() {
		if responseID != "" {
			retiredResponses = append(retiredResponses, responseID)
			if len(retiredResponses) > 32 {
				retiredResponses = retiredResponses[1:]
			}
		}
		responseID = ""
	}
	clearResponse := func() {
		stopDeadline()
		retireResponse()
		outputID, outputBudget.turn, audioStarted, audioDone, textFinal = "", 0, false, false, false
		transcript.Reset()
		reply.Reset()
	}
	fatal := func(code, message string) error {
		id := currentID()
		invalidate()
		closeUpstream(true)
		if err := emit(ServerEvent{Type: "error", TurnID: id, Code: code, Message: message}, nil, true); err != nil {
			return err
		}
		if id != "" {
			return emit(ServerEvent{Type: "turn.end", TurnID: id}, nil, true)
		}
		return nil
	}
	cancelResponse := func(id string) error {
		invalidate()
		closeUpstream(true)
		retiredID = id
		inputID, inputBudget.turn, speaking = "", 0, false
		clearResponse()
		if err := emit(ServerEvent{Type: "assistant.cancel", TurnID: id}, nil, false); err != nil {
			return err
		}
		return openUpstream()
	}
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case err := <-writeError:
			return err
		case <-deadline:
			id := currentID()
			if err := emit(ServerEvent{Type: "error", TurnID: id, Code: "seeduplex_timeout", Message: "豆包语音本轮处理超时，已恢复监听"}, nil, false); err != nil {
				return err
			}
			if err := cancelResponse(id); err != nil {
				return fatal("seeduplex_unavailable", "豆包语音无法重新连接")
			}
			if err := emit(ServerEvent{Type: "turn.end", TurnID: id}, nil, false); err != nil {
				return err
			}
		case packet, ok := <-incoming:
			if !ok {
				return nil
			}
			if packet.kind == websocket.BinaryMessage {
				turnLimit := 0
				if speaking {
					turnLimit = maxUtteranceBytes
				}
				switch code := inputBudget.accept(len(packet.data), seedStreamInputFrame, turnLimit, seedStreamInputTotal); code {
				case "invalid_audio_frame":
					return fatal(code, "PCM 帧必须为偶数字节且不超过 16 KiB")
				case "audio_too_large":
					return fatal(code, "单轮输入不能超过 2 MiB")
				case "session_audio_limit":
					return fatal(code, "本次通话输入已达限额，请重新连接")
				}
				if inputID == "" {
					inputID = newInputID("")
				}
				command := seedStreamCommand{value: map[string]string{"type": "input_audio_buffer.append", "audio": base64.StdEncoding.EncodeToString(packet.data)}}
				select {
				case upstream.send <- command:
				default:
					return fatal("seeduplex_backpressure", "语音上行拥塞，请重新连接")
				}
				continue
			}
			var event seedEvent
			if packet.kind != websocket.TextMessage || len(packet.data) > 12*1024 || json.Unmarshal(packet.data, &event) != nil {
				if err := emit(ServerEvent{Type: "error", Code: "invalid_message", Message: "仅接受不超过 12 KiB 的 JSON 控制消息"}, nil, false); err != nil {
					return err
				}
				continue
			}
			if len(event.TurnID) > 64 {
				if err := emit(ServerEvent{Type: "error", Code: "invalid_turn_id", Message: "对话回合标识不能超过 64 字节"}, nil, false); err != nil {
					return err
				}
				continue
			}
			switch event.Type {
			case "session.stop":
				invalidate()
				closeUpstream(true)
				return emit(ServerEvent{Type: "session.stopped"}, nil, true)
			case "session.reset":
				invalidate()
				closeUpstream(true)
				retiredID = currentID()
				inputID, inputBudget.turn, speaking = "", 0, false
				clearResponse()
				if err := emit(ServerEvent{Type: "session.reset"}, nil, false); err != nil {
					return err
				}
				if err := openUpstream(); err != nil {
					return fatal("seeduplex_unavailable", "豆包语音无法重新连接")
				}
			case "assistant.cancel", "playback.interrupted", "input.cancel":
				if event.TurnID == "" {
					if err := emit(ServerEvent{Type: "error", Code: "invalid_turn_id", Message: "取消操作必须携带当前 turn_id"}, nil, false); err != nil {
						return err
					}
					continue
				}
				if event.TurnID != currentID() {
					if err := emit(ServerEvent{Type: "assistant.cancel", TurnID: event.TurnID}, nil, false); err != nil {
						return err
					}
					continue
				}
				if err := cancelResponse(event.TurnID); err != nil {
					return fatal("seeduplex_unavailable", "豆包语音无法重新连接")
				}
			case "input.activity":
				if event.Active != nil && !*event.Active {
					continue
				}
				if outputID != "" {
					if err := cancelResponse(outputID); err != nil {
						return fatal("seeduplex_unavailable", "豆包语音无法重新连接")
					}
				}
				if !speaking && (event.TurnID != "" || inputID == "") {
					inputID = newInputID(event.TurnID)
				}
			case "playback.complete":
				// Playback completion is local state, never a provider VAD boundary.
			case "text.input", "input.end":
				if err := emit(ServerEvent{Type: "error", TurnID: event.TurnID, Code: "unsupported_streaming_event", Message: "持续通话由服务端 VAD 分轮，无需 input.end 且不支持文字输入"}, nil, false); err != nil {
					return err
				}
			default:
				if err := emit(ServerEvent{Type: "error", Code: "unknown_event", Message: "不支持的语音控制消息"}, nil, false); err != nil {
					return err
				}
			}
		case event, ok := <-events:
			if !ok || event.Type == "error" || event.Type == "session.closed" {
				return fatal("seeduplex_error", "豆包语音连接中断或返回错误")
			}
			if event.Type == "session.created" {
				if !ready {
					close(upstream.active)
					select {
					case err := <-upstream.initialized:
						if err != nil {
							return fatal("seeduplex_unavailable", "豆包语音会话初始化失败")
						}
					case <-ctx.Done():
						return ctx.Err()
					}
					ready = true
					if err := emit(profileReady(ctx, ServerEvent{Type: "session.ready", Provider: "seeduplex", Streaming: true, Codec: "pcm_s16le", Channels: 1, InputRate: 16000, OutputRate: 24000}), nil, false); err != nil {
						return err
					}
				}
				continue
			}
			if !ready {
				continue
			}
			if event.Type == "input_audio_buffer.speech_started" || event.Type == "input.speech.started" {
				if speaking {
					continue
				}
				if outputID == "" {
					invalidate()
				}
				if outputID != "" {
					id := inputID
					if err := cancelResponse(outputID); err != nil {
						return fatal("seeduplex_unavailable", "豆包语音无法重新连接")
					}
					inputID = newInputID(id)
				}
				if inputID == "" {
					inputID = newInputID("")
				}
				speaking, inputBudget.turn = true, 0
				if err := emit(ServerEvent{Type: "input.speech.started", TurnID: inputID}, nil, false); err != nil {
					return err
				}
				continue
			}
			if event.Type == "input_audio_buffer.speech_stopped" || event.Type == "input.speech.stopped" {
				if inputID == "" || !speaking {
					continue
				}
				outputID, inputID, inputBudget.turn, speaking = inputID, "", 0, false
				startDeadline()
				if err := emit(ServerEvent{Type: "input.speech.stopped", TurnID: outputID}, nil, false); err != nil {
					return err
				}
				continue
			}
			key := ""
			if strings.HasPrefix(event.Type, "response.") {
				key = event.ResponseID
				if key == "" {
					key = event.Response.ID
				}
				if key == "" {
					key = event.TurnID
				}
			}
			if len(key) > 128 {
				return fatal("seeduplex_error", "豆包语音返回无效的回合标识")
			}
			stale := false
			for _, retired := range retiredResponses {
				stale = stale || (key != "" && key == retired)
			}
			if stale || (responseID != "" && key != "" && responseID != key) {
				continue
			}
			if key != "" {
				responseID = key
			}
			if outputID == "" && inputID == "" {
				continue
			}
			id := outputID
			if id == "" {
				id = inputID
			}
			if strings.HasPrefix(event.Type, "response.") && deadline == nil {
				startDeadline()
			}
			emitText := func(kind, text string) error {
				return emit(ServerEvent{Type: kind, TurnID: id, Text: text}, nil, false)
			}
			switch event.Type {
			case "conversation.item.input_audio_transcription.delta":
				if len(event.Delta) > maxInputTextRunes*4-transcript.Len() {
					return fatal("seeduplex_asr", "豆包语音识别超过单轮长度限制")
				}
				transcript.WriteString(event.Delta)
				if event.Delta != "" {
					if err := emitText("asr.delta", event.Delta); err != nil {
						return err
					}
				}
			case "conversation.item.input_audio_transcription.completed":
				text := strings.TrimSpace(event.Transcript)
				if text == "" {
					text = strings.TrimSpace(transcript.String())
				}
				if text == "" || utf8.RuneCountInString(text) > maxInputTextRunes {
					return fatal("seeduplex_asr", "豆包语音未返回有效识别文本")
				}
				if err := emitText("asr.final", text); err != nil {
					return err
				}
			case "conversation.item.input_audio_transcription.failed":
				return fatal("seeduplex_asr", "豆包语音未能识别录音")
			case "response.output_text.delta":
				if len(event.Delta) > maxInputTextRunes*4-reply.Len() {
					return fatal("seeduplex_text_limit", "豆包语音回复超过单轮文字长度限制")
				}
				reply.WriteString(event.Delta)
				if event.Delta != "" {
					outputID = id
					if err := emitText("assistant.text.delta", event.Delta); err != nil {
						return err
					}
				}
			case "response.output_text.done":
				text := event.Text
				if text == "" {
					text = reply.String()
				}
				if len(text) > maxInputTextRunes*4 {
					return fatal("seeduplex_text_limit", "豆包语音回复超过单轮文字长度限制")
				}
				textFinal = true
				if err := emitText("assistant.text.final", text); err != nil {
					return err
				}
			case "response.output_audio.delta":
				if audioDone {
					continue
				}
				if len(event.Delta) > base64.StdEncoding.EncodedLen(seedStreamOutputFrame) {
					return fatal("seeduplex_audio", "豆包语音回复单帧超过 64 KiB")
				}
				pcm, err := base64.StdEncoding.DecodeString(event.Delta)
				if err != nil {
					return fatal("seeduplex_audio", "豆包语音回复编码无效")
				}
				if code := outputBudget.accept(len(pcm), seedStreamOutputFrame, maxAudioBytes, seedStreamOutputTotal); code != "" {
					if code == "session_audio_limit" {
						return fatal(code, "本次通话输出已达限额，请重新连接")
					}
					return fatal("seeduplex_audio", "豆包语音回复无效或超过单轮限额")
				}
				outputID = id
				if !audioStarted {
					audioStarted = true
					if err := emit(ServerEvent{Type: "assistant.audio.start", TurnID: id, Streaming: true, Codec: "pcm_s16le", SampleRate: 24000, Channels: 1}, nil, false); err != nil {
						return err
					}
				}
				if err := emit(ServerEvent{}, pcm, false); err != nil {
					return err
				}
			case "response.output_audio.done":
				audioDone = true
				if audioStarted {
					audioStarted = false
					if err := emitText("assistant.audio.end", ""); err != nil {
						return err
					}
				}
			case "response.done":
				if !textFinal && reply.Len() > 0 {
					if err := emitText("assistant.text.final", reply.String()); err != nil {
						return err
					}
				}
				if audioStarted {
					if err := emitText("assistant.audio.end", ""); err != nil {
						return err
					}
				}
				if err := emitText("turn.end", ""); err != nil {
					return err
				}
				retiredID = id
				if inputID == id {
					inputID, inputBudget.turn = "", 0
				}
				clearResponse()
			case "response.canceled", "response.cancelled":
				if err := cancelResponse(id); err != nil {
					return fatal("seeduplex_unavailable", "豆包语音无法重新连接")
				}
			}
		}
	}
}
