# nvzhuang AI 女友完全本地实时语音 · D 盘固定目录版

**唯一根目录（不可改动）：`D:\ai\ai\nvzhuang`**

- Windows：`D:\ai\ai\nvzhuang`
- WSL2 Ubuntu：`/mnt/d/ai/ai/nvzhuang`
- ZIP 只包含脚本/文档，**不包含模型权重、Docker 镜像或依赖**。
- 首次下载模型和环境需要联网；下载完成之后，推理可以离线运行。
- 方案基于 Windows 11 + Docker Desktop (WSL2) + NVIDIA 4080 级显卡（16GB 显存），还需要接入 nvzhuang 的 GoFrame v2 和 UniApp 代码；ZIP 本身不是完整成品 App。

## 1. 先把 ZIP 解压，固定目录一次配置

建议把本压缩包解压到：`D:\ai\ai\nvzhuang\deploy\nvzhuang-voice-local\`。实际上脚本放在任意目录执行也会把模型和缓存写入固定的 D: 根目录。

在 Windows PowerShell 执行：

```powershell
cd D:\ai\ai\nvzhuang\deploy\nvzhuang-voice-local
powershell -ExecutionPolicy Bypass -File .\setup-windows.ps1
```

> 注意：如果首次解压时 D:\ai\ai\nvzhuang\deploy 尚不存在，可以直接把 ZIP 解压到 D:\ai\ai\nvzhuang，然后按实际目录运行脚本。

在 WSL Ubuntu 终端进入包目录（例如）：

```bash
cd /mnt/d/ai/ai/nvzhuang/deploy/nvzhuang-voice-local
bash setup-wsl.sh
bash verify-paths.sh
```

## 2. 全部模型及缓存路径

```text
D:\ai\ai\nvzhuang\
├── models\
│   ├── qwen\                 Qwen3-4B-Instruct-2507-Q4_K_M.gguf
│   ├── funasr\               Paraformer streaming/offline/VAD/punc/ITN
│   └── cosyvoice3\           Fun-CosyVoice3-0.5B\ (所有权重和配置)
├── cache\
│   ├── huggingface\         hub + hf-xet + datasets
│   ├── modelscope\          ModelScope 模型下载缓存
│   ├── pip\                 Python 包下载缓存
│   ├── conda\pkgs\         Conda 下载/解压缓存
│   ├── torch\               Torch hub 缓存
│   ├── torchinductor\       TorchInductor 编译缓存
│   ├── triton\              Triton 内核缓存
│   ├── cuda\                CUDA JIT 缓存
│   ├── numba\               Numba 编译缓存
│   ├── pycache\             Python 字节码缓存
│   ├── uv\                  uv 包缓存
│   ├── xdg\                 其他 Linux 应用用户缓存
│   ├── tmp\                 运行临时文件
│   └── ...                  Go/PIP/LFS 等其他缓存
├── envs\                     downloader/CosyVoice Python 虚拟环境
├── src\CosyVoice\           CosyVoice 源码
├── voices\                   授权使用的角色 WAV 音色参考
├── docker\disk\              Docker Desktop 镜像层所在磁盘位置（需手动设置）
├── logs\
├── data\
└── deploy\nvzhuang-voice-local\
```

**所有由本包下载/启动脚本主动配置的模型及应用缓存均在上述目录下**。环境变量集中在 `env.local.sh`；不要手动在其他路径下载模型，也不要绕过脚本运行 `hf`、ModelScope 或 CosyVoice 服务。所有 shell 命令在 **WSL Ubuntu** 执行（不是 PowerShell），所有 Docker 操作也从 WSL Ubuntu 执行。

## 3. 必须单独调整 Docker Desktop 存储位置

`compose.llm.yaml` 的 volume 只能控制模型和应用缓存，**无法改变 Docker Desktop 镜像、容器层、build 缓存所在的虚拟磁盘位置**。

打开 Windows **Docker Desktop → Settings → Resources → Advanced → Disk image location**，选择：

```text
D:\ai\ai\nvzhuang\docker\disk
```

按 Docker Desktop 提示应用/迁移，检查其显示的新位置；不要把旧数据目录直接删掉。Docker GUI 设置可能随版本变化，如迁移失败应先解决 Docker Desktop 报错后再拉镜像。

**WSL Ubuntu 发行版的系统磁盘**可能仍是 C: 的 ext4.vhdx；本包只能控制下载模型、软件环境和业务缓存放 D:，不会自动迁移 Ubuntu 虚拟磁盘。若还要求 Ubuntu 系统盘也完全放 D:，应单独使用官方 WSL 迁移/安装位置功能，并做备份。Windows NVIDIA 驱动或 Docker 软件自身的操作系统级缓存也不能通过业务脚本保证全部在 D:。

## 4. 下载 Qwen3 4B 4-bit（放到 D:\...\models\qwen）

首次需要 WSL Ubuntu 内有 `python3-venv`：

```bash
sudo apt-get update
sudo apt-get install -y python3-venv git
bash download-qwen.sh
bash run-qwen.sh
curl http://127.0.0.1:8080/health
```

`download-qwen.sh` 会创建 `/mnt/d/ai/ai/nvzhuang/envs/downloader`，把 HF 下载缓存写进 D:\ai\ai\nvzhuang\cache，权重写到 D:\ai\ai\nvzhuang\models\qwen。`run-qwen.sh` 会验证实际 GGUF 文件存在才启动容器。

## 5. FunASR Paraformer Streaming（放到 D:\...\models\funasr）

```bash
bash run-funasr.sh
```

该脚本在 Docker 容器内定位官方 `run_server_2pass.sh` 并启动 2pass CPU 服务；模型写到挂载的 `/workspace/models`，宿主机对应 **D:\ai\ai\nvzhuang\models\funasr**。ModelScope、XDG、临时目录、HOME 分别通过 bind mount 映射到 D:\ai\ai\nvzhuang\cache 下，不应落到容器不可见层。

服务端口：本地 `127.0.0.1:10096`（WebSocket 协议，非 HTTP 页面）。第一次启动会下载多个 ASR/VAD/ITN 模型，需要联网。脚本前台运行，Ctrl+C 退出。

如官方基础镜像的内部路径或启动参数变化，按官方 quick_start 核查： https://github.com/modelscope/FunASR/blob/main/runtime/quick_start.md

## 6. CosyVoice 3（模型和 Python env 都放 D:）

先在 WSL Ubuntu 内安装并初始化 **conda / Miniforge**（建议 Miniforge 本体也安装到 `D:\ai\ai\nvzhuang\tools\miniforge`，避免额外占 C:）。再执行：

```bash
sudo apt-get update
sudo apt-get install -y git git-lfs ffmpeg sox libsox-dev
bash download-cosyvoice.sh
```

脚本会：

1. clone 源码到 `D:\ai\ai\nvzhuang\src\CosyVoice`。
2. 把 conda env 创建到 `D:\ai\ai\nvzhuang\envs\cosyvoice`。
3. 下载完整 CosyVoice 3 到 `D:\ai\ai\nvzhuang\models\cosyvoice3\Fun-CosyVoice3-0.5B`。
4. 把 pip/ModelScope/Torch/Triton/CUDA/临时缓存留在 `D:\ai\ai\nvzhuang\cache`。

把自己录制或获得授权的参考音频转换成 16kHz 单声道 WAV 并存入：

```text
D:\ai\ai\nvzhuang\voices\xiaotao_16k.wav
```

启动：

```bash
export COSYVOICE_REFERENCE_TEXT='这里填写参考 WAV 实际说出的完整文字'
bash run-cosyvoice.sh
```

测试：

```bash
curl http://127.0.0.1:50000/health
curl -N -X POST http://127.0.0.1:50000/tts/stream \
 -H 'Content-Type: application/json' \
 -d '{"text":"今天想跟你聊聊天。"}' \
 --output /mnt/d/ai/ai/nvzhuang/cache/tmp/reply.pcm
