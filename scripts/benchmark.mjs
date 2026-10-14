// Performance benchmark for the evaluation. Serves the production build and measures, per browser:
// cold and cached start-up (with and without runtime preloading), download size, compile/run times
// per sample, CPU throughput with and without the loop guard, console output throughput, Stop latency.
//
// Usage: npm run benchmark   (or: npm run build && node scripts/benchmark.mjs [--runs 10] [--browsers edge,chromium])
// Results are written to reports/benchmark-results.json.
import { chromium } from '@playwright/test';
import { preview } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};
const RUNS = Number(option('runs', 10));
const BROWSERS = option('browsers', 'edge,chromium').split(',');
const COLD_STARTS = 3;
const WARM_STARTS = 3;
const CPU_RUNS = 5;
const STOP_RUNS = 5;

const LAUNCH = {
  edge: { channel: 'msedge' },
  chromium: {},
};

const PROGRAMS = {
  cpu: `public class Main {
    public static void main(String[] args) {
        long start = System.currentTimeMillis();
        long sum = 0;
        for (int i = 0; i < 20_000_000; i++) {
            sum += i % 7;
        }
        System.out.println("elapsed=" + (System.currentTimeMillis() - start) + " sum=" + sum);
    }
}
`,
  output: `public class Main {
    public static void main(String[] args) {
        long start = System.currentTimeMillis();
        for (int i = 0; i < 10000; i++) {
            System.out.println("line " + i);
        }
        System.err.println("elapsed=" + (System.currentTimeMillis() - start));
    }
}
`,
  busyLoop: `public class Main {
    public static void main(String[] args) {
        long n = 0;
        while (true) { n++; }
    }
}
`,
};

const stats = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (q) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  return {
    n: sorted.length,
    min: round(sorted[0]),
    median: round(pick(0.5)),
    p90: round(pick(0.9)),
    max: round(sorted[sorted.length - 1]),
    mean: round(mean),
    samples: sorted.map(round),
  };
};
const round = (x) => Math.round(x * 10) / 10;
const log = (...parts) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...parts);

async function waitReady(page) {
  await page.waitForFunction(() => !document.getElementById('run-button').disabled, null, { timeout: 300_000 });
}

async function waitIdle(page) {
  await page.waitForFunction(() => document.getElementById('stop-button').disabled, null, { timeout: 120_000 });
}

/** Clicks Run, waits for completion, and returns wall time plus the console text. */
async function run(page) {
  const started = await page.evaluate(() => {
    document.getElementById('run-button').click();
    return performance.now();
  });
  await page.waitForFunction(() => !document.getElementById('stop-button').disabled || !document.getElementById('run-button').disabled);
  await waitIdle(page);
  return page.evaluate((t0) => ({
    wallMs: performance.now() - t0,
    console: document.getElementById('console-output').innerText,
  }), started);
}

