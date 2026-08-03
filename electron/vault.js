'use strict';

const { app, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

const NOTE_EXT = '.md';
const TODO_EXT = '.mgtodo';
const DIAGRAM_EXT = '.mgdiagram';
/** Images live in the vault too: they open in a tab and embed in notes. */
const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.avif'];
const KNOWN_EXT = [NOTE_EXT, TODO_EXT, DIAGRAM_EXT, ...IMAGE_EXT];

const EXT_KIND = { [TODO_EXT]: 'todo', [DIAGRAM_EXT]: 'diagram', [NOTE_EXT]: 'note' };
for (const e of IMAGE_EXT) EXT_KIND[e] = 'image';
const CONFIG_DIR = '.mg';
const SESSION_FILE = 'session.json';

/** Preferences live outside the vault so we can find the vault at boot. */
function prefsFile() {
  return path.join(app.getPath('userData'), 'prefs.json');
}

function defaultVault() {
  return path.join(app.getPath('documents'), 'MG Vault');
}

let vaultPath = null;

async function readPrefs() {
  try {
    return JSON.parse(await fsp.readFile(prefsFile(), 'utf8'));
  } catch {
    return {};
  }
}

async function writePrefs(prefs) {
  await fsp.mkdir(path.dirname(prefsFile()), { recursive: true });
  await fsp.writeFile(prefsFile(), JSON.stringify(prefs, null, 2), 'utf8');
}

async function getVault() {
  if (vaultPath) return vaultPath;
  const prefs = await readPrefs();
  vaultPath = prefs.vaultPath || defaultVault();
  await fsp.mkdir(path.join(vaultPath, CONFIG_DIR), { recursive: true });
  return vaultPath;
}

async function setVault(next) {
  vaultPath = next;
  const prefs = await readPrefs();
  await writePrefs({ ...prefs, vaultPath: next });
  await fsp.mkdir(path.join(next, CONFIG_DIR), { recursive: true });
  return next;
}

/** Resolves a vault-relative path, refusing anything that escapes the vault. */
async function resolveInVault(rel) {
  const root = await getVault();
  const full = path.resolve(root, rel);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (full !== root && !full.startsWith(prefix)) {
    throw new Error(`Path escapes the vault: ${rel}`);
  }
  return full;
}

function toRel(root, full) {
  return path.relative(root, full).split(path.sep).join('/');
}

/* ------------------------------------------------------------- listing */

/** Recursive vault listing; hidden entries and the config dir are skipped. */
async function listVault() {
  const root = await getVault();
  await fsp.mkdir(root, { recursive: true });
  const files = [];
  const dirs = [];

  const walk = async (dir, depth) => {
    if (depth > 12) return;
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      const rel = toRel(root, full);
      if (entry.isDirectory()) {
        dirs.push({ rel, name: entry.name });
        await walk(full, depth + 1);
      } else if (KNOWN_EXT.includes(path.extname(entry.name).toLowerCase())) {
        let mtime = 0;
        try {
          mtime = (await fsp.stat(full)).mtimeMs;
        } catch {
          /* raced with a delete */
        }
        files.push({
          rel,
          name: entry.name,
          type: EXT_KIND[path.extname(entry.name).toLowerCase()] ?? 'note',
          mtime,
        });
      }
    }
  };

  await walk(root, 0);
  return { root, files, dirs };
}

/* ---------------------------------------------------------------- files */

async function readFile(rel) {
  const full = await resolveInVault(rel);
  const [content, stat] = await Promise.all([fsp.readFile(full, 'utf8'), fsp.stat(full)]);
  return { ok: true, content, mtime: stat.mtimeMs };
}

