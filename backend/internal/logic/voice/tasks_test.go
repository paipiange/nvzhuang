package voice

import (
	"context"
	"errors"
	"slices"
	"strings"
	"testing"

	"github.com/gogf/gf/v2/frame/g"
	"github.com/gogf/gf/v2/os/gcfg"
)

func TestTaskStatusSnapshotUsesLocalReadiness(t *testing.T) {
	status := Status{
		Models:     []Model{{Exists: true}, {Exists: true}, {}},
		Components: []Component{{}, {Available: true}, {Available: true}},
	}
	wantReady := map[string]bool{
		"download-qwen": true, "download-cosyvoice": false,
		"run-qwen": false, "run-funasr": true, "run-cosyvoice": true,
	}
	states := taskStatusSnapshot(status).Tasks
	if len(states) != len(wantReady) {
		t.Fatalf("got %d task states, want %d", len(states), len(wantReady))
	}
	for _, state := range states {
		want := pendingTask(state.Action)
		if wantReady[state.Action] {
			want.Success, want.Progress, want.Message = true, 100, "已就绪"
		}
		if state != want {
			t.Errorf("expected %+v, got %+v", want, state)
		}
	}
}

func TestMergeTaskStateRetainsActiveDownloadsAndUnreadyFailures(t *testing.T) {
	downloading := TaskState{Action: "download-qwen", Running: true, Progress: 42, Message: "正在下载模型文件", StartedAt: "started"}
	if got := mergeTaskState(downloading, Status{Models: []Model{{Exists: true}}}); got != downloading {
		t.Errorf("download progress changed: %+v", got)
	}
	failed := TaskState{Action: "run-qwen", Progress: 1, Message: "部署脚本失败", StartedAt: "started"}
	if got := mergeTaskState(failed, Status{}); got != failed {
		t.Errorf("failure details changed while the service was unavailable: %+v", got)
	}
}

func TestMergeTaskStateShowsHealthyServiceWhileRunningOrAfterFailure(t *testing.T) {
	status := Status{Components: []Component{{Available: true}}}
	for _, state := range []TaskState{
		{Action: "run-qwen", Running: true, Progress: 1, Message: "正在启动固定部署脚本", StartedAt: "started"},
		{Action: "run-qwen", Progress: 1, Message: "部署脚本失败", StartedAt: "started"},
	} {
		want := state
		want.Success, want.Progress, want.Message = true, 100, "已就绪"
		if got := mergeTaskState(state, status); got != want {
			t.Errorf("expected ready state %+v, got %+v", want, got)
		}
	}
}

func TestDeploymentScriptArgsQuotePath(t *testing.T) {
	got := deploymentScriptArgs("/mnt/d/voice project/test's/run.sh")
	want := []string{"-lc", `exec script -q -e -f -c "$1" /dev/null`, "bash", `bash -- '/mnt/d/voice project/test'"'"'s/run.sh'`}
	if !slices.Equal(got, want) {
		t.Fatalf("unexpected Bash arguments: %q, want %q", got, want)
	}
}

func TestMergeTaskStateClearsStaleSuccess(t *testing.T) {
	for _, action := range []string{"download-qwen", "run-qwen"} {
		state := TaskState{Action: action, Success: true, Progress: 100, Message: "任务完成", StartedAt: "started"}
		if got, want := mergeTaskState(state, Status{}), pendingTask(action); got != want {
			t.Errorf("expected unavailable task state %+v, got %+v", want, got)
		}
	}
}

func TestStartTaskSkipsHealthyService(t *testing.T) {
	taskMu.RLock()
	before := tasks["run-qwen"]
	taskMu.RUnlock()
	if !startTask("run-qwen", func() bool { return true }) {
		t.Fatal("a healthy service should satisfy the start request")
	}
	taskMu.RLock()
	defer taskMu.RUnlock()
	if got := tasks["run-qwen"]; got != before {
		t.Fatalf("start request changed the task state: %+v", got)
	}
}

func TestWSLEnvForwardingIncludesCosyVoiceReference(t *testing.T) {
	t.Setenv("WSLENV", "EXISTING/u")
	t.Setenv("OTHER_TEST_VAR", "not-forwarded")
	want := "WSLENV=NVZHUANG_ROOT/u:HF_TOKEN/u:HUGGINGFACE_HUB_TOKEN/u:MODELSCOPE_API_TOKEN/u:COSYVOICE_REFERENCE_TEXT/u:COSYVOICE_REFERENCE_WAV/u:COSYVOICE_LINXI_REFERENCE_TEXT/u:COSYVOICE_LINXI_REFERENCE_WAV/u:EXISTING/u"
	if wslEnvForwarding() != want {
		t.Fatal("WSLENV should forward the allowlisted variables and preserve existing entries")
	}
}

func TestDownloadProgressOnlyAfterModelDownloadBegins(t *testing.T) {
	taskMu.Lock()
	previous := tasks["download-qwen"]
	tasks["download-qwen"] = TaskState{Action: "download-qwen", Running: true}
	taskMu.Unlock()
	t.Cleanup(func() {
		taskMu.Lock()
		tasks["download-qwen"] = previous
		taskMu.Unlock()
		progressArmed.Delete("download-qwen")
	})
	progressArmed.Store("download-qwen", false)

	updateTaskProgress("download-qwen", "pip install 90%")
	if got := taskProgress("download-qwen"); got != 0 {
		t.Fatalf("pip progress should not count as model download: %d", got)
	}
	updateTaskProgress("download-qwen", "VOICE_PROGRESS_BEGIN")
	updateTaskProgress("download-qwen", "Downloading model 42%")
	if got := taskProgress("download-qwen"); got != 42 {
		t.Fatalf("expected actual model progress 42, got %d", got)
	}
}

