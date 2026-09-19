//! Golden-file test (Decisions B2 sensitivity point): the committed synthetic
//! kit must normalize to exactly the recorded summary. Any change to the
//! normalizer that moves these numbers has to update the golden file on purpose:
//! `UPDATE_GOLDEN=1 cargo test -p genotype-import --test golden`.

use genotype_import::{import, FormatProfile};
use locus::reference::NoReference;
use locus::RefCheck;
use std::fmt::Write;
use std::path::PathBuf;

fn repo() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

#[test]
fn synthetic_v5_small_matches_golden() {
    let profile = FormatProfile::from_json(&std::fs::read_to_string(repo().join("plugins/profile-23andme/profile.json")).unwrap()).unwrap();
    let kit = std::fs::read(repo().join("fixtures/synthetic-kits/synthetic-v5-small.txt")).unwrap();
    let out = import(&kit, &profile, &NoReference, 0, &mut |_| {}).unwrap();

    let mut summary = String::new();
    let s = &out.stats;
    writeln!(summary, "rows_read {}", s.rows_read).unwrap();
    writeln!(summary, "calls {}", s.calls).unwrap();
    writeln!(summary, "no_calls {}", s.no_calls).unwrap();
    writeln!(summary, "strand_ambiguous {}", s.strand_ambiguous).unwrap();
    writeln!(summary, "rejected {}", s.rejected).unwrap();
    writeln!(summary, "duplicates_merged {}", s.duplicates_merged).unwrap();
    for r in RefCheck::ALL {
        writeln!(summary, "ref_check {} {}", r, s.ref_checks[r.code() as usize]).unwrap();
    }
    // A sample of calls, so representation changes show up too.
    for c in out.calls.iter().step_by(250) {
        let gt = match (c.a1(), c.a2()) {
            (Some(a), Some(b)) => format!("{a}{b}"),
            (Some(a), None) => a.to_string(),
            _ => "--".into(),
        };
        writeln!(summary, "call {}:{} {} {} {}", c.chrom, c.pos, c.rsid, gt, c.strand_ambiguous).unwrap();
    }

    let golden = repo().join("fixtures/synthetic-kits/synthetic-v5-small.golden.txt");
    if std::env::var("UPDATE_GOLDEN").is_ok() || !golden.exists() {
        std::fs::write(&golden, &summary).unwrap();
    }
    assert_eq!(summary, std::fs::read_to_string(&golden).unwrap(), "normalizer output changed; see test docs");
}
