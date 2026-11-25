# 本地语音运行清单

## 1. 配置令牌（仅进程环境）

不要把真实 token 写入 Git、`config.yaml`、MySQL 或 App。PowerShell 启动后端前，用安全输入提示设置当前进程环境（不写入用户/系统环境）：

```powershell
function Set-ProcessSecret($Name) {
  $secure = Read-Host $Name -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { [Environment]::SetEnvironmentVariable($Name, [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr), 'Process') }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
Set-ProcessSecret 'HF_TOKEN'
Set-ProcessSecret 'MODELSCOPE_API_TOKEN'
```

只使用公开模型时，可跳过对应 token 提示。后端只返回 `已配置/未配置`，不会返回 token 内容。

## 2. 启动后端

后端任务执行器固定调用项目内 `backend/manifest/deploy/nvzhuang-voice-local/` 下的脚本，并通过 WSLENV 将上述环境变量转发给 WSL。需要提前安装并启动 WSL2、Docker Desktop、ffmpeg；CosyVoice 还需要 Miniforge/Conda 和授权参考 WAV。

CosyVoice 启动前必须设置与参考 WAV 内容逐字匹配的 `COSYVOICE_REFERENCE_TEXT`，并可用 `COSYVOICE_REFERENCE_WAV` 指向同一数据目录内的授权 WAV（WSL 路径）。建议使用清晰、短于 30 秒的单人录音；不要用默认问候语代替实际录音文本，否则可能生成极短或错误的语音。参考特征仅缓存在服务进程内，不写入音色数据库。

## 3. MuMu

1. 仓库 Android WebView 封装：在 `app` 执行 `pnpm build:h5`，将 `app/dist/build/h5/` 内容复制到 `android/app/src/main/assets/www/`，再在 `android` 执行 `gradle :app:assembleDebug`。需要 JDK 17、Android SDK 34 和 Gradle 8.6；Windows 中文路径需额外传 `-Pandroid.overridePathCheck=true`。调试包使用 `.debug` 后缀，可与正式包共存。原生 UniApp 包则执行 `pnpm build:app`，将 `app/dist/build/app/` 导入 HBuilderX 运行。
2. App 页面：`我的 -> 本地语音接入`。WebView 使用浏览器麦克风采集并转成 16kHz 单声道 PCM；UniApp 原生包使用 MP3 分片，缺少分片时回退读取本轮临时文件。回复使用 WAV 播放，结束、打断及离开页面后清理播放资源。
3. 先点击 Qwen/CosyVoice 下载按钮；FunASR 在启动服务时下载。
4. 再依次启动 Qwen、FunASR、CosyVoice 服务。
5. 在服务设置中把后端地址设为 MuMu 可访问的宿主机地址，不要使用 MuMu 内的 `127.0.0.1` 指向宿主机。
6. 首次开始说话时允许麦克风权限。H5 页面显示 RMS / 峰值输入电平；若 Windows 未连接物理麦克风，MuMu 即使提供虚拟内置麦克风也可能录到全静音。页面会提示检查宿主输入设备，并取消发送全静音录音。输入电平有变化只代表收到信号，不代表人声或识别一定成功。

本地 Qwen 的回复以约 0.5 秒的独立 WAV 片段顺序播放，不再等待整段合成完毕。生成结束与播放结束分别处理，全部片段播放完后才允许下一轮；打断会取消生成并清空剩余播放队列。当前连接仅在内存保留最近 6 轮、最多 6000 字符的成功对话；点击「清空会话记忆」、重连或退出连接会清空，不写入文件、日志或数据库。

模型就绪检查核对固定版本关键文件是否齐全、GGUF 基础头部及预期长度，并检查服务健康响应。页面会展示缺失文件或服务加载/错误提示。这些是基础就绪检查，不等同于密码学哈希校验或完整权重验证。

## 4. API

- `GET /api/v1/voice/tasks`：任务状态、真实下载百分比、令牌是否配置（不返回 token）。
- `POST /api/v1/voice/tasks/download-qwen`
- `POST /api/v1/voice/tasks/download-cosyvoice`
- `POST /api/v1/voice/tasks/run-qwen`
- `POST /api/v1/voice/tasks/run-funasr`
- `POST /api/v1/voice/tasks/run-cosyvoice`
- `GET /api/v1/voice/ws`：UniApp 语音 WebSocket。

