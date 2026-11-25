import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

class VerificationError extends Error {}

const maxInputBytes = 2 * 1024 * 1024;
const maxOutputBytes = 32 * 1024 * 1024;
const cosyVoice = 'http://127.0.0.1:50000';
const voiceSocket = 'ws://127.0.0.1:8000/api/v1/voice/ws';
const testText = '今天天气不错，请用一句话向我打招呼。';

function pcm16k(input) {
  if (!input.length || input.length % 2 || input.length > maxInputBytes * 1.5)
    throw new VerificationError('Invalid synthetic PCM size');
  // Each pair of output samples covers three source samples with a half-sample overlap.
  const output = Buffer.alloc(Math.floor(input.length / 3) * 2);
  for (let offset = 0, index = 0; index < output.length; offset += 6, index += 4) {
    const a = input.readInt16LE(offset);
    const b = input.readInt16LE(offset + 2);
    output.writeInt16LE(Math.round((2 * a + b) / 3), index);
    if (index + 2 < output.length)
      output.writeInt16LE(Math.round((b + 2 * input.readInt16LE(offset + 4)) / 3), index + 2);
  }
  if (!output.length || !output.some(byte => byte !== 0))
    throw new VerificationError('Synthetic input is silent or empty');
  return output;
}

function wavPCMBytes(data) {
  const wav = Buffer.from(data);
  if (wav.length <= 44 || wav.toString('ascii', 0, 4) !== 'RIFF'
      || wav.toString('ascii', 8, 16) !== 'WAVEfmt ' || wav.readUInt32LE(16) !== 16
      || wav.readUInt16LE(20) !== 1 || wav.readUInt16LE(22) !== 1
      || wav.readUInt32LE(24) !== 24000 || wav.readUInt16LE(34) !== 16
      || wav.toString('ascii', 36, 40) !== 'data' || wav.readUInt32LE(4) + 8 !== wav.length
      || wav.readUInt32LE(40) !== wav.length - 44 || wav.length % 2)
    throw new VerificationError('Invalid 24 kHz mono PCM16 WAV segment');
  return wav.length - 44;
}

async function synthesize() {
  const health = await fetch(`${cosyVoice}/health`, { redirect: 'error', signal: AbortSignal.timeout(5000) });
  if (!health.ok || (await health.json()).status !== 'ok')
    throw new VerificationError('CosyVoice health check failed');
  const response = await fetch(`${cosyVoice}/tts/stream`, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(120000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: testText }),
  });
  if (!response.ok || !response.body || response.headers.get('x-audio-format') !== 'pcm_s16le'
      || response.headers.get('x-audio-sample-rate') !== '24000' || response.headers.get('x-audio-channels') !== '1') {
    await response.body?.cancel();
    throw new VerificationError('CosyVoice did not return 24 kHz mono PCM16');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > maxInputBytes * 1.5)
      throw new VerificationError('CosyVoice synthetic input exceeds the audio limit');
    chunks.push(chunk);
  }
  return pcm16k(Buffer.concat(chunks, size));
}

