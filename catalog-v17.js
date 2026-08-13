(() => {
  "use strict";

  const KEY_STORAGE = "reading-archive-aladin-ttb-key-v1";
  const ALADIN_SEARCH_URL = "https://www.aladin.co.kr/ttb/api/ItemSearch.aspx";
  const OPEN_LIBRARY_URL = "https://openlibrary.org/search.json";
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
    .catalog-key{display:flex;align-items:center;gap:8px}
    .catalog-key input{flex:1;min-width:0;border-bottom:1px solid var(--line);padding:8px 2px;font-size:10px}
    .catalog-key button{flex:0 0 auto;font-size:9px;color:var(--muted);white-space:nowrap}
    .catalog-key-state{min-height:13px;font-size:8px;line-height:1.45;color:var(--muted);text-align:center}
    .catalog-status,.selected-source{min-height:14px;font-size:9px;line-height:1.5;color:var(--muted);text-align:center}
    .catalog-results{display:grid;gap:1px;max-height:330px;overflow:auto;scrollbar-width:none;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
    .catalog-results:empty{display:none}.catalog-results::-webkit-scrollbar{display:none}
    .catalog-item{width:100%;display:grid;grid-template-columns:42px minmax(0,1fr) auto;gap:12px;align-items:center;padding:10px 2px;text-align:left;border-bottom:1px solid var(--line)}
    .catalog-item:last-child{border-bottom:0}.catalog-item:hover,.catalog-item:focus-visible{background:var(--soft);outline:none}
    .catalog-cover{width:42px;height:60px;object-fit:cover;background:var(--soft);border:1px solid var(--line)}
    .catalog-cover.empty{display:grid;place-items:center;font-size:7px;color:var(--muted)}
    .catalog-copy{min-width:0}.catalog-title{display:block;font-size:12px;line-height:1.45;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .catalog-meta{display:block;margin-top:3px;font-size:9px;line-height:1.45;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .catalog-source{font-size:8px;color:var(--muted);white-space:nowrap;text-align:right}
    .catalog-edition{display:block;margin-top:3px;font-size:7px;color:var(--muted)}
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

    <div class="catalog-key">
      <input id="catalogKey" type="password" placeholder="알라딘 TTB KEY · 국내 도서 검색" autocomplete="off">
      <button id="saveCatalogKey" type="button">저장</button>
    </div>
    <div id="catalogKeyState" class="catalog-key-state"></div>

    <div id="catalogStatus" class="catalog-status"></div>
    <div id="catalogResults" class="catalog-results"></div>

    <div class="catalog-actions">
      <a id="catalogWebMore" class="catalog-more" href="#">웹에서 더 찾기 ↗</a>
    </div>
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

  syncKeyUI();

  $("#catalogSearchButton").addEventListener("click", search);
  $("#catalogQuery").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      search();
    }
  });
  $("#saveCatalogKey").addEventListener("click", saveKey);
  $("#catalogWebMore").addEventListener("click", openWebSearch);

  $("#coverUpload").addEventListener("change", () => {
    if (!$("#catalogStatus").dataset.importing) {
      selectedMeta = null;
      source.textContent = "";
    }
  });

  $("#openAdd")?.addEventListener("click", () => {
    setTimeout(() => {
      syncKeyUI();
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

  function getKey(){
    try { return localStorage.getItem(KEY_STORAGE) || ""; }
    catch (_) { return ""; }
  }

  function saveKey(){
    const key = ($("#catalogKey").value || "").trim();

    try {
      if (key) localStorage.setItem(KEY_STORAGE, key);
      else localStorage.removeItem(KEY_STORAGE);
    } catch (_) {}

    syncKeyUI();
    status(key ? "알라딘 국내 검색을 사용할 수 있습니다." : "알라딘 키를 지웠습니다.");
  }

  function syncKeyUI(){
    const key = getKey();
    $("#catalogKey").value = key;
    $("#catalogKeyState").textContent = key
      ? "알라딘 국내 검색 연결됨 · 키는 이 브라우저에만 저장됩니다."
      : "국내 도서는 알라딘 TTB KEY를 저장하면 검색 정확도가 크게 좋아집니다.";
  }

  async function search(){
    const query = ($("#catalogQuery").value || "").trim();
    if (!query) return status("검색어를 입력하세요.");

    $("#catalogResults").innerHTML = "";
    status("검색 중…");

    const key = getKey();
    const isKorean = /[가-힣]/.test(query);

    const requests = [];

    if (key) {
      requests.push(
        searchAladin(query, key, "Title"),
        searchAladin(query, key, "Keyword")
      );
    } else {
      requests.push(Promise.resolve([]), Promise.resolve([]));
    }

    requests.push(searchOpenLibrary(query, isKorean));

    const [aladinTitle, aladinKeyword, openLibrary] = await Promise.allSettled(requests);

    const titleItems = aladinTitle.status === "fulfilled" ? aladinTitle.value : [];
    const keywordItems = aladinKeyword.status === "fulfilled" ? aladinKeyword.value : [];
    const olItems = openLibrary.status === "fulfilled" ? openLibrary.value : [];

    const aladinItems = dedupe([...titleItems, ...keywordItems]);
    const combined = dedupe([...aladinItems, ...olItems]);

    const items = rankResults(combined, query, isKorean).slice(0, 24);

    const aladinFailed = key
      && aladinTitle.status === "rejected"
      && aladinKeyword.status === "rejected";

    const olFailed = openLibrary.status === "rejected";

    if (!items.length) {
      if (!key && isKorean) {
        status("국내 도서 검색에는 알라딘 TTB KEY가 필요합니다. 키를 저장하거나 웹에서 더 찾아보세요.");
        return;
      }

      if (aladinFailed && olFailed) {
        status("검색 서비스에 연결하지 못했습니다. 잠시 후 다시 시도하거나 웹에서 더 찾아보세요.");
        return;
      }

      if (aladinFailed) {
        status("알라딘 연결에 실패했고 Open Library에서도 결과를 찾지 못했습니다.");
        return;
      }

      status("검색 결과가 없습니다. 웹에서 더 찾아보세요.");
      return;
    }

    const sourceNames = [];
    if (aladinItems.length) sourceNames.push(`알라딘 ${aladinItems.length}`);
    if (olItems.length) sourceNames.push(`Open Library ${olItems.length}`);

    status(`${items.length}권 · ${sourceNames.join(" + ")}`);
    render(items);
  }

  function searchAladin(query, key, queryType){
    return new Promise((resolve, reject) => {
      const callbackName = `__readingArchiveAladin_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
      const script = document.createElement("script");
      let settled = false;

      const cleanup = () => {
        if (script.parentNode) script.parentNode.removeChild(script);
        try { delete window[callbackName]; }
        catch (_) { window[callbackName] = undefined; }
      };

      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cleanup();
        fn(value);
      };

      window[callbackName] = (first, second) => {
        const hasTwoArgs = typeof second !== "undefined";
        const success = hasTwoArgs ? first !== false : true;
        const data = hasTwoArgs ? second : first;

        if (!success) {
          finish(reject, new Error("Aladin API returned failure"));
          return;
        }

        const rawItems = Array.isArray(data?.item) ? data.item : [];

        finish(resolve, rawItems.map((item) => {
          const isbn13 = String(item.isbn13 || item.isbn || "").trim();
          const pageCount = Number(item?.subInfo?.itemPage || item?.itemPage || 0);
          const categoryName = String(item.categoryName || "").trim();

          return {
            title:tidyTitle(item.title),
            author:String(item.author || "").trim(),
            publisher:String(item.publisher || "").trim(),
            isbn13,
            pageCount,
            cover:secure(item.cover || ""),
            sourceUrl:String(item.link || "").trim(),
            sourceType:"aladin",
            sourceId:isbn13 || String(item.itemId || "").trim(),
            sourceLabel:"알라딘",
            categoryName,
            queryType
          };
        }));
      };

      const params = new URLSearchParams({
        ttbkey:key,
        Query:query,
        QueryType:queryType,
        MaxResults:"25",
        start:"1",
        SearchTarget:"Book",
        output:"js",
        Version:"20131101",
        Cover:"Big",
        CallBack:callbackName
      });

      script.async = true;
      script.src = `${ALADIN_SEARCH_URL}?${params.toString()}`;
      script.onerror = () => finish(reject, new Error("Aladin JSONP script failed"));

      const timer = setTimeout(() => {
        finish(reject, new Error("Aladin JSONP timeout"));
      }, 12000);

      document.head.appendChild(script);
    });
  }

  async function searchOpenLibrary(query, preferKorean){
    const params = new URLSearchParams({
      q:query,
      limit:"12",
      fields:"key,title,author_name,isbn,publisher,cover_i,number_of_pages_median,number_of_pages"
    });

    if (preferKorean) params.set("lang", "ko");

    const res = await fetch(`${OPEN_LIBRARY_URL}?${params.toString()}`, {
      mode:"cors",
      credentials:"omit",
      cache:"no-store"
    });

    if (!res.ok) throw new Error(`Open Library HTTP ${res.status}`);

    const data = await res.json();
    const docs = Array.isArray(data?.docs) ? data.docs : [];

    return docs.map((doc) => {
      const isbns = Array.isArray(doc.isbn) ? doc.isbn : [];
      const isbn13 = isbns.find(x => /^\d{13}$/.test(String(x))) || isbns[0] || "";
      const publishers = Array.isArray(doc.publisher) ? doc.publisher : [];
      const pages = Number(
        doc.number_of_pages_median
        || (Array.isArray(doc.number_of_pages) ? doc.number_of_pages[0] : doc.number_of_pages)
        || 0
      );

      return {
        title:String(doc.title || "Untitled").trim(),
        author:Array.isArray(doc.author_name) ? doc.author_name.join(", ") : "",
        publisher:String(publishers[0] || "").trim(),
        isbn13:String(isbn13 || "").trim(),
        pageCount:pages,
        cover:doc.cover_i
          ? `https://covers.openlibrary.org/b/id/${encodeURIComponent(doc.cover_i)}-L.jpg`
          : "",
        sourceUrl:doc.key ? `https://openlibrary.org${doc.key}` : "",
        sourceType:"open-library",
        sourceId:String(doc.key || "").trim(),
        sourceLabel:"Open Library",
        categoryName:"",
        queryType:""
      };
    });
  }

  function rankResults(items, query, isKorean){
    const nq = normalizeText(query);

    return [...items]
      .map((item, index) => {
        let score = 0;
        const nt = normalizeText(item.title);
        const na = normalizeText(item.author);
        const category = item.categoryName || "";

        if (item.sourceType === "aladin") score += 1000;
        if (item.sourceType === "open-library") score -= isKorean ? 500 : 0;

        if (item.queryType === "Title") score += 180;
        if (nt === nq) score += 500;
        else if (nt.includes(nq)) score += 260;
        else if (nq.includes(nt) && nt.length >= 3) score += 120;

        if (na.includes(nq)) score += 140;

        if (isKorean && /[가-힣]/.test(item.title)) score += 160;
        if (isKorean && /[가-힣]/.test(item.author)) score += 60;

        if (/국내도서/.test(category)) score += 500;
        if (/외국도서|외서/.test(category)) score -= 500;

        if (item.publisher) score += 20;
        if (item.cover) score += 15;
        if (item.isbn13) score += 10;

        return {...item, _score:score, _index:index};
      })
      .sort((a,b) => b._score - a._score || a._index - b._index);
  }

  function dedupe(items){
    const seen = new Set();
    const out = [];

    for (const item of items) {
      const isbn = normalizeISBN(item.isbn13);
      const textKey = `${normalizeText(item.title)}|${normalizeText(item.author)}|${normalizeText(item.publisher)}`;
      const key = isbn || textKey;

      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }

    return out;
  }

  function editionLabel(item){
    const category = item.categoryName || "";

    if (/국내도서/.test(category)) return "국내판";
    if (/외국도서|외서/.test(category)) return "해외판";
    if (item.sourceType === "open-library") return "해외 DB";
    return "";
  }

  function render(items){
    const list = $("#catalogResults");
    list.innerHTML = "";

    items.forEach((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "catalog-item";

      let cover;
      if (item.cover) {
        cover = document.createElement("img");
        cover.className = "catalog-cover";
        cover.alt = "";
        cover.loading = "lazy";
        cover.referrerPolicy = "no-referrer";
        cover.src = item.cover;
      } else {
        cover = document.createElement("span");
        cover.className = "catalog-cover empty";
        cover.textContent = "NO COVER";
      }

      const copy = document.createElement("span");
      copy.className = "catalog-copy";

      const title = document.createElement("span");
      title.className = "catalog-title";
      title.textContent = item.title;

      const meta = document.createElement("span");
      meta.className = "catalog-meta";
      meta.textContent = [
        item.author,
        item.publisher,
        item.isbn13 ? `ISBN ${item.isbn13}` : ""
      ].filter(Boolean).join(" · ");

      const sourceWrap = document.createElement("span");
      sourceWrap.className = "catalog-source";
      sourceWrap.textContent = item.sourceLabel;

      const edition = document.createElement("span");
      edition.className = "catalog-edition";
      edition.textContent = editionLabel(item);
      sourceWrap.appendChild(edition);

      copy.append(title, meta);
      button.append(cover, copy, sourceWrap);
      button.addEventListener("click", () => select(item));
      list.appendChild(button);
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

    if (Number(item.pageCount) > 0) {
      $("#newPageCount").value = String(Math.round(item.pageCount));
    }

    source.textContent = [
      item.publisher,
      item.isbn13 ? `ISBN ${item.isbn13}` : "",
      item.sourceLabel,
      editionLabel(item)
    ].filter(Boolean).join(" · ");

    $("#catalogResults").innerHTML = "";
    status(`선택됨 · ${item.sourceLabel}`);

    if (!item.cover) {
      source.textContent += " · 표지는 직접 첨부";
      return;
    }

    try {
      $("#catalogStatus").dataset.importing = "1";

      const res = await fetch(item.cover, {
        mode:"cors",
        credentials:"omit",
        cache:"force-cache"
      });

      if (!res.ok) throw new Error(`cover HTTP ${res.status}`);

      const blob = await res.blob();
      const file = new File([blob], "catalog-cover.jpg", {
        type:blob.type || "image/jpeg"
      });

      const dt = new DataTransfer();
      dt.items.add(file);
      $("#coverUpload").files = dt.files;
      $("#coverUpload").dispatchEvent(new Event("change", {bubbles:true}));

      setTimeout(() => {
        delete $("#catalogStatus").dataset.importing;
        selectedMeta = {
          title:item.title,
          author:item.author,
          publisher:item.publisher,
          isbn13:item.isbn13,
          sourceUrl:item.sourceUrl,
          sourceType:item.sourceType,
          sourceId:item.sourceId
        };
        source.textContent = [
          item.publisher,
          item.isbn13 ? `ISBN ${item.isbn13}` : "",
          item.sourceLabel,
          editionLabel(item)
        ].filter(Boolean).join(" · ");
      }, 100);

    } catch (err) {
      delete $("#catalogStatus").dataset.importing;
      console.warn("Cover import blocked", err);

      source.textContent = [
        item.publisher,
        item.isbn13 ? `ISBN ${item.isbn13}` : "",
        item.sourceLabel,
        editionLabel(item),
        "표지는 직접 첨부"
      ].filter(Boolean).join(" · ");
    }
  }

  function openWebSearch(e){
    e.preventDefault();

    const query =
      ($("#catalogQuery").value || "").trim()
      || ($("#newBookTitle")?.value || "").trim();

    if (!query) return status("웹에서 찾을 책을 먼저 입력하세요.");

    window.open(
      `https://www.google.com/search?q=${encodeURIComponent(query + " 책")}`,
      "_blank",
      "noopener,noreferrer"
    );
  }

  function attachMetadata(meta){
    try {
      const storageKey = "reading-archive-minimal-v5";
      const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (!Array.isArray(saved?.books)) return;

      const book = [...saved.books]
        .reverse()
        .find(b => b.title === meta.title && b.author === meta.author);

      if (!book) return;

      Object.assign(book, {
        isbn13:meta.isbn13,
        publisher:meta.publisher,
        sourceUrl:meta.sourceUrl,
        sourceType:meta.sourceType,
        sourceId:meta.sourceId
      });

      localStorage.setItem(storageKey, JSON.stringify(saved));
    } catch (_) {}
  }

  function status(text){
    $("#catalogStatus").textContent = text;
  }

  function secure(url){
    const value = String(url || "").trim();
    return value.startsWith("http://")
      ? `https://${value.slice(7)}`
      : value;
  }

  function tidyTitle(title){
    return String(title || "Untitled")
      .replace(/\s*-\s*\[[^\]]+\]\s*$/g, "")
      .trim();
  }

  function normalizeISBN(value){
    return String(value || "")
      .replace(/[^0-9Xx]/g, "")
      .toUpperCase();
  }

  function normalizeText(value){
    return String(value || "")
      .toLocaleLowerCase()
      .replace(/\s+/g, "")
      .replace(/[^\p{L}\p{N}]/gu, "");
  }
})();