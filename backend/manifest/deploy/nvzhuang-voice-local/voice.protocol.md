# Local voice WebSocket protocol

This is the application's protocol, separate from FunASR's native WebSocket protocol.
The endpoints are `/api/v1/voice/ws` and `/api/v1/companions/voice/ws`.

## Client → GoFrame

- Start: `{"type":"session.start","provider":"local","input_rate":16000,"codec":"pcm_s16le"}`. The server acknowledges with `session.ready`. A new session clears that connection's previous local history.
- Binary input: 16 kHz mono signed little-endian PCM, or MP3 when the start message declares `codec:"mp3"`. H5 sends the recorded utterance as PCM; the native App sends MP3 frames or its completed recording file. The backend converts MP3 to PCM. Maximum input is 2 MiB, approximately 64 seconds of PCM.
- Finish recording: `{"type":"input.end","turn_id":"unique-id"}`.
- Discard recording: `{"type":"input.cancel","turn_id":"..."}`.
- Interrupt generation/playback: `{"type":"playback.interrupted","turn_id":"..."}` or `assistant.cancel`.
- Clear local conversation: `{"type":"session.reset"}`. The server cancels the current turn, clears history and buffered input, and acknowledges with `{"type":"session.reset"}`. The App offers this while idle.

Local conversation history is confined to one WebSocket connection, bounded to the last six completed turns and 6,000 Unicode characters. Failed or canceled generation does not commit its current turn. History is cleared by reset, a new session, or disconnection, and is not written to logs, files or a database.

## GoFrame → client

Local messages with a `turn_id` belong to that utterance:

1. `asr.processing`, then `asr.final` with recognized `text`.
2. `assistant.text.delta` with the complete reply in `text`. This event currently contains a complete reply, despite its historical name.
3. Each local audio segment is sent as:
   - `{"type":"assistant.audio.start","turn_id":"...","sample_rate":24000,"codec":"pcm_s16le","channels":1,"segment":true}`
   - One binary **complete RIFF/WAV file** containing PCM16LE, 24 kHz mono audio.
   - `{"type":"assistant.audio.end","turn_id":"...","segment":true}`.
4. The three-message audio sequence repeats in order, normally for 0.5-second segments; the last segment may be shorter.
5. `turn.end` means generation is complete. It does not mean playback is complete. The client stays busy until generation has ended and all queued audio has played.

The client must play segments in FIFO order, retain the current player when another segment starts arriving, and clear all pending audio on interruption. Late binary decoding or player callbacks must not revive canceled turns. Audio for different turns is never interleaved; stale generations are suppressed by the server.

`assistant.cancel` acknowledges interruption. `error` includes a `code`, `message` and, when applicable, `turn_id`. On a failed streamed turn, stop and discard any partially queued reply. A canceled turn may have already played a partial answer.

The optional SeedDuplex adapter keeps its existing **turn-based** input when `streaming` is missing or `false`: send the recording followed by `input.end`; its audio is emitted as complete WAV segments with `segment:true`. It keeps the legacy `asr.partial` event. Open-LLM-VTuber retains its whole-reply audio behavior (audio events omit `segment`) and requires `{"type":"playback.complete","turn_id":"..."}` after actual playback ends. Existing MP3 recording/transcoding paths are unchanged.

## SeedDuplex full-duplex PCM (opt-in)

The same endpoints accept this explicit start message:

```json
{"type":"session.start","provider":"seeduplex","streaming":true,"codec":"pcm_s16le","input_rate":16000,"output_rate":24000,"client_vad":true,"character_id":"zhixia","persona_id":"zhixia","voice_id":"zhixia"}
```

`output_rate` may be omitted (defaults to 24000). Streaming MP3, a non-16000 input rate, a non-24000 output rate, or streaming with another provider is rejected with `unsupported_audio` or `unsupported_streaming`. `client_vad` is an optional capability hint; server/provider VAD remains authoritative. Wait for successful upstream session creation and microphone unmute before considering the following acknowledgment ready:

```json
{"type":"session.ready","provider":"seeduplex","streaming":true,"codec":"pcm_s16le","channels":1,"input_rate":16000,"output_rate":24000,"character_id":"zhixia","persona_id":"zhixia","voice_id":"zhixia"}
```

A reconnect after cancel/reset/timeout emits this negotiation again. Client PCM arriving while upstream creation is pending uses the same bounded transport queue; it is never accumulated as a complete utterance. Each frame is base64-encoded and forwarded as `input_audio_buffer.append` immediately; there is no `input.end`, per-frame pacing delay, or whole-utterance transcode. Do not send audio faster than real time. The upstream microphone stays unmuted and provider VAD separates turns.

### Client controls

