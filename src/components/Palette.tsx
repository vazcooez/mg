import { useEffect, useMemo, useRef, useState } from 'react';

export interface PaletteEntry {
  id: string;
  label: string;
  detail?: string;
  kind?: 'todo' | 'note';
  run: () => void;
}

interface Scored {
  entry: PaletteEntry;
  score: number;
  hits: number[];
}

/** Sublime-ish subsequence match: earlier and more contiguous hits score higher. */
function fuzzy(query: string, text: string): { score: number; hits: number[] } | null {
  if (!query) return { score: 0, hits: [] };
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const hits: number[] = [];
  let score = 0;
  let ti = 0;
  let prev = -2;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    if (ch === ' ') continue;
    const at = t.indexOf(ch, ti);
    if (at < 0) return null;
    hits.push(at);
    score += at === prev + 1 ? 6 : 1;
    if (at === 0 || /[\s/\-_:.]/.test(t[at - 1] ?? '')) score += 4;
    score -= Math.min(at - ti, 6) * 0.4;
    prev = at;
    ti = at + 1;
  }
  return { score: score - text.length * 0.01, hits };
}

function Highlight({ text, hits }: { text: string; hits: number[] }) {
  if (!hits.length) return <>{text}</>;
  const set = new Set(hits);
  return (
    <>
      {Array.from(text).map((ch, i) =>
        set.has(i) ? (
          <em key={i} className="hl">
            {ch}
          </em>
        ) : (
          <span key={i}>{ch}</span>
        )
      )}
    </>
  );
}

export default function Palette({
  mode,
  entries,
  onClose,
}: {
  mode: 'goto' | 'command';
  entries: PaletteEntry[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo<Scored[]>(() => {
    const q = query.trim();
    if (!q) return entries.map((entry) => ({ entry, score: 0, hits: [] }));
    const out: Scored[] = [];
    for (const entry of entries) {
      const m = fuzzy(q, entry.label);
      if (m) out.push({ entry, score: m.score, hits: m.hits });
    }
    return out.sort((a, b) => b.score - a.score);
  }, [entries, query]);

  useEffect(() => setSel(0), [query]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('.palette-row.sel');
    el?.scrollIntoView({ block: 'nearest' });
  }, [sel, results]);

  const commit = (i: number) => {
    const hit = results[i];
    if (!hit) return;
    onClose();
    // Defer so the palette unmounts before the action changes layout/focus.
    setTimeout(() => hit.entry.run(), 0);
  };

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          className="palette-input"
          autoFocus
          spellCheck={false}
          value={query}
          placeholder={mode === 'goto' ? 'Goto Anything — type a document name' : 'Type a command…'}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSel((s) => Math.min(results.length - 1, s + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSel((s) => Math.max(0, s - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              commit(sel);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onClose();
            }
          }}
        />
        <div className="palette-list" ref={listRef}>
          {results.length === 0 && <div className="palette-empty">No matches</div>}
          {results.slice(0, 80).map((r, i) => (
            <div
              key={r.entry.id}
              className={`palette-row${i === sel ? ' sel' : ''}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => commit(i)}
            >
              {r.entry.kind && <span className={`tab-dot ${r.entry.kind}`} />}
              <span className="palette-label">
                <Highlight text={r.entry.label} hits={r.hits} />
              </span>
              {r.entry.detail && <span className="palette-detail">{r.entry.detail}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
