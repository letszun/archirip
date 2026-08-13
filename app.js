(() => {
  "use strict";

  const STORAGE_KEY = "reading-archive-minimal-v4";
  const DEFAULT_BOOKS = [{
    id:"gatsby",
    title:"The Great Gatsby",
    author:"F. Scott Fitzgerald",
    readDate:"",
    oneLine:"",
    memo:"",
    spineColor:"#0b465f"
  }];

  const $ = (s) => document.querySelector(s);
  const canvas = $("#bookCanvas");
  const ctx = canvas.getContext("2d", { alpha:false });
  const model = window.BOOK_MODEL_DATA;

  let books = loadSavedBooks();
  let activeBookId = books[0]?.id || "gatsby";
  let currentView = "single";
  let previousView = "single";

  let yaw = -0.44;
  let pitch = 0.06;
  let zoom = 1;
  let drag = null;
  let frameRequested = false;
  let projectedBounds = null;
  let coverReady = false;

  const coverImage = new Image();
  coverImage.decoding = "async";
  coverImage.onload = () => { coverReady = true; requestRender(); };
  coverImage.onerror = () => { coverReady = false; requestRender(); };
  coverImage.src = window.BOOK_COVER_DATA_URL || "";

  if (!ctx || !model?.meshes || !model?.cover) {
    showError("모델 데이터를 불러오지 못했습니다.");
    return;
  }

  initUI();
  resize();
  requestRender();

  // On GitHub Pages this replaces the fallback data. On file:// it simply fails silently.
  if (location.protocol !== "file:") {
    fetch("./books.json", { cache:"no-store" })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => {
        if (!localStorage.getItem(STORAGE_KEY) && Array.isArray(data?.books) && data.books.length) {
          books = data.books;
          activeBookId = books[0].id;
          buildShelf();
        }
      })
      .catch(() => {});
  }

  function initUI(){
    $("#toShelf").addEventListener("click", () => showView("shelf"));
    $("#toSingle").addEventListener("click", () => showView("single"));
    $("#backDetail").addEventListener("click", () => showView(previousView));

    ["#readDate", "#oneLine", "#memo"].forEach(sel => {
      $(sel).addEventListener("input", saveDetail);
    });

    buildShelf();

    canvas.addEventListener("pointerdown", (e) => {
      canvas.setPointerCapture?.(e.pointerId);
      drag = { id:e.pointerId, x:e.clientX, y:e.clientY, sx:e.clientX, sy:e.clientY, moved:false };
      canvas.classList.add("dragging");
    });

    canvas.addEventListener("pointermove", (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (Math.hypot(e.clientX-drag.sx, e.clientY-drag.sy) > 5) drag.moved = true;

      yaw += dx * 0.008;
      pitch = clamp(pitch + dy * 0.006, -1.05, 1.05);
      drag.x = e.clientX;
      drag.y = e.clientY;
      requestRender();
    });

    canvas.addEventListener("pointerup", (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      const moved = drag.moved;
      drag = null;
      canvas.classList.remove("dragging");
      if (!moved && hitProjectedBook(e.clientX, e.clientY)) showView("detail");
    });

    canvas.addEventListener("pointercancel", () => {
      drag = null;
      canvas.classList.remove("dragging");
    });

    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      zoom = clamp(zoom * (e.deltaY > 0 ? 0.92 : 1.08), 0.72, 1.6);
      requestRender();
    }, { passive:false });

    canvas.addEventListener("dblclick", () => {
      yaw = -0.44;
      pitch = 0.06;
      zoom = 1;
      requestRender();
    });

    window.addEventListener("resize", resize);
  }

  function buildShelf(){
    const shelf = $("#shelf");
    shelf.innerHTML = "";

    books.forEach((book, i) => {
      const b = document.createElement("button");
      b.className = "spine";
      b.type = "button";
      b.style.background = book.spineColor || "#111";
      b.style.width = `${34 + (i % 3) * 3}px`;
      b.setAttribute("aria-label", `${book.title} 열기`);

      const title = document.createElement("span");
      title.textContent = book.title;
      b.appendChild(title);

      b.addEventListener("click", () => {
        activeBookId = book.id;
        showView("single");
        requestRender();
      });

      shelf.appendChild(b);
    });
  }

  function showView(name){
    const single = $("#singleView");
    const shelf = $("#shelfView");
    const detail = $("#detailView");

    if (name === "detail") {
      previousView = currentView;
      populateDetail();
    }

    if (name === "single") {
      single.className = "view current";
      shelf.className = "view off-right";
      detail.className = "view off-right";
      currentView = "single";
      requestRender();
    } else if (name === "shelf") {
      single.className = "view off-left";
      shelf.className = "view current";
      detail.className = "view off-right";
      currentView = "shelf";
    } else if (name === "detail") {
      if (currentView === "shelf") shelf.className = "view off-left";
      else single.className = "view off-left";
      detail.className = "view current";
      currentView = "detail";
    }
  }

  function populateDetail(){
    const b = getBook();
    if (!b) return;
    $("#readDate").value = b.readDate || "";
    $("#oneLine").value = b.oneLine || "";
    $("#memo").value = b.memo || "";
  }

  function saveDetail(){
    const b = getBook();
    if (!b) return;
    b.readDate = $("#readDate").value;
    b.oneLine = $("#oneLine").value;
    b.memo = $("#memo").value;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({books})); } catch (_) {}
  }

  function getBook(){
    return books.find(b => b.id === activeBookId) || books[0];
  }

  function loadSavedBooks(){
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (Array.isArray(saved?.books) && saved.books.length) return saved.books;
    } catch (_) {}
    return DEFAULT_BOOKS.map(b => ({...b}));
  }

  function resize(){
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    requestRender();
  }

  function requestRender(){
    if (frameRequested) return;
    frameRequested = true;
    requestAnimationFrame(() => {
      frameRequested = false;
      if (currentView === "single") render();
    });
  }

  function render(){
    const w = canvas.width;
    const h = canvas.height;
    ctx.setTransform(1,0,0,1,0,0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#fff";
    ctx.fillRect(0,0,w,h);

    const camera = makeCamera(w,h);
    const triangles = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (const mesh of model.meshes) {
      const transformed = mesh.vertices.map(v => transformVertex(v, camera));
      const base = hexToRgb(mesh.color || "#ececec");

      for (const face of mesh.faces) {
        const a = transformed[face[0]];
        const b = transformed[face[1]];
        const c = transformed[face[2]];
        if (!a || !b || !c) continue;

        minX = Math.min(minX,a.sx,b.sx,c.sx);
        minY = Math.min(minY,a.sy,b.sy,c.sy);
        maxX = Math.max(maxX,a.sx,b.sx,c.sx);
        maxY = Math.max(maxY,a.sy,b.sy,c.sy);

        const n = faceNormal3(a.world,b.world,c.world);
        const light = clamp(0.76 + 0.24 * Math.abs(dot3(n, normalize3([-0.35,0.7,1]))), 0.64, 1.04);
        triangles.push({
          pts:[a,b,c],
          z:(a.world[2]+b.world[2]+c.world[2])/3,
          color:rgbCss(base.map(v => clamp(v*light,0,255)))
        });
      }
    }

    triangles.sort((a,b) => a.z - b.z);

    ctx.lineJoin = "round";
    for (const tri of triangles) {
      const [a,b,c] = tri.pts;
      ctx.beginPath();
      ctx.moveTo(a.sx,a.sy);
      ctx.lineTo(b.sx,b.sy);
      ctx.lineTo(c.sx,c.sy);
      ctx.closePath();
      ctx.fillStyle = tri.color;
      ctx.fill();
    }

    const coverWorld = model.cover.vertices.map(v => transformVertex(v,camera));
    const coverNormal = faceNormal3(coverWorld[0].world,coverWorld[1].world,coverWorld[2].world);
    const frontFacing = coverNormal[2] > 0.02;

    if (frontFacing) {
      for (const p of coverWorld) {
        minX = Math.min(minX,p.sx); minY = Math.min(minY,p.sy);
        maxX = Math.max(maxX,p.sx); maxY = Math.max(maxY,p.sy);
      }

      if (coverReady) drawProjectiveCover(coverWorld,camera);
      else drawCoverFallback(coverWorld);
    }

    if (Number.isFinite(minX)) projectedBounds = {minX,minY,maxX,maxY};
  }

  function makeCamera(w,h){
    const baseScale = Math.min(w / 4.8, h / 4.8) * zoom;
    return {
      cx:w/2,
      cy:h/2,
      scale:baseScale,
      distance:5.6,
      cyaw:Math.cos(yaw), syaw:Math.sin(yaw),
      cpitch:Math.cos(pitch), spitch:Math.sin(pitch)
    };
  }

  function transformVertex(v,cam){
    const x0 = v[0], y0 = v[1], z0 = v[2];

    // Y rotation.
    const x1 = cam.cyaw*x0 + cam.syaw*z0;
    const z1 = -cam.syaw*x0 + cam.cyaw*z0;

    // X rotation.
    const y2 = cam.cpitch*y0 - cam.spitch*z1;
    const z2 = cam.spitch*y0 + cam.cpitch*z1;

    const denom = Math.max(0.6, cam.distance - z2);
    const persp = cam.distance / denom;

    return {
      world:[x1,y2,z2],
      sx:cam.cx + x1 * cam.scale * persp,
      sy:cam.cy - y2 * cam.scale * persp
    };
  }

  function drawCoverFallback(quad){
    ctx.beginPath();
    ctx.moveTo(quad[0].sx,quad[0].sy);
    for (let i=1;i<4;i++) ctx.lineTo(quad[i].sx,quad[i].sy);
    ctx.closePath();
    ctx.fillStyle = "#0b465f";
    ctx.fill();
  }

  function drawProjectiveCover(quad, camera){
    const cols = 14;
    const rows = 20;
    const iw = coverImage.naturalWidth || coverImage.width;
    const ih = coverImage.naturalHeight || coverImage.height;
    if (!iw || !ih) return;

    const p00 = model.cover.vertices[0]; // bottom-left
    const p10 = model.cover.vertices[1]; // bottom-right
    const p11 = model.cover.vertices[2]; // top-right
    const p01 = model.cover.vertices[3]; // top-left

    for (let j=0;j<rows;j++) {
      const v0 = j/rows;
      const v1 = (j+1)/rows;
      for (let i=0;i<cols;i++) {
        const u0 = i/cols;
        const u1 = (i+1)/cols;

        const q00 = transformVertex(bilinear3(p00,p10,p11,p01,u0,v0),camera);
        const q10 = transformVertex(bilinear3(p00,p10,p11,p01,u1,v0),camera);
        const q11 = transformVertex(bilinear3(p00,p10,p11,p01,u1,v1),camera);
        const q01 = transformVertex(bilinear3(p00,p10,p11,p01,u0,v1),camera);

        // UV v=0 is the bottom of the cover; image y=0 is the top.
        const s00 = [u0*iw,(1-v0)*ih];
        const s10 = [u1*iw,(1-v0)*ih];
        const s11 = [u1*iw,(1-v1)*ih];
        const s01 = [u0*iw,(1-v1)*ih];

        drawImageTriangle(coverImage,s00,s10,s11,[q00.sx,q00.sy],[q10.sx,q10.sy],[q11.sx,q11.sy]);
        drawImageTriangle(coverImage,s00,s11,s01,[q00.sx,q00.sy],[q11.sx,q11.sy],[q01.sx,q01.sy]);
      }
    }

    const normal = faceNormal3(quad[0].world,quad[1].world,quad[2].world);
    const light = clamp(0.88 + 0.12 * dot3(normalize3(normal), normalize3([-0.25,0.55,1])), 0.76, 1.03);
    if (light < 0.995) {
      ctx.beginPath();
      ctx.moveTo(quad[0].sx,quad[0].sy);
      for (let i=1;i<4;i++) ctx.lineTo(quad[i].sx,quad[i].sy);
      ctx.closePath();
      ctx.fillStyle = `rgba(0,0,0,${clamp((1-light)*0.8,0,0.16)})`;
      ctx.fill();
    }
  }

  function drawImageTriangle(img,s0,s1,s2,d0,d1,d2){
    const m = affineFromTriangles(s0,s1,s2,d0,d1,d2);
    if (!m) return;

    const e0 = expandPoint(d0,d1,d2,0.7);
    const e1 = expandPoint(d1,d0,d2,0.7);
    const e2 = expandPoint(d2,d0,d1,0.7);

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(e0[0],e0[1]);
    ctx.lineTo(e1[0],e1[1]);
    ctx.lineTo(e2[0],e2[1]);
    ctx.closePath();
    ctx.clip();
    ctx.setTransform(m.a,m.b,m.c,m.d,m.e,m.f);
    ctx.drawImage(img,0,0);
    ctx.restore();
  }

  function affineFromTriangles(s0,s1,s2,d0,d1,d2){
    const x0=s0[0],y0=s0[1],x1=s1[0],y1=s1[1],x2=s2[0],y2=s2[1];
    const X0=d0[0],Y0=d0[1],X1=d1[0],Y1=d1[1],X2=d2[0],Y2=d2[1];
    const den = x0*(y1-y2) + x1*(y2-y0) + x2*(y0-y1);
    if (Math.abs(den) < 1e-8) return null;

    return {
      a:(X0*(y1-y2)+X1*(y2-y0)+X2*(y0-y1))/den,
      c:(X0*(x2-x1)+X1*(x0-x2)+X2*(x1-x0))/den,
      e:(X0*(x1*y2-x2*y1)+X1*(x2*y0-x0*y2)+X2*(x0*y1-x1*y0))/den,
      b:(Y0*(y1-y2)+Y1*(y2-y0)+Y2*(y0-y1))/den,
      d:(Y0*(x2-x1)+Y1*(x0-x2)+Y2*(x1-x0))/den,
      f:(Y0*(x1*y2-x2*y1)+Y1*(x2*y0-x0*y2)+Y2*(x0*y1-x1*y0))/den
    };
  }

  function expandPoint(p,a,b,amount){
    const cx = (p[0]+a[0]+b[0])/3;
    const cy = (p[1]+a[1]+b[1])/3;
    const dx = p[0]-cx, dy = p[1]-cy;
    const len = Math.hypot(dx,dy) || 1;
    return [p[0]+dx/len*amount, p[1]+dy/len*amount];
  }

  function bilinear3(p00,p10,p11,p01,u,v){
    const a = [(1-u)*p00[0]+u*p10[0], (1-u)*p00[1]+u*p10[1], (1-u)*p00[2]+u*p10[2]];
    const b = [(1-u)*p01[0]+u*p11[0], (1-u)*p01[1]+u*p11[1], (1-u)*p01[2]+u*p11[2]];
    return [(1-v)*a[0]+v*b[0], (1-v)*a[1]+v*b[1], (1-v)*a[2]+v*b[2]];
  }

  function hitProjectedBook(clientX,clientY){
    if (!projectedBounds) return false;
    const r = canvas.getBoundingClientRect();
    const x = (clientX-r.left) * (canvas.width/r.width);
    const y = (clientY-r.top) * (canvas.height/r.height);
    const pad = 18 * (canvas.width/r.width);
    return x >= projectedBounds.minX-pad && x <= projectedBounds.maxX+pad &&
           y >= projectedBounds.minY-pad && y <= projectedBounds.maxY+pad;
  }

  function faceNormal3(a,b,c){
    const ux=b[0]-a[0], uy=b[1]-a[1], uz=b[2]-a[2];
    const vx=c[0]-a[0], vy=c[1]-a[1], vz=c[2]-a[2];
    return normalize3([
      uy*vz-uz*vy,
      uz*vx-ux*vz,
      ux*vy-uy*vx
    ]);
  }

  function normalize3(v){
    const l = Math.hypot(v[0],v[1],v[2]) || 1;
    return [v[0]/l,v[1]/l,v[2]/l];
  }

  function dot3(a,b){ return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }

  function hexToRgb(hex){
    let s = (hex || "#eee").replace("#","");
    if (s.length === 3) s = s.split("").map(c => c+c).join("");
    const n = parseInt(s,16);
    return [(n>>16)&255,(n>>8)&255,n&255];
  }

  function rgbCss(v){ return `rgb(${Math.round(v[0])},${Math.round(v[1])},${Math.round(v[2])})`; }
  function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }

  function showError(msg){
    const el = $("#error");
    el.textContent = msg;
    el.classList.add("show");
  }
})();
