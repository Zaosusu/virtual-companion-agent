const { app, BrowserWindow, shell } = require("electron");
const path = require("node:path");

let mainWindow;

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1080,
    minHeight: 720,
    title: "虚拟角色智能体",
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
}

async function startCompanionServer() {
  process.env.PORT = "0";
  process.env.COMPANION_HOST = "127.0.0.1";
  process.env.COMPANION_DATA_DIR = path.join(app.getPath("userData"), "data");

  const serverModule = await import(path.join(__dirname, "..", "server.js"));
  const ready = await serverModule.serverReady;
  return ready.url;
}

app.whenReady().then(async () => {
  const url = await startCompanionServer();
  createWindow(url);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(url);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
