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

  // More sources: frequencies (population-frequency), GWAS, Mondo, the trees. The grant already holds.
  await page.goto('/#/packs');
  for (const title of ['Gene models (GENCODE', '1000 Genomes allele frequencies', 'GWAS Catalog associations', 'Condition names (Mondo', 'mtDNA haplogroup tree', 'Y-DNA haplogroup tree', 'Genetic map', 'dbSNP rsID merge history', 'GRCh37 sequence at coding regions', 'Proteins (UniProt']) {
    const panel = page.locator('.panel', { hasText: title });
    await panel.getByRole('button', { name: /Install/ }).click();
    await expect(panel.getByText(/Installed/)).toBeVisible();
  }
  await page.goto('/#/genome/2:136590000-136625000?sel=2:136608646');
  await expect(page.locator('aside')).toContainText('of 1000 Genomes chromosomes', { timeout: 20_000 });
  await expect(page.locator('aside')).toContainText('not about you');
  await expect(page.locator('aside')).toContainText('Genetic position');
  await expect(page.getByText('Population frequency').first()).toBeVisible();

  // Sequence and protein: zoom past the track scale into bases and codons
  await page.goto('/#/genome/1:11856340-11856420?sel=1:11856378');
  await expect(page.getByText('Reference sequence', { exact: false }).first()).toBeVisible();
  await expect(page.locator('aside')).toContainText('MTHFR p.Ala222Val', { timeout: 45_000 });
  await expect(page.locator('aside')).toContainText('Codon 222 reads GCC in the reference');
  await expect(page.locator('aside')).toContainText('Computed on this device');

  // 3D asks before it fetches anything, and fetches nothing when refused
  const beforeDeny = offOrigin.length;
  await page.getByRole('button', { name: /show the 3D structure/i }).click();
  await expect(page.getByText('Grant requested')).toBeVisible();
  await expect(page.getByText('alphafold.ebi.ac.uk')).toBeVisible();
  await page.getByRole('button', { name: 'Deny' }).click();
  await expect(page.getByText(/access to AlphaFold was not granted/)).toBeVisible();
  expect(offOrigin.length).toBe(beforeDeny);

  // A retired rsID still finds its record through the dbSNP merge history
  await page.getByRole('searchbox').fill('rs58590436');
  await page.getByRole('searchbox').press('Enter');
  await expect(page.getByRole('status')).toContainText('merged into rs3754689');
  await expect(page).toHaveURL(/sel=2:136590746/);

  // ClinVar list: strongest evidence first, with the GWAS column
  await page.goto('/#/clinvar');
  await expect(page.getByText('Ordered by strength of evidence')).toBeVisible();
  await expect(page.locator('thead')).toContainText('Strongest GWAS association');

  // Lineages: both lines placed or explained, with their tree and licence
  await page.goto('/#/lineages');
  await expect(page.getByText('Maternal line · mtDNA')).toBeVisible();
  await expect(page.locator('.panel', { hasText: 'Maternal line' })).toContainText(/Best-matching haplogroup for your mother|Not placed/);
  await expect(page.getByText('licence unverified').first()).toBeVisible();

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

test('says so, and does not download, when the site has too little storage for a pack', async ({ page }) => {
  // Simulate a nearly full storage quota: 10 MB left for this site.
  await page.addInitScript(() => {
    const real = navigator.storage.estimate.bind(navigator.storage);
    navigator.storage.estimate = async () => ({ ...(await real()), quota: 40_000_000, usage: 30_000_000 });
  });
  await page.goto('/#/packs');
  const clinvar = page.locator('.panel', { hasText: 'ClinVar classifications' });
  await expect(clinvar.getByText(/Not enough storage/)).toBeVisible();
  await expect(clinvar.getByRole('button', { name: /Install/ })).toBeDisabled();
  await expect(page.getByText(/of storage left for this site/)).toBeVisible();
});
