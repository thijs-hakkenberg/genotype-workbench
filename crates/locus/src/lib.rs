//! The Locus language: which position, which alleles, on which build.
//!
//! This crate is the single reference implementation of normalization
//! (ADR-0008). The browser (WASM), the desktop shell and the pack pipeline
//! (Python) all call into it, so joins between kits and packs agree exactly.

pub mod allele;
pub mod chrom;
pub mod key;
pub mod normalize;
pub mod reference;
pub mod variant;

pub use allele::{Allele, Base};
pub use chrom::{Build, Chrom};
pub use key::LocusKey;
pub use normalize::{normalize, Call, Genotype, RawCall, RefCheck};
pub use reference::{ReferenceIndex, SortedReference};
pub use variant::{trim_variant, TrimmedVariant};

/// Version of the Locus language this crate implements. Recorded on every kit
/// and pack; a major bump is a data migration.
pub const LOCUS_VERSION: &str = env!("CARGO_PKG_VERSION");
