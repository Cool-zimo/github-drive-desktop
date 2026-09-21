/**
 * 原生能力处理器（依赖注入，便于测试）
 *
 * 为什么单独抽出来：Electron 的 main 进程在测试环境跑不起来，
 * 但"权限校验 → 执行"这段逻辑是最该测的。把 fs / exec 做成注入的依赖，
 * 就能在 node 里用 mock 完整验证。
 */
const { GrantStore, checkCommand, info } = require('./permissions.js');

class Handlers {
    /**
     * @param {object} opts
     * @param {GrantStore} opts.grants
     * @param {object} opts.fs       { readFile, writeFile, readdir, stat, mkdir, unlink }
     * @param {function} opts.exec    (cmd, opts) => Promise<{stdout, stderr}>
     * @param {string[]} opts.roots  允许访问的根目录（空 = 不限制）
     */
    constructor(opts) {
        this.grants = opts.grants || new GrantStore();
        this.fs = opts.fs || {};
        this.exec = opts.exec || (async () => { throw new Error('未提供 exec'); });
        this.roots = (opts.roots || []).map(r => String(r).replace(/[\\/]+$/, ''));
    }

    /**
     * 统一入口
     * @param {string} pluginId
     * @param {string} perm
     * @param {string} method
     * @param {Array} args
     */
    async invoke(pluginId, perm, method, args) {
        const pid = String(pluginId || '');
        if (!pid) return { ok: false, error: '缺少插件 ID' };

        const g = this.grants.check(pid, perm);
        if (!g.ok) return { ok: false, error: g.reason, denied: true };

        const a = Array.isArray(args) ? args : [];

        try {
            switch (perm) {
                case 'fs:read':  return await this._read(a);
                case 'fs:write': return await this._write(method, a);
                case 'fs:list':  return await this._list(a);
                case 'exec':     return await this._exec(a);
                default:
                    return { ok: false, error: `未知权限 "${perm}"` };
            }
        } catch (e) {
            // ★ 不把原始堆栈抛给插件 —— 可能含本地绝对路径等敏感信息
            return { ok: false, error: String((e && e.message) || e) };
        }
    }

    /**
     * 路径校验（防目录穿越）
     *
     * 即使插件拿到了 fs:read，也不该让它读系统任意位置。
     * 若配置了 roots，路径必须在其中一个根目录下。
     */
    _safePath(p) {
        const s = String(p == null ? '' : p);
        if (!s) throw new Error('路径为空');

        const norm = s.replace(/\\/g, '/');
        if (norm.indexOf('\0') >= 0) throw new Error('路径含非法字符');
        if (/(^|\/)\.\.(\/|$)/.test(norm)) throw new Error('路径不允许含 .. （目录穿越）');

        if (this.roots.length) {
            const ok = this.roots.some(r => {
                const rn = r.replace(/\\/g, '/');
                return norm === rn || norm.indexOf(rn + '/') === 0;
            });
            if (!ok) throw new Error('路径不在允许访问的目录内：' + s);
        }
        return s;
    }

    async _read(a) {
        const p = this._safePath(a[0]);
        const enc = a[1] || 'utf8';
        const data = await this.fs.readFile(p, enc);
        return { ok: true, data };
    }

    async _write(method, a) {
        switch (method) {
            case 'writeFile': {
                const p = this._safePath(a[0]);
                await this.fs.writeFile(p, String(a[1] == null ? '' : a[1]), a[2] || 'utf8');
                return { ok: true };
            }
            case 'mkdir': {
                const p = this._safePath(a[0]);
                await this.fs.mkdir(p, { recursive: a[1] !== false });
                return { ok: true };
            }
            case 'unlink': {
                const p = this._safePath(a[0]);
                await this.fs.unlink(p);
                return { ok: true };
            }
            case 'copy': {
                const src = this._safePath(a[0]);
                const dst = this._safePath(a[1]);
                const data = await this.fs.readFile(src);
                await this.fs.writeFile(dst, data);
                return { ok: true };
            }
            default:
                return { ok: false, error: `fs:write 不支持 "${method}"` };
        }
    }

    async _list(a) {
        const p = this._safePath(a[0] || '.');
        const items = await this.fs.readdir(p, { withFileTypes: true });
        // ★ readdir({withFileTypes:true}) 返回的是 Dirent 对象，
        //   isDirectory 是**方法**不是属性。写成 !!it.isDirectory 的话
        //   函数对象恒为 true，所有条目都会被误判成目录。
        const out = (items || []).map(it => {
            if (typeof it === 'string') return { name: it, isDir: false };
            const d = typeof it.isDirectory === 'function' ? it.isDirectory() : it.isDirectory;
            return { name: it.name, isDir: !!d };
        });
        return { ok: true, items: out };
    }

    async _exec(a) {
        const cmd = String(a[0] == null ? '' : a[0]);
        const c = checkCommand(cmd);
        if (!c.ok) return { ok: false, error: c.why, blocked: true };

        const cwd = a[1] ? this._safePath(a[1]) : undefined;
        const r = await this.exec(cmd, {
            cwd,
            timeout: Math.min(Number(a[2]) || 30000, 300000)   // 上限 5 分钟
        });
        return { ok: true, stdout: r.stdout || '', stderr: r.stderr || '' };
    }
}

module.exports = { Handlers };
