import { DocKindName } from '../types';

/**
 * Distinct glyph per document kind: a folded page for notes, a 2x2 grid for
 * todo documents, and an overlapping circle-and-triangle for diagrams. Shape
 * carries the meaning, so the kinds stay apart without relying on colour.
 */
export default function DocIcon({ kind, className = '' }: { kind: DocKindName; className?: string }) {
  const cls = `doc-icon doc-icon-${kind} ${className}`.trim();

  if (kind === 'todo') {
    return (
      <svg className={cls} viewBox="0 0 16 16" aria-hidden="true">
        <rect x="2" y="2" width="5" height="5" rx="1" />
        <rect x="9" y="2" width="5" height="5" rx="1" />
        <rect x="2" y="9" width="5" height="5" rx="1" />
        <rect x="9" y="9" width="5" height="5" rx="1" />
      </svg>
    );
  }

  if (kind === 'diagram') {
    return (
      <svg className={cls} viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="6.2" cy="9.2" r="4.4" fill="none" strokeWidth="1.6" />
        <path d="M10.2 2.2 L14.4 9.4 L6 9.4 Z" fill="none" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    );
  }

  // Note: a page with its top-right corner folded over.
  return (
    <svg className={cls} viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3.2 1.8 h6.1 l3.5 3.5 v8.9 a0.9 0.9 0 0 1 -0.9 0.9 h-8.7 a0.9 0.9 0 0 1 -0.9 -0.9 v-11.5 a0.9 0.9 0 0 1 0.9 -0.9 z"
        fill="none"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M9.3 1.8 v2.6 a0.9 0.9 0 0 0 0.9 0.9 h2.6" fill="none" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}
