# GitHub Drive 桌面版

> 让 GitHub Drive 的插件能**读写本地文件、运行命令**。
> 网页版做不到这件事（浏览器沙箱），桌面版可以。

## 为什么要有桌面版

网页版插件被浏览器沙箱限制：不能碰文件系统，不能起进程。
很多实用的事做不了 —— 比如「把网盘里的文件同步到本地某个目录」
「下载完自动用本地工具转码」。

Electron 补上这部分能力，同时**用权限模型兜住风险**。

## 安装策略：官方免打扰，第三方有提示

**插件来自 GitHub 仓库，任何人都能提交。装插件 = 远程代码在你电脑上执行。**

但不是所有插件都要同等对待 —— **官方插件仓库是本人维护的**，
每次安装都弹权限框没有意义。所以分两条路：

| 来源 | 首次 | 安装时 | 授权方式 |
|---|---|---|---|
| **官方**（`Cool-zimo/github_drive_plugins` 等） | — | 不弹窗 | 按 `plugin.json` 声明**自动全量授信** |
| **第三方** | 弹一次免责声明 | 弹权限框 | 逐项确认，默认选中「取消」 |

第三方插件的免责声明**每个版本只弹一次**（改文案会重新弹）。

### ★ 自动授信 ≠ 取消校验

官方插件跳过的只是**弹窗**，运行时的 `GrantStore.check` 依然存在。

原因：插件 ID 是从调用来源识别的（见下文），如果取消运行时校验，
插件 A 就能冒充插件 B 调用已授权的能力 —— 那整个权限模型形同虚设。

## 权限列表

| 权限 | 能做什么 | 风险 |
|---|---|---|
| `fs:read` | 读取本地文件 | 低 |
| `fs:list` | 浏览目录 | 低 |
| `net` | 访问网络 | 中 |
| `fs:write` | 创建/修改/删除文件 | 高 |
| `exec` | 运行命令行程序 | ⛔ 极高 |

**未知权限一律按最高风险处理** —— 宁可挡住，不能放行。

## 官方插件仓库

```js
const OFFICIAL_REPOS = [
    'Cool-zimo/github_drive_plugins',
    'Cool-zimo/GD-Plugin-CoolClock'
];
```

判断时**大小写不敏感**，且做了防冒充：

```
✗ Cool-zimo/github_drive_plugins2     不算官方
✗ evil/Cool-zimo/github_drive_plugins 不算官方
✗ Cool-zimo/github_drive_plugins/x    不算官方
✓ Cool-zimo/github_drive_plugins.git  算（自动去掉 .git）
```

**没有来源信息的插件按第三方处理** —— 无法判断可信度时走保守路径。

## 三层防线

即便授权了 `exec`，还有兜底：

```
① 权限校验    没授权 → 拒绝
② 命令黑名单  rm -rf / format / shutdown / curl|sh / chmod 777 → 拒绝
③ 超时上限    最长 5 分钟
```

黑名单不是权限的替代品，是最后一道防线。

## 插件怎么用

`plugin.json`：

```json
{
  "id": "my-plugin",
  "name": "我的插件",
  "file": "index.html",
  "permissions": ["fs:read", "fs:write", "exec"]
}
```

插件代码：

```js
// 读文件
const r = await window.native.invoke('fs:read', 'read', ['/path/to/file.txt']);
if (r.ok) console.log(r.data);

// 写文件
await window.native.invoke('fs:write', 'writeFile', ['/out/a.txt', '内容']);

// 跑命令
const e = await window.native.invoke('exec', 'run', ['git status', '/repo', 30000]);
console.log(e.stdout);

// 让用户选目录（不需要任何权限）
const dir = await window.native.pickDir();
```

## ★ 插件身份不能自己上报

```js
// ipcMain.handle('native:invoke', ...)
const pluginId = pluginIdFrom(event);   // 从 URL 的 ?plugin= 识别
```

**插件 ID 绝不能由页面自己传**。否则插件 A 可以冒充插件 B 调用已授权的能力，
整个权限模型形同虚设。

## 运行

```bash
npm install
npm start
```

## 测试

```bash
npm test
```

覆盖：权限声明规范化、授权/撤销/隔离、命令黑名单、**不能误杀正常命令**、
目录穿越防护、超时上限。

## 打包

```bash
npm run dist
```

## 已知限制

- 首次打开要联网（加载 `cool-zimo.github.io` 上的应用）
- `roots` 目前为空（不限制目录）。想更严可以配成只允许访问特定文件夹
- 没有自动更新
