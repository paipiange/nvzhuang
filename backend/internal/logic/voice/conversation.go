package voice

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os/exec"
	"strings"
	"time"

	"github.com/gogf/gf/v2/frame/g"
	"github.com/gorilla/websocket"
)

const maxUtteranceBytes = 2 * 1024 * 1024

type clientEvent struct {
	Type        string `json:"type"`
	CharacterID string `json:"character_id"`
	TurnID      string `json:"turn_id"`
	InputRate   int    `json:"input_rate"`
	Codec       string `json:"codec"`
}

type ServerEvent struct {
	Type        string `json:"type"`
	TurnID      string `json:"turn_id,omitempty"`
	Text        string `json:"text,omitempty"`
	Message     string `json:"message,omitempty"`
	Code        string `json:"code,omitempty"`
	SampleRate  int    `json:"sample_rate,omitempty"`
	Codec       string `json:"codec,omitempty"`
	Channels    int    `json:"channels,omitempty"`
	Segment     bool   `json:"segment,omitempty"`
	Provider    string `json:"provider,omitempty"`
	Streaming   bool   `json:"streaming,omitempty"`
	InputRate   int    `json:"input_rate,omitempty"`
	OutputRate  int    `json:"output_rate,omitempty"`
	CharacterID string `json:"character_id,omitempty"`
	PersonaID   string `json:"persona_id,omitempty"`
	VoiceID     string `json:"voice_id,omitempty"`
}

func normalizeAudio(ctx context.Context, input []byte, codec string) ([]byte, error) {
	if len(input) == 0 || len(input) > maxUtteranceBytes {
		return nil, errors.New("音频长度无效，单轮录音不能超过约 64 秒")
	}
	var pcm []byte
	if codec == "pcm_s16le" {
		if len(input)%2 != 0 {
			return nil, errors.New("PCM 音频帧长度无效")
		}
		pcm = input
	} else if codec == "mp3" {
		ffmpeg := g.Cfg().MustGet(ctx, "voice.ffmpeg", "ffmpeg").String()
		if ffmpeg == "" {
			ffmpeg = "ffmpeg"
		}
		cmd := exec.CommandContext(ctx, ffmpeg, "-hide_banner", "-loglevel", "error", "-f", "mp3", "-i", "pipe:0", "-f", "s16le", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", "pipe:1")
		cmd.Stdin = bytes.NewReader(input)
		var output bytes.Buffer
		cmd.Stdout = &output
		if err := cmd.Run(); err != nil {
			return nil, errors.New("MP3 转码失败，请确认后端安装了 ffmpeg")
		}
		pcm = output.Bytes()
	} else {
		return nil, errors.New("不支持的音频格式")
	}
	if len(pcm) < 3200 || len(pcm) > maxUtteranceBytes || len(pcm)%2 != 0 {
		return nil, errors.New("音频长度无效，请录制 0.1 至 64 秒的 16kHz 单声道音频")
	}
	return pcm, nil
}
func ProcessUtterance(ctx context.Context, input []byte, codec string, emit func(any) error) error {
	var session Session
	return session.Process(ctx, session.Begin(), input, codec, emit)
}

func (s *Session) ProcessText(ctx context.Context, generation uint64, text string, emit func(any) error) error {
	return s.processText(ctx, generation, text, emit)
}

func (s *Session) Process(ctx context.Context, generation uint64, input []byte, codec string, emit func(any) error) error {
	pcm, err := normalizeAudio(ctx, input, codec)
	if err != nil {
		return err
	}
	text, err := recognize(ctx, pcm)
	if err != nil {
		return fmt.Errorf("语音识别失败: %w", err)
	}
	return s.processText(ctx, generation, text, emit)
}

type AudioWAV struct{ Data []byte }

func recognize(ctx context.Context, pcm []byte) (string, error) {
	dialer := websocket.Dialer{HandshakeTimeout: 5 * time.Second}
	conn, _, err := dialer.DialContext(ctx, "ws://127.0.0.1:10096", nil)
	if err != nil {
		return "", err
	}
	defer conn.Close()
	closed := make(chan struct{})
	defer close(closed)
	go func() {
		select {
		case <-ctx.Done():
			_ = conn.Close()
		case <-closed:
		}
	}()
	_ = conn.SetReadDeadline(time.Now().Add(30 * time.Second))
	init := map[string]any{"mode": "2pass", "wav_name": fmt.Sprintf("voice-%d", time.Now().UnixNano()), "is_speaking": true, "wav_format": "pcm", "audio_fs": 16000, "chunk_size": []int{5, 10, 5}, "itn": true}
	if err := conn.WriteJSON(init); err != nil {
		return "", err
	}
	for offset := 0; offset < len(pcm); offset += 640 {
		end := offset + 640
		if end > len(pcm) {
			end = len(pcm)
		}
		if err := conn.WriteMessage(websocket.BinaryMessage, pcm[offset:end]); err != nil {
			return "", err
		}
	}
	if err := conn.WriteJSON(map[string]bool{"is_speaking": false}); err != nil {
		return "", err
	}
	return readRecognition(conn)
}

func readRecognition(conn *websocket.Conn) (string, error) {
	var transcript strings.Builder
	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			return "", err
		}
		var payload struct {
			Text    string `json:"text"`
			Mode    string `json:"mode"`
			IsFinal bool   `json:"is_final"`
		}
		if json.Unmarshal(message, &payload) != nil {
			continue
		}
		switch payload.Mode {
		case "offline", "2pass-offline":
			if transcript.Len()+len(payload.Text) > maxInputTextRunes*4 {
				return "", errors.New("识别文本超过单轮长度限制")
			}
			transcript.WriteString(payload.Text)
		}
		// FunASR can send a separate final marker with no mode or text.
		if payload.IsFinal {
			return transcript.String(), nil
		}
	}
}

