"""Local-only CosyVoice3 streaming TTS server.
Run with run-cosyvoice.sh so models, temporary files and all supported caches
are rooted at D:\ai\ai\nvzhuang (WSL: /mnt/d/ai/ai/nvzhuang).
Requires a licensed reference WAV file; does not ship one.
"""
import logging
import os
import sys
import threading
from pathlib import Path

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

ROOT_DIR = Path('/mnt/d/ai/ai/nvzhuang')
BASE = Path(os.environ.get('NVZHUANG_ROOT', ROOT_DIR)).resolve()
if BASE != ROOT_DIR:
    raise RuntimeError(f'NVZHUANG_ROOT must be exactly {ROOT_DIR}; got {BASE}')
ROOT = Path(os.environ.get('COSYVOICE_HOME', BASE / 'src' / 'CosyVoice')).resolve()
MODEL_DIR = Path(os.environ.get('COSYVOICE_MODEL_DIR', BASE / 'models' / 'cosyvoice3' / 'Fun-CosyVoice3-0.5B')).resolve()
REFERENCE_WAV = Path(os.environ.get('COSYVOICE_REFERENCE_WAV', BASE / 'voices' / 'xiaotao_16k.wav')).resolve()
REFERENCE_TEXT = os.getenv('COSYVOICE_REFERENCE_TEXT', '').strip()
if not REFERENCE_TEXT:
    raise RuntimeError('Set COSYVOICE_REFERENCE_TEXT to the exact transcript of the reference WAV')
if not REFERENCE_WAV.is_file():
    raise RuntimeError(f'Reference WAV not found: {REFERENCE_WAV}')
for label, location in [('CosyVoice source', ROOT), ('CosyVoice model', MODEL_DIR), ('reference WAV', REFERENCE_WAV)]:
    if not location.is_relative_to(BASE):
        raise RuntimeError(f'{label} must be within {BASE}, got {location}')

REFERENCES = {'local-reference': (REFERENCE_WAV, REFERENCE_TEXT)}
linxi_wav = os.getenv('COSYVOICE_LINXI_REFERENCE_WAV', '').strip()
linxi_text = os.getenv('COSYVOICE_LINXI_REFERENCE_TEXT', '').strip()
if linxi_wav or linxi_text:
    if not linxi_wav or not linxi_text:
        raise RuntimeError('Set both COSYVOICE_LINXI_REFERENCE_WAV and COSYVOICE_LINXI_REFERENCE_TEXT')
    linxi_path = Path(linxi_wav).resolve()
    if not linxi_path.is_relative_to(BASE) or not linxi_path.is_file():
        raise RuntimeError('Linxi reference WAV must be an existing file within NVZHUANG_ROOT')
    REFERENCES['linxi-reference'] = (linxi_path, linxi_text)

sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'third_party' / 'Matcha-TTS'))
from cosyvoice.cli.cosyvoice import AutoModel  # noqa: E402

# Upstream INFO logs include synthesis text; keep conversation content out of logs.
logging.getLogger().setLevel(logging.WARNING)

# Synthesis disables text normalization; skip eager optional frontend loads (including WeText downloads).
missing = object()
optional_frontends = {name: sys.modules.get(name, missing) for name in ('ttsfrd', 'wetext')}
try:
    for name in optional_frontends:
        sys.modules[name] = None
    # One GPU instance only. Adjust fp16 after measuring actual compatibility.
    model = AutoModel(model_dir=str(MODEL_DIR), load_trt=False, fp16=False)
finally:
    for name, previous in optional_frontends.items():
        if previous is missing:
            sys.modules.pop(name, None)
        else:
            sys.modules[name] = previous
for speaker_id, (reference_wav, reference_text) in REFERENCES.items():
    prompt = 'You are a helpful assistant.<|endofprompt|>' + reference_text
    model.add_zero_shot_spk(prompt, str(reference_wav), speaker_id)
logging.getLogger().setLevel(logging.WARNING)
lock = threading.Lock()
app = FastAPI(title='nvzhuang local CosyVoice 3')


class TTSRequest(BaseModel):
    text: str = Field(min_length=1, max_length=300)
    voice_id: str = Field(default='local-reference', min_length=1, max_length=128)


@app.get('/health')
def health():
    return {'status': 'ok', 'sample_rate': model.sample_rate, 'voices': sorted(REFERENCES)}


@app.post('/tts/stream')
def tts_stream(payload: TTSRequest):
    if payload.voice_id not in REFERENCES:
        raise HTTPException(status_code=422, detail='Voice is not configured')

    def pcm_chunks():
        with lock:
            for part in model.inference_zero_shot(payload.text, '', '', zero_shot_spk_id=payload.voice_id, stream=True, text_frontend=False):
                wav = part['tts_speech'].detach().float().cpu().numpy().reshape(-1)
                if wav.size:
                    yield (np.clip(wav, -1.0, 1.0) * 32767).astype('<i2').tobytes()

    return StreamingResponse(pcm_chunks(), media_type='application/octet-stream', headers={
        'X-Audio-Format': 'pcm_s16le',
        'X-Audio-Sample-Rate': str(model.sample_rate),
        'X-Audio-Channels': '1',
    })
