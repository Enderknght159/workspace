import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  powerSaveBlocker,
  shell,
  Tray,
} from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_VERSION } from '../shared/constants.js';
import type { BridgeInfo } from '../shared/desktop.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface EngineHandshake {
  type: 'engine.ready';
  version: string;
  port: number;
  token: string;
  pid: number;
  officeId: string;
}

interface EngineInfo {
  queue: { queued: number; running: number; failed: number; review: number };
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let engine: ChildProcess | null = null;
let bridgeInfo: BridgeInfo | null = null;
let quitting = false;
let engineReady = false;
let powerBlockerId: number | null = null;
let quitAfterIdle = false;
let pollTimer: NodeJS.Timeout | null = null;
let engineToken = '';

const officeDir =
  process.env.WORKSPACE_OFFICE ??
  (process.env.PORTABLE_EXECUTABLE_DIR
    ? join(process.env.PORTABLE_EXECUTABLE_DIR, 'WorkspaceOffice')
    : join(app.getPath('documents'), 'WorkspaceOffice'));
const devServer = process.env.WORKSPACE_DEV_SERVER;

function log(message: string, data?: unknown): void {
  try {
    const dir = join(app.getPath('userData'), 'logs');
    mkdirSync(dir, { recursive: true });
    appendFileSync(
      join(dir, 'main.jsonl'),
      `${JSON.stringify({ at: new Date().toISOString(), message, data })}\n`,
      'utf8',
    );
  } catch {
    // لا نُسقط الواجهة بسبب السجل.
  }
}

function engineEntry(): string {
  const candidates = [
    join(process.resourcesPath, 'app.asar.unpacked', 'dist', 'node', 'engine', 'host.js'),
    join(process.resourcesPath, 'app', 'dist', 'node', 'engine', 'host.js'),
    join(app.getAppPath(), 'dist', 'node', 'engine', 'host.js'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[0] as string;
}

function preloadEntry(): string {
  return join(__dirname, '..', '..', 'preload', 'index.cjs');
}

function rendererEntry(): string {
  return join(__dirname, '..', '..', 'renderer', 'index.html');
}

function startEngine(): Promise<EngineHandshake> {
  return new Promise((resolve, reject) => {
    const entry = engineEntry();
    if (!existsSync(entry)) {
      reject(new Error(`engine entry not found: ${entry}`));
      return;
    }
    engineToken = randomBytes(32).toString('base64url');
    const child = spawn(process.execPath, [entry, '--office', officeDir], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        WORKSPACE_ENGINE_TOKEN: engineToken,
        WORKSPACE_LOG_CONSOLE: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    engine = child;
    let buffer = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('engine start timeout'));
    }, 45_000);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline === -1) return;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      try {
        const message = JSON.parse(line) as { type: string; message?: string };
        if (message.type === 'engine.ready') {
          settled = true;
          clearTimeout(timeout);
          engineReady = true;
          log('engine.ready', message);
          resolve(message as EngineHandshake);
        } else if (message.type === 'engine.error') {
          settled = true;
          clearTimeout(timeout);
          reject(new Error(message.message ?? 'engine error'));
        }
      } catch {
        log('engine.stdout.invalid', { line });
      }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      log('engine.stderr', { chunk: chunk.slice(0, 2000) });
    });

    child.on('error', (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(error);
      }
    });

    child.on('exit', (code, signal) => {
      engineReady = false;
      log('engine.exit', { code, signal });
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`engine exited with code ${code}`));
        return;
      }
      if (!quitting) {
        dialog.showErrorBox(
          'توقف المحرّك',
          'توقف محرّك Workspace بشكل غير متوقع. أعد تشغيل التطبيق، وإن تكرر أرسل حزمة التشخيص.',
        );
        quitNow();
      }
    });
  });
}

async function engineInfo(): Promise<EngineInfo | null> {
  if (!bridgeInfo) return null;
  try {
    const response = await fetch(`${bridgeInfo.apiBase}/api/info`, {
      headers: { authorization: `Bearer ${bridgeInfo.token}` },
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { data: EngineInfo };
    return body.data;
  } catch {
    return null;
  }
}

function applyPowerBlocker(running: boolean): void {
  if (running && powerBlockerId === null) {
    powerBlockerId = powerSaveBlocker.start('prevent-app-suspension');
    log('power.blocker_on');
  } else if (!running && powerBlockerId !== null) {
    powerSaveBlocker.stop(powerBlockerId);
    powerBlockerId = null;
    log('power.blocker_off');
  }
}

function startPolling(): void {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    void engineInfo().then((info) => {
      applyPowerBlocker((info?.queue.running ?? 0) > 0);
      if (quitAfterIdle && (info?.queue.running ?? 0) === 0) {
        quitNow();
      }
    });
  }, 5000);
}

function quitNow(): void {
  if (quitting) return;
  quitting = true;
  if (pollTimer) clearInterval(pollTimer);
  if (powerBlockerId !== null) {
    powerSaveBlocker.stop(powerBlockerId);
    powerBlockerId = null;
  }
  if (engine && !engine.killed) {
    try {
      engine.kill('SIGTERM');
    } catch {
      // تجاهل.
    }
  }
  setTimeout(() => {
    try {
      engine?.kill('SIGKILL');
    } catch {
      // تجاهل.
    }
    app.quit();
  }, 1200);
}

