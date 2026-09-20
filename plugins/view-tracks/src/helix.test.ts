import { describe, expect, it } from 'vitest';
import {
  B_DNA,
  grooveSpanBp,
  lengthOf,
  strandOffsetDeg,
  strandPoint,
  turnsIn,
  twistPerBp,
} from './helix';

describe('B-form geometry', () => {
  it('turns once every 10.5 base pairs', () => {
    expect(twistPerBp()).toBeCloseTo(34.2857, 3);
    expect(turnsIn(21)).toBeCloseTo(2, 10);
  });

  it('comes back to the same place after a full turn', () => {
    const start = strandPoint(1000, 0);
    const later = strandPoint(1000 + B_DNA.perTurn, 0);
    expect(later.across).toBeCloseTo(start.across, 10);
    expect(later.depth).toBeCloseTo(start.depth, 10);
  });

  it('is half a turn out of phase at half a turn', () => {
    const a = strandPoint(0, 0);
    const b = strandPoint(B_DNA.perTurn / 2, 0);
    expect(b.across).toBeCloseTo(-a.across, 10);
  });

  it('keeps each backbone on the helix surface', () => {
    for (const bp of [0, 3, 7.5, 1234]) {
      for (const strand of [0, 1] as const) {
        const p = strandPoint(bp, strand);
        expect(Math.hypot(p.across, p.depth)).toBeCloseTo(1, 10);
      }
    }
  });

  it('separates the strands by less than half a turn, which is what makes the grooves unequal', () => {
    // 180° would give two identical grooves, and a helix that reads as a ladder.
    expect(strandOffsetDeg()).toBeGreaterThan(90);
    expect(strandOffsetDeg()).toBeLessThan(180);
  });

  it('draws the two grooves in the published 12:22 proportion', () => {
    const { minor, major } = grooveSpanBp();
    expect(minor + major).toBeCloseTo(B_DNA.perTurn, 10);
    expect(minor / major).toBeCloseTo(12 / 22, 6);
  });

  it('measures a stretch the way a textbook does', () => {
    // One turn of B-DNA is about 3.4 nm long.
    expect(lengthOf(B_DNA.perTurn).nm).toBeCloseTo(3.549, 3);
    expect(lengthOf(1000).angstrom).toBeCloseTo(3380, 6);
  });
});
