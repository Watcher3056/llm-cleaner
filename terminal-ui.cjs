'use strict';
const readline=require('node:readline');
function createUI(input=process.stdin,output=process.stdout){
 const interactive=!!(input.isTTY&&output.isTTY&&input.setRawMode),color=interactive&&!('NO_COLOR' in process.env),labels=new Map();
 const paint=(text,code)=>color?`\x1b[${code}m${text}\x1b[0m`:text;
 const safe=text=>String(text).replace(/[\x00-\x1f\x7f]/g,' ');
 const log=(...args)=>{for(const line of args.join(' ').split('\n')){
  const match=line.match(/^\s+(\d+)\.\s+(.+)$/);
  if(interactive&&match){labels.set(match[1],match[2]);continue;}
  output.write(paint(line,/^(Done:|FINAL TOTAL|Backups kept)/.test(line)?'32':/^[A-Z][A-Z ]+$/.test(line)?'1;36':'0')+'\n');
 }};
 const ask=question=>new Promise(resolve=>{const rl=readline.createInterface({input,output});rl.question(question,answer=>{rl.close();resolve(answer);});});
 if(interactive)ask.select=(question,values,defaultValue,explicit)=>new Promise((resolve,reject)=>{
  const options=values.map(value=>({value,label:safe(explicit?.[value]||labels.get(value)||value)}));labels.clear();
  let selected=Math.max(0,values.indexOf(defaultValue)),rows=0,wasRaw=!!input.isRaw;
  const width=()=>Math.max(8,(output.columns||80)-2);
  const draw=()=>{if(rows)output.write(`\x1b[${rows}A\r\x1b[J`);const lines=[safe(question).slice(0,width()),'Up/Down: move | Enter: select | Esc: back'];
   for(let i=0;i<options.length;i++)lines.push((i===selected?'> ':'  ')+options[i].label);
   output.write(lines.map((line,i)=>paint(line.slice(0,width()),i===selected+2?'1;36':i===1?'2':'0')).join('\n')+'\n');rows=lines.length;
  };
  const cleanup=()=>{input.removeListener('keypress',key);output.removeListener('resize',draw);input.setRawMode(wasRaw);input.pause();output.write('\x1b[?25h');};
  const finish=value=>{cleanup();output.write(paint('Selected: '+options.find(x=>x.value===value).label,'2')+'\n\n');resolve(value);};
  const key=(text,event={})=>{if(event.ctrl&&event.name==='c'){cleanup();reject(Error('Cancelled by user. Backups are retained.'));return;}
   if(event.name==='up')selected=(selected+options.length-1)%options.length;
   else if(event.name==='down'||event.name==='tab')selected=(selected+1)%options.length;
   else if(event.name==='home')selected=0;else if(event.name==='end')selected=options.length-1;
   else if(event.name==='return')return finish(options[selected].value);
   else if(event.name==='escape')return finish(values.includes('0')?'0':defaultValue);
   else {const i=values.indexOf(text);if(i<0)return;selected=i;}
   draw();
  };
  readline.emitKeypressEvents(input);input.setRawMode(true);input.resume();input.on('keypress',key);output.on('resize',draw);output.write('\x1b[?25l');draw();
 });
 return {ask,log};
}
module.exports={createUI};