func complete(ctx context.Context, messages []chatMessage) (string, error) {
	messages = append([]chatMessage{{Role: "system", Content: voiceProfile(ctx).Instructions}}, messages...)
	payload, _ := json.Marshal(map[string]any{"model": "Qwen_Qwen3-4B-Instruct-2507-Q4_K_M.gguf", "messages": messages, "temperature": 0.7, "max_tokens": 256, "stream": false})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "http://127.0.0.1:8080/v1/chat/completions", bytes.NewReader(payload))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := (&http.Client{Timeout: 90 * time.Second}).Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("Qwen 返回状态码 %d", resp.StatusCode)
	}
	var result struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 2*1024*1024)).Decode(&result); err != nil {
		return "", err
	}
	if len(result.Choices) > 0 {
		if answer := strings.TrimSpace(result.Choices[0].Message.Content); answer != "" {
			return answer, nil
		}
	}
	return "", errors.New("Qwen 返回空结果")
}

const maxAudioBytes = 32 * 1024 * 1024

func synthesizeStream(ctx context.Context, text string, emit func(any) error) error {
	request := map[string]string{"text": text}
	if voice := voiceProfile(ctx).Voice; voice != "" {
		request["voice_id"] = voice
	}
	payload, _ := json.Marshal(request)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "http://127.0.0.1:50000/tts/stream", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := (&http.Client{Timeout: 90 * time.Second}).Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("CosyVoice 返回状态码 %d", resp.StatusCode)
	}
	if resp.Header.Get("X-Audio-Format") != "pcm_s16le" || resp.Header.Get("X-Audio-Sample-Rate") != "24000" || resp.Header.Get("X-Audio-Channels") != "1" {
		return errors.New("CosyVoice 必须返回 24kHz 单声道 pcm_s16le")
	}
	// Half-second segments avoid creating a new player for every small HTTP read.
	buffer := make([]byte, 24000)
	total := 0
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		n, readErr := io.ReadFull(resp.Body, buffer)
		total += n
		if total > maxAudioBytes {
			return errors.New("音频内容超过限制")
		}
		if readErr != nil && !errors.Is(readErr, io.EOF) && !errors.Is(readErr, io.ErrUnexpectedEOF) {
			return readErr
		}
		if n%2 != 0 {
			return errors.New("PCM 音频帧长度无效")
		}
		if n > 0 {
			for _, value := range []any{
				ServerEvent{Type: "assistant.audio.start", SampleRate: 24000, Codec: "pcm_s16le", Channels: 1, Segment: true},
				AudioWAV{Data: waveFile(buffer[:n], 24000, 1)},
				ServerEvent{Type: "assistant.audio.end", Segment: true},
			} {
				if err := ctx.Err(); err != nil {
					return err
				}
				if err := emit(value); err != nil {
					return err
				}
			}
		}
		if readErr != nil {
			if total == 0 {
				return errors.New("音频内容为空")
			}
			return nil
		}
	}
}

func waveFile(pcm []byte, sampleRate, channels int) []byte {
	data := make([]byte, 44+len(pcm))
	copy(data[0:4], "RIFF")
	binary.LittleEndian.PutUint32(data[4:8], uint32(len(data)-8))
	copy(data[8:12], "WAVE")
	copy(data[12:16], "fmt ")
	binary.LittleEndian.PutUint32(data[16:20], 16)
	binary.LittleEndian.PutUint16(data[20:22], 1)
	binary.LittleEndian.PutUint16(data[22:24], uint16(channels))
	binary.LittleEndian.PutUint32(data[24:28], uint32(sampleRate))
	binary.LittleEndian.PutUint32(data[28:32], uint32(sampleRate*channels*2))
	binary.LittleEndian.PutUint16(data[32:34], uint16(channels*2))
	binary.LittleEndian.PutUint16(data[34:36], 16)
	copy(data[36:40], "data")
	binary.LittleEndian.PutUint32(data[40:44], uint32(len(pcm)))
	copy(data[44:], pcm)
	return data
}
