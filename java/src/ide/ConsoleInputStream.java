package ide;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/** System.in backed by the browser console: each read that needs data asks the user for a line. */
final class ConsoleInputStream extends InputStream {

    private byte[] line;
    private int position;
    private boolean endOfInput;

    @Override
    public synchronized int read() {
        if (!fill()) {
            return -1;
        }
        return line[position++] & 0xff;
    }

    @Override
    public synchronized int read(byte[] target, int offset, int length) {
        if (length == 0) {
            return 0;
        }
        if (!fill()) {
            return -1;
        }
        // Return only what is already buffered; blocking for more would ask for another line
        int count = Math.min(length, line.length - position);
        System.arraycopy(line, position, target, offset, count);
        position += count;
        return count;
    }

    @Override
    public synchronized int available() {
        return line == null ? 0 : line.length - position;
    }

    private boolean fill() {
        if (line != null && position < line.length) {
            return true;
        }
        if (endOfInput) {
            return false;
        }
        // Make sure prompts such as System.out.print("Name: ") are visible before waiting
        System.out.flush();
        System.err.flush();

        String text = Bridge.readLine();
        if (Bridge.STOP_TOKEN.equals(text)) {
            throw new Bridge.StopSignal();
        }
        if (text == null || Bridge.EOF_TOKEN.equals(text)) {
            endOfInput = true;
            return false;
        }
        line = (text + "\n").getBytes(StandardCharsets.UTF_8);
        position = 0;
        return true;
    }
}
