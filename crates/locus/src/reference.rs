//! Reference alleles at known positions.
//!
//! The full GRCh37 sequence is about 3 GB, so the app ships only the bases at
//! chip loci (the `reference-grch37` pack). The normalizer asks this index for
//! the reference base at each call.

use crate::allele::Base;
use crate::chrom::Chrom;

pub trait ReferenceIndex {
    fn ref_at(&self, chrom: Chrom, pos: u32) -> Option<Base>;
}

/// No reference loaded: every call gets `RefCheck::Unknown`.
pub struct NoReference;

impl ReferenceIndex for NoReference {
    fn ref_at(&self, _: Chrom, _: u32) -> Option<Base> {
        None
    }
}

/// Reference bases held as three parallel columns, sorted by (chrom code, pos).
/// This is the shape the Parquet pack decodes into, so it can cross the WASM
/// boundary without per-row allocation.
pub struct SortedReference {
    /// Start offset into `pos`/`base` per chrom code (index 0 unused), plus end.
    offsets: [usize; 27],
    pos: Vec<u32>,
    base: Vec<u8>,
}

impl SortedReference {
    /// Build from unsorted columns; rows with an unknown chrom or base are skipped.
    pub fn from_columns(chrom: &[u8], pos: &[u32], base: &[u8]) -> SortedReference {
        let n = chrom.len().min(pos.len()).min(base.len());
        let mut rows: Vec<(u8, u32, u8)> = (0..n)
            .filter(|&i| Chrom::from_code(chrom[i]).is_some() && Base::from_byte(base[i]).is_some())
            .map(|i| (chrom[i], pos[i], base[i].to_ascii_uppercase()))
            .collect();
        rows.sort_unstable_by_key(|r| (r.0, r.1));
        rows.dedup_by_key(|r| (r.0, r.1));

        let mut offsets = [0usize; 27];
        let mut out_pos = Vec::with_capacity(rows.len());
        let mut out_base = Vec::with_capacity(rows.len());
        let mut counts = [0usize; 26];
        for (c, p, b) in &rows {
            counts[*c as usize] += 1;
            out_pos.push(*p);
            out_base.push(*b);
        }
        for code in 1..=25 {
            offsets[code + 1] = offsets[code] + counts[code];
        }
        offsets[1] = 0;
        // offsets[c]..offsets[c+1] is the slice for chrom code c
        SortedReference { offsets, pos: out_pos, base: out_base }
    }

    pub fn len(&self) -> usize {
        self.pos.len()
    }

    pub fn is_empty(&self) -> bool {
        self.pos.is_empty()
    }
}

impl ReferenceIndex for SortedReference {
    fn ref_at(&self, chrom: Chrom, pos: u32) -> Option<Base> {
        let c = chrom.code() as usize;
        let (lo, hi) = (self.offsets[c], self.offsets[c + 1]);
        let slice = &self.pos[lo..hi];
        slice
            .binary_search(&pos)
            .ok()
            .and_then(|i| Base::from_byte(self.base[lo + i]))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn looks_up_across_chromosomes() {
        let r = SortedReference::from_columns(
            &[2, 1, 25, 2, 23],
            &[500, 10, 73, 100, 5],
            b"cAGTN",
        );
        // 'N' on X is skipped
        assert_eq!(r.len(), 4);
        assert_eq!(r.ref_at(Chrom::Auto(1), 10), Some(Base::A));
        assert_eq!(r.ref_at(Chrom::Auto(2), 100), Some(Base::T));
        assert_eq!(r.ref_at(Chrom::Auto(2), 500), Some(Base::C));
        assert_eq!(r.ref_at(Chrom::MT, 73), Some(Base::G));
        assert_eq!(r.ref_at(Chrom::X, 5), None);
        assert_eq!(r.ref_at(Chrom::Auto(3), 10), None);
    }
}
