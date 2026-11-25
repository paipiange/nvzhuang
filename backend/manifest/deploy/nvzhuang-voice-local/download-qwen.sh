#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/env.local.sh"
"$HERE/setup-wsl.sh"
MODEL_NAME='Qwen_Qwen3-4B-Instruct-2507-Q4_K_M.gguf'
DEST="$NVZHUANG_ROOT/models/qwen"
if [[ -s "$DEST/$MODEL_NAME" ]]; then
  printf 'Already exists: %s\n' "$DEST/$MODEL_NAME"; exit 0
fi
# A dedicated Python environment lives on D:, not under WSL C: user home.
VENV="$NVZHUANG_ROOT/envs/downloader"
if [[ ! -x "$VENV/bin/python" ]]; then
  python3 -m venv --copies "$VENV"
fi
"$VENV/bin/python" -m pip install --upgrade huggingface_hub
printf 'VOICE_PROGRESS_BEGIN\n'
HF_HUB_DISABLE_PROGRESS_BARS=0 "$VENV/bin/hf" download 'bartowski/Qwen_Qwen3-4B-Instruct-2507-GGUF' "$MODEL_NAME" --local-dir "$DEST"
test -s "$DEST/$MODEL_NAME"
printf 'VOICE_PROGRESS: 100%%\n'
