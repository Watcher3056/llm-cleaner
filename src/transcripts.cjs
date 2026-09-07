'use strict';
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const core=require('./clean-subagents.cjs');
const conversational=new Set(['user','assistant','progress','system','attachment']);
async function records(file){const rows=[];for await(const {raw,offset} of core.lines(file)){
 if(!raw.toString('utf8').trim())continue;let x;try{x=JSON.parse(raw.toString('utf8'));}catch{throw Error('Malformed JSONL');}
 rows.push({x,offset,bytes:raw.length});
}return rows;}
function mergeRanges(rows){const ranges=[];for(const r of rows){const prev=ranges.at(-1);if(prev&&prev.offset+prev.bytes===r.offset)prev.bytes+=r.bytes;else ranges.push({offset:r.offset,bytes:r.bytes});}return ranges;}
async function claudePlan(file){
 const before=await fsp.stat(file),rows=await records(file),last=rows.findLastIndex(r=>r.x.type==='system'&&r.x.subtype==='compact_boundary');
 if(last<0)return {file,app:'claude',before,status:'no-checkpoint',saving:0};
 const boundary=rows[last].x;
 if(!boundary.uuid||boundary.parentUuid!=null)return {file,app:'claude',before,status:'non-root-boundary',saving:0};
 const summary=rows.slice(last+1).find(r=>r.x.type==='user'&&r.x.isCompactSummary===true);
 if(!summary)return {file,app:'claude',before,status:'missing-summary',saving:0};
 const byId=new Map(rows.map((r,i)=>[r.x.uuid,i]).filter(([k])=>k));const keep=new Set(rows.map((r,i)=>i>=last||!conversational.has(r.x.type)?i:-1).filter(i=>i>=0));
 const p=boundary.compactMetadata?.preservedMessages,seg=boundary.compactMetadata?.preservedSegment;
 if(p){if(!Array.isArray(p.uuids)||!byId.has(p.anchorUuid))throw Error('Invalid preserved-message anchors');keep.add(byId.get(p.anchorUuid));for(const id of p.uuids){if(!byId.has(id))throw Error('Missing preserved message');keep.add(byId.get(id));}}
 if(seg){if(!byId.has(seg.headUuid)||!byId.has(seg.tailUuid)||!byId.has(seg.anchorUuid))throw Error('Missing preserved segment');keep.add(byId.get(seg.anchorUuid));let i=byId.get(seg.tailUuid),seen=new Set();while(true){if(seen.has(i))throw Error('Cycle in preserved segment');seen.add(i);keep.add(i);if(rows[i].x.uuid===seg.headUuid)break;i=byId.get(rows[i].x.parentUuid);if(i===undefined)throw Error('Broken preserved segment chain');}}
 const remappedHeads=new Set([...(p?.uuids||[]),...(seg?[seg.headUuid]:[])]);
 // Resolve dependencies to a fixed point: parent chains, split assistant blocks and tool results.
 let changed=true;while(changed){const count=keep.size;
  for(const i of [...keep]){const x=rows[i].x;if(!conversational.has(x.type)||remappedHeads.has(x.uuid))continue;
   if(x.parentUuid){if(!byId.has(x.parentUuid))throw Error('Missing retained parent');keep.add(byId.get(x.parentUuid));}
  }
  const messageIds=new Set([...keep].map(i=>rows[i].x.type==='assistant'?rows[i].x.message?.id:null).filter(Boolean));
  for(let i=0;i<rows.length;i++)if(rows[i].x.type==='assistant'&&messageIds.has(rows[i].x.message?.id))keep.add(i);
  const assistantUuids=new Set([...keep].filter(i=>rows[i].x.type==='assistant').map(i=>rows[i].x.uuid));
  for(let i=0;i<rows.length;i++)if(rows[i].x.type==='user'&&assistantUuids.has(rows[i].x.parentUuid)&&Array.isArray(rows[i].x.message?.content)&&rows[i].x.message.content.some(c=>c.type==='tool_result'))keep.add(i);
  changed=keep.size!==count;
 }
 const selected=rows.filter((r,i)=>keep.has(i)),ranges=mergeRanges(selected),size=ranges.reduce((s,r)=>s+r.bytes,0);
 return {file,app:'claude',kind:rows.some(r=>r.x.isSidechain)||/[\\/]subagents[\\/]/.test(file)?'subagent':'main',id:boundary.sessionId,before,status:size<before.size?'candidate':'already-minimal',ranges,saving:before.size-size,keep:size,checkpointUuid:boundary.uuid};
}
// Gemini CLI 0.43 JSONL is an append/update journal, not a transcript-only array.
// Retain first and last version per ID in each rewind epoch, plus every metadata/rewind row.
// Thus insertion order, first prompt, summaries, lastUpdated and scratchpad freshness survive.
function geminiState(rows){let meta={},map=new Map(),firstUser,tracked=false,stale=false;
 for(const {x} of rows){if(typeof x.$rewindTo==='string'){
   if(tracked)stale=true;const keys=[...map.keys()],index=keys.indexOf(x.$rewindTo);for(const key of index<0?keys:keys.slice(index))map.delete(key);
  }else if(typeof x.id==='string'){
   if(tracked)stale=true;if(!firstUser&&x.type==='user'&&x.content)firstUser=typeof x.content==='string'?x.content:Array.isArray(x.content)?x.content.map(p=>typeof p.text==='string'?p.text:'').join(''):undefined;
   map.set(x.id,x);
  }else if(x.$set&&typeof x.$set==='object'&&!Array.isArray(x.$set)){
   if(Object.hasOwn(x.$set,'memoryScratchpad')){tracked=!!x.$set.memoryScratchpad;stale=false;}meta={...meta,...x.$set};
  }else if(typeof x.sessionId==='string'&&typeof x.projectHash==='string')meta={...meta,...x};else throw Error('Unknown Gemini record');
 }
 if(!meta.sessionId||!meta.projectHash)throw Error('Missing Gemini session metadata');
 return {meta,messages:[...map.values()],firstUser,tracked,stale};
}
async function geminiPlan(file){
 const before=await fsp.stat(file),rows=await records(file),state=geminiState(rows),keep=new Set(),versions=new Map();
 const flush=()=>{for(const v of versions.values()){keep.add(v.first);keep.add(v.last);}versions.clear();};
 for(let i=0;i<rows.length;i++){const x=rows[i].x;if(typeof x.id==='string'){const v=versions.get(x.id);if(v)v.last=i;else versions.set(x.id,{first:i,last:i});}
  else {keep.add(i);if(typeof x.$rewindTo==='string')flush();}}
 flush();const selected=rows.filter((r,i)=>keep.has(i));assert.deepEqual(geminiState(selected),state,'Gemini replay state differs');
 const ranges=mergeRanges(selected),size=ranges.reduce((s,r)=>s+r.bytes,0);
 return {file,app:'gemini',id:state.meta.sessionId,before,status:size<before.size?'candidate':'already-minimal',ranges,saving:before.size-size,keep:size};
}
async function writePlan(p,dest){const h=await fsp.open(dest,'wx'),hash=crypto.createHash('sha256');try{
 for(const r of p.ranges)for await(const b of fs.createReadStream(p.file,{start:r.offset,end:r.offset+r.bytes-1})){hash.update(b);let at=0;while(at<b.length){const n=await h.write(b,at,b.length-at);if(!n.bytesWritten)throw Error('Short write');at+=n.bytesWritten;}}
 await h.sync();}finally{await h.close();}return hash.digest('hex');}
