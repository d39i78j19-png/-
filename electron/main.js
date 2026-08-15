/**
 * Electron メインプロセス。
 *
 * やっていることは3つだけ:
 *   1. Next.js の standalone サーバーを子プロセスとして 127.0.0.1 の空きポートで起動
 *   2. 起動を待ってウィンドウで開く
 *   3. 終了時にサーバーを確実に落とす
 *
 * API キーの保存先はアプリのユーザーデータディレクトリで、そのパスを
 * PERSONA_STUDIO_DATA_DIR としてサーバーに渡す。キーの読み書き自体は
 * Next 側（src/lib/keyStore.ts）が行うので、IPC は不要。
 */

const { app, BrowserWindow, shell, dialog, Menu } = require("electron");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");

const HOST = "127.0.0.1";
const STARTUP_TIMEOUT_MS = 60_000;

let serverProcess = null;
let mainWindow = null;
let serverLog = "";

/** 同時起動しても衝突しないよう、OS に空きポートを選ばせる。 */
function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, HOST, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function serverEntryPoint() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "app", "server.js")
    : path.join(__dirname, "..", ".next", "standalone", "server.js");
}

function startServer(port) {
  const entry = serverEntryPoint();

  const childEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    NODE_ENV: "production",
    PORT: String(port),
    HOSTNAME: HOST,
    PERSONA_STUDIO_DATA_DIR: app.getPath("userData"),
  };

  // パッケージ済み Electron は NODE_OPTIONS をほぼ受け付けず、
  // 設定されているとエラーを出して起動に失敗する。子サーバーも
  // ELECTRON_RUN_AS_NODE で動く Electron なので同じ制約を受ける。
  // 利用者の環境に NODE_OPTIONS が残っていても動くよう、ここで落とす。
  delete childEnv.NODE_OPTIONS;

  // パッケージ後は独立した node バイナリが無いので、Electron 自身を
  // Node ランタイムとして使う（ELECTRON_RUN_AS_NODE）。
  serverProcess = spawn(process.execPath, [entry], {
    cwd: path.dirname(entry),
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const record = (chunk) => {
    serverLog = (serverLog + chunk.toString()).slice(-4000);
  };
  serverProcess.stdout.on("data", record);
  serverProcess.stderr.on("data", record);

  serverProcess.on("exit", (code) => {
    serverProcess = null;
    // 終了処理中でなければ異常終了として扱う
    if (!app.isQuitting && code !== 0) {
      dialog.showErrorBox(
        "サーバーが停止しました",
        `アプリの内部サーバーが終了コード ${code} で停止しました。\n\n${serverLog}`,
      );
    }
  });
}

async function waitForServer(url) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!serverProcess) throw new Error(`サーバーが起動しませんでした。\n\n${serverLog}`);
    try {
      const response = await fetch(url, { method: "HEAD" });
      if (response.status < 500) return;
    } catch {
      // まだ listen していない
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `サーバーの起動が ${STARTUP_TIMEOUT_MS / 1000} 秒以内に完了しませんでした。\n\n${serverLog}`,
  );
}

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: "#f7f7f5",
    title: "新卒採用ペルソナ設計スタジオ",
    show: false,
    webPreferences: {
      // レンダラーは通常の Web ページとして動かす。Node 統合は不要。
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());

  // 外部リンクは OS の既定ブラウザで開く（アプリ内遷移させない）
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    shell.openExternal(target);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, target) => {
    if (!target.startsWith(url)) {
      event.preventDefault();
      shell.openExternal(target);
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.loadURL(url);
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    {
      label: "ファイル",
      submenu: [isMac ? { role: "close" } : { role: "quit" }],
    },
    {
      label: "編集",
      submenu: [
        { role: "undo", label: "元に戻す" },
        { role: "redo", label: "やり直す" },
        { type: "separator" },
        { role: "cut", label: "切り取り" },
        { role: "copy", label: "コピー" },
        { role: "paste", label: "貼り付け" },
        { role: "selectAll", label: "すべて選択" },
      ],
    },
    {
      label: "表示",
      submenu: [
        { role: "reload", label: "再読み込み" },
        { role: "resetZoom", label: "実際のサイズ" },
        { role: "zoomIn", label: "拡大" },
        { role: "zoomOut", label: "縮小" },
        { type: "separator" },
        { role: "togglefullscreen", label: "フルスクリーン" },
        { role: "toggleDevTools", label: "開発者ツール" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function bootstrap() {
  try {
    const port = await findFreePort();
    const url = `http://${HOST}:${port}`;
    startServer(port);
    await waitForServer(url);
    // 起動確認やトラブルシュートのために URL を残す
    console.log(`[persona-studio] server ready at ${url}`);
    buildMenu();
    createWindow(url);
  } catch (error) {
    dialog.showErrorBox(
      "起動に失敗しました",
      error instanceof Error ? error.message : String(error),
    );
    app.quit();
  }
}

// 同じアプリを二重起動させない（ポートとデータの取り合いを防ぐ）
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(bootstrap);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) bootstrap();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", () => {
    app.isQuitting = true;
  });

  app.on("will-quit", () => {
    if (serverProcess) {
      serverProcess.kill();
      serverProcess = null;
    }
  });
}
