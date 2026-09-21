# GitHub Drive 桌面版

> 让 GitHub Drive 的插件能**读写本地文件、运行命令**。
> 网页版做不到这件事（浏览器沙箱），桌面版可以。

## 为什么要有桌面版

网页版插件被浏览器沙箱限制：不能碰文件系统，不能起进程。
很多实用的事做不了 —— 比如「把网盘里的文件同步到本地某个目录」
「下载完自动用本地工具转码」。

Electron 补上这部分能力，同时**用权限模型兜住风险**。

## ⚠️ 最重要的一件事

**插件来自 GitHub 仓库，任何人都能提交。装插件 = 远程代码在你电脑上执行。**

所以不能直接把 `fs` / `child_process` 暴露给插件。这里的做法是：

1. 插件在 `plugin.json` 里**声明**需要哪些权限
2. 安装时弹窗列出来给你看，**默认选中「取消」**，避免连点误授权
3. 授权记录写进 `grants.json`
4. **运行时每次调用都校验**，未授权直接拒绝

## 权限列表

| 权限 | 能做什么 | 风险 |
|---|---|---|
| `fs:read` | 读取本地文件 | 低 |
| `fs:list` | 浏览目录 | 低 |
| `net` | 访问网络 | 中 |
| `fs:write` | 创建/修改/删除文件 | 高 |
| `exec` | 运行命令行程序 | ⛔ 极高 |

**未知权限一律按最高风险处理** —— 宁可挡住，不能放行。

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
