/**
 * 权限模型（纯逻辑，可在 node 里直接测）
 *
 * 背景：插件来自 GitHub 仓库，任何人都能提交 —— 装插件 = 远程代码在你电脑上执行。
 * 所以不能直接把 fs / child_process 暴露出去。
 *
 * 模型：
 *   1. 插件在 plugin.json 里声明 permissions
 *   2. 安装时把声明列给用户看，授权后写入 grants.json
 *   3. 运行时每次调用都校验 grant，未授权直接拒绝
 */

/** 所有已知权限 */
const ALL = {
    'fs:read': {
        label: '读取本地文件',
        desc: '读取你电脑上的文件内容',
        risk: 'low'
    },
    'fs:write': {
        label: '写入本地文件',
        desc: '在你电脑上创建、修改、删除文件',
        risk: 'high'
    },
    'fs:list': {
        label: '浏览目录',
        desc: '列出你电脑上某个文件夹里有哪些文件',
        risk: 'low'
    },
    'exec': {
        label: '运行命令',
        desc: '在你电脑上执行命令行程序（等同把终端交给插件）',
        risk: 'critical'
    },
    'net': {
        label: '访问网络',
        desc: '向任意地址发起网络请求',
        risk: 'medium'
    }
};

/** 风险等级排序，用于 UI 排序和配色 */
const RISK_ORDER = { low: 0, medium: 1, high: 2, critical: 3 };

/** 未知权限一律按最高风险处理 —— 宁可挡住，不能放行 */
function info(perm) {
    return ALL[perm] || {
        label: perm,
        desc: '未知权限（未在白名单中，按最高风险处理）',
        risk: 'critical',
        unknown: true
    };
}

/**
 * 规范化插件声明的权限
 * @returns {{perms: string[], unknown: string[]}}
 */
function normalize(declared) {
    const raw = Array.isArray(declared) ? declared : (declared ? [declared] : []);
    const seen = new Set();
    const perms = [];
    const unknown = [];
    for (const p of raw) {
        const key = String(p || '').trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        perms.push(key);
        if (!ALL[key]) unknown.push(key);
    }
    // 按风险从高到低排，让用户先看到最危险的
    perms.sort((a, b) => RISK_ORDER[info(b).risk] - RISK_ORDER[info(a).risk]);
    return { perms, unknown };
}

/** 权限存储（内存实现，便于测试；main 进程里换成持久化） */
class GrantStore {
    constructor(initial) {
        this.grants = {};
        if (initial && typeof initial === 'object') {
            for (const k of Object.keys(initial)) {
                this.grants[k] = Array.isArray(initial[k]) ? initial[k].slice() : [];
            }
        }
    }

    /** 授权（覆盖式） */
    grant(pluginId, perms) {
        const { perms: clean } = normalize(perms);
        this.grants[pluginId] = clean;
        return clean;
    }

    /** 撤销单个插件的全部权限 */
    revoke(pluginId) {
        delete this.grants[pluginId];
    }

    /** 已授予的权限 */
    granted(pluginId) {
        return (this.grants[pluginId] || []).slice();
    }

    /**
     * 校验一次调用
     * @returns {{ok: boolean, reason?: string}}
     */
    check(pluginId, perm) {
        const key = String(perm || '').trim();
        if (!key) return { ok: false, reason: '权限名为空' };

        const have = this.grants[pluginId];
        if (!have) return { ok: false, reason: `插件 "${pluginId}" 未安装或未授权任何权限` };
        if (!have.includes(key)) {
            return {
                ok: false,
                reason: `插件 "${pluginId}" 未被授予 "${info(key).label}"(${key}) 权限`
            };
        }
        return { ok: true };
    }

    toJSON() {
        return JSON.parse(JSON.stringify(this.grants));
    }
}

/**
 * 命令黑名单 —— 即使授予了 exec 也拒绝
 *
 * 为什么要有：exec 权限本身风险就极高，但有些操作是"无论如何都不该让插件做"的，
 * 属于兜底防线，不是权限替代品。
 */
const FORBIDDEN = [
    { re: /(^|\s)(rm|del|rmdir)\s+(-rf|-fr|-r\s+-f|-f\s+-r)/i, why: '递归强制删除' },
    { re: /(^|\s)format(\.com|\s)/i, why: '格式化磁盘' },
    { re: /(^|\s)(mkfs|diskpart)\b/i, why: '磁盘操作' },
    { re: /(^|\s)shutdown(\.exe)?\s/i, why: '关机' },
    { re: /(^|\s)(curl|wget)\s+[^\s]+\s*\|\s*(ba)?sh/i, why: '下载并直接执行（远程代码执行）' },
    { re: /(^|\s)chmod\s+(-R\s+)?777/i, why: '开放全部文件权限' }
];

/**
 * 校验一条命令
 * @returns {{ok: boolean, why?: string}}
 */
function checkCommand(cmd) {
    const s = String(cmd == null ? '' : cmd);
    if (!s.trim()) return { ok: false, why: '命令为空' };
    for (const f of FORBIDDEN) {
        if (f.re.test(s)) return { ok: false, why: `拒绝执行：${f.why}` };
    }
    return { ok: true };
}

module.exports = { ALL, RISK_ORDER, normalize, info, GrantStore, checkCommand };
