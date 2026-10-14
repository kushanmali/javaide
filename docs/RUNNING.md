# Running the Java IDE

How to run the IDE on your own computer, use it, and run its tests and tools. To put it on the web
for other people, see [HOSTING.md](HOSTING.md).

## 1. Requirements

| Need | Version | Used for |
|---|---|---|
| [Node.js](https://nodejs.org) | 20 or newer | Running and building the IDE |
| Internet connection | — | The Java runtime (CheerpJ) loads from its CDN every time the page starts |
| A modern browser | Recent Edge, Chrome or Firefox | Using the IDE |
| JDK | 11 or newer | **Only** to rebuild the Java bridge (section 6) |

You do not need Java installed to run or use the IDE. All Java compilation and execution happens
inside the browser.

## 2. Install and start

From the project folder:

```bash
npm install
npm run dev
```

Then open **http://localhost:5173**. The status bar shows the runtime loading, with a percentage.

The first start takes about 20–40 seconds, depending on your connection, because the browser
downloads about 23 MB (the Java runtime and the compiler) and then warms up the compiler. When the
status bar says **Ready**, the Run button becomes available.

To stop the server, press `Ctrl+C` in the terminal.

## 3. Using the IDE

| To | Do this |
|---|---|
| Compile and run | Click **Run**, or press `Ctrl+Enter` in the editor |
| Type input for the program | Type in the green field that appears in the console, then press `Enter` (`Ctrl+D` sends end of input) |
| Stop a program | Click **Stop**. This works for loops that never print, too |
| See compile errors | They are underlined in the editor and listed under **Problems**; click one to jump to it |
| Jump to where an exception happened | Click an underlined stack line in the console |
| Load an example | Choose one from **Examples…** (this replaces the code in the editor) |
| Save | Code saves automatically in your browser; `Ctrl+S` saves immediately |
| Download the code | Click **Download**; the file is named after your class, e.g. `Main.java` |
| Switch light/dark theme | The half-circle button at the top right |
| Resize the console | Drag the bar between the editor and the console |

Editor shortcuts: type `main`, `sout`, `fori`, `foreach`, `scanner` or `trycatch` and pick the
suggestion to insert common Java code.

**What the IDE supports:** Java 8 programs in a single file, with any number of classes, an optional
`package` line, console input and output, and `System.exit`. It does not support Swing/AWT/JavaFX
windows, multiple source files, or external libraries.

## 4. Other ways to run it

Run the production build locally, exactly as it would be hosted:

```bash
npm run build
npm run preview
```

Then open **http://localhost:4173**.

## 5. Tests

```bash
npm test               # unit tests (Vitest), a few seconds
npm run test:e2e       # end-to-end tests in Microsoft Edge and Chromium (Playwright), about 3 minutes
npm run test:all       # both
```

The end-to-end tests start the dev server themselves, or reuse one that is already running. They
need an internet connection (for CheerpJ), Microsoft Edge installed, and Playwright's Chromium,
installed once with:

```bash
npx playwright install chromium
```

To run in one browser only: `npx playwright test --project=edge` (or `--project=chromium`).

## 6. Maintenance tools

You only need these when changing the corresponding part of the project.

| Command | When to run it | Needs |
|---|---|---|
| `npm run build:bridge` | After editing any file in `java/src/ide/` | JDK 11+ on PATH |
| `node scripts/build-tools-jar.mjs <full tools.jar>` | To rebuild the 2 MB compiler jar from a full JDK 8 `tools.jar` | JDK on PATH |
| `npm run profile:preload` | After changing the CheerpJ or Java version, or the bridge | Microsoft Edge |
| `npm run benchmark` | To re-measure performance (about 25 minutes) | Edge and Chromium |
| `npm run report` | To regenerate the test and performance report from `reports/` | — |

## 7. Troubleshooting

**"Could not start the Java runtime" or the status stays on "Loading Java runtime…"**
The browser could not reach the CheerpJ CDN (`cjrtnc.leaningtech.com`). Check your internet
connection, and that no firewall, proxy or ad blocker is blocking that address. Then reload.

**`Port 5173 is already in use`**
Another copy of the dev server is running. Close it, or find it with `netstat -ano | findstr 5173`
(Windows) and end that process.

**Start-up is very slow**
This is normal on slow connections: the Java class library comes from CheerpJ's servers in many
small requests. Later visits are usually faster. See the performance report for measurements.

**A program does not stop when I click Stop**
Almost every program stops within a fraction of a second. If one does not, click **Stop** again
when it changes to **Reset**: this reloads the page. Your code is saved first.

**Start again with a clean editor**
Your code is stored in the browser. To clear it, pick an example from **Examples…**, or clear the
site data for `localhost` in your browser's settings.
