#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/env.local.sh"
"$HERE/setup-wsl.sh"
MODEL="$NVZHUANG_ROOT/models/qwen/Qwen_Qwen3-4B-Instruct-2507-Q4_K_M.gguf"
[[ -s "$MODEL" ]] || { echo "Missing Qwen GGUF: $MODEL. Run ./download-qwen.sh first." >&2; exit 3; }
docker compose -f "$HERE/compose.llm.yaml" up -d
printf 'Qwen health: http://127.0.0.1:8080/health\n'
