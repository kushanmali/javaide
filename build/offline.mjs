import { chromium } from '@playwright/test';
import { preview } from 'vite';
const server = await preview({ preview: { port: 4185 }, logLevel: 'warn' });
const browser = await chromium.launch({ channel: 'msedge' });
const ctx = await browser.newContext();
const page = await ctx.newPage();
const url = 'http://localhost:4185/?serviceWorker=off';
let t = Date.now();
await page.goto(url);
await page.waitForFunction(() => window.__javaIde?.startup, null, { timeout: 300000 });
console.log('visit 1 (network):', Date.now() - t, 'ms', JSON.stringify(await page.evaluate(() => window.__javaIde.startup)));
// Block the CDN entirely: if start-up still works, everything came from the browser cache
await ctx.route('https://cjrtnc.leaningtech.com/**', (route) => route.abort());
t = Date.now();
try {
  await page.reload();
  await page.waitForFunction(() => window.__javaIde?.startup, null, { timeout: 120000 });
  console.log('visit 2 (CDN blocked):', Date.now() - t, 'ms', JSON.stringify(await page.evaluate(() => window.__javaIde.startup)));
} catch (e) {
  console.log('visit 2 (CDN blocked): FAILED after', Date.now() - t, 'ms ->', await page.evaluate(() => document.getElementById('status-text').textContent));
}
await ctx.unroute('https://cjrtnc.leaningtech.com/**');
t = Date.now();
await page.reload();
await page.waitForFunction(() => window.__javaIde?.startup, null, { timeout: 300000 });
console.log('visit 3 (network again):', Date.now() - t, 'ms', JSON.stringify(await page.evaluate(() => window.__javaIde.startup)));
await browser.close(); server.httpServer.close();
