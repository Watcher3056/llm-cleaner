'use strict';
const fs=require('node:fs'),f=fs.promises,path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const {pipeline}=require('node:stream/promises'),{Writable}=require('node:stream');
const core=require('./clean-subagents.cjs');
async function fingerprint(file){try{const s=await f.lstat(file);if(!s.isFile()||s.isSymbolicLink())throw Error('Not a regular file: '+file);return await core.digest(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function archiveHash(file,dest){const h=crypto.createHash('sha256');await pipeline(fs.createReadStream(file),zlib.createGunzip(),dest?new (require('node:stream').Transform)({transform(b,e,cb){h.update(b);cb(null,b);}}):new Writable({write(b,e,cb){h.update(b);cb();}}),...(dest?[fs.createWriteStream(dest,{flags:'wx'})]:[]));return h.digest('hex');}
class Vault{
 constructor(dir,roots,app){this.dir=path.resolve(dir);this.roots=roots.map(p=>path.resolve(p));this.app=app;this.entries=new Map();this.queue=Promise.resolve();}
 async validSource(file){file=path.resolve(file);const parent=await f.realpath(path.dirname(file));const actual=path.join(parent,path.basename(file));const roots=await Promise.all(this.roots.map(p=>f.realpath(p)));
  if(!roots.some(r=>core.inside(r,actual)))throw Error('Backup target outside selected storage');if(fs.existsSync(file)&&(await f.lstat(file)).isSymbolicLink())throw Error('Symbolic link target');return actual;
 }
 async save(){this.queue=this.queue.then(async()=>{await f.mkdir(this.dir,{recursive:true});const dest=path.join(this.dir,'backup-manifest.json'),temp=dest+'.tmp';await f.writeFile(temp,JSON.stringify({version:1,app:this.app,entries:[...this.entries.values()]},null,2));await f.rename(temp,dest);});return this.queue;}
 async capture(file,dest,expected){file=await this.validSource(file);if(this.entries.has(file)){const e=this.entries.get(file);if(await fingerprint(file)!==e.afterHash)throw Error('File changed since the previous operation; start a new run: '+file);return e.backup;}
  const before=await fingerprint(file),s=before===null?null:await f.stat(file);if(expected&&expected!==before)throw Error('File changed before backup');
  dest=path.resolve(dest||path.join(this.dir,crypto.randomUUID()+'.gz'));if(!core.inside(this.dir,dest))throw Error('Archive outside run directory');
  if(before!==null){await core.backup({file,sha256:before},dest);if(await fingerprint(file)!==before)throw Error('File changed while backing up');}
  this.entries.set(file,{file,backup:before===null?null:dest,beforeHash:before,afterHash:before,mode:s?.mode,atime:s?.atime,mtime:s?.mtime,bytes:s?.size||0});await this.save();return dest;
 }
 async created(file){file=await this.validSource(file);if(this.entries.has(file))return;this.entries.set(file,{file,backup:null,beforeHash:null,afterHash:await fingerprint(file),bytes:0});await this.save();}
 async commit(file,hash){file=path.resolve(file);const e=this.entries.get(file);if(!e)throw Error('Missing backup registration');e.afterHash=hash;await this.save();}
 options(guard){return {guard,backupFn:async(p,d)=>this.capture(p.file,d,p.sha256),committed:(file,hash)=>this.commit(file,hash)};}
 async restore(guard){
  // Validate every archive and every conflict first. Never replace a changed chat.
  for(const e of this.entries.values()){await this.validSource(e.file);if(await fingerprint(e.file)!==e.afterHash)throw Error('Restore blocked: file changed since cleanup: '+e.file);
   if(e.backup){const real=await f.realpath(e.backup);if(!core.inside(await f.realpath(this.dir),real)||(await f.lstat(e.backup)).isSymbolicLink())throw Error('Invalid archive path');if(await archiveHash(e.backup)!==e.beforeHash)throw Error('Damaged backup: '+e.backup);}
  }
  let restored=0;for(const e of this.entries.values()){await guard();if(await fingerprint(e.file)!==e.afterHash)throw Error('Restore conflict: '+e.file);
   if(e.beforeHash===e.afterHash)continue;
   if(e.beforeHash===null){if(fs.existsSync(e.file))await f.unlink(e.file);}
   else {const temp=e.file+'.restore-'+crypto.randomUUID();try{if(await archiveHash(e.backup,temp)!==e.beforeHash)throw Error('Restore verification failed');await guard();if(await fingerprint(e.file)!==e.afterHash)throw Error('File changed during restore');await f.chmod(temp,e.mode&0o777);await f.utimes(temp,new Date(e.atime),new Date(e.mtime));await f.rename(temp,e.file);}finally{if(fs.existsSync(temp))await f.unlink(temp);}}
   e.afterHash=e.beforeHash;restored++;await this.save();
  }return restored;
 }
 async removeBackups(){
  // Only files owned by this run. No recursive deletion and no old backup folders.
  const root=await f.realpath(this.dir),known=[...this.entries.values()].map(e=>e.backup).filter(Boolean);known.push(path.join(this.dir,'journal.jsonl'),path.join(this.dir,'backup-manifest.json'));
  const dirs=new Set([this.dir]);let bytes=0;for(const file of new Set(known)){if(!fs.existsSync(file))continue;const real=await f.realpath(file);if(!core.inside(root,real)||(await f.lstat(file)).isSymbolicLink())throw Error('Invalid backup deletion target');bytes+=(await f.stat(file)).size;await f.unlink(file);let d=path.dirname(file);while(core.inside(root,d)){dirs.add(d);d=path.dirname(d);}}
  for(const d of [...dirs].sort((a,b)=>b.length-a.length))await f.rmdir(d).catch(e=>{if(!['ENOTEMPTY','ENOENT'].includes(e.code))throw e;});return bytes;
 }
}
module.exports={Vault,fingerprint,archiveHash};
