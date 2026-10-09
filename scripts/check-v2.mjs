import {readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const tests=[];
function test(name,fn){try{fn();tests.push([name,true]);}catch(e){tests.push([name,false,e.message]);}}
const root=process.cwd();
const js=readFileSync('app-v2.js','utf8');
const html=readFileSync('reader.html','utf8');
const css=readFileSync('app.css','utf8');
const manifest=JSON.parse(readFileSync('manifest-v2.json','utf8'));
const config=JSON.parse(readFileSync('capacitor.config.json','utf8'));
test('JavaScript syntax',()=>execFileSync(process.execPath,['--check','app-v2.js']));
test('Service worker syntax',()=>execFileSync(process.execPath,['--check','service-worker-v2.js']));
test('All referenced DOM IDs exist',()=>{
 const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]));
 const refs=[...js.matchAll(/\$id\('([^']+)'\)/g)].map(x=>x[1]);
 const dynamic=new Set(['articleResults','sectionPills']);
 const missing=[...new Set(refs)].filter(id=>!ids.has(id)&&!dynamic.has(id));
 if(missing.length)throw Error('Missing IDs: '+missing.join(', '));
});
test('No server-side news.json calls',()=>{if(/news\.json|fetch-news\.yml/.test(js))throw Error('Unexpected legacy fetch');});
test('No GitHub writes',()=>{if(/api\.github\.com|github\.com\/repos|git push/.test(js))throw Error('Unexpected Github integration');});
test('Device-local persistence',()=>{if(!js.includes('indexedDB.open')||!js.includes("put('articles'")||!js.includes("put('issues'"))throw Error('Storage missing');});
test('Mobile layout + print CSS',()=>{if(!css.includes('@media(max-width:600px)')||!css.includes('@media print'))throw Error('CSS missing');});
test('PWA entry exists',()=>{if(manifest.start_url!=='./reader.html')throw Error('Incorrect PWA start URL');});
test('Native HTTP enabled',()=>{if(config.plugins?.CapacitorHttp?.enabled!==true)throw Error('Native HTTP disabled');});
test('Local backup supported',()=>{if(!js.includes('exportBackup')||!js.includes('importBackup'))throw Error('Backup unavailable');});
for(const [name,ok,detail] of tests)console.log((ok?'PASS':'FAIL')+' '+name+(detail?' — '+detail:''));
if(tests.some(x=>!x[1]))process.exitCode=1;
