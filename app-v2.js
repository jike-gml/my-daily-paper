/* MY DAILY PAPER V2: local-first RSS / Atom reader */
(() => {
  'use strict';
  const DB = 'myDailyPaperLocalV2', VERSION = 1;
  const STORES = ['profiles','sources','articles','issues'];
  const $ = (s) => document.querySelector(s);
  const state = {profileId:'', tab:'today', section:'すべて', query:'', articles:[], issues:[], sources:[], profiles:[], busy:false, errors:[], lastRun:null};
  const $id = (id) => document.getElementById(id);
  const mk = (tag, cls, value) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (value !== undefined && value !== null) el.textContent = String(value);
    return el;
  };
  const randomId = () => crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + '-' + Math.random().toString(36).slice(2);
  const today = () => {
    const d=new Date();
    return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
  };
  const escapeDate = (v) => {
    const d = new Date(v);
    return !v || Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat('ja-JP',{month:'numeric',day:'numeric'}).format(d);
  };
  const short = (s, length=350) => String(s || '').replace(/\s+/g,' ').trim().slice(0,length);
  const errorMessage = (e) => String(e && e.message || e || '不明なエラー').slice(0,180);

  function openDB() {
    return new Promise((resolve,reject) => {
      const req = indexedDB.open(DB,VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for(const name of STORES) if(!db.objectStoreNames.contains(name)) db.createObjectStore(name,{keyPath:'id'});
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function storeAction(store, mode, worker) {
    const db = await openDB();
    return new Promise((resolve,reject) => {
      const tx = db.transaction(store,mode), os=tx.objectStore(store);
      let result;
      try{ result = worker(os); }catch(e){db.close();reject(e);return;}
      if(result && typeof result.onsuccess !== 'undefined') result.onsuccess = () => {result = result.result;};
      tx.oncomplete = () => {db.close();resolve(result);};
      tx.onerror = () => {db.close();reject(tx.error);};
      tx.onabort = () => {db.close();reject(tx.error || Error('データ保存が中断されました'));};
    });
  }
  const all = (store) => storeAction(store,'readonly',os=>os.getAll());
  const put = (store,data) => storeAction(store,'readwrite',os=>os.put(data));
  const del = (store,id) => storeAction(store,'readwrite',os=>os.delete(id));
  const currentProfile = () => state.profiles.find(p=>p.id===state.profileId);
  function flash(message) {
    const t=$id('toast'); t.textContent=message; t.classList.add('show');
    clearTimeout(flash.timer); flash.timer=setTimeout(()=>t.classList.remove('show'),3500);
  }
  function normalizedURL(link) {
    try{
      const u=new URL(link);
      if(u.protocol!=='https:' && u.protocol!=='http:') return '';
      u.hash='';
      for(const k of [...u.searchParams.keys()]) if(/^utm_|^(fbclid|gclid|mc_cid|mc_eid)$/i.test(k)) u.searchParams.delete(k);
      return u.href.replace(/\/$/,'');
    }catch(_){return '';}
  }
  function hash(s) {
    let n=2166136261;
    for(let i=0;i<s.length;i++){n^=s.charCodeAt(i);n=Math.imul(n,16777619);}
    return (n>>>0).toString(36);
  }
  function nodeText(parent, tags) {
    for(const name of tags) {
      const node=Array.from(parent.getElementsByTagName('*')).find(e=>e.localName===name || e.tagName.toLowerCase()===name.toLowerCase());
      if(node && node.textContent) return node.textContent.trim();
    }
    return '';
  }
  function cleanHTML(s) {
    const doc=new DOMParser().parseFromString(String(s||''),'text/html');
    doc.querySelectorAll('script,style,noscript,iframe').forEach(n=>n.remove());
    return short(doc.body?.textContent||'',500);
  }
  function parseFeed(xml,src) {
    const doc=new DOMParser().parseFromString(String(xml),'application/xml');
    if(doc.getElementsByTagName('parsererror').length) throw Error('RSS/Atomの解析に失敗');
    const root=doc.documentElement, isAtom=root.localName==='feed';
    const entries=Array.from(doc.getElementsByTagName('*')).filter(n=>n.localName===(isAtom?'entry':'item'));
    if(!entries.length) throw Error('記事を含むRSS/Atomが見つかりません');
    return entries.slice(0,60).map(n=>{
      const title=short(nodeText(n,['title']),230);
      let link='';
      if(isAtom) {
        const links=Array.from(n.children).filter(e=>e.localName==='link');
        const item=links.find(e=>!e.getAttribute('rel')||e.getAttribute('rel')==='alternate')||links[0];
        link=item?.getAttribute('href')||'';
      }else link=nodeText(n,['link']);
      const url=normalizedURL(link);
      const summary=cleanHTML(nodeText(n,['description','summary','encoded','content']));
      const dateValue=nodeText(n,['pubDate','published','updated','date']);
      const date=dateValue?new Date(dateValue):new Date(NaN);
      return {id:hash(src.profileId+'|'+url),profileId:src.profileId,sourceId:src.id,sourceName:src.name,
        section:src.section||'ニュース',title,url,summary,
        publishedAt:Number.isNaN(date.getTime())?'':date.toISOString(),
        fetchedAt:new Date().toISOString(),read:false,saved:false};
    }).filter(a=>a.url&&a.title);
  }
  function matchesKeywords(article, profile) {
    const haystack=(article.title+' '+article.summary).toLocaleLowerCase();
    const split=(s)=>String(s||'').split(/[,、\n]/).map(x=>x.trim().toLocaleLowerCase()).filter(Boolean);
    const inc=split(profile.include),exc=split(profile.exclude);
    return (!inc.length || inc.some(t=>haystack.includes(t))) && !exc.some(t=>haystack.includes(t));
  }
  async function retrieveFeed(url) {
    // CapacitorHttp's native fetch patch is enabled only in Android's capacitor config.
    // Browser/PWA fetch remains subject to the feed provider's CORS policy.
    // Never proxy personal feed URLs through GitHub.
    const ctrl = new AbortController(), timeout = setTimeout(() => ctrl.abort(), 16000);
    try {
      const res = await fetch(url, {
        signal:ctrl.signal,cache:'no-store',credentials:'omit',
        headers:{Accept:'application/rss+xml, application/atom+xml, application/xml, text/xml, */*'}
      });
      if(!res.ok) throw Error('HTTP '+res.status);
      const size=Number(res.headers.get('content-length')||0);
      if(size>3*1024*1024) throw Error('RSSの容量が上限を超えています');
      const xml=await res.text();
      if(xml.length>3*1024*1024)throw Error('RSSの容量が上限を超えています');
      return xml;
    } finally {clearTimeout(timeout);}
  }
  async function refreshData() {
    if(state.busy)return;
    if(!state.profileId)return;
    const profile=currentProfile();
    const sources=state.sources.filter(s=>s.profileId===state.profileId && s.enabled!==false);
    if(!sources.length){flash('設定から公式RSS/Atomの情報源を追加してください');openSettings();return;}
    state.busy=true;state.errors=[];setStatus('収集中…','wait');render();
    let added=0,success=0;
    let old;
    try {old=await all('articles');}
    catch(e){state.busy=false;setStatus('保存領域エラー','bad');flash(errorMessage(e));return;}
    const byId=new Map(old.map(a=>[a.id,a]));
    for(const source of sources) {
      try {
        const xml=await retrieveFeed(source.url);
        const parsed=parseFeed(xml,source).filter(a=>matchesKeywords(a,profile));
        for(const item of parsed) {
          const previous=byId.get(item.id);
          if(previous){item.read=!!previous.read;item.saved=!!previous.saved;}
          else added++;
          byId.set(item.id,item);
          await put('articles',item);
        }
        success++;
      }catch(e){state.errors.push(source.name+'：'+errorMessage(e));}
    }
    if(success) {
      const complete = {id:'lastRun:'+state.profileId,time:new Date().toISOString(),success,errors:state.errors};
      localStorage.setItem('mdpV2LastRun:'+state.profileId,JSON.stringify(complete));
      state.lastRun=complete;
      const current=[...byId.values()].filter(a=>a.profileId===state.profileId);
      current.sort((a,b)=>(b.publishedAt||b.fetchedAt).localeCompare(a.publishedAt||a.fetchedAt));
      for(const excess of current.slice(500)) if(!excess.saved) await del('articles',excess.id);
      flash(added+'件の新着記事 / '+success+'件の情報源から取得');
    }else{
      flash('収集に失敗しました。保存済みの記事は維持しています。');
    }
    state.busy=false;
    await reload();
  }
  function setStatus(s,kind) {
    $id('statusText').textContent=s;
    $id('statusDot').className='dot'+(kind?' '+kind:'');
  }
  async function reload() {
    const results=await Promise.all([all('profiles'),all('sources'),all('articles'),all('issues')]);
    state.profiles=results[0];state.sources=results[1];
    state.articles=results[2].filter(x=>x.profileId===state.profileId);
    state.issues=results[3].filter(x=>x.profileId===state.profileId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
    try{state.lastRun=JSON.parse(localStorage.getItem('mdpV2LastRun:'+state.profileId)||'null');}catch(_){state.lastRun=null;}
    render();
  }
  function dateSort(a,b) {
    return (b.publishedAt||b.fetchedAt||'').localeCompare(a.publishedAt||a.fetchedAt||'');
  }
  function getVisible() {
    const profile=currentProfile()||{};
    let list=state.articles.filter(a=>state.tab==='saved'?a.saved:true);
    if(state.section!=='すべて')list=list.filter(a=>a.section===state.section);
    if(state.query.trim()) {
      const q=state.query.toLocaleLowerCase().trim();
      list=list.filter(a=>(a.title+' '+a.summary+' '+a.sourceName).toLocaleLowerCase().includes(q));
    }
    list.sort(dateSort);
    if(profile.sort==='priority'){
      const score=(a)=>{
        const age=(Date.now()-new Date(a.publishedAt||a.fetchedAt).getTime())/86400000;
        const freshness=Math.max(0,5-Math.max(0,age));
        return freshness+(a.saved?2:0)+(!a.read?1:0);
      };
      list.sort((a,b)=>score(b)-score(a)||dateSort(a,b));
    }
    return list;
  }
  function articleCard(a,top=false) {
    const node=mk(top?'section':'article',top?'headline':'story');
    const label=mk('div','eyebrow',a.section+' / '+(top?'TOP STORY':'OFFICIAL SOURCE'));
    const headline=mk(top?'h3':'h3');
    const articleUrl=normalizedURL(a.url);
    const link=mk(articleUrl?'a':'span','',a.title);
    if(articleUrl){link.href=articleUrl;link.target='_blank';link.rel='noopener noreferrer';}
    if(articleUrl) link.addEventListener('click',()=>{a.read=true;put('articles',a).catch(console.warn);});
    headline.append(link);
    node.append(label,headline);
    if(a.summary) node.append(mk('p','',a.summary));
    const meta=mk('div','meta');
    meta.append(mk('span','',a.sourceName),mk('span','',''),mk('span','',escapeDate(a.publishedAt)||'日付不明'));
    const footer=mk('div','story-footer');
    const star=mk('button','star'+(a.saved?' saved':''),a.saved?'★':'☆');
    star.type='button';star.setAttribute('aria-label',a.saved?'保存を解除':'記事を保存');
    star.addEventListener('click',async()=>{
      a.saved=!a.saved;await put('articles',a);render();
    });
    footer.append(meta,star);node.append(footer);
    return node;
  }
  function emptyState(title,desc,buttonLabel,fn) {
    const box=mk('div','empty');
    box.append(mk('div','symbol','◇'),mk('h3','',title),mk('p','',desc));
    if(buttonLabel){const b=mk('button','action subtle',buttonLabel);b.onclick=fn;box.append(b);}
    return box;
  }
  function renderHome() {
    const area=$id('content');area.replaceChildren();
    const header=mk('div','section-header'),stack=mk('div');
    stack.append(mk('div','eyebrow',state.tab==='saved'?'YOUR READING LIST':'PERSONAL EDITION'),
      mk('h2','',state.tab==='saved'?'保存した記事':'今日の紙面'),
      mk('p','hint',state.tab==='saved'?'あとで読む記事を端末内に保存':'公式情報から、あなたの関心だけを集める'));
    header.append(stack);
    const issue=mk('button','action subtle small','この紙面を保存');
    issue.onclick=saveIssue; if(state.tab==='saved')issue.hidden=true;
    header.append(issue);area.append(header);
    const numbers=mk('div','quick-metrics');
    const unread=state.articles.filter(a=>!a.read).length;
    for(const [name,value] of [['収集記事',state.articles.length],['未読',unread],['保存',state.articles.filter(a=>a.saved).length]]) {
      const item=mk('div','metric');
      item.append(mk('strong','',value),mk('span','',name));numbers.append(item);
    }
    area.append(numbers);
    if(state.errors.length){
      const note=mk('div','notice error');
      note.append(mk('strong','',state.errors.length+'件の取得エラー'),mk('div','',state.errors.join(' / ')));
      if(!window.Capacitor?.isNativePlatform?.())note.append(mk('div','hint','ブラウザ版は情報源のCORS制限で取得できない場合があります。Androidアプリ版はネイティブ通信に対応します。'));
      area.append(note);
    }
    const tools=mk('div','tools'),search=mk('input','search');
    search.placeholder='見出し・キーワードで探す';search.type='search';search.value=state.query;
    search.oninput=()=>{state.query=search.value;renderHomeArticles();};
    tools.append(search);area.append(tools);
    const pills=mk('div','pills');pills.id='sectionPills';area.append(pills);
    const results=mk('div','');results.id='articleResults';area.append(results);
    renderHomeArticles();
  }
  function renderHomeArticles() {
    const pills=$id('sectionPills'),area=$id('articleResults');
    if(!pills||!area)return;
    pills.replaceChildren();area.replaceChildren();
    const tags=['すべて',...new Set(state.articles.map(a=>a.section).filter(Boolean))];
    if(!tags.includes(state.section)) state.section='すべて';
    for(const tag of tags) {
      const b=mk('button',tag===state.section?'active':'',tag);
      b.onclick=()=>{state.section=tag;renderHomeArticles();};pills.append(b);
    }
    const list=getVisible();
    if(!list.length){
      const missing=state.tab==='saved';
      area.append(emptyState(missing?'保存した記事はありません':'まだ記事がありません',
        missing?'記事の☆を押すとここに保存できます':'設定からRSSを登録し、「情報を更新」を押してください',
        missing?null:'情報源を設定',openSettings));
      return;
    }
    if(state.tab==='today' && state.section==='すべて' && !state.query)area.append(articleCard(list.shift(),true));
    const grid=mk('div','story-list');
    for(const item of list)grid.append(articleCard(item));
    area.append(grid);
    area.append(mk('p','hint','表示：'+(grid.childElementCount+(area.querySelector('.headline')?1:0))+'件 / 端末保存：'+state.articles.length+'件'));
  }
  function renderArchive() {
    const area=$id('content');area.replaceChildren();
    const head=mk('div','section-header'),left=mk('div');
    left.append(mk('div','eyebrow','YOUR ARCHIVE'),mk('h2','','過去の新聞'),mk('p','hint','端末に保存した紙面を日付ごとに読む'));
    head.append(left);area.append(head);
    if(!state.issues.length){area.append(emptyState('まだ過去号がありません','「この紙面を保存」を押すと、この端末に残ります','今日の紙面へ',()=>switchTab('today')));return;}
    for(const issue of state.issues) {
      const card=mk('div','edition'),left=mk('div');
      left.append(mk('strong','',issue.title||issue.date),mk('div','hint',(issue.items||[]).length+'記事 / '+escapeDate(issue.createdAt)));
      const open=mk('button','action subtle small','開く');open.onclick=()=>showIssue(issue);
      card.append(left,open);area.append(card);
    }
  }
  function showIssue(issue) {
    const area=$id('content');area.replaceChildren();
    const back=mk('button','action subtle small','← 過去号一覧へ');back.onclick=renderArchive;area.append(back);
    const title=mk('div','section-header');title.append(mk('h2','',issue.title||issue.date));area.append(title);
    const grid=mk('div','story-list');
    for(const a of issue.items||[])grid.append(articleCard(a));
    area.append(grid);
  }
  async function saveIssue() {
    const items=getVisible().slice(0,40).map(a=>({...a}));
    if(!items.length){flash('保存する記事がありません');return;}
    const date=today(), title=currentProfile()?.name+' / '+date;
    await put('issues',{id:state.profileId+'|'+date,profileId:state.profileId,date,title,items,createdAt:new Date().toISOString()});
    await reload();flash('今日の紙面を端末に保存しました');
  }
  function render() {
    const select=$id('profileSelect');
    select.replaceChildren();
    for(const p of state.profiles) {
      const opt=mk('option','',p.name);opt.value=p.id;select.append(opt);
    }
    select.value=state.profileId;
    $id('displayDate').textContent=new Intl.DateTimeFormat('ja-JP',{year:'numeric',month:'long',day:'numeric',weekday:'long'}).format(new Date());
    $id('refreshBtn').disabled=state.busy;
    const tabs=document.querySelectorAll('[data-tab]');
    tabs.forEach(b=>{const active=b.dataset.tab===state.tab;b.classList.toggle('selected',active);b.setAttribute('aria-current',active?'page':'false');});
    if(state.busy)setStatus('収集中…','wait');
    else if(state.lastRun){
      const count=state.lastRun.success||0;
      setStatus('最終収集 '+new Date(state.lastRun.time).toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})+' / '+count+'情報源',count?'':'bad');
    }else setStatus('この端末ではまだ収集していません','wait');
    if(state.tab==='history')renderArchive();else renderHome();
  }
  function switchTab(tab) {
    state.tab=tab;state.section='すべて';state.query='';
    render();window.scrollTo({top:0,behavior:'smooth'});
  }
  function populateSettings() {
    const p=currentProfile();
    if(!p)return;
    $id('profileName').value=p.name;
    $id('includeWords').value=p.include||'';
    $id('excludeWords').value=p.exclude||'';
    $id('sortOrder').value=p.sort||'latest';
    $id('autoCollect').checked=p.autoCollect!==false;
    const list=$id('sourceList');list.replaceChildren();
    const sources=state.sources.filter(x=>x.profileId===state.profileId);
    if(!sources.length)list.append(mk('p','hint','情報源はまだありません。下のフォームで公式RSS/Atomを登録します。'));
    for(const s of sources) {
      const row=mk('div','source-row'),info=mk('div');
      info.append(mk('strong','',s.name+' / '+s.section),mk('small','',s.url));
      const remove=mk('button','','削除');remove.onclick=async()=>{
        if(!confirm('この情報源を削除しますか？ すでに保存した記事は残ります。'))return;
        await del('sources',s.id);await reload();populateSettings();
      };
      row.append(info,remove);list.append(row);
    }
  }
  function openSettings() {populateSettings();$id('settingsDialog').showModal();}
  async function saveProfile() {
    const p=currentProfile();if(!p)return;
    const name=$id('profileName').value.trim();
    if(!name){flash('紙面名を入力してください');return;}
    Object.assign(p,{name:name.slice(0,70),include:$id('includeWords').value.slice(0,800),
      exclude:$id('excludeWords').value.slice(0,800),sort:$id('sortOrder').value,autoCollect:$id('autoCollect').checked});
    await put('profiles',p);await reload();flash('設定を端末に保存しました');
  }
  async function addProfile() {
    const name=prompt('新しい紙面の名前を入力してください（例：AIニュース）');
    if(!name?.trim())return;
    const p={id:randomId(),name:name.trim().slice(0,70),include:'',exclude:'',sort:'latest',autoCollect:true,createdAt:new Date().toISOString()};
    await put('profiles',p);state.profileId=p.id;localStorage.setItem('mdpV2ActiveProfile',p.id);
    state.section='すべて';state.query='';await reload();populateSettings();flash('新しい紙面を作成しました');
  }
  async function addSource() {
    const name=$id('sourceName').value.trim(),url=$id('sourceURL').value.trim(),section=$id('sourceSection').value.trim()||'ニュース';
    let safe;
    try{safe=new URL(url);if(safe.protocol!=='https:')throw Error('httpsのみ');}catch(_){flash('正しいhttpsのRSS/Atom URLを入力してください');return;}
    if(!name){flash('情報源の名前を入力してください');return;}
    const s={id:randomId(),profileId:state.profileId,name:name.slice(0,100),url:safe.href,section:section.slice(0,50),enabled:true};
    await put('sources',s);$id('sourceName').value='';$id('sourceURL').value='';
    await reload();populateSettings();flash('情報源をこの端末に追加しました');
  }
  async function exportBackup() {
    const pack={type:'MY_DAILY_PAPER_LOCAL_V2',exportedAt:new Date().toISOString(),
      profiles:await all('profiles'),sources:await all('sources'),articles:await all('articles'),issues:await all('issues')};
    const url=URL.createObjectURL(new Blob([JSON.stringify(pack,null,2)],{type:'application/json'}));
    const a=mk('a');a.href=url;a.download='my-daily-paper-backup-'+today()+'.json';a.click();
    setTimeout(()=>URL.revokeObjectURL(url),5000);flash('端末へバックアップを書き出しました');
  }
  async function importBackup(file) {
    if(!file || file.size>12*1024*1024){flash('12MB以下のバックアップを選んでください');return;}
    let data;try{data=JSON.parse(await file.text());}catch(_){flash('JSONを読み取れません');return;}
    if(data.type!=='MY_DAILY_PAPER_LOCAL_V2' || !Array.isArray(data.profiles) || !Array.isArray(data.sources)){
      flash('MY DAILY PAPERのバックアップではありません');return;
    }
    if(!confirm('端末のデータにバックアップの内容を追加・上書きしますか？'))return;
    for(const kind of STORES)for(const item of (Array.isArray(data[kind])?data[kind]:[])){
      if(!item || typeof item.id!=='string')continue;
      if(kind==='sources' && !/^https:\/\//i.test(String(item.url||'')))continue;
      if(kind==='articles' && !/^https?:\/\//i.test(String(item.url||'')))continue;
      await put(kind,item);
    }
    await reload();flash('端末バックアップを読み込みました');
  }
  async function init() {
    let profiles=await all('profiles');
    if(!profiles.length) {
      const p={id:randomId(),name:'マイ新聞',include:'',exclude:'',sort:'latest',autoCollect:true,createdAt:new Date().toISOString()};
      await put('profiles',p);profiles=[p];
    }
    const saved=localStorage.getItem('mdpV2ActiveProfile');
    state.profileId=profiles.some(p=>p.id===saved)?saved:profiles[0].id;
    await reload();
    $id('profileSelect').onchange=async(e)=>{
      state.profileId=e.target.value;localStorage.setItem('mdpV2ActiveProfile',state.profileId);
      state.section='すべて';state.query='';state.errors=[];await reload();
    };
    $id('refreshBtn').onclick=()=>refreshData().catch(e=>{state.busy=false;setStatus('取得エラー','bad');flash(errorMessage(e));});
    $id('settingsBtn').onclick=openSettings;
    $id('closeSettings').onclick=()=>$id('settingsDialog').close();
    $id('saveProfileBtn').onclick=()=>saveProfile().catch(e=>flash(errorMessage(e)));
    $id('newProfileBtn').onclick=()=>addProfile().catch(e=>flash(errorMessage(e)));
    $id('addSourceBtn').onclick=()=>addSource().catch(e=>flash(errorMessage(e)));
    $id('exportBtn').onclick=()=>exportBackup().catch(e=>flash(errorMessage(e)));
    $id('importFile').onchange=(e)=>{importBackup(e.target.files[0]).catch(err=>flash(errorMessage(err)));e.target.value='';};
    $id('printBtn').onclick=()=>window.print();
    document.addEventListener('visibilitychange',()=>{
      if(!document.hidden && !state.busy && currentProfile()?.autoCollect &&
        state.sources.some(s=>s.profileId===state.profileId)) {
        const age=state.lastRun?.time?Date.now()-new Date(state.lastRun.time).getTime():Infinity;
        if(age>6*3600000)refreshData().catch(console.warn);
      }
    });
    document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));
    const profile=currentProfile();
    const run=state.lastRun?.time?Date.now()-new Date(state.lastRun.time).getTime():Infinity;
    if(profile?.autoCollect && state.sources.some(s=>s.profileId===state.profileId) && run>6*3600*1000)refreshData().catch(console.error);
    if('serviceWorker' in navigator && location.protocol==='https:')navigator.serviceWorker.register('./service-worker-v2.js').catch(console.warn);
  }
  init().catch(e=>{setStatus('保存領域を利用できません','bad');flash(errorMessage(e));});
})();