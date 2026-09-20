/**
 * B-form DNA geometry, enough to draw it.
 *
 * This is a ribbon model, not an atomic one: two backbones and the base pairs
 * between them. The helical parameters are the published B-form values, so the
 * turn, the handedness and the unequal grooves are real; the atoms are not
 * drawn at all rather than drawn approximately.
 *
 * Sources: Watson & Crick (1953) for the model; the B-form parameters are the
 * standard solution values — 10.5 base pairs per turn, 3.38 Å rise, 20 Å
 * across, with a 12 Å minor and 22 Å major groove.
 */

export interface HelixParams {
  /** Base pairs per full turn. The fibre model gives 10; in solution it is 10.5. */
  perTurn: number;
  /** Rise along the axis per base pair, in ångström. */
  riseA: number;
  /** Across the helix, in ångström. */
  diameterA: number;
  /** Published groove widths, in ångström. Their ratio sets the strand offset. */
  minorGrooveA: number;
  majorGrooveA: number;
}

export const B_DNA: HelixParams = {
  perTurn: 10.5,
  riseA: 3.38,
  diameterA: 20,
  minorGrooveA: 12,
  majorGrooveA: 22,
};

/**
 * The angle between the two backbones around the axis.
 *
 * Not 180°, which is what would make the two grooves equal. It is derived from
 * the published groove widths so the drawing reproduces their proportions:
 * the narrow side spans 12/(12+22) of the way round, the wide side the rest.
 * This is why a drawn helix has a recognisably narrow and a wide groove.
 */
export function strandOffsetDeg(p: HelixParams = B_DNA): number {
  return (360 * p.minorGrooveA) / (p.minorGrooveA + p.majorGrooveA);
}

/** Degrees of turn between one base pair and the next. */
export function twistPerBp(p: HelixParams = B_DNA): number {
  return 360 / p.perTurn;
}

export interface StrandPoint {
  /** Across the helix, -1 at one edge and 1 at the other. */
  across: number;
  /** Toward the viewer, -1 behind the axis and 1 in front of it. */
  depth: number;
}

/**
 * Where a backbone sits at base pair `bp`, as fractions of the radius.
 *
 * `bp` is the absolute genomic position, so the twist belongs to the molecule
 * rather than to the window: panning slides the same helix past, it does not
 * re-wind it.
 */
export function strandPoint(bp: number, strand: 0 | 1, p: HelixParams = B_DNA): StrandPoint {
  const deg = bp * twistPerBp(p) + (strand === 1 ? strandOffsetDeg(p) : 0);
  const theta = (deg * Math.PI) / 180;
  return { across: Math.cos(theta), depth: Math.sin(theta) };
}

/** How many base pairs the narrow and the wide groove each span along the axis. */
export function grooveSpanBp(p: HelixParams = B_DNA): { minor: number; major: number } {
  const minor = (strandOffsetDeg(p) / 360) * p.perTurn;
  return { minor, major: p.perTurn - minor };
}

/** How long a stretch of this many base pairs is, in ångström and nanometres. */
export function lengthOf(bases: number, p: HelixParams = B_DNA): { angstrom: number; nm: number } {
  const angstrom = bases * p.riseA;
  return { angstrom, nm: angstrom / 10 };
}

/** How many full turns a stretch of this many base pairs makes. */
export function turnsIn(bases: number, p: HelixParams = B_DNA): number {
  return bases / p.perTurn;
}
