'use strict';
const {execFileSync}=require('node:child_process'),path=require('node:path');
const apps=['codex','claude','cursor','gemini','antigravity'];
function classify(name,args=''){
 name=name.split(/[\\/]/).at(-1).toLowerCase().replace(/\.exe$/,'');
 if(/^(codex|codex-code-mode-host|chatgpt)( helper.*)?$/.test(name))return 'codex';
 if(/^claude( helper.*)?$/.test(name))return 'claude';
 if(/^(cursor|cursor-agent)( helper.*)?$/.test(name))return 'cursor';
 if(/^antigravity( helper.*)?$/.test(name)||/^language_server/.test(name)&&/[\\/]antigravity[\\/]/i.test(args))return 'antigravity';
 if(name==='gemini')return 'gemini';
 if(/^(node|bun|nodejs)$/.test(name)){
  if(/[/\\]@openai[/\\]codex[/\\]/i.test(args))return 'codex';
  if(/[/\\]@anthropic-ai[/\\]claude-code[/\\]/i.test(args))return 'claude';
  if(/[/\\]@google[/\\]gemini-cli[/\\]/i.test(args))return 'gemini';
  if(/[/\\]cursor[/\\].*cli\.js/i.test(args))return 'cursor';
 }
 return null;
}
function list(){
 let rows;
 if(process.platform==='win32')rows=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'process-guard.ps1')],{encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024}).replace(/^\uFEFF/,''));
 else if(['linux','darwin'].includes(process.platform))rows=execFileSync('ps',['-axo','pid=,ppid=,lstart=,comm=,args='],{encoding:'utf8',maxBuffer:16*1024*1024}).split('\n').flatMap(line=>{
  const m=line.trim().match(/^(\d+)\s+(\d+)\s+((?:\S+\s+){4}\S+)\s+(\S+)\s+(.*)$/);return m?[{pid:+m[1],ppid:+m[2],start:m[3],name:m[4],app:classify(m[4],m[5])}]:[];
 });else throw Error('Unsupported process inspection platform');
 const ancestors=new Set([process.pid]);let p=process.pid;while(p){const r=rows.find(x=>x.pid===p);if(!r||ancestors.has(r.ppid))break;p=r.ppid;ancestors.add(p);}
 return rows.filter(r=>r.app).map(r=>({...r,protected:ancestors.has(r.pid)}));
}
function assertStopped(app){if(!apps.includes(app))throw Error('Unknown application');const running=list().filter(p=>p.app===app);if(running.length)throw Error(`Close ${app} first (${running.length} processes). Run cleaner from an external terminal.`);}
function signal(row,force){
 const current=list().find(p=>p.pid===row.pid&&p.start===row.start&&p.app===row.app);if(!current)return;if(current.protected)throw Error('Refusing to close cleaner or its parent application');
 if(process.platform==='win32')execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'process-guard.ps1'),'-TargetPid',String(row.pid),'-ExpectedStart',row.start,'-Action',force?'Force':'Close'],{windowsHide:true,stdio:'pipe'});
 else process.kill(row.pid,force?'SIGKILL':'SIGTERM');
}
async function ensureStopped(app,ask,log=console.log,backend={list,signal,wait:ms=>new Promise(r=>setTimeout(r,ms))}){
 let running=backend.list().filter(p=>p.app===app);if(!running.length)return true;
 log(`${app}: ${running.length} processes are running.`);
 if(running.some(p=>p.protected)){log('The cleaner runs inside this application. Start it in an external terminal, then close the application. Stage skipped.');return false;}
 if((await ask(`Save your work. Close ${app} automatically? Type CLOSE ${app.toUpperCase()}: `)).trim()!==`CLOSE ${app.toUpperCase()}`)return false;
 for(const p of running)backend.signal(p,false);await backend.wait(5000);
 running=backend.list().filter(p=>p.app===app);if(!running.length)return true;
 if(running.some(p=>p.protected))return false;
 if((await ask(`${app} still has ${running.length} processes. Unsaved work may be lost. Type FORCE CLOSE ${app.toUpperCase()} to terminate them: `)).trim()!==`FORCE CLOSE ${app.toUpperCase()}`)return false;
 for(const p of running)backend.signal(p,true);await backend.wait(1500);
 return !backend.list().some(p=>p.app===app);
}
module.exports={apps,classify,list,assertStopped,ensureStopped,signal};

// Keep one PowerShell process warm; coalesce simultaneous checks, never cache a completed result.
let watcher=null,pendingCheck=null;
function stopWatcher(){if(watcher){watcher.stdin.end();watcher.kill();watcher=null;}}
process.once('exit',stopWatcher);
async function asyncRows(){
 if(pendingCheck)return pendingCheck;
 pendingCheck=(async()=>{
  if(process.platform!=='win32')return list();
  if(!watcher){watcher=require('node:child_process').spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'process-guard.ps1'),'-Watch'],{windowsHide:true,stdio:['pipe','pipe','pipe']});watcher.stderr.resume();}
  const child=watcher;
  return new Promise((resolve,reject)=>{let data='';const timer=setTimeout(()=>finish(Error('Process guard timed out')),10000);
   const finish=(error,value)=>{clearTimeout(timer);child.stdout.off('data',onData);child.off('error',onError);child.off('exit',onExit);if(error){stopWatcher();reject(error);}else resolve(value);};
   const onError=e=>finish(e),onExit=()=>finish(Error('Process guard exited'));
   const onData=b=>{data+=b;const i=data.indexOf('\n');if(i>=0){try{finish(null,JSON.parse(data.slice(0,i).replace(/^\uFEFF/,'')));}catch(e){finish(e);}}};
   child.stdout.on('data',onData);child.once('error',onError);child.once('exit',onExit);child.stdin.write('check\n');
  });
 })();try{return await pendingCheck;}finally{pendingCheck=null;}
}
function makeGuard(app){return async()=>{if(!apps.includes(app))throw Error('Unknown application');const rows=await asyncRows();if(rows.some(r=>r.app===app))throw Error('Application restarted: '+app);};}
module.exports.makeGuard=makeGuard;module.exports.stopWatcher=stopWatcher;