async function verify(pcm) {
  const ws = new WebSocket(voiceSocket);
  ws.binaryType = 'arraybuffer';
  const id = randomUUID();
  let submitted = false;
  let asrChars = 0;
  let replyChars = 0;
  let segmentOpen = false;
  let segmentFrames = 0;
  let segments = 0;
  let pcmBytes = 0;
  let wavBytes = 0;
  let deadline;
  try {
    return await new Promise((resolve, reject) => {
      deadline = setTimeout(() => reject(new VerificationError(submitted ? 'Local turn timed out' : 'Local session did not become ready')), 15000);
      ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'session.start', provider: 'local', input_rate: 16000, codec: 'pcm_s16le' })));
      ws.addEventListener('error', () => reject(new VerificationError('Local WebSocket failed')));
      ws.addEventListener('close', () => reject(new VerificationError('Local WebSocket closed before turn.end')));
      ws.addEventListener('message', ({ data }) => {
        try {
          if (data instanceof ArrayBuffer) {
            if (!submitted || !segmentOpen || segmentFrames !== 0 || wavBytes + data.byteLength > maxOutputBytes)
              throw new VerificationError('Unexpected WAV frame or output over limit');
            pcmBytes += wavPCMBytes(data);
            wavBytes += data.byteLength;
            segmentFrames++;
            return;
          }
          if (typeof data !== 'string' || data.length > 16000)
            throw new VerificationError('Invalid local WebSocket control frame');
          const event = JSON.parse(data);
          if (event.type === 'session.ready' && !submitted) {
            if (event.provider !== 'local' || event.streaming)
              throw new VerificationError('Backend did not confirm local turn mode');
            submitted = true;
            clearTimeout(deadline);
            deadline = setTimeout(() => reject(new VerificationError(`Local turn timed out (ASR nonempty=${asrChars > 0}, reply chars=${replyChars}, WAV segments=${segments})`)), 120000);
            ws.send(pcm);
            ws.send(JSON.stringify({ type: 'input.end', turn_id: id }));
            return;
          }
          if (event.type === 'error' && (!event.turn_id || event.turn_id === id))
            throw new VerificationError(`Local backend reported an error (ASR nonempty=${asrChars > 0}, reply chars=${replyChars}, WAV segments=${segments})`);
          if (!submitted || event.turn_id !== id)
            return;
          switch (event.type) {
            case 'asr.final': asrChars = typeof event.text === 'string' ? [...event.text.trim()].length : 0; break;
            case 'assistant.text.delta': replyChars += typeof event.text === 'string' ? [...event.text.trim()].length : 0; break;
            case 'assistant.audio.start':
              if (segmentOpen || event.segment !== true)
                throw new VerificationError('Invalid audio segment start');
              segmentOpen = true;
              segmentFrames = 0;
              break;
            case 'assistant.audio.end':
              if (!segmentOpen || segmentFrames !== 1 || event.segment !== true)
                throw new VerificationError('Invalid audio segment completion');
              segmentOpen = false;
              segments++;
              break;
            case 'turn.end':
              if (!asrChars || !replyChars || !segments || segmentOpen)
                throw new VerificationError(`Incomplete local turn (ASR nonempty=${asrChars > 0}, reply chars=${replyChars}, WAV segments=${segments})`);
              resolve({ asr_nonempty: true, asr_chars: asrChars, reply_chars: replyChars, wav_segments: segments, wav_bytes: wavBytes, reply_pcm_bytes: pcmBytes });
              break;
          }
        } catch (error) {
          reject(error instanceof SyntaxError ? new VerificationError('Invalid local JSON response') : error);
        }
      });
    });
  } finally {
    clearTimeout(deadline);
    ws.close();
  }
}

function selfTest() {
  assert.deepEqual(pcm16k(Buffer.from([30, 0, 60, 0, 90, 0])), Buffer.from([40, 0, 80, 0]));
  assert.throws(() => pcm16k(Buffer.alloc(6)), /silent/);
  assert.throws(() => pcm16k(Buffer.alloc(3)), /size/);
  const wav = Buffer.alloc(46);
  wav.write('RIFF');
  wav.writeUInt32LE(38, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(24000, 24);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(2, 40);
  assert.equal(wavPCMBytes(wav), 2);
  assert.throws(() => wavPCMBytes(wav.subarray(0, 45)), /Invalid/);
}

const args = process.argv.slice(2);
let stage = 'self-test';
try {
  selfTest();
  if (args.length === 1 && args[0] === '--self-test') {
    console.log(JSON.stringify({ self_test: 'passed' }));
  } else if (args.length === 0) {
    stage = 'CosyVoice synthesis';
    const pcm = await synthesize();
    stage = 'local voice WebSocket';
    const result = await verify(pcm);
    console.log(JSON.stringify({ input: 'synthetic_cosyvoice', human_microphone: false, input_pcm_bytes: pcm.length, ...result }));
  } else {
    stage = 'arguments';
    throw new VerificationError('Usage: node scripts/verify-companion-local.mjs [--self-test]');
  }
} catch (error) {
  // Only print authored diagnostics. Network and upstream exception messages can contain private data.
  const message = error instanceof VerificationError ? error.message : 'request or validation failed';
  console.error(`Verification failed during ${stage}: ${message}`);
  process.exitCode = 1;
}
