// Builds "Test Report and Performance Evaluation" (.docx) from the project's result files.
// Usage: npm run report [-- <output.docx>]   (default: reports/Test_Report_and_Performance_Evaluation.docx)
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, ShadingType,
  AlignmentType, LevelFormat, BorderStyle, Footer, PageNumber, PageBreak,
} = require('docx');

const projectDir = path.join(__dirname, '..');
const outFile = process.argv[2] ?? path.join(projectDir, 'reports', 'Test_Report_and_Performance_Evaluation.docx');
const read = (f) => JSON.parse(fs.readFileSync(path.join(projectDir, f), 'utf8'));
const bench = read('reports/benchmark-results.json');
const e2e = read('reports/e2e-results.json');
const unit = read('reports/unit-results.json');
const native = read('reports/native-baseline.json');
const meta = read('reports/report-meta.json');

// ------------------------------------------------------------------ helpers

const W = 9026;
const P = (text, opts = {}) =>
  new Paragraph({ spacing: { after: 120 }, ...opts, children: runs(text) });
const runs = (text) =>
  (Array.isArray(text) ? text : [text]).map((t) => (typeof t === 'string' ? new TextRun(t) : new TextRun(t)));
const H1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t)] });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(t)] });
const B = (text) => new Paragraph({ numbering: { reference: 'b', level: 0 }, spacing: { after: 60 }, children: runs(text) });
const gap = () => new Paragraph({ spacing: { after: 60 }, children: [] });
const border = { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' };
const borders = { top: border, bottom: border, left: border, right: border };
const STATUS_COLORS = { Pass: 'E6F4EA', Met: 'E6F4EA', Fixed: 'E6F4EA', 'Partly met': 'FFF4D6', Mitigated: 'FFF4D6', Open: 'FDE7E7', Fail: 'FDE7E7' };

function table(widths, rows, { firstColBold = true } = {}) {
  return new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: widths,
    rows: rows.map((r, i) =>
      new TableRow({
        tableHeader: i === 0,
        cantSplit: true,
        children: r.map((c, j) => {
          const text = String(c ?? '');
          const statusFill = i > 0 && STATUS_COLORS[text];
          return new TableCell({
            borders,
            width: { size: widths[j], type: WidthType.DXA },
            margins: { top: 50, bottom: 50, left: 90, right: 90 },
            shading: i === 0
              ? { type: ShadingType.CLEAR, fill: '1F3864', color: 'auto' }
              : statusFill
                ? { type: ShadingType.CLEAR, fill: statusFill, color: 'auto' }
                : j === 0 && firstColBold
                  ? { type: ShadingType.CLEAR, fill: 'F2F5FA', color: 'auto' }
                  : undefined,
            children: text.split('\n').map((line) =>
              new Paragraph({
                children: [new TextRun({ text: line, bold: i === 0 || (j === 0 && firstColBold), color: i === 0 ? 'FFFFFF' : undefined, size: 18 })],
              })),
          });
        }),
      })),
  });
}

