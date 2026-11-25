package voice

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/gogf/gf/v2/frame/g"
	"github.com/gogf/gf/v2/os/gcfg"
	"github.com/gorilla/websocket"
)

func TestNormalizePCM(t *testing.T) {
	pcm := make([]byte, 3200)
	got, err := normalizeAudio(context.Background(), pcm, "pcm_s16le")
	if err != nil || len(got) != len(pcm) {
		t.Fatalf("normalize PCM failed: len=%d err=%v", len(got), err)
	}
}

func TestNormalizeMP3(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg is not installed")
	}
	adapter, err := gcfg.NewAdapterContent(`{"voice":{"ffmpeg":"ffmpeg"}}`)
	if err != nil {
		t.Fatal(err)
	}
	previous := g.Cfg().GetAdapter()
	g.Cfg().SetAdapter(adapter)
	t.Cleanup(func() { g.Cfg().SetAdapter(previous) })
	// Stereo 48kHz input must become mono 16kHz, including MP3 encoder padding.
	mp3, err := exec.Command(ffmpeg, "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=0.2", "-ac", "2", "-f", "mp3", "pipe:1").Output()
	if err != nil {
		t.Fatalf("create MP3 fixture: %v", err)
	}
	pcm, err := normalizeAudio(context.Background(), mp3, "mp3")
	if err != nil || len(pcm) < 6400 || len(pcm) > 10000 || len(pcm)%2 != 0 {
		t.Fatalf("MP3 resampling/mono conversion failed: PCM bytes=%d err=%v", len(pcm), err)
	}
}

func TestReadRecognitionJoinsOfflineSegments(t *testing.T) {
	for _, tc := range []struct {
		name, final, want string
	}{
		{"separate-marker", `{"is_final":true}`, "第一段。第二段。"},
		{"last-segment", `{"mode":"2pass-offline","text":"第三段。","is_final":true}`, "第一段。第二段。第三段。"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			upgrader := websocket.Upgrader{}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				conn, err := upgrader.Upgrade(w, r, nil)
				if err != nil {
					return
				}
				defer conn.Close()
				for _, message := range []string{
					`{"mode":"2pass-online","text":"预览","is_final":false}`,
					`{"mode":"2pass-offline","text":"第一段。","is_final":false}`,
					`{"mode":"2pass-online","text":"另一个预览","is_final":false}`,
					`{"mode":"2pass-offline","text":"第二段。","is_final":false}`,
					tc.final,
				} {
					if err := conn.WriteMessage(websocket.TextMessage, []byte(message)); err != nil {
						return
					}
				}
			}))
			defer server.Close()
			conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
			if err != nil {
				t.Fatal(err)
			}
			defer conn.Close()
			_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
			if got, err := readRecognition(conn); err != nil || got != tc.want {
				t.Fatalf("got transcript %q, error %v; want %q", got, err, tc.want)
			}
		})
	}
}

func TestSynthesizeStreamEmitsBeforeHTTPCompletes(t *testing.T) {
	first := make(chan struct{})
	release := make(chan struct{})
	routeModels(t, func(w http.ResponseWriter, r *http.Request) {
		pcmHeaders(w)
		_, _ = w.Write(bytes.Repeat([]byte{1, 2}, 12000))
		w.(http.Flusher).Flush()
		select {
		case <-release:
			_, _ = w.Write([]byte{3, 4})
		case <-r.Context().Done():
		}
	})
	var frames [][]byte
	var events []ServerEvent
	done := make(chan error, 1)
	go func() {
		done <- synthesizeStream(context.Background(), "测试", func(value any) error {
			switch value := value.(type) {
			case ServerEvent:
				events = append(events, value)
			case AudioWAV:
				frames = append(frames, value.Data)
				if len(frames) == 1 {
					close(first)
				}
			}
			return nil
		})
	}()
	select {
	case <-first:
	case err := <-done:
		t.Fatalf("stream ended before first segment: %v", err)
	case <-time.After(2 * time.Second):
		close(release)
		t.Fatal("first segment waited for HTTP completion")
	}
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if len(frames) != 2 || len(frames[0]) != 24044 || len(frames[1]) != 46 {
		t.Fatalf("unexpected frame lengths: %v", frames)
	}
	if len(events) != 4 {
		t.Fatalf("unexpected events: %+v", events)
	}
	for i, event := range events {
		if !event.Segment || (i%2 == 0 && (event.Type != "assistant.audio.start" || event.SampleRate != 24000)) || (i%2 == 1 && event.Type != "assistant.audio.end") {
			t.Fatalf("bad segment event: %+v", event)
		}
	}
}

func TestSynthesizeStreamRejectsInvalidPCM(t *testing.T) {
	for _, tc := range []struct {
		name string
		size int
		rate string
	}{
		{"odd", 3, "24000"}, {"empty", 0, "24000"}, {"oversize", maxAudioBytes + 2, "24000"}, {"sample-rate", 4, "22050"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			routeModels(t, func(w http.ResponseWriter, r *http.Request) {
				pcmHeaders(w)
				w.Header().Set("X-Audio-Sample-Rate", tc.rate)
				_, _ = io.CopyN(w, zeroReader{}, int64(tc.size))
			})
			if err := synthesizeStream(context.Background(), "测试", func(value any) error {
				if frame, ok := value.(AudioWAV); ok && (len(frame.Data) < 46 || (len(frame.Data)-44)%2 != 0) {
					t.Fatal("invalid PCM emitted")
				}
				return nil
			}); err == nil {
				t.Fatal("invalid upstream PCM accepted")
			}
		})
	}
}

type zeroReader struct{}

func (zeroReader) Read(p []byte) (int, error) { clear(p); return len(p), nil }

func TestSynthesizeStreamCancellationStopsHTTP(t *testing.T) {
	closed := make(chan struct{})
	routeModels(t, func(w http.ResponseWriter, r *http.Request) {
		pcmHeaders(w)
		_, _ = w.Write(make([]byte, 24000))
		w.(http.Flusher).Flush()
		<-r.Context().Done()
		close(closed)
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	err := synthesizeStream(ctx, "测试", func(value any) error {
		if _, ok := value.(AudioWAV); ok {
			cancel()
		}
		return nil
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("cancel result=%v", err)
	}
	select {
	case <-closed:
	case <-time.After(2 * time.Second):
		t.Fatal("upstream request not canceled")
	}
}

func TestWaveFileHeader(t *testing.T) {
	wav := waveFile(make([]byte, 4), 24000, 1)
	if string(wav[:4]) != "RIFF" || string(wav[8:12]) != "WAVE" {
		t.Fatalf("invalid WAV header")
	}
	if got := binary.LittleEndian.Uint32(wav[40:44]); got != 4 {
		t.Fatalf("unexpected data length: %d", got)
	}
}
