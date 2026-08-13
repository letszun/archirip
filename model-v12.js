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
  if (document.querySelector('script[data-catalog-v18]')) return;
  const script = document.createElement("script");
  script.src = "./catalog-v18.js";
  script.dataset.catalogV18 = "1";
  document.body.appendChild(script);
});
