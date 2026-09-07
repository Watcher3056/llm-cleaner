'use strict';
async function pool(items,limit,work,onProgress=()=>{}){let next=0,done=0,failed=false;const results=[],errors=[];
 await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(!failed){const i=next++;if(i>=items.length)return;try{results[i]=await work(items[i],i);done++;onProgress(done,items.length);}catch(e){errors.push(e);failed=true;}}}));
 // In-flight work is always awaited before reporting failure or offering restore.
 return {results,errors};
}
module.exports={pool};
