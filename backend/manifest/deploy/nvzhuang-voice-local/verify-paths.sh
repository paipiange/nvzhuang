#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/env.local.sh"
printf 'Windows root: D:\\ai\\ai\\nvzhuang\nWSL root:     %s\n\n' "$NVZHUANG_ROOT"
vars=(NVZHUANG_ROOT HF_HOME HF_HUB_CACHE HF_XET_CACHE HF_DATASETS_CACHE MODELSCOPE_CACHE XDG_CACHE_HOME XDG_CONFIG_HOME PIP_CACHE_DIR UV_CACHE_DIR CONDA_PKGS_DIRS CONDA_ENVS_PATH TORCH_HOME TORCHINDUCTOR_CACHE_DIR TRITON_CACHE_DIR CUDA_CACHE_PATH NUMBA_CACHE_DIR PYTHONPYCACHEPREFIX TMPDIR TMP TEMP MPLCONFIGDIR GIT_LFS_CACHE_DIR COSYVOICE_HOME COSYVOICE_MODEL_DIR COSYVOICE_REFERENCE_WAV GOCACHE GOMODCACHE)
for name in "${vars[@]}"; do
  value="${!name}"
  if [[ "$value" != "$NVZHUANG_ROOT" && "$value" != "$NVZHUANG_ROOT/"* ]]; then
    echo "ERROR: $name outside D drive: $value" >&2; exit 4
  fi
  printf '%-25s -> %s\n' "$name" "$value"
done
if command -v docker >/dev/null 2>&1; then
  echo
  docker compose -f "$HERE/compose.llm.yaml" config --format json | python3 -c '
import json,sys
s=json.load(sys.stdin)["services"]["qwen"]
for vol in s.get("volumes", []):
  p=vol.get("source", "")
  print("docker mount:", p)
  assert p.startswith("/mnt/d/ai/ai/nvzhuang/"), p
'
fi
printf '\nPASS: configured model and application cache paths are under D:.\n'
printf 'Docker image layers and WSL distribution filesystem are not controlled by these env vars.\n'
