import { chromium } from '@playwright/test';
import { preview } from 'vite';
const server = await preview({ preview: { port: 4183 }, logLevel: 'warn' });
const browser = await chromium.launch({ channel: 'msedge' });
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto('http://localhost:4183/');
await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 60000 });
const result = await page.evaluate(async () => {
  const url = 'https://cjrtnc.leaningtech.com/4.3/8/jre/lib/rt.jar';
  const r = await fetch(url, { headers: { Range: 'bytes=0-99' } });
  const buf = await r.arrayBuffer();
  const c = await caches.open((await caches.keys())[0]);
  const keys = (await c.keys()).map((x) => x.url).filter((u) => u.includes('rt.jar'));
  return { status: r.status, bytes: buf.byteLength, contentRange: r.headers.get('content-range'), keys };
});
console.log(JSON.stringify(result, null, 1));
await browser.close(); server.httpServer.close();
