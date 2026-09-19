//! VCF-style allele representation: minimal, with one anchor base for indels.
//!
//! Left-alignment of indels in repeats needs the surrounding reference
//! sequence; pack sources used in iteration 1 (ClinVar, gnomAD) publish
//! left-aligned VCF, so only trimming is applied here.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrimmedVariant {
    pub pos: u32,
    pub ref_allele: String,
    pub alt_allele: String,
}

/// Reduce a VCF record to its minimal representation: drop shared trailing
/// bases, then shared leading bases, keeping one anchor base when an allele
/// would become empty. Alleles are uppercased.
pub fn trim_variant(pos: u32, ref_allele: &str, alt_allele: &str) -> Result<TrimmedVariant, String> {
    let r: Vec<u8> = ref_allele.trim().to_ascii_uppercase().into_bytes();
    let a: Vec<u8> = alt_allele.trim().to_ascii_uppercase().into_bytes();
    let ok = |x: &[u8]| !x.is_empty() && x.iter().all(|c| matches!(c, b'A' | b'C' | b'G' | b'T' | b'N'));
    if !ok(&r) || !ok(&a) {
        return Err(format!("alleles '{ref_allele}'/'{alt_allele}' are not simple sequences"));
    }
    let (mut start, mut r_end, mut a_end) = (0usize, r.len(), a.len());
    while r_end - start > 1 && a_end - start > 1 && r[r_end - 1] == a[a_end - 1] {
        r_end -= 1;
        a_end -= 1;
    }
    while r_end - start > 1 && a_end - start > 1 && r[start] == a[start] {
        start += 1;
    }
    Ok(TrimmedVariant {
        pos: pos + start as u32,
        ref_allele: String::from_utf8(r[start..r_end].to_vec()).unwrap(),
        alt_allele: String::from_utf8(a[start..a_end].to_vec()).unwrap(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trims_to_minimal() {
        let t = trim_variant(100, "CTT", "CT").unwrap();
        assert_eq!((t.pos, t.ref_allele.as_str(), t.alt_allele.as_str()), (100, "CT", "C"));
        let t = trim_variant(100, "ACGT", "ACCT").unwrap();
        assert_eq!((t.pos, t.ref_allele.as_str(), t.alt_allele.as_str()), (102, "G", "C"));
        let t = trim_variant(5, "c", "t").unwrap();
        assert_eq!((t.pos, t.ref_allele.as_str(), t.alt_allele.as_str()), (5, "C", "T"));
    }

    #[test]
    fn rejects_symbolic_alleles() {
        assert!(trim_variant(1, "A", "<DEL>").is_err());
        assert!(trim_variant(1, "A", "").is_err());
    }
}
