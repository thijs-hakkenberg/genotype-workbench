//! The locus key `build:chrom:pos:ref:alt`, the join key between kits and packs.

use crate::chrom::{Build, Chrom};
use std::fmt;
use std::str::FromStr;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct LocusKey {
    pub build: Build,
    pub chrom: Chrom,
    /// 1-based position of the first base of `ref_allele`.
    pub pos: u32,
    pub ref_allele: String,
    pub alt_allele: String,
}

impl fmt::Display for LocusKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{}:{}:{}:{}:{}",
            self.build, self.chrom, self.pos, self.ref_allele, self.alt_allele
        )
    }
}

impl FromStr for LocusKey {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let parts: Vec<&str> = s.split(':').collect();
        let [build, chrom, pos, r, a] = parts.as_slice() else {
            return Err(format!("locus key '{s}' must have five fields build:chrom:pos:ref:alt"));
        };
        let valid = |x: &str| !x.is_empty() && x.chars().all(|c| matches!(c, 'A' | 'C' | 'G' | 'T'));
        if !valid(r) || !valid(a) {
            return Err(format!("locus key '{s}' has alleles that are not uppercase ACGT"));
        }
        Ok(LocusKey {
            build: build.parse()?,
            chrom: chrom.parse()?,
            pos: pos.parse().map_err(|_| format!("bad position in '{s}'"))?,
            ref_allele: (*r).to_string(),
            alt_allele: (*a).to_string(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips() {
        let k: LocusKey = "GRCh37:2:136608646:C:T".parse().unwrap();
        assert_eq!(k.chrom, Chrom::Auto(2));
        assert_eq!(k.pos, 136_608_646);
        assert_eq!(k.to_string(), "GRCh37:2:136608646:C:T");
    }

    #[test]
    fn rejects_lowercase_and_short_keys() {
        assert!("GRCh37:2:1:c:T".parse::<LocusKey>().is_err());
        assert!("GRCh37:2:1:C".parse::<LocusKey>().is_err());
        assert!("GRCh38:2:1:C:T".parse::<LocusKey>().is_err());
    }
}
