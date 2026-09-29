import { useEffect, useMemo, useRef, useState } from 'react';
import { Workspace } from '../types';
import * as S from '../store';
import { FileResult, SearchMatch, SearchOptions, SearchOutcome, searchVault } from '../vaultSearch';
import DocIcon from './DocIcon';

/** Typing pauses this long before a search runs; Enter runs it at once. */
const DEBOUNCE_MS = 220;
/** Characters of context kept before a match in a long line. */
const LEAD = 12;

/** The line around a match, with the match itself picked out. */
function Snippet({ m }: { m: SearchMatch }) {
  const start = m.ch > LEAD ? m.ch - LEAD : 0;
  const before = (start ? '…' : '') + m.text.slice(start, m.ch).trimStart();
  const hit = m.text.slice(m.ch, m.ch + m.length);
  const after = m.text.slice(m.ch + m.length, m.ch + m.length + 120);
  return (
    <span className="search-snippet">
      {before}
      <mark>{hit}</mark>
      {after}
    </span>
  );
}

/**
 * Find in Vault (Ctrl+Shift+F). Results are grouped by file; clicking a match
 * opens the document and, in a note, selects the match in place.
 */
export default function VaultSearch({ ws }: { ws: Workspace }) {
  const [query, setQuery] = useState('');
  const [opts, setOpts] = useState<SearchOptions>({
    caseSensitive: false,
    wholeWord: false,
    regexp: false,
  });
  const [outcome, setOutcome] = useState<SearchOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const runId = useRef(0);
  // The latest workspace, read when a search starts rather than re-running on
  // every keystroke in some editor.
  const wsRef = useRef(ws);
  wsRef.current = ws;

  useEffect(() => {
    const focus = () => {
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    focus();
    return S.onSearchFocus(focus);
  }, []);

  const run = (q: string, o: SearchOptions) => {
    const id = ++runId.current;
    if (!q) {
      setOutcome(null);
      setBusy(false);
      return;
    }
    setBusy(true);
    void searchVault(wsRef.current, q, o, () => id === runId.current).then((res) => {
      if (id !== runId.current || !res) return;
      setOutcome(res);
      setBusy(false);
    });
  };

  // Searching follows the query and options as they change.
  useEffect(() => {
    const timer = window.setTimeout(() => run(query, opts), query ? DEBOUNCE_MS : 0);
    return () => window.clearTimeout(timer);
  }, [query, opts]);

  // Files coming and going in the vault refresh the results already shown.
  useEffect(() => {
    if (query) run(query, opts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws.files]);

  const toggle = (key: keyof SearchOptions, label: string, title: string) => (
    <button
      type="button"
      className={`mg-find-toggle ${key === 'wholeWord' ? 'word' : ''}${opts[key] ? ' on' : ''}`}
      title={title}
      aria-pressed={opts[key]}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => setOpts((o) => ({ ...o, [key]: !o[key] }))}
    >
      {label}
    </button>
  );

  const open = async (file: FileResult, m?: SearchMatch) => {
    let docId = file.docId && S.findDoc(ws, file.docId) ? file.docId : null;
    if (!docId && file.rel) docId = await S.openFile(file.rel);
    else if (docId) S.openDoc(docId);
    if (!docId || !m) return;
    const doc = S.findDoc(S.getWorkspace(), docId);
    if (doc?.type !== 'note' || !m.line) return;
    // A match cannot be selected in a rendered-only view, so show the source.
    if (doc.view === 'markdown' && doc.mdMode === 'preview') S.setMdMode(docId, 'live');
    S.revealInDoc(docId, { line: m.line, ch: m.ch, length: m.length });
  };

  const summary = useMemo(() => {
    if (!outcome || !query) return null;
    if (outcome.error) return 'Invalid pattern';
    const n = outcome.matchCount;
    const f = outcome.results.length;
    if (!n) return 'No results';
    const text = `${n.toLocaleString()} result${n === 1 ? '' : 's'} in ${f} file${f === 1 ? '' : 's'}`;
    return outcome.truncated ? `${text} — showing the first ${n.toLocaleString()}` : text;
  }, [outcome, query]);

  const key = (f: FileResult) => f.rel ?? `buffer:${f.docId}`;

  return (
    <div className="vault-search">
      <div className="vault-search-form">
        <div className="mg-find-field">
          <input
            ref={inputRef}
            className={`mg-find-input${outcome?.error ? ' invalid' : ''}`}
            value={query}
            placeholder="Search the vault"
            aria-label="Search the vault"
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') run(query, opts);
              if (e.key === 'Escape' && query) {
                e.stopPropagation();
                setQuery('');
              }
              // Alt+C / Alt+W / Alt+R, as in the note's find bar.
              const k = ({ c: 'caseSensitive', w: 'wholeWord', r: 'regexp' } as const)[
                e.key.toLowerCase() as 'c' | 'w' | 'r'
              ];
              if (e.altKey && k) {
                e.preventDefault();
                setOpts((o) => ({ ...o, [k]: !o[k] }));
              }
            }}
          />
          {toggle('caseSensitive', 'Aa', 'Match Case (Alt+C)')}
          {toggle('wholeWord', 'ab', 'Match Whole Word (Alt+W)')}
          {toggle('regexp', '.*', 'Use Regular Expression (Alt+R)')}
        </div>
        <div className="vault-search-summary">
          <span className={outcome?.error || outcome?.matchCount === 0 ? 'none' : ''}>
            {busy && !outcome ? 'Searching…' : summary}
          </span>
          {outcome && outcome.results.length > 0 && (
            <span className="vault-search-actions">
              <button
                type="button"
                className="link-btn"
                onClick={() => setFolded({})}
                title="Expand every file"
              >
                Expand All
              </button>
              <button
                type="button"
                className="link-btn"
                onClick={() =>
                  setFolded(Object.fromEntries(outcome.results.map((f) => [key(f), true])))
                }
                title="Collapse every file"
              >
                Collapse All
              </button>
            </span>
          )}
        </div>
      </div>

      <div className="vault-search-results">
        {outcome?.results.map((file) => {
          const k = key(file);
          const isFolded = folded[k];
          const dir = file.rel?.includes('/') ? file.rel.slice(0, file.rel.lastIndexOf('/')) : '';
          return (
            <div key={k} className="search-file">
              <div
                className="search-file-head"
                title={file.rel ?? `${file.title} (unsaved)`}
                onClick={() => setFolded((f) => ({ ...f, [k]: !f[k] }))}
                onDoubleClick={() => void open(file)}
              >
                <span className={`twisty${isFolded ? '' : ' open'}`}>▸</span>
                <DocIcon kind={file.type} />
                <span className="search-file-name">{file.title}</span>
                {dir && <span className="search-file-dir">{dir}</span>}
                {!file.rel && <span className="search-file-dir">unsaved</span>}
                <span className="search-file-count">{file.matches.length}</span>
              </div>
              {!isFolded &&
                file.matches.map((m, i) => (
                  <div
                    key={i}
                    className="search-match"
                    title={m.line ? `Line ${m.line}` : m.label}
                    onClick={() => void open(file, m)}
                  >
                    {m.label && <span className="search-match-label">{m.label}</span>}
                    <Snippet m={m} />
                  </div>
                ))}
            </div>
          );
        })}
        {!query && (
          <div className="side-empty">
            Searches every note, todo document and diagram in the vault, unsaved changes
            included.
          </div>
        )}
      </div>
    </div>
  );
}
