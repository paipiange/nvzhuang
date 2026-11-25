package voice

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

type TaskState struct {
	Action    string `json:"action"`
	Running   bool   `json:"running"`
	Success   bool   `json:"success"`
	Progress  int    `json:"progress"`
	Message   string `json:"message"`
	StartedAt string `json:"started_at,omitempty"`
}

type TaskStatus struct {
	Tasks                      []TaskState `json:"tasks"`
	HuggingFaceTokenConfigured bool        `json:"huggingface_token_configured"`
	ModelScopeTokenConfigured  bool        `json:"modelscope_token_configured"`
	SeedDuplexAPIKeyConfigured bool        `json:"seeduplex_api_key_configured"`
}

var taskMu sync.RWMutex
var tasks = map[string]TaskState{
	"download-qwen":      pendingTask("download-qwen"),
	"download-cosyvoice": pendingTask("download-cosyvoice"),
	"run-qwen":           pendingTask("run-qwen"),
	"run-funasr":         pendingTask("run-funasr"),
	"run-cosyvoice":      pendingTask("run-cosyvoice"),
}
var progressPattern = regexp.MustCompile(`(?:^|\s)(\d{1,3})%`)
var ansiPattern = regexp.MustCompile(`\x1b\[[0-9;?]*[ -/]*[@-~]`)
var progressArmed sync.Map

func TaskStatusSnapshot() TaskStatus {
	status := LocalStatus(context.Background())
	return taskStatusSnapshot(status)
}

func taskStatusSnapshot(status Status) TaskStatus {
	taskMu.RLock()
	defer taskMu.RUnlock()
	ctx := context.Background()
	out := TaskStatus{
		HuggingFaceTokenConfigured: configuredValue(ctx, "voice.download.huggingFaceToken", "HF_TOKEN", "HUGGINGFACE_HUB_TOKEN") != "",
		ModelScopeTokenConfigured:  configuredValue(ctx, "voice.download.modelScopeToken", "MODELSCOPE_API_TOKEN") != "",
		SeedDuplexAPIKeyConfigured: seedDuplexAPIKey(ctx) != "",
	}
	for _, action := range []string{"download-qwen", "download-cosyvoice", "run-qwen", "run-funasr", "run-cosyvoice"} {
		out.Tasks = append(out.Tasks, mergeTaskState(tasks[action], status))
	}
	return out
}

func mergeTaskState(state TaskState, status Status) TaskState {
	// A working model or service supersedes a previous failure. An active download still reports its actual progress.
	if state.Running && strings.HasPrefix(state.Action, "download-") {
		return state
	}
	if taskReady(state.Action, status) {
		state.Success = true
		state.Progress = 100
		state.Message = "已就绪"
		return state
	}
	if state.Success {
		state = pendingTask(state.Action)
	}
	if state.Running && strings.HasPrefix(state.Action, "run-") {
		state.Message = "进程运行中，正在加载模型或等待服务健康。请稍后重试并检查服务日志。"
	} else if state.StartedAt == "" {
		if model, ok := downloadModel(state.Action, status); ok && model.Message != "" {
			state.Progress, state.Message = model.Progress, model.Message
		}
	}
	return state
}

func downloadModel(action string, status Status) (Model, bool) {
	var index int
	switch action {
	case "download-qwen":
		index = 0
	case "download-cosyvoice":
		index = 2
	default:
		return Model{}, false
	}
	if len(status.Models) <= index {
		return Model{}, false
	}
	return status.Models[index], true
}

func taskReady(action string, status Status) bool {
	if model, ok := downloadModel(action, status); ok {
		return model.Exists
	}
	switch action {
	case "run-qwen":
		return len(status.Components) > 0 && status.Components[0].Available
	case "run-funasr":
		return len(status.Components) > 1 && status.Components[1].Available
	case "run-cosyvoice":
		return len(status.Components) > 2 && status.Components[2].Available
	}
	return false
}

func pendingTask(action string) TaskState {
	message := "未启动"
	if strings.HasPrefix(action, "download-") {
		message = "待下载"
	}
	return TaskState{Action: action, Message: message}
}

func StartTask(action string) bool {
	return startTask(action, func() bool {
		return taskReady(action, LocalStatus(context.Background()))
	})
}

