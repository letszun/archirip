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
  if (document.querySelector('script[data-catalog-v17]')) return;
  const script = document.createElement("script");
  script.src = "./catalog-v17.js";
  script.dataset.catalogV17 = "1";
  document.body.appendChild(script);
});
