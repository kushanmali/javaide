import './style.css';
import { createEditor } from './ui/editor.js';
import { ConsoleView } from './ui/console-view.js';
import { createJavaRuntime } from './runtime/java-runtime.js';
import { analyzeSource, findMethodLine } from './java/source-info.js';
import { examples } from './samples/index.js';
import { storage } from './storage.js';

const $ = (id) => document.getElementById(id);

const ui = {
  run: $('run-button'),
  stop: $('stop-button'),
  examples: $('example-select'),
  download: $('download-button'),
  theme: $('theme-button'),
  clear: $('clear-button'),
  fileName: $('file-name'),
  status: $('status'),
  statusText: $('status-text'),
  timing: $('timing'),
  cursor: $('cursor'),
  workspace: $('workspace'),
  splitter: $('splitter'),
  problemsBadge: $('problems-badge'),
  problemList: $('problem-list'),
  problemsEmpty: $('problems-empty'),
};

// ---------------------------------------------------------------- state

let runtimeReady = false;
let running = false;
let stopTimer = null;
let theme = storage.get('theme') ?? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
let sourceInfo = analyzeSource('');
// Benchmark and profiling switches: ?loopGuard=off disables loop instrumentation,
// ?preload=off disables runtime preloading (see scripts/profile-runtime-resources.mjs)
const params = new URLSearchParams(location.search);
const loopGuard = params.get('loopGuard') !== 'off';
const preload = params.get('preload') !== 'off';

document.documentElement.dataset.theme = theme;

// ---------------------------------------------------------------- editor

let saveTimer = null;
const editor = createEditor($('editor'), {
  value: storage.get('source') ?? examples[0].source,
  theme,
  onChange() {
    updateSourceInfo();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 400);
  },
  onRun: () => runProgram(),
  onSave: () => {
    save();
    setStatus(runtimeReady ? 'ready' : 'loading', 'Saved in this browser');
  },
  onCursor: (pos) => (ui.cursor.textContent = `Ln ${pos.lineNumber}, Col ${pos.column}`),
});

function save() {
  storage.set('source', editor.getValue());
}

// Automation hook for end-to-end tests: typing into Monaco would trigger auto-closing brackets
window.__javaIde = {
  getSource: () => editor.getValue(),
  startup: null, // { preload, runtimeMs, warmupMs, totalMs } once the IDE is ready
  setSource: (source) => editor.setValue(source),
};

function updateSourceInfo() {
  sourceInfo = analyzeSource(editor.getValue());
  ui.fileName.textContent = sourceInfo.fileName;
}
updateSourceInfo();

// ---------------------------------------------------------------- console

const consoleView = new ConsoleView($('console-output'), {
  sourceFile: () => sourceInfo.fileName,
  findMethodLine: (className, method) => findMethodLine(editor.getValue(), className, method),
  onFrameClick(line) {
    editor.revealLine(line);
    editor.flashLine(line);
  },
});

$('console-panel').addEventListener('click', (event) => {
  if (!window.getSelection()?.toString() && event.target === event.currentTarget) consoleView.focusInput();
});

const runtime = createJavaRuntime({
  onOutput: (stream, text) => consoleView.write(stream, text),
  onInputRequest: () => {
    showPanel('console-panel');
    setStatus('busy', 'Waiting for input…');
    return consoleView.requestInput().then((line) => {
      if (running) setStatus('busy', 'Running…');
      return line;
    });
  },
  onEvent(type, payload) {
    if (type === 'exception') consoleView.exception(payload);
    if (type === 'error') consoleView.system(payload.message, 'error');
  },
  onPreloadProgress(done, total) {
    if (!runtimeReady && total > 0) setStatus('loading', `Loading Java runtime… ${Math.floor((done / total) * 100)}%`);
  },
  onRuntimeExit(reason) {
    runtimeReady = false;
    consoleView.system(`${reason} Reload the page to restart it; your code is saved.`, 'error');
    setStatus('error', 'Runtime stopped');
    updateButtons();
  },
}, { preload });

