// End-to-end tests: compile and run real Java programs in the browser through CheerpJ.
// They need internet access, because the CheerpJ runtime loads from its CDN.
import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

/** @type {import('@playwright/test').Page} */
let page;

const runButton = () => page.locator('#run-button');
const stopButton = () => page.locator('#stop-button');
const consoleOutput = () => page.locator('#console-output');
const statusText = () => page.locator('#status-text');

async function loadExample(id) {
  await page.selectOption('#example-select', id);
}

async function setSource(source) {
  await page.evaluate((code) => window.__javaIde.setSource(code), source);
}

/** Clicks Run and waits for the program to finish (Run becomes enabled again). */
async function runToCompletion() {
  await runButton().click();
  await expect(runButton()).toBeDisabled();
  await expect(runButton()).toBeEnabled({ timeout: 45_000 });
}

async function startRun() {
  await runButton().click();
  await expect(stopButton()).toBeEnabled();
}

test.beforeAll(async ({ browser }) => {
  // A fresh browser profile downloads the whole runtime (including the 18 MB tools.jar) with no cache
  test.setTimeout(240_000);
  page = await browser.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') console.log(`[browser error] ${message.text()}`);
  });
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  // Runtime download, JVM start and compiler warm-up
  await expect(runButton()).toBeEnabled({ timeout: 220_000 });
});

test.afterAll(async () => {
  await page.close();
});

test('loads the Java runtime and shows it is ready', async () => {
  await expect(consoleOutput()).toContainText('Java runtime ready');
  await expect(statusText()).toHaveText('Ready');
  await expect(page.locator('.monaco-editor')).toBeVisible();
  await expect(page.locator('#file-name')).toHaveText('Main.java');
});

test('compiles and runs Hello World', async () => {
  await loadExample('hello');
  await runToCompletion();
  await expect(consoleOutput()).toContainText('Hello, World!');
  await expect(consoleOutput()).toContainText('Program finished with exit code 0');
  await expect(page.locator('#problems-badge')).toBeHidden();
});

test('never sends source code or program input over the network', async () => {
  // Unique markers that would show up in any request that carried the code or the typed input
  const codeMarker = `SOURCE_MARKER_${Date.now()}`;
  const inputMarker = `INPUT_MARKER_${Date.now()}`;
  const leaks = [];
  const requests = [];

  const onRequest = (request) => {
    const body = request.postData() ?? '';
    requests.push(`${request.method()} ${request.url()}`);
    if (request.method() !== 'GET' && request.method() !== 'HEAD') {
      leaks.push(`${request.method()} request to ${request.url()}`);
    }
    for (const marker of [codeMarker, inputMarker]) {
      if (request.url().includes(marker) || body.includes(marker)) leaks.push(`${marker} in ${request.url()}`);
    }
  };
  const onWebSocket = (socket) => {
    socket.on('framesent', ({ payload }) => {
      const text = typeof payload === 'string' ? payload : payload.toString();
      if (text.includes(codeMarker) || text.includes(inputMarker)) leaks.push(`marker in WebSocket frame to ${socket.url()}`);
    });
  };
  page.on('request', onRequest);
  page.on('websocket', onWebSocket);

  try {
    await setSource(`import java.util.Scanner;

public class Main {
    // ${codeMarker}
    public static void main(String[] args) {
        String secret = "${codeMarker}";
        String typed = new Scanner(System.in).nextLine();
        System.out.println("code marker length " + secret.length() + ", input " + typed);
    }
}
`);
    await startRun();
    const input = page.locator('.console-input');
    await expect(input).toBeVisible();
    await input.fill(inputMarker);
    await input.press('Enter');
    await expect(runButton()).toBeEnabled();
    await expect(consoleOutput()).toContainText(`input ${inputMarker}`);
    // Give any delayed request (e.g. analytics or beacons) a chance to appear
    await page.waitForTimeout(1_000);
  } finally {
    page.off('request', onRequest);
    page.off('websocket', onWebSocket);
  }

  test.info().annotations.push({ type: 'requests during compile and run', description: String(requests.length) });
  expect(leaks, `requests seen:\n${requests.join('\n')}`).toEqual([]);
});

test('runs programs with several classes and formatted output', async () => {
  await loadExample('classes');
  await runToCompletion();
  await expect(consoleOutput()).toContainText('Circle     area = 7.07');
  await expect(consoleOutput()).toContainText('Rectangle  area = 6.00');
});

test('reads console input with Scanner', async () => {
  await loadExample('input');
  await startRun();

  const input = page.locator('.console-input');
  await expect(consoleOutput()).toContainText('What is your name?');
  await expect(input).toBeFocused();
  await input.fill('Ada Lovelace');
  await input.press('Enter');

  await expect(consoleOutput()).toContainText('How old are you?');
  await page.locator('.console-input').fill('36');
  await page.locator('.console-input').press('Enter');

  await expect(runButton()).toBeEnabled();
  await expect(consoleOutput()).toContainText('Hello Ada Lovelace, next year you will be 37.');
});

test('reports compilation errors in the Problems panel and the editor', async () => {
  await loadExample('compile-error');
  await runToCompletion();

  await expect(consoleOutput()).toContainText('Compilation failed with 3 errors');
  await expect(page.locator('#problems-badge')).toHaveText('3');
  await expect(page.locator('#problems-panel')).toBeVisible();

  const problems = page.locator('.problem');
  await expect(problems).toHaveCount(3);
  await expect(problems.nth(0)).toContainText('incompatible types: int cannot be converted to java.lang.String');
  await expect(problems.nth(0)).toContainText('Ln 7, Col 26');
  await expect(problems.nth(1)).toContainText('cannot find symbol');
  await expect(problems.nth(2)).toContainText('int cannot be dereferenced');

  // Monaco renders a squiggle for each marker
  await expect(page.locator('.monaco-editor .squiggly-error')).toHaveCount(3);

  // Clicking a problem moves the cursor to it
  await problems.nth(1).click();
  await expect(page.locator('#cursor')).toHaveText('Ln 8, Col 28');
});

