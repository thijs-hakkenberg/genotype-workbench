//! Anticorruption layer for consumer genotype files (Decisions B2).
//!
//! A [`FormatProfile`] describes a vendor's text format as data. This crate
//! reads a file through a profile into [`RawCall`] rows and passes every row
//! through [`locus::normalize`]; no vendor-specific code runs.

use locus::{normalize, Call, Genotype, RawCall, RefCheck, ReferenceIndex};
use serde::Deserialize;
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatProfile {
    pub id: String,
    pub version: String,
    pub vendor: String,
    pub vendor_label: String,
    pub build: String,
    pub delimiter: String,
    pub comment_prefix: String,
    /// First field of a non-comment header row to skip, if the format has one.
    #[serde(default)]
    pub header_row: Option<String>,
    pub columns: Columns,
    pub no_call_token: String,
    pub strand: String,
    pub detect: Detect,
    /// Why GRCh37 may be assumed for a vendor that never states a build in the
    /// file. Absent means the header must say it; the import is refused if it
    /// does not. When set, the reason is carried into the kit so the UI can
    /// show on whose word the positions are trusted.
    #[serde(default)]
    pub build_basis: Option<String>,
    #[serde(default)]
    pub chip_versions: Vec<ChipVersion>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Columns {
    pub rsid: usize,
    pub chrom: usize,
    pub pos: usize,
    pub genotype: Vec<usize>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Detect {
    pub header_contains: Vec<String>,
    pub build_markers: Vec<String>,
    #[serde(default)]
    pub reject_markers: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChipVersion {
    pub id: String,
    pub min_rows: usize,
    pub max_rows: usize,
    pub label: String,
}

impl FormatProfile {
    pub fn from_json(json: &str) -> Result<FormatProfile, ImportError> {
        serde_json::from_str(json).map_err(|e| ImportError::Profile(e.to_string()))
    }

    /// Does this file's comment header look like this vendor's format?
    pub fn matches(&self, header: &str) -> bool {
        self.detect.header_contains.iter().any(|m| header.contains(m.as_str()))
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ImportError {
    #[error("format profile is invalid: {0}")]
    Profile(String),
    #[error("the file is not UTF-8 text")]
    NotText,
    #[error("the file does not look like a {0} raw data file")]
    WrongVendor(String),
    #[error("the file is on {0}; only GRCh37 (build 37) files can be imported")]
    WrongBuild(String),
    #[error("the file header does not state build 37, so positions cannot be trusted")]
    BuildNotStated,
    #[error("no calls could be read from the file")]
    Empty,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rejected {
    pub line: usize,
    pub reason: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ImportStats {
    pub rows_read: usize,
    pub calls: usize,
    pub no_calls: usize,
    pub strand_ambiguous: usize,
    pub rejected: usize,
    pub duplicates_merged: usize,
    pub duplicate_conflicts: usize,
    /// Count per [`RefCheck`], indexed by `RefCheck::code()`.
    pub ref_checks: [usize; 7],
}

#[derive(Debug, Clone)]
pub struct KitMeta {
    pub vendor: String,
    pub vendor_label: String,
    pub importer: String,
    pub chip_version: Option<String>,
    pub chip_label: Option<String>,
    /// How the chip version was determined, for display next to it.
    pub chip_basis: String,
    pub build: String,
    /// How the build was established: stated by the file, or assumed on the
    /// profile's stated grounds.
    pub build_basis: String,
    pub source_sha256: String,
    pub locus_version: String,
}

pub struct ImportOutput {
    pub meta: KitMeta,
    /// Sorted by (chrom code, pos), one call per locus.
    pub calls: Vec<Call>,
    pub stats: ImportStats,
    /// The first rejected rows, for the import report.
    pub rejected_examples: Vec<Rejected>,
}

const MAX_REJECTED_EXAMPLES: usize = 50;

/// Pick the profile whose detection markers match the file header.
pub fn detect<'a>(bytes: &[u8], profiles: &'a [FormatProfile]) -> Option<&'a FormatProfile> {
    let header = comment_header(bytes, 200);
    profiles.iter().find(|p| p.matches(&header))
}

/// The comment banner, plus the first row after it.
///
/// FamilyTreeDNA ships no comment lines at all, so a format that identifies
/// itself only by its column names still has to be recognisable.
fn comment_header(bytes: &[u8], max_lines: usize) -> String {
    let head = &bytes[..bytes.len().min(64 * 1024)];
    let text = String::from_utf8_lossy(head);
    let mut out: Vec<&str> = Vec::new();
    for line in text.lines().take(max_lines) {
        if line.trim().is_empty() {
            continue;
        }
        out.push(line);
        if !line.starts_with('#') {
            break;
        }
    }
    out.join("\n")
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// One field's value: surrounding whitespace off, and the quotes some vendors
/// wrap every column in (MyHeritage, FamilyTreeDNA) off with it.
///
/// Not a CSV parser: a quoted field containing the delimiter would already
/// have been split, and no consumer chip format puts one there. A profile that
/// needs that has outgrown this engine and should say so rather than guess.
fn field(raw: &str) -> &str {
    let s = raw.trim();
    match (s.strip_prefix('"'), s.strip_suffix('"')) {
        (Some(_), Some(_)) if s.len() >= 2 => &s[1..s.len() - 1],
        _ => s,
    }
}

/// Read a whole file through a profile and normalize every row.
///
/// `progress` is called with the number of rows read so far, every
/// `progress_every` rows.
pub fn import(
    bytes: &[u8],
    profile: &FormatProfile,
    reference: &dyn ReferenceIndex,
    progress_every: usize,
    progress: &mut dyn FnMut(usize),
) -> Result<ImportOutput, ImportError> {
    let text = std::str::from_utf8(bytes).map_err(|_| ImportError::NotText)?;
    let header = comment_header(bytes, 200);

    if !profile.matches(&header) {
        return Err(ImportError::WrongVendor(profile.vendor_label.clone()));
    }
    if let Some(m) = profile.detect.reject_markers.iter().find(|m| header.contains(m.as_str())) {
        return Err(ImportError::WrongBuild(m.clone()));
    }
    let states_build = profile.detect.build_markers.iter().any(|m| header.contains(m.as_str()));
    if !states_build && profile.build_basis.is_none() {
        return Err(ImportError::BuildNotStated);
    }

    let delim = profile.delimiter.chars().next().unwrap_or('\t');
    let cols = &profile.columns;
    let max_col = [cols.rsid, cols.chrom, cols.pos]
        .into_iter()
        .chain(cols.genotype.iter().copied())
        .max()
        .unwrap_or(0);

    let mut stats = ImportStats::default();
    let mut rejected_examples = Vec::new();
    let mut calls: Vec<Call> = Vec::with_capacity(text.len() / 24);
    let mut reject = |stats: &mut ImportStats, line: usize, reason: String| {
        stats.rejected += 1;
        if rejected_examples.len() < MAX_REJECTED_EXAMPLES {
            rejected_examples.push(Rejected { line, reason });
        }
    };

    let mut genotype_buf = String::with_capacity(4);
    for (idx, line) in text.lines().enumerate() {
        let line_no = idx + 1;
        let line = line.trim_end_matches('\r');
        if line.is_empty() || line.starts_with(profile.comment_prefix.as_str()) {
            continue;
        }
        let fields: Vec<&str> = line.split(delim).collect();
        if let Some(h) = &profile.header_row {
            if fields.first().is_some_and(|f| field(f).eq_ignore_ascii_case(h)) {
                continue;
            }
        }
        stats.rows_read += 1;
        if progress_every > 0 && stats.rows_read % progress_every == 0 {
            progress(stats.rows_read);
        }
        if fields.len() <= max_col {
            reject(&mut stats, line_no, format!("expected {} columns, found {}", max_col + 1, fields.len()));
            continue;
        }
        let Ok(pos) = field(fields[cols.pos]).parse::<u64>() else {
            reject(&mut stats, line_no, format!("position '{}' is not a number", fields[cols.pos]));
            continue;
        };
        genotype_buf.clear();
        for &g in &cols.genotype {
            genotype_buf.push_str(field(fields[g]));
        }
        let raw = RawCall {
            rsid: field(fields[cols.rsid]).to_string(),
            chrom: field(fields[cols.chrom]).to_string(),
            pos,
            genotype: genotype_buf.clone(),
        };
        match normalize(&raw, reference) {
            Ok(call) => calls.push(call),
            Err(e) => reject(&mut stats, line_no, e.to_string()),
        }
    }
    progress(stats.rows_read);

    if calls.is_empty() {
        return Err(ImportError::Empty);
    }

    let calls = dedupe(calls, &mut stats);
    for c in &calls {
        stats.calls += 1;
        if c.is_nocall() {
            stats.no_calls += 1;
        }
        if c.strand_ambiguous {
            stats.strand_ambiguous += 1;
        }
        stats.ref_checks[c.ref_check.code() as usize] += 1;
    }

    let chip = profile
        .chip_versions
        .iter()
        .find(|v| stats.rows_read >= v.min_rows && stats.rows_read < v.max_rows);

    Ok(ImportOutput {
        meta: KitMeta {
            vendor: profile.vendor.clone(),
            vendor_label: profile.vendor_label.clone(),
            importer: format!("{}@{}", profile.id, profile.version),
            chip_version: chip.map(|c| c.id.clone()),
            chip_label: chip.map(|c| c.label.clone()),
            chip_basis: match chip {
                Some(_) => format!("inferred from row count ({})", stats.rows_read),
                None => format!("unknown: {} rows matches no known chip", stats.rows_read),
            },
            build: profile.build.clone(),
            build_basis: match (states_build, &profile.build_basis) {
                (true, _) => "stated in the file header".to_string(),
                (false, Some(why)) => format!("not stated in the file; assumed because {why}"),
                (false, None) => unreachable!("an unstated build without a basis is refused above"),
            },
            source_sha256: sha256_hex(bytes),
            locus_version: locus::LOCUS_VERSION.to_string(),
        },
        calls,
        stats,
        rejected_examples,
    })
}

/// Enforce one call per locus per kit (Genotype Store invariant).
///
/// Chips sometimes carry two probes at one position (an `rs` probe and a
/// vendor `i` probe). SNV and indel probes at one position are different
/// loci and are both kept. For two probes of the same kind, identical calls
/// merge (preferring the `rs` identifier); conflicting calls become a
/// no-call, since neither can be trusted over the other.
fn dedupe(mut calls: Vec<Call>, stats: &mut ImportStats) -> Vec<Call> {
    let is_indel = |c: &Call| c.ref_check == RefCheck::IndelUnresolved;
    calls.sort_by_key(|c| (c.chrom.code(), c.pos, is_indel(c)));
    let mut out: Vec<Call> = Vec::with_capacity(calls.len());
    // Set while the last pushed locus has seen conflicting calls.
    let mut last_conflicted = false;
    for call in calls {
        if let Some(last) = out.last_mut() {
            if last.chrom == call.chrom && last.pos == call.pos && is_indel(last) == is_indel(&call) {
                stats.duplicates_merged += 1;
                if !last.rsid.starts_with("rs") && call.rsid.starts_with("rs") {
                    last.rsid = call.rsid.clone();
                }
                if last_conflicted || call.is_nocall() {
                    continue;
                }
                if last.is_nocall() {
                    let rsid = std::mem::take(&mut last.rsid);
                    *last = call;
                    last.rsid = rsid;
                } else if !same_genotype(last.genotype, call.genotype) {
                    last_conflicted = true;
                    stats.duplicate_conflicts += 1;
                    last.genotype = Genotype::NoCall;
                    last.ref_check = RefCheck::NotApplicable;
                    last.strand_ambiguous = false;
                }
                continue;
            }
        }
        last_conflicted = false;
        out.push(call);
    }
    out
}

fn same_genotype(a: Genotype, b: Genotype) -> bool {
    match (a, b) {
        (Genotype::Diploid(a1, a2), Genotype::Diploid(b1, b2)) => (a1 == b1 && a2 == b2) || (a1 == b2 && a2 == b1),
        _ => a == b,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use locus::reference::{NoReference, SortedReference};

    fn profile() -> FormatProfile {
        FormatProfile::from_json(include_str!("../../../plugins/profile-23andme/profile.json")).unwrap()
    }

    const HEADER: &str = "# This data file generated by 23andMe at: Mon Jan 01 00:00:00 2024\n\
# We are using reference human assembly build 37 (also known as Annotation Release 104).\n\
# rsid\tchromosome\tposition\tgenotype\n";

    fn run(body: &str) -> ImportOutput {
        let file = format!("{HEADER}{body}");
        import(file.as_bytes(), &profile(), &NoReference, 0, &mut |_| {}).unwrap()
    }

    #[test]
    fn reads_rows_and_counts() {
        let out = run("rs1\t1\t100\tAG\nrs2\t1\t200\t--\ni3\tMT\t73\tG\nrs4\t2\t50\tAT\n");
        assert_eq!(out.stats.rows_read, 4);
        assert_eq!(out.stats.calls, 4);
        assert_eq!(out.stats.no_calls, 1);
        assert_eq!(out.stats.strand_ambiguous, 1);
        // sorted by chrom code, then position
        let order: Vec<_> = out.calls.iter().map(|c| (c.chrom.code(), c.pos)).collect();
        assert_eq!(order, vec![(1, 100), (1, 200), (2, 50), (25, 73)]);
        assert_eq!(out.meta.importer, "profile-23andme@0.1.0");
        assert_eq!(out.meta.chip_version, None);
    }

    #[test]
    fn rejects_bad_rows_but_keeps_going() {
        let out = run("rs1\t1\t100\tAG\nrs2\t1\tabc\tAG\nrs3\tQ\t5\tAA\nrs4\t1\n");
        assert_eq!(out.stats.calls, 1);
        assert_eq!(out.stats.rejected, 3);
        assert_eq!(out.rejected_examples[0].line, 5);
    }

    #[test]
    fn dedupes_one_call_per_locus() {
        let out = run("i1\t1\t100\tAG\nrs1\t1\t100\tGA\nrs2\t1\t200\tAA\ni2\t1\t200\tCC\ni5\t1\t300\tDI\nrs5\t1\t300\tAG\n");
        assert_eq!(out.stats.duplicates_merged, 2);
        assert_eq!(out.stats.duplicate_conflicts, 1);
        assert_eq!(out.calls.len(), 4);
        assert_eq!(out.calls[0].rsid, "rs1");
        assert!(out.calls[1].is_nocall());
    }

    #[test]
    fn refuses_wrong_vendor_and_build() {
        let p = profile();
        let not_23 = "# some other vendor\nrs1\t1\t1\tAA\n";
        assert!(matches!(import(not_23.as_bytes(), &p, &NoReference, 0, &mut |_| {}), Err(ImportError::WrongVendor(_))));
        let b36 = "# 23andMe\n# reference human assembly build 36\nrs1\t1\t1\tAA\n";
        assert!(matches!(import(b36.as_bytes(), &p, &NoReference, 0, &mut |_| {}), Err(ImportError::WrongBuild(_))));
        let none = "# 23andMe\nrs1\t1\t1\tAA\n";
        assert!(matches!(import(none.as_bytes(), &p, &NoReference, 0, &mut |_| {}), Err(ImportError::BuildNotStated)));
    }

    #[test]
    fn uses_the_reference() {
        let reference = SortedReference::from_columns(&[1], &[100], b"C");
        let file = format!("{HEADER}rs1\t1\t100\tTT\n");
        let out = import(file.as_bytes(), &profile(), &reference, 0, &mut |_| {}).unwrap();
        assert_eq!(out.calls[0].ref_check, RefCheck::HomNonRef);
        assert_eq!(out.stats.ref_checks[RefCheck::HomNonRef.code() as usize], 1);
    }

    #[test]
    fn detects_profile_from_header() {
        let profiles = vec![profile()];
        assert!(detect(HEADER.as_bytes(), &profiles).is_some());
        assert!(detect(b"#AncestryDNA raw data download\n", &profiles).is_none());
    }

    fn vendor(name: &str) -> FormatProfile {
        let json = match name {
            "ancestrydna" => include_str!("../../../plugins/profile-ancestrydna/profile.json"),
            "myheritage" => include_str!("../../../plugins/profile-myheritage/profile.json"),
            "familytreedna" => include_str!("../../../plugins/profile-familytreedna/profile.json"),
            other => panic!("no profile {other}"),
        };
        FormatProfile::from_json(json).unwrap()
    }

    const ANCESTRY: &str = "#AncestryDNA raw data download\n\
#Data is formatted using human reference build 37 (also known as GRCh37).\n\
rsid\tchromosome\tposition\tallele1\tallele2\n";

    #[test]
    fn ancestrydna_reads_two_allele_columns() {
        let body = "rs1\t1\t100\tA\tG\nrs2\t1\t200\t0\t0\nrs3\t25\t300\tC\tC\nrs4\t26\t73\tT\tT\n";
        let file = format!("{ANCESTRY}{body}");
        let out = import(file.as_bytes(), &vendor("ancestrydna"), &NoReference, 0, &mut |_| {}).unwrap();

        assert_eq!(out.stats.calls, 4);
        // The two allele columns join into one genotype, and "00" is a no-call.
        assert_eq!(out.stats.no_calls, 1);
        // 25 is Ancestry's pseudoautosomal X, 26 its MT.
        let order: Vec<_> = out.calls.iter().map(|c| (c.chrom.code(), c.pos)).collect();
        assert_eq!(order, vec![(1, 100), (1, 200), (23, 300), (25, 73)]);
        assert_eq!(out.meta.vendor_label, "AncestryDNA");
        assert_eq!(out.meta.build_basis, "stated in the file header");
    }

    #[test]
    fn reads_quoted_csv_columns() {
        let file = "# MyHeritage DNA raw data.\n\
RSID,CHROMOSOME,POSITION,RESULT\n\
\"rs1\",\"1\",\"100\",\"AG\"\n\
\"rs2\",\"1\",\"200\",\"--\"\n";
        let out = import(file.as_bytes(), &vendor("myheritage"), &NoReference, 0, &mut |_| {}).unwrap();

        assert_eq!(out.stats.calls, 2);
        assert_eq!(out.stats.no_calls, 1);
        assert_eq!(out.calls[0].rsid, "rs1");
        assert_eq!(out.calls[0].pos, 100);
    }

    #[test]
    fn says_when_a_build_was_assumed_rather_than_read() {
        // MyHeritage never writes the build into the file. The import is still
        // allowed, but the kit records that nobody stated it.
        let file = "# MyHeritage DNA raw data.\n\
RSID,CHROMOSOME,POSITION,RESULT\n\
\"rs1\",\"1\",\"100\",\"AG\"\n";
        let out = import(file.as_bytes(), &vendor("myheritage"), &NoReference, 0, &mut |_| {}).unwrap();
        assert!(out.meta.build_basis.starts_with("not stated in the file; assumed because"));

        // A profile without that basis still refuses the file outright.
        let mut strict = vendor("myheritage");
        strict.build_basis = None;
        let refused = import(file.as_bytes(), &strict, &NoReference, 0, &mut |_| {});
        assert!(matches!(refused, Err(ImportError::BuildNotStated)));
    }

    #[test]
    fn recognises_a_file_that_has_no_comment_banner() {
        // FamilyTreeDNA ships the column names and nothing else.
        let file = "RSID,CHROMOSOME,POSITION,RESULT\n\"rs1\",\"1\",\"100\",\"AG\"\n";
        let profiles = vec![profile(), vendor("myheritage"), vendor("familytreedna")];
        let found = detect(file.as_bytes(), &profiles).expect("a bare CSV is still recognisable");
        assert_eq!(found.id, "profile-familytreedna");

        // A MyHeritage file carries the same column names, so its banner has to win.
        let mh = "# MyHeritage DNA raw data.\nRSID,CHROMOSOME,POSITION,RESULT\n";
        assert_eq!(detect(mh.as_bytes(), &profiles).unwrap().id, "profile-myheritage");
    }
}
