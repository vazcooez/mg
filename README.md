# MG

A Windows desktop app for two kinds of document — **todo documents** and **free notes** —
with Sublime Text-style window management and an Obsidian-style file vault.

Built with Electron + React + TypeScript + Vite. No cloud, no account: everything is
files on your disk.

## Install (end users)

Two self-contained builds in `release/`. Both bundle their own runtime — the target
machine needs **nothing installed**: no Node, no npm, no .NET, no Visual C++
redistributable.

| File | |
|---|---|
| `MG-Setup-1.0.0.exe` | Installer (~75 MB). Per-user, no admin rights, lets you choose the folder, creates Start Menu and desktop shortcuts, uninstalls from Add/Remove Programs. |
| `MG-1.0.0-portable.exe` | Single file (~75 MB). Copy it anywhere — USB stick, network share — and double-click. Installs nothing. |

Requires 64-bit Windows 10 (1809 or newer) or Windows 11.

The binaries are unsigned, so the first launch shows the SmartScreen
"Windows protected your PC" prompt — **More info → Run anyway**. Signing needs a
code-signing certificate; drop one in and electron-builder will use it via the
`CSC_LINK` / `CSC_KEY_PASSWORD` environment variables.

Your data is never inside the install folder — it lives in `Documents\MG Vault`, so
uninstalling or replacing the app leaves your notes alone. On a fresh machine that
folder is created and seeded on first launch.

## Build from source

```
npm install
npm run dev            # vite dev server + electron with devtools
npm start              # production build, then run
npm run dist           # installer + portable exe into release/
npm run dist:portable  # portable exe only
npm run icon           # regenerate build/icon.ico
npm run typecheck
```

---

## The vault

All content lives in a plain folder you can open in Explorer, sync with Dropbox, or
commit to git. The default is `Documents\MG Vault`; change it with
**File → Open Vault Folder…**.

```
MG Vault/
  Welcome.md                  free note   — plain markdown, Obsidian can read it
  Product launch.mgtodo       todo doc    — pretty-printed JSON
  Projects/
    Q3 roadmap.md
  .mg/
    session.json              window state + unsaved buffers
```

A `.mgtodo` file holds only content — title, the property schema, and the items.
Nothing about how you happen to be looking at it is written there, so the file stays
stable in git while views, sorts and column widths follow you in the session.

Subfolders work and show up as a tree in the sidebar. Drag a file or a whole folder
onto another folder to move it there, or onto empty space below the tree to move it
back to the root; open tabs follow. The drop target is the folder's entire region,
not just its name row, so dropping onto anything nested inside a folder means that
folder. Hovering a closed folder mid-drag opens it, and a folder refuses to be dropped
inside itself. Files are written atomically (temp file, then rename), so a crash mid-save
cannot truncate a note.

Images in the vault (`.png`, `.jpg`, `.gif`, `.webp`, `.svg`, `.bmp`, `.avif`) open as
their own read-only tab with fit-to-window and zoom.

### Saving is Sublime-style, not autosave

Edits live in a buffer until you save them.

Closing a tab asks **Save / Don't Save / Cancel** when the buffer has unsaved changes,
and also whenever the document has no file on disk yet — a new document is not
"modified" in any useful sense, but closing it without saving still throws it away, so
*Don't Save* deletes it outright. Closing the window is the exception: unsaved work is
kept and comes back next launch (see below).

| | |
|---|---|
| `Ctrl+S` | Save (a never-saved buffer prompts for a filename) |
| `Ctrl+Shift+S` | Save As… |
| `Ctrl+Alt+S` | Save All |
| | **File → Revert to Saved** throws the buffer away |

A tab with unsaved changes shows a dot instead of its × — hover to get the × back.
Closing that tab asks Save / Don't Save / Cancel.

**Hot exit:** closing the *window* never prompts. Unsaved buffers are written into
`.mg/session.json` and come back exactly as you left them, still marked unsaved, with
the same tabs, split layout, active tab and per-document view. Never-saved "Untitled"
buffers survive too.

### External changes

The vault is watched. If a file changes underneath you (git pull, Obsidian, another
editor):

