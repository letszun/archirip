(() => {
  "use strict";

  const KEY_STORAGE = "reading-archive-aladin-ttb-key-v1";
  const SEARCH_URL = "https://www.aladin.co.kr/ttb/api/ItemSearch.aspx";
  const $ = (s) => document.querySelector(s);
  const form = $("#addForm");
  const picker = $("#coverPicker");
  if (!form || !picker || $("#catalogQuery")) return;

  const style = document.createElement("style");
  style.textContent = `
    .catalog-search{display:grid;gap:9px;margin-bottom:2px}
    .catalog-search-row{display:flex;align-items:center;gap:8px;border-bottom:1px solid var(--line)}
    .catalog-search-row input{flex:1;min-width:0;padding:10px 2px 9px;font-size:13px}
    .catalog-search-button{flex:0 0 auto;padding:7px 0 7px 10px;font-size:10px;color:var(--muted)}
    .catalog-key{display:flex;gap:8px;align-items:center}
    .catalog-key input{flex:1;border-bottom:1px solid var(--line);padding:8px 2px;font-size:11px}
    .catalog-key button{font-size:10px;color:var(--muted);white-space:nowrap}
    .catalog-hint,.catalog-status,.selected-source{font-size:9px;line-height:1.5;color:var(--muted);text-align:center}
    .catalog-status{min-height:14px;font-size:10px}
    .catalog-results{display:grid;gap:1px;max-height:280px;overflow:auto;scrollbar-width:none;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
    .catalog-results:empty{display:none}.catalog-results::-webkit-scrollbar{display:none}
    .catalog-item{width:100%;display:grid;grid-template-columns:42px minmax(0,1fr);gap:12px;align-items:center;padding:10px 2px;text-align:left;border-bottom:1px solid var(--line)}
    .catalog-item:last-child{border-bottom:0}.catalog-item:hover,.catalog-item:focus-visible{background:var(--soft);outline:none}
    .catalog-cover{width:42px;height:60px;object-fit:cover;background:var(--soft);border:1px solid var(--line)}
    .catalog-copy{min-width:0}.catalog-title{display:block;font-size:12px;line-height:1.45;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .catalog-meta{display:block;margin-top:3px;font-size:9px;line-height:1.45;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .add-divider{display:flex;align-items:center;gap:10px;color:var(--muted);font-size:9px}
    .add-divider::before,.add-divider::after{content:"";flex:1;height:1px;background:var(--line)}
  `;
  document.head.appendChild(style);

  const searchBox = document.createElement("div");
  searchBox.className = "catalog-search";
  searchBox.innerHTML = `
    <div class="catalog-search-row">
      <input id="catalogQuery" type="search" placeholder="제목 · 저자 · ISBN 검색" autocomplete="off">
      <button id="catalogSearchButton" class="catalog-search-button" type="button">검색</button>
    </div>
    <div class="catalog-key">
      <input id="catalogKey" type="password" placeholder="알라딘 TTB KEY" autocomplete="off">
      <button id="saveCatalogKey" type="button">저장</button>
    </div>
    <div class="catalog-hint">TTB KEY는 이 브라우저에만 저장됩니다.</div>
    <div id="catalogStatus" class="catalog-status"></div>
    <div id="catalogResults" class="catalog-results"></div>
  `;
  form.insertBefore(searchBox, picker);

  const divider = document.createElement("div");
  divider.className = "add-divider";
  divider.textContent = "직접 등록";
  form.insertBefore(divider, picker);

  const source = document.createElement("div");
  source.id = "selectedSource";
  source.className = "selected-source";
  const dot = $("#dominantDot");
  dot?.insertAdjacentElement("afterend", source);

  let selectedMeta = null;

  syncKey();
  $("#catalogSearchButton").addEventListener("click", search);
  $("#catalogQuery").addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); search(); }
  });
  $("#saveCatalogKey").addEventListener("click", saveKey);

  $("#coverUpload").addEventListener("change", () => {
    if (!$("#catalogStatus").dataset.importing) {
      selectedMeta = null;
      source.textContent = "";
    }
  });

  $("#openAdd")?.addEventListener("click", () => {
    setTimeout(() => {
      syncKey();
      $("#catalogResults").innerHTML = "";
      $("#catalogStatus").textContent = "";
      source.textContent = "";
      selectedMeta = null;
      $("#catalogQuery")?.focus();
    }, 60);
  });

  form.addEventListener("submit", () => {
    if (!selectedMeta) return;
    const meta = {...selectedMeta};
    setTimeout(() => attachMetadata(meta), 0);
  });

  function getKey(){
    try { return localStorage.getItem(KEY_STORAGE) || ""; } catch (_) { return ""; }
  }
  function syncKey(){ $("#catalogKey").value = getKey(); }
  function saveKey(){
    const key = $("#catalogKey").value.trim();
    try {
      if (key) localStorage.setItem(KEY_STORAGE, key);
      else localStorage.removeItem(KEY_STORAGE);
    } catch (_) {}
    $("#catalogStatus").textContent = key ? "TTB KEY 저장됨" : "TTB KEY가 비어 있습니다.";
  }

  async function search(){
    const query = $("#catalogQuery").value.trim();
    const key = $("#catalogKey").value.trim() || getKey();
    if (!query) return status("검색어를 입력하세요.");
    if (!key) { status("먼저 알라딘 TTB KEY를 입력하세요."); return $("#catalogKey").focus(); }

    $("#catalogResults").innerHTML = "";
    status("검색 중…");
    const params = new URLSearchParams({
      ttbkey:key, Query:query, QueryType:"Keyword", MaxResults:"12", start:"1",
      SearchTarget:"Book", output:"js", Version:"20131101", Cover:"Big"
    });

    try {
      const res = await fetch(`${SEARCH_URL}?${params}`, {mode:"cors",credentials:"omit",cache:"no-store"});
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = parse(await res.text());
      const items = Array.isArray(data?.item) ? data.item : [];
      if (!items.length) return status("검색 결과가 없습니다.");
      status(`${items.length}권`);
      render(items);
    } catch (err) {
      console.error("Aladin search failed", err);
      status("알라딘 검색 연결이 차단됐습니다. 직접 등록은 계속 사용할 수 있습니다.");
    }
  }

  function parse(text){
    const clean = String(text || "").replace(/^\uFEFF/, "").trim();
    try { return JSON.parse(clean); } catch (_) {}
    const a = clean.indexOf("{"), b = clean.lastIndexOf("}");
    if (a >= 0 && b > a) return JSON.parse(clean.slice(a,b+1));
    throw new Error("Unexpected Aladin response");
  }

  function render(items){
    const list = $("#catalogResults");
    list.innerHTML = "";
    items.forEach(item => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "catalog-item";
      const img = document.createElement("img");
      img.className = "catalog-cover"; img.alt = ""; img.loading = "lazy"; img.referrerPolicy = "no-referrer";
      img.src = secure(item.cover);
      const copy = document.createElement("span"); copy.className = "catalog-copy";
      const title = document.createElement("span"); title.className = "catalog-title"; title.textContent = tidy(item.title);
      const meta = document.createElement("span"); meta.className = "catalog-meta";
      meta.textContent = [item.author,item.publisher,item.pubDate].filter(Boolean).join(" · ");
      copy.append(title,meta); b.append(img,copy);
      b.addEventListener("click", () => select(item));
      list.appendChild(b);
    });
  }

  async function select(item){
    const meta = {
      title:tidy(item.title),
      author:String(item.author || "").trim(),
      publisher:String(item.publisher || "").trim(),
      isbn13:String(item.isbn13 || item.isbn || "").trim(),
      sourceUrl:String(item.link || "").trim()
    };
    selectedMeta = meta;
    $("#newBookTitle").value = meta.title;
    $("#newBookAuthor").value = meta.author;
    const pages = Number(item?.subInfo?.itemPage || item?.itemPage || 0);
    if (pages > 0) $("#newPageCount").value = String(Math.round(pages));
    source.textContent = [meta.publisher,meta.isbn13 ? `ISBN ${meta.isbn13}` : ""].filter(Boolean).join(" · ");
    status("선택됨"); $("#catalogResults").innerHTML = "";

    const cover = secure(item.cover);
    if (!cover) return;

    try {
      $("#catalogStatus").dataset.importing = "1";
      const res = await fetch(cover,{mode:"cors",credentials:"omit"});
      if (!res.ok) throw new Error(`cover HTTP ${res.status}`);
      const blob = await res.blob();
      const file = new File([blob],"aladin-cover.jpg",{type:blob.type || "image/jpeg"});
      const dt = new DataTransfer(); dt.items.add(file);
      $("#coverUpload").files = dt.files;
      $("#coverUpload").dispatchEvent(new Event("change",{bubbles:true}));
      setTimeout(() => {
        delete $("#catalogStatus").dataset.importing;
        selectedMeta = meta;
        source.textContent = [meta.publisher,meta.isbn13 ? `ISBN ${meta.isbn13}` : ""].filter(Boolean).join(" · ");
      },80);
    } catch (err) {
      delete $("#catalogStatus").dataset.importing;
      console.warn("Cover import blocked",err);
      source.textContent = [meta.publisher,meta.isbn13 ? `ISBN ${meta.isbn13}` : "","표지는 직접 첨부"].filter(Boolean).join(" · ");
    }
  }

  function attachMetadata(meta){
    try {
      const key = "reading-archive-minimal-v5";
      const saved = JSON.parse(localStorage.getItem(key) || "null");
      if (!Array.isArray(saved?.books)) return;
      const book = [...saved.books].reverse().find(b => b.title === meta.title && b.author === meta.author);
      if (!book) return;
      Object.assign(book,{isbn13:meta.isbn13,publisher:meta.publisher,sourceUrl:meta.sourceUrl});
      localStorage.setItem(key,JSON.stringify(saved));
    } catch (_) {}
  }

  function status(text){ $("#catalogStatus").textContent = text; }
  function secure(url){ const s=String(url||"").trim(); return s.startsWith("http://")?`https://${s.slice(7)}`:s; }
  function tidy(title){ return String(title||"Untitled").replace(/\s*-\s*\[[^\]]+\]\s*$/g,"").trim(); }
})();