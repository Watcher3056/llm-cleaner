'use strict';
const fs=require('node:fs'),f=fs.promises,path=require('node:path'),{spawn,execFileSync}=require('node:child_process'),readline=require('node:readline');
const core=require('./clean-subagents.cjs');
function cutoff(months,now=new Date()){if(![3,6,12].includes(months))throw Error('Unsupported age');const d=new Date(now),day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()-months);const max=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,max));return d.getTime();}
async function info(file,app){const stat=await f.stat(file);let last=stat.mtimeMs,id,parent,title='',valid=true,kind='main',seen=0;
 try{for await(const {raw} of core.lines(file)){const x=JSON.parse(raw);seen++;
  for(const value of [x.timestamp,x.lastUpdated,x.$set?.lastUpdated])if(value){const time=Date.parse(value);if(Number.isFinite(time))last=Math.max(last,time);else valid=false;}
  if(app==='codex'&&seen===1){if(x.type!=='session_meta')valid=false;id=x.payload?.id;parent=x.payload?.source?.subagent?.thread_spawn?.parent_thread_id||x.payload?.forked_from_id;kind=parent?'subagent':'main';}
  if(app==='claude'){id=id||x.sessionId;if(x.isSidechain)kind='subagent';if(x.customTitle)title=x.customTitle;}
  if(app==='gemini'&&x.sessionId){id=x.sessionId;if(x.kind==='subagent')kind='subagent';}
  if(!title&&app==='codex'&&x.type==='event_msg'&&x.payload?.type==='user_message')title=String(x.payload.message||'').slice(0,80);
 }}catch{valid=false;}
 return {file,app,id,parent,kind,title:title||path.basename(file),lastActivity:last,bytes:stat.size,mtimeMs:stat.mtimeMs,valid:valid&&seen>0&&!!id};
}
async function candidates(app,files,months,now=new Date()){
 const limit=cutoff(months,now),items=[];
 // Include recent files in the dependency graph, but avoid parsing their entire history.
 for(const file of files.filter(x=>x.endsWith('.jsonl'))){const s=await f.stat(file);if(s.mtimeMs>=limit){if(app==='codex'){for await(const {raw} of core.lines(file)){try{const x=JSON.parse(raw);items.push({file,id:x.payload?.id,parent:x.payload?.source?.subagent?.thread_spawn?.parent_thread_id||x.payload?.forked_from_id,valid:false});}catch{}break;}}continue;}
  items.push(await info(file,app));
 }
 const referenced=new Set(items.map(x=>x.parent).filter(Boolean));
 return items.filter(x=>x.valid&&x.lastActivity<limit&&!referenced.has(x.id)&&!(app==='claude'&&fs.existsSync(x.file.replace(/\.jsonl$/,'')))&&!(app==='gemini'&&fs.existsSync(path.join(path.dirname(x.file),x.id))));
}
function codexCommand(){
 if(process.env.CLEANER_CODEX_BINARY)return {cmd:process.env.CLEANER_CODEX_BINARY,args:[]};
 if(process.platform!=='win32')return {cmd:'codex',args:[]};
 // Prefer the npm JS launcher to avoid executing .cmd through a shell.
 const cli=path.join(process.env.APPDATA||'', 'npm/node_modules/@openai/codex/bin/codex.js');if(fs.existsSync(cli))return {cmd:process.execPath,args:[cli]};
 try{const file=execFileSync('where.exe',['codex.exe'],{encoding:'utf8',windowsHide:true}).trim().split(/\r?\n/)[0];if(file)return {cmd:file,args:[]};}catch{}
 throw Error('Codex CLI is required to remove old Codex chats and their index entries.');
}
async function deleteCodex(items,home,vault,guard){
 await guard();const executable=codexCommand(),originalNames=new Set(await f.readdir(home));
 await vault.capture(path.join(home,'session_index.jsonl'));
 // The vendor API updates the catalog. Snapshot its database and sidecars for undo.
 for(const name of await f.readdir(home))if(/^state_\d+\.sqlite$/.test(name))for(const suffix of ['', '-wal','-shm'])await vault.capture(path.join(home,name+suffix));
 for(const item of items)await vault.capture(item.file);
 const child=spawn(executable.cmd,[...executable.args,'app-server','--listen','stdio://','-c','mcp_servers={}'],{env:{...process.env,CODEX_HOME:home},stdio:['pipe','pipe','pipe'],windowsHide:true});
 let serial=0,pending=new Map();child.stdin.on('error',()=>{});const failed=e=>{for(const reply of pending.values())reply({error:{message:e.message||'Codex helper exited'}});pending.clear();};child.on('error',failed);child.on('exit',()=>failed(Error('Codex helper exited')));const rl=readline.createInterface({input:child.stdout});let stderr='';child.stderr.on('data',b=>{stderr=(stderr+b).slice(-1000);});
 rl.on('line',line=>{try{const x=JSON.parse(line);if(pending.has(x.id)){pending.get(x.id)(x);pending.delete(x.id);}}catch{}});
 const rpc=(method,params)=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('Codex delete API timed out'));},15000);pending.set(id,x=>{clearTimeout(timer);x.error?reject(Error(x.error.message)):resolve(x.result);});child.stdin.write(JSON.stringify({id,method,params})+'\n');});
 const exit=new Promise(resolve=>{child.on('exit',resolve);child.on('error',()=>resolve(-1));});let saved=0;
 try{await rpc('initialize',{clientInfo:{name:'chat_storage_cleaner',version:'2.0.0'},capabilities:{experimentalApi:true}});child.stdin.write('{"method":"initialized"}\n');
  for(const item of items){if((await info(item.file,'codex')).lastActivity!==item.lastActivity)throw Error('Chat activity changed');await rpc('thread/delete',{threadId:item.id});if(fs.existsSync(item.file))throw Error('Codex did not remove the transcript');await vault.commit(item.file,null);saved+=item.bytes;}
 }finally{child.stdin.end();const timer=setTimeout(()=>child.kill(),2000);await exit;clearTimeout(timer);rl.close();await guard();
  for(const name of await f.readdir(home))if(/^state_\d+\.sqlite(?:-wal|-shm)?$/.test(name)&&!originalNames.has(name))await vault.created(path.join(home,name));
  await vault.commit(path.join(home,'session_index.jsonl'),await require('./backup-vault.cjs').fingerprint(path.join(home,'session_index.jsonl')));
  for(const e of vault.entries.values())if(/state_\d+\.sqlite(?:-wal|-shm)?$/.test(e.file))await vault.commit(e.file,await require('./backup-vault.cjs').fingerprint(e.file));
 }
 return saved;
}
async function deleteFiles(items,app,root,vault,guard){let saved=0;
 for(const item of items){await guard();const actual=await f.realpath(item.file);if(!core.inside(await f.realpath(root),actual))throw Error('Deletion outside storage');const current=await info(actual,app);if(!current.valid||current.lastActivity!==item.lastActivity||current.bytes!==item.bytes)throw Error('Chat changed since age scan');
  await vault.capture(actual);await guard();const entry=vault.entries.get(actual);if(await core.digest(actual)!==entry.afterHash)throw Error('Chat changed before deletion');await f.unlink(actual);await vault.commit(actual,null);saved+=item.bytes;
 }return saved;
}
module.exports={cutoff,info,candidates,deleteFiles,deleteCodex,codexCommand};
