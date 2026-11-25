package voice

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"unicode/utf8"
)

const (
	maxSessionTurns   = 6
	maxSessionRunes   = 6000
	maxInputTextRunes = 2000
)

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// Session belongs to one WebSocket connection; no history is persisted or logged.
type Session struct {
	mu         sync.Mutex
	generation uint64
	history    []chatMessage
}

// Begin invalidates unfinished work while retaining completed conversation turns.
func (s *Session) Begin() uint64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.generation++
	return s.generation
}

func (s *Session) Reset() uint64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.generation++
	s.history = nil
	return s.generation
}

func (s *Session) messages(generation uint64, text string) ([]chatMessage, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if generation != s.generation {
		return nil, context.Canceled
	}
	messages := append([]chatMessage(nil), s.history...)
	return append(messages, chatMessage{Role: "user", Content: text}), nil
}

func (s *Session) commit(ctx context.Context, generation uint64, text, answer string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	if generation != s.generation {
		return context.Canceled
	}
	s.history = append(s.history, chatMessage{Role: "user", Content: text}, chatMessage{Role: "assistant", Content: answer})
	count := 0
	for _, message := range s.history {
		count += utf8.RuneCountInString(message.Content)
	}
	for len(s.history) > maxSessionTurns*2 || count > maxSessionRunes {
		count -= utf8.RuneCountInString(s.history[0].Content) + utf8.RuneCountInString(s.history[1].Content)
		// Copy retained turns so removed text is no longer held by the backing array.
		s.history = append([]chatMessage(nil), s.history[2:]...)
	}
	return nil
}

func (s *Session) processText(ctx context.Context, generation uint64, text string, emit func(any) error) error {
	text = strings.TrimSpace(text)
	if text == "" {
		return errors.New("没有识别到语音，请靠近麦克风后重试")
	}
	if utf8.RuneCountInString(text) > maxInputTextRunes {
		return errors.New("识别文本超过单轮长度限制")
	}
	messages, err := s.messages(generation, text)
	if err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := emit(ServerEvent{Type: "asr.final", Text: text}); err != nil {
		return err
	}
	answer, err := complete(ctx, messages)
	if err != nil {
		return fmt.Errorf("对话模型不可用: %w", err)
	}
	if utf8.RuneCountInString(answer) > 300 {
		return errors.New("对话回复超过语音合成长度限制")
	}
	if err := emit(ServerEvent{Type: "assistant.text.delta", Text: answer}); err != nil {
		return err
	}
	if err := synthesizeStream(ctx, answer, emit); err != nil {
		return fmt.Errorf("语音合成失败: %w", err)
	}
	return s.commit(ctx, generation, text, answer)
}
