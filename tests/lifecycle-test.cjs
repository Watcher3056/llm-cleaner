const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const core=require('../src/clean-subagents.cjs'),{Vault,fingerprint}=require('../src/backup-vault.cjs'),{pool}=require('../src/task-pool.cjs'),old=require('../src/old-chats.cjs'),api=require('../src/chat-storage.cjs'),wizard=require('../src/wizard.cjs');
async function temp(work){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cleaner-lifecycle-'));try{await work(dir);}finally{assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'cleaner-lifecycle-'));fs.rmSync(dir,{recursive:true,force:true});}}
const noProcess=async()=>{};
function session(dir,main=true){const id=crypto.randomUUID(),file=path.join(dir,id+'.jsonl');fs.writeFileSync(file,[{timestamp:'2024-01-01T00:00:00Z',type:'session_meta',payload:{id,source:main?'cli':{subagent:{thread_spawn:{parent_thread_id:'parent'}}}}},{type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'old'.repeat(20000)}]}},{type:'compacted',payload:{replacement_history:[{type:'message',role:'user',content:[{type:'input_text',text:'Latest knowledge'}]}]}},{timestamp:'2024-02-01T00:00:00Z',type:'event_msg',payload:{type:'task_complete'}}].map(JSON.stringify).join('\n')+'\n');return file;}
test('main chats require explicit opt-in and restore exact original bytes',async()=>temp(async dir=>{
 const home=path.join(dir,'home'),folder=path.join(home,'sessions');fs.mkdirSync(folder,{recursive:true});const file=session(folder),bytes=fs.readFileSync(file),vault=new Vault(path.join(dir,'backup'),[home],'codex');
 assert.equal((await core.analyze(file)).status,'main-or-unproven');const p=await core.analyze(file,{includeMain:true});assert.equal(p.status,'candidate');
 await core.applyOne(p,home,vault.dir,vault.options(noProcess));assert(fs.statSync(file).size<bytes.length);assert.equal(await vault.restore(noProcess),1);assert.deepEqual(fs.readFileSync(file),bytes);
}));
test('restore blocks edited files and corrupt archives before overwriting',async()=>temp(async dir=>{
 const home=path.join(dir,'home');fs.mkdirSync(home);const file=path.join(home,'f.jsonl');fs.writeFileSync(file,'original');const vault=new Vault(path.join(dir,'backup'),[home],'gemini');await vault.capture(file);fs.writeFileSync(file,'cleaned');await vault.commit(file,await fingerprint(file));fs.appendFileSync(file,' new chat');await assert.rejects(vault.restore(noProcess),/changed since/);assert.equal(fs.readFileSync(file,'utf8'),'cleaned new chat');
 fs.writeFileSync(file,'cleaned');fs.writeFileSync(vault.entries.get(file).backup,'damaged');await assert.rejects(vault.restore(noProcess));assert.equal(fs.readFileSync(file,'utf8'),'cleaned');
}));
test('old transcript deletion can be undone and backup deletion is scoped',async()=>temp(async dir=>{
 const home=path.join(dir,'home');fs.mkdirSync(home);const file=path.join(home,'session.jsonl');fs.writeFileSync(file,JSON.stringify({sessionId:'session',projectHash:'p',timestamp:'2020-01-01T00:00:00Z'})+'\n');fs.utimesSync(file,new Date('2020-01-01'),new Date('2020-01-01'));const original=fs.readFileSync(file),vault=new Vault(path.join(dir,'backup'),[home],'gemini');
 const items=await old.candidates('gemini',[file],12,new Date('2026-09-07'));assert.equal(items.length,1);await old.deleteFiles(items,'gemini',home,vault,noProcess);assert(!fs.existsSync(file));await vault.restore(noProcess);assert.deepEqual(fs.readFileSync(file),original);
 const unrelated=path.join(vault.dir,'unrelated.txt');fs.writeFileSync(unrelated,'keep');await vault.removeBackups();assert(fs.existsSync(unrelated));assert(fs.existsSync(file));
}));
test('age is latest activity, clamps calendar months, protects dependent Codex chats',async()=>temp(async dir=>{
 assert.equal(new Date(old.cutoff(3,new Date('2026-05-31T12:00:00Z'))).toISOString(),'2026-02-28T12:00:00.000Z');
 const parent=session(dir),id=path.basename(parent,'.jsonl'),child=path.join(dir,crypto.randomUUID()+'.jsonl');fs.writeFileSync(child,JSON.stringify({type:'session_meta',payload:{id:path.basename(child,'.jsonl'),source:{subagent:{thread_spawn:{parent_thread_id:id}}}}})+'\n');
 fs.utimesSync(parent,new Date('2024-01-01'),new Date('2024-01-01'));const items=await old.candidates('codex',[parent,child],3,new Date('2026-09-07'));assert.equal(items.length,0);
 fs.appendFileSync(parent,JSON.stringify({timestamp:'2026-09-01T00:00:00Z',type:'event_msg',payload:{type:'task_complete'}})+'\n');fs.utimesSync(parent,new Date('2024-01-01'),new Date('2024-01-01'));assert.equal((await old.candidates('codex',[parent],3,new Date('2026-09-07'))).length,0);
}));
test('pool bounds concurrency, stops new work on error and awaits in-flight jobs',async()=>{
 let running=0,max=0,finished=0;const r=await pool([0,1,2,3,4],2,async i=>{running++;max=Math.max(max,running);await new Promise(r=>setTimeout(r,i?30:5));running--;if(i===0)throw Error('stop');finished++;});assert.equal(max,2);assert.equal(running,0);assert.equal(finished,1);assert.equal(r.errors.length,1);
});
test('database vacuum and restore include WAL state and preserve all rows',async()=>temp(async dir=>{
 const home=path.join(dir,'home');fs.mkdirSync(home);const file=path.join(home,'state.vscdb'),{DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(file);db.exec('CREATE TABLE ItemTable(key TEXT UNIQUE,value BLOB)');for(let i=0;i<60;i++)db.prepare('INSERT INTO ItemTable VALUES(?,?)').run('k'+i,Buffer.alloc(6000,i));db.exec("DELETE FROM ItemTable WHERE key LIKE 'k1%' OR key LIKE 'k2%'");const sig=api.logicalDigest(db);db.close();const original=fs.readFileSync(file),vault=new Vault(path.join(dir,'backup'),[home],'cursor');
 await api.vacuumApply(file,vault.dir,home,'cursor',{...vault.options(noProcess),vault});assert(fs.statSync(file).size<original.length);await vault.restore(noProcess);assert.deepEqual(fs.readFileSync(file),original);const check=new DatabaseSync(file,{readOnly:true});assert.equal(api.logicalDigest(check),sig);check.close();
}));
test('menus default to cancel / keep and never treat Enter as approval',async()=>{
 assert.equal(await wizard.yes(async()=>'', 'Delete backups?'),false);assert.equal(await wizard.yes(async()=>'yes','Delete backups?'),true);
 const answers=['wrong','0'];assert.equal(await wizard.choice(async()=>answers.shift(),'Pick',['0','1']), '0');
});
