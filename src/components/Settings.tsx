import { useEffect } from 'react';
import {
  DEFAULT_SETTINGS,
  EDITOR_FONT_LABEL,
  EditorFont,
  SETTING_BOUNDS,
  Settings as SettingsShape,
  Workspace,
} from '../types';
import * as S from '../store';

const EDITOR_FONTS: EditorFont[] = ['mono', 'sans', 'serif'];

/**
 * Preferences. Everything here is app-wide window state: it lives in the
 * session, applies immediately, and never touches a document.
 */
export default function Settings({ ws, onClose }: { ws: Workspace; onClose: () => void }) {
  const s = ws.settings;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const num = (
    key: keyof Omit<SettingsShape, 'editorFont'>,
    label: string,
    hint: string,
    step = 1,
    format: (n: number) => string = (n) => `${n} px`
  ) => {
    const [lo, hi] = SETTING_BOUNDS[key];
    return (
      <div className="setting" key={key}>
        <div className="setting-head">
          <label htmlFor={`set-${key}`}>{label}</label>
          <span className="setting-value">{format(s[key])}</span>
        </div>
        <div className="setting-row">
          <input
            id={`set-${key}`}
            type="range"
            min={lo}
            max={hi}
            step={step}
            value={s[key]}
            onChange={(e) => S.setSetting(key, Number(e.target.value))}
          />
          <button
            type="button"
            className="row-btn"
            title="Reset this setting"
            onClick={() => S.setSetting(key, DEFAULT_SETTINGS[key])}
          >
            ↺
          </button>
        </div>
        <p className="setting-hint">{hint}</p>
      </div>
    );
  };

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="settings-panel" onMouseDown={(e) => e.stopPropagation()}>
        <header className="settings-head">
          <span>Settings</span>
          <button type="button" className="icon-btn" onClick={onClose} title="Close (Esc)">
            ×
          </button>
        </header>

        <div className="settings-body">
          <section>
            <h3>Typography</h3>

            {num(
              'editorFontSize',
              'Editor font size',
              'Note editors and rendered markdown — plain text, source, live preview and preview.'
            )}

            <div className="setting">
              <div className="setting-head">
                <label>Editor typeface</label>
              </div>
              <div className="font-choice">
                {EDITOR_FONTS.map((f) => (
                  <button
                    key={f}
                    type="button"
                    className={`font-option font-${f}${s.editorFont === f ? ' on' : ''}`}
                    onClick={() => S.setSetting('editorFont', f)}
                  >
                    <span className="font-name">{EDITOR_FONT_LABEL[f]}</span>
                    <span className="font-sample">Ag 123</span>
                  </button>
                ))}
              </div>
              <p className="setting-hint">Applies to note editors; the preview follows it too.</p>
            </div>

            {num('tableFontSize', 'Table font size', 'Rows in the tree / property table.')}
            {num('chromeFontSize', 'Interface font size', 'Sidebar, tabs and the status bar.')}
            {num(
              'uiScale',
              'Interface scale',
              'Scales the whole window, layout included — use this if everything is too small.',
              0.05,
              (n) => `${Math.round(n * 100)}%`
            )}
          </section>

          <section>
            <h3>Appearance</h3>
            <div className="setting">
              <div className="setting-head">
                <label>Theme</label>
              </div>
              <div className="font-choice">
                {(['dark', 'light'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`font-option${ws.theme === t ? ' on' : ''}`}
                    onClick={() => S.setTheme(t)}
                  >
                    <span className="font-name">{t === 'dark' ? 'Dark' : 'Light'}</span>
                  </button>
                ))}
              </div>
              <p className="setting-hint">Also on Ctrl+K Ctrl+T.</p>
            </div>
          </section>

          <section>
            <h3>Vault</h3>
            <div className="setting">
              <div className="setting-head">
                <label>Folder</label>
              </div>
              <code className="vault-path">{ws.vaultPath || '—'}</code>
              <div className="setting-row">
                <button type="button" className="ghost-btn" onClick={() => void S.chooseVault()}>
                  Open another vault…
                </button>
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => void window.api?.vault.reveal()}
                >
                  Reveal in Explorer
                </button>
              </div>
              <p className="setting-hint">
                Notes are <code>.md</code>, todo documents are <code>.mgtodo</code>. Unsaved work
                and window state live in <code>.mg/session.json</code>.
              </p>
            </div>
          </section>
        </div>

        <footer className="settings-foot">
          <button type="button" className="ghost-btn danger" onClick={() => S.resetSettings()}>
            Reset all settings
          </button>
          <span className="tb-spacer" />
          <button type="button" className="ghost-btn" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}
