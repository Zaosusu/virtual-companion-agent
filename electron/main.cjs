const { app, BrowserWindow, dialog, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

let mainWindow;
let logFile = "";

function log(message, detail = "") {
  const line = `[${new Date().toISOString()}] ${message}${detail ? ` ${detail}` : ""}\n`;
  try {
    if (logFile) fs.appendFileSync(logFile, line, "utf8");
  } catch {
    // Logging must never prevent app startup.
  }
  console.log(line.trim());
}

function showFatalError(error) {
  const message = error?.stack || error?.message || String(error);
  log("fatal", message);
  dialog.showErrorBox("\u542f\u52a8\u5931\u8d25", `${message}\n\n\u65e5\u5fd7\u4f4d\u7f6e\uff1a${logFile || "\u672a\u521b\u5efa"}`);
}

function getPortableRootDir() {
  if (process.env.PORTABLE_EXECUTABLE_DIR) return process.env.PORTABLE_EXECUTABLE_DIR;
  if (app.isPackaged) return path.dirname(process.execPath);
  return path.join(__dirname, "..");
}

function ensureWritableDirectory(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const probe = path.join(dir, ".write-test");
  fs.writeFileSync(probe, "ok", "utf8");
  fs.unlinkSync(probe);
  return dir;
}

function resolveDataDir() {
  const portableDataDir = path.join(getPortableRootDir(), "data");
  try {
    return ensureWritableDirectory(portableDataDir);
  } catch (error) {
    const fallbackDataDir = path.join(app.getPath("userData"), "data");
    log("portable data dir unavailable, falling back", `${portableDataDir}: ${error?.message || error}`);
    return ensureWritableDirectory(fallbackDataDir);
  }
}

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1080,
    minHeight: 720,
    title: "\u89d2\u8272\u667a\u80fd\u4f53\u5de5\u4f5c\u53f0",
    backgroundColor: "#f4f6f3",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    shell.openExternal(targetUrl);
    return { action: "deny" };
  });

  mainWindow.loadURL(url);
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    mainWindow.focus();
  });
}

async function startCompanionServer() {
  process.env.PORT = "0";
  process.env.COMPANION_HOST = "127.0.0.1";
  process.env.COMPANION_DATA_DIR = resolveDataDir();
  log("data dir", process.env.COMPANION_DATA_DIR);

  const serverPath = path.join(__dirname, "..", "server.js");
  log("importing server", serverPath);
  const serverModule = await import(pathToFileURL(serverPath).href);
  log("waiting serverReady");
  const ready = await serverModule.serverReady;
  log("server ready", ready.url);
  return ready.url;
}

app.whenReady().then(async () => {
  logFile = path.join(app.getPath("userData"), "startup.log");
  log("app ready");
  try {
    const url = await startCompanionServer();
    createWindow(url);
  } catch (error) {
    showFatalError(error);
    app.quit();
    return;
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) startCompanionServer().then(createWindow).catch(showFatalError);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
