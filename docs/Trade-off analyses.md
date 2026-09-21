# Trade-off analyses

Long-form reasoning behind decisions that were not obvious. The ADRs in [`adr/`](adr/) record what was decided and why in a paragraph; this records the options that lost, the criteria set before the options, and what would have to be true for the decision to be wrong.

Kept because a decision without its rejected alternatives is not reviewable: a reader in a year can see *what* we chose but not whether we considered the thing they are about to propose.

Structure follows a composite of ATAM (naming sensitivity and trade-off points), Kepner-Tregoe (musts screen before wants), Value-Focused Thinking (criteria before options), premortem and ACH (seeking disconfirmation rather than support), and Y-statements for the decision itself.

---

## A — What a confirmed kinship estimate records

**Decided 2026-09-21 · [ADR-0018](adr/0018-what-a-confirmed-kinship-estimate-records.md)**

### Frame

Kinship reports `2,648 cM · φ 0.227 · [full sibling]`. The person says "yes, that is my sister Rachel". What does Pedigree store?

Decision type: executive and property (Kruchten). Cynefin: **complicated** — there is a right answer reachable by analysis.

**Reversibility is where this is easy to misjudge.** The schema is a two-way door; storage can be migrated. But evidence not captured at confirmation is unrecoverable, because kits are deletable, consent is revocable and packs are updated. Recording "sibling" today and wanting the centimorgans in 2028 means wanting something that no longer exists. Treated as effectively one-way.

### Criteria, fixed before options were generated

| # | Criterion | Type |
|---|---|---|
| C1 | A stored claim must not silently become false over time | must |
| C2 | Pedigree never reads genotype data (`Core architecture.md:123`) | must |
| C3 | Survives deletion of the kits that produced it | must |
| C4 | A future reader can see why the claim was made | want, high |
| C5 | Distinguishes what the DNA said from what the human asserted | want, high |
| C6 | Implementation cost | want, low |

### Options and screening

| | Option | C1 | C2 | C3 | C4 | C5 |
|---|---|---|---|---|---|---|
| A1 | Relationship only | ✗ | ✓ | ✓ | ✗ | ✗ |
| A2 | Relationship plus a live reference, recomputed on demand | ✓ | **✗** | **✗** | ✓ | ✗ |
| A3 | Relationship plus a frozen evidence snapshot | ✓ | ✓ | ✓ | ✓ | partial |
| A4 | A3 plus a separable human assertion and a re-proposal path | ✓ | ✓ | ✓ | ✓ | ✓ |

**A2 fails two musts** and was eliminated at screening: displaying a relationship would require Pedigree to read genotype data, and the record would evaporate when a kit was deleted or a grant revoked.

