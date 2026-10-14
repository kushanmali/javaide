import { chromium } from '@playwright/test';
import { preview } from 'vite';
const server = await preview({ preview: { port: 4175 }, logLevel: 'warn' });
const browser = await chromium.launch({ channel: 'msedge' });
for (let i = 0; i < 3; i++) {
  for (const mode of ['off', 'on']) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    let requests = 0;
    page.on('request', (r) => { if (r.url().includes('leaningtech')) requests++; });
    const t = Date.now();
    await page.goto(`http://localhost:4175/${mode === 'off' ? '?preload=off' : ''}`);
    await page.waitForFunction(() => window.__javaIde?.startup, null, { timeout: 300000 });
    const s = await page.evaluate(() => window.__javaIde.startup);
    console.log(`preload ${mode}: wall ${Date.now() - t} ms, runtime ${s.runtimeMs}, warmup ${s.warmupMs}, CDN requests ${requests}`);
    await ctx.close();
  }
}
await browser.close(); server.httpServer.close();
