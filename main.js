const { app, BrowserWindow, Menu, WebContentsView, session, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { showInputDialog } = require('./prompt-dialog');

app.setAppUserModelId('com.you.feishu-tabs');

// ---------- 单实例锁 ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

// ---------- 常量 ----------
const URL_LARK    = 'https://www.larksuite.com/messenger/';
const URL_FEISHU  = 'https://www.feishu.cn/messenger/';
const DEFAULT_URL = URL_LARK;

let ACCOUNTS_FILE = '';
let STATE_FILE = '';

let accounts = [];
let mainWin = null;
let currentId = null;
const views = new Map();

// ---------- 可信域名白名单 ----------
function isTrustedUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    return (
      u.hostname.endsWith('larksuite.com') ||
      u.hostname.endsWith('feishu.cn') ||
      u.hostname.includes('feishu.cn') ||
      u.hostname.includes('larksuite.com')
    );
  } catch {
    return false;
  }
}

// ---------- 账号配置持久化 ----------
function loadAccounts() {
  ACCOUNTS_FILE = path.join(app.getPath('userData'), 'accounts.json');
  STATE_FILE = path.join(app.getPath('userData'), 'state.json');
  try {
    if (fs.existsSync(ACCOUNTS_FILE)) {
      accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf-8'));
      if (!Array.isArray(accounts)) accounts = [];
    } else {
      const tpl = path.join(__dirname, 'accounts.json');
      if (fs.existsSync(tpl)) {
        try {
          accounts = JSON.parse(fs.readFileSync(tpl, 'utf-8'));
        } catch {
          accounts = [];
        }
      }
      saveAccounts();
    }
  } catch (e) {
    console.error('[启动] accounts.json 读取异常:', e.message);
    accounts = [];
  }
}

function saveAccounts() {
  try {
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), 'utf-8');
  } catch (e) {
    console.error('[保存] accounts.json 写入失败:', e.message);
  }
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function saveState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch {
    /* 忽略 */
  }
}

// ---------- 创建 / 获取账号视图（懒加载） ----------
function getOrCreateView(acc) {
  if (views.has(acc.id)) return views.get(acc.id);

  const partition = `persist:feishu-${acc.id}`;
  const ses = session.fromPartition(partition);

  ses.setPermissionRequestHandler((wc, permission, callback) => {
    const url = wc.getURL() || '';
    callback(isTrustedUrl(url) && ['notifications', 'media'].includes(permission));
  });

  const view = new WebContentsView({
    webPreferences: {
      partition,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  // 加载失败退避重试
  let failCount = 0;
  view.webContents.on('did-fail-load', (_e, errorCode, _desc, _validatedUrl, isMainFrame) => {
    if (!isMainFrame) return;
    if (errorCode === -3) return;
    failCount += 1;
    if (failCount <= 3) {
      const delay = 1500 * failCount;
      console.warn(`[${acc.name}] 加载失败 code=${errorCode}，${delay}ms 后第 ${failCount} 次重试`);
      setTimeout(() => view.webContents.loadURL(acc.url), delay);
    }
  });

  // 快捷键兜底：Ctrl+1..9/0 切换
  view.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.control && !input.shift && !input.alt && !input.meta && /^[0-9]$/.test(input.key)) {
      const idx = input.key === '0' ? 9 : Number(input.key) - 1;
      const target = accounts[idx];
      if (target && target.id !== currentId) {
        event.preventDefault();
        switchTo(target.id);
      }
    }
  });

  // 外链走系统浏览器
  view.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  view.webContents.loadURL(acc.url);
  views.set(acc.id, view);
  return view;
}

// ---------- 布局 ----------
function layoutCurrent() {
  if (!mainWin || !currentId) return;
  const view = views.get(currentId);
  if (!view) return;
  const [w, h] = mainWin.getContentSize();
  view.setBounds({ x: 0, y: 0, width: w, height: h });
}

// ---------- 切换账号 ----------
function switchTo(id) {
  const acc = accounts.find((a) => a.id === id);
  if (!acc || !mainWin) return;

  const nextView = getOrCreateView(acc);
  if (currentId && currentId !== id && views.has(currentId)) {
    mainWin.contentView.removeChildView(views.get(currentId));
  }
  if (currentId !== id) {
    mainWin.contentView.addChildView(nextView);
  }

  currentId = id;
  layoutCurrent();
  nextView.webContents.focus();
  mainWin.setTitle(`飞书多账号 - ${acc.name}`);
  saveState({ lastAccountId: id });
  buildMenu();
}

// ---------- 关闭视图（保留登录态） ----------
function closeView(id) {
  const view = views.get(id);
  if (!view) return;

  if (mainWin && currentId === id) {
    mainWin.contentView.removeChildView(view);
  }
  view.webContents.close();
  views.delete(id);

  // 先确定下一个账号，再更新 currentId，防止 switchTo 里误删已销毁视图
  const next = [...views.keys()][0];
  if (next) {
    currentId = null;
    switchTo(next);
  } else {
    currentId = null;
    buildMenu();
    if (mainWin) mainWin.setTitle('飞书多账号');
  }
}