| Message | Contract |
| --- | --- |
| Binary PCM | Raw 16 kHz mono PCM16LE; recommend 20 ms / 640-byte frames. Every frame must contain an even, nonzero number of bytes. |
| `input.activity` | Optional local activity hint, e.g. `{"type":"input.activity","active":true}`. It cancels an active assistant early but does not fabricate a provider speech boundary. `active:false` is a no-op. An optional unique `turn_id` suggests the next input ID; omitting it lets the server generate one. A suggested ID equal to the canceled output ID is replaced. |
| `assistant.cancel` | Must contain the current server-issued `turn_id`. `playback.interrupted` and `input.cancel` are compatible aliases in this opt-in path and have the same ID requirement. Missing ID gives `invalid_turn_id`. A stale/duplicate ID only receives `assistant.cancel` for that ID and cannot cancel a newer turn. |
| `session.reset` | Invalidates input/output generations, closes the old upstream, clears per-turn state, acknowledges `session.reset`, then creates a new upstream and repeats `session.ready`. Retains the selected role and connection-wide byte budgets. |
| `session.stop` | Invalidates all output, cancels/closes upstream, acknowledges `session.stopped`, and closes the client connection. |
| `playback.complete` | Accepted idempotently for frontend compatibility. It changes neither VAD boundaries nor provider generation. |
| `input.end` / `text.input` | Rejected with `unsupported_streaming_event`; they continue to work as before in turn-based providers. |

Control JSON is limited to 12 KiB; `turn_id` to 64 bytes. Unknown controls use `unknown_event` and malformed controls use `invalid_message` / `invalid_turn_id`. These validation errors leave the current stream intact.

### Server events and binary context

1. `input.speech.started` and `input.speech.stopped` carry the same nonempty input `turn_id`. They reflect provider `input_audio_buffer.speech_started` / `speech_stopped` events. A new confirmed input while the assistant is active first invalidates/cancels the old output and uses a **different** turn ID.
2. `asr.delta` contains incremental `text`; `asr.final` contains complete recognized `text`. An empty upstream final may use accumulated deltas.
3. `assistant.text.delta` contains incremental `text` (append it). `assistant.text.final` contains the complete final `text` (replace the displayed draft); it is also synthesized from deltas at `response.done` when necessary.
4. `{"type":"assistant.audio.start","turn_id":"...","streaming":true,"codec":"pcm_s16le","sample_rate":24000,"channels":1}` establishes the output context. It is followed by one or more binary **raw PCM16LE** chunks, **without WAV headers**, immediately as upstream deltas arrive. `segment` is omitted. Never decode these chunks as files.
5. `assistant.audio.end` ends that PCM stream; `turn.end` ends model generation. Neither means the client playback queue has drained. An upstream `response.done` also closes an open audio stream when no separate audio-done event arrives.
6. `assistant.cancel` includes the canceled `turn_id`; discard the matching playback queue and clear the matching output context. The server sends `response.cancel` upstream when possible, closes that connection, and opens a fresh one. No old-generation PCM/text can be written after its cancellation/reset acknowledgment. A late duplicate cancel acknowledgment must not clear a different active turn on the client.
7. `error` has a stable `code`, a safe `message`, and a `turn_id` when available. A provider turn that has not finished within 110 seconds after speech stop produces `seeduplex_timeout`, `assistant.cancel`, `turn.end`, then a fresh `session.ready` and resumes listening. Provider/disconnect errors use `seeduplex_error`; invalid provider ASR uses `seeduplex_asr`.

All downstream writes are serialized by one writer. Queued output carries a generation checked under the same lock as generation invalidation and socket writes. Every replacement upstream has a separate event channel; old socket callbacks cannot enter the replacement stream. Provider response IDs are additionally filtered against recently completed responses. Raw binaries belong only to the most recent valid audio-start context; clients must independently track their WebSocket/turn generations and discard late decoder/player callbacks. Reconnection does not replay audio already sent to the canceled upstream; microphone clients should retain their normal bounded capture/backpressure behavior through repeated `session.ready`.

### Streaming limits and backpressure

| Resource | Hard limit / behavior |
| --- | --- |
| Input PCM frame | 16 KiB, even and nonzero; `invalid_audio_frame` otherwise. Frames over the WebSocket 64 KiB read cap close the connection directly. |
| Provider output PCM frame | 64 KiB after base64 decoding, even and nonzero; encoded size checked before allocation. `seeduplex_audio` on malformed/oversized output. |
| Confirmed input speech turn | 2 MiB between provider speech-start/stop; `audio_too_large`. Silence outside confirmed speech does not consume this turn budget. |
| Output turn | 32 MiB; `seeduplex_audio`. |
| Entire client connection | 64 MiB input and 128 MiB output, including silence and canceled/reset turns; `session_audio_limit`. Reset/cancel never refreshes the session quota. Reconnect deliberately starts a new quota. |
| In-flight transport | 32 upstream commands and 32 downstream packets. Upstream PCM commands contain at most one 16 KiB frame each; downstream PCM packets at most 64 KiB each. Provider events and client reads apply backpressure rather than allocating whole-turn buffers. |
| Upstream congestion | `seeduplex_backpressure`, cancel/close the stream; never grow a queue without bound. Slow downstream writes have a 5-second deadline and close the connection on failure/queue exhaustion. |
| Text | ASR max 2,000 Unicode characters; accumulated ASR/reply deltas max 8,000 bytes each. Reply overflow uses `seeduplex_text_limit`. |

