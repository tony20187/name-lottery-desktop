const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow () {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    autoHideMenuBar: false,   // 顯示選單列
    frame: true,              // 保留標準視窗框（縮小、放大、關閉）
    title: "華谷電機 - 名字抽獎 🎉",  // ✅ 自訂標題
    icon: path.join(__dirname, 'assets', 'icon.ico'), // ✅ 自訂 icon
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    }
  });

  // 一打開就最大化（不是 kiosk）
  win.maximize();

  // 載入首頁
  win.loadFile('index.html');
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
