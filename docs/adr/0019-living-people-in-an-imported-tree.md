# ADR-0019: Living people in an imported tree, and why export waits

- **Status:** Accepted (2026-09-21)
- **Reversal cost:** **Medium.** The three living-states must exist in the model from the first import; adding the concept later would touch storage, display and every future way out at once. Deferring export is cheap to reverse.
- **Relates to:** ADR-0007 (no remote lookups), ADR-0009 (custody and consent), ADR-0015 (grants that name people)
- **Full analysis:** [Trade-off analyses](../Trade-off%20analyses.md#b--living-people-in-an-imported-tree)

## Context

Every kit so far belonged to someone who consented, or was refused analysis for want of a record (ADR-0009, ADR-0015). A family tree is different: a GEDCOM with a few hundred people carries names, birth dates and places for relatives who may be alive and who consented to nothing. That data is *directly identifying* in a way a genotype often is not.

GEDCOM offers no reliable help. There is **no living flag**. `RESN` exists (`CONFIDENTIAL`, `LOCKED`, `PRIVACY`) but is optional and mostly unused. Every tool guesses; the common convention is to assume living unless there is a death date or a birth beyond about 110 years.

The tempting answer is that local-first already solves it — the file is on the person's disk either way, and the app uploads nothing. That reasoning fails as soon as the data has an exit, and an Export GEDCOM button is an exit.

## Decision

- **Import marks three states, not two**, because a binary would state a claim the file never made:
  - **probably living** — no death date, and a birth within about 110 years
  - **probably dead** — a death date, or a birth well beyond that
  - **not enough dates to say** — its own state, drawn as a gap

  Most distant ancestors fall in the third. Calling them dead because the file is silent would be the same mistake as reading a no-call as a reference base, and the design system already has the answer: *a gap is drawn, not hidden*.

- **The default is living.** The two errors are not symmetric: treating a dead person as living is a small inconvenience, and treating a living person as dead is the failure that matters.

- **`RESN` is honoured** where present. It is the file's author saying something about their own relatives, and ignoring it would be both rude and unsafe.

- **Nothing about living people is hidden from the person who imported the tree.** Genealogy is about living relatives; redacting them locally would destroy the use case and push people to tools that take more risk with the same data.

- **The import says plainly what a tree contains** — that these are other people's records, that they stay on this device, and how many of them are probably living.

- **Export is deferred, and when it arrives, redaction of living people by default is a precondition of shipping it.** Recorded here so it cannot be forgotten by whoever builds it.

## Consequences

- With no export, the tree has no exit, and the local-first posture is the whole mitigation rather than half of it. That is the reason this ADR is short where the analysis behind it is long.
- Portability is deliberately unsolved rather than solved badly. The direction is an interface for agents — MCP or similar — rather than a matrix of per-format exporters. A single audited way out is easier to reason about, and easier to make redact by default, than a growing set of file writers. Adding GEDCOM export later remains cheap.
- **Legal posture, recorded rather than claimed:** the software runs entirely on the person's own device and processes nothing on anyone's behalf, so the person importing a tree is the only party deciding what happens to it. That is a description of the architecture, not legal advice, and it is not a substitute for one. It sits beside the open IVDR question in the docs.
- Because nothing leaves, the protection now rests entirely on what the device itself guarantees. That is a narrower base than it sounds, and it is the subject of a separate review of storage, isolation and encryption.
