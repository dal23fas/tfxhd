const {app, BrowserWindow, Menu} = require('electron');
const path = require('path');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('enable-features', 'WebAssemblyJSPromiseIntegration');
function create() {
  Menu.setApplicationMenu(null);
  const win = new BrowserWindow({width: 1280, height: 800, backgroundColor: '#000', autoHideMenuBar: true,
    webPreferences: {contextIsolation: true, sandbox: true}});
  win.loadFile(path.join(__dirname, 'tfx.html'));
  win.webContents.on('before-input-event', (e, i) => { if (i.type === 'keyDown' && i.key === 'F11') win.setFullScreen(!win.isFullScreen()); });
}
app.whenReady().then(create);
app.on('window-all-closed', () => app.quit());
