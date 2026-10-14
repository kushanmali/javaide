import { chromium } from '@playwright/test';
import { preview } from 'vite';
const server = await preview({ preview: { port: 4182 }, logLevel: 'warn' });
const browser = await chromium.launch({ channel: 'msedge' });
const ctx = await browser.newContext();
const page = await ctx.newPage();
const seen = { page: 0, sw: 0 };
ctx.on('request', (r) => { if (r.url().includes('leaningtech')) seen.page++; });
ctx.on('serviceworker', (w) => console.log('sw registered', w.url()));
await page.goto('http://localhost:4182/');
await page.waitForFunction(() => window.__javaIde?.startup, null, { timeout: 300000 });
await page.waitForTimeout(2000);
const keys = await page.evaluate(async () => {
  const c = await caches.open((await caches.keys())[0]);
  return (await c.keys()).map((r) => r.url);
});
console.log('context-observed CDN requests', seen.page);
console.log('cached keys:'); console.log(keys.map((k) => k.replace('https://cjrtnc.leaningtech.com/4.3', 'CDN').replace('http://localhost:4182', 'APP')).join('\n'));
await browser.close(); server.httpServer.close();