test('shows runtime exceptions with a hint and clickable frames', async () => {
  await loadExample('runtime-error');
  await runToCompletion();

  const exception = page.locator('.exception');
  await expect(exception).toContainText('java.lang.ArrayIndexOutOfBoundsException');
  await expect(exception.locator('.exception-hint')).toContainText('outside its valid range');
  await expect(consoleOutput()).toContainText('Program terminated with exit code 1');

  const averageFrame = exception.locator('.frame-link', { hasText: 'Main.average' });
  await expect(averageFrame).toBeVisible();
  await averageFrame.click();
  await expect(page.locator('#cursor')).toHaveText('Ln 7, Col 1');
});

test('stops a program that keeps printing', async () => {
  await loadExample('loop');
  await startRun();
  await expect(consoleOutput()).toContainText('tick 2');
  await stopButton().click();
  await expect(runButton()).toBeEnabled({ timeout: 5_000 });
  await expect(consoleOutput()).toContainText('Program stopped after');
});

test('stops a busy loop that never prints, without freezing the page', async () => {
  await setSource(`public class Main {
    public static void main(String[] args) {
        long n = 0;
        while (true) { n++; }
    }
}
`);
  await startRun();
  await expect(statusText()).toHaveText('Running…');

  // If the loop blocked the main thread, this timer would not fire on time
  const timerGapMs = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const start = performance.now();
        setTimeout(() => resolve(performance.now() - start), 50);
      }),
  );
  expect(timerGapMs).toBeLessThan(1_000);

  await stopButton().click();
  await expect(runButton()).toBeEnabled({ timeout: 5_000 });
  await expect(consoleOutput()).toContainText('Program stopped after');
});

test('stops a program that is waiting for input', async () => {
  await loadExample('input');
  await startRun();
  await expect(page.locator('.console-input')).toBeVisible();
  await stopButton().click();
  await expect(runButton()).toBeEnabled({ timeout: 5_000 });
  await expect(page.locator('.console-input')).toHaveCount(0);
  await expect(consoleOutput()).toContainText('Program stopped after');
});

test('reports System.exit codes and keeps the runtime alive', async () => {
  await setSource(`public class Main {
    public static void main(String[] args) {
        System.out.println("before exit");
        System.exit(3);
    }
}
`);
  await runToCompletion();
  await expect(consoleOutput()).toContainText('before exit');
  await expect(consoleOutput()).toContainText('exit code 3');

  await loadExample('hello');
  await runToCompletion();
  await expect(consoleOutput()).toContainText('Hello, World!');
});

test('runs the edited version of a class, not a cached one', async () => {
  const program = (message) => `public class Main {
    public static void main(String[] args) {
        System.out.println("${message}");
    }
}
`;
  await setSource(program('first version'));
  await runToCompletion();
  await expect(consoleOutput()).toContainText('first version');

  await setSource(program('second version'));
  await runToCompletion();
  await expect(consoleOutput()).toContainText('second version');
  await expect(consoleOutput()).not.toContainText('first version');
});

test('supports packages and a non-public main class', async () => {
  await setSource(`package com.example;

class Helper {
    static String greet() { return "hello from a package"; }
}

class App {
    public static void main(String[] args) {
        System.out.println(Helper.greet());
    }
}
`);
  // With no public class, the file is named after the class that declares main
  await expect(page.locator('#file-name')).toHaveText('App.java');
  await runToCompletion();
  await expect(consoleOutput()).toContainText('hello from a package');
});

test('prints large amounts of output quickly and in order', async () => {
  // Regression test: output time used to grow quadratically (3,000 lines took about 60 s)
  await setSource(`public class Main {
    public static void main(String[] args) {
        for (int i = 0; i < 5000; i++) {
            System.out.println("line " + i);
        }
        System.out.print("Name? ");
        System.out.println(new java.util.Scanner(System.in).nextLine());
    }
}
`);
  const started = Date.now();
  await startRun();
  const input = page.locator('.console-input');
  await expect(input).toBeVisible({ timeout: 30_000 });
  expect(Date.now() - started).toBeLessThan(30_000);

  // All output is flushed, in order, before the input prompt appears
  const text = await consoleOutput().innerText();
  expect(text).toContain('line 0\n');
  expect(text).toContain('line 4999\nName? ');
  expect(text.indexOf('line 2500')).toBeLessThan(text.indexOf('line 4999'));

  await input.fill('done');
  await input.press('Enter');
  await expect(runButton()).toBeEnabled();
  await expect(consoleOutput()).toContainText('Name? done');
});

test('writes stderr in a separate colour', async () => {
  await setSource(`public class Main {
    public static void main(String[] args) {
        System.out.println("normal");
        System.err.println("problem");
    }
}
`);
  await runToCompletion();
  await expect(page.locator('.out-stdout')).toContainText('normal');
  await expect(page.locator('.out-stderr')).toContainText('problem');
});

test('downloads the source file', async () => {
  await loadExample('hello');
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#download-button').click()]);
  expect(download.suggestedFilename()).toBe('Main.java');
});

test('keeps the code after a reload', async () => {
  const source = await page.evaluate(() => window.__javaIde.getSource());
  await page.waitForTimeout(600); // autosave is debounced
  await page.reload();
  await expect(page.locator('.monaco-editor')).toBeVisible();
  expect(await page.evaluate(() => window.__javaIde.getSource())).toBe(source);
});
