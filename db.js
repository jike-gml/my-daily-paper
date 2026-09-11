(() => {
  const DB_NAME = 'myDailyPaperDB';
  const DB_VERSION = 1;
  const SETTINGS_STORE = 'settings';
  const ISSUES_STORE = 'issues';

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
          db.createObjectStore(SETTINGS_STORE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(ISSUES_STORE)) {
          const store = db.createObjectStore(ISSUES_STORE, { keyPath: 'id' });
          store.createIndex('savedAt', 'savedAt');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function put(storeName, value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(value);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }

  async function getAll(storeName) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => { db.close(); resolve(req.result || []); };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  }

  function localDateId(dateLike) {
    const d = dateLike ? new Date(dateLike) : new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function collectArticles() {
    const items = [];
    const top = document.querySelector('.top-story');
    if (top) {
      items.push({
        type: 'top',
        genre: top.dataset.genre || '',
        title: top.querySelector('h2')?.textContent.trim() || '',
        summary: top.querySelector('.dek')?.textContent.trim() || '',
        source: top.querySelector('.source')?.textContent.trim() || ''
      });
    }
    document.querySelectorAll('.article').forEach(article => {
      const section = article.closest('[data-section]');
      items.push({
        type: 'article',
        genre: article.dataset.genre || section?.dataset.section || '',
        title: article.querySelector('h4')?.textContent.trim() || '',
        summary: article.querySelector('p')?.textContent.trim() || '',
        source: article.querySelector('.source')?.textContent.trim() || ''
      });
    });
    return items;
  }

  async function saveSettings(rawValue) {
    let value = rawValue;
    try { value = JSON.parse(rawValue); } catch (_) {}
    await put(SETTINGS_STORE, {
      id: 'current',
      value,
      updatedAt: new Date().toISOString()
    });
  }

  async function saveIssue(rawValue) {
    let issue = {};
    try { issue = JSON.parse(rawValue) || {}; } catch (_) { issue = { raw: rawValue }; }
    const savedAt = issue.savedAt || new Date().toISOString();
    const id = localDateId(savedAt);
    await put(ISSUES_STORE, {
      ...issue,
      id,
      savedAt,
      displayDate: document.querySelector('#issueDate')?.textContent.trim() || id,
      articles: collectArticles(),
      mainSnapshot: document.querySelector('main')?.innerHTML || ''
    });
  }

  async function migrateLocalStorage() {
    const settings = localStorage.getItem('mdp_settings');
    const issue = localStorage.getItem('mdp_latest_issue');
    if (settings) await saveSettings(settings);
    if (issue) await saveIssue(issue);
  }

  function installStorageMirror() {
    const original = Storage.prototype.setItem;
    if (Storage.prototype.__mdpIndexedDBPatched) return;
    Storage.prototype.setItem = function(key, value) {
      const result = original.apply(this, arguments);
      if (this === localStorage) {
        if (key === 'mdp_settings') saveSettings(value).catch(console.error);
        if (key === 'mdp_latest_issue') saveIssue(value).catch(console.error);
      }
      return result;
    };
    Storage.prototype.__mdpIndexedDBPatched = true;
  }

  function addHistoryUI() {
    if (document.querySelector('#historyBtn')) return;

    const style = document.createElement('style');
    style.textContent = `
      .mdp-history-dialog{width:min(620px,calc(100% - 24px));border:0;border-radius:18px;padding:0;box-shadow:0 30px 90px rgba(0,0,0,.28)}
      .mdp-history-dialog::backdrop{background:rgba(0,0,0,.45)}
      .mdp-history-inner{padding:20px}
      .mdp-history-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
      .mdp-history-list{display:grid;gap:10px;margin-top:14px}
      .mdp-history-item{border:1px solid #d7d1c4;border-radius:12px;padding:12px;background:#fff}
      .mdp-history-item strong{display:block;margin-bottom:4px}
      .mdp-history-meta{font-size:12px;color:#6f6f6f}
      .mdp-history-actions{display:flex;gap:8px;margin-top:8px}
      .mdp-history-actions button{border:1px solid #151515;background:#fff;border-radius:999px;padding:6px 10px}
      .mdp-return{position:fixed;right:14px;top:70px;z-index:50;border:0;border-radius:999px;padding:10px 14px;background:#151515;color:#fff}
      @media(max-width:760px){.appbar-inner #historyBtn{display:none}.bottom-actions #mobileHistoryBtn{display:block}}
      @media(min-width:761px){.bottom-actions #mobileHistoryBtn{display:none}}
      @media print{.mdp-return,.mdp-history-dialog{display:none!important}}
    `;
    document.head.appendChild(style);

    const desktopAnchor = document.querySelector('#settingsBtn');
    if (desktopAnchor) {
      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.id = 'historyBtn';
      btn.textContent = '過去号';
      desktopAnchor.parentNode.insertBefore(btn, desktopAnchor);
    }

    const mobileBar = document.querySelector('.bottom-actions');
    if (mobileBar) {
      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.id = 'mobileHistoryBtn';
      btn.textContent = '過去号';
      mobileBar.insertBefore(btn, mobileBar.firstChild);
    }

    const dialog = document.createElement('dialog');
    dialog.className = 'mdp-history-dialog';
    dialog.id = 'historyDialog';
    dialog.innerHTML = `
      <div class="mdp-history-inner">
        <div class="mdp-history-head">
          <h2 style="margin:0">過去の新聞</h2>
          <button class="btn" id="closeHistory">閉じる</button>
        </div>
        <div class="mdp-history-list" id="historyList"></div>
      </div>`;
    document.body.appendChild(dialog);

    document.querySelector('#closeHistory').onclick = () => dialog.close();
    document.querySelector('#historyBtn')?.addEventListener('click', showHistory);
    document.querySelector('#mobileHistoryBtn')?.addEventListener('click', showHistory);
  }

  async function showHistory() {
    const dialog = document.querySelector('#historyDialog');
    const list = document.querySelector('#historyList');
    if (!dialog || !list) return;
    list.innerHTML = '<div class="mdp-history-meta">読み込み中…</div>';
    dialog.showModal();
    const issues = (await getAll(ISSUES_STORE)).sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
    if (!issues.length) {
      list.innerHTML = '<div class="mdp-history-meta">保存された新聞はまだありません。</div>';
      return;
    }
    list.innerHTML = '';
    issues.forEach(issue => {
      const item = document.createElement('div');
      item.className = 'mdp-history-item';
      item.innerHTML = `
        <strong>${issue.displayDate || issue.id}</strong>
        <div class="mdp-history-meta">${issue.articles?.length || 0}記事・保存 ${new Date(issue.savedAt).toLocaleString('ja-JP')}</div>
        <div class="mdp-history-actions"><button type="button">この号を開く</button></div>`;
      item.querySelector('button').onclick = () => openIssue(issue);
      list.appendChild(item);
    });
  }

  function openIssue(issue) {
    const main = document.querySelector('main');
    if (!main || !issue.mainSnapshot) return;
    main.innerHTML = issue.mainSnapshot;
    document.querySelector('#historyDialog')?.close();
    if (!document.querySelector('#returnToday')) {
      const back = document.createElement('button');
      back.id = 'returnToday';
      back.className = 'mdp-return';
      back.textContent = '今日に戻る';
      back.onclick = () => location.reload();
      document.body.appendChild(back);
    }
  }

  window.MDPDB = { openDB, getAllIssues: () => getAll(ISSUES_STORE), saveIssue, saveSettings };

  installStorageMirror();
  addHistoryUI();
  migrateLocalStorage().catch(console.error);
})();
