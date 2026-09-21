/**
 * 信任来源 + 免责声明
 *
 * 背景：插件来自 GitHub 仓库，任何人都能提交。
 * 但**官方插件仓库**是本人维护的，每次安装都弹权限框没有意义。
 *
 * 策略：
 *   · 官方来源（白名单）→ 自动授信，按 plugin.json 声明全量授权，不弹窗
 *   · 其他来源         → 首次显示免责声明（一次性），之后每次安装弹权限框
 *
 * ★ 注意：自动授信不等于取消校验。
 *   运行时的 GrantStore.check 依然存在 —— 防止插件被冒充身份调用。
 */

/** 官方插件仓库（本人维护，可信） */
const OFFICIAL_REPOS = [
    'Cool-zimo/github_drive_plugins',
    'Cool-zimo/GD-Plugin-CoolClock'
];

/** 免责声明版本号 —— 改动文案时递增，会重新弹一次 */
const DISCLAIMER_VERSION = 1;

const DISCLAIMER = `安装第三方插件存在风险，请确认你了解以下内容：

1. 插件由第三方作者提供，不是本项目官方维护。
2. 若你授予「运行命令」权限，插件将能在你的电脑上执行任意程序，
   等同于把终端交给插件作者。
3. 若你授予「写入本地文件」权限，插件可以改写或删除你的文件。
4. 本项目只做权限声明与提示，无法审计插件的实际行为。

请仅安装你信任的作者发布的插件。`;

/**
 * 判断插件来源是否官方
 * @param {string} repoFullName  形如 "owner/repo"
 */
function isOfficial(repoFullName) {
    const s = String(repoFullName || '').trim();
    if (!s) return false;
    // ★ 大小写不敏感：GitHub 用户名/仓库名比较应忽略大小写
    const low = s.toLowerCase();
    return OFFICIAL_REPOS.some(r => r.toLowerCase() === low);
}

/**
 * 规范化仓库全名（去掉 .git 后缀、首尾空格）
 */
function normRepo(name) {
    return String(name || '').trim().replace(/\.git$/i, '');
}

/**
 * 决定一次安装该走哪条路
 * @returns {{mode:'auto'|'ask'|'disclaimer'|'error', reason?:string}}
 */
function decideInstall(plugin) {
    const id = String((plugin && plugin.id) || '').trim();
    if (!id) return { mode: 'error', reason: '插件缺少 id' };

    const repo = normRepo(plugin.repoFullName);
    if (!repo) {
        // 没有来源信息 —— 无法判断可信度，按第三方处理（更保守）
        return { mode: 'disclaimer' };
    }
    if (isOfficial(repo)) return { mode: 'auto' };
    return { mode: 'disclaimer' };
}

module.exports = {
    OFFICIAL_REPOS,
    DISCLAIMER,
    DISCLAIMER_VERSION,
    isOfficial,
    normRepo,
    decideInstall
};
