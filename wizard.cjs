'use strict';
const fs=require('node:fs'),f=fs.promises,path=require('node:path'),crypto=require('node:crypto');
const core=require('./clean-subagents.cjs'),transcripts=require('./transcripts.cjs'),processes=require('./process-control.cjs'),{Vault}=require('./backup-vault.cjs'),{pool}=require('./task-pool.cjs'),old=require('./old-chats.cjs');
const names={codex:'Codex',claude:'Claude Code',gemini:'Gemini CLI',cursor:'Cursor',antigravity:'Antigravity'};
const format=n=>require('./chat-storage.cjs').fmt(n);
function overview(report,log){log('\nCHAT STORAGE CLEANER\n');log('    Application          Chat files       Reclaimable');log('    ------------------------------------------------');
 for(const [i,a] of report.apps.entries())log(` ${i+1}. ${a.label.padEnd(20)} ${format(a.logicalBytes).padStart(12)}   ${format(a.estimatedSavings).padStart(12)}`);
 log('\nReclaimable is an estimate before backups. History pruning and age-based deletion are separate optional actions.');
}
async function choice(ask,prompt,allowed,defaultValue='0'){if(ask.select)return ask.select(prompt,allowed,defaultValue);while(true){const answer=(await ask(prompt)).trim()||defaultValue;if(allowed.includes(answer))return answer;}}
async function yes(ask,prompt){if(ask.select)return (await ask.select(prompt,['n','y'],'n',{n:'No — cancel',y:'Yes — continue'}))==='y';return ['yes','y'].includes((await ask(prompt+' [y/N]: ')).trim().toLowerCase());}
async function processAsk(ask,q){const token=q.match(/Type ((?:FORCE CLOSE|CLOSE) [A-Z]+)/)?.[1];if(!token)return ask(q);const message=token.startsWith('FORCE')?'Force-close remaining processes? Unsaved work may be lost.':'Close the application automatically? Save your work first.';return await yes(ask,message)?token:'';}
async function manageBackups(vaults,ask,log){const active=[...vaults.values()].filter(v=>v.entries.size);if(!active.length)return;
 log('\nBACKUPS FROM THIS RUN\n  1. Keep backups (recommended)\n  2. Restore chats to their pre-cleanup state\n  3. Delete these backups permanently');
 const action=await choice(ask,'Choose [Enter = keep]: ',['1','2','3'],'1');if(action==='1'){log('Backups kept.');return;}
 if(action==='3'){if(!await yes(ask,'Permanently delete this run\'s backups? Undo will no longer be available.'))return;
  let freed=0;for(const vault of active)freed+=await vault.removeBackups();log('Backup files removed: '+format(freed)+'. Older backup folders were not touched.');return;
 }
 if(!await yes(ask,'Restore this run? Files changed since cleanup will be protected.'))return;
 for(const vault of [...active].reverse()){
  if(!await processes.ensureStopped(vault.app,q=>processAsk(ask,q),log)){log('Restore skipped for '+names[vault.app]+'. Backups kept.');continue;}
  try{const n=await vault.restore(processes.makeGuard(vault.app));log(names[vault.app]+': restored '+n+' files. Backups kept.');}catch(e){log('Restore stopped: '+e.message+'. Backups kept.');}
 }
}
async function run(report,ask,backupDir,log,api){
 const results=[];report.results=results;const vaults=new Map(),runId=new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomUUID().slice(0,8);
 const getVault=async app=>{if(!vaults.has(app.id)){const roots=app.mode==='sqlite-vacuum'?[report.roots[app.id+'User'],report.roots[app.id]]:[report.roots[app.id]];const dir=path.join(backupDir,runId+'-'+app.id);await f.mkdir(dir,{recursive:true});vaults.set(app.id,new Vault(dir,roots.filter(p=>fs.existsSync(p)),app.id));}return vaults.get(app.id);};
 try{while(true){
  log('\nChoose an application, or finish to review backups.');
  for(const [i,a] of report.apps.entries())log(`  ${i+1}. ${a.label}`);log('  0. Finish');
  const selected=await choice(ask,'Application [0]: ',['0',...report.apps.map((_,i)=>String(i+1))]);if(selected==='0')break;
  const app=report.apps[+selected-1];
  while(true){const isDb=app.mode==='sqlite-vacuum';log('\n'+app.label.toUpperCase());
   log(isDb?'  1. Reclaim unused database space':app.id==='gemini'?'  1. Remove superseded journal entries':'  1. Compact subagent history');
   if(['codex','claude','cursor','antigravity'].includes(app.id))log('  2. Compact MAIN chat history (optional)');
   log('  3. Delete old chats');if(isDb)log('  5. Compact subagent history (optional)');
   if(process.platform==='win32')log('  4. Enable NTFS compression');log('  0. Back');
   const allowed=['0','1',...(['codex','claude','cursor','antigravity'].includes(app.id)?['2']:[]),'3',...(isDb?['5']:[]),...(process.platform==='win32'?['4']:[])];
   const action=await choice(ask,'Action [0]: ',allowed);if(action==='0')break;
   if(action==='4'){
    if(!await yes(ask,'Compress existing '+app.label+' chat files without changing contents?'))continue;
    if(!await processes.ensureStopped(app.id,q=>processAsk(ask,q),log))continue;
    try{const r=await api.compressFiles(app.files.filter(x=>fs.existsSync(x)),app.id,log);results.push({app:app.id,stage:'ntfs',...r});log('Additional NTFS saving: '+(r.savedBytes===null?'unknown':format(r.savedBytes)));}catch(e){log(e.message);}continue;
   }
   let jobs=[],label='',months;
   if(action==='3'){
    log('\nDelete chats with NO ACTIVITY for:\n  1. More than 3 months\n  2. More than 6 months\n  3. More than 1 year\n  0. Cancel');
    const age=await choice(ask,'Age [0]: ',['0','1','2','3']);if(age==='0')continue;months=({'1':3,'2':6,'3':12})[age];
    log('Checking activity and dependencies...');jobs=app.id==='cursor'?app.databases.flatMap(d=>require('./cursor-history.cjs').scan(d.file,{action:'delete',months,transcriptFiles:app.files})):app.id==='antigravity'?await require('./antigravity-history.cjs').scan(report.roots.antigravity,{action:'delete',months}):await old.candidates(app.id,app.files.filter(x=>fs.existsSync(x)),months);label='Delete old chats';
    log('Parents with dependent chats and unsupported sidecar layouts are protected.');
   }else if(isDb&&(action==='2'||action==='5')){label=action==='2'?'Compact main chats':'Compact subagents';const selection=action==='2'?'main':'subagent';log('Checking stored summaries...');jobs=app.id==='cursor'?app.databases.flatMap(d=>require('./cursor-history.cjs').scan(d.file,{selection})):await require('./antigravity-history.cjs').scan(report.roots.antigravity,{selection});
   }else if(isDb){jobs=app.databases.filter(x=>fs.existsSync(x.file)).map(x=>api.inspectDb(x.file)).filter(x=>x.supported&&x.reclaimableBytes>0);label='Reclaim unused database space';}
   else if(app.id==='codex'){
    label=action==='2'?'Compact main chats':'Compact subagents';log('Checking latest checkpoints...');
    const files=action==='2'?app.files:(app.plans||[]).map(p=>p.file);
    const scan=await pool(files.filter(x=>fs.existsSync(x)),2,async file=>core.analyze(file,{includeMain:action==='2'}));
    jobs=scan.results.filter(p=>p&&p.status==='candidate'&&(action==='2'?!p.parent:!!p.parent));if(scan.errors.length)log('Some files could not be scanned; they will be skipped.');
   }else{label=app.id==='gemini'?'Remove superseded entries':action==='2'?'Compact main chats':'Compact subagents';
    for(const cached of app.plans||[]){if(!fs.existsSync(cached.file))continue;const p=await (app.id==='claude'?transcripts.claudePlan:transcripts.geminiPlan)(cached.file);if(p.status==='candidate'&&(app.id!=='claude'||(action==='2'?p.kind==='main':p.kind==='subagent')))jobs.push(p);}
   }
   if(jobs.skipped?.length)log('Skipped '+jobs.skipped.length+' unreadable or unsupported trajectories; dependency safety prevents changes.');
   if(!jobs.length){log('No eligible chats/files. Nothing changed.');continue;}
   const expected=jobs.reduce((n,p)=>n+(action==='3'?p.bytes:isDb&&action==='1'?p.reclaimableBytes:p.saving),0);
   log(`\n${label}: ${jobs.length} ${isDb&&action!=='1'?'chats':'files'}, estimated ${format(expected)}.`);
   if(action==='3'){for(const p of jobs.slice(0,8))log('  '+new Date(p.lastActivity).toISOString().slice(0,10)+'  '+p.title.replace(/[\r\n\x1b]/g,' ').slice(0,60));if(jobs.length>8)log('  ... '+(jobs.length-8)+' more.');report.deletionCandidates=jobs;}
   else if(!isDb||action!=='1')log(app.id==='antigravity'?'Keep all required incremental summaries, message indices and the unsummarized tail.':'Keep the latest summary, its tail and required message references.');
   if(!await yes(ask,action==='3'?'Delete these chats? Verified backups will be created first.':'Apply this cleanup with verified backups?'))continue;
   if(!await processes.ensureStopped(app.id,q=>processAsk(ask,q),log))continue;
   const vault=await getVault(app),guard=processes.makeGuard(app.id),options={...vault.options(guard),vault};
   const logicalBefore=app.files.filter(x=>fs.existsSync(x)).reduce((n,file)=>n+fs.statSync(file).size,0);const before=await api.measure(app.files.filter(x=>fs.existsSync(x))),started=Date.now();log('Creating verified backups and applying changes...');let saved=0,errors=[];
   try{
    if(isDb&&action!=='1'){saved=app.id==='cursor'?await require('./cursor-history.cjs').apply(jobs,action==='3'?'delete':'compact',report.roots.cursorUser,vault,guard,report.roots.cursor):action==='3'?await require('./antigravity-history.cjs').deleteChats(jobs,report.roots.antigravity,report.roots.antigravityUser,app.databases.map(d=>d.file),vault,guard):await require('./antigravity-history.cjs').compact(jobs,report.roots.antigravity,vault,guard);}
    else if(action==='3')saved=app.id==='codex'?await old.deleteCodex(jobs,report.roots.codex,vault,guard):await old.deleteFiles(jobs,app.id,report.roots[app.id],vault,guard);
    else {let lastLog=0;const output=await pool(jobs,isDb?1:2,async p=>{
     const bytes=app.id==='codex'?await core.applyOne(p,await f.realpath(report.roots.codex),vault.dir,options):isDb?(await api.vacuumApply(p.file,vault.dir,report.roots[app.id+'User'],app.id,options)).saved:await transcripts.apply(p,report.roots[app.id],vault.dir,options);saved+=bytes;return bytes;
    },(done,total)=>{if(done===total||Date.now()-lastLog>1000){log(`  ${done}/${total} files complete | ${format(saved)} reclaimed`);lastLog=Date.now();}});errors=output.errors.map(e=>e.message);}
   }catch(e){errors.push(e.message);}
   const after=await api.measure(app.files.filter(x=>fs.existsSync(x))),backups=await api.measure(await api.filesIn(vault.dir));
   saved=logicalBefore-app.files.filter(x=>fs.existsSync(x)).reduce((n,file)=>n+fs.statSync(file).size,0);const r={app:app.id,stage:action==='3'?'delete-old':'cleanup',action:label,months,logicalSaved:saved,logicalPercent:app.logicalBytes?100*saved/app.logicalBytes:0,storedSaved:before.errors.length||after.errors.length?null:before.bytes-after.bytes,backupStoredBytes:backups.bytes,backupDir:vault.dir,seconds:(Date.now()-started)/1000,errors};results.push(r);
   log(`Done: ${format(saved)} reclaimed (${r.logicalPercent.toFixed(2)}% of scanned ${app.label} storage).`);log(`Backups for this application: ${format(backups.bytes)} | ${r.seconds.toFixed(1)} seconds.`);if(errors.length)log('Stopped safely: '+errors.join('; '));
  }
 }
 await manageBackups(vaults,ask,log);
 if(results.length){let now=0,initial=0,backupBytes=0;for(const app of report.apps){initial+=app.logicalBytes||0;for(const file of app.files||[])if(fs.existsSync(file))now+=(await f.stat(file)).size;}for(const v of vaults.values())for(const file of await api.filesIn(v.dir))backupBytes+=(await f.stat(file)).size;
  report.finalSummary={sourceLogicalSaved:initial-now,remainingBackupLogicalBytes:backupBytes,netLogicalSaved:initial-now-backupBytes};log('\nFINAL TOTAL');log('Source files reclaimed: '+format(initial-now));log('Remaining backup files: '+format(backupBytes));log('Net saving including backups: '+format(initial-now-backupBytes));
 }
 return results;
 }finally{processes.stopWatcher();}
}
module.exports={run,overview,yes,choice,manageBackups};
