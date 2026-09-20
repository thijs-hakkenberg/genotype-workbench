import { expect, test, type Request } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const KIT = resolve(here, '../../../fixtures/synthetic-kits/synthetic-v5-small.txt');
// A simulated pair: gametes recombined over the genetic map, so they share real segments.
const SIBLING_A = resolve(here, '../../../fixtures/synthetic-kits/synthetic-sibling-a.txt');
const SIBLING_B = resolve(here, '../../../fixtures/synthetic-kits/synthetic-sibling-b.txt');

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
  await expect(page.locator('.dock')).toContainText('rs4988235');
  await expect(page.locator('.dock')).toContainText('Your call · measured');
  await expect(page.locator('.dock')).toContainText('GRCh37:2:136608646:G');

  // Install ClinVar through the grant dialog
  await page.goto('/#/packs');
  const clinvar = page.locator('.panel', { hasText: 'ClinVar classifications' });
  await clinvar.getByRole('button', { name: /Install/ }).click();
  await expect(page.getByText('Grant requested')).toBeVisible();
  await page.getByRole('button', { name: 'Grant for this session' }).click();
  await expect(clinvar.getByText(/Installed/)).toBeVisible();
  await expect(page.getByText(/Network: localhost/)).toBeVisible();

  await page.goto('/#/genome/2:136590000-136625000?sel=2:136608646');
  await expect(page.locator('.dock')).toContainText('ClinVar · curated classification');
  await expect(page.locator('.dock')).toContainText('VCV');

  // More sources: frequencies (population-frequency), GWAS, Mondo, the trees. The grant already holds.
  await page.goto('/#/packs');
  for (const title of ['Gene models (GENCODE', '1000 Genomes allele frequencies', 'GWAS Catalog associations', 'Condition names (Mondo', 'mtDNA haplogroup tree', 'Y-DNA haplogroup tree', 'Genetic map', 'dbSNP rsID merge history', 'GRCh37 sequence at coding regions', 'Proteins (UniProt']) {
    const panel = page.locator('.panel', { hasText: title });
    await panel.getByRole('button', { name: /Install/ }).click();
    await expect(panel.getByText(/Installed/)).toBeVisible();
  }
  await page.goto('/#/genome/2:136590000-136625000?sel=2:136608646');
  await expect(page.locator('.dock')).toContainText('of chromosomes', { timeout: 20_000 });
  await expect(page.locator('.dock')).toContainText('not about you');
  await expect(page.locator('.dock')).toContainText('Genetic position');
  await expect(page.getByText('Population frequency').first()).toBeVisible();

  // Sequence and protein: zoom past the track scale into bases and codons
  await page.goto('/#/genome/1:11856340-11856420?sel=1:11856378');
  await expect(page.getByText('Reference sequence', { exact: false }).first()).toBeVisible();
  await expect(page.locator('.dock')).toContainText('MTHFR p.Ala222Val', { timeout: 45_000 });
  await expect(page.locator('.dock')).toContainText('Codon 222 reads GCC in the reference');
  await expect(page.locator('.dock')).toContainText('computed on this device');

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

test('the molecule is drawn, and says what it is and is not', async ({ page }) => {
  await page.goto('/#/import');
  await page.setInputFiles('input[type=file]', KIT);
  await page.getByRole('button', { name: 'Store kit on this device' }).click();
  await expect(page.getByText('Kit overview')).toBeVisible();
  await page.goto('/#/packs');
  await page.getByRole('button', { name: /^Install all/ }).click();
  await expect(page.getByText('Grant requested')).toBeVisible();
  await page.getByRole('button', { name: 'Grant for this session' }).click();
  await expect(page.getByText('Installing…')).toHaveCount(0, { timeout: 120_000 });

  // Close enough in for a turn to be worth drawing: 10.5 bases is one turn.
  await page.goto('/#/genome/2:136608610-136608690?sel=2:136608646');
  await expect(page.locator('.gw-tracks')).toContainText('Double helix');

  const molecule = page.locator('.dock section', { hasText: 'The molecule' });
  await expect(molecule).toContainText('End-on, down the axis');
  await expect(molecule).toContainText('10.5 bp');
  // It never claims to be a picture of this person's own molecule.
  await expect(molecule).toContainText(/reference|copies read/);

  // Too far out for a turn to mean anything, and the row says so rather than
  // drawing a smear. (The canvas hint is not in the DOM; the empty row is.)
  await page.goto('/#/genome/2:136600000-136620000');
  await expect(page.locator('canvas[aria-label*="molecule is drawn below 400 bases"]')).toHaveCount(1);
});

