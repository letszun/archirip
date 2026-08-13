(() => {
  "use strict";

  const KEY_STORAGE = "reading-archive-aladin-ttb-key-v1";
  const SEARCH_URL = "https://www.aladin.co.kr/ttb/api/ItemSearch.aspx";
  const $ = (s) => document.querySelector(s);

  if (!$("#catalogSearchButton")) return;

  let selectedMeta = null;

  syncKey();
  $("#catalogSearchButton").addEventListener("click", search);
  $("#catalogQuery").addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      search();
    }
  });
  $("#saveCatalogKey").addEventListener("click", saveKey);
  $("#coverUpload").addEventListener("change", () => {
    selectedMeta = null;
    $("#selectedSource").textContent = "";
  });

  $("#openAdd")?.addEventListener("click", () => {
    syncKey();
    $("#catalogResults").innerHTML = "";
    $("#catalogStatus").textContent = "";
    selectedMeta = null;
    setTimeout(() => $("#catalogQuery")?.focus(), 100);
  });

  // Preserve catalog metadata as extra local fields after the core app adds the book.
  $("#addForm").addEventListener("submit", () => {
    if (!selectedMeta) return;
    const meta = {...selectedMeta};
    setTimeout(() => attachMetadata(meta), 0);
  });

  function getKey(){
    try { return localStorage.getItem(KEY_STORAGE) || ""; }
    catch (_) { return ""; }
  }

  function syncKey(){
    $("#catalogKey").value = getKey();
  }

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

    if (!query) {
      $("#catalogStatus").textContent = "검색어를 입력하세요.";
      return;
    }
    if (!key) {
      $("#catalogStatus").textContent = "먼저 알라딘 TTB KEY를 입력하세요.";
      $("#catalogKey").focus();
      return;
    }

    $("#catalogResults").innerHTML = "";
    $("#catalogStatus").textContent = "검색 중…";

    const params = new URLSearchParams({
      ttbkey:key,
      Query:query,
      QueryType:"Keyword",
      MaxResults:"12",
      start:"1",
      SearchTarget:"Book",
      output:"js",
      Version:"20131101",
      Cover:"Big"
    });

    try {
      const res = await fetch(`${SEARCH_URL}?${params}`, {
        mode:"cors",
        credentials:"omit",
        cache:"no-store"
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = parse(await res.text());
      const items = Array.isArray(data?.item) ? data.item : [];
      if (!items.length) {
        $("#catalogStatus").textContent = "검색 결과가 없습니다.";
        return;
      }
      $("#catalogStatus").textContent = `${items.length}권`;
      render(items);
    } catch (err) {
      console.error(err);
      $("#catalogStatus").textContent =
        "브라우저에서 알라딘 검색 연결이 막혔습니다. 직접 등록은 계속 사용할 수 있습니다.";
    }
  }

  function parse(text){
    const clean = String(text || "").replace(/^\uFEFF/, "").trim();
    try { return JSON.parse(clean); } catch (_) {}
    const a = clean.indexOf("{");
    const b = clean.lastIndexOf("}");
    if (a >= 0 && b > a) return JSON.parse(clean.slice(a, b + 1));
    throw new Error("Unexpected Aladin response");
  }

  function render(items){
    const list = $("#catalogResults");
    list.innerHTML = "";

    items.forEach(item => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "catalog-item";

      const img = document.createElement("img");
      img.className = "catalog-cover";
      img.alt = "";
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      img.src = secure(item.cover);

      const copy = document.createElement("span");
      copy.className = "catalog-copy";

      const title = document.createElement("span");
      title.className = "catalog-title";
      title.textContent = tidyTitle(item.title);

      const meta = document.createElement("span");
      meta.className = "catalog-meta";
      meta.textContent = [item.author, item.publisher, item.pubDate].filter(Boolean).join(" · ");

      copy.append(title, meta);
      button.append(img, copy);
      button.addEventListener("click", () => select(item));
      list.appendChild(button);
    });
  }

  async function select(item){
    const title = tidyTitle(item.title);
    const author = String(item.author || "").trim();
    const publisher = String(item.publisher || "").trim();
    const isbn13 = String(item.isbn13 || item.isbn || "").trim();
    const sourceUrl = String(item.link || "").trim();
    const pageCount = Number(item?.subInfo?.itemPage || item?.itemPage || 0);
    const cover = secure(item.cover);

    $("#newBookTitle").value = title;
    $("#newBookAuthor").value = author;
    if (pageCount > 0) $("#newPageCount").value = String(Math.round(pageCount));

    selectedMeta = {title, author, publisher, isbn13, sourceUrl};

    $("#selectedSource").textContent =
      [publisher, isbn13 ? `ISBN ${isbn13}` : ""].filter(Boolean).join(" · ");
    $("#catalogStatus").textContent = "선택됨";
    $("#catalogResults").innerHTML = "";

    if (!cover) return;

    // Route the remote cover through the existing upload pipeline. That keeps
    // dominant-color extraction and cover-ratio modeling exactly as before.
    try {
      const res = await fetch(cover, {mode:"cors", credentials:"omit"});
      if (!res.ok) throw new Error(`cover HTTP ${res.status}`);
      const blob = await res.blob();
      const ext = blob.type.includes("png") ? "png" : "jpg";
      const file = new File([blob], `aladin-cover.${ext}`, {type:blob.type || "image/jpeg"});
      const dt = new DataTransfer();
      dt.items.add(file);
      $("#coverUpload").files = dt.files;
      $("#coverUpload").dispatchEvent(new Event("change", {bubbles:true}));
      // The core change handler clears source text, so restore it after it finishes.
      setTimeout(() => {
        $("#selectedSource").textContent =
          [publisher, isbn13 ? `ISBN ${isbn13}` : ""].filter(Boolean).join(" · ");
      }, 50);
    } catch (err) {
      console.warn("Cover import blocked", err);
      $("#selectedSource").textContent =
        [publisher, isbn13 ? `ISBN ${isbn13}` : "", "표지는 직접 첨부"].filter(Boolean).join(" · ");
    }
  }

  function attachMetadata(meta){
    const STORAGE_KEY = "reading-archive-minimal-v5";
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!Array.isArray(saved?.books) || !saved.books.length) return;
      const book = [...saved.books].reverse().find(b =>
        String(b.title || "") === meta.title &&
        String(b.author || "") === meta.author
      );
      if (!book) return;
      book.isbn13 = meta.isbn13;
      book.publisher = meta.publisher;
      book.sourceUrl = meta.sourceUrl;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    } catch (_) {}
  }

  function secure(url){
    const s = String(url || "").trim();
    return s.startsWith("http://") ? `https://${s.slice(7)}` : s;
  }

  function tidyTitle(title){
    return String(title || "Untitled")
      .replace(/\s*-\s*\[[^\]]+\]\s*$/g, "")
      .trim();
  }
})();