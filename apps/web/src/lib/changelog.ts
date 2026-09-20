/**
 * CHANGELOG.md, read at build time and shaped for the page.
 *
 * The file in the repository is the single source: it is what a reader sees on
 * GitHub, and what the app shows. A markdown library would be a large
 * dependency for four constructs, so this reads exactly the shape we write —
 * `## version — date`, `### section`, `- item` — and puts anything it does not
 * recognise through as a paragraph rather than dropping it.
 */
import source from '../../../../CHANGELOG.md?raw';

export interface Section {
  /** "Added", "Changed", "Fixed", or '' for text before any section. */
  title: string;
  items: string[];
}

export interface Release {
  version: string;
  date: string;
  /** The line under the heading, when there is one. */
  summary: string;
  sections: Section[];
}

/** `**bold**` and `` `code` `` become spans; everything else stays text. */
export interface Fragment {
  text: string;
  style: 'plain' | 'strong' | 'code';
}

export function fragments(text: string): Fragment[] {
  const out: Fragment[] = [];
  const pattern = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let at = 0;
  for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
    if (m.index > at) out.push({ text: text.slice(at, m.index), style: 'plain' });
    out.push(m[1] ? { text: m[1], style: 'strong' } : { text: m[2]!, style: 'code' });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at), style: 'plain' });
  return out;
}

/** Markdown escapes we write, undone: `\*` is a literal asterisk. */
const unescape = (s: string) => s.replace(/\\([*_`])/g, '$1');

export function parseChangelog(markdown = source): Release[] {
  const releases: Release[] = [];
  let release: Release | null = null;
  let section: Section | null = null;

  for (const raw of markdown.split('\n')) {
    const line = raw.trimEnd();

    const heading = /^##\s+(\S+)\s*(?:—|-)\s*(.+)$/.exec(line);
    if (heading) {
      release = { version: heading[1]!, date: heading[2]!.trim(), summary: '', sections: [] };
      releases.push(release);
      section = null;
      continue;
    }
    if (!release) continue; // the file's own title and preamble

    const sub = /^###\s+(.+)$/.exec(line);
    if (sub) {
      section = { title: sub[1]!, items: [] };
      release.sections.push(section);
      continue;
    }

    const item = /^[-*]\s+(.+)$/.exec(line);
    if (item) {
      if (!section) {
        section = { title: '', items: [] };
        release.sections.push(section);
      }
      section.items.push(unescape(item[1]!));
      continue;
    }

    if (!line.trim()) continue;
    // Loose prose: the summary under a version, or an unrecognised paragraph.
    if (!section && !release.summary) release.summary = unescape(line.trim());
    else if (section) section.items.push(unescape(line.trim()));
  }
  return releases;
}
