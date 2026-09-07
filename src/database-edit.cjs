'use strict';
const fs=require('node:fs'),f=fs.promises,path=require('node:path'),crypto=require('node:crypto'),{DatabaseSync}=require('node:sqlite');
const core=require('./clean-subagents.cjs'),{fingerprint}=require('./backup-vault.cjs');
// Snapshot the complete DB/WAL set before SQLite safely checkpoints it. If replacement fails,
// the source still contains every committed row, and the original physical files remain backed up.
async function edit(file,root,vault,guard,change){
 await guard();const actual=await f.realpath(file);if(!core.inside(await f.realpath(root),actual))throw Error('Database outside selected storage');
 if((await f.lstat(file)).isSymbolicLink()||path.basename(actual)!=='state.vscdb')throw Error('Invalid application database');
 const original=await f.stat(actual),hashes=new Map();let beforeBytes=0;for(const suffix of ['', '-wal','-shm']){const p=actual+suffix;await vault.capture(p);if(fs.existsSync(p))beforeBytes+=(await f.stat(p)).size;}
 await guard();let checkpoint;try{checkpoint=new DatabaseSync(actual);const r=checkpoint.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();if(r.busy)throw Error('Application database is busy');}finally{checkpoint?.close();for(const suffix of ['', '-wal','-shm']){const p=actual+suffix,h=await fingerprint(p);await vault.commit(p,h);hashes.set(p,h);}}
 const temp=actual+'.cleaner-'+crypto.randomUUID()+'.tmp';let source,db;
 try{await f.copyFile(actual,temp,fs.constants.COPYFILE_EXCL);db=new DatabaseSync(temp);db.exec('BEGIN IMMEDIATE');const result=await change(db);db.exec('COMMIT');db.exec('VACUUM');if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Database integrity failed');db.close();db=null;
 await f.chmod(temp,original.mode);await f.utimes(temp,original.atime,original.mtime);await guard();for(const [p,h]of hashes)if(await fingerprint(p)!==h)throw Error('Database changed during cleanup');
 // A closed application's WAL was incorporated in the snapshot and must not replay over the replacement.
 for(const suffix of ['-wal','-shm']){await f.unlink(actual+suffix).catch(e=>{if(e.code!=='ENOENT')throw e;});await vault.commit(actual+suffix,null);}
 await f.rename(temp,actual);await vault.commit(actual,await fingerprint(actual));return {saved:beforeBytes-(await f.stat(actual)).size,result};
 }finally{source?.close();db?.close();await f.unlink(temp).catch(()=>{});}
}
module.exports={edit};
