//! Chromosomes and reference builds.

use std::fmt;
use std::str::FromStr;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum Build {
    GRCh37,
}

impl Build {
    pub fn as_str(self) -> &'static str {
        match self {
            Build::GRCh37 => "GRCh37",
        }
    }
}

impl fmt::Display for Build {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for Build {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "GRCh37" | "grch37" | "hg19" | "37" => Ok(Build::GRCh37),
            other => Err(format!("unsupported build '{other}': the canonical build is GRCh37 (ADR-0001)")),
        }
    }
}

/// A chromosome in the canonical naming: `1`..`22`, `X`, `Y`, `MT`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Chrom {
    Auto(u8),
    X,
    Y,
    MT,
}

/// GRCh37 chromosome lengths, in canonical order (1..22, X, Y, MT).
pub const GRCH37_LENGTHS: [u32; 25] = [
    249_250_621, 243_199_373, 198_022_430, 191_154_276, 180_915_260, 171_115_067,
    159_138_663, 146_364_022, 141_213_431, 135_534_747, 135_006_516, 133_851_895,
    115_169_878, 107_349_540, 102_531_392, 90_354_753, 81_195_210, 78_077_248,
    59_128_983, 63_025_520, 48_129_895, 51_304_566, 155_270_560, 59_373_566, 16_569,
];

impl Chrom {
    /// Numeric code used in columnar storage: 1..22, X=23, Y=24, MT=25.
    pub fn code(self) -> u8 {
        match self {
            Chrom::Auto(n) => n,
            Chrom::X => 23,
            Chrom::Y => 24,
            Chrom::MT => 25,
        }
    }

    pub fn from_code(code: u8) -> Option<Chrom> {
        match code {
            1..=22 => Some(Chrom::Auto(code)),
            23 => Some(Chrom::X),
            24 => Some(Chrom::Y),
            25 => Some(Chrom::MT),
            _ => None,
        }
    }

    pub fn length(self, build: Build) -> u32 {
        match build {
            Build::GRCh37 => GRCH37_LENGTHS[(self.code() - 1) as usize],
        }
    }

    /// Chromosomes where a chip reports one allele for a male sample
    /// (X outside the pseudoautosomal regions, Y) or always (MT).
    pub fn can_be_haploid(self) -> bool {
        matches!(self, Chrom::X | Chrom::Y | Chrom::MT)
    }

    /// Parse the spellings vendors use. `XY` (pseudoautosomal, used by
    /// AncestryDNA as 25) maps to X; the position is unchanged on GRCh37.
    pub fn parse(s: &str) -> Option<Chrom> {
        let t = s.trim();
        let t = t.strip_prefix("chr").or_else(|| t.strip_prefix("Chr")).unwrap_or(t);
        match t {
            "X" | "x" | "23" | "XY" | "25" => Some(Chrom::X),
            "Y" | "y" | "24" => Some(Chrom::Y),
            "MT" | "M" | "mt" | "m" | "26" => Some(Chrom::MT),
            _ => match t.parse::<u8>() {
                Ok(n @ 1..=22) => Some(Chrom::Auto(n)),
                _ => None,
            },
        }
    }
}

impl fmt::Display for Chrom {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Chrom::Auto(n) => write!(f, "{n}"),
            Chrom::X => f.write_str("X"),
            Chrom::Y => f.write_str("Y"),
            Chrom::MT => f.write_str("MT"),
        }
    }
}

impl FromStr for Chrom {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Chrom::parse(s).ok_or_else(|| format!("unknown chromosome '{s}'"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_vendor_spellings() {
        assert_eq!(Chrom::parse("chr2"), Some(Chrom::Auto(2)));
        assert_eq!(Chrom::parse("23"), Some(Chrom::X));
        assert_eq!(Chrom::parse("MT"), Some(Chrom::MT));
        assert_eq!(Chrom::parse("26"), Some(Chrom::MT));
        assert_eq!(Chrom::parse("0"), None);
        assert_eq!(Chrom::parse("23andMe"), None);
    }

    #[test]
    fn codes_round_trip() {
        for code in 1..=25 {
            assert_eq!(Chrom::from_code(code).unwrap().code(), code);
        }
    }
}
