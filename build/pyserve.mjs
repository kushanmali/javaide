import { chromium } from '@playwright/test';
const browser = await chromium.launch({ channel: 'msedge' });
const page = await (await browser.newContext()).newPage();
try {
  await page.goto('http://localhost:4191/');
  await page.waitForFunction(() => !document.getElementById('run-button').disabled, null, { timeout: 150000 });
  await page.click('#run-button');
  await page.waitForFunction(() => /exit code/.test(document.getElementById('console-output').innerText), null, { timeout: 60000 });
  console.log('python http.server: WORKS', (await page.locator('#console-output').innerText()).includes('Hello, World!'));
} catch (e) {
  console.log('python http.server: FAILS. status =', await page.locator('#status-text').innerText(), '| console =', (await page.locator('#console-output').innerText()).slice(0, 200));
}
await browser.close();
