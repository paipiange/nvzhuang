package com.paipiange.nvzhuang;

import android.Manifest;
import android.annotation.SuppressLint;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.AudioTrack;
import android.media.MediaRecorder;
import android.media.audiofx.AcousticEchoCanceler;
import android.media.audiofx.NoiseSuppressor;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.webkit.WebView;

import androidx.webkit.JavaScriptReplyProxy;

import org.json.JSONException;
import org.json.JSONObject;

import android.util.Base64;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

final class NativeDuplexAudioBridge {
    interface PermissionDelegate {
        void request(String sessionId);
        void cancel(String sessionId);
    }

    private static final int INPUT_RATE = 16000;
    private static final int OUTPUT_RATE = 24000;
    private static final int FRAME_SAMPLES = 320;
    private static final int FRAME_BYTES = FRAME_SAMPLES * 2;
    private static final int PLAYBACK_QUEUE_CHUNKS = 32;

    private final MainActivity activity;
    private final WebView webView;
    private final PermissionDelegate permissionDelegate;
    private volatile JavaScriptReplyProxy replyProxy;
    private volatile String captureSessionId;
    private volatile CaptureRun captureRun;
    private volatile PlaybackRun playbackRun;

    NativeDuplexAudioBridge(MainActivity activity, WebView webView, PermissionDelegate permissionDelegate) {
        this.activity = activity;
        this.webView = webView;
        this.permissionDelegate = permissionDelegate;
    }

    void onMessage(String message, Uri sourceOrigin, boolean isMainFrame, JavaScriptReplyProxy proxy) {
        if (!isMainFrame || !isTrustedOrigin(sourceOrigin) || !isTrustedPage()) return;
        replyProxy = proxy;
        try {
            if (!NativeAudioProtocol.isValidMessage(message)) return;
            JSONObject command = new JSONObject(message);
            String type = command.optString("type", "");
            String id = command.optString("id", "");
            if (!NativeAudioProtocol.isValidId(id)) return;
            switch (type) {
                case "startCapture":
                    requestCapture(id);
                    break;
                case "stopCapture":
                    stopCapture();
                    break;
                case "beginPlayback":
                    beginPlayback(id);
                    break;
                case "pushPlayback":
                    pushPlayback(id, command.optString("pcm", ""));
                    break;
                case "endPlayback":
                    endPlayback(id);
                    break;
                case "clearPlayback":
                    clearPlayback();
                    break;
                case "dispose":
                    dispose();
                    break;
                default:
                    break;
            }
        } catch (JSONException | IllegalArgumentException ignored) {
            emit("capture.error", captureSessionId, "", null, 0, 0, "invalid_audio_frame");
        }
    }

    static boolean isTrustedOrigin(Uri origin) {
        return origin != null && "https".equalsIgnoreCase(origin.getScheme())
                && "appassets.androidplatform.net".equalsIgnoreCase(origin.getHost())
                && (origin.getPort() == -1 || origin.getPort() == 443);
    }

    private boolean isTrustedPage() {
        String url = webView.getUrl();
        return url != null && isTrustedOrigin(Uri.parse(url));
    }

    private void requestCapture(String sessionId) {
        if (activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            startCapture(sessionId);
        } else {
            stopCapture();
            captureSessionId = sessionId;
            permissionDelegate.request(sessionId);
        }
    }

    void onMicrophonePermissionResult(String sessionId, boolean granted) {
        if (sessionId == null || !sessionId.equals(captureSessionId)) return;
        if (!granted || !isTrustedPage()) {
            emit("capture.error", sessionId, "", null, 0, 0, "microphone_denied");
            captureSessionId = null;
            return;
        }
        startCapture(sessionId);
    }

