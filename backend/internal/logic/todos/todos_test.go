package todos

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"sync"
	"testing"

	"github.com/gogf/gf/v2/frame/g"
	"github.com/gogf/gf/v2/os/gcfg"
)

func TestSummarize(t *testing.T) {
	got := summarize([]Item{{Completed: true}, {Completed: false}, {Completed: true}})
	if got.Total != 3 || got.Completed != 2 || got.Progress != 66 {
		t.Fatalf("unexpected summary: %+v", got)
	}
}

func TestSummarizeEmpty(t *testing.T) {
	got := summarize(nil)
	if got.Total != 0 || got.Completed != 0 || got.Progress != 0 {
		t.Fatalf("unexpected empty summary: %+v", got)
	}
}

// These tests deliberately omit database configuration and isolate all state in TempDir.
func localState(t *testing.T) (context.Context, string) {
	t.Helper()
	root := t.TempDir()
	content, err := json.Marshal(map[string]any{"voice": map[string]string{"root": root}})
	if err != nil {
		t.Fatal(err)
	}
	adapter, err := gcfg.NewAdapterContent(string(content))
	if err != nil {
		t.Fatal(err)
	}
	previous := g.Cfg().GetAdapter()
	g.Cfg().SetAdapter(adapter)
	defaults := append([]Item(nil), memory...)
	t.Cleanup(func() {
		g.Cfg().SetAdapter(previous)
		if !reflect.DeepEqual(memory, defaults) {
			t.Error("local persistence mutated global default memory")
		}
	})
	if dbOrNil() != nil {
		t.Fatal("local test unexpectedly has database configuration")
	}
	ctx := context.Background()
	filename := filepath.Join(root, "data", "voice-todos.json")
	if got := localPath(ctx); got != filename {
		t.Fatalf("state path escaped temporary root: %q", got)
	}
	return ctx, filename
}

func assertItem(t *testing.T, summary Summary, id int64, completed bool) {
	t.Helper()
	for _, item := range summary.Items {
		if item.ID == id {
			if item.Completed != completed {
				t.Fatalf("item %d completed=%v, want %v", id, item.Completed, completed)
			}
			return
		}
	}
	t.Fatalf("missing item %d", id)
}

