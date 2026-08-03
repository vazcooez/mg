import { marked } from 'marked';
import { resolveVaultRef } from './types';

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* Obsidian-flavoured extensions -------------------------------------- */

/** `[[Target]]` / `[[Target|Alias]]`, and `![[Target]]` embeds rendered as links. */
const wikilink = {
  name: 'wikilink',
  level: 'inline' as const,
  start(src: string) {
    const i = src.indexOf('[[');
    return i < 0 ? undefined : i;
  },
  tokenizer(src: string) {
    const m = /^(!?)\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/.exec(src);
    if (!m) return undefined;
    return {
      type: 'wikilink',
      raw: m[0],
      embed: m[1] === '!',
      target: m[2].trim(),
      label: (m[3] ?? m[2]).trim(),
    };
  },
  renderer(token: { embed: boolean; target: string; label: string }) {
    return `<a href="#" class="wikilink${token.embed ? ' embed' : ''}" data-target="${escapeHtml(
      token.target
    )}">${escapeHtml(token.label)}</a>`;
  },
};

/** `#tag` and `#nested/tag`. */
const tag = {
  name: 'hashtag',
  level: 'inline' as const,
  start(src: string) {
    const i = src.indexOf('#');
    return i < 0 ? undefined : i;
  },
  tokenizer(src: string) {
    const m = /^#([A-Za-z0-9_\-/]*[A-Za-z][A-Za-z0-9_\-/]*)/.exec(src);
    if (!m) return undefined;
    return { type: 'hashtag', raw: m[0], name: m[1] };
  },
  renderer(token: { name: string }) {
    return `<a href="#" class="hashtag" data-tag="${escapeHtml(token.name)}">#${escapeHtml(
      token.name
    )}</a>`;
  },
};

/** `==highlighted==` */
const highlight = {
  name: 'highlight',
  level: 'inline' as const,
  start(src: string) {
    const i = src.indexOf('==');
    return i < 0 ? undefined : i;
  },
  tokenizer(src: string) {
    const m = /^==(?=\S)([\s\S]*?\S)==/.exec(src);
    if (!m) return undefined;
    return { type: 'highlight', raw: m[0], tokens: (this as any).lexer.inlineTokens(m[1]) };
  },
  renderer(this: any, token: { tokens: unknown[] }) {
    return `<mark>${this.parser.parseInline(token.tokens)}</mark>`;
  },
};

const CALLOUT_ICON: Record<string, string> = {
  note: '✎',
  info: 'i',
  tip: '★',
  hint: '★',
  important: '!',
  warning: '⚠',
  caution: '⚠',
  danger: '⚠',
  error: '⚠',
  success: '✓',
  check: '✓',
  done: '✓',
  question: '?',
  faq: '?',
  quote: '❝',
  todo: '☐',
  example: '❯',
  bug: '✻',
  abstract: '≡',
  summary: '≡',
};

/** Obsidian callouts: `> [!warning] Title` followed by quoted body lines. */
const callout = {
  name: 'callout',
  level: 'block' as const,
  start(src: string) {
    const m = /^ {0,3}> *\[!/m.exec(src);
    return m ? m.index : undefined;
  },
  tokenizer(src: string) {
    const m = /^ {0,3}> *\[!([A-Za-z]+)\]([+-]?)([^\n]*)\n?((?: {0,3}>[^\n]*(?:\n|$))*)/.exec(src);
    if (!m) return undefined;
    const body = m[4].replace(/^ {0,3}> ?/gm, '');
    return {
      type: 'callout',
      raw: m[0],
      kind: m[1].toLowerCase(),
      fold: m[2],
      title: m[3].trim(),
      tokens: (this as any).lexer.blockTokens(body, []),
    };
  },
  renderer(this: any, token: { kind: string; fold: string; title: string; tokens: unknown[] }) {
    const kind = token.kind;
    const icon = CALLOUT_ICON[kind] ?? '✎';
    const title = token.title || kind.charAt(0).toUpperCase() + kind.slice(1);
    const body = this.parser.parse(token.tokens);
    const open = token.fold === '-' ? '' : ' open';
    if (token.fold) {
      return `<details class="callout callout-${escapeHtml(kind)}"${open}>
<summary class="callout-title"><span class="callout-icon">${icon}</span>${escapeHtml(title)}</summary>
<div class="callout-body">${body}</div></details>`;
    }
    return `<div class="callout callout-${escapeHtml(kind)}">
<div class="callout-title"><span class="callout-icon">${icon}</span>${escapeHtml(title)}</div>
<div class="callout-body">${body}</div></div>`;
  },
};

marked.use({
  gfm: true,
  breaks: false,
  extensions: [wikilink, tag, highlight, callout] as never,
});

/**
 * Renders markdown to HTML. Task-list checkboxes are made interactive and
 * indexed so the preview can write toggles back into the source.
 */
export function renderMarkdown(src: string): string {
  let html = marked.parse(src, { async: false }) as string;
  html = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  // Wrap tables so a wide one scrolls inside its own box instead of stretching
  // the page — `display: block` on the table itself broke column widths.
  html = html.replace(/<table>/g, '<div class="md-table-wrap"><table>').replace(/<\/table>/g, '</table></div>');
  let n = 0;
  html = html.replace(/<input([^>]*?)type="checkbox"([^>]*?)>/gi, (_m, a: string, b: string) => {
    const attrs = (a + b).replace(/\sdisabled(="[^"]*")?/gi, '');
    return `<input${attrs}type="checkbox" data-task="${n++}">`;
  });
  return html;
}

/** Renders a single run of text — no paragraphs. Used inside table cells. */
export function renderInline(src: string): string {
  return (marked.parseInline(src, { async: false }) as string).replace(
    /<script[\s\S]*?<\/script>/gi,
    ''
  );
}

/**
 * Rewrites relative image sources onto the vault protocol so pictures stored
 * beside a note actually load. `baseRel` is the note's own path.
 */
export function resolveImages(html: string, baseRel: string | null): string {
  return html.replace(/<img([^>]*?)src="([^"]*)"([^>]*)>/gi, (m, pre, src, post) => {
    if (/^(https?:|data:|blob:|mg-vault:)/i.test(src)) return m;
    return `<img${pre}src="${resolveVaultRef(baseRel, decodeURI(src))}"${post}>`;
  });
}

