import { describe, expect, it } from 'vitest';
import { fragments, parseChangelog } from './changelog';

const SAMPLE = `# Changelog

Some preamble that belongs to no release.

## 0.3.0 — 2026-09-20

One line about this release.

### Added

- **Shared DNA.** Two kits compared on this device.
- A second thing with \`code\` in it.

### Fixed

- Something that was wrong.

## 0.1.0 — 2026-09-19

### Added

- The beginning.
`;

describe('parseChangelog', () => {
  const releases = parseChangelog(SAMPLE);

  it('reads a release per version heading, newest first as written', () => {
    expect(releases.map((r) => r.version)).toEqual(['0.3.0', '0.1.0']);
    expect(releases[0]!.date).toBe('2026-09-20');
  });

  it('keeps the line under a heading as the summary, not as an item', () => {
    expect(releases[0]!.summary).toBe('One line about this release.');
    expect(releases[0]!.sections[0]!.items).not.toContain('One line about this release.');
  });

  it('groups items under their section', () => {
    expect(releases[0]!.sections.map((s) => s.title)).toEqual(['Added', 'Fixed']);
    expect(releases[0]!.sections[0]!.items).toHaveLength(2);
    expect(releases[0]!.sections[1]!.items).toEqual(['Something that was wrong.']);
  });

  it('ignores the file title and preamble', () => {
    expect(releases.some((r) => r.summary.includes('preamble'))).toBe(false);
  });

  it('parses the real CHANGELOG.md, and its newest entry is a version', () => {
    const real = parseChangelog();
    expect(real.length).toBeGreaterThan(0);
    expect(real[0]!.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(real[0]!.sections.length).toBeGreaterThan(0);
  });
});

describe('fragments', () => {
  it('marks bold and code, leaving the rest as text', () => {
    expect(fragments('**Shared DNA.** Two kits with `cds_starts`.')).toEqual([
      { text: 'Shared DNA.', style: 'strong' },
      { text: ' Two kits with ', style: 'plain' },
      { text: 'cds_starts', style: 'code' },
      { text: '.', style: 'plain' },
    ]);
  });

  it('leaves plain text alone', () => {
    expect(fragments('nothing special')).toEqual([{ text: 'nothing special', style: 'plain' }]);
  });
});
