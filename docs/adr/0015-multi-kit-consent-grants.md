# ADR-0015: Consent grants that name the people whose DNA is read

- **Status:** Accepted (2026-09-20)
- **Reversal cost:** Medium (grants are persisted; removing the check would widen access silently)
- **Relates to:** ADR-0006 (plugin contract), ADR-0009 (custody and consent), ADR-0010 (analysis plugins)

## Context

Until v0.3 the workbench only ever read one person's DNA: the custodian's own. Consent was therefore a formality — `Kit.custody.consentBasis` was recorded at import and inspected in four lines of app glue before the haplogroups analysis ran (`apps/web/src/lib/lineages.ts`).

The SDK had always described more. `Grant.kits`, `Grant.regions`, `Grant.trackKinds` and `PluginManifest.permissions.multiKit` were declared in iteration 1 and **never written or read**: every grant ever constructed set only `networkHosts`, and the only predicate was `hasNetworkGrant`. The types described an intention nothing enforced.

Kinship (ADR-0010) is the first analysis that reads a second person, and that person is usually not present when the button is pressed. The design system already specified what this must look like (`docs/…/Genotype Workbench UI.dc.html` section 04): a grant "lists the actual kits and their subjects, never a category like 'your data'", because "a person consenting on behalf of a relative should be able to read the sentence aloud to them."

## Decision

- **`PluginHost.ensureKits(pluginId, kits, purpose)`** joins `ensureNetwork` as the host's second gate, with the same three steps: return if already granted, refuse unless the manifest declares the capability (`permissions.multiKit`), then ask the user. It returns the kit ids the plugin may read.
- **A kit whose custody record has no consent basis is never granted**, whatever the user answers. Consent to read someone's DNA is recorded against the kit, not clicked past in a dialog. Excluded kits are returned to the caller in `excluded` and named in the dialog, so nothing is dropped silently.
- **Kit grants are session-scoped.** The dialog offers Deny and *Grant for this session* only. A standing permission to read another person's genome is not something to grant by default.
- **Consent may be recorded after import**, through `GenotypeStore.recordConsent`. It appends: the previous basis is kept in `Custody.history`, so the record still says what was true before and when it changed. A kit's calls remain immutable.
- **One consent check, not one per analysis.** `consentBlock(kit)` in the app decides whether to *ask*; the host decides whether to *allow*. Haplogroups and kinship share both.
- **`HOST_API_VERSION` is enforced.** `register()` refuses a manifest asking for a host API this host does not implement, rather than displaying an unchecked compatibility range.

## Consequences

- Any future analysis reading more than one kit declares `multiKit` and calls `ensureKits`. Adding one cannot accidentally skip consent, because the host refuses first.
- `Grant.regions` and `Grant.trackKinds` remain declared and unenforced. They become real when a third-party view exists to scope; until then they are honest intent, not a claim.
- A kit imported with no consent basis is now genuinely useful rather than inert: it is readable, viewable and deletable, and only analysis is blocked, with a route to unblocking it that records how consent was given.