// ---------- 动态添加账号 ----------
async function addAccount() {
  const choice = await showInputDialog({
    title: '添加账号',
    label: '服务类型',
    initialValue: 'lark',
    placeholder: 'lark 或 feishu',
    parent: mainWin,
    hint: '默认 Lark（国际版）；输入 feishu 添加国内版账号。',
  });
  if (choice === null) return;
  const isFeishu = String(choice).trim().toLowerCase() === 'feishu';
  const n = accounts.length + 1;
  const id = 'a_' + Date.now().toString(36);
  accounts.push({ id, name: `账号${n}`, url: isFeishu ? URL_FEISHU : URL_LARK });
  saveAccounts();
  switchTo(id);
}

// ---------- 删除账号 ----------
async function removeAccount(id) {
  const acc = accounts.find((a) => a.id === id);
  if (!acc) return;

  const res = await dialog.showMessageBox(mainWin, {
    type: 'warning',
    buttons: ['取消', '删除并清除登录态'],
    defaultId: 0,
    cancelId: 0,
    message: `删除账号「${acc.name}」？`,
    detail: '将关闭该账号视图并清除本地登录态（cookie/缓存），此操作不可恢复。',
  });
  if (res.response !== 1) return;

  closeView(id);
  try {
    await session.fromPartition(`persist:feishu-${id}`).clearStorageData();
  } catch (e) {
    console.warn('[删除] 清除登录态失败:', e.message);
  }
  accounts = accounts.filter((a) => a.id !== id);
  saveAccounts();
  buildMenu();
}

// ---------- 重命名账号 ----------
async function renameAccount(id) {
  const acc = accounts.find((a) => a.id === id);
  if (!acc || !mainWin) return;

  const name = await showInputDialog({
    title: '重命名账号',
    label: '账号名称',
    initialValue: acc.name,
    placeholder: '请输入新名称',
    parent: mainWin,
  });
  if (!name) return;

  acc.name = name.slice(0, 20);
  saveAccounts();
  buildMenu();
  if (currentId === id) mainWin.setTitle(`飞书多账号 - ${acc.name}`);
}

// ---------- 顶部原生菜单 ----------
function buildAccountSubmenu() {
  const accountItems = accounts.map((acc, i) => ({
    label: acc.name,
    type: 'radio',
    checked: acc.id === currentId,
    accelerator: i < 9 ? `CmdOrCtrl+${i + 1}` : i === 9 ? 'CmdOrCtrl+0' : undefined,
    click: () => switchTo(acc.id),
  }));
  const hasCurrent = Boolean(currentId);
  return [
    { label: '＋ 添加账号', accelerator: 'CmdOrCtrl+Shift+N', click: () => addAccount() },
    { type: 'separator' },
    ...accountItems,
    { type: 'separator' },
    { label: '重命名当前账号…', enabled: hasCurrent, click: () => currentId && renameAccount(currentId) },
    { label: '删除当前账号…', enabled: hasCurrent, click: () => currentId && removeAccount(currentId) },
    { type: 'separator' },
    { label: '打开账号配置目录', click: () => shell.showItemInFolder(ACCOUNTS_FILE) },
  ];
}

function buildViewSubmenu() {
  return [
    { type: 'separator' },
    { label: '刷新当前账号', accelerator: 'CmdOrCtrl+R', click: () => currentId && views.get(currentId)?.webContents.reload() },
    { label: '开发者工具（当前账号）', accelerator: 'CmdOrCtrl+Shift+I', click: () => currentId && views.get(currentId)?.webContents.openDevTools({ mode: 'detach' }) },
    { type: 'separator' },
    { label: '关闭当前账号视图（保留登录态）', accelerator: 'CmdOrCtrl+W', click: () => currentId && closeView(currentId) },
    {
      label: '关闭其他账号视图（保留登录态）',
      click: () => {
        for (const id of [...views.keys()]) {
          if (id !== currentId) closeView(id);
        }
      },
    },
  ];
}

function buildMenu() {
  const template = [
    { label: '账号', submenu: buildAccountSubmenu() },
    { label: '视图', submenu: buildViewSubmenu() },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- 主窗口 ----------
function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 1280, height: 860, title: '飞书多账号', autoHideMenuBar: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  mainWin.loadURL('about:blank');
  mainWin.on('resize', layoutCurrent);
  mainWin.on('closed', () => { mainWin = null; });
}

// ---------- 启动 ----------
app.whenReady().then(() => {
  loadAccounts();
  createMainWindow();
  buildMenu();

  const state = loadState();
  const last = accounts.find((a) => a.id === state.lastAccountId);
  const target = last || accounts[0];
  if (target) {
    switchTo(target.id);
  } else {
    addAccount();
  }
});

app.on('second-instance', () => {
  if (mainWin) {
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.focus();
  }
});

app.on('window-all-closed', () => app.quit());

app.on('before-quit', () => {
  for (const view of views.values()) {
    view.webContents.close();
  }
  views.clear();
});