    private void startCapture(String sessionId) {
        stopCapture();
        if (!isTrustedPage() || activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            emit("capture.error", sessionId, "", null, 0, 0, "microphone_denied");
            return;
        }
        int minimum = AudioRecord.getMinBufferSize(INPUT_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        if (minimum <= 0) {
            emit("capture.error", sessionId, "", null, 0, 0, "duplex_not_supported");
            return;
        }
        int bufferSize = Math.max(minimum, FRAME_BYTES * 4);
        try {
            AudioRecord record = new AudioRecord.Builder()
                    .setAudioSource(MediaRecorder.AudioSource.VOICE_COMMUNICATION)
                    .setAudioFormat(new AudioFormat.Builder()
                            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                            .setSampleRate(INPUT_RATE)
                            .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
                            .build())
                    .setBufferSizeInBytes(bufferSize)
                    .build();
            if (record.getState() != AudioRecord.STATE_INITIALIZED) {
                record.release();
                emit("capture.error", sessionId, "", null, 0, 0, "duplex_not_supported");
                return;
            }
            CaptureRun run = new CaptureRun(sessionId, record);
            captureSessionId = sessionId;
            captureRun = run;
            run.thread.start();
        } catch (SecurityException denied) {
            emit("capture.error", sessionId, "", null, 0, 0, "microphone_denied");
        } catch (RuntimeException unavailable) {
            emit("capture.error", sessionId, "", null, 0, 0, "duplex_not_supported");
        }
    }

    private final class CaptureRun implements Runnable {
        final String sessionId;
        final AudioRecord record;
        final AtomicBoolean running = new AtomicBoolean(true);
        final Thread thread;
        AcousticEchoCanceler echoCanceler;
        NoiseSuppressor noiseSuppressor;

        CaptureRun(String sessionId, AudioRecord record) {
            this.sessionId = sessionId;
            this.record = record;
            this.thread = new Thread(this, "companion-audio-capture");
        }

        @Override
        @SuppressLint("MissingPermission")
        public void run() {
            try {
                if (AcousticEchoCanceler.isAvailable()) {
                    echoCanceler = AcousticEchoCanceler.create(record.getAudioSessionId());
                    if (echoCanceler != null) echoCanceler.setEnabled(true);
                }
                if (NoiseSuppressor.isAvailable()) {
                    noiseSuppressor = NoiseSuppressor.create(record.getAudioSessionId());
                    if (noiseSuppressor != null) noiseSuppressor.setEnabled(true);
                }
                record.startRecording();
                if (record.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) {
                    emitCaptureError(sessionId, "microphone_denied");
                    return;
                }
                short[] samples = new short[FRAME_SAMPLES];
                ByteBuffer pcm = ByteBuffer.allocate(FRAME_BYTES).order(ByteOrder.LITTLE_ENDIAN);
                int filled = 0;
                emit("capture.started", sessionId, "", null, 0, 0, "");
                while (running.get()) {
                    int count = record.read(samples, filled, FRAME_SAMPLES - filled, AudioRecord.READ_BLOCKING);
                    if (count < 0) {
                        if (running.get()) emitCaptureError(sessionId, "microphone_denied");
                        break;
                    }
                    if (count == 0) continue;
                    filled += count;
                    if (filled < FRAME_SAMPLES) continue;
                    pcm.clear();
                    double squared = 0;
                    int peak = 0;
                    for (short sample : samples) {
                        pcm.putShort(sample);
                        int magnitude = Math.abs((int) sample);
                        peak = Math.max(peak, magnitude);
                        double normalized = sample / 32768.0;
                        squared += normalized * normalized;
                    }
                    double rms = Math.sqrt(squared / FRAME_SAMPLES);
                    emit("capture.frame", sessionId, "", Base64.encodeToString(pcm.array(), Base64.NO_WRAP), rms, peak / 32768.0, "");
                    filled = 0;
                }
            } catch (SecurityException denied) {
                if (running.get()) emitCaptureError(sessionId, "microphone_denied");
            } catch (RuntimeException failure) {
                if (running.get()) emitCaptureError(sessionId, "seeduplex_unavailable");
            } finally {
                running.set(false);
                releaseEffects();
                try { record.stop(); } catch (IllegalStateException ignored) { }
                record.release();
                if (captureRun == this) captureRun = null;
            }
        }

        void stop() {
            if (!running.getAndSet(false)) return;
            try { record.stop(); } catch (IllegalStateException ignored) { }
        }

        void releaseEffects() {
            if (echoCanceler != null) { echoCanceler.release(); echoCanceler = null; }
            if (noiseSuppressor != null) { noiseSuppressor.release(); noiseSuppressor = null; }
        }
    }

    private void emitCaptureError(String sessionId, String code) {
        emit("capture.error", sessionId, "", null, 0, 0, code);
    }

    private void stopCapture() {
        String pending = captureSessionId;
        captureSessionId = null;
        if (pending != null) permissionDelegate.cancel(pending);
        CaptureRun run = captureRun;
        if (run != null) run.stop();
    }

    private void beginPlayback(String playbackId) {
        clearPlayback();
        if (!isTrustedPage()) return;
        int minimum = AudioTrack.getMinBufferSize(OUTPUT_RATE, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT);
        if (minimum <= 0) {
            emit("playback.error", "", playbackId, null, 0, 0, "duplex_not_supported");
            return;
        }
        try {
            AudioTrack track = new AudioTrack.Builder()
                    .setAudioAttributes(new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                            .build())
                    .setAudioFormat(new AudioFormat.Builder()
                            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                            .setSampleRate(OUTPUT_RATE)
                            .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                            .build())
                    .setTransferMode(AudioTrack.MODE_STREAM)
                    .setBufferSizeInBytes(Math.max(minimum, OUTPUT_RATE * 2 / 2))
                    .build();
            if (track.getState() != AudioTrack.STATE_INITIALIZED) {
                track.release();
                emit("playback.error", "", playbackId, null, 0, 0, "duplex_not_supported");
                return;
            }
            PlaybackRun run = new PlaybackRun(playbackId, track);
            playbackRun = run;
            track.play();
            run.thread.start();
        } catch (RuntimeException failure) {
            emit("playback.error", "", playbackId, null, 0, 0, "duplex_not_supported");
        }
    }

    private void pushPlayback(String playbackId, String encoded) {
        PlaybackRun run = playbackRun;
        if (run == null || !run.playbackId.equals(playbackId) || run.ending || run.cancelled.get()) return;
        if (!NativeAudioProtocol.isValidEncodedPcmLength(encoded)) {
            run.fail("invalid_audio_frame");
            return;
        }
        try {
            byte[] pcm = Base64.decode(encoded, Base64.DEFAULT);
            if (!NativeAudioProtocol.isValidPcm(pcm)) {
                run.fail("invalid_audio_frame");
            } else if (!run.queue.offer(pcm)) {
                run.fail("audio_backpressure");
            }
        } catch (IllegalArgumentException invalid) {
            run.fail("invalid_audio_frame");
        }
    }

    private void endPlayback(String playbackId) {
        PlaybackRun run = playbackRun;
        if (run != null && run.playbackId.equals(playbackId)) {
            run.ending = true;
            synchronized (run) { run.notifyAll(); }
        }
    }

    private void clearPlayback() {
        PlaybackRun run = playbackRun;
        playbackRun = null;
        if (run != null) run.stop();
    }

    private final class PlaybackRun implements Runnable {
        final String playbackId;
        final AudioTrack track;
        final ArrayBlockingQueue<byte[]> queue = new ArrayBlockingQueue<>(PLAYBACK_QUEUE_CHUNKS);
        final AtomicBoolean cancelled = new AtomicBoolean(false);
        final Thread thread;
        volatile boolean ending;
        long framesWritten;

        PlaybackRun(String playbackId, AudioTrack track) {
            this.playbackId = playbackId;
            this.track = track;
            this.thread = new Thread(this, "companion-audio-playback");
        }

        @Override
        public void run() {
            try {
                while (!cancelled.get()) {
                    byte[] pcm = queue.poll(100, TimeUnit.MILLISECONDS);
                    if (pcm == null) {
                        if (!ending) continue;
                        break;
                    }
                    int offset = 0;
                    while (offset < pcm.length && !cancelled.get()) {
                        int written = track.write(pcm, offset, pcm.length - offset, AudioTrack.WRITE_BLOCKING);
                        if (written <= 0) throw new IllegalStateException("audio_track_write_failed");
                        offset += written;
                        framesWritten += written / 2;
                    }
                }
                while (ending && !cancelled.get()
                        && Integer.toUnsignedLong(track.getPlaybackHeadPosition()) < framesWritten) {
                    Thread.sleep(10);
                }
                if (!cancelled.get() && playbackRun == this) {
                    playbackRun = null;
                    emit("playback.complete", "", playbackId, null, 0, 0, "");
                }
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            } catch (RuntimeException failure) {
                if (!cancelled.get()) emit("playback.error", "", playbackId, null, 0, 0, "seeduplex_unavailable");
            } finally {
                cancelled.set(true);
                try { track.stop(); } catch (IllegalStateException ignored) { }
                track.flush();
                track.release();
            }
        }

        void fail(String code) {
            if (!cancelled.getAndSet(true)) {
                queue.clear();
                try { track.pause(); track.flush(); } catch (IllegalStateException ignored) { }
                emit("playback.error", "", playbackId, null, 0, 0, code);
            }
        }

        void stop() {
            if (cancelled.getAndSet(true)) return;
            queue.clear();
            try { track.pause(); track.flush(); } catch (IllegalStateException ignored) { }
            thread.interrupt();
        }
    }

    void resetForNavigation() {
        stopCapture();
        clearPlayback();
        replyProxy = null;
    }

    void dispose() {
        resetForNavigation();
    }

    private void emit(String type, String sessionId, String playbackId, String pcm, double rms, double peak, String code) {
        JSONObject event = new JSONObject();
        try {
            event.put("type", type);
            if (sessionId != null && !sessionId.isEmpty()) event.put("sessionId", sessionId);
            if (playbackId != null && !playbackId.isEmpty()) event.put("playbackId", playbackId);
            if (pcm != null) event.put("pcm", pcm);
            if (rms != 0 || type.equals("capture.frame")) event.put("rms", rms);
            if (peak != 0 || type.equals("capture.frame")) event.put("peak", peak);
            if (code != null && !code.isEmpty()) event.put("code", code);
        } catch (JSONException impossible) { return; }
        String payload = event.toString();
        activity.runOnUiThread(() -> {
            JavaScriptReplyProxy proxy = replyProxy;
            if (proxy == null || !isTrustedPage()) return;
            try { proxy.postMessage(payload); } catch (RuntimeException ignored) { }
        });
    }
}
