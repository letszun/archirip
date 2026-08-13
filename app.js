(() => {
  "use strict";

  // Keep the old key so existing v5/v6 books survive the upgrade.
  const STORAGE_KEY = "reading-archive-minimal-v5";
  const model = window.BOOK_MODEL_DATA;

  const DEFAULT_BOOKS = [{
    id:"gatsby",
    title:"The Great Gatsby",
    author:"F. Scott Fitzgerald",
    pageCount:180,
    readDate:"",
    oneLine:"",
    memo:"",
    dominantColor:"#0b465f",
    coverData:null
  }];

  const $ = (s) => document.querySelector(s);
  const canvas = $("#bookCanvas");
  const ctx = canvas?.getContext("2d", { alpha:false });

  let books = loadSavedBooks();
  let activeBookId = books[0]?.id || null;
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

  if (!ctx || !model?.width || !model?.height) {
    showError("모델 설정을 불러오지 못했습니다.");
    return;
  }

  initUI();
  resize();
  loadActiveCover();
  requestRender();

  if (location.protocol !== "file:") {
    fetch("./books.json", { cache:"no-store" })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => {
        if (!localStorage.getItem(STORAGE_KEY) && Array.isArray(data?.books) && data.books.length) {
          books = data.books.map(normalizeBook);
          activeBookId = books[0]?.id || null;
          buildShelf();
          loadActiveCover();
          requestRender();
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
    $("#deleteBook").addEventListener("click", deleteActiveBook);

    $("#readDate").addEventListener("input", saveDetailText);
    $("#oneLine").addEventListener("input", saveDetailText);
    $("#memo").addEventListener("input", saveDetailText);
    $("#pageCount").addEventListener("input", savePageCount);

    buildShelf();

    canvas.addEventListener("pointerdown", (e) => {
      canvas.setPointerCapture?.(e.pointerId);
      drag = {
        id:e.pointerId,
        x:e.clientX, y:e.clientY,
        sx:e.clientX, sy:e.clientY,
        moved:false
      };
      canvas.classList.add("dragging");
    });

    canvas.addEventListener("pointermove", (e) => {
      if (!drag || drag.id !== e.pointerId) return;

      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;

      if (Math.hypot(e.clientX-drag.sx, e.clientY-drag.sy) > 5) {
        drag.moved = true;
      }

      yaw += dx * 0.008;
      pitch = clamp(pitch + dy * 0.006, -1.08, 1.08);

      drag.x = e.clientX;
      drag.y = e.clientY;
      requestRender();
    });

    canvas.addEventListener("pointerup", (e) => {
      if (!drag || drag.id !== e.pointerId) return;

      const moved = drag.moved;
      drag = null;
      canvas.classList.remove("dragging");

      if (!moved && getBook() && hitProjectedBook(e.clientX, e.clientY)) {
        showView("detail");
      }
    });

    canvas.addEventListener("pointercancel", () => {
      drag = null;
      canvas.classList.remove("dragging");
    });

    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      zoom = clamp(zoom * (e.deltaY > 0 ? 0.92 : 1.08), 0.72, 1.65);
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

    books.forEach((book) => {
      const button = document.createElement("button");
      button.className = "spine";
      button.type = "button";
      button.style.background = book.dominantColor || "#777";
      button.style.width = `${shelfWidthForPages(book.pageCount)}px`;
      button.setAttribute("aria-label", `${book.title} 열기`);

      const title = document.createElement("span");
      title.textContent = book.title;
      title.style.color = readableTextColor(book.dominantColor || "#777");
      button.appendChild(title);

      button.addEventListener("click", () => {
        activeBookId = book.id;
        loadActiveCover();
        showView("single");
        requestRender();
      });

      shelf.appendChild(button);
    });
  }

  function showView(name){
    const single = $("#singleView");
    const shelf = $("#shelfView");
    const detail = $("#detailView");
    const add = $("#addView");

    if (name === "detail") {
      if (!getBook()) return;
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
      return;
    }

    if (name === "shelf") {
      single.className = "view off-left";
      shelf.className = "view current";
      detail.className = "view off-right";
      add.className = "view off-right";
      currentView = "shelf";
      return;
    }

    if (name === "detail") {
      single.className = "view off-left";
      shelf.className = previousView === "shelf" ? "view off-left" : "view off-right";
      detail.className = "view current";
      add.className = "view off-right";
      currentView = "detail";
      return;
    }

    if (name === "add") {
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
    const pageCount = normalizePageCount($("#newPageCount").value, 300);

    const book = normalizeBook({
      id:`book-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
      title,
      author:"",
      pageCount,
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
    requestRender();

    if (!saved) {
      alert("책은 추가됐지만 브라우저 저장 공간이 부족해 새로고침 후에는 사라질 수 있습니다.");
    }
  }

  function deleteActiveBook(){
    const book = getBook();
    if (!book) return;

    if (!window.confirm(`"${book.title}"을(를) 삭제할까요?`)) return;

    const index = books.findIndex(item => item.id === book.id);
    if (index < 0) return;

    books.splice(index, 1);
    activeBookId = books[Math.min(index, books.length - 1)]?.id || null;

    persistBooks();
    buildShelf();
    loadActiveCover();
    showView("shelf");
    requestRender();
  }

  function populateDetail(){
    const book = getBook();
    if (!book) return;

    $("#readDate").value = book.readDate || "";
    $("#pageCount").value = String(book.pageCount || 300);
    $("#oneLine").value = book.oneLine || "";
    $("#memo").value = book.memo || "";
  }

  function saveDetailText(){
    const book = getBook();
    if (!book) return;

    book.readDate = $("#readDate").value;
    book.oneLine = $("#oneLine").value;
    book.memo = $("#memo").value;

    persistBooks();
  }

  function savePageCount(){
    const book = getBook();
    if (!book) return;

    const raw = $("#pageCount").value;
    if (raw === "") return;

    book.pageCount = normalizePageCount(raw, book.pageCount || 300);
    persistBooks();
    buildShelf();
    requestRender();
  }

  function getBook(){
    return books.find(book => book.id === activeBookId);
  }

  function normalizeBook(book){
    return {
      id:String(book?.id || `book-${Date.now()}`),
      title:String(book?.title || "Untitled"),
      author:String(book?.author || ""),
      pageCount:normalizePageCount(book?.pageCount, 300),
      readDate:String(book?.readDate || ""),
      oneLine:String(book?.oneLine || ""),
      memo:String(book?.memo || ""),
      dominantColor:String(book?.dominantColor || book?.spineColor || "#777777"),
      coverData:book?.coverData || null
    };
  }

  function normalizePageCount(value, fallback){
    const n = Math.round(Number(value));
    if (!Number.isFinite(n) || n < 1) return fallback;
    return clamp(n, 1, 5000);
  }

  function loadSavedBooks(){
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (Array.isArray(saved?.books)) {
        return saved.books.map(normalizeBook);
      }
    } catch (_) {}
    return DEFAULT_BOOKS.map(normalizeBook);
  }

  function persistBooks(){
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ books }));
      return true;
    } catch (error) {
      console.warn("Could not persist books", error);
      return false;
    }
  }

  function loadActiveCover(){
    const book = getBook();
    const src = book?.coverData || (book?.id === "gatsby" ? window.BOOK_COVER_DATA_URL : "") || "";

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

    const active = getBook();
    if (!active) {
      projectedBounds = null;
      return;
    }

    const geometry = makeBookGeometry(active);
    const camera = makeCamera(w,h);
    const items = [];

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const face of geometry.faces) {
      const pts = face.vertices.map(v => transformVertex(v, camera));
      const normal = faceNormal3(pts[0].world, pts[1].world, pts[2].world);

      // Camera is on +Z looking toward the origin.
      if (normal[2] <= 0.0001) continue;

      for (const p of pts) {
        minX = Math.min(minX, p.sx);
        minY = Math.min(minY, p.sy);
        maxX = Math.max(maxX, p.sx);
        maxY = Math.max(maxY, p.sy);
      }

      const base = face.role === "pages" ? "#f3f0e9" : active.dominantColor;
      items.push({
        kind:"solid",
        role:face.role,
        pts,
        z:averageZ(pts),
        color:shadeSurface(base, normal, face.role)
      });
    }

    const coverPts = geometry.cover.vertices.map(v => transformVertex(v, camera));
    const coverNormal = faceNormal3(coverPts[0].world, coverPts[1].world, coverPts[2].world);

    if (coverNormal[2] > 0.0001) {
      for (const p of coverPts) {
        minX = Math.min(minX, p.sx);
        minY = Math.min(minY, p.sy);
        maxX = Math.max(maxX, p.sx);
        maxY = Math.max(maxY, p.sy);
      }

      items.push({
        kind:"cover",
        pts:coverPts,
        worldVertices:geometry.cover.vertices,
        z:averageZ(coverPts) + 0.0001
      });
    }

    // Single convex prism: average-depth order is stable because faces only meet at edges.
    items.sort((a,b) => a.z - b.z);

    for (const item of items) {
      if (item.kind === "solid") {
        fillPolygon(item.pts, item.color);
        continue;
      }

      if (coverReady && coverImage.src === currentCoverSource) {
        drawProjectiveCover(item.worldVertices, item.pts, camera);
      } else {
        fillPolygon(item.pts, active.dominantColor || "#777");
      }
    }

    if (Number.isFinite(minX)) {
      projectedBounds = { minX, minY, maxX, maxY };
    } else {
      projectedBounds = null;
    }
  }

  function makeBookGeometry(book){
    const halfW = model.width / 2;
    const halfH = model.height / 2;
    const halfT = normalizedThicknessForPages(book.pageCount) / 2;

    const x0 = -halfW;
    const x1 = halfW;
    const y0 = -halfH;
    const y1 = halfH;
    const z0 = -halfT;
    const z1 = halfT;

    // One closed six-face prism. No overlapping Rhino skins, so no angle-dependent tearing.
    const faces = [
      {
        name:"front",
        role:"dominant",
        vertices:[[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]]
      },
      {
        name:"back",
        role:"dominant",
        vertices:[[x1,y0,z0],[x0,y0,z0],[x0,y1,z0],[x1,y1,z0]]
      },
      {
        name:"spine",
        role:"dominant",
        vertices:[[x0,y0,z0],[x0,y0,z1],[x0,y1,z1],[x0,y1,z0]]
      },
      {
        name:"foreedge",
        role:"pages",
        vertices:[[x1,y0,z1],[x1,y0,z0],[x1,y1,z0],[x1,y1,z1]]
      },
      {
        name:"top",
        role:"pages",
        vertices:[[x0,y1,z1],[x1,y1,z1],[x1,y1,z0],[x0,y1,z0]]
      },
      {
        name:"bottom",
        role:"pages",
        vertices:[[x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1]]
      }
    ];

    const insetX = model.width * (model.coverInsetX || 0.018);
    const insetY = model.height * (model.coverInsetY || 0.014);

    const cover = {
      vertices:[
        [x0 + insetX, y0 + insetY, z1],
        [x1 - insetX, y0 + insetY, z1],
        [x1 - insetX, y1 - insetY, z1],
        [x0 + insetX, y1 - insetY, z1]
      ]
    };

    return { faces, cover };
  }

  function thicknessMmForPages(pageCount){
    const pages = normalizePageCount(pageCount, 300);

    // Visual approximation:
    // 100p ≈ 9.8mm / 300p ≈ 19.3mm / 600p ≈ 33.5mm / 900p ≈ 47.8mm
    return clamp(
      5 + pages * 0.0475,
      model.minThicknessMm || 8,
      model.maxThicknessMm || 48
    );
  }

  function normalizedThicknessForPages(pageCount){
    const unitPerMm = model.height / (model.referenceHeightMm || 210);
    return thicknessMmForPages(pageCount) * unitPerMm;
  }

  function shelfWidthForPages(pageCount){
    const mm = thicknessMmForPages(pageCount);
    const minMm = model.minThicknessMm || 8;
    const maxMm = model.maxThicknessMm || 48;
    const t = (mm - minMm) / Math.max(1, maxMm - minMm);

    // Small shelf: 8–28 px desktop.
    return Math.round(8 + clamp(t,0,1) * 20);
  }

  function fillPolygon(pts, color){
    if (!pts.length) return;

    ctx.beginPath();
    ctx.moveTo(pts[0].sx, pts[0].sy);

    for (let i=1;i<pts.length;i++) {
      ctx.lineTo(pts[i].sx, pts[i].sy);
    }

    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  function shadeSurface(hex, normal, role){
    const base = hexToRgb(hex);
    const lightDir = normalize3([-0.32,0.56,1]);
    const diffuse = Math.max(0, dot3(normalize3(normal), lightDir));

    const floor = role === "pages" ? 0.92 : 0.84;
    const range = role === "pages" ? 0.08 : 0.16;
    const light = floor + range * diffuse;

    return rgbCss(base.map(v => clamp(v * light, 0, 255)));
  }

  function makeCamera(w,h){
    const baseScale = Math.min(w / 4.8, h / 4.8) * zoom;

    return {
      cx:w/2,
      cy:h/2,
      scale:baseScale,
      distance:5.6,
      cyaw:Math.cos(yaw),
      syaw:Math.sin(yaw),
      cpitch:Math.cos(pitch),
      spitch:Math.sin(pitch)
    };
  }

  function transformVertex(v,cam){
    const x0 = v[0];
    const y0 = v[1];
    const z0 = v[2];

    const x1 = cam.cyaw*x0 + cam.syaw*z0;
    const z1 = -cam.syaw*x0 + cam.cyaw*z0;

    const y2 = cam.cpitch*y0 - cam.spitch*z1;
    const z2 = cam.spitch*y0 + cam.cpitch*z1;

    const denom = Math.max(0.6, cam.distance - z2);
    const perspective = cam.distance / denom;

    return {
      world:[x1,y2,z2],
      sx:cam.cx + x1 * cam.scale * perspective,
      sy:cam.cy - y2 * cam.scale * perspective
    };
  }

  function drawProjectiveCover(worldQuad, projectedQuad, camera){
    const cols = 18;
    const rows = 26;

    const iw = coverImage.naturalWidth || coverImage.width;
    const ih = coverImage.naturalHeight || coverImage.height;
    if (!iw || !ih) return;

    const p00 = worldQuad[0];
    const p10 = worldQuad[1];
    const p11 = worldQuad[2];
    const p01 = worldQuad[3];

    for (let row=0; row<rows; row++) {
      const v0 = row / rows;
      const v1 = (row + 1) / rows;

      for (let col=0; col<cols; col++) {
        const u0 = col / cols;
        const u1 = (col + 1) / cols;

        const q00 = transformVertex(bilinear3(p00,p10,p11,p01,u0,v0), camera);
        const q10 = transformVertex(bilinear3(p00,p10,p11,p01,u1,v0), camera);
        const q11 = transformVertex(bilinear3(p00,p10,p11,p01,u1,v1), camera);
        const q01 = transformVertex(bilinear3(p00,p10,p11,p01,u0,v1), camera);

        const s00 = [u0*iw,(1-v0)*ih];
        const s10 = [u1*iw,(1-v0)*ih];
        const s11 = [u1*iw,(1-v1)*ih];
        const s01 = [u0*iw,(1-v1)*ih];

        drawImageTriangle(
          coverImage,
          s00,s10,s11,
          [q00.sx,q00.sy],[q10.sx,q10.sy],[q11.sx,q11.sy]
        );

        drawImageTriangle(
          coverImage,
          s00,s11,s01,
          [q00.sx,q00.sy],[q11.sx,q11.sy],[q01.sx,q01.sy]
        );
      }
    }

    const normal = faceNormal3(
      projectedQuad[0].world,
      projectedQuad[1].world,
      projectedQuad[2].world
    );

    const light = clamp(
      0.92 + 0.08 * dot3(normalize3(normal), normalize3([-0.25,0.55,1])),
      0.84,
      1.01
    );

    if (light < 0.997) {
      ctx.beginPath();
      ctx.moveTo(projectedQuad[0].sx,projectedQuad[0].sy);
      for (let i=1;i<4;i++) {
        ctx.lineTo(projectedQuad[i].sx,projectedQuad[i].sy);
      }
      ctx.closePath();
      ctx.fillStyle = `rgba(0,0,0,${clamp((1-light)*0.72,0,0.12)})`;
      ctx.fill();
    }
  }

  function drawImageTriangle(img,s0,s1,s2,d0,d1,d2){
    const m = affineFromTriangles(s0,s1,s2,d0,d1,d2);
    if (!m) return;

    // Tiny overlap hides antialiasing seams between texture triangles.
    const e0 = expandPoint(d0,d1,d2,1.0);
    const e1 = expandPoint(d1,d0,d2,1.0);
    const e2 = expandPoint(d2,d0,d1,1.0);

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
    const x0=s0[0], y0=s0[1];
    const x1=s1[0], y1=s1[1];
    const x2=s2[0], y2=s2[1];

    const X0=d0[0], Y0=d0[1];
    const X1=d1[0], Y1=d1[1];
    const X2=d2[0], Y2=d2[1];

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
    const cx = (p[0]+a[0]+b[0]) / 3;
    const cy = (p[1]+a[1]+b[1]) / 3;
    const dx = p[0]-cx;
    const dy = p[1]-cy;
    const len = Math.hypot(dx,dy) || 1;

    return [
      p[0] + dx/len*amount,
      p[1] + dy/len*amount
    ];
  }

  function bilinear3(p00,p10,p11,p01,u,v){
    const a = [
      (1-u)*p00[0] + u*p10[0],
      (1-u)*p00[1] + u*p10[1],
      (1-u)*p00[2] + u*p10[2]
    ];

    const b = [
      (1-u)*p01[0] + u*p11[0],
      (1-u)*p01[1] + u*p11[1],
      (1-u)*p01[2] + u*p11[2]
    ];

    return [
      (1-v)*a[0] + v*b[0],
      (1-v)*a[1] + v*b[1],
      (1-v)*a[2] + v*b[2]
    ];
  }

  function hitProjectedBook(clientX,clientY){
    if (!projectedBounds) return false;

    const r = canvas.getBoundingClientRect();
    const x = (clientX-r.left) * (canvas.width/r.width);
    const y = (clientY-r.top) * (canvas.height/r.height);
    const pad = 18 * (canvas.width/r.width);

    return (
      x >= projectedBounds.minX-pad &&
      x <= projectedBounds.maxX+pad &&
      y >= projectedBounds.minY-pad &&
      y <= projectedBounds.maxY+pad
    );
  }

  function readFileAsDataURL(file){
    return new Promise((resolve,reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function loadImage(src){
    return new Promise((resolve,reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  function compressCoverImage(image){
    const maxSide = 720;
    const iw = image.naturalWidth || image.width;
    const ih = image.naturalHeight || image.height;
    const ratio = Math.min(1, maxSide / Math.max(iw,ih));
    const w = Math.max(1, Math.round(iw * ratio));
    const h = Math.max(1, Math.round(ih * ratio));

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

      const r=data[i];
      const g=data[i+1];
      const b=data[i+2];

      const max=Math.max(r,g,b);
      const min=Math.min(r,g,b);
      const sat=max === 0 ? 0 : (max-min)/max;
      const lum=(0.2126*r + 0.7152*g + 0.0722*b)/255;

      const extremePenalty = lum > 0.94 ? 0.2 : (lum < 0.035 ? 0.55 : 1);
      const weight = extremePenalty * (0.82 + sat * 0.38);

      const qr=Math.round(r/24)*24;
      const qg=Math.round(g/24)*24;
      const qb=Math.round(b/24)*24;
      const key=`${qr},${qg},${qb}`;

      const entry=bins.get(key) || {score:0,count:0,r:0,g:0,b:0};
      entry.score += weight;
      entry.count += 1;
      entry.r += r;
      entry.g += g;
      entry.b += b;
      bins.set(key,entry);
    }

    let best=null;
    for (const entry of bins.values()) {
      if (!best || entry.score > best.score) best=entry;
    }

    if (!best || !best.count) return "#777777";

    const rgb=[
      best.r/best.count,
      best.g/best.count,
      best.b/best.count
    ].map(Math.round);

    return rgbToHex(rgb[0],rgb[1],rgb[2]);
  }

  function readableTextColor(hex){
    const [r,g,b]=hexToRgb(hex);
    const lum=(0.2126*r + 0.7152*g + 0.0722*b)/255;
    return lum > 0.62 ? "#111" : "#fff";
  }

  function averageZ(pts){
    return pts.reduce((sum,p) => sum + p.world[2], 0) / pts.length;
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
    const len=Math.hypot(v[0],v[1],v[2]) || 1;
    return [v[0]/len,v[1]/len,v[2]/len];
  }

  function dot3(a,b){
    return a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
  }

  function hexToRgb(hex){
    let s=(hex || "#777").replace("#","");
    if (s.length === 3) s=s.split("").map(c => c+c).join("");

    const n=parseInt(s,16);
    if (!Number.isFinite(n)) return [119,119,119];

    return [(n>>16)&255,(n>>8)&255,n&255];
  }

  function rgbToHex(r,g,b){
    return `#${[r,g,b]
      .map(v => clamp(Math.round(v),0,255).toString(16).padStart(2,"0"))
      .join("")}`;
  }

  function rgbCss(v){
    return `rgb(${Math.round(v[0])},${Math.round(v[1])},${Math.round(v[2])})`;
  }

  function clamp(v,a,b){
    return Math.max(a,Math.min(b,v));
  }

  function showError(msg){
    const el=$("#error");
    el.textContent=msg;
    el.classList.add("show");
  }
})();
