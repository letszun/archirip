(() => {
  "use strict";

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
    .catalog-status,.selected-source{min-height:14px;font-size:9px;line-height:1.5;color:var(--muted);text-align:center}
    .catalog-results{display:grid;gap:1px;max-height:300px;overflow:auto;scrollbar-width:none;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
    .catalog-results:empty{display:none}.catalog-results::-webkit-scrollbar{display:none}
    .catalog-item{width:100%;display:grid;grid-template-columns:42px minmax(0,1fr) auto;gap:12px;align-items:center;padding:10px 2px;text-align:left;border-bottom:1px solid var(--line)}
    .catalog-item:last-child{border-bottom:0}.catalog-item:hover,.catalog-item:focus-visible{background:var(--soft);outline:none}
    .catalog-cover{width:42px;height:60px;object-fit:cover;background:var(--soft);border:1px solid var(--line)}
    .catalog-cover.empty{display:grid;place-items:center;font-size:7px;color:var(--muted)}
    .catalog-copy{min-width:0}.catalog-title{display:block;font-size:12px;line-height:1.45;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .catalog-meta{display:block;margin-top:3px;font-size:9px;line-height:1.45;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .catalog-source{font-size:8px;color:var(--muted);white-space:nowrap}
    .catalog-actions{display:flex;justify-content:center;min-height:18px}
    .catalog-more{font-size:9px;color:var(--muted);text-decoration:none}
    .catalog-more:hover,.catalog-more:focus-visible{color:var(--ink);outline:none}
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
    <div id="catalogStatus" class="catalog-status"></div>
    <div id="catalogResults" class="catalog-results"></div>
    <div class="catalog-actions"><a id="catalogWebMore" class="catalog-more" href="#">웹에서 더 찾기 ↗</a></div>
  `;
  form.insertBefore(searchBox, picker);

  const divider = document.createElement("div");
  divider.className = "add-divider";
  divider.textContent = "직접 등록";
  form.insertBefore(divider, picker);

  const source = document.createElement("div");
  source.id = "selectedSource";
  source.className = "selected-source";
  $("#dominantDot")?.insertAdjacentElement("afterend", source);

  let selectedMeta = null;

  $("#catalogSearchButton").addEventListener("click", search);
  $("#catalogQuery").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); search(); }
  });
  $("#catalogWebMore").addEventListener("click", openWebSearch);

  $("#coverUpload").addEventListener("change", () => {
    if (!$("#catalogStatus").dataset.importing) {
      selectedMeta = null;
      source.textContent = "";
    }
  });

  $("#openAdd")?.addEventListener("click", () => {
    setTimeout(() => {
      $("#catalogQuery").value = "";
      $("#catalogResults").innerHTML = "";
      status("");
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

  async function search(){
    const query = $("#catalogQuery").value.trim();
    if (!query) return status("검색어를 입력하세요.");

    $("#catalogResults").innerHTML = "";
    status("검색 중…");

    const [google, openLibrary] = await Promise.allSettled([
      searchGoogle(query),
      searchOpenLibrary(query)
    ]);

    const googleItems = google.status === "fulfilled" ? google.value : [];
    const olItems = openLibrary.status === "fulfilled" ? openLibrary.value : [];
    const items = dedupe([...googleItems, ...olItems]).slice(0, 16);

    if (!items.length) {
      status("책 데이터베이스에서 찾지 못했습니다. 웹에서 더 찾아보세요.");
      return;
    }

    const sources = [googleItems.length ? "Google Books" : "", olItems.length ? "Open Library" : ""].filter(Boolean);
    status(`${items.length}권 · ${sources.join(" + ")}`);
    render(items);
  }

  async function searchGoogle(query){
    const params = new URLSearchParams({
      q:query, maxResults:"12", startIndex:"0", printType:"books", projection:"lite"
    });
    const res = await fetch(`https://www.googleapis.com/books/v1/volumes?${params}`, {mode:"cors",credentials:"omit",cache:"no-store"});
    if (!res.ok) throw new Error(`Google Books HTTP ${res.status}`);
    const data = await res.json();
    const items = Array.isArray(data?.items) ? data.items : [];

    return items.map((item) => {
      const v = item.volumeInfo || {};
      const ids = Array.isArray(v.industryIdentifiers) ? v.industryIdentifiers : [];
      const isbn13 = ids.find(x => x.type === "ISBN_13")?.identifier || ids.find(x => x.type === "ISBN_10")?.identifier || "";
      const cover = secure(v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail || "").replace("zoom=1","zoom=2");
      return {
        title:String(v.title || "Untitled").trim(),
        author:Array.isArray(v.authors) ? v.authors.join(", ") : "",
        publisher:String(v.publisher || "").trim(),
        isbn13:String(isbn13 || "").trim(),
        pageCount:Number(v.pageCount || 0),
        cover,
        sourceUrl:String(v.infoLink || "").trim(),
        sourceType:"google-books",
        sourceId:String(item.id || "").trim(),
        sourceLabel:"Google"
      };
    });
  }

  async function searchOpenLibrary(query){
    const params = new URLSearchParams({
      q:query,
      limit:"12",
      fields:"key,title,author_name,isbn,publisher,cover_i,number_of_pages_median,number_of_pages"
    });
    const res = await fetch(`https://openlibrary.org/search.json?${params}`, {mode:"cors",credentials:"omit",cache:"no-store"});
    if (!res.ok) throw new Error(`Open Library HTTP ${res.status}`);
    const data = await res.json();
    const docs = Array.isArray(data?.docs) ? data.docs : [];

    return docs.map((doc) => {
      const isbns = Array.isArray(doc.isbn) ? doc.isbn : [];
      const isbn13 = isbns.find(x => /^\d{13}$/.test(String(x))) || isbns[0] || "";
      const publishers = Array.isArray(doc.publisher) ? doc.publisher : [];
      const pages = Number(doc.number_of_pages_median || (Array.isArray(doc.number_of_pages) ? doc.number_of_pages[0] : doc.number_of_pages) || 0);
      return {
        title:String(doc.title || "Untitled").trim(),
        author:Array.isArray(doc.author_name) ? doc.author_name.join(", ") : "",
        publisher:String(publishers[0] || "").trim(),
        isbn13:String(isbn13 || "").trim(),
        pageCount:pages,
        cover:doc.cover_i ? `https://covers.openlibrary.org/b/id/${encodeURIComponent(doc.cover_i)}-L.jpg` : "",
        sourceUrl:doc.key ? `https://openlibrary.org${doc.key}` : "",
        sourceType:"open-library",
        sourceId:String(doc.key || "").trim(),
        sourceLabel:"Open Library"
      };
    });
  }

  function dedupe(items){
    const seen = new Set(), out = [];
    for (const item of items) {
      const isbn = normalizeISBN(item.isbn13);
      const key = isbn || `${normalizeText(item.title)}|${normalizeText(item.author)}`;
      if (!key || seen.has(key)) continue;
      seen.add(key); out.push(item);
    }
    return out;
  }

  function render(items){
    const list = $("#catalogResults");
    list.innerHTML = "";
    items.forEach((item) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "catalog-item";

      let cover;
      if (item.cover) {
        cover = document.createElement("img");
        cover.className = "catalog-cover"; cover.alt = ""; cover.loading = "lazy"; cover.referrerPolicy = "no-referrer"; cover.src = item.cover;
      } else {
        cover = document.createElement("span"); cover.className = "catalog-cover empty"; cover.textContent = "NO COVER";
      }

      const copy = document.createElement("span"); copy.className = "catalog-copy";
      const title = document.createElement("span"); title.className = "catalog-title"; title.textContent = item.title;
      const meta = document.createElement("span"); meta.className = "catalog-meta";
      meta.textContent = [item.author,item.publisher,item.isbn13 ? `ISBN ${item.isbn13}` : ""].filter(Boolean).join(" · ");
      const src = document.createElement("span"); src.className = "catalog-source"; src.textContent = item.sourceLabel;
      copy.append(title,meta); b.append(cover,copy,src);
      b.addEventListener("click", () => select(item));
      list.appendChild(b);
    });
  }

  async function select(item){
    selectedMeta = {
      title:item.title,
      author:item.author,
      publisher:item.publisher,
      isbn13:item.isbn13,
      sourceUrl:item.sourceUrl,
      sourceType:item.sourceType,
      sourceId:item.sourceId
    };

    $("#newBookTitle").value = item.title;
    $("#newBookAuthor").value = item.author;
    if (Number(item.pageCount) > 0) $("#newPageCount").value = String(Math.round(item.pageCount));

    source.textContent = [item.publisher,item.isbn13 ? `ISBN ${item.isbn13}` : "",item.sourceLabel].filter(Boolean).join(" · ");
    $("#catalogResults").innerHTML = "";
    status(`선택됨 · ${item.sourceLabel}`);

    if (!item.cover) {
      source.textContent += " · 표지는 직접 첨부";
      return;
    }

    try {
      $("#catalogStatus").dataset.importing = "1";
      const res = await fetch(item.cover,{mode:"cors",credentials:"omit",cache:"force-cache"});
      if (!res.ok) throw new Error(`cover HTTP ${res.status}`);
      const blob = await res.blob();
      const file = new File([blob],"catalog-cover.jpg",{type:blob.type || "image/jpeg"});
      const dt = new DataTransfer(); dt.items.add(file);
      $("#coverUpload").files = dt.files;
      $("#coverUpload").dispatchEvent(new Event("change",{bubbles:true}));
      setTimeout(() => {
        delete $("#catalogStatus").dataset.importing;
        selectedMeta = {
          title:item.title,author:item.author,publisher:item.publisher,isbn13:item.isbn13,
          sourceUrl:item.sourceUrl,sourceType:item.sourceType,sourceId:item.sourceId
        };
        source.textContent = [item.publisher,item.isbn13 ? `ISBN ${item.isbn13}` : "",item.sourceLabel].filter(Boolean).join(" · ");
      },100);
    } catch (err) {
      delete $("#catalogStatus").dataset.importing;
      console.warn("Cover import blocked",err);
      source.textContent = [item.publisher,item.isbn13 ? `ISBN ${item.isbn13}` : "",item.sourceLabel,"표지는 직접 첨부"].filter(Boolean).join(" · ");
    }
  }

  function openWebSearch(e){
    e.preventDefault();
    const query = $("#catalogQuery").value.trim() || $("#newBookTitle")?.value.trim() || "";
    if (!query) return status("웹에서 찾을 책을 먼저 입력하세요.");
    window.open(`https://www.google.com/search?q=${encodeURIComponent(query + " 책")}`,"_blank","noopener,noreferrer");
  }

  function attachMetadata(meta){
    try {
      const key = "reading-archive-minimal-v5";
      const saved = JSON.parse(localStorage.getItem(key) || "null");
      if (!Array.isArray(saved?.books)) return;
      const book = [...saved.books].reverse().find(b => b.title === meta.title && b.author === meta.author);
      if (!book) return;
      Object.assign(book,{
        isbn13:meta.isbn13,
        publisher:meta.publisher,
        sourceUrl:meta.sourceUrl,
        sourceType:meta.sourceType,
        sourceId:meta.sourceId
      });
      localStorage.setItem(key,JSON.stringify(saved));
    } catch (_) {}
  }

  function status(text){ $("#catalogStatus").textContent = text; }
  function secure(url){ const s=String(url||"").trim(); return s.startsWith("http://")?`https://${s.slice(7)}`:s; }
  function normalizeISBN(v){ return String(v||"").replace(/[^0-9Xx]/g,"").toUpperCase(); }
  function normalizeText(v){ return String(v||"").toLocaleLowerCase().replace(/\s+/g,"").replace(/[^\p{L}\p{N}]/gu,""); }
})();