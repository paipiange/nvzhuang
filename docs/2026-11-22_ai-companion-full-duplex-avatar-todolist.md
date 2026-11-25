# 全双工语音与角色系统实施清单

依据：[实施规范](./2026-11-22_ai-companion-full-duplex-avatar-implementation.md)。仅在实际实现并验证后打勾。真人账号/麦克风验收单独记录，不以模拟测试替代。

- [x] 阅读规范、仓库约定与已有语音代码；确认已有用户修改并保留。
- [x] 阶段一：兼容协商 streaming 能力、定义 turn_id 与稳定错误码。
- [x] 阶段二：H5 AudioWorklet 持续 20ms PCM 采集、背压与生命周期释放；非支持平台明确降级。
- [x] 阶段三：后端音频即时上行、下行 PCM、串行写入、取消/重置代次守卫与资源上限。
- [x] 阶段四：流式播放、队列耗尽回调、插话立即清空、迟到包隔离。
- [x] 阶段五：统一 CharacterProfile、本地清单校验、角色身份切换与语音意图。
- [x] 阶段六：静态实时角色渲染、受控姿势与独立可取消高清写真。
- [x] Android WebView 壳：AudioRecord/AudioTrack 持续 PCM 桥、可信来源绑定、权限回传与后台/导航生命周期释放。
- [x] Android 构建：补齐 Gradle 8.6 Wrapper；JDK 17、API 34、Build Tools 34.0.0 下通过 Java 编译、Lint、DEX 与 Debug APK 打包，并完成 APK v2 签名校验。
- [x] App 入口与配置：首页和“我的”提供 AI 陪伴通话入口；设置页提供设备语音 Key、后端回退说明与直达入口。
- [x] 设备语音 Key 仅驻留当前运行内存；启动时清除旧版持久化字段，刷新或关闭后必须重新输入。
- [x] 客户端控制消息、字段与累计字幕设置长度上限；异常端点、未知服务错误统一转换为稳定且不泄露上游细节的错误码。
- [x] 前端：type-check、lint、test:run（18个文件、182/182通过）；额外 build:h5、build:app 通过。
- [x] 后端：go test ./...、go vet ./...；现有 WSL CosyVoice 环境 Python 单测 5/5 通过（模型 mock，无真实推理）。
- [x] 独立工作室：server 21/21、app 74/74、doctor 8/8、duplex-session 11/11、health 10/10。
- [x] 图片模型本地配置：从同机前代项目的私有配置中仅合并 `llm.models` 到被 Git 忽略的 `config.yaml`；3 个云端模型均为 HTTPS 且 Key 已配置，3 个 ComfyUI 模型仅使用回环地址，工作流文件和节点 ID 全部校验通过。
- [x] 同步协议、使用说明与 README。
- [x] 前 10 项完善：在线/离线检测、自动重连、有界退避、立即重试、取消重连、麦克风枚举、首选设备、热插拔回退、回声处理诊断、本地文本归档与统一诊断面板。
- [x] 隐私控制：记录仅含角色 ID 与有界文本，支持 JSON 导出、按角色删除和全部删除；损坏数据与额外字段不进入导出。
- [x] 审查最终 diff、git diff --check 与敏感字符串扫描；git diff --cached 为空，未暂存/提交文件。
- [ ] 真人验收：授权 SeedDuplex 账号，真实麦克风连续10轮、1秒内打断、连续5次插话。
- [ ] 真人验收：语音切换形象、并行写真与独立取消、断网/换引擎/离页资源释放。
- [ ] Android 原生验收：安装仓库内 Android 壳，使用物理麦克风/扬声器完成持续通话、插话、后台恢复与权限拒绝测试。
- [x] Android 真机验收入口：`android/verify-physical-device.ps1` 仅接受单台已授权物理设备，支持构建、安装、USB 端口转发、权限场景重置与人工检查清单；没有物理设备时明确失败。

## 验证记录

前端完整门禁已通过：`pnpm type-check`、`pnpm lint`、`pnpm test:run`（20 个文件、191/191）、`pnpm build:h5`、`pnpm build:app`。后端 `go test ./...`、`go vet ./...` 已通过；流式与角色兼容重点用例连续10轮通过。独立工作室 server/app/doctor/duplex-session/health 共 124 个检查通过。

构建存在原有非阻断提示：浏览器兼容数据需更新、H5 页面标题环境变量未设置；本轮未升级应用依赖。Android 使用便携 JDK 17 与 SDK 34 完成 `testDebugUnitTest lintDebug assembleDebug`，其中模块暂无 JVM 单测源码，测试任务为 `NO-SOURCE`；Lint 与构建通过。生成的 Debug APK 已通过 v2 签名校验，包名为 `com.paipiange.nvzhuang.debug`、`minSdk 24`、`targetSdk 34`。当前没有连接 Android 设备，因此仍未执行安装与物理麦克风/扬声器真机验收。

图片模型配置已完成无计费静态验收：`gpt-image`、`doubao`、`gemini` 的地址、协议和 Key 存在性通过检查；`comfyui`、`comfyui-qwen`、`comfyui-h3` 的回环地址、工作流文件与节点映射通过检查。合并配置后后端 `go test ./...`、`go vet ./...` 继续通过。当前本机 `127.0.0.1:8188` 未监听，因此未执行 ComfyUI 真实生成，也未向云端模型发起可能计费的请求。

Android 物理设备验收现可运行 `powershell -ExecutionPolicy Bypass -File android/verify-physical-device.ps1`。脚本不会输出或持久化设备序列号，并拒绝将模拟器计为真机；持续通话、插话、后台恢复和主观音频质量仍需在实际连接的手机上人工确认后才能勾选原生验收项。


## 交付与剩余验收

六个代码阶段和自动化门禁均已完成；文档“完成定义”中的真实账号与真实麦克风验收尚未完成，因此不宣称完整产品验收通过。没有发起真实付费语音/图片请求，没有记录或提交真实 Key，也未暂存已有用户配置和工作文件。

- H5 操作：语音页选择 SeedDuplex，点击“开始通话 · 持续开麦”；客户端 Key 仅保存在当前 App 运行内存，服务端 Key 可配置在后端 `.env`、进程环境变量或被 Git 忽略的 `config.yaml`。原 local、VTuber、SeedDuplex 按轮入口保留。
- 林溪音色必须按语音说明配置；未配置返回稳定错误，不能复用知夏冒充新音色。角色切换会结束旧通话，再次开始使用新身份。
- 静态渲染仅为头像/服装参考及说话状态反馈；姿势通过受控状态、轻量静态反馈和写真提示词表达，不等同骨骼动画或精确 OpenPose 控制。
- 未执行 `go test -race`（当前 Go 环境关闭 CGO）；未执行真实麦克风、扬声器 AEC、主观音色/延迟、真实云账号或真实图片生成验收。
- 原有用户改动与本地配置保留。本次未执行 Git 提交。

## 后续可操作性完善

已进一步将持续通话接入独立工作室主入口，新增设置内健康诊断，并在实际8787入口完成真实浏览器100轮压力验收与本机模型播放验收。详见[可操作性与100轮验收记录](./2026-11-22_companion-operability-100-rounds.md)。真人账号及物理麦克风限制仍保留。
