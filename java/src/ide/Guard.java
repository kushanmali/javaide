package ide;

/**
 * Called at the start of every loop iteration in user code (inserted by {@link LoopGuard}).
 *
 * CheerpJ runs Java on the browser's main thread, so a loop that never prints or reads input
 * would freeze the page. About every 50 ms this hands control back to the browser, which keeps
 * the UI responsive and lets the Stop button end the program.
 */
public final class Guard {

    private static final int CHECK_MASK = 0x3FF;
    private static final long YIELD_INTERVAL_MS = 50;

    private static int counter;
    private static long nextYield;

    private Guard() {
    }

    public static void tick() {
        if ((++counter & CHECK_MASK) != 0) {
            return;
        }
        long now = System.currentTimeMillis();
        if (now < nextYield) {
            return;
        }
        if (Bridge.pause() != 0) {
            throw new Bridge.StopSignal();
        }
        nextYield = System.currentTimeMillis() + YIELD_INTERVAL_MS;
    }

    static void reset() {
        counter = 0;
        nextYield = System.currentTimeMillis() + YIELD_INTERVAL_MS;
    }
}