**A1 fails C1**, which is the crux. Three documents insist an estimate is a range and never a fact (`Scientific domains.md:128`, ADR-0010, and the mockup's dashed-edge rule). Storing only "sibling" converts the estimate into a fact at the moment of writing.

### The finding that decided it

**The candidate list is part of the claim, and dropping it destroys the warrant.**

Kinship outputs a list, not a relationship:

- 2,648 cM at 1.52% opposite homozygotes → `[full sibling]`. One candidate: the DNA discriminated.
- 1,750 cM at 2.0% → `[half sibling, grandparent or grandchild, aunt or uncle]`. Three candidates: **the DNA discriminated nothing.**

In the second case the choice came from somewhere the DNA cannot see. A record reading `half sibling · genetic-estimate` tells a later reader the DNA said "half sibling". It said "second degree", and a person picked one of three.

This is why a confirmation and an estimate are two claims of two evidence kinds — `documentary` and `probabilistic-estimate` — which is exactly why `Core architecture.md:123` already offers `both`. The application has a six-kind evidence model; a relationship should use it rather than collapse to one label.

### Premortem — it is 2028 and the pedigree is embarrassing

| Failure | Prevented by |
|---|---|
| The kit was deleted; nothing supports the claim | the frozen snapshot |
| A better genetic map changed the number | re-proposal, not silent recomputation |
| The DNA never distinguished sibling from half-sibling, and the record lost that | **the candidate list as offered** |
| Endogamy inflated the total and the caveat is gone | the notes stored with the snapshot |
| No way to see who confirmed it, or when | the documentary evidence record |

### ACH — the hypothesis tested for disconfirmation

*"The snapshot is over-engineering; nobody will look at it."*

**Strongly disconfirmed.** Every annotation in the product already carries source, pack version and licence; ClinVar shows its review status and VCV identifier. A relationship with no citation would be the least-sourced claim in the application, and the only one the user wrote themselves.

### Decision

> In the context of confirming a kinship estimate into the pedigree, facing the fact that uncaptured evidence is unrecoverable once kits are deleted, we chose **to record a frozen evidence snapshot including the candidate list as offered, kept separable from the human's assertion**, to achieve a pedigree whose claims can be audited as well as every pack annotation already can, accepting **more storage per relationship and a re-proposal flow instead of automatic updating**.

**Sensitivity point** (ATAM): this affects auditability almost alone. Low risk of side effects; the cost of getting it wrong is silent and delayed.

**Accepted downside:** roughly a kilobyte of JSON per relationship, and a confirmation flow that must show the candidate list rather than a single answer.

---

## B — Living people in an imported tree

**Decided 2026-09-21 · [ADR-0019](adr/0019-living-people-in-an-imported-tree.md)**

### Frame

A GEDCOM holds a few hundred people. Some are alive. None consented. What does import do?

Decision type: executive, with ethical and legal weight. Cynefin: **complex** — it turns on norms and law, not only structure. Closer to a one-way door than A, because a model with no concept of "living" would need retrofitting across storage, display and every exit at once.

### Criteria, fixed before options were generated

| # | Criterion | Type |
|---|---|---|
| C1 | Does not obstruct the use case — genealogy is largely about living relatives | must |
| C2 | The interface tells the truth about whose data this is | must |
| C3 | Handles the asymmetry: a false "dead" is harmful, a false "living" is not | must |
| C4 | Nothing about a living person leaves the device unintentionally | want, high |
| C5 | A defensible posture | want, high |
| C6 | Cost | want, low |

### Options and screening

| | Option | C1 | C2 | C4 |
|---|---|---|---|---|
| B1 | Nothing; import and display everything, rely on local-first | ✓ | ✗ | ✗ |
| B2 | Mark probably-living, say what a tree contains, restrict nothing | ✓ | ✓ | partial |
| B3 | Mark, and redact details behind a reveal | **✗** | ✓ | ✓ |
| B4 | Mark, and refuse to import living people | **✗✗** | ✓ | ✓ |
| B5 | B2, with export as the gate: redact living people by default on any way out | ✓ | ✓ | ✓ |

**B3 and B4 fail C1.** Genealogy cannot be done with living relatives hidden or absent. B4 in particular would push a person to a tool that takes *more* risk with the same data — worse for privacy, not better, which is the trap in most privacy-by-restriction designs.

### Where the methods disagreed, and why that produced the answer

**QOC said B2.** Cheap, honest, sufficient: the file is already on the disk, and importing it into an application that uploads nothing barely changes exposure.

**ACH asked whether that had anchored on "local-first solves it"** and disconfirmed it with two facts from this repository: the mockup has an **Export GEDCOM** button, and the project publishes screenshots to a public README.

So local-first does not solve it, because the data has exits. **The hazard is not holding the data; it is the data leaving.** Under ALARP that settles the shape: further restriction at import is grossly disproportionate, because it destroys the use case, while restriction at the exit is cheap and aimed at the actual hazard.

**Trade-off point** (ATAM): privacy and usefulness pull in opposite directions at *import* and barely interact at *export*. Naming which one we were at dissolved most of the problem.

### Outcome, after the export decision

Export was then deferred — there is no portability strategy yet, and the preferred direction is an interface for agents rather than a matrix of per-format exporters, with GEDCOM export remaining cheap to add later.

That removes the exit, so B5's gate has nothing to gate today. What survives and was built:

- the three living-states, because the model must carry the concept from the first import
- `RESN` honoured
- the import saying plainly what a tree contains
- **the gate recorded as a precondition on export**, so that whoever adds it inherits the requirement rather than rediscovering it

### Key assumptions and their falsifiers

| Assumption | Confidence | Falsifier |
|---|---|---|
| A local-only tool leaves the person importing as the only decision-maker | moderate — described, not adjudicated | any feature that shares or publishes |
| People will eventually want to export trees | high | — |
| About 110 years is an acceptable living threshold | high, by convention | a living 112-year-old relative |
| Marking living people will not feel obstructive | moderate | user testing |

### Decision

> In the context of importing a family tree containing people who never consented, facing the fact that a local-first posture only holds while the data has no exit, we chose **to mark three living-states at import, honour `RESN`, say plainly what a tree contains, and defer export with redaction recorded as a precondition on it**, to achieve full genealogical usefulness with the hazard controlled where it actually is, accepting **a heuristic that will sometimes be wrong in the harmless direction, and a protection model that now rests entirely on what the device guarantees**.

**Accepted downside, and what it triggered:** with no exit, the whole mitigation is local-first. That is a narrower base than it sounds — it assumes the device, the browser profile and the origin's storage are trustworthy — and it is why a separate review of storage, isolation and encryption follows.
