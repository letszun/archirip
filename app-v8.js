(() => {
  "use strict";

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

  let yaw = -0.42;
  let pitch = 0.13;
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
    fetch("./books-v8.json", { cache:"no-store" })
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

      if (Math.hypot(e.clientX-drag.sx, e.clientY-drag.sy) > 5) drag.moved = true;

      yaw += dx * 0.008;
      pitch = clamp(pitch + dy * 0.006, -1.15, 1.15);
      drag.x = e.clientX;
      drag.y = e.clientY;
      requestRender();
    });

    canvas.addEventListener("pointerup", (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      const moved = drag.moved;
      drag = null;
      canvas.classList.remove("dragging");

      if (!moved && getBook() && hitProjectedBook(e.clientX, e.clientY)) showView("detail");
    });

    canvas.addEventListener("pointercancel", () => {
      drag = null;
      canvas.classList.remove("dragging");
    });

    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      zoom = clamp(zoom * (e.deltaY > 0 ? 0.92 : 1.08), 0.68, 1.75);
      requestRender();
    }, { passive:false });

    canvas.addEventListener("dblclick", () => {
      yaw = -0.42;
      pitch = 0.13;
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
      button.title = `${book.pageCount || 300}p`;
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
      if (!$("#newBookTitle").value.trim()) $("#newBookTitle").value = pendingFileName;
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

    if (!saved) alert("책은 추가됐지만 브라우저 저장 공간이 부족해 새로고침 후에는 사라질 수 있습니다.");
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
      if (Array.isArray(saved?.books)) return saved.books.map(normalizeBook);
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
    if (coverImage.complete && coverImage.naturalWidth > 0) coverReady = true;
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

  // v8 renderer: orthographic projection + exactly one visible face from each opposing pair.
  // This removes perspective texture triangulation and painter-order tearing.
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
    const visible = chooseVisibleFaces(geometry.faces, camera);

    const projectedFaces = visible.map(face => ({
      ...face,
      projected:face.vertices.map(v => projectVertex(v,camera)),
      normalWorld:rotateVector(face.normal,camera),
      depth:face.vertices.reduce((s,v)=>s+rotatePoint(v,camera)[2],0)/face.vertices.length
    }));

    // Back-to-front only among the 2–3 genuinely visible faces.
    projectedFaces.sort((a,b)=>a.depth-b.depth);

    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;

    for (const face of projectedFaces) {
      for (const p of face.projected) {
        minX=Math.min(minX,p[0]); minY=Math.min(minY,p[1]);
        maxX=Math.max(maxX,p[0]); maxY=Math.max(maxY,p[1]);
      }

      const base = face.role === "pages" ? "#f3f0e9" : active.dominantColor;
      fillQuad(face.projected, shadeSurface(base,face.normalWorld,face.role));

      if (face.name === "front") {
        const coverQuad = geometry.cover.vertices.map(v => projectVertex(v,camera));
        if (coverReady && currentCoverSource) drawAffineCover(coverQuad);
        else fillQuad(coverQuad, active.dominantColor || "#777");
      }
    }

    projectedBounds = Number.isFinite(minX) ? {minX,minY,maxX,maxY} : null;
  }

  function makeBookGeometry(book){
    const halfW=model.width/2;
    const halfH=model.height/2;
    const halfT=normalizedThicknessForPages(book.pageCount)/2;
    const x0=-halfW,x1=halfW,y0=-halfH,y1=halfH,z0=-halfT,z1=halfT;

    const faces=[
      {name:"front",pair:"z",role:"dominant",normal:[0,0,1],vertices:[[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]]},
      {name:"back",pair:"z",role:"dominant",normal:[0,0,-1],vertices:[[x1,y0,z0],[x0,y0,z0],[x0,y1,z0],[x1,y1,z0]]},
      {name:"spine",pair:"x",role:"dominant",normal:[-1,0,0],vertices:[[x0,y0,z0],[x0,y0,z1],[x0,y1,z1],[x0,y1,z0]]},
      {name:"foreedge",pair:"x",role:"pages",normal:[1,0,0],vertices:[[x1,y0,z1],[x1,y0,z0],[x1,y1,z0],[x1,y1,z1]]},
      {name:"top",pair:"y",role:"pages",normal:[0,1,0],vertices:[[x0,y1,z1],[x1,y1,z1],[x1,y1,z0],[x0,y1,z0]]},
      {name:"bottom",pair:"y",role:"pages",normal:[0,-1,0],vertices:[[x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1]]}
    ];

    const insetX=model.width*(model.coverInsetX||0.018);
    const insetY=model.height*(model.coverInsetY||0.014);
    const cover={vertices:[
      [x0+insetX,y0+insetY,z1],
      [x1-insetX,y0+insetY,z1],
      [x1-insetX,y1-insetY,z1],
      [x0+insetX,y1-insetY,z1]
    ]};
    return {faces,cover};
  }

  function chooseVisibleFaces(faces,camera){
    const byPair={x:[],y:[],z:[]};
    for (const face of faces) {
      const n=rotateVector(face.normal,camera);
      byPair[face.pair].push({face,facing:n[2]});
    }

    const visible=[];
    for (const pair of ["x","y","z"]) {
      const candidate=byPair[pair].sort((a,b)=>b.facing-a.facing)[0];
      if (candidate && candidate.facing>0.00001) visible.push(candidate.face);
    }
    return visible;
  }

  function makeCamera(w,h){
    const scale=Math.min(w/4.65,h/4.65)*zoom;
    return {
      cx:w/2,cy:h/2,scale,
      cyaw:Math.cos(yaw),syaw:Math.sin(yaw),
      cpitch:Math.cos(pitch),spitch:Math.sin(pitch)
    };
  }

  function rotatePoint(v,camera){
    const x1=camera.cyaw*v[0]+camera.syaw*v[2];
    const z1=-camera.syaw*v[0]+camera.cyaw*v[2];
    const y2=camera.cpitch*v[1]-camera.spitch*z1;
    const z2=camera.spitch*v[1]+camera.cpitch*z1;
    return [x1,y2,z2];
  }

  function rotateVector(v,camera){
    return normalize3(rotatePoint(v,camera));
  }

  function projectVertex(v,camera){
    const p=rotatePoint(v,camera);
    return [camera.cx+p[0]*camera.scale,camera.cy-p[1]*camera.scale,p[2]];
  }

  function fillQuad(points,color){
    const p=expandPolygon(points,0.45);
    ctx.setTransform(1,0,0,1,0,0);
    ctx.beginPath();
    ctx.moveTo(p[0][0],p[0][1]);
    for (let i=1;i<p.length;i++) ctx.lineTo(p[i][0],p[i][1]);
    ctx.closePath();
    ctx.fillStyle=color;
    ctx.fill();
  }

  function expandPolygon(points,amount){
    const cx=points.reduce((s,p)=>s+p[0],0)/points.length;
    const cy=points.reduce((s,p)=>s+p[1],0)/points.length;
    return points.map(p=>{
      const dx=p[0]-cx,dy=p[1]-cy;
      const len=Math.hypot(dx,dy)||1;
      return [p[0]+dx/len*amount,p[1]+dy/len*amount,p[2]];
    });
  }

  // Orthographic projection makes a rotated rectangular cover a true parallelogram,
  // so one affine image transform maps the whole cover with no triangle seams.
  function drawAffineCover(q){
    const iw=coverImage.naturalWidth||coverImage.width;
    const ih=coverImage.naturalHeight||coverImage.height;
    if (!iw||!ih) return;

    const bottomLeft=q[0],bottomRight=q[1],topRight=q[2],topLeft=q[3];
    const a=(topRight[0]-topLeft[0])/iw;
    const b=(topRight[1]-topLeft[1])/iw;
    const c=(bottomLeft[0]-topLeft[0])/ih;
    const d=(bottomLeft[1]-topLeft[1])/ih;
    const e=topLeft[0];
    const f=topLeft[1];

    const clip=expandPolygon(q,0.3);
    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);
    ctx.beginPath();
    ctx.moveTo(clip[0][0],clip[0][1]);
    for(let i=1;i<clip.length;i++)ctx.lineTo(clip[i][0],clip[i][1]);
    ctx.closePath();
    ctx.clip();
    ctx.setTransform(a,b,c,d,e,f);
    ctx.drawImage(coverImage,0,0,iw,ih);
    ctx.restore();
  }

  function thicknessMmForPages(pageCount){
    const pages=normalizePageCount(pageCount,300);
    // Physical-ish but deliberately readable on screen.
    // 100p≈12mm, 300p≈23mm, 600p≈39mm, 900p≈56mm.
    return clamp(6.5+pages*0.055,model.minThicknessMm||8,model.maxThicknessMm||60);
  }

  function normalizedThicknessForPages(pageCount){
    return thicknessMmForPages(pageCount)*(model.height/(model.referenceHeightMm||210));
  }

  function shelfWidthForPages(pageCount){
    const mm=thicknessMmForPages(pageCount);
    const minMm=model.minThicknessMm||8;
    const maxMm=model.maxThicknessMm||60;
    const t=(mm-minMm)/Math.max(1,maxMm-minMm);
    return Math.round(8+clamp(t,0,1)*30);
  }

  function shadeSurface(hex,normal,role){
    const base=hexToRgb(hex);
    const lightDir=normalize3([-0.28,0.5,1]);
    const diffuse=Math.max(0,dot3(normalize3(normal),lightDir));
    const floor=role==="pages"?0.94:0.84;
    const range=role==="pages"?0.06:0.16;
    const k=floor+range*diffuse;
    return rgbCss(base.map(v=>clamp(v*k,0,255)));
  }

  function hitProjectedBook(clientX,clientY){
    if(!projectedBounds)return false;
    const r=canvas.getBoundingClientRect();
    const x=(clientX-r.left)*(canvas.width/r.width);
    const y=(clientY-r.top)*(canvas.height/r.height);
    const pad=18*(canvas.width/r.width);
    return x>=projectedBounds.minX-pad&&x<=projectedBounds.maxX+pad&&y>=projectedBounds.minY-pad&&y<=projectedBounds.maxY+pad;
  }

  function readFileAsDataURL(file){
    return new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=()=>resolve(String(reader.result||""));
      reader.onerror=reject;
      reader.readAsDataURL(file);
    });
  }

  function loadImage(src){
    return new Promise((resolve,reject)=>{
      const img=new Image();
      img.onload=()=>resolve(img);
      img.onerror=reject;
      img.src=src;
    });
  }

  function compressCoverImage(image){
    const maxSide=720;
    const iw=image.naturalWidth||image.width;
    const ih=image.naturalHeight||image.height;
    const ratio=Math.min(1,maxSide/Math.max(iw,ih));
    const w=Math.max(1,Math.round(iw*ratio));
    const h=Math.max(1,Math.round(ih*ratio));
    const c=document.createElement("canvas");
    c.width=w;c.height=h;
    const cctx=c.getContext("2d",{alpha:false});
    cctx.fillStyle="#fff";cctx.fillRect(0,0,w,h);
    cctx.imageSmoothingEnabled=true;cctx.imageSmoothingQuality="high";
    cctx.drawImage(image,0,0,w,h);
    return c.toDataURL("image/jpeg",0.82);
  }

  function extractDominantColor(image){
    const size=72;
    const c=document.createElement("canvas");
    c.width=size;c.height=size;
    const cctx=c.getContext("2d",{willReadFrequently:true});
    cctx.drawImage(image,0,0,size,size);
    const data=cctx.getImageData(0,0,size,size).data;
    const bins=new Map();

    for(let i=0;i<data.length;i+=4){
      if(data[i+3]<180)continue;
      const r=data[i],g=data[i+1],b=data[i+2];
      const max=Math.max(r,g,b),min=Math.min(r,g,b);
      const sat=max===0?0:(max-min)/max;
      const lum=(0.2126*r+0.7152*g+0.0722*b)/255;
      const extremePenalty=lum>0.94?0.2:(lum<0.035?0.55:1);
      const weight=extremePenalty*(0.82+sat*0.38);
      const qr=Math.round(r/24)*24,qg=Math.round(g/24)*24,qb=Math.round(b/24)*24;
      const key=`${qr},${qg},${qb}`;
      const entry=bins.get(key)||{score:0,count:0,r:0,g:0,b:0};
      entry.score+=weight;entry.count++;entry.r+=r;entry.g+=g;entry.b+=b;
      bins.set(key,entry);
    }

    let best=null;
    for(const entry of bins.values())if(!best||entry.score>best.score)best=entry;
    if(!best||!best.count)return "#777777";
    const rgb=[best.r/best.count,best.g/best.count,best.b/best.count].map(Math.round);
    return rgbToHex(rgb[0],rgb[1],rgb[2]);
  }

  function readableTextColor(hex){
    const [r,g,b]=hexToRgb(hex);
    const lum=(0.2126*r+0.7152*g+0.0722*b)/255;
    return lum>0.62?"#111":"#fff";
  }

  function normalize3(v){
    const len=Math.hypot(v[0],v[1],v[2])||1;
    return [v[0]/len,v[1]/len,v[2]/len];
  }

  function dot3(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}

  function hexToRgb(hex){
    let s=(hex||"#777").replace("#","");
    if(s.length===3)s=s.split("").map(c=>c+c).join("");
    const n=parseInt(s,16);
    if(!Number.isFinite(n))return[119,119,119];
    return[(n>>16)&255,(n>>8)&255,n&255];
  }

  function rgbToHex(r,g,b){
    return`#${[r,g,b].map(v=>clamp(Math.round(v),0,255).toString(16).padStart(2,"0")).join("")}`;
  }

  function rgbCss(v){return`rgb(${Math.round(v[0])},${Math.round(v[1])},${Math.round(v[2])})`;}
  function clamp(v,a,b){return Math.max(a,Math.min(b,v));}

  function showError(msg){
    const el=$("#error");
    el.textContent=msg;
    el.classList.add("show");
  }
})();
