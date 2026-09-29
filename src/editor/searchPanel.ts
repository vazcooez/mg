import { EditorState, Extension } from '@codemirror/state';
import { EditorView, Panel, ViewUpdate, runScopeHandlers } from '@codemirror/view';
import {
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  replaceAll,
  replaceNext,
  search,
  selectMatches,
  setSearchQuery,
} from '@codemirror/search';

/**
 * The find / replace bar for notes, in the shape VS Code and Sublime use.
 *
 * CodeMirror's stock panel is a row of lowercase words ("next", "previous",
 * "all", "match case") with native checkboxes. This keeps the same search
 * engine and commands and replaces only the controls: option toggles sit
 * inside the field, the match count is always visible, and navigation is a
 * compact set of icon buttons with their shortcuts in the tooltip.
 */

/** More than this and the count stops being useful; it reads "9999+". */
const COUNT_LIMIT = 9999;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, string> = {},
  children: Array<Node | string> = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) node.append(c);
  return node;
}

/** Small stroked icons, drawn in the current text colour. */
const ICONS: Record<string, string> = {
  up: '<path d="M8 12.5V3.5M4 7.5l4-4 4 4"/>',
  down: '<path d="M8 3.5v9M4 8.5l4 4 4-4"/>',
  all: '<path d="M2.5 4h11M2.5 8h11M2.5 12h11"/>',
  close: '<path d="M4 4l8 8M12 4l-8 8"/>',
  chevron: '<path d="M6 4l4 4-4 4"/>',
};

