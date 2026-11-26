(function () {
  'use strict';
  const Core = window.ReviewCore, Sync = window.ReviewSync;
  const $ = id => document.getElementById(id), esc = Core.escapeHtml;
  let novels = [], busy = false, verified = false, catalogReady = false;
  let filters = {genre:'all',publication:'all',completion:'all',q:'',favoriteOnly:false,view:'active',sort:'score-desc'};
  const store = Sync.createStore({knownIds:() => new Set(novels.map(n => n.id))});

  function notice(text,error=false) { $('notice').textContent=text; $('notice').classList.toggle('error',error); }
  function tokenStatus(extra='') {
    $('token-status').textContent = extra || (store.getToken() ? (verified ? '열쇠 저장됨 · 쓰기 권한 확인됨' : '열쇠 있음 · 이 저장소의 쓰기 권한 확인 필요') : '등록된 열쇠 없음 · 이 기기에 등록하거나 기존 열쇠를 사용하세요.');
  }
  function openSettings() { $('settings').open=true; $('settings').scrollIntoView({block:'nearest',behavior:'smooth'}); }
  function listItems(items) { return items.length ? '<ul>'+items.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>' : '<p>아직 등록된 내용이 없습니다.</p>'; }
  function volumeText(value) {
    const text=String(value||'').trim();
    if(!text)return '';
    return /^\d+$/.test(text) ? text+'권' : text;
  }
  function coverMarkup(novel) {
    const cover=novel.cover||{}, raw=typeof cover.url==='string'?cover.url:'';
    const url=/^covers\/[a-z0-9][a-z0-9-]*\.(?:webp|jpg|jpeg|png)$/.test(raw)?raw:Core.safeUrl(raw);
    const description=novel.title+' 표지';
    return `<div class="cover">${url?`<img class="cover-image" src="${esc(url)}" alt="${esc(description)}" title="${esc(description)}" loading="lazy" decoding="async">`:''}<span class="cover-placeholder"${url?' hidden':''}>표지 준비 중</span></div>`;
  }
  function factsMarkup(novel) {
    const publication = novel.publication;
    const completion = novel.completion;
    const publicationLabel = publication.status === 'licensed' ? '☑ 정발' : publication.status === 'unlicensed' ? '☐ 미정발' : '☐ 정발 미확인';
    const completionLabel = completion.status === 'completed' ? '☑ 완결' : '☐ ' + Core.COMPLETION_LABELS[completion.status];
    const volumes = '원작 ' + (volumeText(completion.volumes) || '미확인') + ' / 국내 ' + (volumeText(publication.volumes) || '미확인');
    return `<div class="novel-columns">
      <div class="story-column"><span class="fact-label">스토리</span><p>${esc(novel.summary || '소개 등록 대기')}</p></div>
      <div><span class="fact-label">발매일</span><p>${esc(novel.releaseDate || '미확인')}</p><small>원작 첫 발매</small></div>
      <div><span class="fact-label">장르</span><p>${esc(novel.genres.join(' · ') || '미확인')}</p></div>
      <div><span class="fact-label">발매권수</span><p>${esc(volumes)}</p></div>
      <div><span class="fact-label">국내 정발</span><p class="status ${esc(publication.status)}">${esc(publicationLabel)}</p><small>${esc(publication.publisher)}</small><small>${esc(publication.checkedAt ? publication.checkedAt + ' 확인' : '')}</small></div>
      <div><span class="fact-label">원작 완결</span><p class="status ${esc(completion.status)}">${esc(completionLabel)}</p></div>
    </div>`;
  }
  function oceanOfPdfMarkup(novel) {
    const title=novel.oceanOfPdfTitle;
    if(!title)return '';
    const url=new URL('https://oceanofpdf.com/');
    url.searchParams.set('s',title);
    return `<div class="oceanofpdf-search">
      <span class="fact-label">OceanOfPDF 검색 제목</span>
      <a href="${esc(url.href)}" target="_blank" rel="noopener noreferrer">${esc(title)}</a>
      <button type="button" data-copy-search-title aria-label="OceanOfPDF 검색 제목 복사">복사</button>
    </div>`;
  }
  function novelMarkup(novel) {
    const favorite=Core.isFavorite(store.data,novel.id), deleted=Core.isDeleted(store.data,novel.id);
    const disabled=busy||!store.ready ? ' disabled' : '';
    const score=novel.score===null ? '미평가' : Number(novel.score).toFixed(1);
    const sources=novel.sources.map(s=>{const url=Core.safeUrl(s.url);return url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(s.label||'출처')} ↗</a>`:'';}).join('');
    const coverSource=Core.safeUrl((novel.cover||{}).source);
    const coverLink=coverSource?`<a href="${esc(coverSource)}" target="_blank" rel="noopener noreferrer">표지 출처 ↗</a>`:'';
    const byline=[novel.author,novel.original].filter(Boolean).map(esc).join(' · ');
    return `<article class="novel" data-id="${esc(novel.id)}"><div class="novel-visual">${coverMarkup(novel)}<div class="rating ${novel.score===null?'unrated':''}"><strong>${score}</strong><span>${novel.score===null?'평가 대기':'/ 10'}</span></div></div><div class="novel-content"><h3>${esc(novel.title)}</h3>${byline?`<div class="byline">${byline}</div>`:''}${oceanOfPdfMarkup(novel)}${factsMarkup(novel)}<details class="detail"><summary>장단점 · 출처 보기</summary><div class="pros-cons"><div class="pros"><h4>장점</h4>${listItems(novel.pros)}</div><div class="cons"><h4>단점</h4>${listItems(novel.cons)}</div></div><div class="sources">${sources}${coverLink}</div>${novel.reviewedAt?`<div class="meta">평가일 ${esc(novel.reviewedAt)}</div>`:''}</details></div><div class="actions"><button class="star" data-action="favorite" data-id="${esc(novel.id)}" aria-pressed="${favorite}" aria-label="${esc(novel.title)} ${favorite?'찜 해제':'찜 추가'}"${disabled}>${favorite?'★':'☆'}</button><button data-action="deleted" data-id="${esc(novel.id)}"${disabled}>${deleted?'복구':'삭제'}</button></div></article>`;
  }
  function render() {
    const state=store.data;
    const active=novels.filter(n=>!Core.isDeleted(state,n.id));
    const favoriteCount=active.filter(n=>Core.isFavorite(state,n.id)).length;
    const deletedCount=novels.length-active.length;
    $('stats').innerHTML=[['등록 작품',active.length],['평가 완료',active.filter(n=>n.score!==null).length],['찜한 작품',favoriteCount]].map(([label,value])=>`<div class="stat"><strong>${value}</strong><span>${label}</span></div>`).join('');
    $('favorites').textContent=`${filters.favoriteOnly?'★':'☆'} 찜만 보기 (${favoriteCount})`; $('favorites').setAttribute('aria-pressed',String(filters.favoriteOnly));
    $('deleted').textContent=`삭제한 작품 · 복구 (${deletedCount})`; $('deleted').setAttribute('aria-pressed',String(filters.view==='deleted'));
    $('list-title').textContent=filters.view==='deleted'?'삭제한 작품':filters.favoriteOnly?'찜한 작품':filters.genre==='all'?'전체 작품':filters.genre+' 작품';
    const selected=Core.selectNovels(novels,filters,state);
    $('count').textContent=`${selected.length}개`;
    $('results').innerHTML=selected.map(novelMarkup).join('');
    $('empty').hidden=selected.length>0||!catalogReady;
    $('empty-title').textContent=novels.length===0?'등록된 작품이 없어요':'조건에 맞는 작품이 없어요';
    $('empty-text').textContent=novels.length===0?'아직 등록된 작품이 없습니다. 데이터 파일에 작품을 추가하면 평점순으로 자동 정렬됩니다.':filters.view==='deleted'?'삭제한 작품이 없거나 현재 필터에 해당하지 않습니다.':'장르·출간·연재 상태나 검색 조건을 바꾸거나 필터를 초기화해 보세요.';
    ['token-save','token-clear','refresh'].forEach(id=>{$(id).disabled=busy;});
    tokenStatus();
  }
  function loadGenres() {
    const genres=[...new Set(novels.flatMap(n=>n.genres))].sort((a,b)=>a.localeCompare(b,'ko'));
    $('genre').innerHTML='<option value="all">전체 장르</option>'+genres.map(g=>`<option value="${esc(g)}">${esc(g)}</option>`).join('');
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
  $('search').addEventListener('input',()=>{filters.q=$('search').value;render();});
  $('genre').addEventListener('change',()=>{filters.genre=$('genre').value;render();});
  $('publication').addEventListener('change',()=>{filters.publication=$('publication').value;render();});
  $('completion').addEventListener('change',()=>{filters.completion=$('completion').value;render();});
  $('sort').addEventListener('change',()=>{filters.sort=$('sort').value;render();});
  $('favorites').addEventListener('click',()=>{filters.favoriteOnly=!filters.favoriteOnly;render();});
  $('deleted').addEventListener('click',()=>{filters.view=filters.view==='deleted'?'active':'deleted';render();});
  $('reset').addEventListener('click',()=>{filters={genre:'all',publication:'all',completion:'all',q:'',favoriteOnly:false,view:'active',sort:'score-desc'};$('search').value='';$('genre').value='all';$('publication').value='all';$('completion').value='all';$('sort').value='score-desc';render();});
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
  $('results').addEventListener('error',event=>{
    const image=event.target;
    if(!image.classList||!image.classList.contains('cover-image'))return;
    image.hidden=true;
    const placeholder=image.parentElement.querySelector('.cover-placeholder');
    if(placeholder)placeholder.hidden=false;
  },true);
  $('results').addEventListener('click',async event=>{
    const copyButton=event.target.closest('[data-copy-search-title]');
    if(copyButton){
      const title=copyButton.parentElement.querySelector('a');
      try {
        await navigator.clipboard.writeText(title.textContent);
        copyButton.textContent='복사됨';
        notice('OceanOfPDF 검색 제목을 복사했습니다.');
      } catch {
        copyButton.textContent='직접 복사';
        const selection=window.getSelection();
        if(selection){
          const range=document.createRange();
          range.selectNodeContents(title);
          selection.removeAllRanges();
          selection.addRange(range);
        }
        notice('자동 복사가 차단됐습니다. 검색 제목을 직접 복사해 주세요.',true);
      }
      return;
    }
    const button=event.target.closest('[data-action]');if(!button||busy||!store.ready)return;
    const novel=novels.find(n=>n.id===button.dataset.id);if(!novel)return;
    if(!store.getToken()){openSettings();notice('찜·삭제 저장에는 GitHub 열쇠가 필요합니다.',true);return;}
    busy=true;render();
    try{
      if(!verified){await checkToken();if(!verified)throw new Error('Light-Novel-Discovery-Archive 저장소의 Contents: Read and write 권한을 확인해 주세요.');}
      const kind=button.dataset.action;
      const value=kind==='favorite'?!Core.isFavorite(store.data,novel.id):!Core.isDeleted(store.data,novel.id);
      notice('GitHub에 저장하는 중…');
      await store.change({kind,id:novel.id,title:novel.title,value});
      notice(kind==='favorite'?(value?'찜을 GitHub에 저장했습니다.':'찜을 해제했습니다.'):(value?'작품을 목록에서 삭제했습니다. 삭제한 작품에서 복구할 수 있습니다.':'작품을 목록에 복구했습니다.'));
    }catch(error){notice('저장 실패 · 기존 목록을 유지합니다. '+error.message,true);}
    finally{busy=false;render();}
  });
  async function init() {
    render();
    try{
      const response=await fetch('data/games.json?_='+Date.now(),{cache:'no-store'});if(!response.ok)throw new Error('작품 데이터 HTTP '+response.status);
      novels=Core.normalizeCatalog(await response.json()).novels;catalogReady=true;loadGenres();render();await refreshState();
    }catch(error){notice('작품 목록을 불러오지 못했습니다. '+error.message,true);}
  }
  init();
})();
