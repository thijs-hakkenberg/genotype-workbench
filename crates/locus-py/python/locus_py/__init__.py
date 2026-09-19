"""Python bindings to the Rust locus normalizer (ADR-0008)."""

from ._locus import (  # noqa: F401
    LOCUS_VERSION,
    canonical_chrom,
    chrom_code,
    complement,
    locus_key,
    trim_variant,
)
