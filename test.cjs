const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {analyze,writeReduced,backup}=require('./clean-subagents.cjs');
const id='11111111-1111-1111-1111-111111111111';
const meta={type:'session_meta',payload:{id,source:{subagent:{thread_spawn:{parent_thread_id:'parent'}}}}};
const cp=n=>({type:'compacted',payload:{replacement_history:[{type:'message',role:'user',content:[{type:'input_text',text:'state '+n}]}]}});
async function fixture(records,run){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'codex-prune-test-'));try{const f=path.join(dir,id+'.jsonl');fs.writeFileSync(f,records.map(x=>typeof x==='string'?x:JSON.stringify(x)).join('\r\n')+'\r\n');await run(f,dir);}finally{fs.rmSync(dir,{recursive:true,force:true});}}
test('keeps metadata, last complete checkpoint and exact tail; idempotent',async()=>fixture([meta,{type:'turn_context',payload:{turn_id:'a'}},{type:'response_item',payload:{type:'message',text:'old'}},cp(1),{type:'event_msg',payload:{type:'task_complete'}},cp(2),{type:'response_item',payload:{type:'message',text:'latest knowledge 🧠'}}],async(f,dir)=>{
 const p=await analyze(f);assert.equal(p.status,'candidate');const out=path.join(dir,id+'-reduced.jsonl');await writeReduced(p,out);
 const bytes=fs.readFileSync(out);assert(bytes.includes(Buffer.from('latest knowledge 🧠')));assert(!bytes.includes(Buffer.from('state 1')));assert.equal(bytes.length,p.keep);
 const q=await analyze(out);assert.equal(q.status,'already-minimal');assert.equal(q.saving,0);
}));
test('main chats excluded',async()=>fixture([{type:'session_meta',payload:{id}},cp(1)],async f=>assert.equal((await analyze(f)).status,'main-or-unproven')));
test('ordinary fork excluded',async()=>fixture([{type:'session_meta',payload:{id,parent_thread_id:'p',forked_from_id:'p',source:'cli'}},cp(1)],async f=>assert.equal((await analyze(f)).status,'main-or-unproven')));
test('missing or non-full last checkpoint excluded',async()=>fixture([meta,cp(1),{type:'compacted',payload:{message:'legacy'}}],async f=>assert.equal((await analyze(f)).status,'no-full-last-checkpoint')));
test('malformed JSON excluded',async()=>fixture([meta,'{"broken":',cp(1)],async f=>assert.equal((await analyze(f)).status,'invalid-json')));
test('rollback after checkpoint excluded',async()=>fixture([meta,cp(1),{type:'event_msg',payload:{type:'thread_rolled_back',num_turns:2}}],async f=>assert.equal((await analyze(f)).status,'rollback-after-checkpoint')));
test('unknown state record excluded',async()=>fixture([meta,{type:'future_state',payload:{}},cp(1)],async f=>assert.equal((await analyze(f)).status,'unknown-record-type')));
test('gzip backup round-trips exact original without changing it',async()=>fixture([meta,{type:'response_item',payload:{text:'history'}},cp(1)],async(f,dir)=>{
 const before=fs.readFileSync(f),plan=await analyze(f),dest=path.join(dir,'backup.gz');await backup(plan,dest);
 assert.deepEqual(require('node:zlib').gunzipSync(fs.readFileSync(dest)),before);assert.deepEqual(fs.readFileSync(f),before);
}));
