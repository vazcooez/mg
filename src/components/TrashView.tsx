import { QUADRANT_COLOR, QUADRANT_LABEL, quadrantOf, TodoDoc } from '../types';
import * as S from '../store';

/**
 * The document's own trash. Deleting an item parks it here rather than
 * destroying it; nothing leaves for good without an explicit confirmation.
 */
export default function TrashView({ doc }: { doc: TodoDoc }) {
  const roots = S.trashedRoots(doc);
  const total = S.trashCount(doc);

  const describe = (id: string, title: string) => {
    const kids = S.descendantIds(doc.items, id).length;
    return kids ? `"${title}" and ${kids} descendant${kids === 1 ? '' : 's'}` : `"${title}"`;
  };

  return (
    <div className="tree-view">
      <div className="view-toolbar">
        <span className="tb-hint">
          {total ? `${total} item${total === 1 ? '' : 's'} in the trash` : 'The trash is empty'}
        </span>
        <span className="tb-spacer" />
        <button type="button" className="ghost-btn" disabled={!total} onClick={() => S.restoreAll(doc.id)}>
          Restore all
        </button>
        <button
          type="button"
          className="ghost-btn danger"
          disabled={!total}
          onClick={() => {
            if (confirm(`Permanently delete all ${total} item${total === 1 ? '' : 's'} in the trash?`))
              S.emptyTrash(doc.id);
          }}
        >
          Empty trash
        </button>
      </div>

      <div className="table-scroll">
        {!total ? (
          <div className="trash-empty">
            Deleted items land here.
            <br />
            You can put them back, or remove them for good.
          </div>
        ) : (
          <ul className="trash-list">
            {roots.map((item) => {
              const kids = S.descendantIds(doc.items, item.id).length;
              const q = quadrantOf(item.urgency, item.importance);
              return (
                <li key={item.id} className="trash-row">
                  <span
                    className="row-swatch"
                    style={{ background: S.resolveColor(doc.items, item) }}
                  />
                  <span className="trash-title">{item.title}</span>
                  <span
                    className="quadrant-chip"
                    style={{ ['--chip' as string]: QUADRANT_COLOR[q] }}
                  >
                    {QUADRANT_LABEL[q]}
                  </span>
                  {kids > 0 && (
                    <span className="trash-meta">
                      +{kids} child{kids === 1 ? '' : 'ren'}
                    </span>
                  )}
                  {item.deletedAt && (
                    <span className="trash-meta">
                      {new Date(item.deletedAt).toLocaleString()}
                    </span>
                  )}
                  <span className="tb-spacer" />
                  <button type="button" className="ghost-btn" onClick={() => S.restoreItem(doc.id, item.id)}>
                    Restore
                  </button>
                  <button
                    type="button"
                    className="ghost-btn danger"
                    onClick={() => {
                      if (confirm(`Permanently delete ${describe(item.id, item.title)}? This cannot be undone.`))
                        S.purgeItem(doc.id, item.id);
                    }}
                  >
                    Delete forever
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
