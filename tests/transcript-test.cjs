const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const api=require('../src/transcripts.cjs'),processes=require('../src/process-control.cjs');
async function temp(fn){const root=fs.mkdtempSync(path.join(os.tmpdir(),'transcript-test-'));try{await fn(root);}finally{if(!path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep+'transcript-test-'))throw Error('Unsafe cleanup');fs.rmSync(root,{recursive:true,force:true});}}
const session='11111111-1111-4111-8111-111111111111';
function claude(kind='simple'){
 const row=(uuid,type,parentUuid,text,extra={})=>({uuid,type,parentUuid,sessionId:session,timestamp:'2026-01-01T00:00:00Z',message:{role:type,content:text},...extra});
 const preserved=kind==='messages'?{preservedMessages:{uuids:['p1','p2'],anchorUuid:'summary'}}:kind==='segment'?{preservedSegment:{headUuid:'p1',tailUuid:'p2',anchorUuid:'summary'}}:{};
 return [row('old','user',null,'old '.repeat(10000)),row('p1','user','old','preserved prompt'),row('p2','assistant','p1','preserved answer'),row('boundary','system',null,undefined,{subtype:'compact_boundary',compactMetadata:preserved}),row('summary','user','boundary','Latest compacted knowledge',{isCompactSummary:true}),row('tail','assistant','summary','Continuation'),{type:'custom-title',customTitle:'Preserved title',sessionId:session}];
}
function write(file,rows){fs.writeFileSync(file,rows.map(JSON.stringify).join('\n')+'\n');}
for(const kind of ['simple','messages','segment'])test('Claude checkpoint '+kind+' retains summary, tail and required references',async()=>temp(async dir=>{
 const f=path.join(dir,'original.jsonl'),out=path.join(dir,'reduced.jsonl');write(f,claude(kind));const p=await api.claudePlan(f);assert.equal(p.status,'candidate');await api.writePlan(p,out);
 const rows=(await api.records(out)).map(r=>r.x);assert(rows.some(x=>x.uuid==='summary'));assert(rows.some(x=>x.uuid==='tail'));assert(rows.some(x=>x.customTitle==='Preserved title'));assert(!rows.some(x=>x.uuid==='old'));
 assert.equal(rows.some(x=>x.uuid==='p1'),kind!=='simple');assert.equal((await api.claudePlan(out)).status,'already-minimal');
 if(process.env.CLAUDE_SDK_PATH){const sdk=await import(require('node:url').pathToFileURL(process.env.CLAUDE_SDK_PATH));const read=rows=>sdk.getSessionMessages(session,{sessionStore:{load:async()=>rows},includeSystemMessages:true});assert.deepEqual(await read(rows),await read((await api.records(f)).map(r=>r.x)));}
}));
test('Claude missing summary, checkpoint or referenced message cannot be pruned',async()=>temp(async dir=>{
 const f=path.join(dir,'f.jsonl');write(f,claude().filter(x=>x.uuid!=='summary'));assert.equal((await api.claudePlan(f)).status,'missing-summary');
 write(f,claude().filter(x=>x.uuid!=='boundary'));assert.equal((await api.claudePlan(f)).status,'no-checkpoint');
 write(f,claude('messages').filter(x=>x.uuid!=='p1'));await assert.rejects(api.claudePlan(f),/Missing preserved message/);
 fs.writeFileSync(f,'invalid json');await assert.rejects(api.claudePlan(f),/Malformed/);
}));
test('Gemini updates and rewinds preserve state, original first prompt and scratchpad freshness',async()=>temp(async dir=>{
 const f=path.join(dir,'f.jsonl'),out=path.join(dir,'out.jsonl');const rows=[{sessionId:session,projectHash:'project'},
 {id:'a',type:'user',content:'original prompt'}, {id:'a',type:'user',content:'intermediate'.repeat(10000)}, {id:'a',type:'user',content:'final prompt'},
 {$set:{memoryScratchpad:'knowledge'}},{id:'b',type:'gemini',content:'v1'},{id:'b',type:'gemini',content:'v2'},{id:'b',type:'gemini',content:'v3'},
 {$rewindTo:'b'},{id:'b',type:'gemini',content:'replacement'},{$set:{summary:'session title'}}];
 write(f,rows);const p=await api.geminiPlan(f);assert(p.saving>100000);await api.writePlan(p,out);assert.deepEqual(api.geminiState(await api.records(f)),api.geminiState(await api.records(out)));assert.equal((await api.geminiPlan(out)).status,'already-minimal');
}));
test('Gemini unknown records are rejected',async()=>temp(async dir=>{const f=path.join(dir,'f.jsonl');write(f,[{sessionId:session,projectHash:'p'},{$futureOperation:'unknown'}]);await assert.rejects(api.geminiPlan(f),/Unknown/);}));
test('Gemini actual atomic replacement, backup and permissions',async t=>{
 try{processes.assertStopped('gemini');}catch{t.skip('Gemini running');return;}
 await temp(async dir=>{const root=path.join(dir,'root'),back=path.join(dir,'backup');fs.mkdirSync(root);fs.mkdirSync(back);const f=path.join(root,'f.jsonl');write(f,[{sessionId:session,projectHash:'p'},...['first','intermediate'.repeat(10000),'last'].map(content=>({id:'a',type:'user',content}))]);const original=fs.readFileSync(f);const p=await api.geminiPlan(f);assert.equal(await api.apply(p,root,back),p.saving);assert.equal((await api.geminiPlan(f)).status,'already-minimal');assert.deepEqual(require('node:zlib').gunzipSync(fs.readFileSync(path.join(back,'f.jsonl.gz'))),original);});
});
test('Claude actual atomic replacement and exact backup',async t=>{
 try{processes.assertStopped('claude');}catch{t.skip('Claude running');return;}
 await temp(async dir=>{const root=path.join(dir,'root'),back=path.join(dir,'backup');fs.mkdirSync(root);fs.mkdirSync(back);const f=path.join(root,'f.jsonl');write(f,claude('messages'));const original=fs.readFileSync(f);const p=await api.claudePlan(f);assert.equal(await api.apply(p,root,back),p.saving);assert.equal((await api.claudePlan(f)).status,'already-minimal');assert.deepEqual(require('node:zlib').gunzipSync(fs.readFileSync(path.join(back,'f.jsonl.gz'))),original);});
});
test('process classifier recognizes five apps without matching generic Node',()=>{
 for(const app of processes.apps)assert.equal(processes.classify(app+'.exe'),app);
 assert.equal(processes.classify('node','node /opt/node_modules/@google/gemini-cli/bundle/gemini.js'),'gemini');assert.equal(processes.classify('node','node my-gemini-cleaner.js'),null);
 assert.equal(processes.classify('ChatGPT.exe'),'codex');assert.equal(processes.classify('Cursor Helper'),'cursor');
});
test('application closure requires separate consent for force and excludes cleaner ancestors',async()=>{
 let running=[{pid:123,app:'gemini',start:'test',protected:false}],calls=[];
 const backend={list:()=>running,signal:(p,force)=>{calls.push(force);if(force)running=[];},wait:async()=>{}};
 assert.equal(await processes.ensureStopped('gemini',async()=>'',()=>{},backend),false);assert.deepEqual(calls,[]);
 let answers=['CLOSE GEMINI',''];assert.equal(await processes.ensureStopped('gemini',async()=>answers.shift(),()=>{},backend),false);assert.deepEqual(calls,[false]);
 answers=['CLOSE GEMINI','FORCE CLOSE GEMINI'];assert.equal(await processes.ensureStopped('gemini',async()=>answers.shift(),()=>{},backend),true);assert.deepEqual(calls,[false,false,true]);
 running=[{pid:123,app:'gemini',protected:true}];assert.equal(await processes.ensureStopped('gemini',async()=>{throw Error('Must not offer killing own host');},()=>{},backend),false);
});
module.exports={claude};
