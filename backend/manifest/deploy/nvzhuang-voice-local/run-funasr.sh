#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/env.local.sh"
"$HERE/setup-wsl.sh"
# Foreground service. Ctrl+C stops it. Models and cache are D: bind mounts.
# Docker image layers use Docker Desktop's separately configured Disk image location.
docker run --rm -it --name nvzhuang-funasr \
  -p 127.0.0.1:10096:10095 \
  -v "$NVZHUANG_ROOT/models/funasr:/workspace/models" \
  -v "$NVZHUANG_ROOT/cache/modelscope:/workspace/cache/modelscope" \
  -v "$NVZHUANG_ROOT/cache/xdg:/workspace/cache/xdg" \
  -v "$NVZHUANG_ROOT/cache/tmp:/workspace/cache/tmp" \
  -v "$NVZHUANG_ROOT/cache/home-funasr:/workspace/cache/home" \
  -e GLOG_minloglevel=2 \
  -e MODELSCOPE_CACHE=/workspace/cache/modelscope \
  -e XDG_CACHE_HOME=/workspace/cache/xdg \
  -e TMPDIR=/workspace/cache/tmp \
  -e HOME=/workspace/cache/home \
  --entrypoint /bin/bash \
  registry.cn-hangzhou.aliyuncs.com/funasr_repo/funasr:funasr-runtime-sdk-online-cpu-0.1.13 \
  -lc '
    set -e
    script="$(find / -name run_server_2pass.sh -type f 2>/dev/null | head -n 1)"
    if [ -z "$script" ]; then echo "Missing run_server_2pass.sh in this image" >&2; exit 3; fi
    cd "$(dirname "$script")"
    exec bash ./run_server_2pass.sh \
      --download-model-dir /workspace/models \
      --vad-dir damo/speech_fsmn_vad_zh-cn-16k-common-onnx \
      --model-dir damo/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-onnx \
      --online-model-dir damo/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-online-onnx \
      --punc-dir damo/punc_ct-transformer_zh-cn-common-vad_realtime-vocab272727-onnx \
      --itn-dir thuduj12/fst_itn_zh \
      --certfile 0
  '
