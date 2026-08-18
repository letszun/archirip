(() => {
  "use strict";

  const KEY_STORAGE = "reading-archive-aladin-ttb-key-v1";
  const LOOKUP_URL = "https://www.aladin.co.kr/ttb/api/ItemLookUp.aspx";
  const $ = (s) => document.querySelector(s);

  const form = $("#addForm");
  const coverPicker = $("#coverPicker");
  const coverUpload = $("#coverUpload");
  if (!form || !coverPicker || !coverUpload || $("#isbnLookupInput")) return;

  const style = document.createElement("style");
  style.textContent = `
    .isbn-box{display:grid;gap:8px;margin-bottom:2px}
    .isbn-row,.isbn-key-row{display:flex;align-items:center;gap:9px;border-bottom:1px solid var(--line)}
    .isbn-row input,.isbn-key-row input{flex:1;min-width:0;padding:10px 2px 9px;text-align:center;font-size:13px}
    .isbn-row button,.isbn-key-row button{flex:0 0 auto;padding:8px 2px 8px 8px;font-size:9px;color:var(--muted);white-space:nowrap}
    .isbn-key-row.hidden{display:none}
    .isbn-status{min-height:14px;text-align:center;font-size:9px;line-height:1.5;color:var(--muted)}
    .isbn-status.ok{color:var(--ink)}
  `;
  document.head.appendChild(style);

  const box = document.createElement("div");
  box.className = "isbn-box";
  box.innerHTML = `
    <div class="isbn-row">
      <input id="isbnLookupInput" type="text" inputmode="numeric" autocomplete="off" maxlength="17" placeholder="ISBN 13자리">
      <button id="isbnLookupButton" type="button">불러오기</button>
    </div>
    <div id="isbnKeyRow" class="isbn-key-row hidden">
      <input id="isbnKeyInput" type="password" autocomplete="off" placeholder="알라딘 TTB KEY">
      <button id="isbnKeySave" type="button">키 저장</button>
    </div>
    <div id="isbnLookupStatus" class="isbn-status"></div>
  `;
  form.insertBefore(box, coverPicker);

  const input = $("#isbnLookupInput");
  const button = $("#isbnLookupButton");
  const keyRow = $("#isbnKeyRow");
  const keyInput = $("#isbnKeyInput");
  const keySave = $("#isbnKeySave");
  const status = $("#isbnLookupStatus");

  syncKeyUI();

  button.addEventListener("click", lookup);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      lookup();
    }
  });
  input.addEventListener("input", () => {
    input.value = formatISBNInput(input.value);
  });
  keySave.addEventListener("click", saveKey);

  $("#openAdd")?.addEventListener("click", () => {
    setTimeout(() => {
      input.value = "";
      setStatus("");
      syncKeyUI();
    }, 40);
  });

  function getKey(){
    try { return localStorage.getItem(KEY_STORAGE) || ""; }
    catch (_) { return ""; }
  }

  function saveKey(){
    const key = String(keyInput.value || "").trim();
    try {
      if (key) localStorage.setItem(KEY_STORAGE, key);
      else localStorage.removeItem(KEY_STORAGE);
    } catch (_) {}
    syncKeyUI();
    setStatus(key ? "알라딘 키를 이 브라우저에 저장했습니다.", true : "알라딘 키가 필요합니다.");
  }

  function syncKeyUI(){
    const key = getKey();
    keyRow.classList.toggle("hidden", Boolean(key));
    if (!key) keyInput.value = "";
  }

  async function lookup(){
    const isbn = normalizeISBN(input.value);
    if (isbn.length !== 13 || !/^\d{13}$/.test(isbn)) {
      setStatus("ISBN 13자리를 확인해 주세요.");
      return;
    }

    const key = getKey();
    if (!key) {
      keyRow.classList.remove("hidden");
      keyInput.focus();
      setStatus("처음 한 번만 알라딘 TTB KEY를 저장해 주세요.");
      return;
    }

    button.disabled = true;
    setStatus("ISBN으로 책을 확인하는 중…");

    try {
      const item = await lookupAladin(isbn, key);
      if (!item) {
        setStatus("이 ISBN에 해당하는 책을 찾지 못했습니다. 직접 등록해 주세요.");
        return;
      }

      $("#newBookTitle").value = item.title || "";
      $("#newBookAuthor").value = item.author || "";
      if (item.pageCount > 0) $("#newPageCount").value = String(item.pageCount);

      if (item.cover) {
        const coverLoaded = await importCover(item.cover, isbn);
        if (coverLoaded) {
          setStatus("책 정보와 표지를 불러왔습니다. 확인 후 등록해 주세요.", true);
        } else {
          setStatus("책 정보는 불러왔습니다. 표지만 직접 첨부해 주세요.", true);
        }
      } else {
        setStatus("책 정보는 불러왔습니다. 표지는 직접 첨부해 주세요.", true);
      }
    } catch (error) {
      console.warn("ISBN lookup failed", error);
      setStatus("ISBN 조회에 실패했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      button.disabled = false;
    }
  }

  function lookupAladin(isbn, key){
    return new Promise((resolve, reject) => {
      const callbackName = `__archiripISBN_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
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
        if (!success) return finish(reject, new Error("Aladin lookup returned failure"));

        const raw = Array.isArray(data?.item) ? data.item[0] : null;
        if (!raw) return finish(resolve, null);

        const pageCount = Number(raw?.subInfo?.itemPage || raw?.itemPage || 0);
        finish(resolve, {
          title:tidyTitle(raw.title),
          author:String(raw.author || "").trim(),
          publisher:String(raw.publisher || "").trim(),
          pageCount:Number.isFinite(pageCount) ? Math.max(0, Math.round(pageCount)) : 0,
          cover:secure(raw.cover || ""),
          isbn13:String(raw.isbn13 || raw.isbn || isbn).trim()
        });
      };

      const params = new URLSearchParams({
        ttbkey:key,
        itemIdType:"ISBN13",
        ItemId:isbn,
        output:"js",
        Version:"20131101",
        Cover:"Big",
        OptResult:"ebookList,usedList,reviewList",
        CallBack:callbackName
      });

      script.async = true;
      script.src = `${LOOKUP_URL}?${params.toString()}`;
      script.onerror = () => finish(reject, new Error("Aladin lookup script failed"));

      const timer = setTimeout(() => finish(reject, new Error("Aladin lookup timeout")), 12000);
      document.head.appendChild(script);
    });
  }

  async function importCover(url, isbn){
    try {
      const response = await fetch(url, {mode:"cors",credentials:"omit",cache:"force-cache"});
      if (!response.ok) throw new Error(`cover HTTP ${response.status}`);
      const blob = await response.blob();
      const file = new File([blob], `${isbn}.jpg`, {type:blob.type || "image/jpeg"});
      const transfer = new DataTransfer();
      transfer.items.add(file);
      coverUpload.files = transfer.files;
      coverUpload.dispatchEvent(new Event("change", {bubbles:true}));
      return true;
    } catch (error) {
      console.warn("ISBN cover import failed", error);
      return false;
    }
  }

  function setStatus(text, ok=false){
    status.textContent = text;
    status.classList.toggle("ok", Boolean(ok));
  }

  function normalizeISBN(value){
    return String(value || "").replace(/[^0-9]/g, "").slice(0, 13);
  }

  function formatISBNInput(value){
    return String(value || "").replace(/[^0-9-]/g, "").slice(0, 17);
  }

  function tidyTitle(title){
    return String(title || "Untitled").replace(/\s*-\s*\[[^\]]+\]\s*$/g, "").trim();
  }

  function secure(url){
    const value = String(url || "").trim();
    return value.startsWith("http://") ? `https://${value.slice(7)}` : value;
  }
})();
