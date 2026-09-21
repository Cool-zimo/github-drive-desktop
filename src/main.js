/**
 * 主进程
 *
 * 安全前提（缺一不可）：
 *   contextIsolation: true   —— 页面 JS 和 preload 隔离
 *   nodeIntegration:  false  —— 页面拿不到 require
 *   sandbox:          true   —— 渲染进程沙箱化
 *
 * 页面唯一能碰原生的入口是 preload 暴露的 window.native，
 * 而它最终都走这里的 ipcMain.handle('native:invoke')，
 * 每次都经过 GrantStore.check。
 */
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const { promisify } = require('util');

const { GrantStore, normalize, info, ALL } = require('./permissions.js');
const { decideInstall, DISCLAIMER, DISCLAIMER_VERSION } = require('./trust.js');
const { Handlers } = require('./handlers.js');

const execAsync = promisify(exec);

/** 授权持久化文件 */
function grantsPath() {
    return path.join(app.getPath('userData'), 'grants.json');
}

let grants = new GrantStore();
let handlers = null;
let win = null;

function loadGrants() {
    try {
        const p = grantsPath();
        if (fs.existsSync(p)) {
            grants = new GrantStore(JSON.parse(fs.readFileSync(p, 'utf8')));
        }
    } catch (e) {
        console.warn('[grants] 读取失败，用空授权：', e.message);
        grants = new GrantStore();
    }
}

function saveGrants() {
    try {
        fs.mkdirSync(path.dirname(grantsPath()), { recursive: true });
        fs.writeFileSync(grantsPath(), JSON.stringify(grants.toJSON(), null, 2), 'utf8');
    } catch (e) {
        console.error('[grants] 保存失败：', e.message);
    }
}

const APP_URL = 'https://cool-zimo.github.io/github_drive/';

function createWindow() {
    win = new BrowserWindow({
        width: 1280,
        height: 860,
        title: 'GitHub Drive',
        backgroundColor: '#0d1117',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,     // ★ 不能关
            nodeIntegration: false,     // ★ 不能开
            sandbox: true
        }
    });

    win.loadURL(APP_URL);

    // 站外链接用系统浏览器打开，别在应用里瞎跳
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('https://cool-zimo.github.io')) return { action: 'allow' };
        shell.openExternal(url);
        return { action: 'deny' };
    });

    win.on('closed', () => { win = null; });
}

