# Security review — data protection, isolation and zero trust

**First pass, 2026-09-21, at v0.3.3.** A self-review against the code as it stands, not an external audit. Findings are ranked by how much risk they carry, and the recommendations by risk reduced against cost. Where something is already right it is recorded as such, because a review that only lists faults gives no picture of the whole.

Prompted by ADR-0019: deferring export removed the tree's only exit, which means the protection now rests entirely on what the device guarantees. That is a narrower base than it sounds, and this review is the check on it.

---

## 1. What is being protected

| Asset | Where it lives | Sensitivity |
| --- | --- | --- |
| Raw genotypes | `kits/<uuid>.parquet` in OPFS | Special category data under GDPR; identifying for life, and partly for relatives who never consented |
| Custody records — **names of relatives**, consent notes | `meta/kits.json` in OPFS, **plaintext JSON** | Directly identifying |
| Pedigree (from v0.4) | OPFS | Names, dates and places of living third parties |
| Grants | `meta/grants.json` | Reveals which hosts and kits were allowed |
| Installed packs | `packs/*.parquet` | Public reference data; not sensitive |

Two things are easy to miss. The custody record holds **names in plaintext right next to the genotypes** — the genome alone is a long number, but the file beside it says whose it is. And a genome is never only about one person: it carries information about parents, siblings and children who were never asked.

---

## 2. Threat model

Ranked by realistic likelihood × impact, with an honest verdict on each.

| # | Adversary or scenario | Verdict |
| --- | --- | --- |
| T1 | **Someone holding the disk** — theft, resale, a cloud backup, Time Machine, a forensic image, a shared family computer | ⛔ **Not mitigated.** OPFS is plaintext |
| T2 | **Another local process running as the same user** — any app, any script, any malware with the user's privileges | ⛔ **Not mitigated** |
| T3 | **A compromised build dependency** shipping code into the bundle | ⚠️ Partly mitigated |
| T4 | **XSS on the app's own origin** | ✅ Narrow exfiltration path; strong CSP |
| T5 | **Another website** trying to read this data | ✅ Origin isolation; genuinely strong |
| T6 | **A network observer** watching what is fetched | ⚠️ One real metadata leak, disclosed |
| T7 | **A malicious pack** | ✅ Signed index, SHA-256 verified before install |
| T8 | **A malicious plugin** | ⚠️ No isolation, but all plugins are first-party today |
| T9 | **A second origin on the same host** reading our OPFS | ⚠️ Deployment-dependent — see §5.4 |

---

## 3. What holds today

This is not a weak posture, and the strong parts should not be lost while fixing the weak ones.

- **Nothing is uploaded.** Every network call goes through `PluginHost.fetch`, which refuses any host without a grant, sends `credentials: 'omit'` and `referrerPolicy: 'no-referrer'`. There are exactly four fetch sites in the codebase, all of them either the same-origin pack index or a granted host. An end-to-end test asserts a full user journey makes **no off-origin request at all**.
- **The CSP is tight and is a real boundary, not decoration.** `default-src 'self'`, `connect-src 'self' https://alphafold.ebi.ac.uk`, `img-src 'self' data:`, `object-src 'none'`, `base-uri 'none'`. Even with script execution on the origin, the exfiltration channels are narrow: no remote image, font, frame or connection target exists to smuggle data to.
- **Reference data is verified before it is trusted.** The pack index is Ed25519-signed, every pack's SHA-256 is checked against it before install, and a mismatch discards the download rather than warning about it.
- **The DuckDB extension is vendored and hash-pinned**, with autoloading disabled — the query engine cannot be talked into fetching code at runtime.
- **Consent is enforced by the host, not by the caller.** A kit with no consent basis is never granted, whatever a dialog is answered (ADR-0015), and a plugin asking for a host it never declared is refused before the user is even asked.
- **Install-time telemetry is refused** (`@scarf/scarf`, denied in `pnpm-workspace.yaml`), and dependencies are held back by a minimum release age.
- **Joins are local by construction.** Whole packs are downloaded and joined on the device, so which variants a person carries is never the subject of a query to anyone (ADR-0007).