func readState(t *testing.T, filename string) []byte {
	t.Helper()
	data, err := os.ReadFile(filename)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestLocalStatePersistsCompletionAndCancellation(t *testing.T) {
	ctx, filename := localState(t)
	initial, err := SummaryFor(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(initial.Items, memory) {
		t.Fatalf("new state does not match defaults: %+v", initial)
	}
	if _, err := os.Stat(filename); !os.IsNotExist(err) {
		t.Fatalf("reading defaults created state: %v", err)
	}
	id := memory[1].ID
	for _, completed := range []bool{true, true, false, false, true, false} {
		updated, found, err := SetCompleted(ctx, id, completed)
		if err != nil || !found {
			t.Fatalf("set completed=%v: found=%v err=%v", completed, found, err)
		}
		assertItem(t, updated, id, completed)
		for i := 0; i < 3; i++ {
			loaded, err := SummaryFor(ctx)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(loaded, updated) {
				t.Fatalf("read %d lost persisted update: got %+v, want %+v", i, loaded, updated)
			}
		}
	}
	var states map[string]json.RawMessage
	if err := json.Unmarshal(readState(t, filename), &states); err != nil {
		t.Fatal(err)
	}
	if len(states) != len(memory) {
		t.Fatalf("unexpected persisted field count: %d", len(states))
	}
	for _, item := range memory {
		value, ok := states[item.Code]
		if !ok || (string(value) != "true" && string(value) != "false") {
			t.Fatalf("state must contain only fixed code/bool pairs: %q=%s", item.Code, value)
		}
	}
	entries, err := os.ReadDir(filepath.Dir(filename))
	if err != nil || len(entries) != 1 || entries[0].Name() != filepath.Base(filename) {
		t.Fatalf("temporary write files leaked: %v, %v", entries, err)
	}
}

func TestUnknownIDDoesNotWriteLocalState(t *testing.T) {
	ctx, filename := localState(t)
	for _, id := range []int64{-1, 0, 99999} {
		if _, found, err := SetCompleted(ctx, id, true); err != nil || found {
			t.Fatalf("unknown id %d: found=%v err=%v", id, found, err)
		}
	}
	if _, err := os.Stat(filepath.Dir(filename)); !os.IsNotExist(err) {
		t.Fatalf("unknown id created state directory: %v", err)
	}
	if _, found, err := SetCompleted(ctx, memory[0].ID, false); err != nil || !found {
		t.Fatalf("seed state: found=%v err=%v", found, err)
	}
	before := readState(t, filename)
	for _, id := range []int64{-1, 0, 99999} {
		if _, found, err := SetCompleted(ctx, id, true); err != nil || found {
			t.Fatalf("unknown id %d: found=%v err=%v", id, found, err)
		}
		if after := readState(t, filename); string(after) != string(before) {
			t.Fatalf("unknown id %d rewrote existing state", id)
		}
	}
}

func TestInvalidLocalStateIsRejectedWithoutOverwrite(t *testing.T) {
	for name, data := range map[string]string{
		"corrupt":        "{broken",
		"null":           "null",
		"oversize":       strings.Repeat(" ", 64*1024) + "{}",
		"nonbool":        `{"models":"true"}`,
		"null-member":    `{"models":null}`,
		"null-unknown":   `{"future-task":null}`,
		"null-duplicate": `{"models":null,"models":true}`,
	} {
		t.Run(name, func(t *testing.T) {
			ctx, filename := localState(t)
			if err := os.MkdirAll(filepath.Dir(filename), 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filename, []byte(data), 0600); err != nil {
				t.Fatal(err)
			}
			if _, err := SummaryFor(ctx); err == nil {
				t.Fatal("invalid state was accepted by read")
			}
			if _, found, err := SetCompleted(ctx, memory[0].ID, false); err == nil || found {
				t.Fatalf("invalid state update claimed success: found=%v err=%v", found, err)
			}
			if after := readState(t, filename); string(after) != data {
				t.Fatal("invalid state was overwritten")
			}
		})
	}
}

func TestLocalStateIOErrorsDoNotClaimSuccess(t *testing.T) {
	t.Run("unwritable-parent-is-file", func(t *testing.T) {
		ctx, filename := localState(t)
		parent := filepath.Dir(filename)
		if err := os.WriteFile(parent, []byte("keep parent"), 0600); err != nil {
			t.Fatal(err)
		}
		if _, found, err := SetCompleted(ctx, memory[0].ID, false); err == nil || found {
			t.Fatalf("unwritable state path claimed success: found=%v err=%v", found, err)
		}
		if got := string(readState(t, parent)); got != "keep parent" {
			t.Fatal("parent blocker was modified")
		}
	})
	t.Run("state-is-directory", func(t *testing.T) {
		ctx, filename := localState(t)
		if err := os.MkdirAll(filename, 0700); err != nil {
			t.Fatal(err)
		}
		if _, err := SummaryFor(ctx); err == nil {
			t.Fatal("directory was accepted as state file")
		}
		if _, found, err := SetCompleted(ctx, memory[0].ID, false); err == nil || found {
			t.Fatalf("directory state update claimed success: found=%v err=%v", found, err)
		}
		info, err := os.Stat(filename)
		if err != nil || !info.IsDir() {
			t.Fatalf("state directory was replaced: %v", err)
		}
	})
	t.Run("read-only-target", func(t *testing.T) {
		if runtime.GOOS != "windows" {
			t.Skip("read-only target replacement is protected by Windows file attributes")
		}
		ctx, filename := localState(t)
		if _, found, err := SetCompleted(ctx, memory[0].ID, true); err != nil || !found {
			t.Fatalf("seed state: found=%v err=%v", found, err)
		}
		before := readState(t, filename)
		if err := os.Chmod(filename, 0400); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = os.Chmod(filename, 0600) })
		if _, found, err := SetCompleted(ctx, memory[0].ID, false); err == nil || found {
			t.Fatalf("read-only state update claimed success: found=%v err=%v", found, err)
		}
		if after := readState(t, filename); string(after) != string(before) {
			t.Fatal("read-only state was changed")
		}
	})
}

func TestConcurrentUpdatesKeepDifferentItems(t *testing.T) {
	ctx, _ := localState(t)
	start := make(chan struct{})
	errors := make(chan error, len(memory))
	var workers sync.WaitGroup
	for _, item := range memory {
		workers.Add(1)
		go func(item Item) {
			defer workers.Done()
			<-start
			for _, completed := range []bool{!item.Completed, item.Completed, !item.Completed} {
				if _, found, err := SetCompleted(ctx, item.ID, completed); err != nil {
					errors <- err
					return
				} else if !found {
					t.Errorf("concurrent update lost item %d", item.ID)
					return
				}
			}
		}(item)
	}
	close(start)
	workers.Wait()
	close(errors)
	for err := range errors {
		t.Errorf("concurrent write failed: %v", err)
	}
	loaded, err := SummaryFor(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range memory {
		assertItem(t, loaded, item.ID, !item.Completed)
	}
}
