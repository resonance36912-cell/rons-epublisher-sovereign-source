import { chromium } from '@playwright/test';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
await page.goto('http://127.0.0.1:3101/app', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(1500);
console.log((await page.locator('body').innerText()).slice(0, 15000));
await page.screenshot({ path: 'C:/Users/Ashley/Resonance/OpenNova/apps/epublisher-sovereign-local-v0.1/docs/generated/epublisher-current-app-20260912.png', fullPage: true });
await browser.close();