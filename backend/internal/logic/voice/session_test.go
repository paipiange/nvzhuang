package voice

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

// Route only the fixed loopback model requests to a test server.
func routeModels(t *testing.T, handler http.HandlerFunc) {
	t.Helper()
	server := httptest.NewServer(handler)
	target, _ := url.Parse(server.URL)
	previous := http.DefaultTransport
	http.DefaultTransport = modelTransport{target: target, base: previous}
	t.Cleanup(func() { http.DefaultTransport = previous; server.Close() })
}

type modelTransport struct {
	target *url.URL
	base   http.RoundTripper
}

func (m modelTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	clone := req.Clone(req.Context())
	address := *req.URL
	address.Scheme, address.Host = m.target.Scheme, m.target.Host
	clone.URL = &address
	return m.base.RoundTrip(clone)
}

func pcmHeaders(w http.ResponseWriter) {
	w.Header().Set("X-Audio-Format", "pcm_s16le")
	w.Header().Set("X-Audio-Sample-Rate", "24000")
	w.Header().Set("X-Audio-Channels", "1")
}

func TestSessionHistoryResetAndIsolation(t *testing.T) {
	var requests [][]chatMessage
	routeModels(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/chat/completions" {
			var body struct {
				Messages []chatMessage `json:"messages"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Error(err)
			}
			requests = append(requests, body.Messages)
			_, _ = io.WriteString(w, `{"choices":[{"message":{"content":"好的"}}]}`)
		} else {
			pcmHeaders(w)
			_, _ = w.Write(make([]byte, 4))
		}
	})
	var session, separate Session
	emit := func(any) error { return nil }
	for _, text := range []string{"我喜欢蓝色", "我喜欢什么"} {
		if err := session.processText(context.Background(), session.Begin(), text, emit); err != nil {
			t.Fatal(err)
		}
	}
	if len(requests[1]) != 4 || requests[1][1].Content != "我喜欢蓝色" || requests[1][2].Role != "assistant" {
		t.Fatalf("history missing: %+v", requests[1])
	}
	session.Reset()
	if err := session.processText(context.Background(), session.Begin(), "重置后", emit); err != nil {
		t.Fatal(err)
	}
	if err := separate.processText(context.Background(), separate.Begin(), "独立连接", emit); err != nil {
		t.Fatal(err)
	}
	if len(requests[2]) != 2 || len(requests[3]) != 2 {
		t.Fatalf("history leaked after reset or between connections: %+v", requests)
	}
}

func TestSessionDoesNotCommitCanceledFailedOrObsoleteTurns(t *testing.T) {
	routeModels(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/chat/completions" {
			_, _ = io.WriteString(w, `{"choices":[{"message":{"content":"回答"}}]}`)
		} else {
			pcmHeaders(w)
			_, _ = w.Write(make([]byte, 4))
		}
	})
	for _, mode := range []string{"cancel", "reset", "emit-failure"} {
		t.Run(mode, func(t *testing.T) {
			var session Session
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			err := session.processText(ctx, session.Begin(), "问题", func(value any) error {
				if event, ok := value.(ServerEvent); ok && event.Type == "assistant.audio.end" {
					switch mode {
					case "cancel":
						cancel()
					case "reset":
						session.Reset()
					case "emit-failure":
						return errors.New("closed client")
					}
				}
				return nil
			})
			if err == nil || len(session.history) != 0 {
				t.Fatalf("failed turn committed: err=%v history=%+v", err, session.history)
			}
		})
	}
}

func TestSessionSynthesisFailureDoesNotCommit(t *testing.T) {
	routeModels(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/chat/completions" {
			_, _ = io.WriteString(w, `{"choices":[{"message":{"content":"回答"}}]}`)
		} else {
			w.WriteHeader(http.StatusServiceUnavailable)
		}
	})
	var session Session
	if err := session.processText(context.Background(), session.Begin(), "问题", func(any) error { return nil }); err == nil || len(session.history) != 0 {
		t.Fatalf("failed synthesis committed history: %v %+v", err, session.history)
	}
}

func TestSessionInvalidationWhileSynthesisIsInFlight(t *testing.T) {
	for _, mode := range []string{"begin", "reset", "cancel"} {
		t.Run(mode, func(t *testing.T) {
			entered, release := make(chan struct{}), make(chan struct{})
			routeModels(t, func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/v1/chat/completions" {
					_, _ = io.WriteString(w, `{"choices":[{"message":{"content":"回答"}}]}`)
					return
				}
				close(entered)
				<-release
				pcmHeaders(w)
				_, _ = w.Write(make([]byte, 4))
			})
			var session Session
			generation := session.Begin()
			if err := session.commit(context.Background(), generation, "已完成问题", "已完成答案"); err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			done := make(chan error, 1)
			go func() {
				done <- session.processText(ctx, generation, "未完成问题", func(any) error { return nil })
			}()
			select {
			case <-entered:
			case <-time.After(3 * time.Second):
				close(release)
				t.Fatal("fake synthesis request did not start")
			}
			switch mode {
			case "begin":
				session.Begin()
			case "reset":
				session.Reset()
			case "cancel":
				cancel()
			}
			close(release)
			select {
			case err := <-done:
				if !errors.Is(err, context.Canceled) {
					t.Fatalf("invalidated turn error=%v", err)
				}
			case <-time.After(3 * time.Second):
				t.Fatal("invalidated turn did not finish")
			}
			messages, err := session.messages(session.generation, "下一轮")
			if err != nil {
				t.Fatal(err)
			}
			want := 3
			if mode == "reset" {
				want = 1
			}
			if len(messages) != want {
				t.Fatalf("invalidated synthesis polluted history: %+v", messages)
			}
			for _, message := range messages {
				if message.Content == "未完成问题" || message.Content == "回答" {
					t.Fatalf("unfinished turn retained: %+v", messages)
				}
			}
		})
	}
}

func TestSessionBoundsAndObsoleteGeneration(t *testing.T) {
	var session Session
	token := session.Begin()
	for i := 0; i < 10; i++ {
		if err := session.commit(context.Background(), token, "问题", "回答"); err != nil {
			t.Fatal(err)
		}
	}
	if len(session.history) != maxSessionTurns*2 {
		t.Fatalf("turn count=%d", len(session.history))
	}
	session.Reset()
	token = session.Begin()
	for i := 0; i < 10; i++ {
		if err := session.commit(context.Background(), token, strings.Repeat("问", 1500), strings.Repeat("答", 200)); err != nil {
			t.Fatal(err)
		}
	}
	count := 0
	for _, m := range session.history {
		count += utf8.RuneCountInString(m.Content)
	}
	if count > maxSessionRunes || len(session.history)%2 != 0 {
		t.Fatalf("unbounded history: %d", count)
	}
	session.Begin()
	if err := session.commit(context.Background(), token, "旧问题", "旧答案"); !errors.Is(err, context.Canceled) {
		t.Fatalf("obsolete commit=%v", err)
	}
	if err := session.processText(context.Background(), session.Begin(), strings.Repeat("问", maxInputTextRunes+1), func(any) error { return nil }); err == nil {
		t.Fatal("oversized input accepted")
	}
}
