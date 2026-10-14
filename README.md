# Online Java IDE (client-side compilation and execution)

A browser-based Java IDE where **all compilation and execution happen in the browser** through
WebAssembly. No code is ever sent to a server. Built for the CO7047 Research Project
*"Online Java IDE, with client-side compilation and execution"*.

- **Editor:** [Monaco Editor](https://microsoft.github.io/monaco-editor/), the editor behind VS Code
- **Java runtime:** [CheerpJ 4.3](https://cheerpj.com), a JVM compiled to WebAssembly (Java 8)
- **Compiler:** `javac` from the JDK 8 `tools.jar` (stripped to the compiler, 2 MB), running inside CheerpJ

## Features

| Objective | Feature | Status |
|---|---|---|
| O2 | Monaco editor with Java highlighting, bracket matching and snippets (`main`, `sout`, `fori`, …) | Done |
| O3 | Compile and run in the browser with **Run** or `Ctrl+Enter` | Done |
| O4 | Console output (stdout/stderr) and interactive input (`Scanner`, `System.in`) | Done |
| O5 | Compile errors in a Problems panel and as red underlines in the editor | Done |
| O5 | Runtime exceptions with a plain-English hint and clickable stack frames | Done |
| — | **Stop** a running program, including busy loops that never print | Done |
| — | `System.exit(n)` reports the exit code without killing the runtime | Done |
| — | Code autosaved in the browser, download as `.java`, light/dark theme, resizable console | Done |
| O6 | Automated tests: Vitest unit tests and 16 Playwright end-to-end tests (Edge and Chromium) that compile and run real programs, including a check that no code or input leaves the browser | Done |
| O7 | Debugging (breakpoints, step-through) | Stretch goal |

## Guides

- **[Running the IDE](docs/RUNNING.md)**: install, start, use the IDE, run the tests and tools, troubleshooting.
- **[Hosting the IDE](docs/HOSTING.md)**: build and publish it (GitHub Pages, Netlify or any web server), licence conditions, checks.

## Getting started

Requirements: Node.js 20+ and an internet connection (CheerpJ and fonts load from their CDNs).

```bash
npm install
npm run dev        # http://localhost:5173
```

Other scripts:

```bash
npm test               # unit tests (Vitest)
npm run test:e2e       # end-to-end tests in Edge and Chromium (Playwright); needs internet for the CheerpJ CDN
npm run test:all       # both
npm run build          # production build to dist/ (static files, host anywhere)
npm run preview        # serve the production build
npm run build:bridge   # rebuild public/runtime/ide-bridge.jar (needs a JDK 11+ on PATH)
npm run profile:preload  # re-record which CheerpJ runtime files to preload at start-up
npm run benchmark      # performance benchmark in Edge and Chromium → reports/benchmark-results.json
npm run report         # test report and performance evaluation (.docx) from the files in reports/
```

The end-to-end tests run in your installed Microsoft Edge and in Playwright's Chromium build (install it
once with `npx playwright install chromium`).
The Playwright tests start the dev server automatically, or reuse one that is already running.

The first page load downloads about 22 MB (the CheerpJ runtime plus the IDE and its 2 MB compiler)
and warms up the compiler; how long this takes depends mostly on the connection to the CheerpJ CDN.
After that, compiling and running a small program takes about 0.2–0.5 s.

## How it works

```
Browser page (JavaScript)                         CheerpJ JVM (WebAssembly, Java 8)
──────────────────────────                        ─────────────────────────────────
Monaco editor ── Run ──► java-runtime.js ──cmd──► ide.Bridge (long-running loop)
                               ▲                    ├─ compile: writes source to /files/,
                               │                    │   javac + LoopGuard → diagnostics
Console / Problems ◄── events ─┘                    └─ run: new class loader, redirects
                                                        System.out/err/in to JS natives
```

1. **One long-lived bridge.** Each `cheerpjRunMain` call costs roughly 2.5 s of start-up, so
   `ide.Bridge` is started once and waits for commands through an async JavaScript native
   (`nextCommand`). This brought a compile-and-run from about 12 s down to under 1 s.
2. **Compile.** The bridge writes the source to CheerpJ's IndexedDB file system (`/files/build/…`)
   and calls `javac` through the `javax.tools` API. Diagnostics (line, column, message) go back as
   JSON and become Monaco markers.
3. **Run.** Each run uses a fresh `URLClassLoader`, so edited classes are never stale. `System.out`,
   `System.err` and `System.in` are swapped for streams that call JavaScript natives, and a
   `SecurityManager` turns `System.exit` into a normal exit code.
4. **Start-up.** Two things keep the first load down: `tools.jar` is stripped to javac and its tree API
   (18.3 MB → 2.0 MB, `scripts/build-tools-jar.mjs`), and the runtime files CheerpJ needs are listed in
   `src/runtime/preload-resources.json` and passed to `cheerpjInit` as `preloadResources`, so it fetches
   them in parallel instead of one at a time. Regenerate that list with `npm run profile:preload` after
   changing the CheerpJ or Java version. A progress percentage is shown while the runtime loads.
5. **Loop guard.** CheerpJ runs Java on the browser's main thread, so `while (true) { n++; }` would
   freeze the tab. During compilation, `LoopGuard` (a javac `TaskListener`) rewrites every loop body
   to `{ ide.Guard.tick(); body }`. About every 50 ms, `Guard.tick()` hands control back to the
   browser and checks the Stop flag. On a tight 20-million-iteration loop this costs about 10–14%
   (see `reports/benchmark-results.json`); typical student programs are not affected noticeably.

## Project structure

```
index.html                  App shell and CheerpJ loader
src/
  main.js                   UI wiring: run/stop, problems, examples, theme, layout
  runtime/java-runtime.js   CheerpJ start-up, command protocol, JavaScript natives
  ui/editor.js              Monaco set-up, markers, snippets, shortcuts
  ui/console-view.js        Console output, input prompts, exception rendering
  java/source-info.js       Finds file name, main class and method lines in Java source
  samples/*.java            Example and test programs
  storage.js, style.css
java/src/ide/               Bridge source (compiled into public/runtime/ide-bridge.jar)
  Bridge.java               Command loop, compile, run, exception reporting
  LoopGuard.java, Guard.java  Keep busy loops interruptible
  ConsoleInputStream.java, ConsoleOutputStream.java, Json.java
public/
  lib/tools.jar             JDK 8 javac (GPLv2 + Classpath Exception)
  runtime/ide-bridge.jar    Built bridge
scripts/build-bridge.mjs    Builds the bridge jar
tests/                      Vitest unit tests
e2e/ide.spec.js             Playwright end-to-end tests
playwright.config.js
```

## Known limitations

- **Java 8 language level.** `var`, records, switch expressions and text blocks are not available.
  CheerpJ 4 can also run Java 11 and 17, but the compiler would need a matching setup.
- **Single source file.** Several classes can share one file; multi-file projects are a stretch goal.
- **Stack traces.** CheerpJ often omits line numbers. The IDE then links each frame to the
  method's declaration line instead.
- **Speed.** CPU-heavy code runs much slower than on a desktop JVM.
- **Start-up time depends on the network.** CheerpJ loads about 17 MB of the Java class library from
  its CDN in many range requests. Repeat visits are only partly served from the browser cache, and a
  Service Worker cannot help: CheerpJ fetches those files from inside its own Web Worker, whose
  requests never reach the page's Service Worker (measured, see the evaluation report). Self-hosting
  the CheerpJ runtime would avoid the CDN, but it is not allowed on the free Community tier: it needs
  a Commercial Licence (from GBP 100 per developer per month). Leaning Technologies offers free or
  discounted licences for classroom and educational use on request, which is worth asking about.
- **No GUI programs.** Swing, AWT and JavaFX are out of scope.
- **Licensing.** This project uses the free CheerpJ Community tier, which covers personal projects,
  open-source projects and technical evaluations and asks for appropriate credit (given in the status
  bar and here). It does not allow self-hosting the runtime, so the IDE loads CheerpJ from the vendor
  CDN and start-up time depends on that connection. A Commercial Licence would be needed to self-host
  or for team/commercial use: https://cheerpj.com/licensing/. CheerpJ is by Leaning Technologies;
  `tools.jar` comes from the OpenJDK 8 compiler (GPLv2 with Classpath Exception).
  `tools.jar` is taken from Leaning Technologies' open-source
  [JavaFiddle](https://github.com/leaningtech/javafiddle) project.
