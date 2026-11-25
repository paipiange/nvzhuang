import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

const args = process.argv.slice(2);
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const audioPath = option('--audio');
const rounds = Number(option('--rounds') || 25);
const endpoint = new URL(option('--url') || 'ws://127.0.0.1:8000/api/v1/voice/ws');
if (!audioPath) throw Error('usage: node scripts/verify-local-voice.mjs --audio <pcm16k-file> [--rounds 25] [--url ws://127.0.0.1:8000/api/v1/voice/ws]');
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 50) throw Error('--rounds must be an integer from 1 to 50');
if (endpoint.protocol !== 'ws:' || !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw Error('--url must be a credential-free ws:// localhost endpoint without query or hash');
const pcm = await readFile(audioPath);
if (!pcm.length || pcm.length % 2 || pcm.length > 2 * 1024 * 1024) throw Error('audio must be non-empty PCM16LE <=2 MiB');

let connections = 0;
async function connect() {
  const ws = new WebSocket(endpoint);
  ws.binaryType = 'arraybuffer';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.close(); reject(Error('WebSocket connect deadline exceeded')); }, 10000);
    ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    ws.addEventListener('error', () => { clearTimeout(timer); reject(Error('WebSocket connect failed')); }, { once: true });
  });
  connections++;
  ws.send(JSON.stringify({ type: 'session.start', provider: 'local', input_rate: 16000, codec: 'pcm_s16le', segment: true }));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); ws.close(); reject(Error('session.ready deadline exceeded')); }, 15000);
    const cleanup = () => { clearTimeout(timer); ws.removeEventListener('message', message); ws.removeEventListener('close', closed); ws.removeEventListener('error', failed); };
    const message = ({ data }) => { if (typeof data !== 'string') return; try { if (JSON.parse(data).type === 'session.ready') { cleanup(); resolve(); } } catch (error) { cleanup(); reject(error); } };
    const closed = () => { cleanup(); reject(Error('WebSocket closed before session.ready')); };
    const failed = () => { cleanup(); reject(Error('WebSocket failed before session.ready')); };
    ws.addEventListener('message', message); ws.addEventListener('close', closed); ws.addEventListener('error', failed);
  });
  return ws;
}
function audioSegment(data) {
  if (!(data instanceof ArrayBuffer)) throw Error('binary frames must be ArrayBuffer');
  const bytes = new Uint8Array(data);
  if (bytes.length < 44 || String.fromCharCode(...bytes.subarray(0,4)) !== 'RIFF' || String.fromCharCode(...bytes.subarray(8,12)) !== 'WAVE') throw Error('audio segment is not a RIFF/WAVE frame');
  const view = new DataView(data);
  if (view.getUint16(20,true)!==1 || view.getUint16(22,true)!==1 || view.getUint32(24,true)!==24000 || view.getUint16(34,true)!==16) throw Error('audio segment format must be mono PCM16 at 24 kHz');
  const dataSize = view.getUint32(40,true);
  if (dataSize === 0 || dataSize !== bytes.length - 44 || dataSize % 2 !== 0 || view.getUint32(4,true) + 8 !== bytes.length) throw Error('RIFF data size is inconsistent');
  return dataSize;
}
async function executeTurn(ws, index, cancel = false) {
  const id = `verify-${Date.now()}-${index}`;
  const started = performance.now();
  let asrMs = null, textMs = null, firstAudioMs = null, responseChars = 0, audioBytes = 0, audioStarted = 0, audioEnded = 0, insideSegment = false;
  return await new Promise((resolve,reject)=>{
    let settled = false;
    let cancelTimer;
    const cleanup=()=>{clearTimeout(deadline);clearTimeout(cancelTimer);ws.removeEventListener('message',message);ws.removeEventListener('close',closed);ws.removeEventListener('error',failed)};
    const succeed=result=>{if(settled)return;settled=true;cleanup();resolve(result)};
    const fail=error=>{if(settled)return;settled=true;cleanup();ws.close();reject(error)};
    const deadline=setTimeout(()=>fail(Error(`turn ${index} deadline exceeded`)),120000);
    const message=({data})=>{
      if(settled)return;
      try {
        if(typeof data!=='string') { if(!insideSegment) throw Error('binary audio outside an open segment'); audioBytes+=audioSegment(data); firstAudioMs ??= Math.round(performance.now()-started); return; }
        const event=JSON.parse(data);
        if(event.turn_id&&event.turn_id!==id)return;
        if(event.type==='asr.final')asrMs=Math.round(performance.now()-started);
        if(event.type==='assistant.text.delta'){textMs??=Math.round(performance.now()-started);responseChars+=(event.text||'').length;}
        if(event.type==='assistant.audio.start'){if(insideSegment)throw Error('nested audio segment');insideSegment=true;audioStarted++;}
        if(event.type==='assistant.audio.end'){if(!insideSegment)throw Error('audio segment ended without a start');insideSegment=false;audioEnded++;}
        if(event.type==='assistant.cancel'&&cancel){succeed({round:index,cancelled:true,ack_ms:Math.round(performance.now()-started)});return;}
        if(event.type==='error')throw Error(event.message||'backend returned error');
        if(event.type==='turn.end'){
          if(cancel)throw Error('cancelled turn unexpectedly produced turn.end');
          if(insideSegment||audioStarted===0||audioEnded!==audioStarted||audioBytes<=44||asrMs===null||textMs===null||responseChars===0)throw Error(`incomplete turn: asr=${asrMs!==null},text=${textMs!==null},segments=${audioStarted}/${audioEnded},bytes=${audioBytes}`);
          succeed({round:index,asr_ms:asrMs,text_ms:textMs,first_audio_ms:firstAudioMs,turn_end_ms:Math.round(performance.now()-started),audio_segments:audioStarted,audio_pcm_bytes:audioBytes,reply_chars:responseChars});
        }
      }catch(error){fail(error)}
    };
    const closed=()=>{if(!settled)fail(Error(`WebSocket closed before turn ${index} completed`));};
    const failed=()=>{if(!settled)fail(Error(`WebSocket failed during turn ${index}`));};
    ws.addEventListener('message',message);ws.addEventListener('close',closed);ws.addEventListener('error',failed);
    ws.send(pcm);ws.send(JSON.stringify({type:'input.end',turn_id:id}));
    if(cancel)cancelTimer=setTimeout(()=>{if(!settled)ws.send(JSON.stringify({type:'assistant.cancel',turn_id:id}));},100);
  });
}

const results=[],cancellations=[];
let ws=await connect();
try{
  for(let i=1;i<=rounds;i++){
    if(i>1&&i%10===0){ws.close();ws=await connect();}
    if(i===Math.min(5,rounds)){cancellations.push(await executeTurn(ws,i,true));ws.close();ws=await connect();}
    results.push(await executeTurn(ws,i));
  }
}finally{ws.close();}
const times=results.map(turn=>turn.turn_end_ms).sort((a,b)=>a-b);
console.log(JSON.stringify({endpoint:`${endpoint.origin}${endpoint.pathname}`,rounds_requested:rounds,rounds_succeeded:results.length,cancellations,reconnects:connections-1,min_turn_end_ms:times[0],median_turn_end_ms:times[Math.floor(times.length/2)],max_turn_end_ms:times.at(-1),results}));
