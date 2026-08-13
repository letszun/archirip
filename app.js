(() => {
  "use strict";

  const DEFAULT_BOOKS = {
    books: [{
      id: "gatsby",
      title: "The Great Gatsby",
      author: "F. Scott Fitzgerald",
      readDate: "",
      oneLine: "",
      memo: "",
      spineColor: "#0b465f"
    }]
  };

  const STORAGE_KEY = "reading-archive-minimal-v2";

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  const views = {
    single: $("#singleView"),
    shelf: $("#shelfView"),
    detail: $("#detailView")
  };

  const canvas = $("#bookCanvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  const navButtons = $$("nav button");

  let books = [];
  let activeBookId = "gatsby";
  let previousView = "single";
  let currentView = "single";
  let dpr = 1;
  let width = 1;
  let height = 1;

  let yaw = -0.48;
  let pitch = 0.08;
  let zoom = 1;
  let drag = null;
  let lastHitTriangles = [];
  let renderQueued = false;

  const coverImage = new Image();
  coverImage.decoding = "async";
  coverImage.src = window.BOOK_COVER_DATA_URL || "";
  coverImage.onload = queueRender;

  init();

  async function init() {
    books = await loadBooks();
    const saved = readSaved();
    if (saved?.books?.length) books = saved.books;
    activeBookId = books[0]?.id || "gatsby";

    buildShelf();
    bindUI();
    resize();
    queueRender();
  }

  async function loadBooks() {
    if (location.protocol !== "file:") {
      try {
        const res = await fetch("./books.json", { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.books) && data.books.length) return data.books;
        }
      } catch (_) {}
    }
    return (typeof structuredClone === "function") ? structuredClone(DEFAULT_BOOKS.books) : JSON.parse(JSON.stringify(DEFAULT_BOOKS.books));
  }

  function bindUI() {
    navButtons.forEach(btn => {
      btn.addEventListener("click", () => showView(btn.dataset.view));
    });

    $("#backButton").addEventListener("click", () => showView(previousView));

    ["#readDate", "#oneLine", "#memo"].forEach(sel => {
      $(sel).addEventListener("input", saveDetail);
    });

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", endDrag);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("dblclick", () => {
      yaw = -0.48; pitch = 0.08; zoom = 1; queueRender();
    });

    window.addEventListener("resize", resize);
  }

  function buildShelf() {
    const shelf = $("#shelf");
    shelf.innerHTML = "";
    books.forEach(book => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "spine";
      b.style.background = book.spineColor || "#111";
      b.setAttribute("aria-label", `${book.title} 열기`);

      const label = document.createElement("span");
      label.textContent = book.title;
      b.appendChild(label);

      b.addEventListener("click", () => {
        activeBookId = book.id;
        showView("single");
        queueRender();
      });
      shelf.appendChild(b);
    });
  }

  function showView(name) {
    if (!views[name]) return;

    if (name === "detail") {
      previousView = currentView === "detail" ? previousView : currentView;
      populateDetail();
    } else {
      currentView = name;
    }

    Object.entries(views).forEach(([k, el]) => {
      el.classList.toggle("active", k === name);
    });
    navButtons.forEach(btn => {
      btn.classList.toggle("active", btn.dataset.view === name);
    });

    if (name === "single") {
      currentView = "single";
      setTimeout(() => { resize(); queueRender(); }, 0);
    }
    if (name === "shelf") currentView = "shelf";
  }

  function populateDetail() {
    const book = getBook();
    if (!book) return;
    $("#detailTitle").innerHTML =
      escapeHTML(book.title) +
      `<span class="author">${escapeHTML(book.author || "")}</span>`;
    $("#readDate").value = book.readDate || "";
    $("#oneLine").value = book.oneLine || "";
    $("#memo").value = book.memo || "";
  }

  function saveDetail() {
    const book = getBook();
    if (!book) return;
    book.readDate = $("#readDate").value;
    book.oneLine = $("#oneLine").value;
    book.memo = $("#memo").value;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ books })); } catch (_) {}

    const saved = $("#saved");
    saved.classList.add("on");
    clearTimeout(saveDetail.timer);
    saveDetail.timer = setTimeout(() => saved.classList.remove("on"), 850);
  }

  function getBook() {
    return books.find(b => b.id === activeBookId) || books[0];
  }

  function readSaved() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); }
    catch (_) { return null; }
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    queueRender();
  }

  function queueRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      render();
    });
  }

  function render() {
    if (!views.single.classList.contains("active")) return;

    ctx.setTransform(1,0,0,1,0,0);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr,0,0,dpr,0,0);

    const data = window.BOOK_MODEL_DATA;
    if (!data) {
      ctx.fillStyle = "#999";
      ctx.font = "12px sans-serif";
      ctx.fillText("model-data.js를 찾을 수 없습니다.", 24, 36);
      return;
    }

    const all = [];
    const hit = [];

    for (const mesh of data.meshes) {
      const tv = transformVertices(mesh.vertices);
      for (const f of mesh.faces) {
        const a = tv[f[0]], b = tv[f[1]], c = tv[f[2]];
        if (!a.visible || !b.visible || !c.visible) continue;
        const shade = lightFor(a,b,c);
        all.push({
          type:"flat",
          z:(a.z+b.z+c.z)/3,
          pts:[a,b,c],
          color:shadeColor(mesh.color, shade)
        });
      }
    }

    const cv = transformVertices(data.cover.vertices);
    for (const f of data.cover.faces) {
      const a = cv[f[0]], b = cv[f[1]], c = cv[f[2]];
      if (!a.visible || !b.visible || !c.visible) continue;
      all.push({
        type:"cover",
        z:(a.z+b.z+c.z)/3 + 0.0001,
        pts:[a,b,c],
        uv:[data.cover.uvs[f[0]], data.cover.uvs[f[1]], data.cover.uvs[f[2]]]
      });
    }

    all.sort((p,q) => p.z - q.z);

    for (const tri of all) {
      const p = tri.pts;
      if (tri.type === "cover" && coverImage.complete && coverImage.naturalWidth) {
        drawTexturedTriangle(coverImage, tri.uv, p);
      } else {
        ctx.beginPath();
        ctx.moveTo(p[0].x,p[0].y);
        ctx.lineTo(p[1].x,p[1].y);
        ctx.lineTo(p[2].x,p[2].y);
        ctx.closePath();
        ctx.fillStyle = tri.type === "cover" ? "#0b465f" : tri.color;
        ctx.fill();
      }
      hit.push([p[0],p[1],p[2]]);
    }

    lastHitTriangles = hit;
  }

  function transformVertices(vertices) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cx = Math.cos(pitch), sx = Math.sin(pitch);
    const cameraZ = 5.5;
    const focal = Math.min(width, height) * 1.18 * zoom;

    return vertices.map(v => {
      const x0 = v[0], y0 = v[1], z0 = v[2];

      const x1 = x0 * cy + z0 * sy;
      const z1 = -x0 * sy + z0 * cy;

      const y2 = y0 * cx - z1 * sx;
      const z2 = y0 * sx + z1 * cx;

      const denom = cameraZ - z2;
      return {
        X:x1, Y:y2, Z:z2,
        x:width/2 + x1 * focal / denom,
        y:height/2 - y2 * focal / denom,
        z:z2,
        visible:denom > 0.3
      };
    });
  }

  function lightFor(a,b,c) {
    const ux=b.X-a.X, uy=b.Y-a.Y, uz=b.Z-a.Z;
    const vx=c.X-a.X, vy=c.Y-a.Y, vz=c.Z-a.Z;
    let nx=uy*vz-uz*vy, ny=uz*vx-ux*vz, nz=ux*vy-uy*vx;
    const len=Math.hypot(nx,ny,nz)||1;
    nx/=len; ny/=len; nz/=len;
    const ll=Math.hypot(.35,.7,1);
    const dot=Math.abs((nx*.35+ny*.7+nz*1)/ll);
    return 0.72 + dot * 0.28;
  }

  function shadeColor(hex, factor) {
    const s = hex.replace("#","");
    const n = parseInt(s.length===3 ? s.split("").map(x=>x+x).join("") : s,16);
    const r=(n>>16)&255, g=(n>>8)&255, b=n&255;
    return `rgb(${Math.min(255,Math.round(r*factor))},${Math.min(255,Math.round(g*factor))},${Math.min(255,Math.round(b*factor))})`;
  }

  function drawTexturedTriangle(img, uv, pts) {
    const src = uv.map(([u,v]) => ({
      x:u * img.naturalWidth,
      y:(1-v) * img.naturalHeight
    }));

    const m = affine(src, pts);
    if (!m) return;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    ctx.lineTo(pts[1].x, pts[1].y);
    ctx.lineTo(pts[2].x, pts[2].y);
    ctx.closePath();
    ctx.clip();

    ctx.transform(m.a,m.b,m.c,m.d,m.e,m.f);
    ctx.drawImage(img,0,0);
    ctx.restore();
  }

  function affine(s,d) {
    const u0=s[0].x, v0=s[0].y, u1=s[1].x, v1=s[1].y, u2=s[2].x, v2=s[2].y;
    const x0=d[0].x, y0=d[0].y, x1=d[1].x, y1=d[1].y, x2=d[2].x, y2=d[2].y;
    const den = u0*(v1-v2) + u1*(v2-v0) + u2*(v0-v1);
    if (Math.abs(den) < 1e-8) return null;

    return {
      a:(x0*(v1-v2)+x1*(v2-v0)+x2*(v0-v1))/den,
      b:(y0*(v1-v2)+y1*(v2-v0)+y2*(v0-v1))/den,
      c:(x0*(u2-u1)+x1*(u0-u2)+x2*(u1-u0))/den,
      d:(y0*(u2-u1)+y1*(u0-u2)+y2*(u1-u0))/den,
      e:(x0*(u1*v2-u2*v1)+x1*(u2*v0-u0*v2)+x2*(u0*v1-u1*v0))/den,
      f:(y0*(u1*v2-u2*v1)+y1*(u2*v0-u0*v2)+y2*(u0*v1-u1*v0))/den
    };
  }

  function onPointerDown(e) {
    canvas.setPointerCapture?.(e.pointerId);
    drag = { id:e.pointerId, x:e.clientX, y:e.clientY, sx:e.clientX, sy:e.clientY, moved:false };
    canvas.classList.add("dragging");
  }

  function onPointerMove(e) {
    if (!drag || drag.id !== e.pointerId) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.hypot(e.clientX-drag.sx, e.clientY-drag.sy) > 5) drag.moved = true;

    yaw += dx * 0.008;
    pitch += dy * 0.006;
    pitch = Math.max(-1.15, Math.min(1.15, pitch));

    drag.x = e.clientX; drag.y = e.clientY;
    queueRender();
  }

  function onPointerUp(e) {
    if (!drag || drag.id !== e.pointerId) return;
    const wasMoved = drag.moved;
    endDrag();

    if (!wasMoved) {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (hitModel(x,y)) showView("detail");
    }
  }

  function endDrag() {
    drag = null;
    canvas.classList.remove("dragging");
  }

  function onWheel(e) {
    e.preventDefault();
    zoom *= e.deltaY > 0 ? 0.92 : 1.08;
    zoom = Math.max(0.68, Math.min(1.6, zoom));
    queueRender();
  }

  function hitModel(x,y) {
    for (let i=lastHitTriangles.length-1;i>=0;i--) {
      if (pointInTriangle(x,y,lastHitTriangles[i])) return true;
    }
    return false;
  }

  function pointInTriangle(px,py,t) {
    const [a,b,c] = t;
    const s1 = sign(px,py,a.x,a.y,b.x,b.y);
    const s2 = sign(px,py,b.x,b.y,c.x,c.y);
    const s3 = sign(px,py,c.x,c.y,a.x,a.y);
    const neg = s1<0 || s2<0 || s3<0;
    const pos = s1>0 || s2>0 || s3>0;
    return !(neg && pos);
  }

  function sign(px,py,x1,y1,x2,y2) {
    return (px-x2)*(y1-y2) - (x1-x2)*(py-y2);
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, ch => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
    })[ch]);
  }
})();