const fmtMs = (ms) => (ms >= 10_000 ? `${(ms / 1000).toFixed(1)} s` : ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`);
const browsers = bench.browsers;
const byName = (n) => browsers.find((b) => b.browser === n);
const label = { edge: 'Microsoft Edge', chromium: 'Chromium' };

// ------------------------------------------------------------------ test results

function collectSpecs(suite, out = []) {
  for (const spec of suite.specs ?? []) out.push(spec);
  for (const child of suite.suites ?? []) collectSpecs(child, out);
  return out;
}
// The JSON report lists a spec once per browser project; merge them by title, keeping file order
const specs = [];
for (const spec of collectSpecs({ suites: e2e.suites })) {
  const existing = specs.find((s) => s.title === spec.title);
  if (existing) existing.tests.push(...spec.tests);
  else specs.push({ title: spec.title, tests: [...spec.tests] });
}
const e2eRows = specs.map((spec, index) => {
  const result = (project) => {
    const t = spec.tests.find((x) => x.projectName === project);
    const r = t?.results?.at(-1);
    if (!r) return 'Not run';
    return `${r.status === 'passed' ? 'Pass' : 'Fail'}`;
  };
  const duration = (project) => {
    const r = spec.tests.find((x) => x.projectName === project)?.results?.at(-1);
    return r ? fmtMs(r.duration) : '';
  };
  return { id: `E${String(index + 1).padStart(2, '0')}`, title: spec.title, edge: result('edge'), chromium: result('chromium'), edgeTime: duration('edge'), chromiumTime: duration('chromium') };
});
const e2eStats = e2e.stats;
const e2ePassed = e2eRows.filter((r) => r.edge === 'Pass' && r.chromium === 'Pass').length;
const idOf = (fragment) => e2eRows.find((r) => r.title.includes(fragment))?.id ?? '?';

const unitTests = unit.testResults.flatMap((file) => file.assertionResults);
const unitPassed = unitTests.filter((t) => t.status === 'passed').length;

const WHAT = {
  'loads the Java runtime': 'CheerpJ starts, the compiler warms up, Run becomes available and the editor shows Main.java.',
  'Hello World': 'A minimal program compiles and runs; output appears; exit code 0; no problems reported.',
  'never sends source code': 'Unique markers in the source and in typed input never appear in any request URL, body or WebSocket frame, and no non-GET request is made during compile and run. Validated by fault injection (a simulated POST leak makes the test fail).',
  'several classes': 'An interface and two implementing classes in one file; formatted output via printf.',
  'Scanner': 'Prompts appear before the input field, the field is focused, two typed lines are read (nextLine, nextInt).',
  'compilation errors': 'Three semantic errors are reported with correct messages, line and column; three squiggles in Monaco; clicking a problem moves the cursor.',
  'runtime exceptions': 'ArrayIndexOutOfBoundsException shows type, plain-English hint and frames; clicking a frame moves the cursor to the method.',
  'keeps printing': 'Stop ends a program that prints in a loop.',
  'busy loop': 'Stop ends while(true){n++;}; a 50 ms page timer still fires within 1 s while the loop runs (the page is not frozen).',
  'waiting for input': 'Stop ends a program blocked on Scanner input and removes the input field.',
  'System.exit': 'System.exit(3) reports exit code 3; the runtime keeps working for the next run.',
  'edited version': 'After editing, the new class is run, not a cached copy of the previous one.',
  'packages': 'A package declaration and a non-public main class compile and run; file name derived from the main class.',
  'large amounts of output': '5,000 lines are shown within 30 s, in order, fully flushed before the next input prompt (regression test for DEF-06).',
  'stderr': 'System.err output is rendered separately from System.out.',
  'downloads': 'Download produces a file named after the class (Main.java).',
  'after a reload': 'Code is autosaved and restored after a page reload.',
};
const whatFor = (title) => Object.entries(WHAT).find(([k]) => title.includes(k))?.[1] ?? '';

// ------------------------------------------------------------------ document

const edge = byName('edge');
const chromium = byName('chromium');
const nativeMedian = native.elapsedMs.median;
const cheerpjCpu = (b) => b.cpu20MLoopMs.loopGuard_on.median;
const coldMin = Math.min(edge.coldStartMs.min, chromium.coldStartMs.min);
const coldMax = Math.max(edge.coldStartMs.max, chromium.coldStartMs.max);
const cachedMin = Math.min(edge.cachedStartMs.min, chromium.cachedStartMs.min);
const cachedMax = Math.max(edge.cachedStartMs.max, chromium.cachedStartMs.max);

const children = [
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 600, after: 120 }, children: [new TextRun({ text: 'CO7047 Research Project', size: 26, color: '595959' })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [new TextRun({ text: 'Test Report and Performance Evaluation', bold: true, size: 44, color: '1F3864' })] }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 360 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: '1F3864', space: 8 } },
    children: [new TextRun({ text: 'Online Java IDE with Client-Side Compilation and Execution Using WebAssembly (WASM)', italics: true, size: 26 })],
  }),
  table([2600, 6426], [
    ['Field', 'Detail'],
    ['Artefact version', `Git commit ${meta.commit} (branch master)`],
    ['Test run date', meta.testDate],
    ['Benchmark run date', new Date(bench.generatedAt).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'],
    ['Related documents', 'Project Scope Confirmation v1.1 (objectives O1–O7, acceptance criteria in section 9)'],
    ['Status', 'Draft for supervisor review'],
  ]),

  H1('1. Summary'),
  P(`The IDE was tested with ${unitTests.length} unit tests and ${specs.length} automated end-to-end tests. Each end-to-end test compiles and runs real Java programs in a browser, and all of them ran in both Microsoft Edge and Chromium. ${unitPassed} of ${unitTests.length} unit tests and ${e2ePassed} of ${specs.length} end-to-end tests passed in both browsers (${e2eStats.expected} passing runs, ${e2eStats.unexpected} failing).`),
  P(`Five of the seven acceptance criteria from the scope document are fully met and two are partly met (section 4). Testing and benchmarking found ten defects or limitations: six are fixed, one is mitigated and three remain open as platform or licensing limitations (section 6).`),
  P(`Performance: once the runtime is loaded, a typical program compiles and runs in about ${fmtMs(edge.samples.hello.endToEndMs.median)} (median, Hello World, Edge), and Stop ends even a busy loop in about ${fmtMs(edge.stopLatencyMs.median)}. The weakest point is start-up: becoming ready took a median of ${fmtMs(edge.coldStartMs.median)} on a first visit and ${fmtMs(edge.cachedStartMs.median)} on a repeat visit in Edge, dominated by requests to the CheerpJ CDN (section 8). CPU-heavy code ran about ${Math.round(cheerpjCpu(edge) / nativeMedian)}× slower than on a native JVM.`),

  H1('Part A: Test Report'),
  H1('2. Test Environment'),
  table([2600, 6426], [
    ['Item', 'Detail'],
    ['Machine', `${bench.machine.cpu}, ${bench.machine.logicalCores} logical cores, ${bench.machine.memoryGB} GB RAM`],
    ['Operating system', `Windows 10 Pro (${bench.machine.os})`],
    ['Browsers', `Microsoft Edge ${edge.version} (installed browser)\nChromium ${chromium.version} (Playwright build; the open-source engine behind Google Chrome)`],
    ['Test tools', `Playwright ${meta.playwright} (end-to-end), Vitest ${meta.vitest} (unit), Node.js ${bench.machine.node}`],
    ['Java runtime under test', 'CheerpJ 4.3 (Java 8) loaded from cjrtnc.leaningtech.com; javac from JDK 8 tools.jar'],
    ['Server', 'Vite dev server for end-to-end tests; vite preview of the production build for benchmarks (both on localhost)'],
    ['Network', `Home internet connection; median round trip to the CheerpJ CDN ${fmtMs(edge.cdnRoundTripMs.median)} during benchmarking`],
  ]),

  H1('3. Test Strategy'),
  B([{ text: 'Unit tests (Vitest): ', bold: true }, 'the Java source analysis used to choose the file name and main class, and to link stack frames to method declarations.']),
  B([{ text: 'End-to-end tests (Playwright): ', bold: true }, 'drive the real IDE in a browser, compile and run Java programs through CheerpJ, and check the console, Problems panel, editor markers and controls. All tests share one page so the runtime loads once per browser.']),
  B([{ text: 'Representative programs: ', bold: true }, 'the six example programs in the IDE (Hello World, console input, classes and interfaces, compilation errors, runtime exception, long-running loop) plus programs written inside the tests for specific cases.']),
  B([{ text: 'Fault injection: ', bold: true }, 'the network privacy test was checked by adding a simulated leak (a POST request containing the marker), which made it fail as expected. The leak was then removed.']),
  B([{ text: 'Benchmarking: ', bold: true }, 'scripts/benchmark.mjs measures start-up, compile and run times, output throughput, Stop latency and CPU throughput (Part B). It found two of the defects in section 6.']),
  B([{ text: 'Exploratory testing: ', bold: true }, 'manual checks in the browser during development (layout, themes, console rendering), which found several early defects.']),

  H1('4. Acceptance Criteria Traceability'),
  P('Each acceptance criterion from section 9 of the scope document, with the tests that cover it:'),
  table([3100, 1500, 1200, 3226], [
    ['Acceptance criterion', 'Tests', 'Status', 'Notes'],
    ['A valid Java program with a main method compiles and runs entirely in the browser, with output in the console', `${idOf('Hello World')}, ${idOf('several classes')}, ${idOf('packages')}`, 'Met', 'Passed in both browsers.'],
    ['No network request carries user source code to a server during compile or run', idOf('never sends'), 'Met', 'Also checks typed program input and WebSocket frames. Validated by fault injection.'],
    ['A program reading input with Scanner receives values typed into the console', `${idOf('Scanner')}, ${idOf('large amounts')}`, 'Met', ''],
    ['Syntax/type errors show each error with correct line number and message, highlighted in the editor', idOf('compilation errors'), 'Met', 'javac stops at the first syntax error, so a file with a syntax error reports only that error; semantic errors are all reported.'],
    ['An uncaught exception displays the exception type, message and stack trace', idOf('runtime exceptions'), 'Partly met', 'Type and stack are shown. CheerpJ omits some exception messages (e.g. the index for ArrayIndexOutOfBoundsException) and most line numbers; frames link to the method declaration line instead (DEF-04).'],
    ['A running program can be stopped by the user without reloading the page', `${idOf('keeps printing')}, ${idOf('busy loop')}, ${idOf('waiting for input')}`, 'Met', 'Includes busy loops that never print (DEF-03).'],
    ['All representative test programs pass on the target browsers', 'All', 'Partly met', 'All pass in Edge and Chromium. Firefox was not tested (decision to skip installing it); Google Chrome is represented by Chromium.'],
  ]),

  H1('5. Test Cases and Results'),
  H2('5.1 End-to-end tests'),
  table([700, 2400, 3526, 1200, 1200], [
    ['ID', 'Test', 'What it checks', 'Edge', 'Chromium'],
    ...e2eRows.map((r) => [r.id, r.title, whatFor(r.title), `${r.edge}\n${r.edgeTime}`, `${r.chromium}\n${r.chromiumTime}`]),
  ]),
  P(`Total: ${e2eStats.expected} passed, ${e2eStats.unexpected} failed, ${e2eStats.flaky} flaky, ${e2eStats.skipped} skipped; wall time ${fmtMs(e2eStats.duration)} including runtime start-up in each browser.`, { spacing: { before: 120, after: 120 } }),
  H2('5.2 Unit tests'),
  table([700, 6326, 2000], [
    ['ID', 'Test', 'Result'],
    ...unitTests.map((t, i) => [`U${String(i + 1).padStart(2, '0')}`, `${t.ancestorTitles.join(' › ')} › ${t.title}`, t.status === 'passed' ? 'Pass' : 'Fail']),
  ]),

  H1('6. Defects Found'),
  P('Defects and limitations found during development, testing and benchmarking. Commit IDs refer to the project repository.'),
  table([900, 3226, 1300, 2400, 1200], [
    ['ID', 'Defect', 'Found by', 'Resolution', 'Status'],
    ['DEF-01', 'Each compile and each run started a new Java main through CheerpJ, costing about 2.5 s of start-up per call: a compile and run took about 12 s.', 'Profiling', 'One long-lived bridge process receives commands (1007d72). Now about 0.2–0.5 s.', 'Fixed'],
    ['DEF-02', 'Compilation failed at start-up: the CheerpJ /str/ file system does not support subdirectories.', 'Exploratory', 'The bridge writes sources into /files/ (1007d72).', 'Fixed'],
    ['DEF-03', 'A loop that never prints (e.g. while(true){n++;}) froze the whole browser tab; Stop could not respond.', 'Exploratory', 'LoopGuard inserts a yield-and-stop check into every loop at compile time (1007d72).', 'Fixed'],
    ['DEF-04', 'Stack frames from CheerpJ usually lack file names and line numbers, and some exception messages are missing.', 'Exploratory', 'Frames link to the declaration line of the method. Root cause is in CheerpJ.', 'Mitigated'],
    ['DEF-05', 'Pressing Stop while a program waited for input left the input field on screen.', `Automated test ${idOf('waiting for input')}`, 'Stop now removes the pending input field (8e7cb0e).', 'Fixed'],
    ['DEF-06', 'Console output time grew quadratically: 3,000 lines took about 60 s, 10,000 lines about 17 s even after a first fix.', 'Benchmark', 'Output batched per frame (b42aac7) and laid out in block chunks (16018f5). Regression test added.', 'Fixed'],
    ['DEF-07', 'Editor font ligatures displayed operators such as <= as a single ≤ symbol, which could mislead learners.', 'Exploratory', 'Ligatures disabled (1007d72).', 'Fixed'],
    ['DEF-08', `Start-up is slow and network-dependent (improved, see section 9.5): ${fmtMs(coldMin)}–${fmtMs(coldMax)} on a first visit and ${fmtMs(cachedMin)}–${fmtMs(cachedMax)} on repeat visits in the final benchmark (an earlier run reached 89 s). The Java class library is fetched from the CheerpJ CDN in many range requests, which appear not to be cached by the browser.`, 'Benchmark', `Compiler jar stripped to javac (18.3 MB to 2.0 MB) and runtime files preloaded; first-visit download ${meta.firstVisitBeforeMB} MB to ${edge.coldStartTransfer.totalMB} MB and cold start ${fmtMs(meta.coldStartBeforeMs)} to ${fmtMs(edge.coldStartMs.median)} (Edge medians). The remaining cost is the CheerpJ CDN.`, 'Open'],
    ['DEF-10', 'The CheerpJ runtime must be loaded from the vendor CDN: self-hosting it needs a Commercial Licence (Community tier does not allow it), which sets a floor on start-up time.', 'Licence review', 'Accepted: the project stays on the free Community tier (see section 11).', 'Open'],
    ['DEF-09', 'Only Java 8 language features are available (no var, records, switch expressions, text blocks).', 'Design review', 'Documented limitation of the chosen CheerpJ/tools.jar configuration.', 'Open'],
  ]),

  H1('7. Not Tested'),
  B('Mozilla Firefox and Safari (Firefox was skipped by decision; no macOS device).'),
  B('The branded Google Chrome build (Chromium, its open-source engine, was tested instead).'),
  B('Mobile and tablet browsers.'),
  B('Accessibility with assistive technology (screen readers, keyboard-only use) beyond basic labels.'),
  B('Usability with students: no human participants were involved, as agreed in the scope.'),
  B('The deployed (hosted) version: hosting was deferred.'),
  B('Programs using Swing/AWT/JavaFX, multiple files, or external libraries (out of scope).'),

  new Paragraph({ children: [new PageBreak()] }),
  H1('Part B: Performance Evaluation'),
  H1('8. Method'),
  P(`scripts/benchmark.mjs served the production build with vite preview on localhost and drove each browser with Playwright. Each measurement was repeated and summarised as median and 90th percentile (p90). With few samples, p90 is effectively the slowest run.`),
  B(`Cold start: ${bench.settings.coldStarts} fresh browser profiles (empty cache and storage), from navigation until Run is enabled.`),
  B(`Cached start: ${bench.settings.cachedStarts} reloads of an already-used profile.`),
  B(`Compile and run: each sample run ${bench.settings.runsPerSample} times after one discarded warm-up run. Compile time is reported by javac inside the bridge; end-to-end time is from clicking Run until the program has finished.`),
  B('Output throughput: a program printing 10,000 lines, timed inside Java, 3 runs.'),
  B(`Stop latency: ${bench.settings.stopRuns} runs of a busy loop; time from clicking Stop until the IDE is idle. While the loop ran, the extra delay of a 50 ms page timer was sampled for one second.`),
  B(`CPU throughput: a 20-million-iteration arithmetic loop, ${bench.settings.cpuRuns} runs each with the loop guard on and off (?loopGuard=off). Baseline: the same program on the native JVM (${native.javaVersion}, a newer Java version than CheerpJ’s Java 8), ${native.elapsedMs.n} runs.`),
  P('The network was a normal home connection, so start-up figures depend heavily on the connection and should be read as indicative only.'),

  H1('9. Results'),
  H2('9.1 Start-up'),
  table([3200, 2913, 2913], [
    ['Measure', label.edge, label.chromium],
    ['Cold start, median (p90)', `${fmtMs(edge.coldStartMs.median)} (${fmtMs(edge.coldStartMs.p90)})`, `${fmtMs(chromium.coldStartMs.median)} (${fmtMs(chromium.coldStartMs.p90)})`],
    ['Cold start, fastest', fmtMs(edge.coldStartMs.min), fmtMs(chromium.coldStartMs.min)],
    ['   of which loading the JVM, median', fmtMs(edge.coldStartBreakdownMs.loadRuntime.median), fmtMs(chromium.coldStartBreakdownMs.loadRuntime.median)],
    ['   of which warming up javac, median', fmtMs(edge.coldStartBreakdownMs.warmUpCompiler.median), fmtMs(chromium.coldStartBreakdownMs.warmUpCompiler.median)],
    ['Cold start without preloading, median (p90)', `${fmtMs(edge.coldStartNoPreloadMs.median)} (${fmtMs(edge.coldStartNoPreloadMs.p90)})`, `${fmtMs(chromium.coldStartNoPreloadMs.median)} (${fmtMs(chromium.coldStartNoPreloadMs.p90)})`],
    ['Cached start, median (p90)', `${fmtMs(edge.cachedStartMs.median)} (${fmtMs(edge.cachedStartMs.p90)})`, `${fmtMs(chromium.cachedStartMs.median)} (${fmtMs(chromium.cachedStartMs.p90)})`],
    ['Downloaded on first visit', `${edge.coldStartTransfer.totalMB} MB in ${edge.coldStartTransfer.requests} requests`, `${chromium.coldStartTransfer.totalMB} MB in ${chromium.coldStartTransfer.requests} requests`],
    ['   from the IDE’s own hosting', `${edge.coldStartTransfer.byOriginMB['app (static hosting)']} MB (incl. 2.0 MB tools.jar)`, `${chromium.coldStartTransfer.byOriginMB['app (static hosting)']} MB`],
    ['   from the CheerpJ CDN', `${edge.coldStartTransfer.byOriginMB['https://cjrtnc.leaningtech.com']} MB`, `${chromium.coldStartTransfer.byOriginMB['https://cjrtnc.leaningtech.com']} MB`],
    ['CDN round trip, median', fmtMs(edge.cdnRoundTripMs.median), fmtMs(chromium.cdnRoundTripMs.median)],
  ]),
  gap(),
  H2('9.2 Compile and run (runtime already loaded)'),
  table([2300, 2242, 2242, 2242], [
    ['Program', 'Measure', `${label.edge}: median (p90)`, `${label.chromium}: median (p90)`],
    ...[['hello', 'Hello World'], ['classes', 'Classes and interfaces'], ['runtime-error', 'Runtime exception'], ['compile-error', 'Compilation errors (3)']].flatMap(([id, name]) => {
      const e = edge.samples[id];
      const c = chromium.samples[id];
      const row = (measure, key) => [name, measure, `${fmtMs(e[key].median)} (${fmtMs(e[key].p90)})`, `${fmtMs(c[key].median)} (${fmtMs(c[key].p90)})`];
      return [row('Compile', 'compileMs'), ...(e.runMs ? [row('Run', 'runMs')] : []), row('End to end', 'endToEndMs')];
    }),
  ], { firstColBold: false }),
  P('Run times below about 10 ms are at the resolution of the timer used inside the runtime and are shown as 0 ms when the program finishes within the same tick.', { spacing: { before: 120, after: 120 } }),
  H2('9.3 Responsiveness and throughput'),
  table([3800, 2613, 2613], [
    ['Measure', label.edge, label.chromium],
    ['Stop latency on a busy loop, median (max)', `${fmtMs(edge.stopLatencyMs.median)} (${fmtMs(edge.stopLatencyMs.max)})`, `${fmtMs(chromium.stopLatencyMs.median)} (${fmtMs(chromium.stopLatencyMs.max)})`],
    ['Extra delay of a 50 ms page timer during a busy loop, median (max)', `${fmtMs(edge.busyLoopTimerDelayMs.median)} (${fmtMs(edge.busyLoopTimerDelayMs.max)})`, `${fmtMs(chromium.busyLoopTimerDelayMs.median)} (${fmtMs(chromium.busyLoopTimerDelayMs.max)})`],
    ['Printing 10,000 lines, median', fmtMs(edge.output10kLinesMs.median), fmtMs(chromium.output10kLinesMs.median)],
  ]),
  P('During a busy loop the page keeps responding, but its timers can be delayed by up to one loop-guard interval (about 50 ms), because the guard hands control back to the browser at most every 50 ms. Typing and clicking stay usable at that delay.', { spacing: { before: 120, after: 120 } }),
  gap(),
  H2('9.4 CPU throughput and loop guard overhead'),
  table([3800, 1742, 1742, 1742], [
    ['20-million-iteration loop (median)', label.edge, label.chromium, 'Native JVM'],
    ['Loop guard off', fmtMs(edge.cpu20MLoopMs.loopGuard_off.median), fmtMs(chromium.cpu20MLoopMs.loopGuard_off.median), fmtMs(nativeMedian)],
    ['Loop guard on (default)', fmtMs(edge.cpu20MLoopMs.loopGuard_on.median), fmtMs(chromium.cpu20MLoopMs.loopGuard_on.median), '—'],
    ['Loop guard overhead', `${edge.cpu20MLoopMs.guardOverheadPercent}%`, `${chromium.cpu20MLoopMs.guardOverheadPercent}%`, '—'],
    ['Slowdown vs native JVM (guard on)', `${(cheerpjCpu(edge) / nativeMedian).toFixed(0)}×`, `${(cheerpjCpu(chromium) / nativeMedian).toFixed(0)}×`, '1×'],
  ]),
  gap(),
  H2('9.5 Effect of the optimisations made during development'),
  P('Rows sourced to the benchmark are medians of repeated runs; the others are single measurements taken while the defect was investigated and are approximate. The Source column says which is which.'),
  table([3000, 2013, 2013, 2000], [
    ['Change', 'Before', 'After', 'Source'],
    ['Long-lived bridge (DEF-01): Hello World compile and run', 'about 12 s', 'about 0.6 s', 'Manual timing, dev server'],
    ['Output batching (DEF-06, first fix): 3,000 lines', '59.8 s', '1.8 s', 'Diagnostic script, headless Chromium'],
    ['Block-chunked output (DEF-06, second fix): 10,000 lines', `${fmtMs(meta.output10kBeforeChunkingMs)} (benchmark median)`, `${fmtMs(chromium.output10kLinesMs.median)} (benchmark median)`, 'Benchmark, Chromium'],
    [`Compiler-only tools.jar (DEF-08): first-visit download`, `${meta.firstVisitBeforeMB} MB`, `${edge.coldStartTransfer.totalMB} MB`, 'Benchmark'],
    ['Compiler-only tools.jar + preloading (DEF-08): cold start', fmtMs(meta.coldStartBeforeMs), `${fmtMs(edge.coldStartMs.median)} (median, Edge)`, 'Benchmark, Edge'],
    ['Runtime preloading alone (DEF-08): cold start', `${fmtMs(edge.coldStartNoPreloadMs.median)} without`, `${fmtMs(edge.coldStartMs.median)} with`, 'Benchmark, Edge'],
    ['Loop guard (DEF-03): busy loop', 'Tab frozen; Stop impossible', `Stop in ${fmtMs(edge.stopLatencyMs.median)}`, 'Manual observation; benchmark'],
  ]),

  H1('10. Discussion'),
  P([{ text: 'Interactive use is fast enough. ', bold: true }, `Once loaded, compiling and running typical teaching programs takes a few hundred milliseconds (Hello World ${fmtMs(edge.samples.hello.endToEndMs.median)}, the multi-class example ${fmtMs(edge.samples.classes.endToEndMs.median)} in Edge). Almost all of that is javac; running the compiled program is negligible. Results were very similar in Edge and Chromium, which share the same engine.`]),
  P([{ text: 'Start-up remains the main weakness, but is much improved. ', bold: true }, `Stripping the compiler jar and preloading the runtime cut the first-visit download from ${meta.firstVisitBeforeMB} MB to ${edge.coldStartTransfer.totalMB} MB and the median cold start in Edge from ${fmtMs(meta.coldStartBeforeMs)} to ${fmtMs(edge.coldStartMs.median)}. Of what remains, a median of ${fmtMs(edge.coldStartBreakdownMs.loadRuntime.median)} is spent loading the JVM and ${fmtMs(edge.coldStartBreakdownMs.warmUpCompiler.median)} warming up javac. Repeat visits were only partly faster (median ${fmtMs(edge.cachedStartMs.median)} in Edge, ${fmtMs(chromium.cachedStartMs.median)} in Chromium), because CheerpJ reads its Java class library through many HTTP range requests, which appear not to be served from the browser cache, each costing at least one ${fmtMs(edge.cdnRoundTripMs.median)} round trip. Start-up time is therefore dominated by latency to the CDN rather than by the IDE's own code, although downloading tools.jar and warming up javac also contribute. Start-up also varied widely between runs (${fmtMs(edge.coldStartMs.min)} to ${fmtMs(edge.coldStartMs.max)} cold in Edge), so the ${fmtMs(Math.abs(edge.coldStartNoPreloadMs.median - edge.coldStartMs.median))} difference between preloading on and off is within that noise; preloading was not slower overall and costs nothing at run time.`]),
  P([{ text: 'Caching the runtime in the browser is not possible with a Service Worker. ', bold: true }, 'A Service Worker was implemented and measured: it caches the IDE’s own files, but CheerpJ requests the class library from inside its own Web Worker, and those requests never reach the page’s Service Worker (0 of about 120 range requests were seen). Repeat visits therefore depend on the browser’s HTTP cache, which reuses only part of the range responses. The Service Worker was removed again.']),
  P([{ text: 'The loop guard trades some CPU speed for safety. ', bold: true }, `Guarding every loop cost ${edge.cpu20MLoopMs.guardOverheadPercent}% (Edge) and ${chromium.cpu20MLoopMs.guardOverheadPercent}% (Chromium) on a worst-case tight arithmetic loop, and keeps the page responsive. Without it, a common beginner mistake would freeze the browser tab. For teaching programs, which rarely run long CPU-bound loops, this is a good trade-off.`]),
  P([{ text: 'Raw computation is much slower than a desktop JVM. ', bold: true }, `The CPU benchmark ran about ${Math.round(cheerpjCpu(edge) / nativeMedian)}× slower than the native JVM on the same machine. This matters little for introductory exercises but rules out heavy computation.`]),
  P([{ text: 'Console output is now adequate. ', bold: true }, `After fixing DEF-06, 10,000 lines print in about ${fmtMs(edge.output10kLinesMs.median)}, and time grows linearly with output size. The remaining cost is mostly the per-line call from the Java runtime into JavaScript.`]),
  P([{ text: 'Threats to validity. ', bold: true }, 'One machine and one network connection were used; start-up figures would differ on other connections. Sample sizes are small (3–10 runs). Both browsers use the Chromium engine, so results may not transfer to Firefox or Safari. The test machine has an older dual-core processor (4 threads), so absolute timings may be better on newer hardware.']),

  H1('11. Recommendations'),
  B([{ text: 'Start-up: accept the CDN for now. ', bold: true }, 'Self-hosting the CheerpJ runtime is the only remaining way to avoid the CDN round trips, since the class library cannot be cached by a Service Worker, but it needs a Commercial Licence (from GBP 100 per developer per month, cheerpj.com/licensing). The project stays on the free Community tier, so the remaining start-up cost is accepted and documented. If the tool is later adopted for teaching, ask Leaning Technologies about their free or discounted educational licences (cheerpj.com/contact) and re-measure with a self-hosted runtime.']),
  B([{ text: 'Re-record the preload list after upgrades: ', bold: true }, 'npm run profile:preload regenerates src/runtime/preload-resources.json; a stale list after a CheerpJ or Java version change silently loses the benefit.']),
  B([{ text: 'Tune the loop guard: ', bold: true }, 'check less often (e.g. every 16,384 iterations instead of 1,024) and re-measure the overhead against Stop latency.']),
  B([{ text: 'Widen browser coverage: ', bold: true }, 'run the end-to-end suite in Firefox and, if available, Safari before release.']),
  B([{ text: 'Re-run the benchmark after hosting: ', bold: true }, 'real-world start-up should be measured from the deployed site and from a typical university network.']),

  H1('Appendix: Reproducing the Results'),
  table([3000, 6026], [
    ['Command', 'Result file'],
    ['npm test -- --reporter=json --outputFile=reports/unit-results.json', 'reports/unit-results.json'],
    ['npx playwright test --reporter=json > reports/e2e-results.json', 'reports/e2e-results.json'],
    ['npm run benchmark', 'reports/benchmark-results.json'],
    ['java scripts/CpuLoop.java (1 warm-up + 5 runs)', 'reports/native-baseline.json'],
    ['npm run report -- <output.docx>', 'This document, regenerated from the files above'],
  ], { firstColBold: false }),
];

const doc = new Document({
  styles: {
    default: { document: { run: { font: 'Calibri', size: 21 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 30, bold: true, color: '1F3864' }, paragraph: { spacing: { before: 320, after: 140 }, outlineLevel: 0, keepNext: true } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 24, bold: true, color: '2E75B6' }, paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 1, keepNext: true } },
    ],
  },
  numbering: { config: [{ reference: 'b', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } } } }] }] },
  sections: [{
    properties: { page: { margin: { top: 1300, bottom: 1300, left: 1440, right: 1440 } } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Test Report and Performance Evaluation – Online Java IDE   |   Page ', size: 18, color: '808080' }), new TextRun({ children: [PageNumber.CURRENT], size: 18, color: '808080' })] })] }) },
    children,
  }],
});
Packer.toBuffer(doc).then((b) => fs.writeFileSync(outFile, b));
