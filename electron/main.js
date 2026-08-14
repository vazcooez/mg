'use strict';

const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  Menu,
  Tray,
  nativeImage,
  shell,
  protocol,
  net,
} = require('electron');
const { pathToFileURL } = require('url');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const V = require('./vault');

const DEV_URL = process.env.VITE_DEV_SERVER_URL;

// Must be declared before the app is ready for the scheme to behave like http.
protocol.registerSchemesAsPrivileged([
  { scheme: 'mg-vault', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

/** @type {BrowserWindow | null} */
let win = null;
/** Set once the renderer has flushed its session on quit (hot exit). */
let sessionFlushed = false;
let quitting = false;
/** @type {fs.FSWatcher | null} */
let watcher = null;
/** @type {Tray | null} */
let tray = null;
/**
 * What closing the window does: 'tray' keeps MG running in the notification
 * area, 'quit' exits. Read from prefs before the window exists, because the
 * close handler needs it synchronously.
 */
let closeAction = 'quit';
/** The "MG is still running" balloon is shown once, not every time. */
let trayHintShown = false;

const TRAY_ACTIONS = ['tray', 'quit'];

/**
 * The tray image. `new Tray` accepts an empty image without complaint and then
 * shows nothing at all, so the icon is loaded explicitly and checked.
 */
function trayImage() {
  for (const file of ['icon.ico', 'icon.png']) {
    const img = nativeImage.createFromPath(path.join(__dirname, '..', 'build', file));
    if (!img.isEmpty()) return img;
  }
  return null;
}

/** Brings the window back from the tray, from wherever it was. */
function showWindow() {
  if (!win || win.isDestroyed()) {
    createWindow();
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function trayMenu() {
  return Menu.buildFromTemplate([
    { label: `MG ${app.getVersion()}`, enabled: false },
    { type: 'separator' },
    { label: 'Open MG', click: showWindow },
    {
      label: 'Closing the window',
      submenu: TRAY_ACTIONS.map((action) => ({
        label: action === 'tray' ? 'Keeps MG in the tray' : 'Quits MG',
        type: 'radio',
        checked: closeAction === action,
        click: () => void setCloseAction(action),
      })),
    },
    { type: 'separator' },
    {
      label: 'Quit MG',
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]);
}

function createTray() {
  if (tray) return;
  const image = trayImage();
  if (!image) return;
  try {
    tray = new Tray(image);
  } catch {
    // No tray available: the app still runs, the window just cannot be
    // restored from the notification area. Settings warns when this happens.
    return;
  }
  tray.setToolTip('MG');
  tray.setContextMenu(trayMenu());
  // Windows convention: a plain click reopens, the menu is on right-click.
  tray.on('click', showWindow);
  tray.on('double-click', showWindow);
}

function destroyTray() {
  if (!tray) return;
  tray.destroy();
  tray = null;
}

/**
 * The tray only exists while it can be used: with 'quit' selected there is
 * nothing for it to do, so it does not clutter the notification area.
 */
function syncTray() {
  if (closeAction === 'tray') createTray();
  else destroyTray();
  if (tray) tray.setContextMenu(trayMenu());
}

async function setCloseAction(next) {
  closeAction = TRAY_ACTIONS.includes(next) ? next : 'quit';
  await V.setPref('closeAction', closeAction);
  syncTray();
  send('close-action', closeAction);
  return closeAction;
}

/** Hides to the tray, telling the renderer to persist first. */
function hideToTray() {
  // The window survives, but a machine that dies while MG sits in the tray
  // should not cost anything the renderer has not written down.
  send('menu', 'flush-session');
  if (win && !win.isDestroyed()) win.hide();
  if (tray && !trayHintShown) {
    trayHintShown = true;
    void V.setPref('trayHintShown', true);
    tray.displayBalloon({
      title: 'MG is still running',
      content: 'Click the tray icon to reopen it. Quit from the tray menu, or change this in Settings.',
      iconType: 'info',
    });
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#16171c',
    show: false,
    // The renderer retitles the window per document; this covers the moment
    // before it has loaded.
    title: `MG ${app.getVersion()}`,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.once('ready-to-show', () => win && win.show());

  if (DEV_URL) {
    win.loadURL(DEV_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.on('close', (e) => {
    // Closing to the tray is not a close at all: the window hides and every
    // buffer stays exactly as it was, so there is nothing to tear down.
    if (closeAction === 'tray' && !quitting) {
      e.preventDefault();
      hideToTray();
      return;
    }
    // Hot exit: give the renderer a chance to persist open tabs and dirty
    // buffers before the window actually goes away.
    if (sessionFlushed) return;
    e.preventDefault();
    quitting = true;
    send('menu', 'flush-session');
    setTimeout(() => {
      sessionFlushed = true;
      if (win && !win.isDestroyed()) win.close();
    }, 2500);
  });

  win.on('closed', () => {
    win = null;
  });
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

/* ------------------------------------------------------- vault watching */

let watchTimer = null;

async function startWatching() {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
  const root = await V.getVault();
  try {
    watcher = fs.watch(root, { recursive: true }, (_event, filename) => {
      const name = String(filename ?? '');
      // Match the config folder as a path segment: a substring test would also
      // swallow every ".mgtodo" file, which is exactly what we want to hear about.
      const segments = name.split(/[\\/]/);
      if (segments[0] === V.CONFIG_DIR || name.endsWith('.tmp')) return;
      // Editors write in bursts; collapse them into one notification.
      if (watchTimer) clearTimeout(watchTimer);
      watchTimer = setTimeout(() => send('vault-changed', name), 350);
    });
  } catch {
    // Recursive watching is unavailable on some filesystems — the app still
    // works, it just will not notice external edits on its own.
  }
}

/* ----------------------------------------------------------------- menu */

function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'New Free Note', accelerator: 'CmdOrCtrl+N', click: () => send('menu', 'new-note') },
        {
          label: 'New Todo Document',
          accelerator: 'CmdOrCtrl+T',
          click: () => send('menu', 'new-todo'),
        },
        { label: 'New Diagram', click: () => send('menu', 'new-diagram') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => send('menu', 'save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('menu', 'save-as') },
        { label: 'Save All', accelerator: 'CmdOrCtrl+Alt+S', click: () => send('menu', 'save-all') },
        { type: 'separator' },
        { label: 'Revert to Saved', click: () => send('menu', 'revert') },
        { type: 'separator' },
        { label: 'Open Vault Folder…', click: () => send('menu', 'open-vault') },
        { label: 'Reveal Vault in Explorer', click: () => send('menu', 'reveal-vault') },
        { label: 'Reload Vault', accelerator: 'F5', click: () => send('menu', 'reload-vault') },
        { type: 'separator' },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => send('menu', 'close-tab') },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => send('menu', 'undo') },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', click: () => send('menu', 'redo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'Goto',
      submenu: [
        { label: 'Goto Anything…', accelerator: 'CmdOrCtrl+P', click: () => send('menu', 'goto-anything') },
        {
          label: 'Command Palette…',
          accelerator: 'CmdOrCtrl+Shift+P',
          click: () => send('menu', 'command-palette'),
        },
        { type: 'separator' },
        { label: 'Next Tab', accelerator: 'CmdOrCtrl+PageDown', click: () => send('menu', 'next-tab') },
        { label: 'Next Tab (Ctrl+Tab)', accelerator: 'Control+Tab', click: () => send('menu', 'next-tab') },
        {
          label: 'Previous Tab (Ctrl+Shift+Tab)',
          accelerator: 'Control+Shift+Tab',
          click: () => send('menu', 'prev-tab'),
        },
        {
          label: 'Previous Tab',
          accelerator: 'CmdOrCtrl+PageUp',
          click: () => send('menu', 'prev-tab'),
        },
        {
          label: 'Reopen Closed Tab',
          accelerator: 'CmdOrCtrl+Shift+T',
          click: () => send('menu', 'reopen-tab'),
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Side Bar',
          accelerator: 'CmdOrCtrl+K CmdOrCtrl+B',
          click: () => send('menu', 'toggle-sidebar'),
        },
        { type: 'separator' },
        {
          label: 'Layout',
          submenu: [
            { label: 'Single', accelerator: 'Alt+Shift+1', click: () => send('menu', 'layout:single') },
            { label: 'Columns: 2', accelerator: 'Alt+Shift+2', click: () => send('menu', 'layout:columns-2') },
            { label: 'Columns: 3', accelerator: 'Alt+Shift+3', click: () => send('menu', 'layout:columns-3') },
            { label: 'Rows: 2', accelerator: 'Alt+Shift+8', click: () => send('menu', 'layout:rows-2') },
            { label: 'Rows: 3', accelerator: 'Alt+Shift+9', click: () => send('menu', 'layout:rows-3') },
            { label: 'Grid: 4', accelerator: 'Alt+Shift+5', click: () => send('menu', 'layout:grid-4') },
          ],
        },
        { type: 'separator' },
        {
          label: 'Document View',
          submenu: [
            {
              label: 'Eisenhower Matrix',
              accelerator: 'CmdOrCtrl+Alt+1',
              click: () => send('menu', 'view-matrix'),
            },
            {
              label: 'Tree / Property Table',
              accelerator: 'CmdOrCtrl+Alt+2',
              click: () => send('menu', 'view-tree'),
            },
            { label: 'Calendar', accelerator: 'CmdOrCtrl+Alt+7', click: () => send('menu', 'view-calendar') },
            { label: 'Plain Text', accelerator: 'CmdOrCtrl+Alt+3', click: () => send('menu', 'view-plain') },
            {
              label: 'Markdown — Live Preview',
              accelerator: 'CmdOrCtrl+Alt+4',
              click: () => send('menu', 'view-live'),
            },
            {
              label: 'Markdown — Source',
              accelerator: 'CmdOrCtrl+Alt+5',
              click: () => send('menu', 'view-source'),
            },
            {
              label: 'Markdown — Split',
              accelerator: 'CmdOrCtrl+Alt+6',
              click: () => send('menu', 'view-split'),
            },
          ],
        },
        { type: 'separator' },
        {
          label: 'Toggle Theme',
          accelerator: 'CmdOrCtrl+Shift+D',
          click: () => send('menu', 'toggle-theme'),
        },
        {
          label: 'Settings…',
          accelerator: 'CmdOrCtrl+,',
          click: () => send('menu', 'settings'),
        },
        {
          label: 'Increase Editor Font Size',
          accelerator: 'CmdOrCtrl+=',
          click: () => send('menu', 'font-bigger'),
        },
        {
          label: 'Decrease Editor Font Size',
          accelerator: 'CmdOrCtrl+-',
          click: () => send('menu', 'font-smaller'),
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        // Interface scale lives in Settings, so the built-in zoom roles are
        // omitted here — their accelerators would collide with the font ones.
        { role: 'togglefullscreen' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ------------------------------------------------------------------ ipc */

/** Wraps a handler so renderer-side callers get `{ ok:false, error }` instead of a throw. */
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  });
}

handle('vault:get', async () => ({ ok: true, path: await V.getVault() }));
handle('vault:list', async () => ({ ok: true, ...(await V.listVault()) }));
handle('vault:choose', async () => {
  const res = await V.pickVault(win);
  if (res.ok) await startWatching();
  return res;
});
handle('vault:reveal', async () => {
  shell.openPath(await V.getVault());
  return { ok: true };
});

handle('file:read', (rel) => V.readFile(rel));
handle('file:write', (rel, content) => V.writeFile(rel, content));
handle('file:stat', (rel) => V.statFile(rel));
handle('file:rename', (from, to) => V.renamePath(from, to));
handle('file:trash', (rel) => V.trashPath(rel));
handle('file:reveal', (rel) => V.reveal(rel));
handle('file:unique', async (rel) => ({ ok: true, rel: await V.uniquePath(rel) }));
handle('file:write-binary', async (rel, bytes) => {
  const full = await V.resolveInVault(rel);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, Buffer.from(bytes));
  return { ok: true, rel };
});
handle('dir:create', (rel) => V.makeDir(rel));

handle('ui:scale', (factor) => {
  const f = Math.min(2, Math.max(0.6, Number(factor) || 1));
  if (win && !win.isDestroyed()) win.webContents.setZoomFactor(f);
  return { ok: true };
});

// `trayReady` matters to the UI: if the icon could not be created there is
// nothing to click to get the window back, and Settings says so.
handle('app:close-action', () => ({ ok: true, action: closeAction, trayReady: Boolean(tray) }));
handle('app:set-close-action', async (next) => ({
  ok: true,
  action: await setCloseAction(next),
  trayReady: Boolean(tray),
}));

handle('session:read', () => V.readSession());
handle('session:write', async (data) => {
  const res = await V.writeSession(data);
  if (quitting) {
    sessionFlushed = true;
    // The renderer has handed over its buffers; finish the close it blocked.
    setImmediate(() => {
      if (win && !win.isDestroyed()) win.close();
    });
  }
  return res;
});

handle('dialog:save-path', (name, type) => V.pickSavePath(win, name, type));
handle('dialog:confirm-close', (title, neverSaved) => V.confirmClose(win, title, neverSaved));
handle('dialog:message', async (message, detail) => {
  await dialog.showMessageBox(win, { type: 'info', message, detail, buttons: ['OK'] });
  return { ok: true };
});

handle('export:file', async (defaultName, content) => {
  const res = await dialog.showSaveDialog(win, {
    defaultPath: defaultName,
    filters: [
      { name: 'Markdown', extensions: ['md'] },
      { name: 'JSON', extensions: ['json'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (res.canceled || !res.filePath) return { ok: false, canceled: true };
  await fsp.writeFile(res.filePath, content, 'utf8');
  return { ok: true, path: res.filePath };
});

/* ------------------------------------------------------------ lifecycle */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  // Launching MG again while it sits in the tray reopens the window rather
  // than starting a second copy fighting over the same vault.
  app.on('second-instance', showWindow);

  app.whenReady().then(async () => {
    // mg-vault://<url-encoded vault-relative path>
    protocol.handle('mg-vault', async (request) => {
      try {
        const url = new URL(request.url);
        const rel = decodeURIComponent(url.hostname + url.pathname).replace(/^\/+/, '');
        const full = await V.resolveInVault(rel);
        return net.fetch(pathToFileURL(full).toString());
      } catch {
        return new Response('Not found', { status: 404 });
      }
    });
    closeAction = (await V.getPref('closeAction', 'quit')) === 'tray' ? 'tray' : 'quit';
    trayHintShown = Boolean(await V.getPref('trayHintShown', false));
    buildMenu();
    createWindow();
    syncTray();
    await startWatching();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else showWindow();
    });
  });

  // Quit from anywhere — the tray menu, the File menu, Alt+F4 with 'quit'
  // selected — has to get past the close-to-tray guard.
  app.on('before-quit', () => {
    quitting = true;
  });

  app.on('will-quit', () => {
    destroyTray();
  });

  app.on('window-all-closed', () => {
    if (watcher) watcher.close();
    if (process.platform !== 'darwin') app.quit();
  });
}
