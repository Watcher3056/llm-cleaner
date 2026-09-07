const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const api=require('./chat-storage.cjs'),core=require('./clean-subagents.cjs');
async function temp(fn){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chat-storage-test-'));try{return await fn(dir);}finally{if(!path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'chat-storage-test-'))throw Error('Unsafe test cleanup');fs.rmSync(dir,{recursive:true,force:true});}}
test('platform-specific storage discovery',()=>{
 const h=path.resolve('test-home');assert.equal(api.defaults('linux',h,{}).cursorUser,path.join(h,'.config','Cursor','User'));
 assert.equal(api.defaults('darwin',h,{}).cursorUser,path.join(h,'Library','Application Support','Cursor','User'));
 assert.equal(api.defaults('win32',h,{}).cursorUser,path.join(h,'AppData','Roaming','Cursor','User'));
 assert.equal(api.defaults('linux',h,{CODEX_HOME:'/custom'}).codex,'/custom');
});
test('SQLite vacuum preserves every row, blob, schema and rowid',async()=>temp(async dir=>{
 const {DatabaseSync}=require('node:sqlite'),f=path.join(dir,'state.vscdb'),out=path.join(dir,'compact.vscdb'),db=new DatabaseSync(f);
 db.exec('CREATE TABLE ItemTable(key TEXT UNIQUE ON CONFLICT REPLACE,value BLOB); CREATE TABLE cursorDiskKV(key TEXT UNIQUE ON CONFLICT REPLACE,value BLOB); CREATE TABLE composerHeaders(composerId TEXT PRIMARY KEY, workspaceId TEXT, value TEXT)');
 db.prepare('INSERT INTO cursorDiskKV VALUES(?,?)').run('bubbleId:test',Buffer.from([0,255,17]));db.prepare('INSERT INTO composerHeaders VALUES(?,?,?)').run('chat','workspace','{"preserved":true}');const insert=db.prepare('INSERT INTO ItemTable VALUES(?,?)');
 for(let i=0;i<100;i++)insert.run('k'+i,Buffer.alloc(10000,i));db.exec("DELETE FROM ItemTable WHERE key LIKE 'k1%' OR key LIKE 'k2%'");db.close();
 const sourceHash=await core.digest(f);assert(api.inspectDb(f).reclaimableBytes>0);await api.vacuumCopy(f,out);assert.equal(await core.digest(f),sourceHash);assert(fs.statSync(out).size<fs.statSync(f).size);
}));
test('unknown SQLite schema is audit-only',async()=>temp(async dir=>{
 const {DatabaseSync}=require('node:sqlite'),f=path.join(dir,'state.vscdb'),d=new DatabaseSync(f);d.exec('CREATE TABLE future_messages(x)');d.close();assert.equal(api.inspectDb(f).supported,false);
}));
test('interactive cancellation never calls cleanup or compression',async()=>{
 const apps=['codex','claude','cursor'].map(id=>({id,label:id,estimatedSavings:100,files:[]}));let asked=0;
 const results=await api.interactive({apps},async()=>{asked++;return '';},path.resolve('unused'),()=>{});assert.deepEqual(results,[]);assert.equal(asked,1);
});
test('cleanup confirmation is separate from selecting an app',async()=>{
 const apps=['codex','claude','cursor'].map(id=>({id,label:id,estimatedSavings:100,files:[]}));const answers=['1','NO',''];
 const results=await api.interactive({apps},async()=>answers.shift()||'',path.resolve('unused'),()=>{});assert.deepEqual(results,[]);
});
test('actual allocation measurement and native NTFS round-trip',async()=>temp(async dir=>{
 const file=path.join(dir,'repeated.txt');fs.writeFileSync(file,'verified content\n'.repeat(40000));
 const second=path.join(dir,'second.txt');fs.writeFileSync(second,'second');
 const multiple=await api.measure([file,second]);assert.equal(multiple.errors.length,0);assert.equal(multiple.rows.length,2);
 const hash=await core.digest(file),m=await api.measure([file]);assert.equal(m.errors.length,0);assert(m.bytes>0);
 if(process.platform==='win32'&&m.rows[0].fileSystem==='NTFS'){
  // Native compression on a disposable copy; no application data is touched.
  require('node:child_process').execFileSync('compact.exe',['/C','/Q',file],{windowsHide:true});
  const after=await api.measure([file]);assert(after.bytes<m.bytes);assert(after.rows[0].compressed);assert.equal(await core.digest(file),hash);
 }
}));
test('offline Codex apply round-trip on Linux/macOS', {skip:process.platform==='win32'},async()=>temp(async dir=>{
 const id='22222222-2222-2222-2222-222222222222',home=path.join(dir,'home'),backup=path.join(dir,'backups'),folder=path.join(home,'sessions');fs.mkdirSync(folder,{recursive:true});fs.mkdirSync(backup);
 const f=path.join(folder,id+'.jsonl');const records=[{type:'session_meta',payload:{id,source:{subagent:{thread_spawn:{parent_thread_id:'parent'}}}}},{type:'response_item',payload:{type:'message',text:'old'.repeat(10000)}},{type:'compacted',payload:{replacement_history:[{type:'message',text:'last state'}]}},{type:'response_item',payload:{type:'message',text:'latest'}}];
 fs.writeFileSync(f,records.map(x=>JSON.stringify(x)).join('\n')+'\n',{mode:0o600});const bytes=fs.readFileSync(f);const p=await core.analyze(f);assert.equal(p.status,'candidate');
 const saved=await core.applyOne(p,home,backup);assert(saved>0);assert.equal(fs.statSync(f).mode&0o777,0o600);assert.equal((await core.analyze(f)).status,'already-minimal');assert.deepEqual(require('node:zlib').gunzipSync(fs.readFileSync(path.join(backup,'sessions',id+'.jsonl.gz'))),bytes);
}));
test('offline Cursor replacement keeps rows and a verified backup',async t=>{
 try{core.assertStopped('cursor');}catch{t.skip('Cursor is running');return;}
 await temp(async dir=>{const root=path.join(dir,'cursor'),backups=path.join(dir,'backups');fs.mkdirSync(root);fs.mkdirSync(backups);
 const {DatabaseSync}=require('node:sqlite'),f=path.join(root,'state.vscdb'),db=new DatabaseSync(f);db.exec('CREATE TABLE ItemTable(key TEXT UNIQUE ON CONFLICT REPLACE,value BLOB)');const insert=db.prepare('INSERT INTO ItemTable VALUES(?,?)');for(let i=0;i<25;i++)insert.run('k'+i,Buffer.alloc(4000,i));db.exec("DELETE FROM ItemTable WHERE key LIKE 'k1%'");const sig=api.logicalDigest(db);db.close();
 const original=fs.readFileSync(f),r=await api.vacuumApply(f,backups,root);assert(r.saved>0);const after=new DatabaseSync(f,{readOnly:true});assert.equal(api.logicalDigest(after),sig);after.close();const gz=fs.readdirSync(backups).find(x=>x.endsWith('.gz'));assert.deepEqual(require('node:zlib').gunzipSync(fs.readFileSync(path.join(backups,gz))),original);
 });
});