// ---------------------------------------------------------------- run

async function runProgram() {
  if (!runtimeReady || running) return;
  save();
  updateSourceInfo();

  running = true;
  updateButtons();
  consoleView.clear();
  editor.clearDiagnostics();
  showProblems([]);
  showPanel('console-panel');
  setStatus('busy', 'Compiling…');
  ui.timing.textContent = '';

  const { fileName, mainClass } = sourceInfo;
  consoleView.system(`Compiling ${fileName}…`);

  try {
    const { compiled, result } = await runtime.compileAndRun(fileName, editor.getValue(), mainClass, {
      onCompiled(compiled) {
        editor.showDiagnostics(compiled.diagnostics);
        showProblems(compiled.diagnostics);
        const errors = compiled.diagnostics.filter((d) => d.severity === 'ERROR').length;
        if (!compiled.success) {
          consoleView.system(
            `Compilation failed with ${errors} error${errors === 1 ? '' : 's'} (${compiled.millis} ms). See Problems.`,
            'error',
          );
          showPanel('problems-panel');
        } else if (!mainClass) {
          consoleView.system('Compiled successfully, but no class has a public static void main(String[] args) method.', 'error');
        } else {
          consoleView.system(`Compiled in ${compiled.millis} ms. Running ${mainClass}…`);
        }
      },
      onRunStart: () => setStatus('busy', 'Running…'),
    }, { loopGuard });

    if (result) {
      const seconds = (result.millis / 1000).toFixed(2);
      if (result.status === 'stopped') consoleView.system(`Program stopped after ${seconds} s.`, 'error');
      else if (result.status === 'completed') {
        consoleView.system(`Program finished with exit code ${result.code} in ${seconds} s.`, result.code === 0 ? 'success' : 'error');
      } else consoleView.system(`Program terminated with exit code ${result.code} after ${seconds} s.`, 'error');
      ui.timing.textContent = `Compile ${compiled.millis} ms · Run ${seconds} s`;
    } else {
      ui.timing.textContent = `Compile ${compiled.millis} ms`;
    }
    setStatus('ready', compiled.success ? 'Ready' : 'Compilation failed');
  } catch (error) {
    consoleView.system(error.message, 'error');
    setStatus('error', 'Error');
  } finally {
    running = false;
    consoleView.cancelInput();
    clearTimeout(stopTimer);
    updateButtons();
  }
}

function stopProgram() {
  if (!running) return;
  runtime.stop();
  consoleView.cancelInput();
  setStatus('busy', 'Stopping…');
  clearTimeout(stopTimer);
  // A loop that never prints or reads input cannot be interrupted inside the JVM
  stopTimer = setTimeout(() => {
    if (!running) return;
    consoleView.system(
      'The program is not responding to Stop (it is not printing or reading input). ' +
        'Click Stop again to reset the Java runtime; your code is saved.',
      'error',
    );
    ui.stop.dataset.reset = 'true';
    ui.stop.querySelector('span').textContent = 'Reset';
    setStatus('error', 'Not responding');
  }, 2000);
}

// ---------------------------------------------------------------- problems

function showProblems(diagnostics) {
  ui.problemList.replaceChildren(
    ...diagnostics.map((d) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `problem ${d.severity === 'ERROR' ? 'is-error' : 'is-warning'}`;
      const icon = document.createElement('span');
      icon.className = 'problem-icon';
      icon.setAttribute('aria-label', d.severity === 'ERROR' ? 'Error' : 'Warning');
      const message = document.createElement('span');
      message.className = 'problem-message';
      message.textContent = d.message;
      const location = document.createElement('span');
      location.className = 'problem-location';
      location.textContent = `${d.file} [Ln ${d.line}, Col ${d.column}]`;
      button.append(icon, message, location);
      button.addEventListener('click', () => editor.revealLine(d.line, d.column));
      item.append(button);
      return item;
    }),
  );
  const errors = diagnostics.filter((d) => d.severity === 'ERROR').length;
  ui.problemsEmpty.hidden = diagnostics.length > 0;
  ui.problemsBadge.hidden = diagnostics.length === 0;
  ui.problemsBadge.textContent = String(diagnostics.length);
  ui.problemsBadge.classList.toggle('is-warning', errors === 0);
}