- a **clean** buffer silently reloads,
- a **dirty** buffer keeps your work and the tab is flagged `changed on disk` — use
  **Revert to Saved** to take theirs, or `Ctrl+S` to overwrite with yours.

Deleting from the sidebar goes to the recycle bin, never a hard unlink.

---

## Window management

Sublime's model: editor **groups**, each with its own tab strip.

| | |
|---|---|
| `Ctrl+P` | Goto Anything — fuzzy search over open buffers *and* every vault file |
| `Ctrl+Shift+P` | Command palette |
| `Alt+Shift+1/2/3/5/8/9` | Layout: single, 2 cols, 3 cols, grid 4, 2 rows, 3 rows |
| `Ctrl+1…9` | Focus group N |
| `Ctrl+Shift+1…9` | Move the active tab to group N |
| `Alt+1…9` | Select tab N in the current group |
| `Ctrl+PgUp` / `Ctrl+PgDn` | Previous / next tab |
| `Ctrl+W`, `Ctrl+Shift+T` | Close tab, reopen closed tab |
| `Ctrl+K Ctrl+B` | Toggle sidebar |
| `Ctrl+K Ctrl+T` | Toggle dark/light theme |
| `Ctrl+,` | Settings |

Drag tabs to reorder them, or drag them into another group. Group dividers are
draggable. Middle-click closes a tab.

---

## Todo documents

Every item has a **parent** (optional), title, assignee, **urgency** 1–10,
**importance** 1–10, **weight** 1–10, a **color** that inherits from its parent unless
overridden, a **status** (planned / scheduled / in progress / done), a **show on the
matrix** flag, and any number of **custom properties**. The tree nests as deep as you
like.

### Eisenhower matrix (`Ctrl+Alt+1`)

Items are cards placed by urgency and importance, sized by weight. The four quadrants
— **Do first**, **Schedule**, **Delegate**, **Drop** — each carry their own accent so
the board reads at a glance.

- **Drag** a card to change its two scales; **drag the corner** to change weight.
- **Scroll to zoom**: cards and their type scale together. Nothing else moves —
  positions, axes and values are untouched, so zoom is purely how close you are
  standing. `−`/`+` in the toolbar step it; clicking the percentage resets to 100%.
- **Double-click** to rename; double-click empty space to create an item there.
- Arrow keys nudge by 0.1 (hold `Shift` for 1); `+` / `-` change weight;
  `Delete` removes the item.
- "Snap to whole numbers" rounds while dragging — hold `Alt` to invert it.
- Dashed connectors show parent→child relationships; a dashed border means the card's
  color is inherited.

**Orientation.** `⇄ Swap` puts importance across the bottom and urgency up the side;
`⇋ Flip` reverses either axis. The quadrant labels follow — flip importance and
*Do first* moves to the top-left, because that is where important-and-urgent now
lives. Card drags stay correct in every orientation.

**Not everything belongs on the board.** Grouping parents are often structure rather
than work, so each item has a *show on the matrix* toggle — the `◧` column in the
table, a checkbox in the inspector, or the row's context menu (which can also apply it
to a whole subtree). Hidden items still own their children everywhere else; the
toolbar shows how many are off the board.

Cards never overflow the plot: the matrix reserves a gutter of half the maximum card
size on every side.

### Tree / property table (`Ctrl+Alt+2`)

The same items as an indented tree, grouped by parent, with every property in an
editable column.

- `Tab` / `Shift+Tab` indent and outdent; `Enter` adds a sibling;
  `Alt+↑` / `Alt+↓` reorder.
- Drag a row onto another to re-parent it, or onto the header to move it to the root.
  Dropping onto your own descendant is rejected.
- **Resize any column** by dragging its right edge; double-click the edge to reset one,
  or *Reset widths* for all.
- **Sort by any column** — click a header to cycle ascending → descending → unsorted.
  Sorting reorders *siblings within each parent*, so the tree never flattens, and
  blank cells always sink to the bottom in both directions. While a sort is active
  manual reordering pauses; the toolbar chip clears it.
- Right-click a header (or use its `⋮`) for sort, width, type and display options.

### Property types

Each custom property is declared as one of four types, from the header menu or the
inspector:

