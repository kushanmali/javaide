// Client-side Java runtime: CheerpJ (WebAssembly JVM) plus the ide.Bridge helper running inside it.
// Nothing here talks to a server except for downloading the static runtime files.
//
// The bridge is started once and then receives commands through the nextCommand native, because
// every cheerpjRunMain call costs seconds of start-up time.

// Runtime files CheerpJ needs for compiling and running programs, recorded with cjGetRuntimeResources().
// Passing them to cheerpjInit lets CheerpJ download them in parallel at start-up instead of one by one.
import preload from './preload-resources.json';

// Control characters that cannot appear in normal source text or console input (must match Bridge.java)
const SEPARATOR = String.fromCharCode(1);
const STOP_TOKEN = String.fromCharCode(0) + '__STOP__';
const EOF_TOKEN = String.fromCharCode(0) + '__EOF__';
const TERMINAL_EVENTS = new Set(['compiled', 'exited', 'failed']);

const JAVA_VERSION = 8;
const appPath = (file) => `/app${import.meta.env.BASE_URL}${file}`;
const CLASSPATH = [appPath('runtime/ide-bridge.jar'), appPath('lib/tools.jar')].join(':');

/**
 * @param {object} handlers
 * @param {(stream: 'stdout'|'stderr', text: string) => void} handlers.onOutput
 * @param {() => Promise<string|null>} handlers.onInputRequest  resolves with a line, or null for end of input
 * @param {(type: string, payload: object) => void} handlers.onEvent  exception | error
 * @param {(reason: string) => void} [handlers.onRuntimeExit]  the JVM stopped (e.g. an untrapped System.exit)
 * @param {(done: number, total: number) => void} [handlers.onPreloadProgress]  runtime download progress
 * @param {{ preload?: boolean }} [options]  preload is only turned off to profile or benchmark start-up
 */
export function createJavaRuntime(handlers, { preload: usePreload = true } = {}) {
  let ready = null;
  let alive = false;
  let busy = false;
  let stopRequested = false;
  let cancelInput = null;
  let lastYield = 0;
  let buildCounter = 0;

  const queuedCommands = [];
  let commandWaiter = null;
  let pending = null;
  let signalReady = null;

  const natives = {
    async Java_ide_Bridge_nextCommand() {
      if (queuedCommands.length) return queuedCommands.shift();
      return new Promise((resolve) => (commandWaiter = resolve));
    },

    async Java_ide_Bridge_write(lib, stream, text) {
      if (stopRequested) return 1;
      handlers.onOutput(stream, text);
      // Yield to the browser about once a frame so output renders and the Stop button stays responsive
      if (performance.now() - lastYield > 16) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        lastYield = performance.now();
      }
      return stopRequested ? 1 : 0;
    },

    // Called from loops in user code (see Guard.java) so busy loops cannot freeze the page
    async Java_ide_Bridge_pause() {
      if (!stopRequested) await new Promise((resolve) => setTimeout(resolve, 0));
      return stopRequested ? 1 : 0;
    },

    async Java_ide_Bridge_emit(lib, type, json) {
      const payload = JSON.parse(json);
      if (type === 'ready') {
        signalReady?.(payload);
      } else if (TERMINAL_EVENTS.has(type)) {
        const request = pending;
        pending = null;
        if (type === 'failed') request?.reject(new Error(payload.message));
        else request?.resolve(payload);
      } else {
        handlers.onEvent(type, payload);
      }
    },

    async Java_ide_Bridge_readLine() {
      if (stopRequested) return STOP_TOKEN;
      return new Promise((resolve) => {
        cancelInput = () => resolve(STOP_TOKEN);
        handlers.onInputRequest().then((line) => {
          cancelInput = null;
          resolve(stopRequested ? STOP_TOKEN : line ?? EOF_TOKEN);
        });
      });
    },
  };

  function init() {
    if (!ready) {
      ready = (async () => {
        if (typeof window.cheerpjInit !== 'function') {
          throw new Error('CheerpJ loader failed to load. Check your internet connection.');
        }
        const options = { version: JAVA_VERSION, status: 'none', natives };
        if (usePreload && Object.keys(preload.resources).length) {
          options.preloadResources = preload.resources;
          options.preloadProgress = (done, total) => handlers.onPreloadProgress?.(done, total);
        }
        await window.cheerpjInit(options);
        const bridgeReady = new Promise((resolve) => (signalReady = resolve));
        const bridgeExit = window.cheerpjRunMain('ide.Bridge', CLASSPATH).then(onBridgeExit, onBridgeExit);
        await Promise.race([
          bridgeReady,
          bridgeExit.then(() => Promise.reject(new Error('The Java bridge failed to start.'))),
        ]);
        alive = true;
      })();
    }
    return ready;
  }

  function onBridgeExit(code) {
    alive = false;
    const reason = `The Java runtime stopped unexpectedly (${code instanceof Error ? code.message : `exit code ${code}`}).`;
    pending?.reject(new Error(reason));
    pending = null;
    handlers.onRuntimeExit?.(reason);
  }

  /** Sends a command to the bridge and resolves with its terminal event payload. */
  async function send(...parts) {
    await init();
    if (!alive) throw new Error('The Java runtime is not running. Reload the page to restart it.');
    if (pending) throw new Error('The Java runtime is busy.');
    return new Promise((resolve, reject) => {
      pending = { resolve, reject };
      const command = parts.join(SEPARATOR);
      if (commandWaiter) {
        const deliver = commandWaiter;
        commandWaiter = null;
        deliver(command);
      } else {
        queuedCommands.push(command);
      }
    });
  }

  /**
   * Compiles one source file. Resolves with { success, diagnostics, millis, classDir }.
   * loopGuard is only turned off for benchmarking its overhead; see Guard.java.
   */
  function compile(fileName, source, loopGuard = true) {
    const buildDir = `/files/build/${Date.now()}-${buildCounter++}`;
    return send('compile', buildDir, fileName, source, loopGuard ? 'guard' : 'noguard');
  }

  /** Runs a compiled program. Resolves with { status, code, millis } once it finishes. */
  function run(classDir, mainClass, args = []) {
    return send('run', classDir, mainClass, ...args);
  }

  return {
    init,

    /** Compiles, then runs if compilation succeeded. */
    async compileAndRun(fileName, source, mainClass, hooks = {}, { loopGuard = true } = {}) {
      if (busy) throw new Error('A program is already running.');
      busy = true;
      stopRequested = false;
      try {
        const compiled = await compile(fileName, source, loopGuard);
        hooks.onCompiled?.(compiled);
        if (!compiled.success || !mainClass || stopRequested) return { compiled, result: null };
        hooks.onRunStart?.();
        const result = await run(compiled.classDir, mainClass);
        return { compiled, result };
      } finally {
        busy = false;
        cancelInput = null;
      }
    },

    /** Compiles a tiny class so the first real compile does not pay the javac start-up cost. */
    async warmUp() {
      await compile('Warmup.java', 'class Warmup { }');
    },

    /**
     * Requests the running program to stop. Programs stop the next time they print, read input or
     * pass through a guarded loop; code blocked elsewhere (e.g. deep in a library) may need a reset.
     */
    stop() {
      if (!busy) return;
      stopRequested = true;
      cancelInput?.();
    },

    get busy() {
      return busy;
    },
  };
}
