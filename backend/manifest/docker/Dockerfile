# 构建阶段
FROM golang:1.25-alpine AS builder

WORKDIR /app
# 先复制依赖文件，利用 Docker 层缓存
COPY go.mod go.sum ./
RUN go mod download

# 复制源码并编译
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o main .

# 运行阶段
FROM alpine:3.19

# 安装 ca-certificates 确保能够正常调用外部 HTTPS API（OpenAI / 火山方舟 / Google 等）
RUN apk --no-cache add ca-certificates tzdata

WORKDIR /app
COPY --from=builder /app/main .
# 复制配置文件（优先保留本地 config.yaml；若不存在则由模板自动生成）
COPY manifest/config/config*.yaml manifest/config/
COPY workflows workflows/
RUN [ -f manifest/config/config.yaml ] || cp manifest/config/config.example.yaml manifest/config/config.yaml

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD wget -qO- http://127.0.0.1:8000/readyz >/dev/null || exit 1
CMD ["./main"]