Frame/quota/provider failures invalidate pending output, emit a safe error (and `turn.end` when applicable), close upstream and end the connection. If the transport itself is already failed or backlogged, delivery of an error cannot be guaranteed; connection closure is the failure signal. The client should clear playback and reconnect explicitly. No raw audio, recognized/reply text, or API Key is logged or persisted by this adapter.

## Server-owned character/persona/voice profiles

`session.start` may include `character_id`, `persona_id` and `voice_id`. IDs select server-owned profiles, **never arbitrary instructions, upstream speaker names, paths or URLs**. The allowlist is `zhixia/zhixia/zhixia` (知夏) and `linxi/linxi/linxi` (林溪). Missing IDs default to the selected character; completely missing profile fields default to 知夏 for legacy clients. An unknown or mixed combination gives `unsupported_character` before session setup. Successful local/SeedDuplex ready events echo the normalized profile IDs. Released clients using exactly `character_id:"xiaotao"` with absent/empty `persona_id` and `voice_id` retain compatibility: local/SeedDuplex normalize this legacy alias to 知夏, and VTuber treats it as no dynamic-role request. `xiaotao` combined with either new profile field is rejected; this alias does not permit arbitrary role combinations.

Both local Qwen and SeedDuplex receive the actual selected persona with the existing AI identity, boundaries and concise Chinese speech requirements. Local conversation history is reset on a new `session.start`, so a changed role cannot inherit the previous role's dialogue. Reset retains the current profile. The backend applies these explicit environment mappings:

| Profile | Local CosyVoice | SeedDuplex |
| --- | --- | --- |
| `zhixia` | `VOICE_LOCAL_ZHIXIA`; default `local-reference`, preserving the existing licensed reference voice. | `SEEDUPLEX_VOICE_ZHIXIA`, then legacy `SEEDUPLEX_VOICE`, then existing default `zh_female_vv_jupiter_bigtts`. |
| `linxi` | Required `VOICE_LOCAL_LINXI=linxi-reference`. Configure the CosyVoice service's `COSYVOICE_LINXI_REFERENCE_WAV` and `COSYVOICE_LINXI_REFERENCE_TEXT` together; the reference must exist inside `NVZHUANG_ROOT` and be authorized. It registers `linxi-reference` at startup. | Required `SEEDUPLEX_VOICE_LINXI` containing an authorized upstream speaker name. |

An unconfigured 林溪 mapping fails negotiation with `voice_not_configured`; there is no silent fallback to 知夏's voice. Mapping values must be bounded speaker identifiers. CosyVoice accepts only registered `voice_id` values, rejects missing speakers with HTTP 422, and exposes its registered speaker IDs in `/health` for deployment checks. Set the Go mapping **and** the corresponding Python reference configuration consistently; a mismatched deployment fails synthesis rather than silently selecting another speaker. Reference transcripts and local paths are not accepted from WebSocket clients.

Open-LLM-VTuber's persona/voice remain owned by its external configuration. Requests carrying any explicit new profile field/combination are rejected with `unsupported_character`; legacy starts without profile fields, or with the exact `xiaotao` alias above, continue unchanged. A frontend must not advertise dynamic profile switching for this adapter.

## FunASR adapter

The backend opens FunASR's 2-pass connection with:

```json
{"mode":"2pass","wav_name":"session-unique-id","is_speaking":true,"wav_format":"pcm","audio_fs":16000,"chunk_size":[5,10,5],"itn":true}
```

It sends raw PCM and then `{"is_speaking":false}`. Multiple `2pass-offline` results are concatenated until an explicit `is_final:true`, including a separate empty final marker. Online previews do not finalize the utterance.

## Privacy and deployment

- Each utterance has a cancellable context and generation ID. Interruptions cancel upstream requests, discard queued playback and suppress late events.
- H5 requests device echo cancellation and noise suppression. Their effect depends on the host microphone; an emulator microphone device does not prove that a physical host input is connected.
- Inference services bind to loopback. Use authenticated HTTPS/WSS for external access; do not expose model ports publicly.
- Raw recordings are not saved by the backend. Native recording/reply temporary files and H5 Blob URLs are released after use. A voice reference must be authorized and its transcript must match the actual recording.
