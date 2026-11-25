package com.paipiange.nvzhuang;

final class NativeAudioProtocol {
    static final int MAX_MESSAGE_CHARS = 96 * 1024;
    static final int MAX_OUTPUT_CHUNK_BYTES = 64 * 1024;
    static final int MAX_ENCODED_PCM_CHARS = ((MAX_OUTPUT_CHUNK_BYTES + 2) / 3) * 4;

    private NativeAudioProtocol() {
    }

    static boolean isValidMessage(String message) {
        return message != null && !message.isEmpty() && message.length() <= MAX_MESSAGE_CHARS;
    }

    static boolean isValidId(String id) {
        if (id == null || id.isEmpty() || id.length() > 100) {
            return false;
        }
        for (int index = 0; index < id.length(); index++) {
            char value = id.charAt(index);
            boolean accepted = (value >= 'A' && value <= 'Z')
                    || (value >= 'a' && value <= 'z')
                    || (value >= '0' && value <= '9')
                    || value == '_'
                    || value == '-';
            if (!accepted) {
                return false;
            }
        }
        return true;
    }

    static boolean isValidEncodedPcmLength(String encoded) {
        return encoded != null && !encoded.isEmpty() && encoded.length() <= MAX_ENCODED_PCM_CHARS;
    }

    static boolean isValidPcm(byte[] pcm) {
        return pcm != null
                && pcm.length > 0
                && pcm.length <= MAX_OUTPUT_CHUNK_BYTES
                && pcm.length % 2 == 0;
    }
}