func startTask(action string, serviceReady func() bool) bool {
	scripts := map[string]string{
		"download-qwen":      "download-qwen.sh",
		"download-cosyvoice": "download-cosyvoice.sh",
		"run-qwen":           "run-qwen.sh",
		"run-funasr":         "run-funasr.sh",
		"run-cosyvoice":      "run-cosyvoice.sh",
	}
	script, ok := scripts[action]
	if !ok {
		return false
	}
	ready := strings.HasPrefix(action, "run-") && serviceReady()
	taskMu.Lock()
	if tasks[action].Running {
		taskMu.Unlock()
		return false
	}
	if ready {
		taskMu.Unlock()
		return true
	}
	tasks[action] = TaskState{Action: action, Running: true, Progress: 1, Message: "正在启动固定部署脚本", StartedAt: time.Now().UTC().Format(time.RFC3339)}
	taskMu.Unlock()
	progressArmed.Store(action, false)
	go executeTask(action, script)
	return true
}

func executeTask(action, script string) {
	ctx := context.Background()
	if action == "run-cosyvoice" && configuredValue(ctx, "voice.cosyvoice.referenceText", "COSYVOICE_REFERENCE_TEXT") == "" {
		finishTask(action, false, "请先在 .env 或 config.yaml 配置 CosyVoice 参考音频文本")
		return
	}
	command, err := scriptCommand(ctx, script)
	if err != nil {
		finishTask(action, false, scriptError(err))
		return
	}
	stdout, err := command.StdoutPipe()
	if err != nil {
		finishTask(action, false, "无法连接部署脚本输出")
		return
	}
	stderr, err := command.StderrPipe()
	if err != nil {
		finishTask(action, false, "无法连接部署脚本错误输出")
		return
	}
	if err := command.Start(); err != nil {
		finishTask(action, false, scriptError(err))
		return
	}
	var readers sync.WaitGroup
	readers.Add(2)
	readProgress := func(pipe io.Reader) {
		defer readers.Done()
		scanTaskProgress(action, pipe)
	}
	go readProgress(stdout)
	go readProgress(stderr)
	readers.Wait()
	waitErr := command.Wait()
	if waitErr != nil {
		finishTask(action, false, scriptError(waitErr))
		return
	}
	finishTask(action, true, "任务完成")
}

func scriptCommand(ctx context.Context, script string) (*exec.Cmd, error) {
	working, err := os.Getwd()
	if err != nil {
		return nil, err
	}
	deployDir := filepath.Join("backend", "manifest", "deploy", "nvzhuang-voice-local")
	candidate := filepath.Join(working, deployDir, script)
	if _, err := os.Stat(candidate); err != nil {
		candidate = filepath.Join(working, "manifest", "deploy", "nvzhuang-voice-local", script)
	}
	if _, err := os.Stat(candidate); err != nil {
		return nil, err
	}
	if runtime.GOOS == "windows" {
		pathResult, err := exec.Command("wsl.exe", "wslpath", "-a", filepath.Dir(candidate)).Output()
		if err != nil {
			return nil, err
		}
		wslScript := strings.TrimSpace(string(pathResult)) + "/" + script
		args := append([]string{"-e", "bash"}, deploymentScriptArgs(wslScript)...)
		cmd := exec.CommandContext(ctx, "wsl.exe", args...)
		cmd.Env = upsertEnvironment(voiceTaskEnvironment(ctx), "WSLENV", strings.TrimPrefix(wslEnvForwarding(), "WSLENV="))
		return cmd, nil
	}
	cmd := exec.CommandContext(ctx, "bash", deploymentScriptArgs(candidate)...)
	cmd.Dir = filepath.Dir(candidate)
	cmd.Env = voiceTaskEnvironment(ctx)
	return cmd, nil
}

func voiceTaskEnvironment(ctx context.Context) []string {
	environment := append([]string(nil), os.Environ()...)
	values := map[string]string{
		"NVZHUANG_ROOT":                  configuredValue(ctx, "voice.root", "NVZHUANG_ROOT"),
		"HF_TOKEN":                       configuredValue(ctx, "voice.download.huggingFaceToken", "HF_TOKEN", "HUGGINGFACE_HUB_TOKEN"),
		"HUGGINGFACE_HUB_TOKEN":          configuredValue(ctx, "voice.download.huggingFaceToken", "HUGGINGFACE_HUB_TOKEN", "HF_TOKEN"),
		"MODELSCOPE_API_TOKEN":           configuredValue(ctx, "voice.download.modelScopeToken", "MODELSCOPE_API_TOKEN"),
		"COSYVOICE_REFERENCE_WAV":        configuredValue(ctx, "voice.cosyvoice.referenceWav", "COSYVOICE_REFERENCE_WAV"),
		"COSYVOICE_REFERENCE_TEXT":       configuredValue(ctx, "voice.cosyvoice.referenceText", "COSYVOICE_REFERENCE_TEXT"),
		"COSYVOICE_LINXI_REFERENCE_WAV":  configuredValue(ctx, "voice.cosyvoice.linxiReferenceWav", "COSYVOICE_LINXI_REFERENCE_WAV"),
		"COSYVOICE_LINXI_REFERENCE_TEXT": configuredValue(ctx, "voice.cosyvoice.linxiReferenceText", "COSYVOICE_LINXI_REFERENCE_TEXT"),
	}
	for key, value := range values {
		if value != "" {
			environment = upsertEnvironment(environment, key, value)
		}
	}
	return environment
}