async function apply(p,allowedRoot,backupDir,options={}){
 const guard=options.guard||(()=>core.assertStopped(p.app)),makeBackup=options.backupFn||core.backup;
 await guard();const real=await fsp.realpath(p.file),root=await fsp.realpath(allowedRoot);
 if(!core.inside(root,real)||(await fsp.lstat(p.file)).isSymbolicLink())throw Error('Transcript outside selected storage');
 const fresh=await (p.app==='claude'?claudePlan:geminiPlan)(real);if(fresh.status!=='candidate')return 0;
 const space=await fsp.statfs(path.dirname(real));if(space.bavail*space.bsize<fresh.keep+1024*1024)throw Error('Not enough space for verified temporary transcript');
 const hash=await core.digest(real),now=await fsp.stat(real);if(now.size!==fresh.before.size||now.mtimeMs!==fresh.before.mtimeMs||now.ino!==fresh.before.ino)throw Error('Transcript changed during planning');
 const dest=path.join(backupDir,path.relative(root,real)+'.gz');await makeBackup({file:real,sha256:hash},dest);
 const temp=real+'.clean-'+crypto.randomUUID();try{const expected=await writePlan(fresh,temp);
  if(await core.digest(temp)!==expected)throw Error('Temporary file differs');
  const check=await (p.app==='claude'?claudePlan:geminiPlan)(temp);if(check.status!=='already-minimal')throw Error('Reduced transcript is not stable');
  await guard();if(await core.digest(real)!==hash)throw Error('Transcript changed');
  await fsp.chmod(temp,fresh.before.mode&0o777);await fsp.utimes(temp,fresh.before.atime,fresh.before.mtime);
  await fsp.appendFile(path.join(backupDir,'journal.jsonl'),JSON.stringify({state:'prepared',file:real,backup:dest,sha256:hash,reducedHash:expected,before:fresh.before.size,after:fresh.keep})+'\n');
  await fsp.rename(temp,real);await options.committed?.(real,expected);
  await fsp.appendFile(path.join(backupDir,'journal.jsonl'),JSON.stringify({state:'replaced',file:real,backup:dest,reducedHash:expected})+'\n');return fresh.saving;
 }finally{if(fs.existsSync(temp))await fsp.unlink(temp);}
}
module.exports={records,claudePlan,geminiPlan,geminiState,writePlan,apply};
