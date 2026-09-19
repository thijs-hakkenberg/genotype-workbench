//! Turn a vendor's raw call into a normalized call on the plus strand, GRCh37.
//!
//! This is the one place where a bug makes every downstream annotation wrong
//! (Decisions B2), so the rules are small and tested case by case.

use crate::allele::{Allele, Base};
use crate::chrom::Chrom;
use crate::reference::ReferenceIndex;
use std::fmt;

/// A row as a format profile or code importer reads it, before normalization.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawCall {
    pub rsid: String,
    pub chrom: String,
    pub pos: u64,
    /// Genotype text as it appears in the file, e.g. `AG`, `A`, `--`, `DI`.
    /// Two-column formats are concatenated by the importer.
    pub genotype: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Genotype {
    NoCall,
    Haploid(Allele),
    Diploid(Allele, Allele),
}

/// Outcome of checking a call against the GRCh37 reference base.
///
/// With only the reference base (not the site's alternate alleles) a check
/// can confirm a call that contains the reference, and can flag a
/// heterozygous call that lacks it. A homozygous non-reference call is
/// plausible but unverifiable until a pack supplies the site's alleles.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum RefCheck {
    /// The call contains the reference base.
    Match,
    /// Homozygous for a non-reference base: consistent, not verifiable here.
    HomNonRef,
    /// Heterozygous without the reference base, but carrying its complement:
    /// probably reported on the minus strand. Flagged, never auto-flipped.
    ComplementOnly,
    /// Heterozygous with neither the reference base nor its complement.
    Mismatch,
    /// No reference base known at this position.
    Unknown,
    /// `I`/`D` chip indel: sequence unknown without the vendor manifest.
    IndelUnresolved,
    /// No-call: nothing to check.
    NotApplicable,
}

impl RefCheck {
    pub const ALL: [RefCheck; 7] = [
        RefCheck::Match,
        RefCheck::HomNonRef,
        RefCheck::ComplementOnly,
        RefCheck::Mismatch,
        RefCheck::Unknown,
        RefCheck::IndelUnresolved,
        RefCheck::NotApplicable,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            RefCheck::Match => "match",
            RefCheck::HomNonRef => "hom-non-ref",
            RefCheck::ComplementOnly => "complement-only",
            RefCheck::Mismatch => "mismatch",
            RefCheck::Unknown => "unknown",
            RefCheck::IndelUnresolved => "indel-unresolved",
            RefCheck::NotApplicable => "not-applicable",
        }
    }

    /// Stable numeric code for columnar storage.
    pub fn code(self) -> u8 {
        RefCheck::ALL.iter().position(|r| *r == self).unwrap() as u8
    }
}

impl fmt::Display for RefCheck {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Call {
    pub chrom: Chrom,
    pub pos: u32,
    pub ref_base: Option<Base>,
    pub genotype: Genotype,
    pub rsid: String,
    pub strand_ambiguous: bool,
    pub ref_check: RefCheck,
}

impl Call {
    pub fn is_nocall(&self) -> bool {
        matches!(self.genotype, Genotype::NoCall)
    }

    pub fn a1(&self) -> Option<Allele> {
        match self.genotype {
            Genotype::NoCall => None,
            Genotype::Haploid(a) | Genotype::Diploid(a, _) => Some(a),
        }
    }

