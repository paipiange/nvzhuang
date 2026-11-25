# 平台适配手册

## 1. 差异处理决策树

```
这个差异编译期就能确定吗?
├── 能  → 条件编译(#ifdef / #ifndef)
└── 不能 → 运行时 API 判断(uni.getSystemInfoSync().uniPlatform)
```

- 构建脚本/插件层面:`process.env.UNI_PLATFORM`(仅 vite.config.ts、构建脚本内可用)
- 禁止:用 UA 嗅探替代条件编译;在能编译期剔除的代码里留运行时 if

## 2. 条件编译速查

```vue
<script setup lang="ts">
// #ifdef H5
import { h5Api } from '@/utils/h5'
// #endif
// #ifndef MP-WEIXIN
// 所有平台生效,除微信小程序
// #endif
</script>

<template>
  <!-- #ifdef APP-PLUS -->
  <view>仅 APP</view>
  <!-- #endif -->
</template>
```

常用平台标识:`H5`、`MP-WEIXIN`、`MP-ALIPAY`、`MP-BAIDU`、`MP-TOUTIAO`、`MP-LARK`、`MP-QQ`、`MP-KUAISHOU`、`MP-JD`、`MP-XHS`、`APP-PLUS`(app-android / app-ios 可再细分)、`MP`(`%MP%` 或 `MP` 泛小程序)。

## 3. 本项目已存在的平台差异(改动时别破坏)

| 差异点 | 位置 | 规则 |
|--------|------|------|
| devServer 代理(`VITE_APP_PROXY_*`) | src/http/interceptor.ts | 仅 H5 dev 生效;非 H5 端 dev 也是 build command,无代理 |
| `responseType: 'json'` | src/http/http.ts | 用 `#ifndef MP-WEIXIN` 包裹,微信小程序不支持 |
| eruda 调试面板 | vite.config.ts | 仅 H5 development |
| 打包分析 visualizer | vite.config.ts | 仅 H5 production,产物在 `node_modules/.cache/visualizer/stats.html` |
| 自动打开开发者工具 | scripts/open-dev-tools.js | mp-weixin / mp-alipay / mp-lark 构建后自动打开对应工具;上传脚本用 `SKIP_OPEN_DEVTOOLS=true` 跳过 |
| bundle-optimizer 分包优化 | vite.config.ts | `enable: isMpWeixin`,仅微信小程序端 |
| 语音录制 / 播放 | `src/pages/mine/voice.vue` | H5 使用 Web Audio 转 16 kHz PCM、Blob URL 播放，并显示 RMS/峰值与拦截近数字静音；APP-PLUS 使用原生录音器与临时文件兜底，不伪报实时音量；本地 `segment:true` WAV 按 FIFO 播放、每轮累计最多 32 MiB，生成与播放均完成后才空闲；后台/卸载时清理采集与全部播放队列；`session.reset` 等服务端同名确认后清空当前连接记忆 |
| 全双工通话 / 角色写真 | `src/composables/voice/`、`src/composables/character/`、`src/pages/mine/voice.vue`、`../android/` | H5 SeedDuplex 通过 AudioWorklet 持续发送 16kHz/20ms PCM 帧，Web Audio 按序播放24kHz PCM；仓库内 Android WebView 壳通过受限 WebMessage 桥接 AudioRecord/AudioTrack，绑定本地页面来源、麦克风权限与 Activity 生命周期。其它未接入持续 PCM 的 APP 壳明确提供按轮模式。连接与回合代次隔离迟到音频，插话即时清空播放，网络持续拥塞3秒断开；角色只接受清单ID，角色切换终止旧语音会话；高清写真独立可取消且失败不影响通话。 |
| 原生插件资源复制 | vite.config.ts | 仅 app 平台且 `VITE_COPY_NATIVE_RES_ENABLE=true` |

## 4. 多端请求地址

`env/.env` 支持按微信开发者工具 envVersion 覆写(不配则回退 `VITE_SERVER_BASEURL`):

```ini
VITE_SERVER_BASEURL = 'https://api.example.com'
VITE_SERVER_BASEURL__WEIXIN_DEVELOP = 'https://dev.xxx.com'   # 开发版
VITE_SERVER_BASEURL__WEIXIN_TRIAL  = 'https://trial.xxx.com'  # 体验版
VITE_SERVER_BASEURL__WEIXIN_RELEASE = 'https://prod.xxx.com'  # 正式版
```

## 5. 平台命令

```bash
pnpm dev            # H5
pnpm dev:mp         # 微信小程序(其余 dev:mp-alipay / mp-baidu / mp-jd / mp-kuaishou / mp-lark / mp-qq / mp-toutiao / mp-xhs 同理)
pnpm dev:app        # APP(app-android / app-ios 可细分)
pnpm build:mp       # 微信小程序生产构建
```

新增平台特定行为时,同步更新本文第 3 节的差异点表。
