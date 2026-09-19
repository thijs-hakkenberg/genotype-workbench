//! Single-letter alleles as reported by genotyping chips.

use std::fmt;

/// A nucleotide on the plus strand.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Base {
    A,
    C,
    G,
    T,
}

impl Base {
    pub fn from_char(c: char) -> Option<Base> {
        match c.to_ascii_uppercase() {
            'A' => Some(Base::A),
            'C' => Some(Base::C),
            'G' => Some(Base::G),
            'T' => Some(Base::T),
            _ => None,
        }
    }

    pub fn from_byte(b: u8) -> Option<Base> {
        Base::from_char(b as char)
    }

    pub fn complement(self) -> Base {
        match self {
            Base::A => Base::T,
            Base::T => Base::A,
            Base::C => Base::G,
            Base::G => Base::C,
        }
    }

    pub fn as_char(self) -> char {
        match self {
            Base::A => 'A',
            Base::C => 'C',
            Base::G => 'G',
            Base::T => 'T',
        }
    }

    pub fn as_byte(self) -> u8 {
        self.as_char() as u8
    }
}

impl fmt::Display for Base {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_char())
    }
}

/// One allele of a chip call. Consumer chips report indels as `I`/`D`
/// without the inserted or deleted sequence, so those cannot be turned into
/// VCF ref/alt without the vendor's probe manifest.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Allele {
    Base(Base),
    Ins,
    Del,
}

impl Allele {
    pub fn from_char(c: char) -> Option<Allele> {
        match c.to_ascii_uppercase() {
            'I' => Some(Allele::Ins),
            'D' => Some(Allele::Del),
            other => Base::from_char(other).map(Allele::Base),
        }
    }

    pub fn as_char(self) -> char {
        match self {
            Allele::Base(b) => b.as_char(),
            Allele::Ins => 'I',
            Allele::Del => 'D',
        }
    }

    pub fn as_byte(self) -> u8 {
        self.as_char() as u8
    }

    pub fn base(self) -> Option<Base> {
        match self {
            Allele::Base(b) => Some(b),
            _ => None,
        }
    }
}

impl fmt::Display for Allele {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_char())
    }
}