    pub fn a2(&self) -> Option<Allele> {
        match self.genotype {
            Genotype::Diploid(_, b) => Some(b),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum NormalizeError {
    #[error("unknown chromosome '{0}'")]
    Chrom(String),
    #[error("position {0} is outside chromosome {1} on GRCh37")]
    Position(u64, Chrom),
    #[error("unreadable genotype '{0}'")]
    Genotype(String),
}

/// Parse genotype text. `--`, `00`, `0`, `-` and empty are no-calls; a
/// half-call such as `A-` is treated as a no-call because one allele alone
/// cannot be placed on a diploid site.
pub fn parse_genotype(text: &str) -> Result<Genotype, NormalizeError> {
    let t = text.trim();
    let chars: Vec<char> = t.chars().filter(|c| !matches!(c, '/' | '|' | ' ' | '\t' | ',')).collect();
    let is_missing = |c: char| matches!(c, '-' | '0' | '.' | '?');
    if chars.is_empty() || chars.iter().any(|c| is_missing(*c)) {
        return Ok(Genotype::NoCall);
    }
    let allele = |c: char| Allele::from_char(c).ok_or_else(|| NormalizeError::Genotype(text.to_string()));
    match chars.as_slice() {
        [a] => Ok(Genotype::Haploid(allele(*a)?)),
        [a, b] => Ok(Genotype::Diploid(allele(*a)?, allele(*b)?)),
        _ => Err(NormalizeError::Genotype(text.to_string())),
    }
}

/// Normalize one raw call. The chip files in scope (23andMe, AncestryDNA)
/// already report plus-strand alleles on GRCh37; the reference check detects
/// the cases where that is not true.
pub fn normalize(raw: &RawCall, reference: &dyn ReferenceIndex) -> Result<Call, NormalizeError> {
    let chrom = Chrom::parse(&raw.chrom).ok_or_else(|| NormalizeError::Chrom(raw.chrom.clone()))?;
    let len = chrom.length(crate::Build::GRCh37) as u64;
    if raw.pos == 0 || raw.pos > len {
        return Err(NormalizeError::Position(raw.pos, chrom));
    }
    let pos = raw.pos as u32;
    let mut genotype = parse_genotype(&raw.genotype)?;
    // A single allele is only meaningful where a chip reports haploid calls.
    if matches!(genotype, Genotype::Haploid(_)) && !chrom.can_be_haploid() {
        return Err(NormalizeError::Genotype(raw.genotype.clone()));
    }
    // Some files write MT calls as a homozygous pair; MT is always haploid.
    // X and Y pairs are kept as reported, since the file does not say the sex.
    if let (Chrom::MT, Genotype::Diploid(a, b)) = (chrom, genotype) {
        if a == b {
            genotype = Genotype::Haploid(a);
        }
    }

    let ref_base = reference.ref_at(chrom, pos);
    let (ref_check, strand_ambiguous) = check(genotype, ref_base);

    Ok(Call {
        chrom,
        pos,
        ref_base,
        genotype,
        rsid: raw.rsid.trim().to_string(),
        strand_ambiguous,
        ref_check,
    })
}

fn check(genotype: Genotype, ref_base: Option<Base>) -> (RefCheck, bool) {
    let alleles: Vec<Allele> = match genotype {
        Genotype::NoCall => return (RefCheck::NotApplicable, false),
        Genotype::Haploid(a) => vec![a],
        Genotype::Diploid(a, b) => vec![a, b],
    };
    let bases: Vec<Base> = alleles.iter().filter_map(|a| a.base()).collect();
    if bases.len() != alleles.len() {
        return (RefCheck::IndelUnresolved, false);
    }

    let ambiguous = strand_ambiguous(&bases, ref_base);
    let Some(r) = ref_base else {
        return (RefCheck::Unknown, ambiguous);
    };
    let homozygous = bases.iter().all(|b| *b == bases[0]);
    let result = if bases.contains(&r) {
        RefCheck::Match
    } else if homozygous {
        RefCheck::HomNonRef
    } else if bases.contains(&r.complement()) {
        RefCheck::ComplementOnly
    } else {
        RefCheck::Mismatch
    };
    (result, ambiguous)
}

/// A/T and C/G sites read the same on both strands, so the strand cannot be
/// inferred from the alleles. Flag when the alleles seen here (the call plus
/// the reference base) are exactly one complementary pair.
fn strand_ambiguous(bases: &[Base], ref_base: Option<Base>) -> bool {
    let mut seen: Vec<Base> = bases.to_vec();
    if let Some(r) = ref_base {
        seen.push(r);
    }
    seen.sort();
    seen.dedup();
    matches!(seen.as_slice(), [Base::A, Base::T] | [Base::C, Base::G])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::reference::{NoReference, SortedReference};

    fn raw(chrom: &str, pos: u64, gt: &str) -> RawCall {
        RawCall { rsid: "rs1".into(), chrom: chrom.into(), pos, genotype: gt.into() }
    }

    fn reference() -> SortedReference {
        // chr2:100 = C, chr2:200 = A, chr2:300 = G, MT:73 = A, X:1000 = T
        SortedReference::from_columns(&[2, 2, 2, 25, 23], &[100, 200, 300, 73, 1000], b"CAGAT")
    }

    fn check_of(chrom: &str, pos: u64, gt: &str) -> (RefCheck, bool) {
        let c = normalize(&raw(chrom, pos, gt), &reference()).unwrap();
        (c.ref_check, c.strand_ambiguous)
    }

    #[test]
    fn genotype_parsing() {
        assert_eq!(parse_genotype("AG").unwrap(), Genotype::Diploid(Allele::Base(Base::A), Allele::Base(Base::G)));
        assert_eq!(parse_genotype("a/g").unwrap(), Genotype::Diploid(Allele::Base(Base::A), Allele::Base(Base::G)));
        assert_eq!(parse_genotype("--").unwrap(), Genotype::NoCall);
        assert_eq!(parse_genotype("00").unwrap(), Genotype::NoCall);
        assert_eq!(parse_genotype("A-").unwrap(), Genotype::NoCall);
        assert_eq!(parse_genotype("T").unwrap(), Genotype::Haploid(Allele::Base(Base::T)));
        assert_eq!(parse_genotype("DI").unwrap(), Genotype::Diploid(Allele::Del, Allele::Ins));
        assert!(parse_genotype("AX").is_err());
        assert!(parse_genotype("AGT").is_err());
    }

    #[test]
    fn reference_checks() {
        assert_eq!(check_of("2", 100, "CT"), (RefCheck::Match, false));
        assert_eq!(check_of("2", 100, "CC"), (RefCheck::Match, false));
        assert_eq!(check_of("2", 100, "TT"), (RefCheck::HomNonRef, false));
        // ref C, het G/T: no C, but G is the complement of C -> probable flip
        assert_eq!(check_of("2", 100, "GT"), (RefCheck::ComplementOnly, false));
        // ref C, het A/T: neither C nor G
        assert_eq!(check_of("2", 100, "AT"), (RefCheck::Mismatch, false));
        assert_eq!(check_of("5", 100, "AG"), (RefCheck::Unknown, false));
        assert_eq!(check_of("2", 100, "--"), (RefCheck::NotApplicable, false));
        assert_eq!(check_of("2", 100, "DI"), (RefCheck::IndelUnresolved, false));
    }

    #[test]
    fn strand_ambiguity() {
        // ref A, call A/T: the site is A/T
        assert_eq!(check_of("2", 200, "AT"), (RefCheck::Match, true));
        // ref A, call T/T: seen {A,T}
        assert_eq!(check_of("2", 200, "TT"), (RefCheck::HomNonRef, true));
        // ref A, call A/A: only {A}, cannot tell
        assert_eq!(check_of("2", 200, "AA"), (RefCheck::Match, false));
        // ref G, call C/G
        assert_eq!(check_of("2", 300, "CG"), (RefCheck::Match, true));
        // no reference: het call alone decides
        let c = normalize(&raw("7", 10, "CG"), &NoReference).unwrap();
        assert!(c.strand_ambiguous);
    }

    #[test]
    fn haploid_rules() {
        let c = normalize(&raw("MT", 73, "GG"), &reference()).unwrap();
        assert_eq!(c.genotype, Genotype::Haploid(Allele::Base(Base::G)));
        assert_eq!(c.ref_check, RefCheck::HomNonRef);
        let c = normalize(&raw("X", 1000, "T"), &reference()).unwrap();
        assert_eq!(c.ref_check, RefCheck::Match);
        assert!(normalize(&raw("2", 100, "C"), &reference()).is_err());
    }

    #[test]
    fn rejects_positions_off_the_build() {
        assert!(matches!(normalize(&raw("21", 48_129_896, "AA"), &NoReference), Err(NormalizeError::Position(..))));
        assert!(matches!(normalize(&raw("2", 0, "AA"), &NoReference), Err(NormalizeError::Position(..))));
        assert!(matches!(normalize(&raw("chrQ", 5, "AA"), &NoReference), Err(NormalizeError::Chrom(..))));
    }
}
