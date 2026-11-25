#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=env.local.sh
source "$HERE/env.local.sh"
if [[ ! -d /mnt/d || ! -w /mnt/d ]]; then
  echo 'ERROR: WSL does not see a writable D: drive at /mnt/d' >&2; exit 2
fi
mkdir -p \
 "$NVZHUANG_ROOT"/{models/{qwen,funasr,cosyvoice3},src,envs,voices,logs,data,docker/disk} \
 "$NVZHUANG_ROOT"/{config/xdg,cache/{huggingface/{hub,xet,datasets},modelscope,pip,uv,conda/pkgs,torch,torchinductor,triton,cuda,numba,pycache,xdg,tmp,matplotlib,git-lfs,go-build,go-mod,home-funasr,home-qwen}}
touch "$NVZHUANG_ROOT/models/funasr/hotwords.txt"
test -w "$NVZHUANG_ROOT/cache/tmp"
printf 'Storage root: %s\n' "$NVZHUANG_ROOT"
printf 'Qwen model:   %s\n' "$NVZHUANG_ROOT/models/qwen"
printf 'FunASR model: %s\n' "$NVZHUANG_ROOT/models/funasr"
printf 'CosyVoice:    %s\n' "$NVZHUANG_ROOT/models/cosyvoice3"
printf 'All configured download and runtime caches are under %s/cache\n' "$NVZHUANG_ROOT"
