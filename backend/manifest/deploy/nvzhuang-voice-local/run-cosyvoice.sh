#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/env.local.sh"
"$HERE/setup-wsl.sh"
PY="$NVZHUANG_ROOT/envs/cosyvoice/bin/python"
[[ -x "$PY" ]] || { echo "Missing CosyVoice Python environment: $PY. Run ./download-cosyvoice.sh" >&2; exit 3; }
[[ -d "$COSYVOICE_MODEL_DIR" ]] || { echo "Missing CosyVoice model: $COSYVOICE_MODEL_DIR" >&2; exit 3; }
[[ -f "$COSYVOICE_REFERENCE_WAV" ]] || { echo "Missing authorized voice sample WAV: $COSYVOICE_REFERENCE_WAV" >&2; exit 3; }
[[ -n "$COSYVOICE_REFERENCE_TEXT" ]] || { echo 'Set COSYVOICE_REFERENCE_TEXT to the exact transcript of the reference WAV.' >&2; exit 3; }
cd "$COSYVOICE_HOME"
exec "$PY" -m uvicorn cosyvoice_server:app --app-dir "$HERE" --host 127.0.0.1 --port 50000 --workers 1
