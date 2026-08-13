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
  if (!document.querySelector('script[data-catalog-v18]')) {
    const script = document.createElement("script");
    script.src = "./catalog-v18.js";
    script.dataset.catalogV18 = "1";
    document.body.appendChild(script);
  }

  if (!document.querySelector('script[data-settings-v19]')) {
    const settings = document.createElement("script");
    settings.src = "./settings-v19.js";
    settings.dataset.settingsV19 = "1";
    document.body.appendChild(settings);
  }

  if (!document.querySelector('script[data-zoom-v20]')) {
    const zoom = document.createElement("script");
    zoom.src = "./zoom-v20.js?v=20";
    zoom.dataset.zoomV20 = "1";
    document.body.appendChild(zoom);
  }
});
