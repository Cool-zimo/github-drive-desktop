import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const T = require('./src/trust.js');
const { isOfficial, normRepo, decideInstall, OFFICIAL_REPOS, DISCLAIMER, DISCLAIMER_VERSION } = T;

let pass=0, fail=0;
const check=(l,c,e='')=>{c?(pass++,console.log('  ✓ '+l)):(fail++,console.log('  ✗ '+l+'  '+(e||'')));};

console.log('【① 官方来源识别】');
check('★ 官方仓库返回 true', isOfficial('Cool-zimo/github_drive_plugins')===true);
check('★ 大小写不敏感', isOfficial('cool-zimo/GitHub_Drive_Plugins')===true);
check('★ 第三方仓库返回 false', isOfficial('someone/evil-plugin')===false);
check('★ 空值 false', isOfficial('')===false);
check('  null false', isOfficial(null)===false);
check('  undefined false', isOfficial(undefined)===false);
check('★ 近似名不算官方（防前缀/后缀混淆）', isOfficial('Cool-zimo/github_drive_plugins2')===false);
check('★ 冒充：evil 前缀', isOfficial('evil/Cool-zimo/github_drive_plugins')===false);
check('★ 冒充：加路径', isOfficial('Cool-zimo/github_drive_plugins/x')===false);
check('  第二个官方仓库也识别', OFFICIAL_REPOS.length>=2 && isOfficial(OFFICIAL_REPOS[1])===true);

console.log('\n【② 仓库名规范化】');
check('  去首尾空格', normRepo('  a/b  ')==='a/b');
check('★ 去 .git 后缀', normRepo('a/b.git')==='a/b');
check('  去大写 .GIT', normRepo('a/b.GIT')==='a/b');
check('  null → 空串', normRepo(null)==='');
check('  正常名不变', normRepo('Cool-zimo/x')==='Cool-zimo/x');

console.log('\n【③ 安装决策路由】');
{
  const r=decideInstall({id:'p1', repoFullName:'Cool-zimo/github_drive_plugins'});
  check('★ 官方插件 → auto（不弹窗）', r.mode==='auto', JSON.stringify(r));
}
{
  const r=decideInstall({id:'p1', repoFullName:'someone/evil'});
  check('★ 第三方 → disclaimer', r.mode==='disclaimer', JSON.stringify(r));
}
{
  const r=decideInstall({id:'p1'});
  check('★ 无来源信息 → disclaimer（保守）', r.mode==='disclaimer', JSON.stringify(r));
}
{
  const r=decideInstall({id:'p1', repoFullName:''});
  check('  空来源 → disclaimer', r.mode==='disclaimer', JSON.stringify(r));
}
{
  const r=decideInstall({});
  check('★ 缺 id → error', r.mode==='error', JSON.stringify(r));
  check('  error 带 reason', !!r.reason);
}
{
  const r=decideInstall(null);
  check('  null → error 不崩', r.mode==='error');
}
{
  // ★ 带 .git 的官方仓库也要能识别
  const r=decideInstall({id:'p1', repoFullName:'Cool-zimo/github_drive_plugins.git'});
  check('★ 官方仓库带 .git 后缀也走 auto', r.mode==='auto', JSON.stringify(r));
}

console.log('\n【④ 免责声明文案】');
check('  版本号是正整数', Number.isInteger(DISCLAIMER_VERSION) && DISCLAIMER_VERSION>0);
check('  文案非空', typeof DISCLAIMER==='string' && DISCLAIMER.length>50);
check('★ 提到"运行命令"风险', /运行命令/.test(DISCLAIMER));
check('★ 提到"删除你的文件"', /删除/.test(DISCLAIMER));
check('★ 明确无法审计', /无法审计/.test(DISCLAIMER));
check('★ 提示只装信任作者', /信任的作者/.test(DISCLAIMER));

console.log(`\n═══ 结果：${pass} 通过 / ${fail} 失败 ═══`);
process.exit(fail>0?1:0);
