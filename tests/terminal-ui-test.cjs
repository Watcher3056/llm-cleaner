const {test}=require('node:test'),assert=require('node:assert/strict'),{PassThrough}=require('node:stream');
const {createUI}=require('../src/terminal-ui.cjs'),wizard=require('../src/wizard.cjs');
function terminal(){const input=new PassThrough(),output=new PassThrough();input.isTTY=output.isTTY=true;input.setRawMode=v=>{input.isRaw=v;};output.columns=80;let text='';output.on('data',b=>text+=b);return {input,output,ui:createUI(input,output),text:()=>text};}
test('arrow selection uses visible labels, Enter accepts, raw mode is restored',async()=>{
 const t=terminal();t.ui.log('  1. First\n  2. Second\n  0. Back');const pending=wizard.choice(t.ui.ask,'Action',['0','1','2']);
 t.input.emit('keypress','',{name:'down'});t.input.emit('keypress','',{name:'return'});
 assert.equal(await pending,'1');assert.equal(t.input.isRaw,false);assert.match(t.text(),/Selected: First/);assert.equal(t.input.listenerCount('keypress'),0);
});
test('Enter and Escape decline destructive actions; Down then Enter explicitly approves',async()=>{
 for(const keys of [['return'],['escape'],['down','return']]){const t=terminal(),pending=wizard.yes(t.ui.ask,'Delete backups?');for(const name of keys)t.input.emit('keypress','',{name});assert.equal(await pending,keys.length===2);}
});
test('Ctrl+C cancels and restores terminal state',async()=>{
 const t=terminal(),pending=t.ui.ask.select('Action',['0','1'],'0');t.input.emit('keypress','',{name:'c',ctrl:true});await assert.rejects(pending,/Cancelled/);assert.equal(t.input.isRaw,false);assert.equal(t.output.listenerCount('resize'),0);
});
test('multi-select toggles several applications in one step',async()=>{
 const t=terminal(),pending=t.ui.ask.multiSelect('Applications',['codex','claude','cursor'],['codex'],{codex:'Codex',claude:'Claude Code',cursor:'Cursor'});
 t.input.emit('keypress','',{name:'space'});t.input.emit('keypress','',{name:'down'});t.input.emit('keypress','',{name:'space'});t.input.emit('keypress','',{name:'down'});t.input.emit('keypress','',{name:'space'});t.input.emit('keypress','',{name:'return'});
 assert.deepEqual(await pending,['claude','cursor']);assert.equal(t.input.isRaw,false);assert.match(t.text(),/Selected: 2\/3/);
});
test('multi-select can select or clear every option',async()=>{
 for(const defaults of [[],['codex']]){const t=terminal(),pending=t.ui.ask.multiSelect('Applications',['codex','claude'],defaults);t.input.emit('keypress','a',{name:'a'});t.input.emit('keypress','',{name:'return'});assert.deepEqual(await pending,defaults.length?['codex','claude']:['codex','claude']);}
});