ffplay -f s16le -ar 24000 -ac 1 /mnt/d/ai/ai/nvzhuang/cache/tmp/reply.pcm
```

参考文本必须与 WAV 匹配；错误的提示文本可能导致极短或内容错误的输出。建议使用清晰、短于 30 秒的单人授权录音。服务会在启动时将参考特征缓存在内存中，后续回合复用，不保存用户会话或音色数据库。封装已通过实际 GPU 合成和本机识别回环测试；主观音色、自然度与真人麦克风效果仍需在目标音频设备上试听确认。上游版本可能改变 API，升级后应重新执行同目录的 `test_cosyvoice_server.py` 和真实合成检查。

## 7. 集成 nvzhuang 原项目

- GoFrame v2 业务后端统一对外 WebSocket `/api/v1/companions/voice/ws`。
- GoFrame 只对接 `127.0.0.1:8080` (Qwen)、`127.0.0.1:10096` (FunASR)、`127.0.0.1:50000` (CosyVoice)。
- 如果 GoFrame 在另一个容器内，不能把服务端口的 127.0.0.1 当作宿主机，应使用可达的容器 DNS 或网关，并保证不暴露公网。
- H5 / Android WebView 使用 Web Audio 转换为 16 kHz 单声道 PCM；UniApp 原生 Android 使用 MP3 分片或录音临时文件，由后端 ffmpeg 转为 PCM。回复以 WAV 播放，支持字幕和打断；H5 请求设备回声消除能力，实际效果取决于设备。当前本地链路按轮识别输入，但合成音频会按约 0.5 秒的独立 WAV 片段发送并排队播放，首片到达即可播放；生成结束且队列播放完后回到空闲。
- 使用 `turn_id`、取消 Context 防止旧轮对话音频串入下一轮；每个连接仅在内存保留最多 6 轮 / 6000 字符的成功对话。`session.reset` 清空记忆，重连也会清空；取消和失败回合不写入历史。
- 状态接口检查固定版本关键文件是否非空、Qwen GGUF 头部及预期字节数，以及真正的服务健康 JSON。关键文件齐备不等同于完整内容或哈希校验，更新模型版本时需要同步检查清单与预期文件长度。
- 若需要完全离线使用，应先下载所有权重、依赖和镜像，再测试断网启动；首装不能离线完成。

## 8. 验证每条模型/缓存路径

```bash
bash verify-paths.sh
```

测试检查配置环境变量、Docker bind mount 是否全部属于 `/mnt/d/ai/ai/nvzhuang`。该检查**无法证明**第三方库是否私自写入其他缓存，也无法检查 Windows 内核或系统软件自身的缓存。运行时还可通过 `du -sh /mnt/d/ai/ai/nvzhuang/*` 和 `docker system df` 检查增长。

## 参考

- Hugging Face 环境变量：https://huggingface.co/docs/huggingface_hub/package_reference/environment_variables
- FunASR 官方部署：https://github.com/modelscope/FunASR/blob/main/runtime/quick_start.md
- CosyVoice：https://github.com/QwenAudio/CosyVoice
- llama.cpp CUDA Docker：https://github.com/ggml-org/llama.cpp/blob/master/docs/docker.md
- Docker Desktop WSL2 镜像磁盘：https://docs.docker.com/desktop/features/wsl/
- NVIDIA CUDA_CACHE_PATH：https://docs.nvidia.com/cuda/cuda-programming-guide/05-appendices/environment-variables.html
