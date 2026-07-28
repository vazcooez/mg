import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { NoteDoc } from '../types';
import * as S from '../store';
import {
  Block,
  renderBlock,
  renderedOffsetToSource,
  replaceBlock,
  scanBlocks,
  toggleTask,
} from '../markdown';

interface Props {
  doc: NoteDoc;
  onOpenLink: (target: string) => void;
}

/**
 * Obsidian-style live preview. Every block renders as HTML except the one
 * holding the caret, which becomes a plain textarea showing its markdown
 * source. The document text in the store stays the single source of truth —
 * blocks are re-derived from it on every keystroke.
 */
export default function LiveMarkdown({ doc, onOpenLink }: Props) {
  const blocks = useMemo(() => scanBlocks(doc.content), [doc.content]);
  const [active, setActive] = useState<number | null>(null);
  /** Caret offset to apply once the source textarea mounts. */
  const pendingCaret = useRef<number | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Keep the active index inside range as the document shrinks.
  useEffect(() => {
    if (active != null && active >= blocks.length) setActive(blocks.length - 1);
  }, [active, blocks.length]);

  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta || active == null) return;
    ta.focus({ preventScroll: true });
    if (pendingCaret.current != null) {
      const at = Math.max(0, Math.min(pendingCaret.current, ta.value.length));
      ta.setSelectionRange(at, at);
      pendingCaret.current = null;
      ta.scrollIntoView({ block: 'nearest' });
    }
  }, [active]);

  const enter = useCallback((index: number, caret: number) => {
    pendingCaret.current = caret;
    setActive(index);
  }, []);

  const write = useCallback(
    (b: Block, text: string) => S.setNoteContent(doc.id, replaceBlock(doc.content, b, text)),
    [doc.id, doc.content]
  );

  /* ------------------------------------------------------- click routing */

  const onClick = (e: React.MouseEvent) => {
    const el = e.target as HTMLElement;

    const link = el.closest<HTMLElement>('a.wikilink');
    if (link) {
      e.preventDefault();
      onOpenLink(link.dataset.target ?? '');
      return;
    }
    if (el.closest('a.hashtag')) {
      e.preventDefault();
      return;
    }
    const anchor = el.closest<HTMLAnchorElement>('a[href]');
    if (anchor && /^https?:/i.test(anchor.getAttribute('href') ?? '')) {
      e.preventDefault();
      window.open(anchor.href, '_blank');
      return;
    }

    const host = el.closest<HTMLElement>('[data-block]');
    if (!host) return;
    const index = Number(host.dataset.block);
    const b = blocks[index];
    if (!b) return;

    if (el instanceof HTMLInputElement && el.type === 'checkbox' && el.dataset.task != null) {
      e.preventDefault();
      // Task index is per-block; offset it by the tasks in earlier blocks.
      const before = blocks
        .slice(0, index)
        .reduce((n, x) => n + countTasks(x.src), 0);
      S.setNoteContent(doc.id, toggleTask(doc.content, before + Number(el.dataset.task)));
      return;
    }

    enter(index, caretOffsetFromClick(host, b, e.clientX, e.clientY));
  };

  /* ------------------------------------------------------ key navigation */

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>, index: number, b: Block) => {
    const ta = e.currentTarget;
    const { selectionStart: a, selectionEnd: z, value } = ta;
    const atStart = a === 0 && z === 0;
    const atEnd = a === value.length && z === value.length;
    const firstLine = !value.slice(0, a).includes('\n');
    const lastLine = !value.slice(a).includes('\n');

    if (e.key === 'Escape') {
      e.preventDefault();
      setActive(null);
      rootRef.current?.focus();
      return;
    }

    // Enter splits single-line blocks into two; multi-line blocks keep it.
    if (e.key === 'Enter' && !e.shiftKey && b.kind !== 'fence' && b.kind !== 'table') {
      e.preventDefault();
      const head = value.slice(0, a);
      const tail = value.slice(z);
      write(b, `${head}\n${continuation(head)}${tail}`);
      enter(index + 1, continuation(head).length);
      return;
    }

    if (e.key === 'Backspace' && atStart && index > 0) {
      e.preventDefault();
      const prev = blocks[index - 1];
      const merged = prev.src + value;
      const next = replaceBlock(doc.content, { ...prev, end: b.end }, merged);
      S.setNoteContent(doc.id, next);
      enter(index - 1, prev.src.length);
      return;
    }

    if (e.key === 'Delete' && atEnd && index < blocks.length - 1) {
      e.preventDefault();
      const nextB = blocks[index + 1];
      const merged = value + nextB.src;
      S.setNoteContent(doc.id, replaceBlock(doc.content, { ...b, end: nextB.end }, merged));
      enter(index, value.length);
      return;
    }

    if (e.key === 'ArrowUp' && firstLine && index > 0) {
      e.preventDefault();
      enter(index - 1, blocks[index - 1].src.length);
      return;
    }
    if (e.key === 'ArrowDown' && lastLine && index < blocks.length - 1) {
      e.preventDefault();
      enter(index + 1, 0);
      return;
    }
    if (e.key === 'ArrowLeft' && atStart && index > 0) {
      e.preventDefault();
      enter(index - 1, blocks[index - 1].src.length);
      return;
    }
    if (e.key === 'ArrowRight' && atEnd && index < blocks.length - 1) {
      e.preventDefault();
      enter(index + 1, 0);
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      const next = e.shiftKey
        ? value.replace(/^ {1,2}/, '')
        : `${value.slice(0, a)}  ${value.slice(z)}`;
      write(b, next);
      enter(index, e.shiftKey ? Math.max(0, a - 2) : a + 2);
      return;
    }

    if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'i')) {
      e.preventDefault();
      const marker = e.key === 'b' ? '**' : '*';
      write(b, `${value.slice(0, a)}${marker}${value.slice(a, z)}${marker}${value.slice(z)}`);
      enter(index, z + marker.length * 2);
    }
  };

  return (
    <div
      className="live-editor markdown-body"
      ref={rootRef}
      tabIndex={-1}
      onClick={onClick}
      onMouseDown={(e) => {
        // Clicking blank space below the last block appends there.
        if (e.target === e.currentTarget) {
          const last = blocks.length - 1;
          enter(last, blocks[last].src.length);
        }
      }}
    >
      {blocks.map((b, i) =>
        i === active ? (
          <textarea
            key={`src-${i}`}
            ref={taRef}
            className={`live-source live-${b.kind}`}
            value={b.src}
            rows={b.end - b.start + 1}
            spellCheck={false}
            onChange={(e) => write(b, e.target.value)}
            onKeyDown={(e) => onKeyDown(e, i, b)}
            onBlur={(e) => {
              // Only leave source mode when focus really left the editor.
              if (!rootRef.current?.contains(e.relatedTarget as Node)) setActive(null);
            }}
          />
        ) : b.kind === 'blank' ? (
          <div key={`b-${i}`} data-block={i} className="live-block live-blank" />
        ) : (
          <div
            key={`b-${i}`}
            data-block={i}
            className={`live-block live-${b.kind}`}
            dangerouslySetInnerHTML={{ __html: renderBlock(b) }}
          />
        )
      )}
      <div
        className="live-tail"
        onClick={() => {
          const last = blocks.length - 1;
          enter(last, blocks[last].src.length);
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------- helpers */

function countTasks(src: string): number {
  return (src.match(/^(\s*(?:[-*+]|\d+[.)])\s+\[)[ xX](\])/gm) ?? []).length;
}

/** Repeats list markers and quote prefixes onto the line Enter creates. */
function continuation(head: string): string {
  const line = head.slice(head.lastIndexOf('\n') + 1);
  const bullet = /^(\s*)([-*+])\s+(\[[ xX]\]\s+)?/.exec(line);
  if (bullet) return `${bullet[1]}${bullet[2]} ${bullet[3] ? '[ ] ' : ''}`;
  const ordered = /^(\s*)(\d+)([.)])\s+/.exec(line);
  if (ordered) return `${ordered[1]}${Number(ordered[2]) + 1}${ordered[3]} `;
  const quote = /^(\s*>\s?)/.exec(line);
  if (quote) return quote[1];
  return '';
}

/** Best-effort caret placement from a click inside rendered HTML. */
function caretOffsetFromClick(host: HTMLElement, b: Block, x: number, y: number): number {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  const pos = doc.caretPositionFromPoint?.(x, y);
  if (!pos || !host.contains(pos.offsetNode)) return b.src.length;

  // Text rendered before the click point, walking the block's text nodes.
  let prefix = '';
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (node === pos.offsetNode) {
      prefix += (node.textContent ?? '').slice(0, pos.offset);
      break;
    }
    prefix += node.textContent ?? '';
    node = walker.nextNode();
  }
  return renderedOffsetToSource(b.src, prefix);
}
