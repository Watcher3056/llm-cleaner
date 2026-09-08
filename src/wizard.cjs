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
async function multiChoice(ask,prompt,items,defaults=[]){
 if(!items.length)return [];
 const values=items.map(x=>x.value),labels=Object.fromEntries(items.map(x=>[x.value,x.label]));
 if(ask.multiSelect)return ask.multiSelect(prompt,values,defaults,labels);
 while(true){const suffix=defaults.length?' [Enter = recommended]':' [Enter = none]',answer=(await ask(prompt+suffix+': ')).trim();if(!answer)return defaults;if(answer==='0')return [];
  const indexes=answer.split(/[ ,]+/).filter(Boolean).map(Number);if(indexes.length&&indexes.every(x=>Number.isInteger(x)&&x>=1&&x<=items.length))return [...new Set(indexes.map(x=>items[x-1].value))];
 }
}
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
async function planJobs(report,app,kind,months,log,api){const isDb=app.mode==='sqlite-vacuum';let jobs=[],label='';
 if(kind==='old'){label='Delete old chats';jobs=app.id==='cursor'?app.databases.flatMap(d=>require('./cursor-history.cjs').scan(d.file,{action:'delete',months,transcriptFiles:app.files})):app.id==='antigravity'?await require('./antigravity-history.cjs').scan(report.roots.antigravity,{action:'delete',months}):await old.candidates(app.id,app.files.filter(x=>fs.existsSync(x)),months);}
 else if(kind==='vacuum'){label='Reclaim unused database space';jobs=app.databases.filter(x=>fs.existsSync(x.file)).map(x=>api.inspectDb(x.file)).filter(x=>x.supported&&x.reclaimableBytes>0);}
 else if(isDb){label=kind==='main'?'Compact main chats':'Compact subagents';jobs=app.id==='cursor'?app.databases.flatMap(d=>require('./cursor-history.cjs').scan(d.file,{selection:kind})):await require('./antigravity-history.cjs').scan(report.roots.antigravity,{selection:kind});}
 else if(app.id==='codex'){label=kind==='main'?'Compact main chats':'Compact subagents';const files=kind==='main'?app.files:(app.plans||[]).map(p=>p.file);const scan=await pool(files.filter(x=>fs.existsSync(x)),2,file=>core.analyze(file,{includeMain:kind==='main'}));jobs=scan.results.filter(p=>p&&p.status==='candidate'&&(kind==='main'?!p.parent:!!p.parent));if(scan.errors.length)log(app.label+': some files could not be scanned and were skipped.');}
 else{label=app.id==='gemini'?'Remove superseded entries':kind==='main'?'Compact main chats':'Compact subagents';for(const cached of app.plans||[]){if(!fs.existsSync(cached.file))continue;const p=await (app.id==='claude'?transcripts.claudePlan:transcripts.geminiPlan)(cached.file);if(p.status==='candidate'&&(app.id!=='claude'||(kind==='main'?p.kind==='main':p.kind==='subagent')))jobs.push(p);}}
 if(jobs.skipped?.length)log(app.label+': skipped '+jobs.skipped.length+' unreadable or unsupported trajectories.');
 const expected=jobs.reduce((n,p)=>n+(kind==='old'?p.bytes:kind==='vacuum'?p.reclaimableBytes:p.saving),0);return {app,kind,label,months,jobs,expected};
}
function sameChat(a,b){return a.id&&b.id?a.id===b.id:a.file===b.file;}
async function applyStage(stage,report,api,vault,guard,log){const {app,kind}=stage,isDb=app.mode==='sqlite-vacuum',options={...vault.options(guard),vault};let saved=0,errors=[];
 try{if(isDb&&kind!=='vacuum')saved=app.id==='cursor'?await require('./cursor-history.cjs').apply(stage.jobs,kind==='old'?'delete':'compact',report.roots.cursorUser,vault,guard,report.roots.cursor):kind==='old'?await require('./antigravity-history.cjs').deleteChats(stage.jobs,report.roots.antigravity,report.roots.antigravityUser,app.databases.map(d=>d.file),vault,guard):await require('./antigravity-history.cjs').compact(stage.jobs,report.roots.antigravity,vault,guard);
  else if(kind==='old')saved=app.id==='codex'?await old.deleteCodex(stage.jobs,report.roots.codex,vault,guard):await old.deleteFiles(stage.jobs,app.id,report.roots[app.id],vault,guard);
  else{let lastLog=0;const output=await pool(stage.jobs,isDb?1:2,async p=>{const bytes=app.id==='codex'?await core.applyOne(p,await f.realpath(report.roots.codex),vault.dir,options):isDb?(await api.vacuumApply(p.file,vault.dir,report.roots[app.id+'User'],app.id,options)).saved:await transcripts.apply(p,report.roots[app.id],vault.dir,options);saved+=bytes;return bytes;},(done,total)=>{if(done===total||Date.now()-lastLog>1000){log(`  ${done}/${total} complete | ${format(saved)} reclaimed`);lastLog=Date.now();}});errors=output.errors.map(e=>e.message);}
 }catch(e){errors.push(e.message);}return {saved,errors};
}
async function run(report,ask,backupDir,log,api){
 const results=[];report.results=results;const vaults=new Map(),runId=new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomUUID().slice(0,8);
 const getVault=async app=>{if(!vaults.has(app.id)){const roots=app.mode==='sqlite-vacuum'?[report.roots[app.id+'User'],report.roots[app.id]]:[report.roots[app.id]];const dir=path.join(backupDir,runId+'-'+app.id);await f.mkdir(dir,{recursive:true});vaults.set(app.id,new Vault(dir,roots.filter(p=>fs.existsSync(p)),app.id));}return vaults.get(app.id);};
 try{
  const available=report.apps.filter(a=>a.files?.some(x=>fs.existsSync(x))),items=available.map(a=>({value:a.id,label:`${a.label} — ${format(a.logicalBytes)}`}));
  log('\nSTEP 1 OF 5 — APPLICATIONS');const selectedIds=await multiChoice(ask,'Choose applications to include',items,available.map(a=>a.id));const selected=available.filter(a=>selectedIds.includes(a.id));if(!selected.length){log('Nothing selected. No changes made.');return results;}
  log('\nSTEP 2 OF 5 — SUBAGENT / JOURNAL CLEANUP');const subIds=await multiChoice(ask,'Trim subagent history (Gemini: duplicate journal entries)',selected.map(a=>({value:a.id,label:a.label})),selected.map(a=>a.id));
  const mainApps=selected.filter(a=>['codex','claude','cursor','antigravity'].includes(a.id));log('\nSTEP 3 OF 5 — MAIN CHATS');const mainIds=await multiChoice(ask,'Trim main-chat history (optional)',mainApps.map(a=>({value:a.id,label:a.label})),[]);
  log('\nSTEP 4 OF 5 — OLD CHATS');const oldIds=await multiChoice(ask,'Delete inactive chats (optional)',selected.map(a=>({value:a.id,label:a.label})),[]);let months;if(oldIds.length){log('  1. More than 3 months\n  2. More than 6 months\n  3. More than 1 year');const age=await choice(ask,'Choose inactivity period', ['1','2','3'],'1');months=({1:3,2:6,3:12})[age];}
  const activeActionIds=new Set([...subIds,...mainIds,...oldIds]),dbApps=selected.filter(a=>a.mode==='sqlite-vacuum'&&!(a.id==='cursor'&&activeActionIds.has(a.id))&&!(a.id==='antigravity'&&oldIds.includes(a.id)));log('\nSTEP 5 OF 5 — DATABASE SPACE');const vacuumIds=await multiChoice(ask,'Reclaim unused database pages',dbApps.map(a=>({value:a.id,label:a.label})),dbApps.map(a=>a.id));
  log('\nAnalyzing your selected cleanup plan...');const specs=[...oldIds.map(id=>[id,'old',months]),...subIds.map(id=>[id,'subagent']),...mainIds.map(id=>[id,'main']),...vacuumIds.map(id=>[id,'vacuum'])];let stages=(await Promise.all(specs.map(([id,kind,m])=>planJobs(report,selected.find(a=>a.id===id),kind,m,log,api)))).filter(s=>s.jobs.length);
  for(const deletion of stages.filter(s=>s.kind==='old'))for(const stage of stages.filter(s=>s.app.id===deletion.app.id&&s.kind!=='old')){stage.jobs=stage.jobs.filter(p=>!deletion.jobs.some(d=>sameChat(p,d)));stage.expected=stage.jobs.reduce((n,p)=>n+(stage.kind==='vacuum'?p.reclaimableBytes:p.saving),0);}
  stages=stages.filter(s=>s.jobs.length);if(!stages.length)log('No eligible cleanup was found. Unsupported or already-minimal histories stayed unchanged.');
  else{log('\nCLEANUP PLAN');let total=0;for(const s of stages){total+=s.expected;log(`  ${s.app.label}: ${s.label} — ${s.jobs.length} item(s), about ${format(s.expected)}`);if(s.kind==='old'){for(const p of s.jobs.slice(0,5))log('    '+new Date(p.lastActivity).toISOString().slice(0,10)+'  '+p.title.replace(/[\r\n\x1b]/g,' ').slice(0,54));if(s.jobs.length>5)log('    ... '+(s.jobs.length-5)+' more');}}log(`  Estimated total: ${format(total)} before backup space.`);
   if(await yes(ask,'Apply this complete plan? Verified backups will be created first.')){const ready=new Set();for(const app of selected.filter(a=>stages.some(s=>s.app.id===a.id)))if(await processes.ensureStopped(app.id,q=>processAsk(ask,q),log))ready.add(app.id);else log(app.label+': skipped because it is still running.');
    for(const stage of stages.filter(s=>ready.has(s.app.id))){const app=stage.app,vault=await getVault(app),guard=processes.makeGuard(app.id),logicalBefore=app.files.filter(x=>fs.existsSync(x)).reduce((n,file)=>n+fs.statSync(file).size,0),before=await api.measure(app.files.filter(x=>fs.existsSync(x))),started=Date.now();log(`\n${app.label}: ${stage.label}...`);const applied=await applyStage(stage,report,api,vault,guard,log),after=await api.measure(app.files.filter(x=>fs.existsSync(x))),backups=await api.measure(await api.filesIn(vault.dir)),saved=logicalBefore-app.files.filter(x=>fs.existsSync(x)).reduce((n,file)=>n+fs.statSync(file).size,0),r={app:app.id,stage:stage.kind==='old'?'delete-old':'cleanup',action:stage.label,months:stage.months,logicalSaved:saved,logicalPercent:app.logicalBytes?100*saved/app.logicalBytes:0,storedSaved:before.errors.length||after.errors.length?null:before.bytes-after.bytes,backupStoredBytes:backups.bytes,backupDir:vault.dir,seconds:(Date.now()-started)/1000,errors:applied.errors};results.push(r);log(`Done: ${format(saved)} reclaimed. Backups: ${format(backups.bytes)}.`);if(r.errors.length)log('Stopped safely: '+r.errors.join('; '));}
   }
  }
  if(process.platform==='win32'){log('\nOPTIONAL — NTFS COMPRESSION');const ntfsIds=await multiChoice(ask,'Compress existing chat files',selected.map(a=>({value:a.id,label:a.label})),[]);if(ntfsIds.length&&await yes(ask,'Apply NTFS compression to the selected applications?'))for(const app of selected.filter(a=>ntfsIds.includes(a.id))){if(!await processes.ensureStopped(app.id,q=>processAsk(ask,q),log))continue;try{const r=await api.compressFiles(app.files.filter(x=>fs.existsSync(x)),app.id,log);results.push({app:app.id,stage:'ntfs',...r});log(`${app.label}: additional NTFS saving ${r.savedBytes===null?'unknown':format(r.savedBytes)}.`);}catch(e){log(app.label+': '+e.message);}}}
 await manageBackups(vaults,ask,log);
 if(results.length){let now=0,initial=0,backupBytes=0;for(const app of report.apps){initial+=app.logicalBytes||0;for(const file of app.files||[])if(fs.existsSync(file))now+=(await f.stat(file)).size;}for(const v of vaults.values())for(const file of await api.filesIn(v.dir))backupBytes+=(await f.stat(file)).size;
  report.finalSummary={sourceLogicalSaved:initial-now,remainingBackupLogicalBytes:backupBytes,netLogicalSaved:initial-now-backupBytes};log('\nFINAL TOTAL');log('Source files reclaimed: '+format(initial-now));log('Remaining backup files: '+format(backupBytes));log('Net saving including backups: '+format(initial-now-backupBytes));
 }
 return results;
 }finally{processes.stopWatcher();}
}
module.exports={run,overview,yes,choice,multiChoice,planJobs,manageBackups};
