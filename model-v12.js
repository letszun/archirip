window.BOOK_MODEL_DATA = {
  height: 3.15,
  defaultAspect: 143 / 210,
  referenceHeightMm: 210,
  minThicknessMm: 8,
  maxThicknessMm: 60,
  coverInsetX: 0.018,
  coverInsetY: 0.014
};

window.addEventListener("load", () => {
  if (!document.querySelector('script[data-settings-v23]')) {
    const settings = document.createElement("script");
    settings.src = "./settings-v23.js?v=23";
    settings.dataset.settingsV23 = "1";
    document.body.appendChild(settings);
  }

  if (!document.querySelector('script[data-zoom-v20]')) {
    const zoom = document.createElement("script");
    zoom.src = "./zoom-v20.js?v=20";
    zoom.dataset.zoomV20 = "1";
    document.body.appendChild(zoom);
  }

  if (!document.querySelector('script[data-state-v22]')) {
    const state = document.createElement("script");
    state.src = "./state-v22.js?v=22";
    state.dataset.stateV22 = "1";
    document.body.appendChild(state);
  }

  if (!document.querySelector('script[data-isbn-v23]')) {
    const isbn = document.createElement("script");
    isbn.src = "./isbn-v23.js?v=23";
    isbn.dataset.isbnV23 = "1";
    document.body.appendChild(isbn);
  }
});
