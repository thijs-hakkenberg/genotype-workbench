//! WASM surface for the import worker.
//!
//! Output is columnar (typed arrays plus one UTF-8 buffer with offsets for
//! rsIDs) so the worker can build an Arrow table without touching each row.

use genotype_import::{import, FormatProfile, ImportOutput};
use locus::{Allele, RefCheck, SortedReference};
use serde_json::json;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn locus_version() -> String {
    locus::LOCUS_VERSION.to_string()
}

/// Names of the `ref_check` codes, in code order.
#[wasm_bindgen]
pub fn ref_check_names() -> Vec<String> {
    RefCheck::ALL.iter().map(|r| r.as_str().to_string()).collect()
}

/// Returns the id of the first profile whose markers match the file header.
#[wasm_bindgen]
pub fn detect_profile(head: &[u8], profiles_json: &str) -> Result<Option<String>, JsError> {
    let profiles: Vec<FormatProfile> = serde_json::from_str(profiles_json).map_err(|e| JsError::new(&e.to_string()))?;
    Ok(genotype_import::detect(head, &profiles).map(|p| p.id.clone()))
}

#[wasm_bindgen]
pub struct ImportResult {
    out: ImportOutput,
}

fn allele_byte(a: Option<Allele>) -> u8 {
    a.map(|a| a.as_byte()).unwrap_or(0)
}

#[wasm_bindgen]
impl ImportResult {
    #[wasm_bindgen(getter)]
    pub fn length(&self) -> usize {
        self.out.calls.len()
    }

    /// Kit metadata, statistics and rejected-row examples as JSON.
    pub fn meta_json(&self) -> String {
        let m = &self.out.meta;
        let s = &self.out.stats;
        let ref_checks: serde_json::Map<String, serde_json::Value> = RefCheck::ALL
            .iter()
            .map(|r| (r.as_str().to_string(), json!(s.ref_checks[r.code() as usize])))
            .collect();
        json!({
            "vendor": m.vendor,
            "vendorLabel": m.vendor_label,
            "importer": m.importer,
            "chipVersion": m.chip_version,
            "chipLabel": m.chip_label,
            "chipBasis": m.chip_basis,
            "build": m.build,
            "buildBasis": m.build_basis,
            "sourceSha256": m.source_sha256,
            "locusVersion": m.locus_version,
            "stats": {
                "rowsRead": s.rows_read,
                "calls": s.calls,
                "noCalls": s.no_calls,
                "strandAmbiguous": s.strand_ambiguous,
                "rejected": s.rejected,
                "duplicatesMerged": s.duplicates_merged,
                "duplicateConflicts": s.duplicate_conflicts,
                "refChecks": ref_checks,
            },
            "rejectedExamples": self.out.rejected_examples.iter()
                .map(|r| json!({"line": r.line, "reason": r.reason}))
                .collect::<Vec<_>>(),
        })
        .to_string()
    }

    pub fn chrom(&self) -> Vec<u8> {
        self.out.calls.iter().map(|c| c.chrom.code()).collect()
    }

    pub fn pos(&self) -> Vec<u32> {
        self.out.calls.iter().map(|c| c.pos).collect()
    }

    /// ASCII base, or 0 when the reference is unknown.
    pub fn ref_base(&self) -> Vec<u8> {
        self.out.calls.iter().map(|c| c.ref_base.map(|b| b.as_byte()).unwrap_or(0)).collect()
    }

    /// ASCII allele (A, C, G, T, I, D), or 0 for a no-call.
    pub fn a1(&self) -> Vec<u8> {
        self.out.calls.iter().map(|c| allele_byte(c.a1())).collect()
    }

    /// ASCII allele, or 0 for a haploid call or a no-call.
    pub fn a2(&self) -> Vec<u8> {
        self.out.calls.iter().map(|c| allele_byte(c.a2())).collect()
    }

    pub fn is_nocall(&self) -> Vec<u8> {
        self.out.calls.iter().map(|c| c.is_nocall() as u8).collect()
    }

    pub fn strand_ambiguous(&self) -> Vec<u8> {
        self.out.calls.iter().map(|c| c.strand_ambiguous as u8).collect()
    }

    pub fn ref_check(&self) -> Vec<u8> {
        self.out.calls.iter().map(|c| c.ref_check.code()).collect()
    }

    /// All rsIDs concatenated as UTF-8; pair with `rsid_offsets`.
    pub fn rsid_data(&self) -> Vec<u8> {
        let mut buf = Vec::with_capacity(self.out.calls.len() * 10);
        for c in &self.out.calls {
            buf.extend_from_slice(c.rsid.as_bytes());
        }
        buf
    }

    /// Arrow-style offsets: `length + 1` entries.
    pub fn rsid_offsets(&self) -> Vec<i32> {
        let mut offsets = Vec::with_capacity(self.out.calls.len() + 1);
        let mut at = 0i32;
        offsets.push(0);
        for c in &self.out.calls {
            at += c.rsid.len() as i32;
            offsets.push(at);
        }
        offsets
    }
}

/// Read and normalize a whole raw-data file.
///
/// `ref_chrom`/`ref_pos`/`ref_base` are the columns of the `reference-grch37`
/// pack (empty when it is not installed). `progress` receives rows read so far.
#[wasm_bindgen]
pub fn import_kit(
    bytes: &[u8],
    profile_json: &str,
    ref_chrom: &[u8],
    ref_pos: &[u32],
    ref_base: &[u8],
    progress: Option<js_sys::Function>,
) -> Result<ImportResult, JsError> {
    let profile = FormatProfile::from_json(profile_json).map_err(|e| JsError::new(&e.to_string()))?;
    let reference = SortedReference::from_columns(ref_chrom, ref_pos, ref_base);
    let mut report = |n: usize| {
        if let Some(f) = &progress {
            let _ = f.call1(&JsValue::NULL, &JsValue::from(n as u32));
        }
    };
    let out = import(bytes, &profile, &reference, 50_000, &mut report).map_err(|e| JsError::new(&e.to_string()))?;
    Ok(ImportResult { out })
}