协议及内存生命周期见 `backend/manifest/deploy/nvzhuang-voice-local/voice.protocol.md`。Node.js 22 及以上可使用以下命令对已启动的本机服务做连续回合验收（仅接受回环 WebSocket 地址，不输出对话正文）：

```powershell
node scripts/verify-local-voice.mjs --audio authorized-test-16k.pcm --rounds 25
```

输入必须是已授权的 16kHz 单声道 PCM16LE 裸音频，最多 2 MiB；可用 `ffmpeg -i input.wav -ar 16000 -ac 1 -f s16le authorized-test-16k.pcm` 转换。脚本检查音频格式、回合完成、取消及重连恢复，输出耗时与计数；它不验证真人麦克风或主观音色。

## 5. 豆包 SeedDuplex 3.0（可选全双工 provider）

后端支持豆包实时语音模型 3.0 的 Realtime WebSocket 协议。配置当前进程环境变量：

```powershell
Set-ProcessSecret 'SEEDUPLEX_API_KEY'
$env:SEEDUPLEX_RESOURCE_ID = 'volc.speech.dialog'
$env:SEEDUPLEX_MODEL = '1.2.6.1'
$env:SEEDUPLEX_VOICE = 'zh_female_vv_jupiter_bigtts'
```

可选覆盖：`SEEDUPLEX_WS_URL`、`FFMPEG_PATH`。API Key 只在 GoFrame 进程内使用，不返回 App、不写入日志或数据库。

页面保留可选的“豆包 SeedDuplex 3.0”适配器。当前客户端录完一轮后发送音频：H5 / WebView 发送 16kHz PCM，UniApp 原生包发送 MP3（分片或录音文件回退），MP3 由 GoFrame ffmpeg 转成 PCM。后端使用 `session.create`、`input_audio_buffer.append`、`input_audio_buffer.commit`、`response.cancel` 事件；下行音频聚合为 WAV 后播放。当前页面尚未实现持续麦克风全双工采集，此 provider 不属于本地 Qwen / FunASR / CosyVoice 的离线验收范围。

官方协议说明：[SeedDuplex 端到端实时语音](https://docs.volcengine.com/docs/doubao-voice/access-must-read?lang=zh&AuditDocumentID=397063)。

## 6. Open-LLM-VTuber（可选本地语音引擎）

1. 按 [Open-LLM-VTuber 官方项目](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber) 启动服务并配置其 ASR、LLM 和 TTS。让它与 GoFrame 位于同一主机；如果使用容器，两者需要共享回环网络，或由 GoFrame 所在网络提供可信的回环代理。
2. GoFrame 默认连接 `ws://127.0.0.1:12393/client-ws`。如果端口不同，在启动 GoFrame 前设置进程环境变量 `OPEN_LLM_VTUBER_WS_URL`，或修改本地配置中的 `voice.open_llm_vtuber_ws_url`。只允许回环的 `ws://` 或 `wss://`，不接受用户名、密码、查询参数或片段。GoFrame 需要可执行的 ffmpeg 将 App 的 MP3 转为 16 kHz 单声道 PCM。
3. App 中进入「我的 → 本地语音接入」，选择 **Open-LLM-VTuber**，点击「开始说话」，录完点击「结束录音」。支持识别文本、播放语音回复和打断；不需要启动本项目的 Qwen / FunASR / CosyVoice，也不渲染 Live2D。

适配器使用 Open-LLM-VTuber 的独立 WebSocket 协议：将录音转换为 16 kHz 单声道浮点采样，通过 `mic-audio-data` / `mic-audio-end` 发送；将同一轮 `audio` 消息中的 WAV 数据合并后交给 App 播放。App 播放结束后携带 `turn_id` 发送 `playback.complete`，GoFrame 再回传 `frontend-playback-complete`；短回复或无音频回复也会处理上游重复的 `backend-synth-complete`，避免下一轮一直等待。切换语音引擎会关闭旧连接，下次录音按新引擎重新建立会话。

协议参考：[官方会话处理](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber/blob/main/src/open_llm_vtuber/conversations/single_conversation.py)、[会话结束与播放确认](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber/blob/main/src/open_llm_vtuber/conversations/conversation_utils.py)。

GoFrame 不向上游传递 App 凭据、不创建上游聊天历史。录音会发送给本机 Open-LLM-VTuber；其 ASR、LLM、TTS 可按你配置调用云服务，且上游日志可能包含识别文本。仅需本机处理时，请在上游选择本地模型并调整日志设置。
