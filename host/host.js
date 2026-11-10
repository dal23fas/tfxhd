// TFX browser host: WASI preview1 shim (in-memory file system), canvas presentation, input, JSPI glue.
// The game logic runs entirely inside the wasm module; this file only supplies files, pixels and key events.
'use strict';
const TFXHost = (() => {
  // ---------- in-memory file system ----------
  const ERR = {ok: 0, badf: 8, exist: 20, inval: 28, isdir: 31, noent: 44, notdir: 54, nosys: 52};
  const files = new Map();      // normalized lowercase path -> {name, data:Uint8Array, size}
  const dirs = new Set(['']);
  const norm = p => p.split('/').filter(s => s && s !== '.').join('/');
  const key = p => norm(p).toLowerCase();
  const dirty = new Set();
  function addFile(path, bytes, orig) {
    const k = key(path); const parts = k.split('/');
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
    files.set(k, {name: norm(path).split('/').pop(), data: bytes, size: bytes.length, orig: !!orig});
  }
  // ---- persistence of files the game writes (pilots, saves, configuration) in IndexedDB; original game data is never stored ----
  const idb = () => new Promise((res, rej) => { const r = indexedDB.open('tfx-web', 1); r.onupgradeneeded = () => r.result.createObjectStore('files'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  async function restore() {
    try { const db = await idb(); const tx = db.transaction('files'); const st = tx.objectStore('files');
      const keys = await new Promise(r => { const q = st.getAllKeys(); q.onsuccess = () => r(q.result); });
      for (const k of keys) { const v = await new Promise(r => { const q = st.get(k); q.onsuccess = () => r(q.result); }); if (v && !files.has(k)) { addFile(v.name, v.data); saved.set(k, sig(files.get(k))); } }
      return keys.length; } catch (e) { console.warn('restore failed', e); return 0; }
  }
  const saved = new Map(); // key -> signature of what IndexedDB holds
  const sig = f => { let h = f.size | 0; const d = f.data; for (let i = 0; i < f.size; i += Math.max(1, (f.size >> 10))) h = (Math.imul(h, 31) + d[i]) | 0; return f.size + ':' + h; };
  async function flush() {
    const todo = [];
    for (const [k, f] of files) if (!f.orig && saved.get(k) !== sig(f)) todo.push(k);
    for (const k of saved.keys()) if (!files.has(k)) todo.push(k);
    if (!todo.length) return;
    try { const db = await idb(); const tx = db.transaction('files', 'readwrite'); const st = tx.objectStore('files');
      for (const k of todo) { const f = files.get(k); if (f) { st.put({name: f.name, data: f.data.slice(0, f.size)}, k); saved.set(k, sig(f)); } else { st.delete(k); saved.delete(k); } }
      await new Promise((r, j) => { tx.oncomplete = r; tx.onerror = () => j(tx.error); }); } catch (e) { console.warn('flush failed', e); }
  }
  setInterval(flush, 3000); addEventListener('visibilitychange', flush); addEventListener('pagehide', flush);
  const fds = new Map(); let nextFd = 4;
  fds.set(3, {kind: 'dir', path: ''});

  function makeWasi(getMem, args) {
    const dv = () => new DataView(getMem().buffer);
    const u8 = () => new Uint8Array(getMem().buffer);
    const enc = new TextEncoder(), dec = new TextDecoder();
    const readStr = (p, n) => dec.decode(u8().subarray(p, p + n));
    const out = {1: '', 2: ''};
    const writeLog = (fd, bytes) => {
      out[fd] += dec.decode(bytes);
      let i; while ((i = out[fd].indexOf('\n')) >= 0) { console[fd === 1 ? 'log' : 'warn']('[tfx] ' + out[fd].slice(0, i)); out[fd] = out[fd].slice(i + 1); }
    };
    function filestat(buf, type, size) {
      const d = dv(); for (let i = 0; i < 64; i += 8) d.setBigUint64(buf + i, 0n, true);
      d.setUint8(buf + 16, type); d.setBigUint64(buf + 24, 1n, true); d.setBigUint64(buf + 32, BigInt(size), true);
    }
    const argv = args.map(a => enc.encode(a + '\0'));
    return {
      args_sizes_get: (c, s) => { const d = dv(); d.setUint32(c, argv.length, true); d.setUint32(s, argv.reduce((a, b) => a + b.length, 0), true); return 0; },
      args_get: (av, buf) => { const d = dv(), m = u8(); let o = buf; argv.forEach((a, i) => { d.setUint32(av + 4 * i, o, true); m.set(a, o); o += a.length; }); return 0; },
      environ_sizes_get: (c, s) => { const d = dv(); d.setUint32(c, 0, true); d.setUint32(s, 0, true); return 0; },
      environ_get: () => 0,
      clock_time_get: (id, prec, ptr) => {
        const ns = id === 0 ? BigInt(Math.round(Date.now() * 1e6)) : BigInt(Math.round(performance.now() * 1e6));
        dv().setBigUint64(ptr, ns, true); return 0;
      },
      proc_exit: code => { throw new TFXExit(code); },
      fd_prestat_get: (fd, buf) => { if (fd !== 3) return ERR.badf; const d = dv(); d.setUint8(buf, 0); d.setUint32(buf + 4, 1, true); return 0; },
      fd_prestat_dir_name: (fd, p, n) => { if (fd !== 3) return ERR.badf; u8()[p] = 0x2f; return 0; },
      fd_close: fd => { fds.delete(fd); return 0; },
      fd_fdstat_get: (fd, buf) => {
        const d = dv(); let type = 4;
        if (fd <= 2) type = 2; else { const f = fds.get(fd); if (!f) return ERR.badf; type = f.kind === 'dir' ? 3 : 4; }
        d.setUint8(buf, type); d.setUint16(buf + 2, 0, true);
        d.setBigUint64(buf + 8, 0xffffffffffffffffn, true); d.setBigUint64(buf + 16, 0xffffffffffffffffn, true); return 0;
      },
      fd_fdstat_set_flags: () => 0,
      fd_filestat_get: (fd, buf) => {
        const f = fds.get(fd); if (!f) return ERR.badf;
        if (f.kind === 'dir') filestat(buf, 3, 0); else filestat(buf, 4, f.file.size); return 0;
      },
      fd_filestat_set_size: (fd, size) => {
        const f = fds.get(fd); if (!f || f.kind !== 'file') return ERR.badf;
        resize(f.file, Number(size)); return 0;
      },
      path_filestat_get: (dirfd, flags, p, n, buf) => {
        const k = key(readStr(p, n));
        if (dirs.has(k)) { filestat(buf, 3, 0); return 0; }
        const f = files.get(k); if (!f) return ERR.noent; filestat(buf, 4, f.size); return 0;
      },
      path_create_directory: (dirfd, p, n) => { const k = key(readStr(p, n)); if (dirs.has(k)) return ERR.exist; dirs.add(k); return 0; },
      path_remove_directory: (dirfd, p, n) => { dirs.delete(key(readStr(p, n))); return 0; },
      path_unlink_file: (dirfd, p, n) => { const k = key(readStr(p, n)); dirty.add(k); return files.delete(k) ? 0 : ERR.noent; },
      path_open: (dirfd, dirflags, p, n, oflags, rb, ri, fdflags, outp) => {
        const path = readStr(p, n), k = key(path);
        const CREAT = 1, DIRECTORY = 2, EXCL = 4, TRUNC = 8;
        if (dirs.has(k) || (oflags & DIRECTORY)) {
          if (!dirs.has(k)) return ERR.noent;
          const fd = nextFd++; fds.set(fd, {kind: 'dir', path: k}); dv().setUint32(outp, fd, true); return 0;
        }
        let file = files.get(k);
        if (file && (oflags & EXCL) && (oflags & CREAT)) return ERR.exist;
        if (!file) { if (!(oflags & CREAT)) return ERR.noent; addFile(path, new Uint8Array(0)); file = files.get(k); dirty.add(k); }
        else if (oflags & TRUNC) { resize(file, 0); dirty.add(k); }
        const fd = nextFd++; fds.set(fd, {kind: 'file', file, pos: 0, append: !!(fdflags & 1)});
        dv().setUint32(outp, fd, true); return 0;
      },
      fd_read: (fd, iovs, n, nread) => {
        const f = fds.get(fd); if (!f) return ERR.badf; if (f.kind !== 'file') return ERR.isdir;
        const d = dv(), m = u8(); let total = 0;
        for (let i = 0; i < n; i++) {
          const ptr = d.getUint32(iovs + 8 * i, true), len = d.getUint32(iovs + 8 * i + 4, true);
          const k = Math.min(len, f.file.size - f.pos); if (k <= 0) break;
          m.set(f.file.data.subarray(f.pos, f.pos + k), ptr); f.pos += k; total += k; if (k < len) break;
        }
        d.setUint32(nread, total, true); return 0;
      },
      fd_write: (fd, iovs, n, nw) => {
        const d = dv(), m = u8(); let total = 0;
        const f = fds.get(fd);
        for (let i = 0; i < n; i++) {
          const ptr = d.getUint32(iovs + 8 * i, true), len = d.getUint32(iovs + 8 * i + 4, true);
          if (fd === 1 || fd === 2) writeLog(fd, m.slice(ptr, ptr + len));
          else {
            if (!f || f.kind !== 'file') return ERR.badf;
            if (f.append) f.pos = f.file.size;
            if (f.pos + len > f.file.size) resize(f.file, f.pos + len);
            f.file.data.set(m.subarray(ptr, ptr + len), f.pos); f.pos += len; for (const [kk, vv] of files) if (vv === f.file) { dirty.add(kk); break; }
          }
          total += len;
        }
        d.setUint32(nw, total, true); return 0;
      },
      fd_seek: (fd, off, whence, outp) => {
        const f = fds.get(fd); if (!f || f.kind !== 'file') return ERR.badf;
        const o = Number(off); const base = whence === 0 ? 0 : whence === 1 ? f.pos : f.file.size;
        const np = base + o; if (np < 0) return ERR.inval; f.pos = np; dv().setBigUint64(outp, BigInt(np), true); return 0;
      },
      fd_readdir: (fd, buf, len, cookie, used) => {
        const f = fds.get(fd); if (!f || f.kind !== 'dir') return ERR.badf;
        const prefix = f.path ? f.path + '/' : '';
        const names = new Set();
        for (const [k, v] of files) if (k.startsWith(prefix) && !k.slice(prefix.length).includes('/')) names.add([v.name, 4]);
        const list = [...names].concat([...dirs].filter(x => x && x.startsWith(prefix) && !x.slice(prefix.length).includes('/')).map(x => [x.split('/').pop(), 3]));
        const d = dv(), m = u8(); let o = 0;
        for (let i = Number(cookie); i < list.length; i++) {
          const nm = enc.encode(list[i][0]); const rec = 24 + nm.length;
          const tmp = new Uint8Array(rec); const t = new DataView(tmp.buffer);
          t.setBigUint64(0, BigInt(i + 1), true); t.setBigUint64(8, BigInt(i + 1), true); t.setUint32(16, nm.length, true); t.setUint8(20, list[i][1]); tmp.set(nm, 24);
          const k = Math.min(rec, len - o); m.set(tmp.subarray(0, k), buf + o); o += k; if (k < rec) break;
        }
        d.setUint32(used, o, true); return 0;
      },
    };
  }
  function resize(file, size) {
    if (size <= file.data.length) { file.size = size; if (size === 0) file.data = new Uint8Array(0); return; }
    if (size > file.data.length) { const n = new Uint8Array(Math.max(size, Math.floor(file.data.length * 1.5))); n.set(file.data.subarray(0, file.size)); file.data = n; }
    file.size = size;
  }
  class TFXExit extends Error { constructor(code) { super('exit ' + code); this.code = code; } }

  // ---------- GLFW key map ----------
  const GLFW = {Space: 32, Quote: 39, Comma: 44, Minus: 45, Period: 46, Slash: 47, Semicolon: 59, Equal: 61,
    BracketLeft: 91, Backslash: 92, BracketRight: 93, Backquote: 96, Escape: 256, Enter: 257, Tab: 258, Backspace: 259,
    Insert: 260, Delete: 261, ArrowRight: 262, ArrowLeft: 263, ArrowDown: 264, ArrowUp: 265, PageUp: 266, PageDown: 267,
    Home: 268, End: 269, CapsLock: 280, ScrollLock: 281, NumLock: 282, PrintScreen: 283, Pause: 284,
    NumpadDecimal: 330, NumpadDivide: 331, NumpadMultiply: 332, NumpadSubtract: 333, NumpadAdd: 334, NumpadEnter: 335, NumpadEqual: 336,
    ShiftLeft: 340, ControlLeft: 341, AltLeft: 342, MetaLeft: 343, ShiftRight: 344, ControlRight: 345, AltRight: 346, MetaRight: 347};
  function codeToGlfw(code) {
    if (GLFW[code] !== undefined) return GLFW[code];
    let m;
    if ((m = /^Key([A-Z])$/.exec(code))) return m[1].charCodeAt(0);
    if ((m = /^Digit([0-9])$/.exec(code))) return 48 + +m[1];
    if ((m = /^F(\d+)$/.exec(code))) return 289 + +m[1];
    if ((m = /^Numpad([0-9])$/.exec(code))) return 320 + +m[1];
    return -1;
  }


  // Scale2x (AdvMAME2x) on 32-bit RGBA words; display only. Transparent pixels are normalised to 0 so they compare equal.
  function scale2x(src, w, h, dst) {
    for (let y = 0; y < h; y++) {
      const y0 = y > 0 ? y - 1 : 0, y1 = y < h - 1 ? y + 1 : h - 1;
      for (let x = 0; x < w; x++) {
        const x0 = x > 0 ? x - 1 : 0, x1 = x < w - 1 ? x + 1 : w - 1;
        const E = src[y * w + x], B = src[y0 * w + x], D = src[y * w + x0], F = src[y * w + x1], H = src[y1 * w + x];
        let e0 = E, e1 = E, e2 = E, e3 = E;
        if (B !== H && D !== F) { if (D === B) e0 = D; if (B === F) e1 = F; if (D === H) e2 = D; if (H === F) e3 = F; }
        const o = (2 * y) * (2 * w) + 2 * x; dst[o] = e0; dst[o + 1] = e1; dst[o + 2 * w] = e2; dst[o + 2 * w + 1] = e3;
      }
    }
  }
  const sc = {a: new Uint32Array(320 * 200), b: new Uint32Array(640 * 400), c: new Uint32Array(1280 * 800)};
  function smoothOverlay(ov8) {
    const u = new Uint32Array(ov8.buffer, ov8.byteOffset, 320 * 200);
    for (let i = 0; i < u.length; i++) { const p = u[i]; sc.a[i] = (p >>> 24) ? p : 0; }
    scale2x(sc.a, 320, 200, sc.b); scale2x(sc.b, 640, 400, sc.c);
    return new Uint8Array(sc.c.buffer);
  }

  // ---------- HD (GPU) scene renderer: WebGL2, display only ----------
  const GLSL_NOISE = `
float h21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float a=0.5,s=0.0;for(int i=0;i<5;i++){s+=a*vn(p);p=p*2.03+17.1;a*=0.5;}return s;}`;
  const gpu_dbg = {done: 0}; let state_tess = true;
  function makeGpu() {
    const cv = document.createElement('canvas');
    const gl = cv.getContext('webgl2', {antialias: true, alpha: false});
    if (!gl) return null;
    const mk = (vs, fs) => { const sh = (t, s) => { const h = gl.createShader(t); gl.shaderSource(h, s); gl.compileShader(h); if (!gl.getShaderParameter(h, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(h)); return h; };
      const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); return p; };
    const COMMON = `
uniform vec3 uPos,uRight,uDown,uFwd;uniform vec3 uSun;uniform vec3 uHaze,uZenith,uGround;uniform float uFar;
vec3 worldOf(vec3 P){return uPos+uRight*P.x+uDown*P.y+uFwd*P.z;}
vec3 grade(vec3 c){c*=1.10;float l=dot(c,vec3(0.299,0.587,0.114));c=mix(vec3(l),c,1.16);c=c/(1.0+0.28*c)*1.26;return clamp(c,0.0,1.0);}
vec3 skyAt(vec3 r){float u=clamp(-r.y,0.0,1.0);return mix(uHaze,uZenith,smoothstep(0.0,0.9,pow(u,0.55)));}`;
    // sky + distant ground, evaluated per pixel from the camera rays (replaces the banded horizon)
    const env = mk(`#version 300 es
in vec2 p;out vec2 sp;void main(){sp=p;gl_Position=vec4(p,0.0,1.0);}`,
`#version 300 es
precision highp float;in vec2 sp;out vec4 o;
uniform vec4 uCam;uniform vec2 uRes;`+COMMON+GLSL_NOISE+`
void main(){
  vec2 px=vec2((sp.x*0.5+0.5)*320.0,(1.0-(sp.y*0.5+0.5))*200.0);
  vec3 ray=normalize(uRight*(px.x-uCam.y)/uCam.x+uDown*(px.y-uCam.z)/uCam.x+uFwd);
  float up=-ray.y; // world y points down
  vec3 col;
  float sunAmt=max(dot(ray,normalize(uSun)),0.0);
  if(up>=0.0){
    float e=pow(clamp(up,0.0,1.0),0.55);
    col=mix(uHaze,uZenith,smoothstep(0.0,0.9,e));
    col+=vec3(1.0,0.78,0.5)*(pow(sunAmt,6.0)*0.35+pow(sunAmt,180.0)*0.9)*(1.0-0.6*e);
    float H=uPos.y*-1.0+2600.0; // cloud deck above the aircraft
    if(up>0.01){
      float t=(H+uPos.y)/up; vec2 w=(uPos.xz+ray.xz*t)*0.00045;
      float c=smoothstep(0.50,0.78,fbm(w)+0.25*fbm(w*3.1));
      float fade=1.0-smoothstep(0.02,0.16,1.0-up)*0.0; fade=smoothstep(0.01,0.14,up);
      vec3 cc=mix(vec3(0.78,0.74,0.72),vec3(1.0,0.93,0.82),pow(sunAmt,3.0));
      col=mix(col,cc,c*0.65*fade);
    }
  } else {
    float t=uPos.y/ray.y*-1.0; // distance to the ground plane (world y = 0)
    t=(0.0-uPos.y)/ray.y;
    vec3 w=uPos+ray*t;
    float n=fbm(w.xz*0.0012)*0.6+fbm(w.xz*0.012)*0.4;
    float cs=smoothstep(0.50,0.78,fbm((w.xz+vec2(-700.0,900.0)*(uPos.y*-1.0)*0.0004)*0.00045)+0.25*fbm(w.xz*0.00045*3.1));
    vec3 g=uGround*(0.78+0.5*n)*(1.0-0.22*cs)*mix(vec3(1.0),vec3(1.06,1.0,0.9),fbm(w.xz*0.0003));
    float f=0.5*(1.0-exp(-pow(t/uFar,1.3)*3.0));
    f=mix(f,1.0,smoothstep(1.0,3.0,t/uFar));
    col=mix(g,uHaze,clamp(f,0.0,1.0));
  }
  o=vec4(grade(col),1.0);
}`);
    const poly = mk(`#version 300 es
in vec2 p;in vec3 cp;in vec4 colm;in vec3 nrm;out vec3 vP;out vec4 vC;out vec3 vN;
void main(){gl_Position=vec4(p.x/160.0-1.0,1.0-p.y/100.0,0.0,1.0);vP=cp;vC=colm;vN=nrm;}`,
`#version 300 es
precision highp float;in vec3 vP;in vec4 vC;in vec3 vN;out vec4 o;`+COMMON+GLSL_NOISE+`
void main(){
  vec3 base=vC.rgb; float mat=vC.a; vec3 W=worldOf(vP);
  float d=length(vP);
  vec3 col=base; float alpha=1.0;
  if(mat>=3.5){ col=base*0.55; alpha=0.42; }                       // panel-gap line between differently coloured faces
  else if(mat>=2.0){ float t=mat-2.0; col=base*mix(1.22,0.62,t)*(0.9+0.2*vn(W.xz*0.05)); }
  else if(mat<0.5){
    vec3 N=normalize(vN); if(dot(N,vP)>0.0)N=-N;
    vec3 Nw=normalize(uRight*N.x+uDown*N.y+uFwd*N.z); float nu=-Nw.y;
    vec3 S=normalize(uSun); float diff=max(dot(Nw,S),0.0);
    vec3 amb=mix(vec3(0.46,0.40,0.36),vec3(0.50,0.56,0.70),nu*0.5+0.5);
    vec3 lit=amb+vec3(1.0,0.86,0.68)*diff*0.65;
    bool ground=(nu>0.85)&&(W.y>-30.0);
    if(ground){
      if(dot(base,vec3(1.0))<0.06){ col=vec3(0.0); alpha=0.38; } // the game's black ground shadow becomes a soft translucent one
      else {
        float n=fbm(W.xz*0.004)*0.55+fbm(W.xz*0.05)*0.30+vn(W.xz*0.4)*0.15;
        col=base*(0.62+0.85*n)*mix(vec3(1.0),lit*1.35,0.55);
      }
    } else {
      vec3 V=normalize(-vP); vec3 Vw=uRight*V.x+uDown*V.y+uFwd*V.z;
      vec3 R=reflect(-Vw,Nw);
      float ndv=max(dot(Nw,Vw),0.0);
      float fres=0.04+0.32*pow(1.0-ndv,4.0);
      vec3 Hh=normalize(S+Vw);
      float spec=pow(max(dot(Nw,Hh),0.0),48.0);
      float lum=dot(base,vec3(0.333));
      float up=-Nw.y;
      float sky=0.5+0.5*up;                                      // hemispheric occlusion: undersides darker
      vec3 hemi=mix(vec3(0.36,0.30,0.26),vec3(0.62,0.68,0.82),sky);
      vec3 lit2=hemi*0.95+vec3(1.0,0.86,0.68)*diff*0.72;
      float rim=pow(1.0-ndv,3.0)*0.18;
      bool glass=(lum<0.2)&&(base.b>base.r*1.05);               // dark bluish faces are canopies/windows
      col=base*lit2*1.18+skyAt(R)*fres*(0.4+lum)+vec3(1.0,0.92,0.8)*spec*0.30*(0.3+lum*1.5)+skyAt(R)*rim;
      if(glass){ float f2=0.18+0.62*pow(1.0-ndv,2.0); col=mix(col,skyAt(R)*1.05,f2)+vec3(1.0,0.95,0.85)*spec*0.9; }
      // structures near the ground: contact shadow at the base and faint floor banding on tall walls
      if(W.y>-60.0 && abs(up)<0.2){ float ao=smoothstep(0.0,14.0,-W.y); col*=0.78+0.22*ao; col*=0.97+0.03*sin(W.y*2.2); }
    }
  }
  float f=0.5*(1.0-exp(-pow(d/uFar,1.3)*3.0));
  col=mix(col,uHaze,clamp(f,0.0,1.0));
  o=vec4(grade(col),alpha);
}`);
    const tex = mk(`#version 300 es
in vec2 p;out vec2 uv;void main(){uv=p*0.5+0.5;uv.y=1.0-uv.y;gl_Position=vec4(p,0.0,1.0);}`,
`#version 300 es
precision highp float;in vec2 uv;uniform sampler2D t;uniform vec2 uRes;out vec4 o;
vec4 tap(vec2 q){return texture(t,q);}
void main(){
  vec2 size=vec2(1280.0,800.0); vec2 px=uv*size; float sc=max(uRes.x/1280.0,1.0);
  vec2 f=fract(px), s=floor(px);
  vec2 k=clamp((f-0.5)*sc+0.5,0.0,1.0);                       // sharp bilinear: crisp texels, smooth edges
  vec2 q=(s+k)/size;
  vec4 c=tap(q);
  // soft glow around bright instrument/HUD pixels
  vec3 g=vec3(0.0); float w=0.0;
  for(int i=0;i<12;i++){ float a=float(i)*0.5236; vec2 d=vec2(cos(a),sin(a));
    for(int r=1;r<=2;r++){ vec2 qq=(px+d*float(r)*4.0)/size; vec4 tc=tap(qq); float b=max(max(tc.r,tc.g),tc.b)*tc.a; b=smoothstep(0.55,1.0,b); g+=tc.rgb*b; w+=1.0; } }
  g/=w; float ga=clamp(dot(g,vec3(0.45))*1.4,0.0,0.55);
  vec3 col=c.rgb+g*0.9*(1.0-c.a);
  o=vec4(col,max(c.a,ga*(1.0-c.a)));
  o.rgb*=mix(1.0,1.04,c.a);
}`);
    const vbo = gl.createBuffer(), qb = gl.createBuffer(), t = gl.createTexture();
    gl.bindBuffer(gl.ARRAY_BUFFER, qb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,1,1,-1,-1,1,1,-1,1]), gl.STATIC_DRAW);
    gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1280, 800, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    let T = new Float32Array(1 << 17), n = 0;
    const STRIDE = 12; // sx sy cx cy cz r g b mat nx ny nz
    const vtx = (sx, sy, c, col, mat, nn) => { if (n + STRIDE > T.length) { const g = new Float32Array(T.length * 2); g.set(T); T = g; }
      T[n++] = sx; T[n++] = sy; T[n++] = c[0]; T[n++] = c[1]; T[n++] = c[2]; T[n++] = col[0]; T[n++] = col[1]; T[n++] = col[2]; T[n++] = mat; T[n++] = nn ? nn[0] : 0; T[n++] = nn ? nn[1] : 0; T[n++] = nn ? nn[2] : 0; };
    const setU = (prog, S, pal) => {
      const u = (nm, ...v) => { const l = gl.getUniformLocation(prog, nm); if (l) (v.length === 3 ? gl.uniform3f(l, ...v) : v.length === 2 ? gl.uniform2f(l, ...v) : v.length === 4 ? gl.uniform4f(l, ...v) : gl.uniform1f(l, v[0])); };
      const c = i => [pal[i*3]/255, pal[i*3+1]/255, pal[i*3+2]/255];
      u('uPos', S[5], S[6], S[7]); u('uRight', S[8], S[9], S[10]); u('uDown', S[11], S[12], S[13]); u('uFwd', S[14], S[15], S[16]);
      u('uSun', 0.25, -0.30, -1.0); u('uFar', S[4]);
      u('uHaze', ...c(240).map(v => v * 1.08)); u('uZenith', ...c(251).map(v => v * 0.9)); u('uGround', ...c(224).map(v => v * 1.1));
      u('uCam', S[0], S[1], S[2], 0); u('uRes', cv.width, cv.height);
    };
    return {cv, draw(S, pal, overlay, dw, dh) {
      if (cv.width !== dw || cv.height !== dh) { cv.width = dw; cv.height = dh; }
      gl.viewport(0, 0, dw, dh); gl.disable(gl.BLEND); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); n = 0;
      const col = i => [pal[i*3]/255, pal[i*3+1]/255, pal[i*3+2]/255];
      const F = S[0], ox = S[1], oy = S[2], near = S[3], far = S[4], nh = S[17], np = S[18]; let k = 19;
      if (!gpu_dbg.done) { gpu_dbg.done = 1; console.log('cam', Array.from(S.slice(0, 19)).map(v => +v.toFixed(3)).join(' ')); }
      for (let h = 0; h < nh; h++) { k++; const m = S[k++]; k += 2 * m; } // the banded horizon is replaced by the per-pixel sky/ground pass
      const prims = [];
      for (let q = 0; q < np; q++) { const kind = S[k], ci = S[k+1], ps = S[k+2], rad = S[k+3], m = S[k+4]; k += 5; const V = [], P = [];
        for (let i = 0; i < m; i++) { V.push([S[k], S[k+1], S[k+2]]); P.push([S[k+3], S[k+4]]); k += 5; }
        prims.push({kind, ci, c: col(ci), ps, rad, m, V, P}); }
      // Smooth vertex normals: weld shared vertices, average face normals across gentle creases only.
      const Q = 24, key = v => Math.round(v[0] * Q) + ',' + Math.round(v[1] * Q) + ',' + Math.round(v[2] * Q);
      const vmap = new Map(), emap = new Map();
      for (const pr of prims) { if (pr.kind !== 0 || pr.m < 3) continue;
        let nx = 0, ny = 0, nz = 0; const V = pr.V;
        for (let i = 0; i < pr.m; i++) { const a = V[i], b = V[(i + 1) % pr.m]; nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]); }
        const L = Math.hypot(nx, ny, nz); if (L < 1e-9) { pr.bad = true; continue; }
        let cx = 0, cy = 0, cz = 0; for (const v of V) { cx += v[0]; cy += v[1]; cz += v[2]; } cx /= pr.m; cy /= pr.m; cz /= pr.m;
        let n3 = [nx / L, ny / L, nz / L]; if (n3[0] * cx + n3[1] * cy + n3[2] * cz > 0) n3 = [-n3[0], -n3[1], -n3[2]];
        pr.n = n3; pr.area = L; pr.keys = V.map(key);
        for (const kk of pr.keys) { let l = vmap.get(kk); if (!l) vmap.set(kk, l = []); l.push(pr); }
        for (let i = 0; i < pr.m; i++) { const k1 = pr.keys[i], k2 = pr.keys[(i + 1) % pr.m]; const ek = k1 < k2 ? k1 + '|' + k2 : k2 + '|' + k1; let l = emap.get(ek); if (!l) emap.set(ek, l = []); l.push(pr); } }
      const TESS = state_tess;
      const CREASE = 0.62; // cos of about 52 degrees
      const vnorm = (pr, i) => { const l = vmap.get(pr.keys[i]); let x = 0, y = 0, z = 0;
        for (const o of l) { const d = o.n[0] * pr.n[0] + o.n[1] * pr.n[1] + o.n[2] * pr.n[2]; if (d > CREASE) { x += o.n[0] * o.area; y += o.n[1] * o.area; z += o.n[2] * o.area; } }
        const L = Math.hypot(x, y, z) || 1; return [x / L, y / L, z / L]; };
      for (const pr of prims) { const {kind, c, ps, rad, m, V, P} = pr;
        if (kind === 0 && m >= 3) {
          const nn = pr.bad ? null : V.map((_, i) => vnorm(pr, i));
          let tess = false;
          if (!pr.bad && m <= 4 && TESS) { // curved surfaces: one level of PN-triangle style subdivision, flat/ground faces untouched
            let cx = 0, cy = 0, cz = 0; for (const v of V) { cx += v[0]; cy += v[1]; cz += v[2]; } cx /= m; cy /= m; cz /= m;
            const Wy = S[6] + S[9] * cx + S[12] * cy + S[15] * cz, nu = -(S[9] * pr.n[0] + S[12] * pr.n[1] + S[15] * pr.n[2]);
            let curved = 0; for (let i = 0; i < m; i++) curved = Math.max(curved, 1 - (nn[i][0] * nn[(i + 1) % m][0] + nn[i][1] * nn[(i + 1) % m][1] + nn[i][2] * nn[(i + 1) % m][2]));
            tess = !(nu > 0.85 && Wy > -30) && curved > 0.004 && cz > 0;
          }
          if (tess) {
            const proj = v => [ox + F * v[0] / v[2], oy + F * v[1] / v[2]];
            const res = V.map((v, i) => { const q = proj(v); return [P[i][0] - q[0], P[i][1] - q[1]]; });
            const mids = new Map();
            const mid = (i, j) => { const kk = i < j ? i + ',' + j : j + ',' + i; let r = mids.get(kk); if (r) return r;
              const a = V[i], b = V[j]; let na = nn[i], nb = nn[j], smooth = true;
              if ((j - i + m) % m === 1 || (i - j + m) % m === 1) { // a real polygon edge: use the neighbour to keep the shared edge crack-free
                const k1 = pr.keys[i], k2 = pr.keys[j], ek = k1 < k2 ? k1 + '|' + k2 : k2 + '|' + k1, l = emap.get(ek);
                if (!l || l.length !== 2) smooth = false; else { const o = l[0] === pr ? l[1] : l[0];
                  if (o.n[0] * pr.n[0] + o.n[1] * pr.n[1] + o.n[2] * pr.n[2] <= CREASE || o.bad) smooth = false;
                  else { const ia = o.keys.indexOf(k1), ib = o.keys.indexOf(k2); if (ia < 0 || ib < 0) smooth = false; else { const oa = vnorm(o, ia), ob = vnorm(o, ib);
                    na = [na[0] + oa[0], na[1] + oa[1], na[2] + oa[2]]; nb = [nb[0] + ob[0], nb[1] + ob[1], nb[2] + ob[2]];
                    const La = Math.hypot(...na) || 1, Lb = Math.hypot(...nb) || 1; na = na.map(x => x / La); nb = nb.map(x => x / Lb); } } } }
              const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
              const wab = d[0] * na[0] + d[1] * na[1] + d[2] * na[2], wba = -(d[0] * nb[0] + d[1] * nb[1] + d[2] * nb[2]);
              const pos = [0, 1, 2].map(x => (a[x] + b[x]) / 2 - (smooth ? (wab * na[x] + wba * nb[x]) / 8 : 0));
              let nm = [na[0] + nb[0], na[1] + nb[1], na[2] + nb[2]]; const Ln = Math.hypot(...nm) || 1; nm = nm.map(x => x / Ln);
              const q = proj(pos); const scr = pos[2] > 0.01 ? [q[0] + (res[i][0] + res[j][0]) / 2, q[1] + (res[i][1] + res[j][1]) / 2] : [(P[i][0] + P[j][0]) / 2, (P[i][1] + P[j][1]) / 2];
              r = {pos, nrm: nm, scr}; mids.set(kk, r); return r; };
            const corner = i => ({pos: V[i], nrm: nn[i], scr: P[i]});
            const tri = (A, B, C) => { for (const v of [A, B, C]) vtx(v.scr[0], v.scr[1], v.pos, c, 0, v.nrm); };
            const split = (i, j, k) => { const A = corner(i), B = corner(j), C = corner(k), ab = mid(i, j), bc = mid(j, k), ca = mid(k, i);
              tri(A, ab, ca); tri(ab, B, bc); tri(ca, bc, C); tri(ab, bc, ca); };
            for (let i = 1; i + 1 < m; i++) split(0, i, i + 1);
          } else
          for (let i = 1; i + 1 < m; i++) for (const j of [0, i, i + 1]) vtx(P[j][0], P[j][1], V[j], c, 0, nn ? nn[j] : null);
          // thin dark seam where this face meets a differently coloured neighbour (panel lines, trim)
          if (!pr.bad) for (let i = 0; i < m; i++) { const k1 = pr.keys[i], k2 = pr.keys[(i + 1) % m]; const ek = k1 < k2 ? k1 + '|' + k2 : k2 + '|' + k1; const l = emap.get(ek);
            if (!l || l.length !== 2) continue; const o = l[0] === pr ? l[1] : l[0]; if (o.ci === pr.ci || pr.ci > o.ci) continue;
            const a = P[i], b = P[(i + 1) % m], dx = b[0] - a[0], dy = b[1] - a[1], Ln = Math.hypot(dx, dy); if (Ln < 1.5) continue; const w = 0.22, nx = -dy / Ln * w, ny = dx / Ln * w;
            const va = V[i], vb = V[(i + 1) % m];
            for (const [Q2, Vv] of [[[a[0]+nx, a[1]+ny], va], [[a[0]-nx, a[1]-ny], va], [[b[0]+nx, b[1]+ny], vb], [[a[0]-nx, a[1]-ny], va], [[b[0]-nx, b[1]-ny], vb], [[b[0]+nx, b[1]+ny], vb]]) vtx(Q2[0], Q2[1], Vv, c, 4, null); }
        }
        else if (kind === 1 && m === 2) { const a = P[0], b = P[1]; const dx = b[0]-a[0], dy = b[1]-a[1], L = Math.hypot(dx, dy) || 1, w = 0.5, nx = -dy/L*w, ny = dx/L*w;
          const A1 = [a[0]+nx, a[1]+ny], A2 = [a[0]-nx, a[1]-ny], B1 = [b[0]+nx, b[1]+ny], B2 = [b[0]-nx, b[1]-ny];
          for (const [Q2, Vv] of [[A1, V[0]], [A2, V[0]], [B1, V[1]], [A2, V[0]], [B2, V[1]], [B1, V[1]]]) vtx(Q2[0], Q2[1], Vv, c, 1);
        } else if (kind === 2 && m === 1) { const v = V[0]; const [x, y] = P[0];
          const r = ps ? ps / 2 : Math.max(0.5, rad * F / v[2]);
          for (const [dx, dy] of [[-1,-1],[1,-1],[1,1],[-1,-1],[1,1],[-1,1]]) vtx(x + dx * r, y + dy * r, v, c, ps ? 2 + (dy + 1) / 2 : 1); } }
      // 1) sky + ground
      gl.useProgram(env); setU(env, S, pal); gl.bindBuffer(gl.ARRAY_BUFFER, qb);
      let al = gl.getAttribLocation(env, 'p'); gl.enableVertexAttribArray(al); gl.vertexAttribPointer(al, 2, gl.FLOAT, false, 8, 0); gl.drawArrays(gl.TRIANGLES, 0, 6);
      // 2) lit scene geometry in the game's own back-to-front order
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.useProgram(poly); setU(poly, S, pal); gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, T.subarray(0, n), gl.DYNAMIC_DRAW);
      const bind = (nm, size, off) => { const l = gl.getAttribLocation(poly, nm); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, size, gl.FLOAT, false, STRIDE * 4, off * 4); };
      bind('p', 2, 0); bind('cp', 3, 2); bind('colm', 4, 5); bind('nrm', 3, 9);
      gl.drawArrays(gl.TRIANGLES, 0, n / STRIDE);
      // 3) cockpit / HUD layer (smoothed original)
      gl.bindTexture(gl.TEXTURE_2D, t); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1280, 800, gl.RGBA, gl.UNSIGNED_BYTE, smoothOverlay(overlay));
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.useProgram(tex); gl.uniform2f(gl.getUniformLocation(tex, 'uRes'), dw, dh);
      gl.bindBuffer(gl.ARRAY_BUFFER, qb); const ql = gl.getAttribLocation(tex, 'p'); gl.enableVertexAttribArray(ql); gl.vertexAttribPointer(ql, 2, gl.FLOAT, false, 8, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }};
  }

  // ---------- run ----------
  async function run(opts) {
    const {canvas, wasmBytes, args, onStatus} = opts;
    const ctx = canvas.getContext('2d', {alpha: false});
    const state = {down: new Set(), buttons: [0, 0, 0], mx: 0, my: 0, events: [], mode: opts.mode | 0, get remaster() { return this.mode === 1; }, focused: true,
      locked: false, cursorMode: 0x34001, wake: null, closed: false, frames: 0, lastPresent: 0};
    let mem;
    const scratch = document.createElement('canvas'); const sctx = scratch.getContext('2d');

    function canvasSize() {
      const r = canvas.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1;
      const w = Math.max(320, Math.round(r.width * dpr)), h = Math.max(200, Math.round(r.height * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      return [w, h];
    }
    const mods = e => (e.shiftKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.altKey ? 4 : 0) | (e.metaKey ? 8 : 0);
    function push(k, action, m) { state.events.push([k, action, m]); if (state.wake) { const w = state.wake; state.wake = null; w(); } }
    const onKey = down => e => {
      const k = codeToGlfw(e.code); if (k < 0) return;
      e.preventDefault();
      if (down) { push(k, state.down.has(k) ? 2 : 1, mods(e)); state.down.add(k); } else { state.down.delete(k); push(k, 0, mods(e)); }
    };
    const kd = onKey(true), ku = onKey(false);
    addEventListener('keydown', kd); addEventListener('keyup', ku);
    const blur = () => { state.down.clear(); state.focused = false; }, focus = () => { state.focused = true; };
    addEventListener('blur', blur); addEventListener('focus', focus);
    const md = e => { state.buttons[e.button] = 1; if (state.cursorMode === 0x34003 && !document.pointerLockElement) canvas.requestPointerLock?.(); e.preventDefault(); };
    const mu = e => { state.buttons[e.button] = 0; };
    canvas.addEventListener('mousedown', md); addEventListener('mouseup', mu);
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    const mm = e => {
      if (document.pointerLockElement === canvas) { state.mx += e.movementX; state.my += e.movementY; }
      else { const r = canvas.getBoundingClientRect(); state.mx = (e.clientX - r.left) * canvas.width / r.width; state.my = (e.clientY - r.top) * canvas.height / r.height; }
    };
    addEventListener('mousemove', mm);

    // Audio: the game's own mixer renders 48 kHz stereo float; blocks are scheduled as gapless AudioBuffers.
    const audio = {ctx: null, next: 0, pushed: 0, target: 0.12};
    function audioCtx() {
      if (!audio.ctx) { try { audio.ctx = new (window.AudioContext || window.webkitAudioContext)({sampleRate: 48000, latencyHint: 'interactive'}); } catch (e) { audio.ctx = false; } }
      return audio.ctx;
    }
    const unlock = () => { const c = audioCtx(); if (c && c.state !== 'running') c.resume(); };
    addEventListener('keydown', unlock); addEventListener('pointerdown', unlock);
    audio.stats = () => ({peak: audio.peak, pushed: audio.pushed, state: audio.ctx ? audio.ctx.state : 'none'});

    let gpu = null; const gpuState = {tried: false};
    const imports = {
      tfx: {
        now_ms: () => performance.now(),
        key_state: k => state.down.has(k) ? 1 : 0,
        mouse_button: b => state.buttons[b] || 0,
        mouse_pos: p => { const f = new Float64Array(mem.buffer, p, 2); f[0] = state.mx; f[1] = state.my; },
        next_event: p => { const e = state.events.shift(); if (!e) return 0; const i = new Int32Array(mem.buffer, p, 3); i[0] = e[0]; i[1] = e[1]; i[2] = e[2]; return 1; },
        sleep_ms: new WebAssembly.Suspending(ms => new Promise(res => {
          if (state.events.length || ms <= 0) { res(); return; }
          const t = setTimeout(() => { state.wake = null; res(); }, Math.min(ms, 1000));
          state.wake = () => { clearTimeout(t); res(); };
        })),
        present: new WebAssembly.Suspending((ptr, w, h, x, y, dw, dh) => {
          const px = new Uint8ClampedArray(mem.buffer.slice(ptr, ptr + w * h * 4));
          if (scratch.width !== w || scratch.height !== h) { scratch.width = w; scratch.height = h; }
          sctx.putImageData(new ImageData(px, w, h), 0, 0);
          const [cw, ch] = canvasSize();
          ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cw, ch);
          ctx.imageSmoothingEnabled = state.mode === 1; ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(scratch, x, y, dw, dh);
          state.frames++;
          return new Promise(res => requestAnimationFrame(() => res()));
        }),
        present_scene: new WebAssembly.Suspending((sp, nf, pp, op, x, y, dw, dh) => {
          if (!gpu && !gpuState.tried) { gpuState.tried = true; try { gpu = makeGpu(); } catch (e) { console.error('GPU renderer failed', e); } }
          if (gpu && dw > 0 && dh > 0) {
            const S = new Float32Array(mem.buffer, sp, nf), pal = new Uint8Array(mem.buffer, pp, 768), ov = new Uint8Array(mem.buffer, op, 320 * 200 * 4);
            gpu.draw(S, pal, ov, dw, dh);
            const [cw, ch] = canvasSize(); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cw, ch);
            ctx.imageSmoothingEnabled = true; ctx.drawImage(gpu.cv, x, y);
          }
          state.frames++;
          return new Promise(res => requestAnimationFrame(() => res()));
        }),
        window_size: p => { const [w, h] = canvasSize(); const i = new Int32Array(mem.buffer, p, 2); i[0] = w; i[1] = h; },
        cursor_mode: m => {
          state.cursorMode = m; canvas.style.cursor = m === 0x34001 ? 'default' : 'none';
          if (m !== 0x34003 && document.pointerLockElement) document.exitPointerLock?.();
        },
        should_close: () => state.closed ? 1 : 0,
        set_title: p => { const u = new Uint8Array(mem.buffer); let e = p; while (u[e]) e++; document.title = new TextDecoder().decode(u.subarray(p, e)); },
        focused: () => state.focused ? 1 : 0,
        remaster_mode: () => state.mode,
        audio_wanted: () => {
          const c = audioCtx(); if (!c || c.state !== 'running' || state.muted) return 0;
          const queued = Math.max(0, audio.next - c.currentTime);
          return Math.max(0, Math.floor((audio.target - queued) * 48000));
        },
        audio_push: (ptr, frames) => {
          const c = audio.ctx; if (!c || c.state !== 'running') return;
          const src = new Float32Array(mem.buffer, ptr, frames * 2);
          const buf = c.createBuffer(2, frames, 48000), l = buf.getChannelData(0), r = buf.getChannelData(1);
          for (let i = 0; i < frames; i++) { l[i] = src[2 * i]; r[i] = src[2 * i + 1]; }
          const node = c.createBufferSource(); node.buffer = buf; node.connect(c.destination);
          if (audio.next < c.currentTime + 0.01) audio.next = c.currentTime + 0.04;
          node.start(audio.next); audio.next += frames / 48000; audio.pushed += frames; for (let i = 0; i < frames * 2; i += 7) { const a = Math.abs(src[i]); if (a > (audio.peak || 0)) audio.peak = a; }
        },
      },
    };
    const wasi = makeWasi(() => mem, ['tfx', ...args]);
    const wmod = await WebAssembly.compile(wasmBytes);
    const inst = await WebAssembly.instantiate(wmod, {wasi_snapshot_preview1: wasi, ...imports});
    mem = inst.exports.memory;
    const start = WebAssembly.promising(inst.exports._start);
    const handle = {
      state, audio,
      setMute(m) { state.muted = !!m; },
      setMode(m) { state.mode = m | 0; },
      stop() { state.closed = true; if (state.wake) state.wake(); },
    };
    handle.done = (async () => {
      try { await start(); return 0; }
      catch (e) { if (e instanceof TFXExit) return e.code; console.error(e); throw e; }
      finally {
        removeEventListener('keydown', kd); removeEventListener('keyup', ku); removeEventListener('blur', blur); removeEventListener('focus', focus);
        removeEventListener('mouseup', mu); removeEventListener('keydown', unlock); removeEventListener('pointerdown', unlock); if (audio.ctx) audio.ctx.close(); removeEventListener('mousemove', mm);
      }
    })();
    return handle;
  }

  // User-supplied music tracks (mp3/ogg/wav). Kept in the page only, never embedded or uploaded.
  const music = {tracks: [], el: null, idx: -1, vol: 0.6, on: true,
    add(name, blob) { this.tracks.push({name, url: URL.createObjectURL(blob)}); },
    list() { return this.tracks.map(t => t.name); },
    play(i) {
      if (!this.tracks.length) return;
      this.idx = ((i % this.tracks.length) + this.tracks.length) % this.tracks.length;
      if (!this.el) { this.el = new Audio(); this.el.addEventListener('ended', () => this.on && this.play(this.idx + 1)); }
      this.el.src = this.tracks[this.idx].url; this.el.volume = this.vol;
      if (this.on) this.el.play().catch(e => console.warn('music blocked', e));
    },
    setOn(v) { this.on = !!v; if (!this.el) return; if (v) this.el.play().catch(() => {}); else this.el.pause(); },
    setVolume(v) { this.vol = v; if (this.el) this.el.volume = v; },
  };
  return {music, run, addFile, restore, flush, dirty, clearSaves: async () => { const db = await idb(); db.transaction('files', 'readwrite').objectStore('files').clear(); }, files, hasFile: n => files.has(key(n)), listFiles: () => [...files.entries()].map(([k, v]) => [v.name, v.size])};
})();
if (typeof module !== 'undefined') module.exports = TFXHost;