---

## 4. What does not hold

### 4.1 Data at rest is plaintext — **highest risk**

OPFS isolates by *origin*. It does not encrypt. The isolation is against other websites, not against anyone with the disk, a backup, or another process running as the same user.

Concretely: a stolen laptop, a synced backup, or a second account on a family machine yields `kits/<uuid>.parquet`, which any copy of DuckDB opens in one line — plus `meta/kits.json` naming whose genome each one is.

The only thing standing between that and disclosure today is **whatever full-disk encryption the operating system happens to be doing**, which the app neither checks nor mentions.

### 4.2 The Pedigree ↔ Genotype boundary is a convention, not a mechanism

`Core architecture.md:123` says Pedigree never reads genotype data, and ADR-0018 leans on it. Today that is upheld by discipline: nothing prevents a future function in the wrong package from reading `kit_*` views, because everything shares one storage adapter and one DuckDB instance.

Under a zero-trust reading, an invariant that matters this much should be enforced rather than agreed.

### 4.3 Plugins run with full privilege

ADR-0006 deferred sandboxed iframes until third-party plugins exist, which was right then. But `analysis-kinship` now reads two people's genomes in full, and `view-structure` is the one component that talks to the network. They are trusted because we wrote them, not because anything constrains them.

### 4.4 The AlphaFold request leaks interest, not data

Fetching a structure tells `alphafold.ebi.ac.uk` which protein is being looked at — which implies a gene, which may imply why. This is **already disclosed** in the plugin manifest ("tells AlphaFold which protein you are looking at") and gated behind a named grant, which is the right handling. It is recorded here because it is the single place where anything about the person's attention leaves the machine, and any future host must clear the same bar.

### 4.5 Build-time supply chain is the widest unguarded surface

Mol\* alone is a large tree, and everything in it is bundled with full access to the origin — meaning full access to OPFS. The controls in place (lockfile, minimum release age, denied install scripts) reduce the chance of a *sudden* compromise; none of them would stop a patient one.

---

## 5. Zero trust, translated for a local-first application

The usual model assumes a network perimeter to abolish. There is no network here, so the principles have to be re-derived rather than adopted.

| Principle | Translation | Status |
| --- | --- | --- |
| Verify explicitly | Everything loaded is checked: signed packs, pinned extensions, declared host API, locked dependencies | ✅ largely done |
| Least privilege | Grants name the host and the kits; nothing is implicit | ✅ for network and kits · ⛔ for plugins |
| Assume breach | If the origin is compromised, what is reachable? | ⚠️ everything in OPFS, though little can leave |
| Assume breach | If the **disk** is taken, what is readable? | ⛔ **everything, in the clear** |
| Micro-segmentation | Contexts cannot read each other's data | ⚠️ convention, not mechanism (§4.2) |
| No implicit trust in transport | Nothing is trusted because it arrived over HTTPS; content is verified | ✅ signature and hash checked |

The honest summary: **verification is strong, confinement is strong, and containment after a device-level compromise is absent.**

---

## 6. Encryption at rest — the real options

### What is technically possible

DuckDB has supported Parquet encryption since 0.10 (AES-GCM, keys registered in-session with `PRAGMA add_parquet_key`, keys held in memory) and the implementation compiles for duckdb-wasm. The published cost is roughly **2.5× read and 2.2× write** — for this app, an import moving from ~2 s to ~5 s, and Explore queries from ~4 s to perhaps ~10 s. Noticeable, not disqualifying.

### The real problem is the key, not the cipher

| Key source | Protects against a stolen disk? | Cost |
| --- | --- | --- |
| Stored in IndexedDB or OPFS beside the data | **No.** The key sits next to the ciphertext | Low — and it is security theatre |
| Derived from a passphrase the user types | **Yes** | A passphrase per session; forgetting it costs the kits |
| Derived from a passkey via the **WebAuthn PRF extension** | **Yes**, and hardware-backed | Browser support is uneven, especially Safari with roaming authenticators |
| Left to the operating system (FileVault, BitLocker) | **Yes, if enabled** — and the app has no idea whether it is | Zero |