function icon(name: string): SVGSVGElement {
  const wrap = document.createElement('span');
  wrap.innerHTML =
    `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" ` +
    `stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  return wrap.firstChild as SVGSVGElement;
}

/** Where the main selection sits among the matches, and how many there are. */
function countMatches(state: EditorState, query: SearchQuery): { index: number; total: number } {
  if (!query.valid) return { index: 0, total: 0 };
  const sel = state.selection.main;
  let total = 0;
  let index = 0;
  const cursor = query.getCursor(state);
  for (let next = cursor.next(); !next.done; next = cursor.next()) {
    total++;
    if (next.value.from === sel.from && next.value.to === sel.to) index = total;
    if (total > COUNT_LIMIT) break;
  }
  return { index, total };
}

class FindPanel implements Panel {
  dom: HTMLElement;
  top = true;
  private query: SearchQuery;
  private readonly find: HTMLInputElement;
  private readonly replace: HTMLInputElement;
  private readonly count: HTMLElement;
  private readonly toggles: Record<'case' | 'word' | 're', HTMLButtonElement>;
  private readonly replaceRow: HTMLElement;
  private readonly expander: HTMLButtonElement;

  constructor(private readonly view: EditorView) {
    this.query = getSearchQuery(view.state);

    this.find = el('input', {
      class: 'mg-find-input',
      placeholder: 'Find',
      'aria-label': 'Find',
      spellcheck: 'false',
      'main-field': 'true',
    });
    this.find.value = this.query.search;

    this.replace = el('input', {
      class: 'mg-find-input',
      placeholder: 'Replace',
      'aria-label': 'Replace',
      spellcheck: 'false',
    });
    this.replace.value = this.query.replace;

    const toggle = (label: string, title: string, cls: string) => {
      const b = el('button', { type: 'button', class: `mg-find-toggle ${cls}`, title }, [label]);
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => {
        b.classList.toggle('on');
        b.setAttribute('aria-pressed', String(b.classList.contains('on')));
        this.commit();
      });
      return b;
    };
    this.toggles = {
      case: toggle('Aa', 'Match Case', 'case'),
      word: toggle('ab', 'Match Whole Word', 'word'),
      re: toggle('.*', 'Use Regular Expression', 're'),
    };

    const button = (name: string, title: string, run: () => void) => {
      const b = el('button', { type: 'button', class: 'mg-find-btn', title, 'aria-label': title });
      b.append(icon(name));
      b.addEventListener('click', run);
      return b;
    };
    const textButton = (label: string, title: string, run: () => void) => {
      const b = el('button', { type: 'button', class: 'mg-find-text-btn', title }, [label]);
      b.addEventListener('click', run);
      return b;
    };

    this.count = el('span', { class: 'mg-find-count', 'aria-live': 'polite' });

    this.expander = el('button', {
      type: 'button',
      class: 'mg-find-btn mg-find-expand',
      title: 'Toggle Replace (Ctrl+H)',
      'aria-label': 'Toggle Replace',
    });
    this.expander.append(icon('chevron'));
    this.expander.addEventListener('click', () => this.setReplaceOpen(!this.replaceOpen));

    const findField = el('div', { class: 'mg-find-field' }, [
      this.find,
      this.toggles.case,
      this.toggles.word,
      this.toggles.re,
    ]);
    const findRow = el('div', { class: 'mg-find-row' }, [
      findField,
      this.count,
      button('up', 'Previous Match (Shift+Enter)', () => findPrevious(view)),
      button('down', 'Next Match (Enter)', () => findNext(view)),
      button('all', 'Select All Matches (Alt+Enter)', () => selectMatches(view)),
      button('close', 'Close (Escape)', () => closeSearchPanel(view)),
    ]);

    this.replaceRow = el('div', { class: 'mg-find-row mg-replace-row' }, [
      el('div', { class: 'mg-find-field' }, [this.replace]),
      textButton('Replace', 'Replace (Enter)', () => replaceNext(view)),
      textButton('Replace All', 'Replace All (Ctrl+Alt+Enter)', () => replaceAll(view)),
    ]);

    const rows = el('div', { class: 'mg-find-rows' }, [findRow, this.replaceRow]);
    this.dom = el('div', { class: 'mg-find' }, [this.expander, rows]);
    this.dom.addEventListener('keydown', (e) => this.keydown(e));
    this.find.addEventListener('input', () => this.commit());
    this.replace.addEventListener('input', () => this.commit());

    this.setQuery(this.query);
    this.setReplaceOpen(Boolean(this.query.replace) || openWithReplace);
    this.refreshCount();
  }

  private replaceOpen = false;

  private setReplaceOpen(open: boolean) {
    this.replaceOpen = open;
    this.dom.classList.toggle('with-replace', open);
    this.expander.setAttribute('aria-expanded', String(open));
  }

  showReplace() {
    this.setReplaceOpen(true);
    this.replace.focus();
    this.replace.select();
  }

  mount() {
    mounted.set(this.view, this);
    const target = openWithReplace && this.find.value ? this.replace : this.find;
    openWithReplace = false;
    target.focus();
    target.select();
  }

  private commit() {
    const query = new SearchQuery({
      search: this.find.value,
      replace: this.replace.value,
      caseSensitive: this.toggles.case.classList.contains('on'),
      wholeWord: this.toggles.word.classList.contains('on'),
      regexp: this.toggles.re.classList.contains('on'),
    });
    if (query.eq(this.query)) return;
    this.query = query;
    this.view.dispatch({ effects: setSearchQuery.of(query) });
  }

  private keydown(e: KeyboardEvent) {
    if (runScopeHandlers(this.view, e, 'search-panel')) {
      e.preventDefault();
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Enter' && e.target === this.find) {
      e.preventDefault();
      if (e.altKey) selectMatches(this.view);
      else (e.shiftKey ? findPrevious : findNext)(this.view);
    } else if (e.key === 'Enter' && e.target === this.replace) {
      e.preventDefault();
      if (mod && e.altKey) replaceAll(this.view);
      else replaceNext(this.view);
    } else if (mod && e.key.toLowerCase() === 'h') {
      e.preventDefault();
      this.showReplace();
    } else if (e.altKey && !mod) {
      // Alt+C / Alt+W / Alt+R flip the options, as they do in VS Code.
      const key = ({ c: 'case', w: 'word', r: 're' } as const)[
        e.key.toLowerCase() as 'c' | 'w' | 'r'
      ];
      if (key) {
        e.preventDefault();
        this.toggles[key].click();
      }
    }
  }

  update(update: ViewUpdate) {
    for (const tr of update.transactions) {
      for (const effect of tr.effects) {
        if (effect.is(setSearchQuery) && !effect.value.eq(this.query)) this.setQuery(effect.value);
      }
    }
    const queryChanged = update.transactions.some((tr) => tr.effects.some((e) => e.is(setSearchQuery)));
    if (queryChanged || update.docChanged || update.selectionSet) this.refreshCount();
  }

  private setQuery(query: SearchQuery) {
    this.query = query;
    this.find.value = query.search;
    this.replace.value = query.replace;
    const set = (b: HTMLButtonElement, on: boolean) => {
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    };
    set(this.toggles.case, query.caseSensitive);
    set(this.toggles.word, query.wholeWord);
    set(this.toggles.re, query.regexp);
  }

  private refreshCount() {
    const q = this.query;
    const invalid = Boolean(q.search) && !q.valid;
    this.find.classList.toggle('invalid', invalid);
    if (!q.search) {
      this.count.textContent = '';
      this.count.classList.remove('none');
      return;
    }
    if (invalid) {
      this.count.textContent = 'Invalid pattern';
      this.count.classList.add('none');
      return;
    }
    const { index, total } = countMatches(this.view.state, q);
    const many = total > COUNT_LIMIT ? `${COUNT_LIMIT}+` : String(total);
    this.count.textContent = total ? `${index ? `${index} of ` : ''}${many}` : 'No results';
    this.count.classList.toggle('none', total === 0);
  }
}

/** The panel currently mounted in each editor, so Ctrl+H can reach it. */
const mounted = new WeakMap<EditorView, FindPanel>();

/** Set by Ctrl+H just before the panel is created, so it opens on Replace. */
let openWithReplace = false;

/** Ctrl+H: the same panel, arriving with the replace row open and focused. */
export function openReplacePanel(view: EditorView): boolean {
  const panel = mounted.get(view);
  if (panel && view.dom.contains(panel.dom)) {
    panel.showReplace();
    return true;
  }
  openWithReplace = true;
  return openSearchPanel(view);
}

export const findPanel: Extension = search({ top: true, createPanel: (view) => new FindPanel(view) });