func upsertEnvironment(environment []string, key, value string) []string {
	prefix := key + "="
	for index, item := range environment {
		name, _, found := strings.Cut(item, "=")
		if found && strings.EqualFold(name, key) {
			environment[index] = prefix + value
			return environment
		}
	}
	return append(environment, prefix+value)
}

func deploymentScriptArgs(path string) []string {
	return []string{"-lc", `exec script -q -e -f -c "$1" /dev/null`, "bash", "bash -- " + shellQuote(path)}
}

func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\"'\"'") + "'"
}

func wslEnvForwarding() string {
	keys := []string{"NVZHUANG_ROOT/u", "HF_TOKEN/u", "HUGGINGFACE_HUB_TOKEN/u", "MODELSCOPE_API_TOKEN/u", "COSYVOICE_REFERENCE_TEXT/u", "COSYVOICE_REFERENCE_WAV/u", "COSYVOICE_LINXI_REFERENCE_TEXT/u", "COSYVOICE_LINXI_REFERENCE_WAV/u"}
	old := os.Getenv("WSLENV")
	if old != "" {
		keys = append(keys, old)
	}
	return "WSLENV=" + strings.Join(keys, ":")
}

func updateTaskProgress(action, output string) {
	output = ansiPattern.ReplaceAllString(output, "")
	if strings.TrimSpace(output) == "VOICE_PROGRESS_BEGIN" {
		progressArmed.Store(action, true)
		return
	}
	armed, _ := progressArmed.Load(action)
	if armed != true {
		return
	}
	match := progressPattern.FindStringSubmatch(output)
	if len(match) != 2 {
		return
	}
	progress, err := strconv.Atoi(match[1])
	if err == nil && progress >= 0 && progress <= 100 {
		taskMu.Lock()
		state := tasks[action]
		state.Progress = progress
		state.Message = "正在下载模型文件"
		tasks[action] = state
		taskMu.Unlock()
	}
}

func finishTask(action string, success bool, message string) {
	taskMu.Lock()
	defer taskMu.Unlock()
	state := tasks[action]
	state.Running = false
	state.Success = success
	if success {
		state.Progress = 100
	}
	state.Message = message
	tasks[action] = state
}

const maxTaskLogLine = 4096

func scanTaskProgress(action string, pipe io.Reader) {
	if !strings.HasPrefix(action, "download-") {
		_, _ = io.Copy(io.Discard, pipe)
		return
	}
	scanner := bufio.NewScanner(pipe)
	scanner.Buffer(make([]byte, maxTaskLogLine), maxTaskLogLine)
	discardLine := false
	scanner.Split(func(data []byte, atEOF bool) (int, []byte, error) {
		if end := bytes.IndexAny(data, "\r\n"); end >= 0 {
			if discardLine {
				discardLine = false
				return end + 1, nil, nil
			}
			return end + 1, data[:end], nil
		}
		if len(data) >= maxTaskLogLine {
			discardLine = true
			return len(data), nil, nil
		}
		if atEOF && len(data) > 0 {
			if discardLine {
				return len(data), nil, nil
			}
			return len(data), data, nil
		}
		return 0, nil, nil
	})
	for scanner.Scan() {
		updateTaskProgress(action, scanner.Text())
	}
}

func scriptError(err error) string {
	if errors.Is(err, exec.ErrNotFound) || errors.Is(err, os.ErrNotExist) {
		return "未找到部署脚本或运行程序。请检查项目文件、WSL2 和 Bash 是否可用。"
	}
	var exited *exec.ExitError
	if errors.As(err, &exited) {
		switch exited.ExitCode() {
		case 3, 126, 127:
			return "部署依赖或配置缺失。请检查模型文件、WSL/Docker、Conda 及授权参考音频。"
		case 98, 10048:
			return "服务端口已被占用。请检查是否已有服务实例或其他程序监听该端口。"
		}
	}
	return "部署任务失败。请检查服务日志、依赖与端口，下载任务另需检查网络和磁盘空间。"
}
