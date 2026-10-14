import { chromium } from '@playwright/test';
import { preview } from 'vite';
const server = await preview({ preview: { port: 4186 }, logLevel: 'warn' });
const browser = await chromium.launch({ channel: 'msedge' });
const results = { on: [], off: [] };
for (let i = 0; i < 5; i++) {
  for (const mode of ['on', 'off']) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    let cdn = 0, app = 0;
    page.on('requestfinished', async (r) => {
      const s = await r.sizes().catch(() => ({ responseBodySize: 0 }));
      if (r.url().includes('leaningtech')) cdn += s.responseBodySize; else if (r.url().includes('4186')) app += s.responseBodySize;
    });
    const t = Date.now();
    await page.goto(`http://localhost:4186/?serviceWorker=off${mode === 'off' ? '&preload=off' : ''}`);
    await page.waitForFunction(() => window.__javaIde?.startup, null, { timeout: 300000 });
    const s = await page.evaluate(() => window.__javaIde.startup);
    await page.waitForTimeout(200);
    const row = { wall: Date.now() - t, runtime: s.runtimeMs, warmup: s.warmupMs, cdnMB: +(cdn / 1e6).toFixed(1), appMB: +(app / 1e6).toFixed(1) };
    results[mode].push(row);
    console.log(`preload ${mode}: ${JSON.stringify(row)}`);
    await ctx.close();
  }
}
const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
for (const mode of ['on', 'off']) {
  const r = results[mode];
  console.log(`preload ${mode} medians: wall ${med(r.map((x) => x.wall))} runtime ${med(r.map((x) => x.runtime))} warmup ${med(r.map((x) => x.warmup))} cdn ${med(r.map((x) => x.cdnMB))} MB app ${med(r.map((x) => x.appMB))} MB`);
}
await browser.close(); server.httpServer.close();