app.whenReady().then(() => {
    loadGrants();

    handlers = new Handlers({
        grants,
        fs: {
            readFile: (p, enc) => fs.promises.readFile(p, enc || 'utf8'),
            writeFile: (p, d, enc) => fs.promises.writeFile(p, d, enc || 'utf8'),
            mkdir: (p, o) => fs.promises.mkdir(p, o),
            unlink: p => fs.promises.unlink(p),
            readdir: (p, o) => fs.promises.readdir(p, o)
        },
        exec: (cmd, o) => execAsync(cmd, { ...o, windowsHide: true }),
        roots: []   // 空 = 不限制目录（权限在安装时已经确认过）
    });

    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// ── IPC ──────────────────────────────────────────────────

/**
 * 原生能力调用 —— 唯一的执行入口
 *
 * ★ pluginId 不能由页面自己传！
 *   否则插件 A 可以冒充插件 B 调用已授权的能力。
 *   正确做法是从调用来源（URL / frame）识别插件身份。
 */
ipcMain.handle('native:invoke', async (event, { perm, method, args }) => {
    const pluginId = pluginIdFrom(event);
    if (!pluginId) return { ok: false, error: '无法识别插件身份' };
    return await handlers.invoke(pluginId, perm, method, args);
});

/**
 * 从调用来源识别插件 id
 *
 * 插件运行在 iframe / 独立窗口里，URL 上带 ?plugin=<id>。
 * 主应用自己（不带 plugin 参数）走 'app'。
 */
function pluginIdFrom(event) {
    try {
        const u = new URL(event.senderFrame ? event.senderFrame.url : event.sender.getURL());
        const p = u.searchParams.get('plugin');
        return p ? String(p).slice(0, 64) : 'app';
    } catch (e) {
        return 'app';
    }
}

ipcMain.handle('native:granted', (event) => {
    return grants.granted(pluginIdFrom(event));
});

/**
 * 安装插件
 *
 * 分三种情况：
 *   · 官方来源（本人维护的仓库）→ 按声明全量授权，不弹窗
 *   · 第三方 → 先弹免责声明（每个版本只弹一次），再弹权限框
 *   · 缺 id → 直接报错
 *
 * ★ 自动授信 ≠ 取消校验。GrantStore.check 依然在运行时拦截，
 *   防止插件被冒充身份调用已授权的能力。
 */
ipcMain.handle('native:install', async (event, plugin) => {
    const id = String((plugin && plugin.id) || '').trim();
    const route = decideInstall(plugin);

    if (route.mode === 'error') return { ok: false, error: route.reason };

    const { perms, unknown } = normalize(plugin && plugin.permissions);

    // 纯前端插件（不申请任何权限）—— 不用弹任何框
    if (perms.length === 0) {
        grants.grant(id, []);
        saveGrants();
        return { ok: true, granted: [], official: route.mode === 'auto' };
    }

    const official = route.mode === 'auto';

    // ── 第三方：一次性免责声明 ──────────────────────────
    if (!official) {
        const ack = acknowledgedDisclaimer();
        if (!ack) {
            const r = await dialog.showMessageBox(win, {
                type: 'warning',
                buttons: ['我已了解风险', '取消安装'],
                defaultId: 1,
                cancelId: 1,
                title: '第三方插件风险提示',
                message: '你正在安装第三方插件',
                detail: DISCLAIMER
            });
            if (r.response !== 0) return { ok: false, cancelled: true };
            markDisclaimer();
        }
    }

    // ── 官方插件：直接授信，不打扰 ──────────────────────
    if (official) {
        grants.grant(id, perms);
        saveGrants();
        if (win) win.webContents.send('native:grants-changed', grants.toJSON());
        return { ok: true, granted: perms, official: true, auto: true };
    }

    // ── 第三方：逐项列出权限 ────────────────────────────
    const lines = perms.map(p => {
        const i = info(p);
        const mark = i.risk === 'critical' ? '⛔' : (i.risk === 'high' ? '⚠️' : '·');
        return `${mark} ${i.label}（${p}）\n     ${i.desc}`;
    });

    const warn = unknown.length
        ? `\n\n⚠️ 该插件声明了 ${unknown.length} 个未知权限，已按最高风险处理。`
        : '';

    const res = await dialog.showMessageBox(win, {
        type: perms.some(p => info(p).risk === 'critical') ? 'warning' : 'question',
        buttons: ['授权并安装', '取消'],
        defaultId: 1,          // 默认落在"取消"，避免连点误授权
        cancelId: 1,
        title: '插件权限确认',
        message: `「${plugin.name || id}」需要以下权限：`,
        detail: lines.join('\n\n') + warn + '\n\n只有你信任的作者才该授权「运行命令」。'
    });

    if (res.response !== 0) return { ok: false, cancelled: true };

    grants.grant(id, perms);
    saveGrants();
    if (win) win.webContents.send('native:grants-changed', grants.toJSON());
    return { ok: true, granted: perms, official: false };
});

/** 免责声明是否已确认过（按版本号记，改文案会重新弹） */
function disclaimerKeyPath() {
    return path.join(app.getPath('userData'), 'disclaimer.json');
}
function acknowledgedDisclaimer() {
    try {
        const p = disclaimerKeyPath();
        if (!fs.existsSync(p)) return false;
        const d = JSON.parse(fs.readFileSync(p, 'utf8'));
        return Number(d && d.version) === DISCLAIMER_VERSION;
    } catch (e) {
        return false;
    }
}
function markDisclaimer() {
    try {
        fs.mkdirSync(path.dirname(disclaimerKeyPath()), { recursive: true });
        fs.writeFileSync(disclaimerKeyPath(),
            JSON.stringify({ version: DISCLAIMER_VERSION, at: new Date().toISOString() }), 'utf8');
    } catch (e) {
        console.error('[disclaimer] 写入失败：', e.message);
    }
}

ipcMain.handle('native:revoke', async (event, pluginId) => {
    grants.revoke(String(pluginId || ''));
    saveGrants();
    if (win) win.webContents.send('native:grants-changed', grants.toJSON());
    return { ok: true };
});

ipcMain.handle('native:pickDir', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('native:pickFile', async (_e, filters) => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters });
    return r.canceled ? null : r.filePaths[0];
});
