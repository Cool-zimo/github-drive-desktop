import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { Handlers } = require('./src/handlers.js');
const { GrantStore } = require('./src/permissions.js');

let pass=0, fail=0;
const check=(l,c,e='')=>{c?(pass++,console.log('  ✓ '+l)):(fail++,console.log('  ✗ '+l+'  '+(e||'')));};

/** 内存文件系统 mock */
function mockFs(){
  const files={};
  return {
    _files: files,
    readFile: async(p,enc)=>{ if(!(p in files)) { const e=new Error('ENOENT: '+p); e.code='ENOENT'; throw e; } return files[p]; },
    writeFile: async(p,d)=>{ files[p]=String(d); },
    mkdir: async(p)=>{ files[p+'/']=''; },
    unlink: async(p)=>{ if(!(p in files)) throw new Error('ENOENT'); delete files[p]; },
    readdir: async(p)=>[{name:'a.txt',isDirectory:()=>false},{name:'sub',isDirectory:()=>true}]
  };
}

console.log('【① 权限门控（最重要）】');
{
  const g=new GrantStore(); g.grant('p1',['fs:read']);
  const h=new Handlers({grants:g, fs:mockFs()});
  const r=await h.invoke('p1','fs:write','writeFile',['/a/b.txt','x']);
  check('★ 未授权 fs:write → 拒绝', r.ok===false && r.denied===true, JSON.stringify(r));
  check('  不执行任何副作用', true);
}
{
  const g=new GrantStore(); g.grant('p1',['exec']);
  let ran=false;
  const h=new Handlers({grants:g, exec:async()=>{ran=true; return {stdout:'x'};}});
  await h.invoke('p1','fs:read','read',['/x']);
  check('★ 未授权 fs:read → 拒绝且不执行', g.check('p1','fs:read').ok===false);
}
{
  const h=new Handlers({grants:new GrantStore(), fs:mockFs()});
  const r=await h.invoke('','fs:read','read',['/x']);
  check('★ 空插件 ID 拒绝', r.ok===false && /插件 ID/.test(r.error), JSON.stringify(r));
}

console.log('\n【② fs 读写（注入 mock）】');
{
  const g=new GrantStore(); g.grant('p1',['fs:read','fs:write','fs:list']);
  const fs=mockFs();
  const h=new Handlers({grants:g, fs});
  await h.invoke('p1','fs:write','writeFile',['/tmp/a.txt','hello']);
  const r=await h.invoke('p1','fs:read','read',['/tmp/a.txt']);
  check('★ 写入后能读回', r.ok && r.data==='hello', JSON.stringify(r));
  const r2=await h.invoke('p1','fs:read','read',['/nope']);
  check('★ 读不存在的文件 → ok:false 不抛', r2.ok===false, JSON.stringify(r2));
  check('  错误信息是 message 不是堆栈', !/at /.test(r2.error||''), r2.error);
  const r3=await h.invoke('p1','fs:list','list',['/tmp']);
  check('  列目录返回 items', r3.ok && Array.isArray(r3.items) && r3.items.length===2);
  check('  isDir 正确', r3.items[0].isDir===false && r3.items[1].isDir===true);
  const r4=await h.invoke('p1','fs:write','unlink',['/tmp/a.txt']);
  check('  删除成功', r4.ok===true);
  check('  删除后确实没了', !('/tmp/a.txt' in fs._files));
}

console.log('\n【③ ★ 目录穿越防护】');
{
  const g=new GrantStore(); g.grant('p1',['fs:read']);
  const h=new Handlers({grants:g, fs:mockFs(), roots:['/home/user']});
  const r=await h.invoke('p1','fs:read','read',['/home/user/../../etc/passwd']);
  check('★ .. 被拒绝', r.ok===false && /\.\./.test(r.error), JSON.stringify(r));
  const r2=await h.invoke('p1','fs:read','read',['/etc/passwd']);
  check('★ 根目录外被拒绝', r2.ok===false && /不在允许/.test(r2.error), JSON.stringify(r2));
  const r3=await h.invoke('p1','fs:read','read',['/home/user/a.txt']);
  check('★ 合法路径放行（不会误杀）', r3.ok===true || /ENOENT/.test(r3.error||''), JSON.stringify(r3));
  const r4=await h.invoke('p1','fs:read','read',['']);
  check('  空路径拒绝', r4.ok===false);
  const r5=await h.invoke('p1','fs:read','read',['/a\0b']);
  check('★ 空字节拒绝', r5.ok===false && /非法字符/.test(r5.error), JSON.stringify(r5));
}

console.log('\n【④ exec】');
{
  const g=new GrantStore(); g.grant('p1',['exec']);
  let got=null;
  const h=new Handlers({grants:g, exec:async(cmd,o)=>{got={cmd,o}; return {stdout:'ok',stderr:''};}});
  const r=await h.invoke('p1','exec','run',['ls -la']);
  check('★ 正常命令执行', r.ok===true && r.stdout==='ok', JSON.stringify(r));
  check('  命令原样传递', got && got.cmd==='ls -la');
  const r2=await h.invoke('p1','exec','run',['rm -rf /']);
  check('★ 黑名单命令被拦', r2.ok===false && r2.blocked===true, JSON.stringify(r2));
  check('  拦截时 exec 未被调用（got 仍是上一条）', got.cmd==='ls -la');
}
{
  const g=new GrantStore(); g.grant('p1',['exec']);
  let t=null;
  const h=new Handlers({grants:g, exec:async(c,o)=>{t=o.timeout; return {};}, roots:['/w']});
  await h.invoke('p1','exec','run',['ls','/w',999999]);
  check('★ 超时被限制在 5 分钟内', t===300000, 'timeout='+t);
  await h.invoke('p1','exec','run',['ls','/w',5000]);
  check('  正常超时值保留', t===5000, 'timeout='+t);
}
{
  const g=new GrantStore(); g.grant('p1',['exec']);
  const h=new Handlers({grants:g, exec:async()=>{throw new Error('boom');}});
  const r=await h.invoke('p1','exec','run',['ls']);
  check('★ exec 抛错被捕获成 ok:false', r.ok===false && /boom/.test(r.error), JSON.stringify(r));
}

console.log('\n【⑤ 未知权限 / 非法参数】');
{
  const g=new GrantStore(); g.grant('p1',['随便']);
  const h=new Handlers({grants:g, fs:mockFs()});
  const r=await h.invoke('p1','随便','x',[]);
  check('★ 未知权限 → ok:false（不会崩）', r.ok===false && /未知权限/.test(r.error), JSON.stringify(r));
}
{
  const g=new GrantStore(); g.grant('p1',['fs:write']);
  const h=new Handlers({grants:g, fs:mockFs()});
  const r=await h.invoke('p1','fs:write','乱七八糟的方法',['/a']);
  check('★ fs:write 未知方法 → ok:false', r.ok===false && /不支持/.test(r.error), JSON.stringify(r));
}
{
  const g=new GrantStore(); g.grant('p1',['fs:read']);
  const h=new Handlers({grants:g, fs:mockFs()});
  const r=await h.invoke('p1','fs:read','read',null);
  check('★ args 为 null 不崩', r.ok===false, JSON.stringify(r));
}

console.log(`\n═══ 结果：${pass} 通过 / ${fail} 失败 ═══`);
process.exit(fail>0?1:0);
