/**
 * preload —— 在渲染进程和主进程之间架桥
 *
 * ★ 必须开 contextIsolation + 用 contextBridge。
 *   直接把 require / ipcRenderer 暴露给页面 = 插件可以绕过一切权限检查。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('native', {
    /**
     * 调用原生能力
     * @returns {Promise<{ok:boolean, data?:any, error?:string}>}
     */
    invoke(perm, method, args) {
        return ipcRenderer.invoke('native:invoke', { perm, method, args });
    },

    /** 查询已授予的权限（用于插件自己判断能不能用某项能力） */
    granted() {
        return ipcRenderer.invoke('native:granted');
    },

    /** 打开目录选择对话框 */
    pickDir() {
        return ipcRenderer.invoke('native:pickDir');
    },

    /** 打开单个文件选择对话框 */
    pickFile(filters) {
        return ipcRenderer.invoke('native:pickFile', filters);
    },

    /** 平台信息 */
    platform: process.platform,

    /** 监听主进程推送（比如权限变更） */
    on(channel, cb) {
        const allowed = ['native:grants-changed'];
        if (!allowed.includes(channel)) return () => {};
        const h = (_e, ...a) => cb(...a);
        ipcRenderer.on(channel, h);
        return () => ipcRenderer.removeListener(channel, h);
    }
});
