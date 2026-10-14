import { chromium } from '@playwright/test';
import { preview } from 'vite';
const server = await preview({ preview: { port: 4180 }, logLevel: 'warn' });
const browser = await chromium.launch({ channel: 'msedge' });
for (const mode of ['off', 'on']) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const url = `http://localhost:4180/${mode === 'off' ? '?serviceWorker=off' : ''}`;
  for (let visit = 1; visit <= 3; visit++) {
    let cdnBytes = 0;
    page.removeAllListeners('requestfinished');
    page.on('requestfinished', async (r) => { if (r.url().includes('leaningtech')) { const s = await r.sizes().catch(() => ({ responseBodySize: 0 })); cdnBytes += s.responseBodySize; } });
    const t = Date.now();
    if (visit === 1) await page.goto(url); else await page.reload();
    await page.waitForFunction(() => window.__javaIde?.startup, null, { timeout: 300000 });
    const s = await page.evaluate(() => window.__javaIde.startup);
    await page.waitForTimeout(300);
    console.log(`sw ${mode} visit ${visit}: wall ${Date.now() - t} ms, runtime ${s.runtimeMs}, warmup ${s.warmupMs}, swActive ${s.cached}, CDN ${Math.round(cdnBytes / 1024)} KB`);
  }
  await ctx.close();
}
await browser.close(); server.httpServer.close();
