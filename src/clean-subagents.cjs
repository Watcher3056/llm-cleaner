#!/usr/bin/env node
'use strict';
// Node.js 22+. No packages. Dry-run by default. Never edits SQLite databases.
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),os=require('node:os');
const crypto=require('node:crypto'),zlib=require('node:zlib');
const {pipeline}=require('node:stream/promises');
const {Writable}=require('node:stream');
const {execFileSync}=require('node:child_process');
const GiB=2**30;
async function* lines(file){
  let pieces=[],length=0,offset=0;
  for await(const chunk of fs.createReadStream(file,{highWaterMark:1024*1024})){
    let start=0,index;
    while((index=chunk.indexOf(10,start))!==-1){
      const part=chunk.subarray(start,index+1);pieces.push(part);length+=part.length;
      const raw=pieces.length===1?pieces[0]:Buffer.concat(pieces,length);
      yield {raw,offset};offset+=length;pieces=[];length=0;start=index+1;
    }
    if(start<chunk.length){const part=chunk.subarray(start);pieces.push(part);length+=part.length;}
    if(length>256*1024*1024)throw Error('Line exceeds 256 MiB: unsupported');
  }
  if(length)yield {raw:Buffer.concat(pieces,length),offset};
}
function inside(root,file){const rel=path.relative(root,file);return rel!==''&&!rel.startsWith('..')&&!path.isAbsolute(rel);}
async function* walk(dir){if(!fs.existsSync(dir))return;for(const e of await fsp.readdir(dir,{withFileTypes:true})){
  const p=path.join(dir,e.name);if(e.isSymbolicLink())continue;if(e.isDirectory())yield*walk(p);else if(e.isFile()&&e.name.endsWith('.jsonl'))yield p;
}}
function same(a,b){return a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ino===b.ino;}
async function analyze(file,options={}){
  const before=await fsp.stat(file);let id,parent,cp=null,count=0,metadata=[],prefix=[],invalid=0,rollback=false,unsupported=false;
  const hash=crypto.createHash('sha256');
  for await(const {raw,offset} of lines(file)){
    hash.update(raw);let x;try{x=JSON.parse(raw.toString('utf8'));}catch{invalid++;continue;}
    if(offset===0){
      if(x.type!=='session_meta')return {file,before,status:'not-session'};
      id=x.payload?.id;parent=x.payload?.source?.subagent?.thread_spawn?.parent_thread_id;
      // Only explicit subagent metadata qualifies; ordinary forks are excluded.
      if((!parent||parent===id)&&!options.includeMain)return {file,before,id,status:'main-or-unproven'};
      if(!parent&&typeof x.payload?.source!=='string')return {file,before,id,status:'unproven-session-kind'};
      if(!file.includes(id))return {file,before,id,status:'id-mismatch'};
    }
    if(x.type==='compacted'){
      count++;const full=Array.isArray(x.payload?.replacement_history)&&x.payload.replacement_history.length>0;
      cp=full?{offset,bytes:raw.length}:null;prefix=metadata.slice();rollback=false;
    }else if(!['response_item','event_msg'].includes(x.type)){
      // Retain all non-transcript state, including every session_meta and turn_context,
      // world_state and inter-agent metadata. Preserve raw bytes and original order.
      if(!['session_meta','turn_context','world_state','inter_agent_communication_metadata'].includes(x.type))unsupported=true;
      metadata.push({offset,bytes:raw.length});
    }
    if(cp&&x.type==='event_msg'&&x.payload?.type==='thread_rolled_back')rollback=true;
  }
  const after=await fsp.stat(file);
  let status=!same(before,after)?'changed':invalid?'invalid-json':unsupported?'unknown-record-type':!cp?'no-full-last-checkpoint':rollback?'rollback-after-checkpoint':'candidate';
  const keep=cp?prefix.reduce((s,x)=>s+x.bytes,0)+before.size-cp.offset:before.size;
  if(status==='candidate'&&keep>=before.size)status='already-minimal';
  return {file,id,parent,before,status,invalid,count,checkpoint:cp,prefix,keep,saving:status==='candidate'?before.size-keep:0,sha256:hash.digest('hex')};
}
async function digest(file){const h=crypto.createHash('sha256');for await(const b of fs.createReadStream(file))h.update(b);return h.digest('hex');}
async function writeReduced(plan,destination){
  const handle=await fsp.open(destination,'wx');
  const hash=crypto.createHash('sha256');
  try{for(const range of [...plan.prefix,{offset:plan.checkpoint.offset,bytes:plan.before.size-plan.checkpoint.offset}]){
    if(!range.bytes)continue;
    for await(const chunk of fs.createReadStream(plan.file,{start:range.offset,end:range.offset+range.bytes-1})){
      hash.update(chunk);
      let offset=0;while(offset<chunk.length){const r=await handle.write(chunk,offset,chunk.length-offset);if(!r.bytesWritten)throw Error('Short write');offset+=r.bytesWritten;}
    }
  }await handle.sync();}finally{await handle.close();}
  return hash.digest('hex');
}
function assertStopped(app='codex'){require('./process-control.cjs').assertStopped(app);}
async function backup(plan,dest){
  await fsp.mkdir(path.dirname(dest),{recursive:true});
  await pipeline(fs.createReadStream(plan.file),zlib.createGzip({level:6}),fs.createWriteStream(dest,{flags:'wx'}));
  const h=crypto.createHash('sha256');
  await pipeline(fs.createReadStream(dest),zlib.createGunzip(),new Writable({write(b,e,cb){h.update(b);cb();}}));
  if(h.digest('hex')!==plan.sha256)throw Error('Backup verification failed');
}
async function applyOne(plan,home,backupDir,options={}){
  const guard=options.guard||assertStopped,makeBackup=options.backupFn||backup;
  await guard();const actual=await fsp.realpath(plan.file);
  if(!inside(home,actual)||!['sessions','archived_sessions'].includes(path.relative(home,actual).split(path.sep)[0]))throw Error('Path outside session directories');
  if(!same(plan.before,await fsp.stat(actual))||await digest(actual)!==plan.sha256)throw Error('Source changed since scan');
  const dest=path.join(backupDir,path.relative(home,actual)+'.gz');await makeBackup(plan,dest);
  const temp=actual+'.prune-'+crypto.randomUUID()+'.tmp';
  try{
    const space=await fsp.statfs(path.dirname(actual));if(space.bavail*space.bsize<plan.keep+1024*1024)throw Error('Not enough free space for reduced temporary file');
    const expectedHash=await writeReduced(plan,temp);const check=await analyze(temp,{includeMain:!plan.parent});
    if(!['candidate','already-minimal'].includes(check.status)||check.id!==plan.id||check.before.size!==plan.keep)throw Error('Reduced file validation failed: '+check.status);
    // The writer copies selected ranges exactly. Verify again before replacing the source.
    await guard();if(!same(plan.before,await fsp.stat(actual))||await digest(actual)!==plan.sha256)throw Error('Source changed while preparing');
    const reducedHash=await digest(temp);
    if(reducedHash!==expectedHash)throw Error('Reduced file byte verification failed');
    await fsp.chmod(temp,plan.before.mode & 0o777);
    await fsp.utimes(temp,plan.before.atime,plan.before.mtime);
    await fsp.appendFile(path.join(backupDir,'journal.jsonl'),JSON.stringify({state:'prepared',file:actual,backup:dest,originalHash:plan.sha256,reducedHash,before:plan.before.size,after:plan.keep})+'\n');
    await fsp.rename(temp,actual);await options.committed?.(actual,reducedHash);
    await fsp.appendFile(path.join(backupDir,'journal.jsonl'),JSON.stringify({state:'replaced',file:actual,saved:plan.saving})+'\n');
    return plan.saving;
  }finally{if(fs.existsSync(temp))await fsp.unlink(temp);}
}
async function main(){
  const args=process.argv.slice(2),value=k=>{const i=args.indexOf(k);return i<0?undefined:args[i+1];};
  if(args.includes('--help')){console.log('node clean-subagents.cjs [--home PATH] [--report PATH] [--apply --backup-dir PATH]\nDefault: scan only. --apply ALWAYS asks you to type CLEAN SUBAGENTS. Close Codex first.\nSavings are logical file bytes, excluding compressed backups. Backups are mandatory for apply.');return;}
  const home=await fsp.realpath(value('--home')||process.env.CODEX_HOME||path.join(os.homedir(),'.codex'));
  const plans=[];let seen=0,total=0,children=0,childBytes=0;const skipped={};
  for(const dir of ['sessions','archived_sessions'])for await(const file of walk(path.join(home,dir))){
    seen++;let p;try{p=await analyze(file);}catch(e){p={file,status:'read-error',error:e.message,before:await fsp.stat(file)};}
    total+=p.before.size;if(p.parent){children++;childBytes+=p.before.size;}
    if(p.status==='candidate')plans.push(p);else skipped[p.status]=(skipped[p.status]||0)+1;
    if(seen%25===0)console.log(`Scanned ${seen} files; ${plans.length} candidates; ${(plans.reduce((s,p)=>s+p.saving,0)/GiB).toFixed(2)} GiB potential savings`);
  }
  const saving=plans.reduce((s,p)=>s+p.saving,0);
  const report={createdAt:new Date().toISOString(),home,files:seen,subagentFiles:children,subagentBytes:childBytes,candidates:plans.length,savedBytes:saving,savedGiB:saving/GiB,percentOfSubagents:childBytes?100*saving/childBytes:0,percentOfAllSessions:total?100*saving/total:0,remainingSubagentBytes:childBytes-saving,skipped,plans};
  if(value('--report'))await fsp.writeFile(path.resolve(value('--report')),JSON.stringify(report,null,2));
  console.log(JSON.stringify({...report,plans:undefined},null,2));
  if(!args.includes('--apply')||!plans.length)return;
  if(!value('--backup-dir'))throw Error('--backup-dir is required. Prefer a different disk.');
  const backupBase=path.resolve(value('--backup-dir'));
  if(inside(home,backupBase)||backupBase===home)throw Error('Backup must be outside CODEX_HOME');
  assertStopped();
  console.log('Original pre-checkpoint history will be removed; verified .gz backups will remain.');
  const rl=require('node:readline/promises').createInterface({input:process.stdin,output:process.stdout});
  let answer;try{answer=await rl.question('Type CLEAN SUBAGENTS to confirm, anything else cancels: ');}finally{rl.close();}
  if(answer.trim()!=='CLEAN SUBAGENTS'){console.log('Cancelled. No sessions changed.');return;}
  assertStopped();const backupDir=path.join(backupBase,new Date().toISOString().replace(/[:.]/g,'-'));await fsp.mkdir(backupDir,{recursive:true});
  let actual=0,completed=0;
  try{for(const p of plans.sort((a,b)=>b.saving-a.saving)){actual+=await applyOne(p,home,backupDir);completed++;console.log(`Replaced ${completed}/${plans.length}; saved ${(actual/GiB).toFixed(3)} GiB`);}}
  finally{console.log(JSON.stringify({completed,actualSavedBytes:actual,actualSavedGiB:actual/GiB,percentOfOriginalSubagentBytes:childBytes?100*actual/childBytes:0,backupDir},null,2));}
}
module.exports={analyze,writeReduced,lines,applyOne,backup,digest,assertStopped,walk,inside};
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
