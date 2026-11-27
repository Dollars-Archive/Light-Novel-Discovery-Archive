(function () {
  'use strict';
  const Core = window.ReviewCore, Sync = window.ReviewSync;
  const $ = id => document.getElementById(id), esc = Core.escapeHtml;
  let novels = [], busy = false, verified = false, catalogReady = false;
  const initialFilters = {
    completion:'all', completeSetOnly:false, tenOrMoreVolumes:false,
    q:'', favoriteOnly:false, view:'active', sort:'id'
  };
  const worksPerPage = 100;
  let filters = {...initialFilters};
  let filteredNovels = [], currentPage = 1;
  const store = Sync.createStore({knownIds:() => new Set(novels.map(n => n.id))});

  function notice(text,error=false) { $('notice').textContent=text; $('notice').classList.toggle('error',error); }
  function tokenStatus(extra='') {
    $('token-status').textContent = extra || (store.getToken() ? (verified ? '열쇠 저장됨 · 쓰기 권한 확인됨' : '열쇠 있음 · 이 저장소의 쓰기 권한 확인 필요') : '등록된 열쇠 없음 · 이 기기에 등록하거나 기존 열쇠를 사용하세요.');
  }
  function openSettings() { $('settings').open=true; $('settings').scrollIntoView({block:'nearest',behavior:'smooth'}); }
  function novelMarkup(novel) {
    const favorite = Core.isFavorite(store.data, novel.id);
    const deleted = Core.isDeleted(store.data, novel.id);
    const disabled = busy || !store.ready ? ' disabled' : '';
    const title = displayTitle(novel);
    const actions = `<div class="actions">
      <button type="button" class="star" data-action="favorite" data-id="${esc(novel.id)}" aria-pressed="${favorite}" aria-label="${esc(title)} ${favorite ? '찜 해제' : '찜 추가'}"${disabled}>${favorite ? '★' : '☆'}</button>
      <button type="button" data-action="deleted" data-id="${esc(novel.id)}" aria-label="${esc(title)} ${deleted ? '복구' : '삭제'}"${disabled}>${deleted ? '복구' : '삭제'}</button>
    </div>`;
    const fields = [
      novel.original, novel.title, novel.author, novel.label, novel.completion.volumes,
      Core.CATALOG_COMPLETION_LABELS[novel.completion.status],
      novel.confirmedVolumeDisplay || novel.confirmedVolumes, novel.tmwNumbers.join(', ')
    ];
    return `<tr><th scope="row">${esc(novel.catalogId || novel.id)}${actions}</th>${fields.map(value => `<td>${esc(value === '' || value === null ? '미확인' : value)}</td>`).join('')}</tr>`;
  }

  function displayTitle(novel) {
    return novel.title === '미확인' ? novel.original || novel.catalogId || novel.id : novel.title;
  }

  function renderPage() {
    const pageCount = Math.max(1, Math.ceil(filteredNovels.length / worksPerPage));
    if (currentPage > pageCount) {
      currentPage = pageCount;
      $('catalog-scroll').scrollTop = 0;
    }
    const start = (currentPage - 1) * worksPerPage;
    const end = Math.min(start + worksPerPage, filteredNovels.length);
    $('results').innerHTML = filteredNovels.slice(start, end).map(novelMarkup).join('');

    const pageSelect = $('page-select');
    if (pageSelect.options.length !== pageCount) {
      pageSelect.innerHTML = Array.from({length:pageCount}, (_, index) =>
        `<option value="${index + 1}">${index + 1} / ${pageCount} 페이지</option>`
      ).join('');
    }
    pageSelect.value = String(currentPage);
    $('page-prev').disabled = currentPage === 1;
    $('page-next').disabled = currentPage === pageCount;
    $('pagination').hidden = pageCount <= 1;
    $('page-range').textContent = filteredNovels.length ? `${start + 1}~${end}번째 작품` : '';
  }

  function goToPage(page) {
    currentPage = page;
    renderPage();
    $('catalog-scroll').scrollTop = 0;
  }

  function render(resetPage = false) {
    if (resetPage) {
      currentPage = 1;
      $('catalog-scroll').scrollTop = 0;
    }
    const state=store.data;
    const active=novels.filter(n=>!Core.isDeleted(state,n.id));
    const favoriteCount=active.filter(n=>Core.isFavorite(state,n.id)).length;
    const deletedCount=novels.length-active.length;
    $('stats').innerHTML=[['등록 작품',active.length],['찜한 작품',favoriteCount]].map(([label,value])=>`<div class="stat"><strong>${value}</strong><span>${label}</span></div>`).join('');
    $('favorites').textContent=`${filters.favoriteOnly?'★':'☆'} 찜만 보기 (${favoriteCount})`; $('favorites').setAttribute('aria-pressed',String(filters.favoriteOnly));
    $('deleted').textContent=`삭제한 작품 · 복구 (${deletedCount})`; $('deleted').setAttribute('aria-pressed',String(filters.view==='deleted'));
    $('complete-set-only').setAttribute('aria-pressed', String(filters.completeSetOnly));
    $('ten-or-more-volumes').setAttribute('aria-pressed', String(filters.tenOrMoreVolumes));
    $('list-title').textContent=filters.view==='deleted'?'삭제한 작품':filters.favoriteOnly?'찜한 작품':'전체 작품';
    filteredNovels = Core.selectNovels(novels, filters, state);
    $('count').textContent = `${filteredNovels.length}개`;
    renderPage();
    $('catalog-scroll').hidden = filteredNovels.length === 0;
    $('empty').hidden = filteredNovels.length > 0 || !catalogReady;
    $('empty-title').textContent=novels.length===0?'등록된 작품이 없어요':'조건에 맞는 작품이 없어요';
    $('empty-text').textContent=novels.length===0?'아직 등록된 작품이 없습니다.':filters.view==='deleted'?'삭제한 작품이 없거나 현재 필터에 해당하지 않습니다.':'검색어나 필터 조건을 바꿔 보세요.';
    ['token-save','token-clear','refresh'].forEach(id=>{$(id).disabled=busy;});
    tokenStatus();
  }
  async function checkToken() {
    verified=false;
    if(!store.getToken()){tokenStatus();return;}
    try { verified=await store.verifyToken(); tokenStatus(verified?'열쇠 저장됨 · 쓰기 권한 확인됨':'열쇠 저장됨 · Light-Novel-Discovery-Archive 저장소를 선택하고 Contents: Read and write 권한을 허용하세요.'); }
    catch(error){tokenStatus('열쇠는 보관됨 · GitHub 권한 확인 실패');throw error;}
  }
  async function refreshState() {
    if(busy)return;busy=true;render();notice('찜·삭제 목록을 확인하는 중…');
    try {
      const result=await store.load();
      await checkToken();
      render();
      notice(result.error?'찜·삭제 연동 실패 · '+result.error+' · 기존 저장값을 유지합니다.':'찜·삭제 목록을 새로 불러왔습니다.',Boolean(result.error));
    } catch(error){render();notice('GitHub 연결을 확인하지 못했습니다. '+error.message,true);}
    finally{busy=false;render();}
  }
  $('search').addEventListener('input',()=>{filters.q=$('search').value;render(true);});
  $('completion').addEventListener('change',()=>{filters.completion=$('completion').value;render(true);});
  $('sort').addEventListener('change',()=>{filters.sort=$('sort').value;render(true);});
  $('favorites').addEventListener('click',()=>{filters.favoriteOnly=!filters.favoriteOnly;render(true);});
  $('deleted').addEventListener('click',()=>{filters.view=filters.view==='deleted'?'active':'deleted';render(true);});
  $('complete-set-only').addEventListener('click',()=>{
    filters.completeSetOnly = !filters.completeSetOnly;
    render(true);
  });
  $('ten-or-more-volumes').addEventListener('click',()=>{
    filters.tenOrMoreVolumes = !filters.tenOrMoreVolumes;
    render(true);
  });
  $('page-prev').addEventListener('click',()=>goToPage(currentPage - 1));
  $('page-next').addEventListener('click',()=>goToPage(currentPage + 1));
  $('page-select').addEventListener('change',()=>goToPage(Number($('page-select').value)));
  $('reset').addEventListener('click',()=>{
    filters = {...initialFilters};
    $('search').value = '';
    $('completion').value = filters.completion;
    $('sort').value = filters.sort;
    render(true);
  });
  $('settings-open').addEventListener('click',openSettings);
  $('refresh').addEventListener('click',refreshState);
  $('token-save').addEventListener('click',async()=>{
    if(busy)return;
    try{store.setToken($('token').value);$('token').value='';}catch(error){notice(error.message,true);return;}
    busy=true;render();notice('열쇠를 저장하고 쓰기 권한을 확인하는 중…');
    try{await checkToken();notice(verified?'열쇠를 이 기기에 저장했습니다. 찜·삭제를 다른 기기와 연동할 수 있습니다.':'열쇠는 저장됐지만 쓰기 권한이 없습니다. Light-Novel-Discovery-Archive 저장소를 선택하고 Contents: Read and write를 허용하세요.',!verified);}
    catch(error){notice('열쇠는 이 기기에 보관됩니다. 권한 확인 요청 실패 · '+error.message,true);}
    finally{busy=false;render();}
  });
  $('token-clear').addEventListener('click',()=>{if(busy)return;try{store.clearToken();verified=false;$('token').value='';render();notice('이 코너에서 열쇠 사용을 중지했습니다. 기존 열쇠 설정은 유지됩니다.');}catch(error){notice(error.message,true);}});
  $('results').addEventListener('click',async event=>{
    const button=event.target.closest('[data-action]');if(!button||busy||!store.ready)return;
    const novel=novels.find(n=>n.id===button.dataset.id);if(!novel)return;
    if(!store.getToken()){openSettings();notice('찜·삭제 저장에는 GitHub 열쇠가 필요합니다.',true);return;}
    busy=true;render();
    try{
      if(!verified){await checkToken();if(!verified)throw new Error('Light-Novel-Discovery-Archive 저장소의 Contents: Read and write 권한을 확인해 주세요.');}
      const kind=button.dataset.action;
      const value=kind==='favorite'?!Core.isFavorite(store.data,novel.id):!Core.isDeleted(store.data,novel.id);
      notice('GitHub에 저장하는 중…');
      await store.change({kind,id:novel.id,title:displayTitle(novel),value});
      notice(kind==='favorite'?(value?'찜을 GitHub에 저장했습니다.':'찜을 해제했습니다.'):(value?'작품을 목록에서 삭제했습니다. 삭제한 작품에서 복구할 수 있습니다.':'작품을 목록에 복구했습니다.'));
    }catch(error){notice('저장 실패 · 기존 목록을 유지합니다. '+error.message,true);}
    finally{busy=false;render();}
  });
  async function init() {
    render();
    try{
      const response=await fetch('data/games.json?_='+Date.now(),{cache:'no-store'});if(!response.ok)throw new Error('작품 데이터 HTTP '+response.status);
      novels=Core.normalizeCatalog(await response.json()).novels;catalogReady=true;render();await refreshState();
    }catch(error){notice('작품 목록을 불러오지 못했습니다. '+error.message,true);}
  }
  init();
})();
