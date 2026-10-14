import { chromium } from '@playwright/test';
import { preview } from 'vite';
const server = await preview({ preview: { port: 4184 }, logLevel: 'warn' });
const browser = await chromium.launch({ channel: 'msedge' });
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto('http://localhost:4184/');
await page.waitForFunction(() => window.__javaIde?.startup, null, { timeout: 300000 });
await page.waitForTimeout(1500);
const diag = await page.evaluate(() => new Promise((resolve) => {
  navigator.serviceWorker.addEventListener('message', (e) => resolve(e.data.diag));
  navigator.serviceWorker.controller.postMessage('diag');
  setTimeout(() => resolve('no reply'), 5000);
}));
console.log(JSON.stringify(diag, null, 1));
await browser.close(); server.httpServer.close();
