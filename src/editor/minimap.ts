import { Extension } from '@codemirror/state';
import { EditorView, PluginValue, ViewPlugin, ViewUpdate } from '@codemirror/view';

/**
 * Sublime's minimap: the whole note drawn in miniature down the right edge,
 * with the visible part outlined. Click to jump there, drag to scroll.
 *
 * Each line is a strip of little blocks, one per run of characters, coloured
 * by what the line is — headings, code, quotes — so the shape of a document
 * reads at a glance, which is what a minimap is for. Long notes scroll the map
 * along with the text, as Sublime's does.
 */

/** Width of the map, in CSS pixels; the editor gives up this much on the right. */
export const MINIMAP_WIDTH = 96;
/** Height of one line in the map, and width of one character. */
const LINE_H = 3;
const CHAR_W = 1.1;
const PAD_X = 6;
const TAB_COLS = 4;

const HEADING = /^#{1,6}\s/;
const FENCE = /^\s*(```|~~~)/;
const QUOTE = /^\s*>/;
const LIST = /^\s*([-*+]|\d+[.)])\s/;

interface Layout {
  height: number;
  offset: number;
  sliderTop: number;
  sliderHeight: number;
  maxScroll: number;
  colors: Record<'text' | 'heading' | 'code' | 'quote' | 'list', string>;
}

class Minimap implements PluginValue {
  private readonly dom: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly slider: HTMLDivElement;
  private layout: Layout | null = null;
  private readonly onScroll = () => this.schedule();

  constructor(private readonly view: EditorView) {
    this.dom = document.createElement('div');
    this.dom.className = 'cm-minimap';
    this.dom.setAttribute('aria-hidden', 'true');
    this.canvas = document.createElement('canvas');
    this.slider = document.createElement('div');
    this.slider.className = 'cm-minimap-slider';
    this.dom.append(this.canvas, this.slider);
    view.dom.appendChild(this.dom);
    view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true });
    this.dom.addEventListener('pointerdown', this.onPointerDown);
    this.schedule();
  }

  update(u: ViewUpdate) {
    if (u.docChanged || u.geometryChanged || u.viewportChanged || u.heightChanged) this.schedule();
  }

  destroy() {
    this.view.scrollDOM.removeEventListener('scroll', this.onScroll);
    this.dom.remove();
  }

  private schedule() {
    this.view.requestMeasure({
      key: this,
      read: (view) => this.measure(view),
      write: (layout) => this.draw(layout),
    });
  }

  /** Everything the drawing needs from the layout, read in one pass. */
  private measure(view: EditorView): Layout {
    const height = this.dom.clientHeight;
    const total = view.state.doc.lines * LINE_H;
    const scroller = view.scrollDOM;
    const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const fraction = maxScroll ? scroller.scrollTop / maxScroll : 0;
    const offset = total > height ? fraction * (total - height) : 0;

    // The lines on screen, from where the viewport cuts the document.
    const rect = scroller.getBoundingClientRect();
    const docTop = view.documentTop;
    const lineAt = (y: number) =>
      view.state.doc.lineAt(view.lineBlockAtHeight(Math.max(0, y - docTop)).from).number;
    const first = lineAt(rect.top);
    const last = lineAt(rect.bottom);

    const css = getComputedStyle(view.dom);
    const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    return {
      height,
      offset,
      maxScroll,
      sliderTop: (first - 1) * LINE_H - offset,
      sliderHeight: Math.max(LINE_H * 4, (last - first + 1) * LINE_H),
      colors: {
        text: v('--minimap-text', '#8b9aa8'),
        heading: v('--syn-heading', '#6699cc'),
        code: v('--syn-code', '#99c794'),
        quote: v('--syn-quote', '#a6acb9'),
        list: v('--syn-list', '#ec5f67'),
      },
    };
  }

  private draw(layout: Layout) {
    this.layout = layout;
    const { height, offset, colors } = layout;
    const ratio = window.devicePixelRatio || 1;
    const width = MINIMAP_WIDTH;
    if (this.canvas.width !== Math.round(width * ratio) || this.canvas.height !== Math.round(height * ratio)) {
      this.canvas.width = Math.round(width * ratio);
      this.canvas.height = Math.round(height * ratio);
      this.canvas.style.width = `${width}px`;
      this.canvas.style.height = `${height}px`;
    }
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const doc = this.view.state.doc;
    const first = Math.max(1, Math.floor(offset / LINE_H) + 1);
    const last = Math.min(doc.lines, Math.ceil((offset + height) / LINE_H));

    // Whether `first` starts inside a fence depends on every line above it.
    let fenced = false;
    for (let n = 1; n < first; n++) if (FENCE.test(doc.line(n).text)) fenced = !fenced;

    const maxCols = (width - PAD_X * 2) / CHAR_W;
    for (let n = first; n <= last; n++) {
      const text = doc.line(n).text;
      const fence = FENCE.test(text);
      let color = colors.text;
      let alpha = 0.55;
      if (fenced || fence) color = colors.code;
      else if (HEADING.test(text)) {
        color = colors.heading;
        alpha = 0.95;
      } else if (QUOTE.test(text)) color = colors.quote;
      if (fence) fenced = !fenced;

      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      const y = (n - 1) * LINE_H - offset;
      let col = 0;
      let runStart = -1;
      const flush = () => {
        if (runStart < 0) return;
        const end = Math.min(col, maxCols);
        if (end > runStart) ctx.fillRect(PAD_X + runStart * CHAR_W, y, (end - runStart) * CHAR_W, LINE_H - 1);
        runStart = -1;
      };
      const list = LIST.exec(text);
      for (let i = 0; i < text.length && col < maxCols; i++) {
        const ch = text[i];
        if (ch === ' ' || ch === '\t') {
          flush();
          col += ch === '\t' ? TAB_COLS : 1;
          continue;
        }
        if (runStart < 0) runStart = col;
        // A list marker gets its own colour, so bulleted runs stand out.
        if (list && i === list[0].indexOf(list[1])) {
          flush();
          ctx.fillStyle = colors.list;
          ctx.fillRect(PAD_X + col * CHAR_W, y, CHAR_W * 1.5, LINE_H - 1);
          ctx.fillStyle = color;
          col++;
          continue;
        }
        col++;
      }
      flush();
    }
    ctx.globalAlpha = 1;

    this.slider.style.top = `${layout.sliderTop}px`;
    this.slider.style.height = `${layout.sliderHeight}px`;
  }

  /**
   * Clicking outside the outline centres that line; dragging then moves the
   * outline like a scrollbar thumb, from wherever it was grabbed.
   */
  private readonly onPointerDown = (e: PointerEvent) => {
    const layout = this.layout;
    if (!layout || e.button !== 0) return;
    e.preventDefault();
    const box = this.dom.getBoundingClientRect();
    const y = e.clientY - box.top;
    let grab = y - layout.sliderTop;
    if (grab < 0 || grab > layout.sliderHeight) {
      const doc = this.view.state.doc;
      const n = Math.min(doc.lines, Math.max(1, Math.floor((y + layout.offset) / LINE_H) + 1));
      this.view.dispatch({ effects: EditorView.scrollIntoView(doc.line(n).from, { y: 'center' }) });
      grab = layout.sliderHeight / 2;
    }
    const track = Math.max(1, Math.min(layout.height, this.view.state.doc.lines * LINE_H) - layout.sliderHeight);
    const move = (ev: PointerEvent) => {
      const top = ev.clientY - box.top - grab;
      const fraction = Math.min(1, Math.max(0, top / track));
      this.view.scrollDOM.scrollTop = fraction * (this.layout?.maxScroll ?? layout.maxScroll);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      this.dom.classList.remove('dragging');
    };
    this.dom.classList.add('dragging');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
}

export const minimap: Extension = [
  ViewPlugin.fromClass(Minimap),
  EditorView.editorAttributes.of({ class: 'cm-has-minimap' }),
];
