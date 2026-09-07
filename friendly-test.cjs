const {test}=require('node:test'),assert=require('node:assert/strict');
const {askFriendly}=require('./friendly-prompts.cjs');
test('friendly confirmations require explicit yes, including separate forced closure',async()=>{
 for(const action of ['CLEAN','CLOSE','COMPRESS','FORCE CLOSE']){
  const q=action==='FORCE CLOSE'?'Type FORCE CLOSE CODEX to terminate them: ':`Type ${action} CODEX: `;
  for(const no of ['','no','maybe','1'])assert.equal(await askFriendly(q,async()=>no),'');
  let shown='';assert.equal(await askFriendly(q,async text=>{shown=text;return 'Yes';}),action+' CODEX');
  if(action==='FORCE CLOSE')assert(shown.includes('Unsaved work'));
 }
});
test('wizard selection retries invalid values',async()=>{const answers=['wrong','7','1'];assert.equal(await require('./wizard.cjs').choice(async()=>answers.shift(),'Choose',['0','1']), '1');});
