import { DocKindName, Workspace } from './types';
import { serializeDoc } from './store';

/**
 * Find in Vault: a text search across every document, the way VS Code's
 * search view works.
 *
 * Open buffers are searched as they stand, unsaved edits included, so a result
 * always points at text that is really there. Everything else is read from
 * disk through the vault bridge and cached by modification time, which makes
 * refining a query as you type cheap after the first pass.
 */

export interface SearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regexp: boolean;
}

export interface SearchMatch {
  /** 1-based line in a note; 0 for text inside a todo document or diagram. */
  line: number;
  /** Column of the match within the line, and its length. */
  ch: number;
  length: number;
  /** The line (or field) the match sits in, as shown in the results. */
  text: string;
  /** For structured documents: what the text is — an item, a node, a description. */
  label?: string;
}

export interface FileResult {
  /** Vault path; null for a buffer that has never been saved. */
  rel: string | null;
  docId: string | null;
  title: string;
  type: DocKindName;
  matches: SearchMatch[];
}

export interface SearchOutcome {
  results: FileResult[];
  matchCount: number;
  /** The match limit was reached and the search stopped early. */
  truncated: boolean;
  error?: string;
}

/** Past this many matches the list stops being something a person reads. */
const MATCH_LIMIT = 5000;
/** Files read from disk at once. */
const READ_CONCURRENCY = 16;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The query as a global regular expression; throws on an invalid pattern. */
export function buildMatcher(query: string, opts: SearchOptions): RegExp {
  let source = opts.regexp ? query : escapeRegExp(query);
  if (opts.wholeWord) source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`;
  return new RegExp(source, `gu${opts.caseSensitive ? '' : 'i'}`);
}

interface Line {
  line: number;
  text: string;
  label?: string;
}

/**
 * The text of a document, line by line. Notes are their lines; todo
 * documents and diagrams are JSON, so what is searched is what a person
 * wrote — titles, descriptions, property values, node text — not the markup.
 */
function searchableLines(type: DocKindName, content: string): Line[] {
  if (type === 'note') return content.split('\n').map((text, i) => ({ line: i + 1, text }));
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(content);
  } catch {
    return [];
  }
  const out: Line[] = [];
  const add = (text: unknown, label: string) => {
    if (typeof text !== 'string' || !text) return;
    for (const part of text.split('\n')) if (part.trim()) out.push({ line: 0, text: part, label });
  };
  if (type === 'todo') {
    add(data.title, 'Title');
    for (const item of (data.items as Array<Record<string, unknown>>) ?? []) {
      if (item.deletedAt) continue;
      add(item.title, 'Item');
      add(item.assignee, 'Assignee');
      add(item.description, 'Description');
      for (const [name, value] of Object.entries((item.properties as Record<string, unknown>) ?? {})) {
        add(value, name);
      }
    }
  } else if (type === 'diagram') {
    add(data.title, 'Title');
    for (const node of (data.nodes as Array<Record<string, unknown>>) ?? []) add(node.text, 'Node');
    for (const edge of (data.edges as Array<Record<string, unknown>>) ?? []) add(edge.label, 'Connector');
  }
  return out;
}

/** Disk contents by path, kept while the file's modification time is unchanged. */
const cache = new Map<string, { mtime: number; content: string }>();

async function readCached(rel: string, mtime: number): Promise<string | null> {
  const hit = cache.get(rel);
  if (hit && hit.mtime === mtime) return hit.content;
  const res = await window.api?.file.read(rel);
  if (!res?.ok || res.content == null) return null;
  cache.set(rel, { mtime, content: res.content });
  return res.content;
}

/**
 * Runs a search. `isCurrent` lets a newer search cancel this one: it is
 * checked between files, and a superseded search returns null.
 */
export async function searchVault(
  ws: Workspace,
  query: string,
  opts: SearchOptions,
  isCurrent: () => boolean
): Promise<SearchOutcome | null> {
  let matcher: RegExp;
  try {
    matcher = buildMatcher(query, opts);
  } catch (err) {
    return { results: [], matchCount: 0, truncated: false, error: (err as Error).message };
  }

  const results: FileResult[] = [];
  let matchCount = 0;
  let truncated = false;

  const scan = (lines: Line[]): SearchMatch[] => {
    const found: SearchMatch[] = [];
    for (const { line, text, label } of lines) {
      matcher.lastIndex = 0;
      for (let m = matcher.exec(text); m; m = matcher.exec(text)) {
        // An empty match (`^`, `\b`) finds nothing to show; step past it.
        if (!m[0].length) {
          matcher.lastIndex++;
          continue;
        }
        found.push({ line, ch: m.index, length: m[0].length, text, label });
        if (++matchCount >= MATCH_LIMIT) {
          truncated = true;
          return found;
        }
      }
    }
    return found;
  };

  // Open buffers first, as they are now.
  const openPaths = new Set<string>();
  for (const doc of ws.docs) {
    if (doc.type === 'image') continue;
    if (doc.path) openPaths.add(doc.path);
    const matches = scan(searchableLines(doc.type, serializeDoc(doc)));
    if (matches.length) {
      results.push({ rel: doc.path, docId: doc.id, title: doc.title, type: doc.type, matches });
    }
    if (truncated) break;
  }

  const pending = ws.files.filter((f) => f.type !== 'image' && !openPaths.has(f.rel));
  for (let i = 0; i < pending.length && !truncated; i += READ_CONCURRENCY) {
    const batch = pending.slice(i, i + READ_CONCURRENCY);
    const contents = await Promise.all(batch.map((f) => readCached(f.rel, f.mtime)));
    if (!isCurrent()) return null;
    batch.forEach((file, j) => {
      const content = contents[j];
      if (content == null || truncated) return;
      const matches = scan(searchableLines(file.type, content));
      if (matches.length) {
        const title = file.name.replace(/\.[^.]+$/, '');
        results.push({ rel: file.rel, docId: null, title, type: file.type, matches });
      }
    });
  }

  // Grouped the way the explorer reads: by path, unsaved buffers first.
  results.sort((a, b) => (a.rel ?? '').localeCompare(b.rel ?? ''));
  return { results, matchCount, truncated };
}
