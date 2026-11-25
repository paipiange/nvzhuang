#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/env.local.sh"
"$HERE/setup-wsl.sh"
command -v git >/dev/null || { echo 'Install git first.' >&2; exit 3; }
command -v conda >/dev/null || { echo 'Install Miniconda/Miniforge, then initialize conda in WSL before running.' >&2; exit 3; }
if [[ ! -d "$COSYVOICE_HOME/.git" ]]; then
  git clone --recursive https://github.com/QwenAudio/CosyVoice.git "$COSYVOICE_HOME"
fi
if [[ ! -x "$NVZHUANG_ROOT/envs/cosyvoice/bin/python" ]]; then
  conda create --yes --prefix "$NVZHUANG_ROOT/envs/cosyvoice" python=3.10
fi
PY="$NVZHUANG_ROOT/envs/cosyvoice/bin/python"
"$PY" -m pip install -r "$COSYVOICE_HOME/requirements.txt"
"$PY" -m pip install fastapi uvicorn modelscope
printf 'VOICE_PROGRESS_BEGIN\n'
"$PY" - <<'PYMODEL'
import os
from modelscope import snapshot_download
root = os.environ['COSYVOICE_MODEL_DIR']
snapshot_download('FunAudioLLM/Fun-CosyVoice3-0.5B-2512', local_dir=root)
PYMODEL
printf 'VOICE_PROGRESS: 100%%\n'
