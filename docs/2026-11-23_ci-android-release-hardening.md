# 持续集成与 Android 发布安全说明

日期：2026-11-23

## 普通持续集成

对 `main` 分支推送和 Pull Request 自动执行：

- 仓库凭据特征与私人绝对路径扫描；
- 前端类型检查、限定范围 ESLint、Vitest、Playwright 和 H5 构建；
- 后端模块校验、单元测试和 `go vet`；
- Android JVM 测试、Lint 和 Debug APK 构建。

普通 CI 仅拥有仓库只读权限，产出的 Debug APK 使用 Android 默认调试签名，构建产物保留 7 天，不会发布到 GitHub Releases。

## 正式 Android 发布

正式发布工作流仅由 `v*` 标签或人工触发。构建 Release APK 前必须在 GitHub Actions Secrets 中配置：

| Secret | 说明 |
| --- | --- |
| `KEYSTORE_BASE64` | Release JKS 文件的 Base64 内容 |
| `KEYSTORE_PASSWORD` | JKS 存储密码 |
| `KEY_ALIAS` | 签名条目别名 |
| `KEY_PASSWORD` | 签名条目密码 |

任一 Secret 缺失都会立即终止构建。仓库不再生成固定口令的临时 Release 密钥，也不会把 Debug 签名静默当成 Release 签名。

标签发布通过独立作业获得最小化的 `contents: write` 权限。发布资产包含：

- `nvzhuang-release.apk`
- `nvzhuang-release.apk.sha256`

所有 GitHub Actions 均锁定到具体提交 SHA，依赖安装使用已提交锁文件。

## 本地验证

Debug 构建不需要 Release 密钥：

```powershell
Set-Location android
.\gradlew.bat testDebugUnitTest lintDebug assembleDebug --no-daemon
```

Release 构建必须先将本地 `release.jks` 放入 `android/app/`，并仅在当前终端设置三个签名环境变量。`release.jks` 已被仓库根目录 `.gitignore` 忽略，不得提交。
