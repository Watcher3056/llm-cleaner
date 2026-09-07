'use strict';
async function askFriendly(question,ask){
 const token=question.match(/Type ((?:FORCE CLOSE|CLOSE|CLEAN|COMPRESS) [A-Z]+)/)?.[1];
 if(!token)return ask(question);
 const prompt=token.startsWith('FORCE CLOSE')?'Force-close the application? Unsaved work may be lost.':token.startsWith('CLOSE')?'Close the application? Save your work first.':token.startsWith('COMPRESS')?'Enable lossless NTFS compression?':'Apply cleanup with verified backups?';
 return ['yes','y'].includes((await ask(prompt+' [y/N]: ')).trim().toLowerCase())?token:'';
}
module.exports={askFriendly};