async function requestQuit(): Promise<void> {
  const info = await engineInfo();
  if ((info?.queue.running ?? 0) > 0) {
    const result = await dialog.showMessageBox({
      type: 'warning',
      title: 'وظيفة قيد التنفيذ',
      message: 'هناك وظيفة قيد التنفيذ الآن.',
      detail: 'يمكنك البقاء، أو الإغلاق بعد انتهاء الوظيفة، أو إلغاء الوظيفة والخروج.',
      buttons: ['البقاء', 'إغلاق بعد الحالية', 'إلغاء والخروج'],
      defaultId: 0,
      cancelId: 0,
    });
    if (result.response === 0) return;
    if (result.response === 2) {
      await cancelRunningJobs();
      quitNow();
      return;
    }
    quitAfterIdle = true;
    mainWindow?.hide();
    return;
  }
  quitNow();
}

async function cancelRunningJobs(): Promise<void> {
  if (!bridgeInfo) return;
  try {
    const response = await fetch(`${bridgeInfo.apiBase}/api/jobs?state=running`, {
      headers: { authorization: `Bearer ${bridgeInfo.token}` },
    });
    if (!response.ok) return;
    const body = (await response.json()) as { data: Array<{ id: string }> };
    for (const job of body.data) {
      await fetch(`${bridgeInfo.apiBase}/api/jobs/${job.id}/cancel`, {
        method: 'POST',
        headers: { authorization: `Bearer ${bridgeInfo.token}` },
      });
    }
  } catch {
    // الخروج سيُغلق المحرّك على أي حال.
  }
}

function trayIcon() {
  const candidates = [
    join(app.getAppPath(), 'build', 'icon.png'),
    join(process.resourcesPath, 'build', 'icon.png'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      const image = nativeImage.createFromPath(candidate);
      if (!image.isEmpty()) return image.resize({ width: 18, height: 18 });
    }
  }
  return nativeImage.createEmpty();
}

function createTray(): void {
  tray = new Tray(trayIcon());
  tray.setToolTip('Workspace — كل المكتب في نافذة واحدة');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'فتح Workspace', click: () => showWindow() },
      {
        label: 'فتح مجلد المكتب',
        click: () => {
          void shell.openPath(officeDir);
        },
      },
      { type: 'separator' },
      { label: 'خروج', click: () => void requestQuit() },
    ]),
  );
  tray.on('double-click', () => showWindow());
}

function showWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function windowStateFile(): string {
  return join(app.getPath('userData'), 'window.json');
}

function loadWindowBounds(): { width: number; height: number; x?: number; y?: number } {
  try {
    const parsed = JSON.parse(readFileSync(windowStateFile(), 'utf8')) as {
      width?: number;
      height?: number;
      x?: number;
      y?: number;
    };
    return {
      width: Math.max(1100, parsed.width ?? 1400),
      height: Math.max(720, parsed.height ?? 900),
      ...(typeof parsed.x === 'number' ? { x: parsed.x } : {}),
      ...(typeof parsed.y === 'number' ? { y: parsed.y } : {}),
    };
  } catch {
    return { width: 1400, height: 900 };
  }
}

function createWindow(): void {
  const bounds = loadWindowBounds();
  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    title: 'Workspace',
    backgroundColor: '#0c1210',
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadEntry(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  mainWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('resize', saveBounds);
  mainWindow.on('move', saveBounds);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = devServer ? url.startsWith(devServer) : url.startsWith('file:');
    if (!allowed) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  if (devServer) {
    void mainWindow.loadURL(devServer);
  } else {
    const hash = process.env.WORKSPACE_ROUTE;
    void mainWindow.loadFile(rendererEntry(), hash ? { hash } : undefined);
  }
}

function saveBounds(): void {
  if (!mainWindow) return;
  try {
    const bounds = mainWindow.getBounds();
    writeFileSync(windowStateFile(), JSON.stringify(bounds), 'utf8');
  } catch {
    // تجاهل.
  }
}

function registerIpc(): void {  ipcMain.on('app:bridge-info', (event) => {
    event.returnValue = bridgeInfo;
  });
  ipcMain.handle('dialog:choose-directory', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'اختر مجلدًا',
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle('shell:open-path', async (_event, path: string) => shell.openPath(path));
  ipcMain.handle('shell:show-item', async (_event, path: string) => {
    shell.showItemInFolder(path);
  });
  ipcMain.handle('app:quit', async () => requestQuit());
  ipcMain.handle('app:hide', async () => mainWindow?.hide());
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
  app.setAppUserModelId('com.workspace.office');

  app.whenReady().then(async () => {
    registerIpc();
    try {
      const handshake = await startEngine();
      bridgeInfo = {
        apiBase: `http://127.0.0.1:${handshake.port}`,
        token: handshake.token,
        appVersion: APP_VERSION,
        platform: process.platform,
        arch: process.arch,
        officeDir,
        isPackaged: app.isPackaged,
      };
      createWindow();
      createTray();
      startPolling();
      void setupUpdates();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log('startup.failed', { message });
      dialog.showErrorBox('تعذّر تشغيل Workspace', `${message}\n\nراجع السجلات في مجلد المكتب.`);
      app.quit();
    }
  });

  app.on('activate', () => showWindow());
  app.on('window-all-closed', () => {
    // التطبيق يعيش في التري.
  });
  app.on('before-quit', () => {
    quitting = true;
  });
}

export { engineReady };

async function setupUpdates(): Promise<void> {
  if (!app.isPackaged) return;
  try {
    const { autoUpdater } = await import('electron-updater');
    autoUpdater.autoDownload = false;
    const feed = process.env.WORKSPACE_UPDATE_FEED;
    if (feed) {
      autoUpdater.setFeedURL({ provider: 'generic', url: feed });
    }
    autoUpdater.on('error', (error) => log('updater.error', { message: String(error) }));
    autoUpdater.on('update-available', (info) => log('updater.available', { version: info.version }));
    const result = await autoUpdater.checkForUpdates();
    if (result?.updateInfo) {
      log('updater.checked', { version: result.updateInfo.version });
    }
  } catch (error) {
    log('updater.failed', { message: String(error) });
  }
}
