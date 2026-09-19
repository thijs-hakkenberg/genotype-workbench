//! Python bindings for the pack pipeline, so packs are normalized by the same
//! code as kits (Decisions B1, S7).

use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;

/// Canonical chromosome name (`1`..`22`, `X`, `Y`, `MT`) or None.
#[pyfunction]
fn canonical_chrom(name: &str) -> Option<String> {
    locus::Chrom::parse(name).map(|c| c.to_string())
}

/// Numeric chromosome code used in columnar storage (X=23, Y=24, MT=25).
#[pyfunction]
fn chrom_code(name: &str) -> Option<u8> {
    locus::Chrom::parse(name).map(|c| c.code())
}

/// Minimal VCF representation: returns (pos, ref, alt).
#[pyfunction]
fn trim_variant(pos: u32, ref_allele: &str, alt_allele: &str) -> PyResult<(u32, String, String)> {
    locus::trim_variant(pos, ref_allele, alt_allele)
        .map(|t| (t.pos, t.ref_allele, t.alt_allele))
        .map_err(PyValueError::new_err)
}

/// Format a locus key `GRCh37:chrom:pos:ref:alt`.
#[pyfunction]
fn locus_key(chrom: &str, pos: u32, ref_allele: &str, alt_allele: &str) -> PyResult<String> {
    let chrom = locus::Chrom::parse(chrom).ok_or_else(|| PyValueError::new_err(format!("unknown chromosome '{chrom}'")))?;
    Ok(locus::LocusKey {
        build: locus::Build::GRCh37,
        chrom,
        pos,
        ref_allele: ref_allele.to_string(),
        alt_allele: alt_allele.to_string(),
    }
    .to_string())
}

#[pyfunction]
fn complement(base: &str) -> PyResult<String> {
    let mut chars = base.chars();
    match (chars.next().and_then(locus::Base::from_char), chars.next()) {
        (Some(b), None) => Ok(b.complement().to_string()),
        _ => Err(PyValueError::new_err(format!("'{base}' is not a single base"))),
    }
}

#[pymodule]
fn _locus(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add("LOCUS_VERSION", locus::LOCUS_VERSION)?;
    m.add_function(wrap_pyfunction!(canonical_chrom, m)?)?;
    m.add_function(wrap_pyfunction!(chrom_code, m)?)?;
    m.add_function(wrap_pyfunction!(trim_variant, m)?)?;
    m.add_function(wrap_pyfunction!(locus_key, m)?)?;
    m.add_function(wrap_pyfunction!(complement, m)?)?;
    Ok(())
}
