package ide;

/** Minimal JSON writer, enough for the bridge's events (no external libraries on the classpath). */
final class Json {

    /** A value that is already valid JSON and must not be quoted. */
    static final class Raw {
        final String json;

        Raw(String json) {
            this.json = json;
        }
    }

    private Json() {
    }

    /** Builds an object from alternating key/value arguments. */
    static String object(Object... keysAndValues) {
        StringBuilder sb = new StringBuilder("{");
        for (int i = 0; i + 1 < keysAndValues.length; i += 2) {
            if (i > 0) {
                sb.append(',');
            }
            quote(sb, String.valueOf(keysAndValues[i]));
            sb.append(':');
            value(sb, keysAndValues[i + 1]);
        }
        return sb.append('}').toString();
    }

    private static void value(StringBuilder sb, Object value) {
        if (value == null) {
            sb.append("null");
        } else if (value instanceof Raw) {
            sb.append(((Raw) value).json);
        } else if (value instanceof Number || value instanceof Boolean) {
            sb.append(value);
        } else {
            quote(sb, value.toString());
        }
    }

    private static void quote(StringBuilder sb, String s) {
        sb.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if (c < 0x20) {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
            }
        }
        sb.append('"');
    }
}
