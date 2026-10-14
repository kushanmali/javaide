package ide;

import java.io.ByteArrayOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/** Buffers bytes written by the program and forwards them to the browser console. */
final class ConsoleOutputStream extends OutputStream {

    private static final int FLUSH_THRESHOLD = 8192;

    private final String stream;
    private final ByteArrayOutputStream buffer = new ByteArrayOutputStream();

    ConsoleOutputStream(String stream) {
        this.stream = stream;
    }

    @Override
    public synchronized void write(int b) {
        buffer.write(b);
        if (b == '\n' || buffer.size() >= FLUSH_THRESHOLD) {
            flush();
        }
    }

    @Override
    public synchronized void write(byte[] bytes, int offset, int length) {
        buffer.write(bytes, offset, length);
        if (buffer.size() >= FLUSH_THRESHOLD) {
            flush();
        }
    }

    @Override
    public synchronized void flush() {
        if (buffer.size() == 0) {
            return;
        }
        String text = new String(buffer.toByteArray(), StandardCharsets.UTF_8);
        buffer.reset();
        if (Bridge.write(stream, text) != 0) {
            throw new Bridge.StopSignal();
        }
    }
}