test('the version in the header leads to what changed', async ({ page }) => {
  await page.goto('/');
  const version = page.locator('.nav-brand a');
  await expect(version).toHaveText(/^v\d+\.\d+\.\d+$/);
  await version.click();
  await expect(page.getByRole('heading', { name: 'What changed' })).toBeVisible();
  // The running version is marked, and the locus version is named as a different number.
  await expect(page.getByText('This version')).toBeVisible();
  await expect(page.getByText(/records which normalizer produced/)).toBeVisible();
});

test('refuses a file no vendor profile recognises, and names the ones it reads', async ({ page }) => {
  await page.goto('/#/import');
  await page.setInputFiles('input[type=file]', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello\nworld\n') });
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('not a format this version can read');
  for (const vendor of ['23andMe', 'AncestryDNA', 'MyHeritage', 'FamilyTreeDNA']) {
    await expect(alert).toContainText(vendor);
  }
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

test('explains itself when a second tab opens, and recovers when the first closes', async ({ context }) => {
  const first = await context.newPage();
  await first.goto('/#/import');
  await first.setInputFiles('input[type=file]', KIT);
  await first.getByRole('button', { name: 'Store kit on this device' }).click();
  await expect(first.getByText('Kit overview')).toBeVisible();

  // The kit's file is open exclusively by the first tab.
  const second = await context.newPage();
  await second.goto('/#/overview');
  await expect(second.getByText('This workbench is open in another tab')).toBeVisible({ timeout: 30_000 });

  await first.close();
  await second.getByRole('button', { name: 'Try again' }).click();
  await expect(second.getByText('Kit overview')).toBeVisible({ timeout: 60_000 });
});

test('Explore gives starting points drawn from the packs', async ({ page }) => {
  await page.goto('/#/import');
  await page.setInputFiles('input[type=file]', KIT);
  await page.getByRole('button', { name: 'Store kit on this device' }).click();
  await expect(page.getByText('Kit overview')).toBeVisible();

  await page.goto('/#/packs');
  await page.getByRole('button', { name: /^Install all/ }).click();
  await expect(page.getByText('Grant requested')).toBeVisible();
  await page.getByRole('button', { name: 'Grant for this session' }).click();
  await expect(page.getByText('Installing…')).toHaveCount(0, { timeout: 120_000 });

  // The overview points somewhere instead of dead-ending.
  await page.goto('/#/overview');
  await expect(page.getByText('Where to look first')).toBeVisible();

  await page.goto('/#/explore');
  await expect(page.getByText('Best-reviewed ClinVar records for your calls')).toBeVisible();
  await expect(page.getByText('Joining on this device…')).toHaveCount(0, { timeout: 120_000 });
  // Ordered by evidence, and it says so.
  await expect(page.getByText('Best review status first')).toBeVisible();
  await expect(page.getByText(/never by how important/)).toBeVisible();

  // A gene is an entry point, with the kit's calls counted in it.
  await page.getByLabel('Search genes').fill('MTHFR');
  const row = page.locator('tr', { hasText: 'MTHFR' }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  await expect(page).toHaveURL(/#\/genome\/1:/);
  await expect(page.getByText('Gene models')).toBeVisible();
});

/**
 * The v0.3 milestone's whole point: reading a second person's DNA, under a
 * grant that names them.
 *
 * The two sibling kits are simulated through meiosis over the genetic map, so
 * they really do share segments. They are deliberately sparse — 20,000 markers
 * against a real chip's 600,000 — which exercises the path that matters most
 * here: the analysis saying so rather than reporting confident nonsense.
 */
test('reads a second person only under a grant that names them', async ({ page, baseURL }) => {
  const offOrigin: string[] = [];
  page.on('request', (r: Request) => {
    const u = r.url();
    if (!u.startsWith(baseURL!) && !u.startsWith('data:') && !u.startsWith('blob:')) offOrigin.push(u);
  });

  const importKit = async (file: string, label: string, subject?: string, consent: 'yes' | 'none' = 'yes') => {
    await page.goto('/#/import');
    await page.setInputFiles('input[type=file]', file);
    await expect(page.getByText('Custody record required')).toBeVisible({ timeout: 120_000 });
    if (subject) {
      await page.getByText("Someone else's (a relative)").click();
      await page.locator('#subject').fill(subject);
      if (consent === 'none') await page.getByText('None recorded').click();
    }
    await page.locator('#label').fill(label);
    await page.getByRole('button', { name: 'Store kit on this device' }).click();
    await expect(page.getByText('Kit overview')).toBeVisible({ timeout: 120_000 });
  };

  await importKit(SIBLING_A, 'Me — 23andMe');
  // An AncestryDNA export: two allele columns, and chromosomes numbered to 26.
  await importKit(SIBLING_B, 'Sister — AncestryDNA', 'R. Bakker');
  await importKit(KIT, 'Uncle J — 23andMe', 'J. Bakker', 'none');

  // Custody: the kit with no consent record says so, and offers a way out.
  await page.goto('/#/kits');
  const uncle = page.locator('tr', { hasText: 'Uncle J' });
  await expect(uncle).toContainText('None recorded');
  await expect(uncle).toContainText('Analysis blocked');

  await page.goto('/#/packs');
  await page.getByRole('button', { name: /^Install all/ }).click();
  await expect(page.getByText('Grant requested')).toBeVisible();
  await page.getByRole('button', { name: 'Grant for this session' }).click();
  await expect(page.getByText('Installing…')).toHaveCount(0, { timeout: 120_000 });

  await page.locator('select[aria-label="Active kit"]').selectOption({ label: 'Me — 23andMe' });
  await page.goto('/#/kinship');

  // A kit with no consent record is refused before anything is asked.
  const chooseByText = async (text: string) => {
    const value = await page.locator('#compare-kit option', { hasText: text }).first().getAttribute('value');
    await page.locator('#compare-kit').selectOption(value!);
  };
  await chooseByText('Uncle J');
  await expect(page.getByText(/No consent is recorded for J\. Bakker/)).toBeVisible();
  await page.getByRole('button', { name: 'Compare on this device' }).click();
  await expect(page.getByText('Grant requested')).toHaveCount(0);
  await expect(page.locator('.error-box')).toContainText('no analysis may read it');

  // The sister has one, so the dialog appears — and names them both.
  await chooseByText('Sister');
  await page.getByRole('button', { name: 'Compare on this device' }).click();
  const dialog = page.locator('.dialog');
  await expect(dialog).toBeVisible({ timeout: 60_000 });
  await expect(dialog).toContainText('Read 2 kits in full');
  await expect(dialog).toContainText('R. Bakker');
  await expect(dialog).toContainText('Me — 23andMe');
  await expect(dialog).toContainText('The manifest lists no hosts');

  // Denying reads nothing.
  await dialog.getByRole('button', { name: 'Deny' }).click();
  await expect(page.locator('.error-box')).toContainText('not granted permission');

  await page.getByRole('button', { name: 'Ask again' }).click();
  await page.getByRole('button', { name: 'Grant for this session' }).click();
  await expect(page.getByText('What they share')).toBeVisible({ timeout: 180_000 });

  // It reports what it found, and what it cannot tell you.
  await expect(page.getByText(/cM across/)).toBeVisible();
  await expect(page.getByText('Computed on this device')).toBeVisible();
  await expect(page.getByText(/half-identical/)).toBeVisible();
  await expect(page.getByText(/Ranges overlap between relationships/)).toBeVisible();
  // These fixtures are far sparser than a real chip, and it says so rather
  // than reporting segments it cannot stand behind.
  await expect(page.getByText(/too few to tell a real shared stretch/)).toBeVisible();
  // Painting draws only what was compared: no X, Y or MT among the autosomes.
  await expect(page.getByText('Autosomes only')).toBeVisible();

  expect(offOrigin).toEqual([]);
});