function showPanel(panelId) {
  for (const tab of document.querySelectorAll('.tab')) {
    const active = tab.dataset.panel === panelId;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
    $(tab.dataset.panel).hidden = !active;
  }
}

// ---------------------------------------------------------------- chrome

function setStatus(state, text) {
  ui.status.dataset.state = state;
  ui.statusText.textContent = text;
}

function updateButtons() {
  ui.run.disabled = !runtimeReady || running;
  ui.stop.disabled = !running;
  if (!running) {
    delete ui.stop.dataset.reset;
    ui.stop.querySelector('span').textContent = 'Stop';
  }
}

for (const example of examples) {
  ui.examples.append(new Option(example.title, example.id));
}
ui.examples.addEventListener('change', () => {
  const example = examples.find((e) => e.id === ui.examples.value);
  ui.examples.value = '';
  if (!example || running) return;
  editor.setValue(example.source);
  editor.clearDiagnostics();
  showProblems([]);
  save();
});

ui.run.addEventListener('click', runProgram);
ui.stop.addEventListener('click', () => {
  if (ui.stop.dataset.reset) {
    save();
    location.reload();
  } else stopProgram();
});
ui.clear.addEventListener('click', () => {
  if (!running) consoleView.clear();
});
for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => showPanel(tab.dataset.panel));
}

ui.download.addEventListener('click', () => {
  const blob = new Blob([editor.getValue()], { type: 'text/x-java-source' });
  const link = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: sourceInfo.fileName,
  });
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
});

ui.theme.addEventListener('click', () => {
  theme = theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  editor.setTheme(theme);
  storage.set('theme', theme);
});

// Resizable console panel
const savedHeight = storage.get('panelHeight');
if (savedHeight) ui.workspace.style.setProperty('--bottom-height', savedHeight);
ui.splitter.addEventListener('pointerdown', (event) => {
  ui.splitter.setPointerCapture(event.pointerId);
  ui.splitter.classList.add('is-dragging');
  const move = (e) => {
    const rect = ui.workspace.getBoundingClientRect();
    const height = Math.min(Math.max(rect.bottom - e.clientY, 120), rect.height - 120);
    ui.workspace.style.setProperty('--bottom-height', `${height}px`);
  };
  const up = () => {
    ui.splitter.classList.remove('is-dragging');
    ui.splitter.removeEventListener('pointermove', move);
    storage.set('panelHeight', ui.workspace.style.getPropertyValue('--bottom-height'));
  };
  ui.splitter.addEventListener('pointermove', move);
  ui.splitter.addEventListener('pointerup', up, { once: true });
});

// ---------------------------------------------------------------- start-up

async function start() {
  setStatus('loading', 'Loading Java runtime…');
  consoleView.system('Loading the Java runtime (CheerpJ WebAssembly JVM)…');
  const started = performance.now();
  try {
    await runtime.init();
    const runtimeLoaded = performance.now();
    setStatus('loading', 'Preparing compiler…');
    await runtime.warmUp();
    runtimeReady = true;
    const now = performance.now();
    window.__javaIde.startup = {
      preload,
      runtimeMs: Math.round(runtimeLoaded - started),
      warmupMs: Math.round(now - runtimeLoaded),
      totalMs: Math.round(now - started),
    };
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    consoleView.clear();
    consoleView.system(`Java runtime ready in ${seconds} s. Everything runs in your browser. Press Run or Ctrl+Enter.`, 'success');
    setStatus('ready', 'Ready');
  } catch (error) {
    consoleView.system(`Could not start the Java runtime: ${error.message}`, 'error');
    setStatus('error', 'Runtime failed to load');
  }
  updateButtons();
}

start();
