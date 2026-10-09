const CACHE_NAME='mdp-local-v2-shell-20261009';
const SHELL=['./reader.html','./app.css','./app-v2.js','./manifest-v2.json','./icon.svg','./icon-maskable.svg'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(SHELL)));self.skipWaiting();});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(names=>Promise.all(names.filter(name=>name.startsWith('mdp-local-v2-shell-')&&name!==CACHE_NAME).map(name=>caches.delete(name)))));self.clients.claim();});
self.addEventListener('fetch',event=>{
 const request=event.request;
 if(request.method!=='GET'||new URL(request.url).origin!==self.location.origin)return;
 const path=new URL(request.url).pathname;
 if(!SHELL.some(s=>path.endsWith(s.replace('./',''))))return;
 event.respondWith(fetch(request).then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE_NAME).then(cache=>cache.put(request,copy));}return response;}).catch(()=>caches.match(request)));
});
