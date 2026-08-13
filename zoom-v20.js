(() => {
  const viewport = document.querySelector('meta[name="viewport"]');
  if (viewport) viewport.content = "width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover";
  const style = document.createElement("style");
  style.textContent = "@media (max-width:700px){input,textarea,select{font-size:16px}}";
  document.head.appendChild(style);
})();