A key stored beside the data is worth stating plainly: it defeats nothing that matters and would let the interface claim a protection it does not provide. That is worse than no encryption, because the claim is false.

### The thing that makes this app unusual

**The data is reconstructible.** The README already tells people their original raw file is the source of truth. A forgotten passphrase or a lost passkey therefore costs a re-import, not a genome — which is a far weaker consequence than for a password vault, where key loss is terminal.

That materially changes the calculus. This application can afford aggressive encryption that other applications cannot.

---

## 7. Recommendations, ranked

| # | Recommendation | Risk reduced | Cost |
| --- | --- | --- | --- |
| R1 | **Say what is true today.** State plainly that kits are stored unencrypted and that the protection at rest is the operating system's disk encryption. Until R2 exists, this is the difference between a known limit and a false impression | High — it is the honesty gap, not just the security gap | Very low |
| R2 | **Optional passphrase encryption** of kit Parquet and `meta/kits.json`, via DuckDB Parquet encryption plus Web Crypto key derivation. Optional because a locked workbench is useless to someone who only wants to look at their own chip on their own encrypted laptop | High — closes T1 and T2 | Medium |
| R3 | **Encrypt `meta/kits.json` whenever kits are encrypted.** The names must not be the part left in the clear | High per unit of effort — it is small and identifying | Low |
| R4 | **Enforce the Pedigree ↔ Genotype boundary** rather than documenting it: separate storage namespaces, or a capability the Pedigree context simply does not hold | Medium — protects an invariant two ADRs now depend on | Medium |
| R5 | **Investigate WebAuthn PRF** as a second key source, with a passphrase fallback. Touch-to-unlock is the UX that makes R2 tolerable | Medium | Medium, and support is uneven |
| R6 | **Fix the deployment origin question** before publishing (§5.4 below) | Potentially high, depending on where it is hosted | Low if decided early |
| R7 | **Revisit plugin isolation** now that a plugin reads two people's genomes in full | Medium, rising as third-party plugins approach | High |

### 5.4 · Deployment origin — decide before publishing

OPFS is scoped to an **origin**, not a path. Hosting the app at `username.github.io/genotype-workbench` puts it on the origin `https://username.github.io`, **shared with every other project that account publishes**. Another page on that origin could read this application's OPFS — every kit, every custody record.

A dedicated domain, or a subdomain used for nothing else, is the only configuration in which the origin isolation described in §3 actually means what it says. This is cheap to decide now and expensive to undo after people have stored data under the wrong origin.

---

## 8. Open questions

- **Does an optional passphrase belong in v0.4, or before it?** Pedigree adds living third parties' names to the same unencrypted store, which raises what §4.1 costs.
- **Does encryption change the custody model?** A kit encrypted under a passphrase only its custodian knows is a stronger claim about consent than a checkbox.
- **What is the threat model for a shared family machine?** Several people, one OS account, several kits — a plausible setup for this application specifically, and the one where T2 bites hardest.
- **Should the app detect and report OS disk encryption?** It cannot, from a browser. So R1 has to be worded as a question to the reader rather than a status, which is weaker than it sounds.

---

## Sources

[DuckDB Parquet encryption](https://duckdb.org/docs/lts/data/parquet/encryption) · [Parquet encryption PR, with the WASM note](https://github.com/duckdb/duckdb/pull/9392) · [OPFS on MDN](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system) · [WebAuthn PRF developer guide (Yubico)](https://developers.yubico.com/WebAuthn/Concepts/PRF_Extension/Developers_Guide_to_PRF.html) · [PRF for end-to-end encryption (Bitwarden)](https://bitwarden.com/blog/prf-webauthn-and-its-role-in-passkeys/) · [A caution on deriving keys from PRF](https://lilting.ch/en/articles/passkeys-prf-extension-encryption-risk)