const TASK_RE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/gm;

/** Flips the nth `- [ ]` / `- [x]` marker in the source text. */
export function toggleTask(src: string, index: number): string {
  let i = 0;
  return src.replace(TASK_RE, (match, head: string, mark: string, tail: string) => {
    if (i++ !== index) return match;
    return head + (mark === ' ' ? 'x' : ' ') + tail;
  });
}

/** Strips fenced blocks and inline code so scanners ignore code samples. */
function withoutCode(src: string): string {
  return src
    .replace(/^(```|~~~)[\s\S]*?^\1.*$/gm, '')
    .replace(/`[^`\n]*`/g, '');
}

/** Collects `[[links]]` from a note so the outline can show them. */
export function extractLinks(src: string): string[] {
  const out = new Set<string>();
  for (const m of withoutCode(src).matchAll(/!?\[\[([^\]\n|]+)(?:\|[^\]\n]+)?\]\]/g))
    out.add(m[1].trim());
  return [...out];
}

/* ------------------------------------------------ live-preview blocks */

export type BlockKind = 'fence' | 'table' | 'quote' | 'blank' | 'line';

export interface Block {
  /** First and last source line indices, inclusive. */
  start: number;
  end: number;
  src: string;
  kind: BlockKind;
  /** Ordered-list items keep their number so rendering does not restart at 1. */
  olStart?: number;
}

const FENCE_RE = /^\s*(```|~~~)/;
const TABLE_DELIM_RE = /^\s*\|?[\s:|-]*-[\s:|-]*$/;
const OL_RE = /^\s*(\d+)[.)]\s/;

/**
 * Splits markdown into the units the live editor toggles between rendered and
 * raw. Constructs that only make sense as a whole (fenced code, tables,
 * blockquotes/callouts) stay together; everything else is one line per block,
 * so the caret only ever un-renders the line you are actually on.
 */
export function scanBlocks(src: string): Block[] {
  const lines = src.split('\n');
  const out: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    const fence = FENCE_RE.exec(line);
    if (fence) {
      const marker = fence[1];
      let j = i + 1;
      while (j < lines.length && !lines[j].trimStart().startsWith(marker)) j++;
      if (j < lines.length) j++; // include the closing fence
      out.push(block(lines, i, j - 1, 'fence'));
      i = j;
      continue;
    }

    if (line.includes('|') && line.trim() && TABLE_DELIM_RE.test(lines[i + 1] ?? '')) {
      let j = i + 2;
      while (j < lines.length && lines[j].includes('|') && lines[j].trim()) j++;
      out.push(block(lines, i, j - 1, 'table'));
      i = j;
      continue;
    }

    if (/^\s{0,3}>/.test(line)) {
      let j = i + 1;
      while (j < lines.length && /^\s{0,3}>/.test(lines[j])) j++;
      out.push(block(lines, i, j - 1, 'quote'));
      i = j;
      continue;
    }

    const b = block(lines, i, i, line.trim() ? 'line' : 'blank');
    const ol = OL_RE.exec(line);
    if (ol) b.olStart = Number(ol[1]);
    out.push(b);
    i++;
  }

  // An empty document still needs one block to click into.
  if (!out.length) out.push({ start: 0, end: 0, src: '', kind: 'blank' });
  return out;
}

function block(lines: string[], start: number, end: number, kind: BlockKind): Block {
  return { start, end, kind, src: lines.slice(start, end + 1).join('\n') };
}

/** Renders one block, preserving ordered-list numbering across blocks. */
export function renderBlock(b: Block): string {
  if (b.kind === 'blank') return '';
  let html = renderMarkdown(b.src);
  if (b.olStart != null && b.olStart !== 1) {
    html = html.replace(/^(\s*)<ol>/, `$1<ol start="${b.olStart}">`);
  }
  return html;
}

/** Swaps a block's source lines back into the full document. */
export function replaceBlock(src: string, b: Block, text: string): string {
  const lines = src.split('\n');
  lines.splice(b.start, b.end - b.start + 1, ...text.split('\n'));
  return lines.join('\n');
}

/**
 * Maps an offset in a block's *rendered* text onto the nearest offset in its
 * markdown source, by walking both and skipping markup characters. Used to put
 * the caret roughly where the user clicked in the rendered view.
 */
export function renderedOffsetToSource(src: string, renderedPrefix: string): number {
  let si = 0;
  for (const ch of renderedPrefix) {
    while (si < src.length && src[si] !== ch) si++;
    if (si < src.length) si++;
  }
  return Math.min(si, src.length);
}

export interface Heading {
  level: number;
  text: string;
  line: number;
}

/** Headings outside fenced code blocks, for the outline pane. */
export function extractHeadings(src: string): Heading[] {
  const out: Heading[] = [];
  let fenced = false;
  src.split('\n').forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced) return;
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) out.push({ level: m[1].length, text: m[2].trim(), line: i });
  });
  return out;
}
