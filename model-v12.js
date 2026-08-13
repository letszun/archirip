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
  if (document.querySelector('script[data-catalog-v16]')) return;
  const script = document.createElement("script");
  script.src = "./catalog-v16.js";
  script.dataset.catalogV16 = "1";
  document.body.appendChild(script);
});
