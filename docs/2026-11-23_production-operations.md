# 生产健康检查与隐私安全指标

## 端点

| 端点 | 用途 | 成功状态 | 备注 |
| --- | --- | --- | --- |
| `GET /healthz` | 进程存活检查 | `200`, `status=ok` | 不访问外部模型，适合 liveness |
| `GET /readyz` | 服务就绪检查 | `200`, `status=ready` | 初始化完成后才就绪，适合 readiness 和 Docker healthcheck |
| `GET /metrics` | Prometheus 文本指标 | `200` | 默认仅本机回环地址可访问 |

`/metrics` 只使用固定路由标签和状态码分组，包含请求总数、聚合耗时、活跃请求数和进程运行时长。不采集请求体、对话文本、图片、API Key、Token、IP、查询参数、完整 URL 或动态任务 ID。

## 配置

`backend/manifest/config/config.yaml` 或被 Git 忽略的本地 `.env` 可以配置：

```yaml
observability:
  metricsEnabled: true
  allowRemoteMetrics: false
```

等价环境变量：

```dotenv
NVZHUANG_OBSERVABILITY_METRICS_ENABLED=true
NVZHUANG_OBSERVABILITY_ALLOW_REMOTE_METRICS=false
```

只有在 Prometheus 与后端不在同一主机/容器网络且网络层已有访问控制时，才应将 `allowRemoteMetrics` 设为 `true`。不建议把指标端点直接暴露到公网。

## Docker 验证

```bash
docker compose up -d --build
docker compose ps
curl -fsS http://127.0.0.1:8000/healthz
curl -fsS http://127.0.0.1:8000/readyz
docker compose exec costume-tryon wget -qO- http://127.0.0.1:8000/metrics
```

镜像和 Compose 均以 `/readyz` 作为健康检查：30 秒检查一次，5 秒超时，连续 3 次失败后标记不健康，启动宽限期为 20 秒。

## 建议告警

- `/readyz` 连续 2 分钟非 `200`。
- `5xx` 请求占比在 5 分钟窗口超过 5%。
- 活跃请求数持续上升且长时间不回落。
- `/tryon` 的聚合耗时显著高于日常基线。

指标不包含完整时延直方图；监控系统可用 `duration_seconds_sum / requests_total` 计算各固定路由的平均耗时。
