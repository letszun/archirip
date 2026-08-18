(() => {
  "use strict";

  const STORAGE_KEY = "reading-archive-minimal-v5";
  const ACTIVE_BOOK_KEY = "reading-archive-active-book-v22";
  const $ = (s) => document.querySelector(s);

  function readBooks(){
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      return Array.isArray(saved?.books) ? saved.books : [];
    } catch (_) {
      return [];
    }
  }

  function saveActive(id){
    try {
      if (id) localStorage.setItem(ACTIVE_BOOK_KEY, String(id));
      else localStorage.removeItem(ACTIVE_BOOK_KEY);
    } catch (_) {}
  }

  function getSavedActive(){
    try { return localStorage.getItem(ACTIVE_BOOK_KEY) || ""; }
    catch (_) { return ""; }
  }

  function visibleBooks(){
    const books = readBooks();
    const query = ($("#searchInput")?.value || "").trim().toLocaleLowerCase();
    if (!query) return books;

    return books.filter((book) => {
      const haystack = `${book?.title || ""} ${book?.author || ""}`.toLocaleLowerCase();
      return haystack.includes(query);
    });
  }

  function rememberShelfClick(event){
    const spine = event.target.closest?.(".spine");
    const track = $("#shelfTrack");
    if (!spine || !track?.contains(spine)) return;

    const buttons = [...track.querySelectorAll(".spine")];
    const index = buttons.indexOf(spine);
    const book = visibleBooks()[index];
    if (book?.id) saveActive(book.id);
  }

  function rememberNewestBook(){
    setTimeout(() => {
      const books = readBooks();
      const book = books[books.length - 1];
      if (book?.id) saveActive(book.id);
    }, 0);
  }

  function repairAfterDelete(){
    setTimeout(() => {
      const books = readBooks();
      const active = getSavedActive();
      if (active && books.some((book) => String(book?.id) === active)) return;
      saveActive(books[0]?.id || "");
    }, 0);
  }

  function restoreLastBook(){
    const books = readBooks();
    if (!books.length) {
      saveActive("");
      return;
    }

    const savedId = getSavedActive();
    const index = savedId
      ? books.findIndex((book) => String(book?.id) === savedId)
      : -1;

    const targetIndex = index >= 0 ? index : 0;
    const targetId = books[targetIndex]?.id;
    if (targetId) saveActive(targetId);

    requestAnimationFrame(() => {
      const track = $("#shelfTrack");
      const button = track?.querySelectorAll(".spine")?.[targetIndex];
      button?.click();
    });
  }

  $("#shelfTrack")?.addEventListener("click", rememberShelfClick);
  $("#addForm")?.addEventListener("submit", rememberNewestBook);
  $("#deleteBook")?.addEventListener("click", repairAfterDelete);

  restoreLastBook();
})();
