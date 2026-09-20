import { chromium } from '@playwright/test';
const BASE = process.env.BASE, KIT = process.env.KIT, OUT = process.env.OUT, PROFILE = process.env.PROFILE;
const ctx = await chromium.launchPersistentContext(PROFILE, {
  viewport: { width: 1520, height: 1040 }, deviceScaleFactor: 2,
});
const page = ctx.pages()[0] ?? await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));

await page.goto(BASE);
await page.waitForTimeout(3000);
const needsSetup = await page.getByText('Bring your own raw DNA file').isVisible().catch(() => false);
if (needsSetup) {
  await page.goto(`${BASE}/#/packs`);
  await page.getByRole('button', { name: /^Install all/ }).first().click();
  const g = page.getByRole('button', { name: 'Grant for this session' });
  await g.waitFor({ timeout: 30000 }); await g.click();
  await page.getByText('Installing…').waitFor({ state: 'detached', timeout: 180000 }).catch(() => {});
  await page.waitForTimeout(3000);
  await page.goto(`${BASE}/#/import`);
  await page.setInputFiles('input[type=file]', KIT);
  await page.getByText('Custody record required').waitFor({ timeout: 300000 });
  await page.getByRole('button', { name: 'Store kit on this device' }).click();
  await page.getByText('Kit overview').waitFor({ timeout: 300000 });
  console.log('set up');
}

await page.goto(`${BASE}/#/genome/${process.env.REGION}`);
await page.waitForTimeout(5000);
const box = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.gw-tracks > *')];
  const row = rows.find((r) => r.textContent?.includes('Double helix'));
  if (!row) return null;
  const b = row.getBoundingClientRect();
  return { x: b.x, y: b.y, width: b.width, height: b.height };
});
if (box) await page.screenshot({ path: OUT, clip: box });
else { console.log('helix row not found'); await page.screenshot({ path: OUT }); }
await ctx.close();
