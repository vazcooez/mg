import { useEffect, useRef, useState } from 'react';
import { clamp, ImageDoc, vaultUrl } from '../types';
import * as S from '../store';

/**
 * An image opened as its own tab. Read-only — the file on disk is the content —
 * so there is nothing to save and nothing to dirty.
 */
export default function ImageView({ doc }: { doc: ImageDoc }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [broken, setBroken] = useState(false);
  const zoom = doc.zoom ?? 0;

  // Reload when the file changes on disk, by busting the URL cache.
  const src = doc.path ? `${vaultUrl(doc.path)}?v=${doc.mtime ?? 0}` : '';

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const base = zoom || 1;
      S.setImageZoom(doc.id, clamp(base * Math.exp(-e.deltaY * 0.0015), 0.1, 8));
    };
    host.addEventListener('wheel', onWheel, { passive: false });
    return () => host.removeEventListener('wheel', onWheel);
  }, [doc.id, zoom]);

  return (
    <div className="doc-view">
      <header className="doc-header">
        <span className="doc-title static" title={doc.path ?? doc.title}>
          {doc.title}
        </span>
        <span className="doc-kind">
          {natural ? `${natural.w} × ${natural.h}` : 'Image'}
        </span>
        <div className="zoom-controls">
          <button
            type="button"
            className={zoom === 0 ? 'on' : ''}
            title="Fit the image to the pane"
            onClick={() => S.setImageZoom(doc.id, 0)}
          >
            Fit
          </button>
          <button type="button" onClick={() => S.setImageZoom(doc.id, (zoom || 1) / 1.25)}>
            −
          </button>
          <button
            type="button"
            className="zoom-value"
            title="Actual size"
            onClick={() => S.setImageZoom(doc.id, 1)}
          >
            {zoom ? `${Math.round(zoom * 100)}%` : 'fit'}
          </button>
          <button type="button" onClick={() => S.setImageZoom(doc.id, (zoom || 1) * 1.25)}>
            +
          </button>
        </div>
        <button
          type="button"
          className="icon-btn"
          title="Reveal in Explorer"
          onClick={() => doc.path && void window.api?.file.reveal(doc.path)}
        >
          ⌕
        </button>
      </header>

      <div className={`image-canvas${zoom ? ' zoomed' : ''}`} ref={hostRef}>
        {broken ? (
          <div className="image-broken">
            Could not load this image.
            <br />
            <code>{doc.path}</code>
          </div>
        ) : (
          <img
            className="image-view-img"
            src={src}
            alt={doc.title}
            style={zoom ? { width: natural ? natural.w * zoom : undefined, maxWidth: 'none' } : undefined}
            onLoad={(e) =>
              setNatural({
                w: e.currentTarget.naturalWidth,
                h: e.currentTarget.naturalHeight,
              })
            }
            onError={() => setBroken(true)}
          />
        )}
      </div>
      <div className="image-hint">Ctrl + scroll to zoom</div>
    </div>
  );
}