const parseCompileMs = (text) => Number(text.match(/(?:Compiled in|errors? \()\s*(\d+) ms/)?.[1] ?? NaN);
const parseRunMs = (text) => {
  const match = text.match(/(?:in|after) ([\d.]+) s\.\s*$/);
  return match ? Number(match[1]) * 1000 : NaN;
};

async function loadSample(page, id) {
  await page.selectOption('#example-select', id);
}

async function setSource(page, source) {
  await page.evaluate((code) => window.__javaIde.setSource(code), source);
}

async function coldStart(browser, baseUrl, query = '') {
  // A new context is a fresh profile: empty HTTP cache, IndexedDB and localStorage
  const context = await browser.newContext();
  const page = await context.newPage();
  const transfers = [];
  page.on('requestfinished', async (request) => {
    try {
      const sizes = await request.sizes();
      transfers.push({ url: request.url(), bytes: sizes.responseBodySize + sizes.responseHeadersSize });
    } catch {
      // request may belong to a closed page
    }
  });
  const t0 = Date.now();
  await page.goto(`${baseUrl}/${query}`);
  await waitReady(page);
  const readyMs = Date.now() - t0;
  // { runtimeMs, warmupMs, totalMs }: loading the JVM versus warming up the compiler
  const breakdown = await page.evaluate(() => window.__javaIde.startup);
  return { context, page, readyMs, breakdown, transfers };
}

function summariseTransfers(transfers, baseUrl) {
  const byOrigin = {};
  for (const { url, bytes } of transfers) {
    const origin = url.startsWith(baseUrl) ? 'app (static hosting)' : new URL(url).origin;
    byOrigin[origin] = (byOrigin[origin] ?? 0) + bytes;
  }
  const total = Object.values(byOrigin).reduce((a, b) => a + b, 0);
  return {
    requests: transfers.length,
    totalMB: round(total / 1e6),
    byOriginMB: Object.fromEntries(Object.entries(byOrigin).map(([k, v]) => [k, round(v / 1e6)])),
  };
}

async function benchmarkBrowser(name, baseUrl) {
  const browser = await chromium.launch(LAUNCH[name]);
  const result = { browser: name, version: browser.version() };
  log(name, browser.version());

  // --- start-up
  const cold = [];
  const runtimeLoad = [];
  const warmUp = [];
  let transfer = null;
  for (let i = 0; i < COLD_STARTS; i++) {
    const { context, page, readyMs, breakdown, transfers } = await coldStart(browser, baseUrl);
    cold.push(readyMs);
    runtimeLoad.push(breakdown.runtimeMs);
    warmUp.push(breakdown.warmupMs);
    if (i === 0) {
      await page.waitForTimeout(1000);
      transfer = summariseTransfers(transfers, baseUrl);
    }
    log(name, 'cold start', readyMs, 'ms');
    if (i < COLD_STARTS - 1) await context.close();
    else result.page = { context, page };
  }
  result.coldStartMs = stats(cold);
  result.coldStartBreakdownMs = { loadRuntime: stats(runtimeLoad), warmUpCompiler: stats(warmUp) };

  // Round-trip time to the CheerpJ CDN, which dominates start-up (the runtime loads in many range requests)
  result.cdnRoundTripMs = stats(
    await result.page.page.evaluate(async () => {
      const times = [];
      for (let i = 0; i < 10; i++) {
        const t = performance.now();
        await fetch(`https://cjrtnc.leaningtech.com/4.3/loader.js?rtt=${Date.now()}-${i}`, { cache: 'no-store', mode: 'no-cors' });
        times.push(performance.now() - t);
      }
      return times;
    }),
  );
  log(name, 'CDN round trip median', result.cdnRoundTripMs.median, 'ms');
  result.coldStartTransfer = transfer;

  const { context, page } = result.page;
  delete result.page;
  const warm = [];
  for (let i = 0; i < WARM_STARTS; i++) {
    const t0 = Date.now();
    await page.reload();
    await waitReady(page);
    warm.push(Date.now() - t0);
    log(name, 'cached start', warm.at(-1), 'ms');
  }
  result.cachedStartMs = stats(warm);

  // Same cold start with runtime preloading disabled, to measure what preloading contributes
  const withoutPreload = [];
  for (let i = 0; i < COLD_STARTS; i++) {
    const run = await coldStart(browser, baseUrl, '?preload=off');
    withoutPreload.push(run.readyMs);
    await run.context.close();
    log(name, 'cold start without preloading', run.readyMs, 'ms');
  }
  result.coldStartNoPreloadMs = stats(withoutPreload);

  // --- compile and run each sample
  result.samples = {};
  for (const id of ['hello', 'classes', 'runtime-error', 'compile-error']) {
    await loadSample(page, id);
    await run(page); // discard the first run after loading a sample
    const wall = [];
    const compile = [];
    const execute = [];
    for (let i = 0; i < RUNS; i++) {
      const { wallMs, console: text } = await run(page);
      wall.push(wallMs);
      compile.push(parseCompileMs(text));
      if (id !== 'compile-error') execute.push(parseRunMs(text));
    }
    result.samples[id] = {
      endToEndMs: stats(wall),
      compileMs: stats(compile),
      ...(execute.length ? { runMs: stats(execute) } : {}),
    };
    log(name, id, 'median end-to-end', result.samples[id].endToEndMs.median, 'ms');
  }

  // --- console output throughput
  await setSource(page, PROGRAMS.output);
  const outputMs = [];
  for (let i = 0; i < 3; i++) {
    const { console: text } = await run(page);
    outputMs.push(Number(text.match(/elapsed=(\d+)/)[1]));
  }
  result.output10kLinesMs = stats(outputMs);
  log(name, '10k lines median', result.output10kLinesMs.median, 'ms');

  // --- Stop latency on a busy loop that never prints
  await setSource(page, PROGRAMS.busyLoop);
  const stopMs = [];
  const timerGapMs = [];
  for (let i = 0; i < STOP_RUNS; i++) {
    await page.evaluate(() => document.getElementById('run-button').click());
    await page.waitForFunction(() => document.getElementById('status-text').textContent === 'Running…');
    // Largest delay of a 50 ms timer while the loop runs, sampled for one second
    const gap = await page.evaluate(async () => {
      let worst = 0;
      const end = performance.now() + 1000;
      while (performance.now() < end) {
        const t = performance.now();
        await new Promise((r) => setTimeout(r, 50));
        worst = Math.max(worst, performance.now() - t - 50);
      }
      return worst;
    });
    timerGapMs.push(gap);
    const t = await page.evaluate(() => {
      document.getElementById('stop-button').click();
      return performance.now();
    });
    await waitIdle(page);
    stopMs.push(await page.evaluate((t0) => performance.now() - t0, t));
  }
  result.stopLatencyMs = stats(stopMs);
  result.busyLoopTimerDelayMs = stats(timerGapMs);
  log(name, 'stop latency median', result.stopLatencyMs.median, 'ms');

  // --- CPU throughput with and without the loop guard (same page load strategy for both)
  result.cpu20MLoopMs = {};
  for (const guard of ['on', 'off']) {
    await page.goto(`${baseUrl}/${guard === 'off' ? '?loopGuard=off' : ''}`);
    await waitReady(page);
    await setSource(page, PROGRAMS.cpu);
    await run(page); // warm-up run
    const elapsed = [];
    for (let i = 0; i < CPU_RUNS; i++) {
      const { console: text } = await run(page);
      elapsed.push(Number(text.match(/elapsed=(\d+)/)[1]));
    }
    result.cpu20MLoopMs[`loopGuard_${guard}`] = stats(elapsed);
    log(name, `cpu loop guard ${guard} median`, result.cpu20MLoopMs[`loopGuard_${guard}`].median, 'ms');
  }
  const on = result.cpu20MLoopMs.loopGuard_on.median;
  const off = result.cpu20MLoopMs.loopGuard_off.median;
  result.cpu20MLoopMs.guardOverheadPercent = round(((on - off) / off) * 100);

  await context.close();
  await browser.close();
  return result;
}

const server = await preview({ preview: { port: 4173, strictPort: true }, logLevel: 'warn' });
const baseUrl = 'http://localhost:4173';
try {
  const results = {
    generatedAt: new Date().toISOString(),
    settings: { runsPerSample: RUNS, coldStarts: COLD_STARTS, cachedStarts: WARM_STARTS, cpuRuns: CPU_RUNS, stopRuns: STOP_RUNS },
    machine: {
      os: `${os.type()} ${os.release()}`,
      cpu: os.cpus()[0].model.trim(),
      logicalCores: os.cpus().length,
      memoryGB: round(os.totalmem() / 1e9),
      node: process.version,
    },
    server: 'vite preview (production build, localhost)',
    browsers: [],
  };
  for (const name of BROWSERS) {
    results.browsers.push(await benchmarkBrowser(name, baseUrl));
  }
  mkdirSync('reports', { recursive: true });
  writeFileSync('reports/benchmark-results.json', JSON.stringify(results, null, 2) + '\n');
  log('Wrote reports/benchmark-results.json');
} finally {
  await new Promise((resolve) => server.httpServer.close(resolve));
}
