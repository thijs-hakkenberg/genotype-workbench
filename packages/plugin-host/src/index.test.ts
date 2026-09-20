import { beforeEach, describe, expect, it } from 'vitest';
import type { KitSubject, PluginManifest } from '@gw/plugin-sdk';
import { KitsNotGranted, PluginHost, type PromptAnswer } from './index';

/** Just enough of a StorageAdapter for grants to be written and read back. */
function memoryStorage() {
  const files = new Map<string, unknown>();
  return {
    files,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readJson: async (p: string) => files.get(p) as any,
    writeJson: async (p: string, v: unknown) => void files.set(p, v),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const kinship: PluginManifest = {
  id: 'analysis-kinship',
  version: '0.3.0',
  hostApi: '^0.1',
  capabilities: ['analysis'],
  title: 'Kinship',
  firstParty: true,
  permissions: { multiKit: true },
};

const haplogroups: PluginManifest = {
  id: 'analysis-haplogroups',
  version: '0.1.0',
  hostApi: '^0.1',
  capabilities: ['analysis'],
  title: 'Haplogroups',
  firstParty: true,
};

const kit = (kitId: string, dataSubject: string, consentBasis: KitSubject['consentBasis']): KitSubject => ({
  kitId,
  label: `${dataSubject} — kit`,
  dataSubject,
  consentBasis,
});

const me = kit('a', 'Me', 'self');
const mother = kit('b', 'M. Bakker', 'recorded-consent');
const uncle = kit('c', 'J. Bakker', 'none');

describe('ensureKits', () => {
  let host: PluginHost;
  let asked: unknown[];

  const answering = (answer: PromptAnswer) => {
    host.setPrompter(async (req) => (asked.push(req), answer));
  };

  beforeEach(async () => {
    host = new PluginHost(memoryStorage());
    await host.init();
    host.register(kinship);
    host.register(haplogroups);
    asked = [];
  });

  it('grants the kits the user approved', async () => {
    answering('session');
    await expect(host.ensureKits('analysis-kinship', [me, mother], 'compare')).resolves.toEqual(['a', 'b']);
    expect(host.hasKitGrant('analysis-kinship', 'a')).toBe(true);
    expect(host.hasKitGrant('analysis-kinship', 'b')).toBe(true);
  });

  it('reads nobody when the user denies', async () => {
    answering('deny');
    await expect(host.ensureKits('analysis-kinship', [me, mother], 'compare')).rejects.toThrow(KitsNotGranted);
    expect(host.hasKitGrant('analysis-kinship', 'a')).toBe(false);
  });

  it('never grants a kit with no consent record, whatever the user answers', async () => {
    answering('persistent');
    const granted = await host.ensureKits('analysis-kinship', [me, mother, uncle], 'compare');
    expect(granted).toEqual(['a', 'b']);
    expect(host.hasKitGrant('analysis-kinship', 'c')).toBe(false);
  });

  it('names the excluded kit so the dialog can say who and why', async () => {
    answering('session');
    await host.ensureKits('analysis-kinship', [me, uncle], 'compare');
    expect(asked).toHaveLength(1);
    const req = asked[0] as { excluded: KitSubject[]; kits: KitSubject[] };
    expect(req.excluded.map((k) => k.dataSubject)).toEqual(['J. Bakker']);
    expect(req.kits.map((k) => k.dataSubject)).toEqual(['Me']);
  });

  it('refuses outright when no kit has a consent basis, without asking', async () => {
    answering('session');
    await expect(host.ensureKits('analysis-kinship', [uncle], 'compare')).rejects.toThrow(/No consent is recorded/);
    expect(asked).toHaveLength(0);
  });

  it('refuses a plugin that never declared it reads more than one kit', async () => {
    answering('session');
    await expect(host.ensureKits('analysis-haplogroups', [me, mother], 'compare')).rejects.toThrow(/more than one kit/);
    expect(asked).toHaveLength(0);
  });

  it('asks once, then remembers', async () => {
    answering('session');
    await host.ensureKits('analysis-kinship', [me, mother], 'compare');
    await host.ensureKits('analysis-kinship', [me, mother], 'compare');
    expect(asked).toHaveLength(1);
  });

  it('asks again only about the kit it has no grant for', async () => {
    answering('session');
    await host.ensureKits('analysis-kinship', [me], 'compare');
    await host.ensureKits('analysis-kinship', [me, mother], 'compare');
    expect((asked[1] as { kits: KitSubject[] }).kits.map((k) => k.kitId)).toEqual(['b']);
  });

  it('forgets a session grant on revoke', async () => {
    answering('session');
    await host.ensureKits('analysis-kinship', [me], 'compare');
    const grant = host.grants().find((g) => g.kits?.includes('a'))!;
    await host.revoke(grant.id);
    expect(host.hasKitGrant('analysis-kinship', 'a')).toBe(false);
  });

  it('refuses a plugin built against a host API this host does not implement', () => {
    expect(() => host.register({ ...kinship, id: 'future', hostApi: '^9.0' })).toThrow(/host API/);
  });
});
