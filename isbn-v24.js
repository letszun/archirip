(() => {
  "use strict";

  if (window.__ARCHIRIP_ISBN_V24__) return;
  window.__ARCHIRIP_ISBN_V24__ = true;

  const KEY_STORAGE = "reading-archive-aladin-ttb-key-v1";
  const LOOKUP_URL = "https://www.aladin.co.kr/ttb/api/ItemLookUp.aspx";
  const $ = (selector) => document.querySelector(selector);

  const input = $("#isbnLookupInput");
  const button = $("#isbnLookupButton");
  const keyRow = $("#isbnKeyRow");
  const keyInput = $("#isbnKeyInput");
  const keySave = $("#isbnKeySave");
  const status = $("#isbnLookupStatus");
  const coverUpload = $("#coverUpload");

  if (!input || !button || !keyRow || !keyInput || !keySave || !status || !coverUpload) {
    console.warn("ARCHIRIP v24 ISBN UI is missing.");
    return;
  }

  syncKeyUI();

  button.addEventListener("click", lookup);
  keySave.addEventListener("click", saveKey);

  input.addEventListener("input", () => {
    input.value = String(input.value || "").replace(/[^0-9-]/g, "").slice(0, 17);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      lookup();
    }
  });

  $("#openAdd")?.addEventListener("click", () => {
    setTimeout(() => {
      input.value = "";
      setStatus("");
      syncKeyUI();
    }, 0);
  });

  function getKey() {
    try {
      return localStorage.getItem(KEY_STORAGE) || "";
    } catch (_) {
      return "";
    }
  }

  function saveKey() {
    const key = String(keyInput.value || "").trim();

    try {
      if (key) localStorage.setItem(KEY_STORAGE, key);
      else localStorage.removeItem(KEY_STORAGE);
    } catch (_) {}

    syncKeyUI();
    setStatus(
      key ? "알라딘 키를 이 브라우저에 저장했습니다." : "알라딘 TTB KEY가 필요합니다.",
      Boolean(key)
    );
  }

  function syncKeyUI() {
    const hasKey = Boolean(getKey());
    keyRow.classList.toggle("hidden", hasKey);
    if (!hasKey) keyInput.value = "";
  }

  async function lookup() {
    const isbn = normalizeISBN(input.value);

    if (!isValidISBN13(isbn)) {
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
        setStatus("이 ISBN의 책을 찾지 못했습니다. 직접 등록해 주세요.");
        return;
      }

      $("#newBookTitle").value = item.title || "";
      $("#newBookAuthor").value = item.author || "";

      if (item.pageCount > 0) {
        $("#newPageCount").value = String(item.pageCount);
      }

      if (!item.cover) {
        setStatus("책 정보는 불러왔습니다. 표지는 직접 첨부해 주세요.", true);
        return;
      }

      const coverLoaded = await importCover(item.cover, isbn);
      setStatus(
        coverLoaded
          ? "책 정보와 표지를 불러왔습니다. 확인 후 등록해 주세요."
          : "책 정보는 불러왔습니다. 표지만 직접 첨부해 주세요.",
        true
      );
    } catch (error) {
      console.warn("ARCHIRIP ISBN lookup failed", error);
      setStatus("ISBN 조회에 실패했습니다. 키와 연결 상태를 확인해 주세요.");
    } finally {
      button.disabled = false;
    }
  }

  function lookupAladin(isbn, key) {
    return new Promise((resolve, reject) => {
      const callbackName =
        `__archiripISBN24_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const script = document.createElement("script");
      let settled = false;
      let timer = 0;

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        script.remove();
        try {
          delete window[callbackName];
        } catch (_) {
          window[callbackName] = undefined;
        }
      };

      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        fn(value);
      };

      window[callbackName] = (first, second) => {
        const hasTwoArgs = typeof second !== "undefined";
        const success = hasTwoArgs ? first !== false : true;
        const data = hasTwoArgs ? second : first;

        if (!success) {
          finish(reject, new Error("Aladin ItemLookUp returned failure"));
          return;
        }

        const raw = Array.isArray(data?.item) ? data.item[0] : null;
        if (!raw) {
          finish(resolve, null);
          return;
        }

        const pageCount = Number(raw?.subInfo?.itemPage || raw?.itemPage || 0);

        finish(resolve, {
          title: tidyTitle(raw.title),
          author: String(raw.author || "").trim(),
          pageCount: Number.isFinite(pageCount) ? Math.max(0, Math.round(pageCount)) : 0,
          cover: secureURL(raw.cover || "")
        });
      };

      const params = new URLSearchParams({
        ttbkey: key,
        itemIdType: "ISBN13",
        ItemId: isbn,
        output: "js",
        Version: "20131101",
        Cover: "Big",
        CallBack: callbackName
      });

      script.async = true;
      script.src = `${LOOKUP_URL}?${params.toString()}`;
      script.onerror = () => finish(reject, new Error("Aladin ItemLookUp script failed"));

      timer = window.setTimeout(
        () => finish(reject, new Error("Aladin ItemLookUp timeout")),
        12000
      );

      document.head.appendChild(script);
    });
  }

  async function importCover(url, isbn) {
    try {
      const response = await fetch(url, {
        mode: "cors",
        credentials: "omit",
        cache: "force-cache"
      });

      if (!response.ok) throw new Error(`cover HTTP ${response.status}`);

      const blob = await response.blob();
      const file = new File([blob], `${isbn}.jpg`, {
        type: blob.type || "image/jpeg"
      });

      const transfer = new DataTransfer();
      transfer.items.add(file);
      coverUpload.files = transfer.files;
      coverUpload.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    } catch (error) {
      console.warn("ARCHIRIP ISBN cover import failed", error);
      return false;
    }
  }

  function setStatus(text, ok = false) {
    status.textContent = text;
    status.classList.toggle("ok", Boolean(ok));
  }

  function normalizeISBN(value) {
    return String(value || "").replace(/\D/g, "").slice(0, 13);
  }

  function isValidISBN13(isbn) {
    if (!/^\d{13}$/.test(isbn)) return false;

    const sum = isbn
      .slice(0, 12)
      .split("")
      .reduce((total, digit, index) => {
        return total + Number(digit) * (index % 2 === 0 ? 1 : 3);
      }, 0);

    const check = (10 - (sum % 10)) % 10;
    return check === Number(isbn[12]);
  }

  function tidyTitle(title) {
    return String(title || "Untitled")
      .replace(/\s*-\s*\[[^\]]+\]\s*$/g, "")
      .trim();
  }

  function secureURL(url) {
    const value = String(url || "").trim();
    return value.startsWith("http://") ? `https://${value.slice(7)}` : value;
  }
})();