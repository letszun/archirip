(() => {
  "use strict";

  const STORAGE_KEY = "reading-archive-minimal-v5";
  const COVER_PARTS = new Set(["frontcover", "spine", "backcover"]);
  const DEFAULT_BOOKS = [{
    id:"gatsby",
    title:"The Great Gatsby",
    author:"F. Scott Fitzgerald",
    readDate:"",
    oneLine:"",
    memo:"",
    dominantColor:"#0b465f",
    coverData:null
  }];

  const $ = (s) => document.querySelector(s);
  const canvas = $("#bookCanvas");
  const ctx = canvas?.getContext("2d", { alpha:false });
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
  let currentCoverSource = "";

  let pendingCoverData = "";
  let pendingDominantColor = "";
  let pendingFileName = "";

  const coverImage = new Image();
  coverImage.decoding = "async";
  coverImage.onload = () => {
    coverReady = true;
    requestRender();
  };
  coverImage.onerror = () => {
    coverReady = false;
    requestRender();
  };

  if (!ctx || !model?.meshes || !model?.cover) {
    showError("모델 데이터를 불러오지 못했습니다.");
    return;
  }

  initUI();
  resize();
  loadActiveCover();
  requestRender();

  // GitHub Pages에서는 JSON 기본값을 읽고, file://에서는 내장 기본값으로 동작합니다.
  if (location.protocol !== "file:") {
    fetch("./books.json", { cache:"no-store" })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => {
        if (!localStorage.getItem(STORAGE_KEY) && Array.isArray(data?.books) && data.books.length) {
          books = data.books.map(normalizeBook);
          activeBookId = books[0].id;
          buildShelf();
          loadActiveCover();
        }
      })
      .catch(() => {});
  }

  function initUI(){
    $("#toShelf").addEventListener("click", () => showView("shelf"));
    $("#toSingle").addEventListener("click", () => showView("single"));
    $("#backDetail").addEventListener("click", () => showView(previousView));
    $("#openAdd").addEventListener("click", openAddView);
    $("#closeAdd").addEventListener("click", () => showView("shelf"));
    $("#addForm").addEventListener("submit", addBook);
    $("#coverUpload").addEventListener("change", handleCoverUpload);

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
      b.style.background = book.dominantColor || "#777";
      b.style.width = `${19 + (i % 4) * 1.5}px`;
      b.setAttribute("aria-label", `${book.title} 열기`);

      const title = document.createElement("span");
      title.textContent = book.title;
      title.style.color = readableTextColor(book.dominantColor || "#777");
      b.appendChild(title);

      b.addEventListener("click", () => {
        activeBookId = book.id;
        loadActiveCover();
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
    const add = $("#addView");

    if (name === "detail") {
      previousView = currentView === "detail" ? previousView : currentView;
      populateDetail();
    }

    if (name === "single") {
      single.className = "view current";
      shelf.className = "view off-right";
      detail.className = "view off-right";
      add.className = "view off-right";
      currentView = "single";
      requestRender();
    } else if (name === "shelf") {
      single.className = "view off-left";
      shelf.className = "view current";
      detail.className = "view off-right";
      add.className = "view off-right";
      currentView = "shelf";
    } else if (name === "detail") {
      single.className = "view off-left";
      shelf.className = currentView === "shelf" ? "view off-left" : "view off-right";
      detail.className = "view current";
      add.className = "view off-right";
      currentView = "detail";
    } else if (name === "add") {
      single.className = "view off-left";
      shelf.className = "view off-left";
      detail.className = "view off-right";
      add.className = "view current";
      currentView = "add";
    }
  }

  function openAddView(){
    resetAddForm();
    showView("add");
  }

  function resetAddForm(){
    pendingCoverData = "";
    pendingDominantColor = "";
    pendingFileName = "";
    $("#addForm").reset();
    $("#coverPreview").removeAttribute("src");
    $("#coverPicker").classList.remove("has-image");
    $("#dominantDot").classList.remove("visible");
    $("#dominantDot").style.background = "#ddd";
  }

  async function handleCoverUpload(event){
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const originalData = await readFileAsDataURL(file);
      const image = await loadImage(originalData);
      pendingDominantColor = extractDominantColor(image);
      pendingCoverData = compressCoverImage(image);
      pendingFileName = file.name.replace(/\.[^.]+$/, "");

      $("#coverPreview").src = pendingCoverData;
      $("#coverPicker").classList.add("has-image");
      $("#dominantDot").style.background = pendingDominantColor;
      $("#dominantDot").classList.add("visible");

      if (!$("#newBookTitle").value.trim()) {
        $("#newBookTitle").value = pendingFileName;
      }
    } catch (error) {
      console.error(error);
      alert("표지 이미지를 읽지 못했습니다.");
    }
  }

  function addBook(event){
    event.preventDefault();

    if (!pendingCoverData) {
      $("#coverUpload").click();
      return;
    }

    const title = $("#newBookTitle").value.trim() || pendingFileName || "Untitled";
    const book = normalizeBook({
      id:`book-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
      title,
      author:"",
      readDate:"",
      oneLine:"",
      memo:"",
      dominantColor:pendingDominantColor || "#777777",
      coverData:pendingCoverData
    });

    books.push(book);
    activeBookId = book.id;

    const saved = persistBooks();
    buildShelf();
    loadActiveCover();
    resetAddForm();
    showView("single");

    if (!saved) {
      alert("책은 추가됐지만 브라우저 저장 공간이 부족해 새로고침 후에는 사라질 수 있습니다.");
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
    persistBooks();
  }

  function getBook(){
    return books.find(b => b.id === activeBookId) || books[0];
  }

  function normalizeBook(book){
    return {
      id:String(book?.id || `book-${Date.now()}`),
      title:String(book?.title || "Untitled"),
      author:String(book?.author || ""),
      readDate:String(book?.readDate || ""),
      oneLine:String(book?.oneLine || ""),
      memo:String(book?.memo || ""),
      dominantColor:String(book?.dominantColor || book?.spineColor || "#777777"),
      coverData:book?.coverData || null
    };
  }

  function loadSavedBooks(){
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (Array.isArray(saved?.books) && saved.books.length) return saved.books.map(normalizeBook);
    } catch (_) {}
    return DEFAULT_BOOKS.map(normalizeBook);
  }

  function persistBooks(){
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({books}));
      return true;
    } catch (error) {
      console.warn("Could not persist books", error);
      return false;
    }
  }

  function loadActiveCover(){
    const book = getBook();
    const src = book?.coverData || window.BOOK_COVER_DATA_URL || "";
    coverReady = false;
    currentCoverSource = src;

    if (!src) {
      coverImage.removeAttribute("src");
      requestRender();
      return;
    }

    coverImage.src = src;
    if (coverImage.complete && coverImage.naturalWidth > 0) {
      coverReady = true;
    }
    requestRender();
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
    const active = getBook();
    const dominant = active?.dominantColor || "#777777";

    for (const mesh of model.meshes) {
      const transformed = mesh.vertices.map(v => transformVertex(v, camera));
      const baseHex = COVER_PARTS.has(mesh.name.toLowerCase()) ? dominant : (mesh.color || "#ececec");
      const base = hexToRgb(baseHex);
      const meshLight = getMeshLight(mesh.name, camera);
      const color = rgbCss(base.map(v => clamp(v * meshLight, 0, 255)));

      for (const face of mesh.faces) {
        const a = transformed[face[0]];
        const b = transformed[face[1]];
        const c = transformed[face[2]];
        if (!a || !b || !c) continue;

        minX = Math.min(minX,a.sx,b.sx,c.sx);
        minY = Math.min(minY,a.sy,b.sy,c.sy);
        maxX = Math.max(maxX,a.sx,b.sx,c.sx);
        maxY = Math.max(maxY,a.sy,b.sy,c.sy);

        triangles.push({
          pts:[a,b,c],
          z:(a.world[2]+b.world[2]+c.world[2])/3,
          color
        });
      }
    }

    triangles.sort((a,b) => a.z - b.z);

    ctx.lineJoin = "round";
    for (const tri of triangles) {
      const [a,b,c] = tri.pts;
      const e0 = expandPoint([a.sx,a.sy],[b.sx,b.sy],[c.sx,c.sy],0.58);
      const e1 = expandPoint([b.sx,b.sy],[a.sx,a.sy],[c.sx,c.sy],0.58);
      const e2 = expandPoint([c.sx,c.sy],[a.sx,a.sy],[b.sx,b.sy],0.58);
      ctx.beginPath();
      ctx.moveTo(e0[0],e0[1]);
      ctx.lineTo(e1[0],e1[1]);
      ctx.lineTo(e2[0],e2[1]);
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

      if (coverReady && coverImage.src === currentCoverSource) drawProjectiveCover(coverWorld,camera);
      else drawCoverFallback(coverWorld, dominant);
    }

    if (Number.isFinite(minX)) projectedBounds = {minX,minY,maxX,maxY};
  }

  function getMeshLight(name, camera){
    const key = String(name || "").toLowerCase();
    if (key === "pages") return 0.985;

    let n;
    if (key === "spine") n = [-1,0,0];
    else if (key === "backcover") n = [0,0,-1];
    else n = [0,0,1];

    const rn = rotateNormal(n, camera);
    const lightDir = normalize3([-0.25,0.58,1]);
    return clamp(0.86 + 0.14 * Math.abs(dot3(rn, lightDir)), 0.86, 1.0);
  }

  function rotateNormal(n, cam){
    const x1 = cam.cyaw*n[0] + cam.syaw*n[2];
    const z1 = -cam.syaw*n[0] + cam.cyaw*n[2];
    const y2 = cam.cpitch*n[1] - cam.spitch*z1;
    const z2 = cam.spitch*n[1] + cam.cpitch*z1;
    return normalize3([x1,y2,z2]);
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

    const x1 = cam.cyaw*x0 + cam.syaw*z0;
    const z1 = -cam.syaw*x0 + cam.cyaw*z0;

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

  function drawCoverFallback(quad, color){
    ctx.beginPath();
    ctx.moveTo(quad[0].sx,quad[0].sy);
    for (let i=1;i<4;i++) ctx.lineTo(quad[i].sx,quad[i].sy);
    ctx.closePath();
    ctx.fillStyle = color || "#777";
    ctx.fill();
  }

  function drawProjectiveCover(quad, camera){
    const cols = 16;
    const rows = 24;
    const iw = coverImage.naturalWidth || coverImage.width;
    const ih = coverImage.naturalHeight || coverImage.height;
    if (!iw || !ih) return;

    const p00 = model.cover.vertices[0];
    const p10 = model.cover.vertices[1];
    const p11 = model.cover.vertices[2];
    const p01 = model.cover.vertices[3];

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

        const s00 = [u0*iw,(1-v0)*ih];
        const s10 = [u1*iw,(1-v0)*ih];
        const s11 = [u1*iw,(1-v1)*ih];
        const s01 = [u0*iw,(1-v1)*ih];

        drawImageTriangle(coverImage,s00,s10,s11,[q00.sx,q00.sy],[q10.sx,q10.sy],[q11.sx,q11.sy]);
        drawImageTriangle(coverImage,s00,s11,s01,[q00.sx,q00.sy],[q11.sx,q11.sy],[q01.sx,q01.sy]);
      }
    }

    const normal = faceNormal3(quad[0].world,quad[1].world,quad[2].world);
    const light = clamp(0.9 + 0.10 * dot3(normalize3(normal), normalize3([-0.25,0.55,1])), 0.8, 1.02);
    if (light < 0.995) {
      ctx.beginPath();
      ctx.moveTo(quad[0].sx,quad[0].sy);
      for (let i=1;i<4;i++) ctx.lineTo(quad[i].sx,quad[i].sy);
      ctx.closePath();
      ctx.fillStyle = `rgba(0,0,0,${clamp((1-light)*0.72,0,0.14)})`;
      ctx.fill();
    }
  }

  function drawImageTriangle(img,s0,s1,s2,d0,d1,d2){
    const m = affineFromTriangles(s0,s1,s2,d0,d1,d2);
    if (!m) return;

    const e0 = expandPoint(d0,d1,d2,0.85);
    const e1 = expandPoint(d1,d0,d2,0.85);
    const e2 = expandPoint(d2,d0,d1,0.85);

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

  function readFileAsDataURL(file){
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function loadImage(src){
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  function compressCoverImage(image){
    const maxSide = 720;
    const ratio = Math.min(1, maxSide / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
    const w = Math.max(1, Math.round((image.naturalWidth || image.width) * ratio));
    const h = Math.max(1, Math.round((image.naturalHeight || image.height) * ratio));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const cctx = c.getContext("2d", { alpha:false });
    cctx.fillStyle = "#fff";
    cctx.fillRect(0,0,w,h);
    cctx.imageSmoothingEnabled = true;
    cctx.imageSmoothingQuality = "high";
    cctx.drawImage(image,0,0,w,h);
    return c.toDataURL("image/jpeg",0.82);
  }

  function extractDominantColor(image){
    const size = 72;
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const cctx = c.getContext("2d", { willReadFrequently:true });
    cctx.drawImage(image,0,0,size,size);
    const data = cctx.getImageData(0,0,size,size).data;
    const bins = new Map();

    for (let i=0;i<data.length;i+=4) {
      if (data[i+3] < 180) continue;
      const r=data[i], g=data[i+1], b=data[i+2];
      const max=Math.max(r,g,b), min=Math.min(r,g,b);
      const sat = max === 0 ? 0 : (max-min)/max;
      const lum = (0.2126*r + 0.7152*g + 0.0722*b) / 255;

      // 아주 밝은 종이/테두리는 실제 표지색보다 우세해지는 경우가 많아 가중치를 줄입니다.
      const extremePenalty = lum > 0.94 ? 0.2 : (lum < 0.035 ? 0.55 : 1);
      const weight = extremePenalty * (0.82 + sat * 0.38);
      const qr = Math.round(r/24)*24;
      const qg = Math.round(g/24)*24;
      const qb = Math.round(b/24)*24;
      const key = `${qr},${qg},${qb}`;
      const entry = bins.get(key) || {score:0,count:0,r:0,g:0,b:0};
      entry.score += weight;
      entry.count += 1;
      entry.r += r;
      entry.g += g;
      entry.b += b;
      bins.set(key,entry);
    }

    let best = null;
    for (const entry of bins.values()) {
      if (!best || entry.score > best.score) best = entry;
    }
    if (!best || !best.count) return "#777777";

    const rgb = [best.r/best.count, best.g/best.count, best.b/best.count].map(Math.round);
    return rgbToHex(rgb[0],rgb[1],rgb[2]);
  }

  function readableTextColor(hex){
    const [r,g,b] = hexToRgb(hex);
    const lum = (0.2126*r + 0.7152*g + 0.0722*b) / 255;
    return lum > 0.62 ? "#111" : "#fff";
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
    if (!Number.isFinite(n)) return [119,119,119];
    return [(n>>16)&255,(n>>8)&255,n&255];
  }

  function rgbToHex(r,g,b){
    return `#${[r,g,b].map(v => clamp(Math.round(v),0,255).toString(16).padStart(2,"0")).join("")}`;
  }

  function rgbCss(v){ return `rgb(${Math.round(v[0])},${Math.round(v[1])},${Math.round(v[2])})`; }
  function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }

  function showError(msg){
    const el = $("#error");
    el.textContent = msg;
    el.classList.add("show");
  }
})();
