import {mkdir,copyFile} from 'node:fs/promises';
const files=['reader.html','app.css','app-v2.js','manifest-v2.json','icon.svg','icon-maskable.svg'];
await mkdir('www',{recursive:true});
for(const file of files)await copyFile(file,'www/'+file);
console.log('Prepared offline-capable mobile assets in www/');
