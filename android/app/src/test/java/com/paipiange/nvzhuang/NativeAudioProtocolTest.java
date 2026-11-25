package com.paipiange.nvzhuang;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public final class NativeAudioProtocolTest {
    @Test
    public void acceptsBoundedProtocolMessages() {
        assertTrue(NativeAudioProtocol.isValidMessage("{}"));
        assertTrue(NativeAudioProtocol.isValidMessage(repeat('a', NativeAudioProtocol.MAX_MESSAGE_CHARS)));
        assertFalse(NativeAudioProtocol.isValidMessage(null));
        assertFalse(NativeAudioProtocol.isValidMessage(""));
        assertFalse(NativeAudioProtocol.isValidMessage(repeat('a', NativeAudioProtocol.MAX_MESSAGE_CHARS + 1)));
    }

    @Test
    public void acceptsOnlyOpaqueAsciiIdentifiers() {
        assertTrue(NativeAudioProtocol.isValidId("turn_1-playback"));
        assertTrue(NativeAudioProtocol.isValidId(repeat('a', 100)));
        assertFalse(NativeAudioProtocol.isValidId(null));
        assertFalse(NativeAudioProtocol.isValidId(""));
        assertFalse(NativeAudioProtocol.isValidId(repeat('a', 101)));
        assertFalse(NativeAudioProtocol.isValidId("turn/1"));
        assertFalse(NativeAudioProtocol.isValidId("turn 1"));
        assertFalse(NativeAudioProtocol.isValidId("回合1"));
    }

    @Test
    public void rejectsOddEmptyAndOversizedPcmFrames() {
        assertTrue(NativeAudioProtocol.isValidPcm(new byte[] { 0, 1 }));
        assertTrue(NativeAudioProtocol.isValidPcm(new byte[NativeAudioProtocol.MAX_OUTPUT_CHUNK_BYTES]));
        assertFalse(NativeAudioProtocol.isValidPcm(null));
        assertFalse(NativeAudioProtocol.isValidPcm(new byte[0]));
        assertFalse(NativeAudioProtocol.isValidPcm(new byte[] { 0 }));
        assertFalse(NativeAudioProtocol.isValidPcm(new byte[NativeAudioProtocol.MAX_OUTPUT_CHUNK_BYTES + 2]));
    }

    @Test
    public void boundsBase64BeforeDecoding() {
        assertTrue(NativeAudioProtocol.isValidEncodedPcmLength("AA=="));
        assertTrue(NativeAudioProtocol.isValidEncodedPcmLength(repeat('A', NativeAudioProtocol.MAX_ENCODED_PCM_CHARS)));
        assertFalse(NativeAudioProtocol.isValidEncodedPcmLength(null));
        assertFalse(NativeAudioProtocol.isValidEncodedPcmLength(""));
        assertFalse(NativeAudioProtocol.isValidEncodedPcmLength(repeat('A', NativeAudioProtocol.MAX_ENCODED_PCM_CHARS + 1)));
    }

    private static String repeat(char value, int count) {
        StringBuilder result = new StringBuilder(count);
        for (int index = 0; index < count; index++) {
            result.append(value);
        }
        return result.toString();
    }
}
