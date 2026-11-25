"""Run in the CosyVoice Python environment: python -m unittest discover -p 'test_cosyvoice_server.py'."""
import asyncio
import importlib.util
import os
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import MagicMock, patch

import numpy as np


class CosyVoiceServerTest(unittest.TestCase):
    def load_server(self, transcript='Reference speech', *, model_error=None, extra_env=None):
        model = MagicMock()
        model.sample_rate = 24000
        wetext = types.ModuleType('wetext')

        def create_model(**kwargs):
            self.assertIsNone(sys.modules['wetext'])
            self.assertIsNone(sys.modules['ttsfrd'])
            if model_error:
                raise model_error
            return model

        fake = types.ModuleType('cosyvoice.cli.cosyvoice')
        fake.AutoModel = MagicMock(side_effect=create_model)
        spec = importlib.util.spec_from_file_location('voice_server_under_test', Path(__file__).with_name('cosyvoice_server.py'))
        module = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {'cosyvoice.cli.cosyvoice': fake, 'wetext': wetext}), patch.dict(os.environ, {
            'NVZHUANG_ROOT': '/mnt/d/ai/ai/nvzhuang',
            'COSYVOICE_HOME': '/mnt/d/ai/ai/nvzhuang/src/CosyVoice',
            'COSYVOICE_MODEL_DIR': '/mnt/d/ai/ai/nvzhuang/models/cosyvoice3/Fun-CosyVoice3-0.5B',
            'COSYVOICE_REFERENCE_WAV': '/mnt/d/ai/ai/nvzhuang/voices/reference.wav',
            'COSYVOICE_REFERENCE_TEXT': transcript,
            'COSYVOICE_LINXI_REFERENCE_WAV': '',
            'COSYVOICE_LINXI_REFERENCE_TEXT': '',
            **(extra_env or {}),
        }), patch.object(Path, 'is_file', return_value=True):
            sys.modules.pop('ttsfrd', None)
            try:
                spec.loader.exec_module(module)
            finally:
                self.assertIs(sys.modules['wetext'], wetext)
                self.assertNotIn('ttsfrd', sys.modules)
        return module, model, fake.AutoModel

    def test_restores_frontends_if_model_init_fails(self):
        with self.assertRaisesRegex(RuntimeError, 'mock model error'):
            self.load_server(model_error=RuntimeError('mock model error'))

    def test_requires_reference_transcript(self):
        with self.assertRaisesRegex(RuntimeError, 'exact transcript'):
            self.load_server('  ')

    def test_optional_role_reference_and_unconfigured_voice(self):
        module, model, _ = self.load_server(extra_env={
            'COSYVOICE_LINXI_REFERENCE_WAV': '/mnt/d/ai/ai/nvzhuang/voices/linxi.wav',
            'COSYVOICE_LINXI_REFERENCE_TEXT': 'Authorized reference transcript',
        })
        self.assertIn('linxi-reference', module.health()['voices'])
        model.add_zero_shot_spk.assert_any_call(
            'You are a helpful assistant.<|endofprompt|>Authorized reference transcript',
            '/mnt/d/ai/ai/nvzhuang/voices/linxi.wav', 'linxi-reference')
        with self.assertRaises(module.HTTPException) as error:
            module.tts_stream(module.TTSRequest(text='Hello', voice_id='unconfigured'))
        self.assertEqual(error.exception.status_code, 422)
        model.inference_zero_shot.return_value = iter([])
        response = module.tts_stream(module.TTSRequest(text='Hello', voice_id='linxi-reference'))

        async def collect():
            return b''.join([chunk async for chunk in response.body_iterator])

        asyncio.run(collect())
        model.inference_zero_shot.assert_called_once_with(
            'Hello', '', '', zero_shot_spk_id='linxi-reference', stream=True, text_frontend=False)

    def test_rejects_partial_or_outside_role_reference(self):
        for config in [
            {'COSYVOICE_LINXI_REFERENCE_WAV': '/mnt/d/ai/ai/nvzhuang/voices/linxi.wav'},
            {'COSYVOICE_LINXI_REFERENCE_WAV': '/outside/linxi.wav', 'COSYVOICE_LINXI_REFERENCE_TEXT': 'Transcript'},
        ]:
            with self.assertRaises(RuntimeError):
                self.load_server(extra_env=config)

    def test_caches_reference_and_streams_little_endian_pcm(self):
        module, model, factory = self.load_server()
        model.add_zero_shot_spk.assert_called_once_with(
            'You are a helpful assistant.<|endofprompt|>Reference speech',
            '/mnt/d/ai/ai/nvzhuang/voices/reference.wav', 'local-reference')
        speech = MagicMock()
        speech.detach.return_value.float.return_value.cpu.return_value.numpy.return_value = np.array([-2, 0, 0.5, 2])
        model.inference_zero_shot.return_value = iter([{'tts_speech': speech}])
        response = module.tts_stream(module.TTSRequest(text='Hello'))

        async def collect():
            return b''.join([chunk async for chunk in response.body_iterator])

        pcm = asyncio.run(collect())
        np.testing.assert_array_equal(np.frombuffer(pcm, dtype='<i2'), [-32767, 0, 16383, 32767])
        self.assertEqual(response.headers['x-audio-sample-rate'], '24000')
        model.inference_zero_shot.assert_called_once_with(
            'Hello', '', '', zero_shot_spk_id='local-reference', stream=True, text_frontend=False)
        factory.assert_called_once()


if __name__ == '__main__':
    unittest.main()
