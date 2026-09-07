#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const core=require('./clean-subagents.cjs'),transcripts=require('./transcripts.cjs'),processes=require('./process-control.cjs');
const G=2**30,fmt=n=>{const a=Math.abs(n);return a>=G?(n/G).toFixed(3)+' GiB':a>=2**20?(n/2**20).toFixed(2)+' MiB':a>=1024?(n/1024).toFixed(2)+' KiB':n+' B';};
function defaults(platform=process.platform,home=os.homedir(),env=process.env){
 const cursorUser=platform==='win32'?path.join(env.APPDATA||path.join(home,'AppData','Roaming'),'Cursor','User'):platform==='darwin'?path.join(home,'Library','Application Support','Cursor','User'):path.join(env.XDG_CONFIG_HOME||path.join(home,'.config'),'Cursor','User');
 return {codex:env.CODEX_HOME||path.join(home,'.codex'),claude:env.CLAUDE_CONFIG_DIR||path.join(home,'.claude'),cursor:path.join(home,'.cursor'),cursorUser,gemini:path.join(env.GEMINI_CLI_HOME||home,'.gemini'),antigravity:path.join(home,'.gemini','antigravity'),antigravityUser:path.join(path.dirname(path.dirname(cursorUser)),'Antigravity','User')};
}
async function filesIn(root,skip=new Set()){
 const files=[];if(!fs.existsSync(root))return files;
 async function walk(dir){for(const e of await fsp.readdir(dir,{withFileTypes:true})){
  if(e.isSymbolicLink())continue;const p=path.join(dir,e.name);
  if(e.isDirectory()){if(!skip.has(e.name))await walk(p);}else if(e.isFile())files.push(p);
 }}await walk(root);return files;
}
async function measure(files){
 const unique=[...new Set(files)];if(!unique.length)return {bytes:0,rows:[],errors:[]};
 if(process.platform!=='win32'){
  const rows=[];for(const file of unique){try{const s=await fsp.lstat(file);if(!s.isFile()||s.isSymbolicLink())throw Error('Not a regular file');rows.push({file,bytes:s.blocks*512,fileSystem:null});}catch(e){rows.push({file,error:e.message});}}
  return {bytes:rows.filter(x=>!x.error).reduce((s,x)=>s+x.bytes,0),rows,errors:rows.filter(x=>x.error)};
 }
 const dir=await fsp.mkdtemp(path.join(os.tmpdir(),'chat-storage-measure-')),manifest=path.join(dir,'files.json');
 try{await fsp.writeFile(manifest,JSON.stringify(unique));
  const out=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'storage-windows.ps1'),'-Manifest',manifest],{encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024});
  const rows=JSON.parse(out.replace(/^\uFEFF/,''));return {bytes:rows.filter(x=>!x.error).reduce((s,x)=>s+x.bytes,0),rows,errors:rows.filter(x=>x.error)};
 }finally{await fsp.unlink(manifest).catch(()=>{});await fsp.rmdir(dir);}
}
function sqlite(){return require('node:sqlite');}
function inspectDb(file){
 let db;try{db=new (sqlite().DatabaseSync)(file,{readOnly:true});
  const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(x=>x.name);
  const supported=tables.length>0&&tables.every(n=>['ItemTable','cursorDiskKV','composerHeaders'].includes(n));
  const free=db.prepare('PRAGMA freelist_count').get().freelist_count,pageSize=db.prepare('PRAGMA page_size').get().page_size;
  return {file,tables,supported,freePages:free,pageSize,reclaimableBytes:supported?free*pageSize:0};
 }catch(e){return {file,error:e.message,reclaimableBytes:0};}finally{db?.close();}
}
function logicalDigest(db){
 const h=crypto.createHash('sha256');
 const add=v=>{const b=Buffer.isBuffer(v)||v instanceof Uint8Array?Buffer.from(v):Buffer.from(typeof v==='bigint'?v.toString():JSON.stringify(v));h.update(typeof v+':'+b.length+':');h.update(b);};
 const schema=db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();add(schema);
 for(const pragma of ['user_version','application_id','encoding'])add(db.prepare('PRAGMA '+pragma).get());
 for(const {name} of schema.filter(x=>x.type==='table')){
  const q='"'+name.replace(/"/g,'""')+'"';const stmt=db.prepare('SELECT rowid AS __storage_rowid__, * FROM '+q+' ORDER BY rowid');stmt.setReadBigInts(true);
  for(const row of stmt.iterate())for(const [k,v] of Object.entries(row)){add(k);add(v);}
 }
 return h.digest('hex');
}
async function scan(roots,cacheFile,log=console.log){
 const result={createdAt:new Date().toISOString(),platform:process.platform,roots,apps:[]};
 let cache={};try{const c=JSON.parse(await fsp.readFile(cacheFile,'utf8'));for(const p of c.plans||[])cache[p.file]=p;}catch{}
 const codexFiles=[...await filesIn(path.join(roots.codex,'sessions')),...await filesIn(path.join(roots.codex,'archived_sessions'))].filter(x=>x.endsWith('.jsonl'));
 const c={id:'codex',label:'Codex',mode:'prune-subagents',files:codexFiles,logicalBytes:0,estimatedSavings:0,plans:[],skipped:{},cached:0};
 const scanned=await require('./task-pool.cjs').pool(codexFiles,2,async file=>{const st=await fsp.stat(file);let p=cache[file];
  if(p&&p.before?.size===st.size&&p.before?.mtimeMs===st.mtimeMs&&p.before?.ino===st.ino)c.cached++;
  else {try{p=await core.analyze(file);}catch(e){p={file,status:'read-error',error:e.message};}}
  return {p,size:st.size};
 },(done,total)=>{if(done%250===0||done===total)log(`Scanning Codex: ${done}/${total} files`);});
 for(const row of scanned.results.filter(Boolean)){c.logicalBytes+=row.size;const p=row.p;if(p.status==='candidate'){c.plans.push(p);c.estimatedSavings+=p.saving;}else c.skipped[p.status]=(c.skipped[p.status]||0)+1;}
 if(scanned.errors.length)throw scanned.errors[0];
 result.apps.push(c);
 for(const id of ['claude','gemini']){
 const files=(await filesIn(path.join(roots[id],id==='claude'?'projects':'tmp'))).filter(x=>(id==='claude'?x.endsWith('.jsonl'):/\.jsonl?$/.test(x))&&(id==='claude'||x.includes(path.sep+'chats'+path.sep)));
 const a={id,label:id==='claude'?'Claude Code':'Gemini CLI',mode:id==='claude'?'prune-before-compaction':'journal-deduplication',files,logicalBytes:0,estimatedSavings:0,plans:[],skipped:{}};
 for(const file of files){a.logicalBytes+=(await fsp.stat(file)).size;let p;try{p=id==='gemini'&&file.endsWith('.json')?{status:'legacy-json-preserved'}:await (id==='claude'?transcripts.claudePlan:transcripts.geminiPlan)(file);}catch(e){p={status:'unsupported-or-invalid',error:e.message};}
  if(p.status==='candidate'){a.plans.push(p);a.estimatedSavings+=p.saving;}else a.skipped[p.status]=(a.skipped[p.status]||0)+1;
 }
 a.reason=id==='claude'?'Preserve last compact boundary, summary, tail, referenced messages and metadata. Files without checkpoints stay intact.':'Remove superseded intermediate message versions; preserve replayed messages, metadata and rewind state.';
 result.apps.push(a);
 }
 const userFiles=[...await filesIn(path.join(roots.cursorUser,'globalStorage')),...await filesIn(path.join(roots.cursorUser,'workspaceStorage'))];
 const cursorFiles=(await filesIn(path.join(roots.cursor,'projects'),new Set(['node_modules']))).filter(x=>x.includes(path.sep+'agent-transcripts'+path.sep)&&/\.(jsonl|txt)$/.test(x));
 const dbFiles=userFiles.filter(x=>path.basename(x)==='state.vscdb');
 const u={id:'cursor',label:'Cursor',mode:'sqlite-vacuum',files:[...cursorFiles,...userFiles.filter(x=>/state\.vscdb(?:\.backup|-wal)?$/.test(x))],logicalBytes:0,estimatedSavings:0,databases:dbFiles.map(inspectDb)};
 for(const file of u.files)u.logicalBytes+=(await fsp.stat(file)).size;
 u.estimatedSavings=u.databases.reduce((s,x)=>s+x.reclaimableBytes,0);u.reason='Overview estimate: unused SQLite pages. History pruning and old-chat deletion are separate optional actions.';result.apps.push(u);
 const antiUserFiles=[...await filesIn(path.join(roots.antigravityUser,'globalStorage')),...await filesIn(path.join(roots.antigravityUser,'workspaceStorage'))];
 const antiFiles=[...await filesIn(path.join(roots.antigravity,'conversations')),...await filesIn(path.join(roots.antigravity,'context_state')),...antiUserFiles.filter(x=>/state\.vscdb(?:\.backup|-wal)?$/.test(x))];
 const anti={id:'antigravity',label:'Antigravity',mode:'sqlite-vacuum',files:antiFiles,logicalBytes:0,estimatedSavings:0,databases:antiUserFiles.filter(x=>path.basename(x)==='state.vscdb').map(inspectDb)};
 for(const file of antiFiles)anti.logicalBytes+=(await fsp.stat(file)).size;
 anti.estimatedSavings=anti.databases.reduce((n,d)=>n+d.reclaimableBytes,0);anti.reason='Overview estimate: unused SQLite pages. Verified .pb history pruning and old-chat deletion are separate optional actions.';result.apps.push(anti);
 // Stable menu order across platforms.
 result.apps.sort((a,b)=>processes.apps.indexOf(a.id)-processes.apps.indexOf(b.id));
 for(const app of result.apps){const m=await measure(app.files);app.diskBytes=m.errors.length?null:m.bytes;app.measureErrors=m.errors;}
 return result;
}
async function safeBackup(file,dir,label,options={}){
 const before=await fsp.stat(file),sha256=await core.digest(file);let dest=path.join(dir,label+'.gz');
 dest=await (options.backupFn||core.backup)({file,sha256},dest)||dest;if((await core.digest(file))!==sha256)throw Error('File changed during backup');
 await fsp.appendFile(path.join(dir,'journal.jsonl'),JSON.stringify({state:'backup',file,backup:dest,sha256,bytes:before.size})+'\n');return dest;
}
async function vacuumCopy(source,dest){
 const {DatabaseSync}=sqlite();let db=new DatabaseSync(source,{readOnly:true});
 try{
  const signature=logicalDigest(db);db.prepare('VACUUM INTO ?').run(dest);
  const copy=new DatabaseSync(dest,{readOnly:true});try{
   const check=copy.prepare('PRAGMA integrity_check').all();if(check.length!==1||Object.values(check[0])[0]!=='ok')throw Error('SQLite integrity check failed');
   if(logicalDigest(copy)!==signature||logicalDigest(db)!==signature)throw Error('SQLite contents, schema or rowids changed; source not replaced');
  }finally{copy.close();}
  return signature;
 }finally{db.close();}
}
async function vacuumApply(file,dir,allowedRoot,app='cursor',options={}){
 const guard=options.guard||(()=>core.assertStopped(app));
 const actual=await fsp.realpath(file),root=await fsp.realpath(allowedRoot);
 if(!core.inside(root,actual)||path.basename(actual)!=='state.vscdb'||(await fsp.lstat(file)).isSymbolicLink())throw Error('Database outside selected application storage');
  file=actual;
 if(options.vault){for(const suffix of ['-wal','-shm'])await options.vault.capture(file+suffix);}
 const space=await fsp.statfs(path.dirname(file));if(space.bavail*space.bsize<(await fsp.stat(file)).size+1024*1024)throw Error('Not enough free space for a temporary database; clean Codex first or free space on this volume');
 await guard();if(!inspectDb(file).supported)throw Error('Unvalidated SQLite schema');
 const before=(await fsp.stat(file)).size;await safeBackup(file,dir,path.basename(path.dirname(file))+'-'+crypto.randomUUID(),options);
 if(fs.existsSync(file+'-wal')&&(await fsp.stat(file+'-wal')).size)await safeBackup(file+'-wal',dir,'wal-'+crypto.randomUUID(),options);
 await guard();
 const {DatabaseSync}=sqlite(),db=new DatabaseSync(file);
 try{const c=db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();if(c.busy)throw Error('SQLite busy');}finally{db.close();await guard();if(options.vault){for(const suffix of ['', '-wal','-shm'])await options.vault.commit(file+suffix,await require('./backup-vault.cjs').fingerprint(file+suffix));}}
 if(fs.existsSync(file+'-wal')&&(await fsp.stat(file+'-wal')).size)throw Error('Nonempty WAL remains; refusing replacement');
 const stable=await core.digest(file),tmp=file+'.vacuum-'+crypto.randomUUID();
 try{await vacuumCopy(file,tmp);await guard();if(await core.digest(file)!==stable)throw Error('Database changed');
  if(fs.existsSync(file+'-wal')&&(await fsp.stat(file+'-wal')).size)throw Error('New WAL appeared');
  const after=(await fsp.stat(tmp)).size;if(after>=before){await options.committed?.(file,await core.digest(file));return {saved:0};}
  await fsp.chmod(tmp,(await fsp.stat(file)).mode&0o777);await fsp.rename(tmp,file);await options.committed?.(file,await core.digest(file));
  await fsp.appendFile(path.join(dir,'journal.jsonl'),JSON.stringify({state:'vacuum-replaced',file,before,after})+'\n');return {saved:before-after};
 }finally{if(fs.existsSync(tmp))await fsp.unlink(tmp);if(options.vault){for(const suffix of ['-wal','-shm'])await options.vault.commit(file+suffix,await require('./backup-vault.cjs').fingerprint(file+suffix));}}
}
async function compressFiles(files,app,onProgress=()=>{}){
 if(process.platform!=='win32')return {supported:false,reason:'NTFS compression is offered only on Windows'};
 core.assertStopped(app);const before=await measure(files);if(before.errors.length)throw Error('Cannot measure all compression targets');
 const selected=before.rows.filter(x=>x.fileSystem==='NTFS'&&!x.compressed);let done=0;const errors=[];
 for(const row of selected){try{core.assertStopped(app);
  // A concrete literal file per call; no shell, wildcards, recursive directory changes or /EXE mode.
  const s=await fsp.lstat(row.file);if(!s.isFile()||s.isSymbolicLink())throw Error('Compression target changed');
  const hash=await core.digest(row.file);
  execFileSync('compact.exe',['/C','/A','/Q',row.file],{windowsHide:true,stdio:'pipe'});
  if(await core.digest(row.file)!==hash)throw Error('File contents changed during compression; inspect '+row.file);
  if(++done%25===0)onProgress(`NTFS ${app}: ${done}/${selected.length}`);
 }catch(e){errors.push({file:row.file,error:e.message});break;}
 }
 const after=await measure(files);errors.push(...after.errors);
 return {supported:true,filesCompressed:done,nonNtfs:before.rows.filter(x=>x.fileSystem!=='NTFS').length,beforeBytes:before.bytes,afterBytes:after.errors.length?null:after.bytes,savedBytes:after.errors.length?null:before.bytes-after.bytes,percent:after.errors.length?null:before.bytes?100*(before.bytes-after.bytes)/before.bytes:0,errors};
}
function show(report){return require('./wizard.cjs').overview(report,console.log);}
async function interactive(report,ask,backupDir,log=console.log){return require('./wizard.cjs').run(report,ask,backupDir,log,module.exports);}
async function main(){
 const args=process.argv.slice(2),val=k=>{const i=args.indexOf(k);return i<0?undefined:args[i+1];};
 if(args.includes('--help')){console.log('node chat-storage.cjs [--scan-only] [--report PATH] [--backup-dir PATH]\n[--codex-home PATH] [--claude-home PATH] [--cursor-home PATH] [--cursor-user PATH]\n[--gemini-home PATH] [--antigravity-home PATH] [--antigravity-user PATH]\nInteractive by default: analyze -> select -> separate confirmations -> cleanup -> optional NTFS -> actual savings.\nRunning applications are detected and closure offered before mutations. Claude checkpoint pruning; Gemini journal deduplication; Cursor/Antigravity checkpoint history pruning, old-chat deletion and verified SQLite VACUUM.');return;}
 const roots=defaults();for(const [key,arg] of Object.entries({codex:'--codex-home',claude:'--claude-home',cursor:'--cursor-home',cursorUser:'--cursor-user',gemini:'--gemini-home',antigravity:'--antigravity-home',antigravityUser:'--antigravity-user'}))if(val(arg))roots[key]=path.resolve(val(arg));
 const reportFile=path.resolve(val('--report')||path.join(__dirname,'storage-report.json'));
 let backupDir=path.resolve(val('--backup-dir')||path.join(os.homedir(),'Documents','Chat-storage-backups'));
 for(const root of Object.values(roots))if(core.inside(path.resolve(root),backupDir)||path.resolve(root)===backupDir)throw Error('Backup directory must be outside application storage');
 console.log('Running applications:',processes.list().map(p=>p.app+' PID '+p.pid+(p.protected?' (cleaner ancestor)':'')).join(', ')||'none');
 const report=await scan(roots,path.join(__dirname,'preview.json'));await fsp.writeFile(reportFile,JSON.stringify(report,null,2));show(report);
 if(args.includes('--scan-only'))return;
 if(!process.stdin.isTTY)throw Error('Interactive terminal required; use --scan-only for unattended analysis.');
 const ui=require('./terminal-ui.cjs').createUI(),ask=ui.ask;
 try{
  if(!val('--backup-dir')){
   while(true){const selected=(await ask('Backup folder [Enter = '+backupDir+']; another drive is recommended: ')).trim();
    const candidate=selected?path.resolve(selected.replace(/^["']|["']$/g,'')):backupDir;
    if(Object.values(roots).some(root=>core.inside(path.resolve(root),candidate)||path.resolve(root)===candidate)){console.log('Choose a folder outside application storage.');continue;}
    backupDir=candidate;break;
   }
  }
  console.log('Backups: '+backupDir);
  report.results=await interactive(report,ask,backupDir,ui.log);
 }finally{processes.stopWatcher();await fsp.writeFile(reportFile,JSON.stringify(report,null,2));}
 console.log('Stage results saved to '+reportFile);
}
module.exports={defaults,measure,inspectDb,logicalDigest,vacuumCopy,vacuumApply,compressFiles,scan,interactive,filesIn,fmt};
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