func TestCosyVoiceTaskRequiresReferenceTranscript(t *testing.T) {
	t.Setenv("COSYVOICE_REFERENCE_TEXT", "  ")
	taskMu.Lock()
	previous := tasks["run-cosyvoice"]
	tasks["run-cosyvoice"] = TaskState{Action: "run-cosyvoice", Running: true}
	taskMu.Unlock()
	t.Cleanup(func() {
		taskMu.Lock()
		tasks["run-cosyvoice"] = previous
		taskMu.Unlock()
	})
	executeTask("run-cosyvoice", "not-launched.sh")
	taskMu.RLock()
	defer taskMu.RUnlock()
	state := tasks["run-cosyvoice"]
	if state.Running || state.Success || !strings.Contains(state.Message, "CosyVoice") {
		t.Fatalf("expected actionable reference error, got %+v", state)
	}
}

func TestVoiceTaskEnvironmentReadsConfigFile(t *testing.T) {
	adapter, err := gcfg.NewAdapterContent(`{"voice":{"root":"/srv/voice","download":{"huggingFaceToken":"yaml-hf","modelScopeToken":"yaml-ms"},"cosyvoice":{"referenceWav":"/srv/voice/reference.wav","referenceText":"authorized transcript"}}}`)
	if err != nil {
		t.Fatal(err)
	}
	previous := g.Cfg().GetAdapter()
	g.Cfg().SetAdapter(adapter)
	t.Cleanup(func() { g.Cfg().SetAdapter(previous) })
	for _, key := range []string{"NVZHUANG_ROOT", "HF_TOKEN", "HUGGINGFACE_HUB_TOKEN", "MODELSCOPE_API_TOKEN", "COSYVOICE_REFERENCE_WAV", "COSYVOICE_REFERENCE_TEXT"} {
		t.Setenv(key, "")
	}
	environment := voiceTaskEnvironment(context.Background())
	want := map[string]string{
		"NVZHUANG_ROOT":            "/srv/voice",
		"HF_TOKEN":                 "yaml-hf",
		"HUGGINGFACE_HUB_TOKEN":    "yaml-hf",
		"MODELSCOPE_API_TOKEN":     "yaml-ms",
		"COSYVOICE_REFERENCE_WAV":  "/srv/voice/reference.wav",
		"COSYVOICE_REFERENCE_TEXT": "authorized transcript",
	}
	for key, expected := range want {
		if actual := environmentValue(environment, key); actual != expected {
			t.Fatalf("unexpected %s value %q", key, actual)
		}
	}
}

func environmentValue(environment []string, key string) string {
	for _, item := range environment {
		name, value, found := strings.Cut(item, "=")
		if found && strings.EqualFold(name, key) {
			return value
		}
	}
	return ""
}

func TestTaskLogDiscardsOversizedLineAndContinues(t *testing.T) {
	const action = "download-test"
	const sensitive = "private-script-output"
	t.Cleanup(func() {
		progressArmed.Delete(action)
		taskMu.Lock()
		delete(tasks, action)
		taskMu.Unlock()
	})
	input := "VOICE_PROGRESS_BEGIN\r\n" + strings.Repeat(sensitive, maxTaskLogLine) + " 99%\n"
	scanTaskProgress(action, strings.NewReader(input))
	if got := taskProgress(action); got != 0 {
		t.Fatalf("oversized line changed progress: %d", got)
	}
	scanTaskProgress(action, strings.NewReader(input+"Downloading 34%\rDownloading 62%\n"))
	taskMu.RLock()
	defer taskMu.RUnlock()
	if state := tasks[action]; state.Progress != 62 || state.Message != "正在下载模型文件" {
		t.Fatalf("bounded scan did not recover: %+v", state)
	}
}

func TestTaskErrorDoesNotExposeRawOutput(t *testing.T) {
	const sensitive = "unrecognized-secret-or-local-path"
	if message := scriptError(errors.New(sensitive)); message == "" || strings.Contains(message, sensitive) {
		t.Fatal("script failure leaked details or returned no diagnostic")
	}
}

func TestTaskStatusShowsIncompleteDownloadAndStartingService(t *testing.T) {
	model := Model{Progress: 40, Message: "关键文件缺失"}
	state := mergeTaskState(pendingTask("download-cosyvoice"), Status{Models: []Model{{}, {}, model}})
	if state.Success || state.Progress != 40 || state.Message != model.Message {
		t.Fatalf("wrong incomplete download state: %+v", state)
	}
	state = mergeTaskState(TaskState{Action: "run-funasr", Running: true}, Status{})
	if !state.Running || state.Success || !strings.Contains(state.Message, "正在加载模型") {
		t.Fatalf("wrong starting service state: %+v", state)
	}
}

func taskProgress(action string) int {
	taskMu.RLock()
	defer taskMu.RUnlock()
	return tasks[action].Progress
}
