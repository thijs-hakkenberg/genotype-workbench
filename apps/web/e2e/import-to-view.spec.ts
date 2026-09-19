import { expect, test, type Request } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const KIT = resolve(here, '../../../fixtures/synthetic-kits/synthetic-v5-small.txt');

test('import a kit, see it, join a pack, keep it after reload — all on one origin', async ({ page, baseURL }) => {
  const offOrigin: string[] = [];
  page.on('request', (r: Request) => {
    const u = r.url();
    if (!u.startsWith(baseURL!) && !u.startsWith('data:') && !u.startsWith('blob:')) offOrigin.push(u);
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // Start: offline, no kits
  await page.goto('/');
  await expect(page.getByText('Bring your own raw DNA file')).toBeVisible();
  await expect(page.getByText('Offline · no network grants')).toBeVisible();

  // Import: normalize in the worker, then custody is required before storing
  await page.goto('/#/import');
  await page.setInputFiles('input[type=file]', KIT);
  await expect(page.getByText('Custody record required')).toBeVisible();
  await expect(page.getByText('Rows read')).toBeVisible();
  await expect(page.locator('.kv >> text=Checked against GRCh37').locator('..')).not.toContainText('not checked');
  await page.getByRole('button', { name: 'Store kit on this device' }).click();

  // Overview
  await expect(page.getByText('Kit overview')).toBeVisible();
  await expect(page.locator('.stat', { hasText: 'Calls stored' })).toContainText('5,000');
  await expect(page.getByText('This kit is your own')).toBeVisible();

  // Genome view at rs4988235 via search
  await page.getByRole('searchbox').fill('rs4988235');
  await page.getByRole('searchbox').press('Enter');
  await expect(page.locator('aside')).toContainText('rs4988235');
  await expect(page.locator('aside')).toContainText('Your call · measured');
  await expect(page.locator('aside')).toContainText('GRCh37:2:136608646:G');

  // Install ClinVar through the grant dialog
  await page.goto('/#/packs');
  const clinvar = page.locator('.panel', { hasText: 'ClinVar classifications' });
  await clinvar.getByRole('button', { name: /Install/ }).click();
  await expect(page.getByText('Grant requested')).toBeVisible();
  await page.getByRole('button', { name: 'Grant for this session' }).click();
  await expect(clinvar.getByText(/Installed/)).toBeVisible();
  await expect(page.getByText(/Network: localhost/)).toBeVisible();

  await page.goto('/#/genome/2:136590000-136625000?sel=2:136608646');
  await expect(page.locator('aside')).toContainText('ClinVar classification');
  await expect(page.locator('aside')).toContainText('VCV');

  // Persisted in OPFS across a reload
  await page.reload();
  await page.goto('/#/kits');
  await expect(page.locator('table')).toContainText('Me — 23andMe');
  await page.goto('/#/packs');
  await expect(page.locator('.panel', { hasText: 'ClinVar classifications' }).getByText(/Installed/)).toBeVisible();

  expect(errors).toEqual([]);
  expect(offOrigin).toEqual([]);
});

test('refuses a file that is not a 23andMe export', async ({ page }) => {
  await page.goto('/#/import');
  await page.setInputFiles('input[type=file]', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello\nworld\n') });
  await expect(page.getByRole('alert')).toContainText('not a format this version can read');
});