/** Atomic write: temp file then rename, so a crash cannot truncate a note. */
async function writeFile(rel, content) {
  const full = await resolveInVault(rel);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  const tmp = `${full}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, content, 'utf8');
  await fsp.rename(tmp, full);
  const stat = await fsp.stat(full);
  return { ok: true, mtime: stat.mtimeMs, rel };
}

async function statFile(rel) {
  try {
    const full = await resolveInVault(rel);
    const stat = await fsp.stat(full);
    return { ok: true, exists: true, mtime: stat.mtimeMs };
  } catch {
    return { ok: true, exists: false, mtime: null };
  }
}

async function renamePath(from, to) {
  const src = await resolveInVault(from);
  const dst = await resolveInVault(to);
  if (src === dst) return { ok: true, rel: to };
  try {
    await fsp.access(dst);
    return { ok: false, error: 'A file with that name already exists.' };
  } catch {
    /* free */
  }
  await fsp.mkdir(path.dirname(dst), { recursive: true });
  await fsp.rename(src, dst);
  return { ok: true, rel: to };
}

/** Deletes to the recycle bin so nothing is destroyed outright. */
async function trashPath(rel) {
  const full = await resolveInVault(rel);
  await shell.trashItem(full);
  return { ok: true };
}

async function makeDir(rel) {
  const full = await resolveInVault(rel);
  await fsp.mkdir(full, { recursive: true });
  return { ok: true, rel };
}

async function reveal(rel) {
  const full = await resolveInVault(rel);
  shell.showItemInFolder(full);
  return { ok: true };
}

/** Finds a free filename by appending " 2", " 3", … */
async function uniquePath(rel) {
  const root = await getVault();
  const ext = path.extname(rel);
  const base = rel.slice(0, rel.length - ext.length);
  let candidate = rel;
  let n = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await fsp.access(path.resolve(root, candidate));
      n += 1;
      candidate = `${base} ${n}${ext}`;
    } catch {
      return candidate;
    }
  }
}

/* -------------------------------------------------------------- session */

async function sessionPath() {
  const root = await getVault();
  const dir = path.join(root, CONFIG_DIR);
  await fsp.mkdir(dir, { recursive: true });
  return path.join(dir, SESSION_FILE);
}

async function readSession() {
  try {
    const file = await sessionPath();
    return { ok: true, data: JSON.parse(await fsp.readFile(file, 'utf8')) };
  } catch (err) {
    if (err && err.code === 'ENOENT') return { ok: true, data: null };
    return { ok: false, error: String(err), data: null };
  }
}

async function writeSession(data) {
  const file = await sessionPath();
  const tmp = `${file}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fsp.rename(tmp, file);
  return { ok: true };
}

/* --------------------------------------------------------------- dialogs */

/** Save-As restricted to the vault; returns a vault-relative path. */
async function pickSavePath(win, defaultName, type) {
  const root = await getVault();
  const ext = type === 'todo' ? TODO_EXT : type === 'diagram' ? DIAGRAM_EXT : NOTE_EXT;
  const filters = {
    todo: [{ name: 'MG todo document', extensions: ['mgtodo'] }],
    diagram: [{ name: 'MG diagram', extensions: ['mgdiagram'] }],
    note: [{ name: 'Markdown', extensions: ['md'] }],
  };
  const res = await dialog.showSaveDialog(win, {
    title: 'Save in vault',
    defaultPath: path.join(root, defaultName.endsWith(ext) ? defaultName : defaultName + ext),
    filters: filters[type] ?? filters.note,
  });
  if (res.canceled || !res.filePath) return { ok: false, canceled: true };

  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (!res.filePath.startsWith(prefix)) {
    await dialog.showMessageBox(win, {
      type: 'warning',
      message: 'Files must be saved inside the vault.',
      detail: `Vault: ${root}`,
      buttons: ['OK'],
    });
    return { ok: false, canceled: true };
  }
  let rel = toRel(root, res.filePath);
  if (!path.extname(rel)) rel += ext;
  return { ok: true, rel };
}

async function pickVault(win) {
  const res = await dialog.showOpenDialog(win, {
    title: 'Choose vault folder',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: await getVault(),
  });
  if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
  return { ok: true, path: await setVault(res.filePaths[0]) };
}

/** Sublime's three-way prompt when closing a buffer with unsaved changes. */
async function confirmClose(win, title) {
  const res = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Save', "Don't Save", 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    message: `Save changes to "${title}" before closing?`,
    detail: 'Your changes will be lost if you close without saving.',
  });
  return { choice: ['save', 'discard', 'cancel'][res.response] };
}

module.exports = {
  NOTE_EXT,
  TODO_EXT,
  DIAGRAM_EXT,
  IMAGE_EXT,
  resolveInVault,
  CONFIG_DIR,
  getVault,
  setVault,
  listVault,
  readFile,
  writeFile,
  statFile,
  renamePath,
  trashPath,
  makeDir,
  reveal,
  uniquePath,
  readSession,
  writeSession,
  pickSavePath,
  pickVault,
  confirmClose,
  defaultVault,
};
