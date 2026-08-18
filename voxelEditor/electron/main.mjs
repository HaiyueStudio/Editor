import { app, BrowserWindow, Menu, shell } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const WINDOW_BACKGROUND = '#0e131b';
const WINDOW_SHOW_FALLBACK_MS = 4_000;
let mainWindow = null;

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }
  const window = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: WINDOW_BACKGROUND,
    title: 'HaiYue Voxel Editor',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  mainWindow = window;

  const entry = join(app.getAppPath(), 'app-dist', 'index.html');
  const entryUrl = pathToFileURL(entry).href;
  let shown = false;
  const showWindow = reason => {
    if (shown || window.isDestroyed()) return;
    shown = true;
    window.show();
    window.focus();
    console.info(`[voxel-editor] Electron window shown (${reason}).`);
  };
  const showFallback = setTimeout(() => showWindow('timeout fallback'), WINDOW_SHOW_FALLBACK_MS);
  window.once('ready-to-show', () => showWindow('ready-to-show'));
  window.webContents.once('did-finish-load', () => showWindow('did-finish-load'));
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
    if (!isMainFrame) return;
    console.error(`[voxel-editor] Failed to load ${validatedUrl}: ${errorCode} ${errorDescription}`);
    showWindow('did-fail-load');
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== entryUrl) event.preventDefault();
  });
  window.once('closed', () => {
    clearTimeout(showFallback);
    if (mainWindow === window) mainWindow = null;
  });
  void window.loadFile(entry).catch(error => {
    console.error(`[voxel-editor] Unable to open ${entry}:`, error);
    showWindow('loadFile rejection');
  });
  return window;
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
else {
  app.on('second-instance', () => createWindow());
  void app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    createWindow();
  });
}

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
