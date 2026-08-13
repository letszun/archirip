(() => {
  "use strict";

  const STORAGE_KEY = "reading-archive-minimal-v3";
  const DEFAULT_BOOKS = [{
    id:"gatsby", title:"The Great Gatsby", author:"F. Scott Fitzgerald",
    readDate:"", oneLine:"", memo:"", spineColor:"#0b465f"
  }];

  const $ = s => document.querySelector(s);
  const canvas = $("#bookCanvas");
  const gl = canvas.getContext("webgl", { antialias:true, alpha:false, depth:true }) ||
             canvas.getContext("experimental-webgl", { antialias:true, alpha:false, depth:true });

  let books = loadSavedBooks();
  let activeBookId = books[0]?.id || "gatsby";
  let currentView = "single";
  let previousView = "single";
  let yaw = -0.46;
  let pitch = 0.06;
  let zoom = 1.0;
  let drag = null;
  let needsRender = true;
  let projectedBounds = null;

  const model = window.BOOK_MODEL_DATA;
  const resources = { meshes:[], cover:null, texture:null, program:null };

  initUI();
  if (!gl || !model) {
    showError(!gl ? "이 브라우저에서 WebGL을 사용할 수 없습니다." : "model-data.js를 찾을 수 없습니다.");
    return;
  }

  try {
    initGL();
    resize();
    requestAnimationFrame(loop);
  } catch (err) {
    console.error(err);
    showError("3D 모델을 초기화하지 못했습니다.");
  }

  function initUI(){
    $("#toShelf").addEventListener("click", () => showView("shelf"));
    $("#toSingle").addEventListener("click", () => showView("single"));
    $("#backDetail").addEventListener("click", () => showView(previousView));
    ["#readDate","#oneLine","#memo"].forEach(sel => $(sel).addEventListener("input", saveDetail));

    buildShelf();

    canvas.addEventListener("pointerdown", e => {
      canvas.setPointerCapture?.(e.pointerId);
      drag = { id:e.pointerId, x:e.clientX, y:e.clientY, sx:e.clientX, sy:e.clientY, moved:false };
      canvas.classList.add("dragging");
    });
    canvas.addEventListener("pointermove", e => {
      if (!drag || drag.id !== e.pointerId) return;
      const dx=e.clientX-drag.x, dy=e.clientY-drag.y;
      if (Math.hypot(e.clientX-drag.sx,e.clientY-drag.sy)>5) drag.moved=true;
      yaw += dx*0.008;
      pitch = clamp(pitch + dy*0.006, -1.05, 1.05);
      drag.x=e.clientX; drag.y=e.clientY;
      needsRender=true;
    });
    canvas.addEventListener("pointerup", e => {
      if (!drag || drag.id !== e.pointerId) return;
      const moved=drag.moved;
      drag=null; canvas.classList.remove("dragging");
      if (!moved && hitProjectedBook(e.clientX,e.clientY)) showView("detail");
    });
    canvas.addEventListener("pointercancel", () => { drag=null; canvas.classList.remove("dragging"); });
    canvas.addEventListener("wheel", e => {
      e.preventDefault();
      zoom = clamp(zoom * (e.deltaY>0 ? .92 : 1.08), .72, 1.55);
      needsRender=true;
    }, {passive:false});
    canvas.addEventListener("dblclick", () => { yaw=-.46; pitch=.06; zoom=1; needsRender=true; });
    window.addEventListener("resize", resize);
  }

  function buildShelf(){
    const shelf=$("#shelf");
    shelf.innerHTML="";
    books.forEach((book,i) => {
      const b=document.createElement("button");
      b.className="spine"; b.type="button";
      b.style.background=book.spineColor || "#111";
      b.style.width=`${32 + (i%4)*3}px`;
      b.setAttribute("aria-label",`${book.title} 열기`);
      const s=document.createElement("span"); s.textContent=book.title; b.appendChild(s);
      b.addEventListener("click",() => { activeBookId=book.id; showView("single"); needsRender=true; });
      shelf.appendChild(b);
    });
  }

  function showView(name){
    const single=$("#singleView"), shelf=$("#shelfView"), detail=$("#detailView");
    if (name === "detail") { previousView=currentView; populateDetail(); }

    if (name === "single") {
      single.className="view current";
      shelf.className="view off-right";
      detail.className="view off-right";
      currentView="single"; needsRender=true;
    } else if (name === "shelf") {
      single.className="view off-left";
      shelf.className="view current";
      detail.className="view off-right";
      currentView="shelf";
    } else if (name === "detail") {
      if (currentView === "shelf") {
        shelf.className="view off-left";
      } else {
        single.className="view off-left";
      }
      detail.className="view current";
      currentView="detail";
    }
  }

  function populateDetail(){
    const b=getBook(); if(!b)return;
    $("#readDate").value=b.readDate||"";
    $("#oneLine").value=b.oneLine||"";
    $("#memo").value=b.memo||"";
  }
  function saveDetail(){
    const b=getBook(); if(!b)return;
    b.readDate=$("#readDate").value;
    b.oneLine=$("#oneLine").value;
    b.memo=$("#memo").value;
    try{localStorage.setItem(STORAGE_KEY,JSON.stringify({books}))}catch(_){ }
  }
  function getBook(){ return books.find(b=>b.id===activeBookId)||books[0]; }
  function loadSavedBooks(){
    try{
      const s=JSON.parse(localStorage.getItem(STORAGE_KEY)||"null");
      if(Array.isArray(s?.books)&&s.books.length)return s.books;
    }catch(_){ }
    return DEFAULT_BOOKS.map(x=>({...x}));
  }

  function initGL(){
    gl.clearColor(1,1,1,1);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.POLYGON_OFFSET_FILL);

    const vs=`
      attribute vec3 aPosition;
      attribute vec3 aNormal;
      attribute vec2 aUV;
      uniform mat4 uMVP;
      uniform mat4 uModel;
      varying vec3 vNormal;
      varying vec2 vUV;
      void main(){
        gl_Position=uMVP*vec4(aPosition,1.0);
        vNormal=mat3(uModel)*aNormal;
        vUV=aUV;
      }`;
    const fs=`
      precision mediump float;
      uniform vec3 uColor;
      uniform sampler2D uTexture;
      uniform float uUseTexture;
      varying vec3 vNormal;
      varying vec2 vUV;
      void main(){
        vec3 n=normalize(vNormal);
        vec3 l=normalize(vec3(-0.25,0.65,1.0));
        float light=0.76+0.24*abs(dot(n,l));
        vec4 base = uUseTexture>0.5 ? texture2D(uTexture,vUV) : vec4(uColor,1.0);
        gl_FragColor=vec4(base.rgb*light,base.a);
      }`;
    resources.program=createProgram(vs,fs);
    gl.useProgram(resources.program);
    resources.loc={
      pos:gl.getAttribLocation(resources.program,"aPosition"),
      normal:gl.getAttribLocation(resources.program,"aNormal"),
      uv:gl.getAttribLocation(resources.program,"aUV"),
      mvp:gl.getUniformLocation(resources.program,"uMVP"),
      model:gl.getUniformLocation(resources.program,"uModel"),
      color:gl.getUniformLocation(resources.program,"uColor"),
      useTexture:gl.getUniformLocation(resources.program,"uUseTexture"),
      tex:gl.getUniformLocation(resources.program,"uTexture")
    };

    for(const mesh of model.meshes){
      resources.meshes.push(makeFlatMesh(mesh));
    }
    resources.cover=makeCoverMesh(model.cover);
    makeTexture();
  }

  function makeFlatMesh(mesh){
    const pos=[], norm=[], uv=[];
    for(const f of mesh.faces){
      const a=mesh.vertices[f[0]], b=mesh.vertices[f[1]], c=mesh.vertices[f[2]];
      const n=faceNormal(a,b,c);
      for(const idx of f){ pos.push(...mesh.vertices[idx]); norm.push(...n); uv.push(0,0); }
    }
    return { count:pos.length/3, color:hexToRgb(mesh.color||"#eeeeee"),
      pos:makeBuffer(pos), normal:makeBuffer(norm), uv:makeBuffer(uv) };
  }

  function makeCoverMesh(cover){
    const pos=[],norm=[],uv=[];
    for(const f of cover.faces){
      const a=cover.vertices[f[0]], b=cover.vertices[f[1]], c=cover.vertices[f[2]];
      const n=faceNormal(a,b,c);
      for(const idx of f){ pos.push(...cover.vertices[idx]); norm.push(...n); uv.push(...cover.uvs[idx]); }
    }
    return {count:pos.length/3,pos:makeBuffer(pos),normal:makeBuffer(norm),uv:makeBuffer(uv)};
  }

  function makeTexture(){
    const tex=gl.createTexture(); resources.texture=tex;
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([11,70,95,255]));

    const img=new Image();
    img.onload=()=>{
      gl.bindTexture(gl.TEXTURE_2D,tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);
      needsRender=true;
    };
    img.src=window.BOOK_COVER_DATA_URL||"";
  }

  function loop(){
    if(needsRender && currentView==="single"){
      needsRender=false; render();
    }
    requestAnimationFrame(loop);
  }

  function render(){
    gl.viewport(0,0,canvas.width,canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    gl.useProgram(resources.program);

    const aspect=canvas.width/canvas.height;
    const proj=perspective(34*Math.PI/180,aspect,.1,100);
    const view=translate(0,0,-5.65);
    const scaleValue=zoom;
    const modelM=multiply(rotateX(pitch),rotateY(yaw));
    const modelScaled=multiply(modelM,scale(scaleValue,scaleValue,scaleValue));
    const mv=multiply(view,modelScaled);
    const mvp=multiply(proj,mv);
    gl.uniformMatrix4fv(resources.loc.mvp,false,new Float32Array(mvp));
    gl.uniformMatrix4fv(resources.loc.model,false,new Float32Array(modelScaled));

    gl.uniform1i(resources.loc.tex,0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D,resources.texture);

    gl.disable(gl.CULL_FACE);
    gl.polygonOffset(0,0);
    for(const mesh of resources.meshes){
      bindMesh(mesh);
      gl.uniform3fv(resources.loc.color,new Float32Array(mesh.color));
      gl.uniform1f(resources.loc.useTexture,0);
      gl.drawArrays(gl.TRIANGLES,0,mesh.count);
    }

    // The cover is rendered with normal GPU perspective interpolation, so there are no diagonal seams.
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);
    gl.polygonOffset(-1,-1);
    bindMesh(resources.cover);
    gl.uniform3f(resources.loc.color,1,1,1);
    gl.uniform1f(resources.loc.useTexture,1);
    gl.drawArrays(gl.TRIANGLES,0,resources.cover.count);
    gl.disable(gl.CULL_FACE);

    projectedBounds=projectBookBounds(mvp);
  }

  function bindMesh(mesh){
    bindAttrib(resources.loc.pos,mesh.pos,3);
    bindAttrib(resources.loc.normal,mesh.normal,3);
    bindAttrib(resources.loc.uv,mesh.uv,2);
  }
  function bindAttrib(loc,buffer,size){ gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,size,gl.FLOAT,false,0,0); }
  function makeBuffer(values){ const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(values),gl.STATIC_DRAW);return b; }

  function createProgram(vsSource,fsSource){
    const vs=compile(gl.VERTEX_SHADER,vsSource), fs=compile(gl.FRAGMENT_SHADER,fsSource);
    const p=gl.createProgram(); gl.attachShader(p,vs); gl.attachShader(p,fs); gl.linkProgram(p);
    if(!gl.getProgramParameter(p,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }
  function compile(type,src){ const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s; }

  function resize(){
    const r=canvas.getBoundingClientRect();
    const dpr=Math.min(devicePixelRatio||1,2);
    const w=Math.max(1,Math.round(r.width*dpr)), h=Math.max(1,Math.round(r.height*dpr));
    if(canvas.width!==w||canvas.height!==h){ canvas.width=w;canvas.height=h;needsRender=true; }
  }

  function hitProjectedBook(clientX,clientY){
    if(!projectedBounds)return false;
    const r=canvas.getBoundingClientRect();
    const x=(clientX-r.left)*(canvas.width/r.width), y=(clientY-r.top)*(canvas.height/r.height);
    return x>=projectedBounds.minX-14 && x<=projectedBounds.maxX+14 && y>=projectedBounds.minY-14 && y<=projectedBounds.maxY+14;
  }
  function projectBookBounds(mvp){
    const pts=[];
    const xs=[-1.08,1.09], ys=[-1.58,1.58], zs=[-.16,.16];
    for(const x of xs)for(const y of ys)for(const z of zs){
      const q=transformPoint(mvp,[x,y,z,1]); if(Math.abs(q[3])<1e-6)continue;
      const nx=q[0]/q[3], ny=q[1]/q[3];
      pts.push([(nx*.5+.5)*canvas.width,(1-(ny*.5+.5))*canvas.height]);
    }
    return {minX:Math.min(...pts.map(p=>p[0])),maxX:Math.max(...pts.map(p=>p[0])),minY:Math.min(...pts.map(p=>p[1])),maxY:Math.max(...pts.map(p=>p[1]))};
  }

  function faceNormal(a,b,c){
    const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];
    let x=uy*vz-uz*vy,y=uz*vx-ux*vz,z=ux*vy-uy*vx;const l=Math.hypot(x,y,z)||1;return[x/l,y/l,z/l];
  }
  function hexToRgb(hex){let s=(hex||"#eee").replace("#","");if(s.length===3)s=s.split("").map(c=>c+c).join("");const n=parseInt(s,16);return[((n>>16)&255)/255,((n>>8)&255)/255,(n&255)/255];}
  function clamp(v,a,b){return Math.max(a,Math.min(b,v));}

  // Column-major matrices for WebGL.
  function identity(){return[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}
  function multiply(a,b){const o=new Array(16).fill(0);for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)o[c*4+r]+=a[k*4+r]*b[c*4+k];return o}
  function perspective(fovy,aspect,near,far){const f=1/Math.tan(fovy/2),nf=1/(near-far);return[f/aspect,0,0,0,0,f,0,0,0,0,(far+near)*nf,-1,0,0,(2*far*near)*nf,0]}
  function translate(x,y,z){const m=identity();m[12]=x;m[13]=y;m[14]=z;return m}
  function scale(x,y,z){const m=identity();m[0]=x;m[5]=y;m[10]=z;return m}
  function rotateX(a){const c=Math.cos(a),s=Math.sin(a);return[1,0,0,0,0,c,s,0,0,-s,c,0,0,0,0,1]}
  function rotateY(a){const c=Math.cos(a),s=Math.sin(a);return[c,0,-s,0,0,1,0,0,s,0,c,0,0,0,0,1]}
  function transformPoint(m,v){return[
    m[0]*v[0]+m[4]*v[1]+m[8]*v[2]+m[12]*v[3],
    m[1]*v[0]+m[5]*v[1]+m[9]*v[2]+m[13]*v[3],
    m[2]*v[0]+m[6]*v[1]+m[10]*v[2]+m[14]*v[3],
    m[3]*v[0]+m[7]*v[1]+m[11]*v[2]+m[15]*v[3]]}

  function showError(msg){const e=$("#webglError");e.textContent=msg;e.classList.add("show")}
})();