| Type | Editor | Sorts by |
|---|---|---|
| **Text** | free text | alphabetically |
| **Number** | numeric input | numerically |
| **Date** | date picker | chronologically |
| **Options** | dropdown of the choices you define | the order you listed them |

Switching a text property to **Options** seeds the choice list from the values already
in use. A value that is no longer a valid option is kept and flagged rather than
silently dropped.

**Number properties choose how they render** — *Digits*, *Bar*, or *Color scale*:

- **Bar** draws a thin meter along the cell's baseline, scaled to the column's range.
- **Color scale** tints the cell across a single-hue sequential ramp. The label colour
  is computed from each step's contrast rather than fixed, so the number stays legible
  at both ends (worst case ≈ 4.6:1). Dark mode uses steps selected for the dark
  surface, not a flipped light ramp.

The range comes from the data by default; *Set bar/scale range…* pins it explicitly.
The built-in Urg/Imp/Wgt columns accept the same three display modes.

The inspector on the right edits everything at once, including color inheritance
(it names the ancestor a color came from) and the property schema.

### What counts as an edit

Property *definitions*, values, and matrix visibility are document content — they live
in the file and mark the buffer unsaved. View mode, sort, column widths, display
modes, matrix orientation and zoom are **window state**: they persist in the session
and survive restarts, but never dirty a document and are never rewound by undo.

---

## Free notes

Plain `.md` files. Four modes:

| Mode | |
|---|---|
| **Live** (`Ctrl+Alt+4`) | Obsidian-style live preview — everything renders; only the block holding the caret shows raw markdown |
| **Source** (`Ctrl+Alt+5`) | Raw markdown |
| **Split** (`Ctrl+Alt+6`) | Source and preview side by side |
| **Plain text** (`Ctrl+Alt+3`) | No markdown at all |

Live preview keeps the *document text* as the source of truth and re-derives blocks on
every keystroke. Constructs that only make sense whole — fenced code, tables,
blockquotes and callouts — stay together; everything else is one line per block.
`Enter` splits a block and carries list markers and quote prefixes forward, `Backspace`
at the start merges with the block above, and arrow keys walk between blocks.

Supported syntax: GFM (tables, task lists, strikethrough), `[[wikilinks]]` and
`[[wikilinks|aliases]]`, `#tags`, `==highlights==`, and Obsidian callouts including the
foldable `> [!tip]-` form. Clicking a wikilink opens that note, or creates it if it
does not exist. Task checkboxes are clickable and write back into the markdown.

Tables render as a real grid in live preview — column alignment included — and revert
to their pipe source the moment the caret enters them, so they stay editable as text.

### Images in notes

Drop an image file onto a note and it is copied into the note's folder in the vault
and linked as `![name](name.png)`. Relative links resolve against the note, so
`![](Media/shot.png)` and `![](../logo.png)` both work, in live preview and in the
rendered view. Links that point outside the vault are clamped back into it.

---

## Settings

`Ctrl+,`, **View → Settings…**, or "Preferences: Settings…" in the command palette.

| | |
|---|---|
| **Editor font size** | Note editors and rendered markdown. `Ctrl+=` / `Ctrl+-` adjust it without opening the panel. |
| **Editor typeface** | Monospace, sans or serif — applies to the editor *and* the rendered preview, so serif gives you a reading mode. Code blocks stay monospace regardless. |
| **Table font size** | Row density in the tree / property table. |
| **Interface font size** | Sidebar, tabs and status bar. |
| **Interface scale** | Scales the whole window including layout, for when everything is just too small. |
| **Theme** | Dark or light. |
| **Vault** | Shows the current folder; switch vaults or reveal it in Explorer. |

Settings are app-wide, apply immediately, and are stored in the session — they follow
you across restarts and never touch a document. *Reset all settings* restores the
defaults.

## Notes

- Undo/redo (`Ctrl+Z` / `Ctrl+Shift+Z`) covers document edits — item moves, matrix
  drags, table edits — with rapid changes coalesced into single steps.
- `F5` reloads the vault from disk.
- If you launch from VS Code's integrated terminal, `ELECTRON_RUN_AS_NODE=1` is set in
  that environment and will make Electron run `main.js` as a plain Node script.
  `npm run dev` clears it; a bare `npx electron .` there will not.
