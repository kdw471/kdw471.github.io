/* MindFlow — 모바일 우선 마인드맵 (독자 구현) */
(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = () => Math.random().toString(36).slice(2, 10);
const NS = 'http://www.w3.org/2000/svg';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------- 테마 ---------- */
const THEMES = {
  fresh: { name: '프레시', bg: '#f6f8fb', root: '#1e3a8a', br: ['#2563eb', '#16a34a', '#ea580c', '#9333ea', '#db2777', '#0891b2'], dark: false },
  warm:  { name: '웜',     bg: '#fff8ef', root: '#7c2d12', br: ['#e11d48', '#f59e0b', '#65a30d', '#0d9488', '#7c3aed', '#c2410c'], dark: false },
  mono:  { name: '모노',   bg: '#f4f4f5', root: '#18181b', br: ['#3f3f46', '#71717a', '#52525b', '#27272a', '#a1a1aa', '#52525b'], dark: false },
  night: { name: '나이트', bg: '#0f172a', root: '#38bdf8', br: ['#38bdf8', '#4ade80', '#fb923c', '#c084fc', '#f472b6', '#facc15'], dark: true },
};
const MARKERS = ['⭐', '❗', '❓', '✅', '❌', '💡', '🚩', '⚠️', '❤️', '📌', '1️⃣', '2️⃣', '3️⃣', '🔥', '👍', '👀'];
const SWATCH = ['', '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#64748b', '#111827'];
const SHAPES = { round: '둥근 사각형', rect: '사각형', pill: '알약', line: '밑줄' };
const STRUCTS = { map: '마인드맵', logic: '로직(오른쪽)', logicL: '로직(왼쪽)', org: '조직도(아래)' };

/* ---------- 상태 ---------- */
let doc, sel = null, view = { x: 0, y: 0, k: 1 }, mode = 'map';
let undoStack = [], redoStack = [], relFrom = null;
let layoutMap = new Map(); // id -> {n, x, y, w, h, depth, sign, color, parent}

const newNode = (t = '') => ({ id: uid(), t, c: [] });
function newDoc(title = '새 마인드맵') {
  const root = newNode('중심 주제');
  root.c = ['주제 1', '주제 2', '주제 3'].map(newNode);
  return { id: uid(), title, structure: 'map', theme: 'fresh', root, rels: [], at: Date.now() };
}
const find = (id, n = doc.root, parent = null) => {
  if (n.id === id) return { n, parent };
  for (const c of n.c) { const r = find(id, c, n); if (r) return r; }
  return null;
};
const walk = (n, f, p = null, d = 0) => { f(n, p, d); n.c.forEach(c => walk(c, f, n, d + 1)); };

/* ---------- 저장 ---------- */
const LS = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
             set: (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } },
             del: (k) => { try { localStorage.removeItem(k); } catch {} } };
const idx = () => JSON.parse(LS.get('mf:index') || '[]');
let saveT;
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    doc.at = Date.now();
    if (!LS.set('mf:doc:' + doc.id, JSON.stringify(doc))) { toast('저장 공간이 부족해요. 사진을 줄이거나 JSON으로 내보내세요'); return; }
    const list = idx().filter(x => x.id !== doc.id);
    list.unshift({ id: doc.id, title: doc.title, at: doc.at });
    LS.set('mf:index', JSON.stringify(list));
    LS.set('mf:last', doc.id);
  }, 250);
}
function loadDoc(id) {
  const raw = LS.get('mf:doc:' + id);
  if (!raw) return false;
  try { doc = JSON.parse(raw); } catch { return false; }
  doc.rels = doc.rels || [];
  sel = null; undoStack = []; redoStack = [];
  afterDocChange(true);
  return true;
}

/* ---------- 변경 / 되돌리기 ---------- */
function snap() { return JSON.stringify(doc); }
function mutate(fn, opts = {}) {
  undoStack.push(snap()); if (undoStack.length > 80) undoStack.shift();
  redoStack = [];
  fn();
  afterDocChange(false, opts);
}
function undo() {
  if (!undoStack.length) return;
  redoStack.push(snap()); doc = JSON.parse(undoStack.pop());
  if (sel && !find(sel)) sel = null;
  afterDocChange();
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(snap()); doc = JSON.parse(redoStack.pop());
  if (sel && !find(sel)) sel = null;
  afterDocChange();
}
function afterDocChange(fit = false, opts = {}) {
  $('#docTitle').textContent = doc.title;
  $('#btnUndo').disabled = !undoStack.length;
  $('#btnRedo').disabled = !redoStack.length;
  document.body.style.setProperty('--canvas', THEMES[doc.theme].bg);
  render();
  if (fit) fitView();
  else if (opts.reveal && sel) reveal(sel);
  save();
}

/* ---------- 텍스트 측정 / 레이아웃 ---------- */
const mctx = document.createElement('canvas').getContext('2d');
const FONT = 'system-ui,-apple-system,"Segoe UI","Noto Sans KR",sans-serif';
function fontFor(depth) { return depth === 0 ? `700 18px ${FONT}` : depth === 1 ? `600 15px ${FONT}` : `400 14px ${FONT}`; }
function wrapText(text, font, maxW) {
  mctx.font = font;
  const out = [];
  for (const para of String(text || ' ').split('\n')) {
    let line = '';
    for (const ch of para) {
      if (mctx.measureText(line + ch).width > maxW && line) { out.push(line); line = ch; } else line += ch;
    }
    out.push(line);
  }
  return out;
}
const PADX = 14, PADY = 9, GAP_MAIN = 44, GAP_CROSS = 10;
function measure(n, depth) {
  const font = fontFor(depth);
  const lines = wrapText(n.t, font, depth === 0 ? 240 : 200);
  mctx.font = font;
  let tw = Math.max(...lines.map(l => mctx.measureText(l).width));
  const lh = depth === 0 ? 24 : 20;
  const pre = (n.marks && n.marks.length ? n.marks.length * 20 : 0) + (n.task != null ? 20 : 0);
  const post = (n.note ? 18 : 0) + (n.link ? 18 : 0);
  const labelH = n.labels && n.labels.length ? 16 : 0;
  const imgW = n.img ? (n.imgW || 160) : 0;
  const imgH = n.img ? Math.round(imgW * (n.imgR || 0.75)) : 0;
  const imgBlock = n.img ? imgH + 6 : 0;
  tw = Math.ceil(tw);
  const w = Math.max(depth === 0 ? 90 : 56, tw + pre + post + PADX * 2, n.img ? imgW + 16 : 0);
  const h = lines.length * lh + PADY * 2 + labelH + imgBlock;
  const cy = PADY + imgBlock + lines.length * lh / 2; // 텍스트 줄 영역의 세로 중심
  return { lines, lh, w, h, pre, post, labelH, font, tw, imgW, imgH, imgBlock, cy };
}

function doLayout() {
  layoutMap = new Map();
  const st = doc.structure;
  const vertical = st === 'org';
  // 1) 측정 + 색
  walk(doc.root, (n, p, d) => {
    const m = measure(n, d);
    layoutMap.set(n.id, { n, ...m, depth: d, parent: p ? p.id : null, x: 0, y: 0, sign: 1, color: null });
  });
  const T = THEMES[doc.theme];
  doc.root.c.forEach((c, i) => {
    const col = T.br[i % T.br.length];
    walk(c, (n) => { layoutMap.get(n.id).color = col; });
  });
  layoutMap.get(doc.root.id).color = T.root;

  const cross = (L) => vertical ? L.w : L.h;
  const main = (L) => vertical ? L.h : L.w;
  const subCross = (n) => {
    const L = layoutMap.get(n.id);
    if (n.collapsed || !n.c.length) return cross(L);
    const kids = n.c.reduce((s, c) => s + subCross(c), 0) + GAP_CROSS * (n.c.length - 1);
    return Math.max(cross(L), kids);
  };
  const place = (n, mainStart, crossCenter, sign) => {
    const L = layoutMap.get(n.id);
    L.sign = sign;
    const ms = main(L), cs = cross(L);
    const mainTL = sign > 0 ? mainStart : mainStart - ms;
    const crossTL = crossCenter - cs / 2;
    if (vertical) { L.x = crossTL; L.y = mainTL; } else { L.x = mainTL; L.y = crossTL; }
    if (n.collapsed || !n.c.length) return;
    const total = n.c.reduce((s, c) => s + subCross(c), 0) + GAP_CROSS * (n.c.length - 1);
    let cur = crossCenter - total / 2;
    const childMain = sign > 0 ? mainStart + ms + GAP_MAIN : mainStart - ms - GAP_MAIN;
    for (const c of n.c) {
      const sc = subCross(c);
      place(c, childMain, cur + sc / 2, sign);
      cur += sc + GAP_CROSS;
    }
  };

  const rootN = doc.root, RL = layoutMap.get(rootN.id);
  if (st === 'map') {
    RL.x = -RL.w / 2; RL.y = -RL.h / 2;
    const right = [], left = [];
    // 높이 균형을 맞춰 좌우 분배
    let rs = 0, ls = 0;
    for (const c of rootN.c) {
      const sc = subCross(c);
      if (rs <= ls) { right.push(c); rs += sc; } else { left.push(c); ls += sc; }
    }
    const put = (arr, sign) => {
      const total = arr.reduce((s, c) => s + subCross(c), 0) + GAP_CROSS * Math.max(0, arr.length - 1);
      let cur = -total / 2;
      for (const c of arr) {
        const sc = subCross(c);
        place(c, sign * (RL.w / 2 + GAP_MAIN), cur + sc / 2, sign);
        cur += sc + GAP_CROSS;
      }
    };
    put(right, 1); put(left, -1);
    if (rootN.collapsed) { /* 자식 배치 없음 */ }
  } else if (st === 'org') {
    place(rootN, 0, 0, 1);
  } else {
    const sign = st === 'logicL' ? -1 : 1;
    place(rootN, 0, 0, sign);
  }
  // collapsed root in map: children not laid out → remove them from visible set
}

/* 보이는 노드 목록 */
function visible() {
  const out = [];
  const rec = (n) => { out.push(n); if (!n.collapsed) n.c.forEach(rec); };
  rec(doc.root);
  return out;
}

/* ---------- 렌더 ---------- */
function el(name, attrs = {}, parent) {
  const e = document.createElementNS(NS, name);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
function anchor(L, towardSign, vertical, end) {
  // end: 'out' = 부모에서 자식 쪽으로 나가는 점, 'in' = 자식에서 부모 쪽을 보는 점
  if (vertical) return end === 'out' ? { x: L.x + L.w / 2, y: L.y + L.h } : { x: L.x + L.w / 2, y: L.y };
  const s = L.sign;
  if (end === 'out') return { x: s > 0 ? L.x + L.w : L.x, y: L.y + L.h / 2 };
  return { x: s > 0 ? L.x : L.x + L.w, y: L.y + L.h / 2 };
}
function edgePath(a, b, vertical) {
  if (vertical) {
    const my = (a.y + b.y) / 2;
    return `M${a.x},${a.y} C${a.x},${my} ${b.x},${my} ${b.x},${b.y}`;
  }
  const mx = (a.x + b.x) / 2;
  return `M${a.x},${a.y} C${mx},${a.y} ${mx},${b.y} ${b.x},${b.y}`;
}
function shade(hex, f) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex); if (!m) return hex;
  const c = m.slice(1).map(h => clamp(Math.round(parseInt(h, 16) * f + (f > 1 ? (f - 1) * 120 : 0)), 0, 255));
  return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
}
function tint(hex, a) { // 흰색과 섞기
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex); if (!m) return hex;
  const c = m.slice(1).map(h => Math.round(parseInt(h, 16) * a + 255 * (1 - a)));
  return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
}

function render() {
  doLayout();
  const T = THEMES[doc.theme];
  const vp = $('#vp'); vp.textContent = '';
  const vertical = doc.structure === 'org';
  const gB = el('g', {}, vp), gE = el('g', {}, vp), gR = el('g', {}, vp), gN = el('g', {}, vp);
  const ink = T.dark ? '#e5e7eb' : '#1f2937';
  const vis = visible();

  // 경계
  for (const n of vis) if (n.bound && n.c.length && !n.collapsed) {
    let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9;
    walk(n, (m) => { const L = layoutMap.get(m.id); x1 = Math.min(x1, L.x); y1 = Math.min(y1, L.y); x2 = Math.max(x2, L.x + L.w); y2 = Math.max(y2, L.y + L.h); });
    const col = layoutMap.get(n.id).color;
    el('rect', { x: x1 - 12, y: y1 - 12, width: x2 - x1 + 24, height: y2 - y1 + 24, rx: 14, fill: col, 'fill-opacity': .09, stroke: col, 'stroke-dasharray': '6 5', 'stroke-width': 1.5 }, gB);
  }
  // 가지선
  for (const n of vis) {
    if (n.collapsed) continue;
    const P = layoutMap.get(n.id);
    for (const c of n.c) {
      const C = layoutMap.get(c.id);
      const a = anchor(P, P.sign, vertical, 'out'), b = anchor(C, C.sign, vertical, 'in');
      el('path', { d: edgePath(a, b, vertical), fill: 'none', stroke: C.color, 'stroke-width': Math.max(1.5, 4 - C.depth * .8), 'stroke-linecap': 'round' }, gE);
    }
  }
  // 노드
  for (const n of vis) {
    const L = layoutMap.get(n.id);
    const g = el('g', { 'data-id': n.id, transform: `translate(${L.x},${L.y})` }, gN);
    const shape = n.shape || (L.depth === 0 ? 'pill' : 'round');
    const filled = L.depth <= 1;
    const fill = n.col || (L.depth === 0 ? T.root : filled ? L.color : (T.dark ? shade(L.color, .35) : tint(L.color, .16)));
    const light = isLight(fill);
    const textCol = n.col ? (light ? '#111827' : '#fff') : (filled ? (T.dark && L.depth === 1 ? '#0b1220' : '#fff') : ink);
    const rx = shape === 'rect' ? 3 : shape === 'pill' ? L.h / 2 : 10;
    if (shape === 'line') {
      el('rect', { width: L.w, height: L.h, fill: 'transparent' }, g);
      el('line', { x1: 0, x2: L.w, y1: L.h, y2: L.h, stroke: n.col || L.color, 'stroke-width': 3 }, g);
    } else {
      el('rect', { width: L.w, height: L.h, rx, fill, stroke: filled ? 'none' : L.color, 'stroke-width': filled ? 0 : 1.5 }, g);
    }
    const tc = shape === 'line' ? ink : textCol;
    if (n.img) {
      const cid = 'clip-' + n.id;
      const cp = el('clipPath', { id: cid }, g);
      el('rect', { x: (L.w - L.imgW) / 2, y: PADY - 1, width: L.imgW, height: L.imgH, rx: 7 }, cp);
      const im = el('image', { x: (L.w - L.imgW) / 2, y: PADY - 1, width: L.imgW, height: L.imgH, preserveAspectRatio: 'xMidYMid slice', 'clip-path': `url(#${cid})` }, g);
      im.setAttribute('href', n.img);
      im.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', n.img);
    }
    const x0 = n.img ? Math.max(PADX, (L.w - (L.pre + L.tw + L.post)) / 2) : PADX;
    let tx = x0;
    if (n.task != null) { drawTask(g, tx, L.cy - 8, n.task, tc); tx += 20; }
    (n.marks || []).forEach(m => { const t = el('text', { x: tx, y: L.cy + 5, 'font-size': 15 }, g); t.textContent = m; tx += 20; });
    const ty0 = PADY + L.imgBlock + L.lh * 0.74;
    const t = el('text', { x: tx, y: ty0, fill: tc, 'font-family': FONT, 'font-size': parseFloat(L.font.match(/(\d+)px/)[1]), 'font-weight': L.depth === 0 ? 700 : L.depth === 1 ? 600 : 400 }, g);
    L.lines.forEach((ln, i) => { const s = el('tspan', { x: tx, dy: i ? L.lh : 0 }, t); s.textContent = ln; });
    if (n.labels && n.labels.length) {
      const lt = el('text', { x: PADX, y: L.h - 6, 'font-size': 11, fill: tc, opacity: .85, 'font-family': FONT }, g);
      lt.textContent = n.labels.map(s => '#' + s).join(' ');
    }
    let rxp = n.img ? L.w - x0 : L.w - PADX;
    if (n.link) { const e = el('text', { x: rxp - 14, y: L.cy + 5, 'font-size': 13 }, g); e.textContent = '🔗'; rxp -= 18; }
    if (n.note) { const e = el('text', { x: rxp - 14, y: L.cy + 5, 'font-size': 13 }, g); e.textContent = '📝'; }
    if (n.id === sel) {
      el('rect', { x: -4, y: -4, width: L.w + 8, height: L.h + 8, rx: rx + 3, fill: 'none', stroke: '#2563eb', 'stroke-width': 2.5, 'stroke-dasharray': relFrom === n.id ? '5 4' : '' }, g);
    }
    if (n.c.length) {
      const sgn = vertical ? 0 : L.sign;
      const bx = vertical ? L.w / 2 : (sgn > 0 ? L.w + 11 : -11), by = vertical ? L.h + 11 : L.h / 2;
      const cg = el('g', { 'data-toggle': n.id, transform: `translate(${bx},${by})` }, g);
      el('circle', { r: 11, fill: T.dark ? '#1f2937' : '#fff', stroke: L.color || '#64748b', 'stroke-width': 1.5 }, cg);
      const ct = el('text', { 'text-anchor': 'middle', y: 4, 'font-size': 11, fill: T.dark ? '#e5e7eb' : '#334155', 'font-weight': 700, 'font-family': FONT }, cg);
      ct.textContent = n.collapsed ? String(countDesc(n)) : '−';
    }
  }
  // 연결선(관계)
  for (const r of doc.rels) {
    const A = layoutMap.get(r.from), B = layoutMap.get(r.to);
    if (!A || !B || !isShown(r.from) || !isShown(r.to)) continue;
    const ax = A.x + A.w / 2, ay = A.y + A.h / 2, bx = B.x + B.w / 2, by = B.y + B.h / 2;
    const dx = bx - ax, dy = by - ay, d = Math.hypot(dx, dy) || 1;
    const nx = -dy / d * Math.min(80, d * .25), ny = dx / d * Math.min(80, d * .25);
    const cx = (ax + bx) / 2 + nx, cy = (ay + by) / 2 + ny;
    const path = el('path', { d: `M${ax},${ay} Q${cx},${cy} ${bx},${by}`, fill: 'none', stroke: '#ef4444', 'stroke-width': 2, 'stroke-dasharray': '7 5', 'marker-end': 'url(#arrow)' }, gR);
    const hit = el('path', { d: `M${ax},${ay} Q${cx},${cy} ${bx},${by}`, fill: 'none', stroke: 'transparent', 'stroke-width': 22, 'data-rel': r.id }, gR);
    void path; void hit;
  }
  ensureDefs();
  $('#svg').style.background = T.bg;
  applyView();
  if (mode === 'outline') renderOutline();
  updateToolbar();
}
function isShown(id) {
  let cur = find(id); if (!cur) return false;
  const chain = []; let p = cur.parent;
  while (p) { chain.push(p); p = find(p.id).parent; }
  return chain.every(a => !a.collapsed);
}
function isLight(hex) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex); if (!m) return true;
  const [r, g, b] = m.slice(1).map(h => parseInt(h, 16));
  return (r * 299 + g * 587 + b * 114) / 1000 > 150;
}
const countDesc = (n) => n.c.reduce((s, c) => s + 1 + countDesc(c), 0);
function drawTask(g, x, y, pct, col) {
  const c = el('circle', { cx: x + 8, cy: y + 8, r: 7, fill: 'none', stroke: col, 'stroke-width': 1.8 }, g);
  void c;
  if (pct >= 100) {
    el('circle', { cx: x + 8, cy: y + 8, r: 7, fill: col }, g);
    const t = el('path', { d: `M${x + 4.5},${y + 8.5} l2.5,2.5 l5,-5.5`, fill: 'none', stroke: col === '#fff' ? '#111' : '#fff', 'stroke-width': 1.8 }, g); void t;
  } else if (pct > 0) {
    const a = pct / 100 * Math.PI * 2, r = 7, cx = x + 8, cy = y + 8;
    const ex = cx + r * Math.sin(a), ey = cy - r * Math.cos(a);
    el('path', { d: `M${cx},${cy} L${cx},${cy - r} A${r},${r} 0 ${pct > 50 ? 1 : 0} 1 ${ex},${ey} Z`, fill: col, opacity: .85 }, g);
  }
}
function ensureDefs() {
  if ($('#defs')) return;
  const defs = el('defs', { id: 'defs' });
  const mk = el('marker', { id: 'arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 8, markerHeight: 8, orient: 'auto-start-reverse' }, defs);
  el('path', { d: 'M0,0 L10,5 L0,10 z', fill: '#ef4444' }, mk);
  $('#svg').insertBefore(defs, $('#svg').firstChild);
}

/* ---------- 뷰 이동/줌 ---------- */
function applyView() { $('#vp').setAttribute('transform', `translate(${view.x},${view.y}) scale(${view.k})`); }
function bbox() {
  let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9;
  for (const n of visible()) { const L = layoutMap.get(n.id); x1 = Math.min(x1, L.x); y1 = Math.min(y1, L.y); x2 = Math.max(x2, L.x + L.w); y2 = Math.max(y2, L.y + L.h); }
  return { x1, y1, x2, y2 };
}
function fitView() {
  const r = $('#svg').getBoundingClientRect();
  const b = bbox(), pad = 28;
  const w = b.x2 - b.x1 + pad * 2, h = b.y2 - b.y1 + pad * 2;
  const k = clamp(Math.min(r.width / w, r.height / h), 0.25, 1.4);
  view.k = k;
  view.x = r.width / 2 - ((b.x1 + b.x2) / 2) * k;
  view.y = r.height / 2 - ((b.y1 + b.y2) / 2) * k;
  applyView();
}
function reveal(id) {
  const L = layoutMap.get(id); if (!L) return;
  const r = $('#svg').getBoundingClientRect();
  const sx = L.x * view.k + view.x, sy = L.y * view.k + view.y, ex = sx + L.w * view.k, ey = sy + L.h * view.k;
  const m = 40; let dx = 0, dy = 0;
  if (sx < m) dx = m - sx; else if (ex > r.width - m) dx = r.width - m - ex;
  if (sy < m) dy = m - sy; else if (ey > r.height - m) dy = r.height - m - ey;
  view.x += dx; view.y += dy; applyView();
}
function zoomAt(cx, cy, k2) {
  k2 = clamp(k2, 0.2, 3);
  view.x = cx - (cx - view.x) * (k2 / view.k);
  view.y = cy - (cy - view.y) * (k2 / view.k);
  view.k = k2; applyView();
}

/* ---------- 제스처 ---------- */
const ptrs = new Map();
let g = null, lastTap = { id: null, t: 0 };
const svg = $('#svg');
const svgPt = (e) => { const r = svg.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
const hitId = (t) => { const e = t.closest && t.closest('[data-id]'); return e ? e.getAttribute('data-id') : null; };

svg.addEventListener('pointerdown', (e) => {
  svg.setPointerCapture(e.pointerId);
  ptrs.set(e.pointerId, svgPt(e));
  const tog = e.target.closest && e.target.closest('[data-toggle]');
  if (ptrs.size === 2) {
    const [a, b] = [...ptrs.values()];
    g = { type: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y), k: view.k };
    return;
  }
  g = { type: 'tap', id: hitId(e.target), tog: tog ? tog.getAttribute('data-toggle') : null, rel: e.target.getAttribute && e.target.getAttribute('data-rel'),
        sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, t: Date.now(), moved: false };
});
svg.addEventListener('pointermove', (e) => {
  if (!ptrs.has(e.pointerId)) return;
  ptrs.set(e.pointerId, svgPt(e));
  if (!g) return;
  if (g.type === 'pinch' && ptrs.size >= 2) {
    const [a, b] = [...ptrs.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, g.k * d / g.d);
    return;
  }
  const dx = e.clientX - g.sx, dy = e.clientY - g.sy;
  if (g.type === 'tap' && Math.hypot(dx, dy) > 7) {
    g.moved = true;
    g.type = (g.id && g.id === sel && g.id !== doc.root.id && !g.tog) ? 'dragnode' : 'pan';
    if (g.type === 'dragnode') startGhost(g.id);
  }
  if (g.type === 'pan') { view.x = g.vx + dx; view.y = g.vy + dy; applyView(); }
  else if (g.type === 'dragnode') moveGhost(e);
});
function endPtr(e) {
  if (!ptrs.has(e.pointerId)) return;
  ptrs.delete(e.pointerId);
  if (!g) return;
  if (g.type === 'pinch') { if (ptrs.size < 2) g = null; return; }
  if (ptrs.size) return;
  const gg = g; g = null;
  if (gg.type === 'dragnode') { endGhost(e); return; }
  if (gg.type === 'tap' && !gg.moved && e.type === 'pointerup') onTap(gg);
}
svg.addEventListener('pointerup', endPtr);
svg.addEventListener('pointercancel', (e) => { endGhost(null); endPtr(e); });
svg.addEventListener('wheel', (e) => {
  e.preventDefault();
  const p = svgPt(e);
  zoomAt(p.x, p.y, view.k * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
}, { passive: false });

function onTap(gg) {
  if (gg.tog) { mutate(() => { const n = find(gg.tog).n; n.collapsed = !n.collapsed; }); return; }
  if (gg.rel) { openRelSheet(gg.rel); return; }
  if (relFrom && gg.id) { finishRel(gg.id); return; }
  if (!gg.id) { sel = null; relFrom = null; setHint(''); render(); return; }
  const now = Date.now();
  if (lastTap.id === gg.id && now - lastTap.t < 380) { lastTap = { id: null, t: 0 }; sel = gg.id; startEdit(); return; }
  lastTap = { id: gg.id, t: now };
  sel = gg.id; render();
}

/* 노드 드래그 → 다른 노드로 이동 */
let ghost = null, dropTarget = null;
function startGhost(id) {
  const L = layoutMap.get(id);
  ghost = el('g', { opacity: .6, 'pointer-events': 'none' }, $('#vp'));
  el('rect', { width: L.w, height: L.h, rx: 10, fill: '#2563eb' }, ghost);
  ghost._off = { w: L.w, h: L.h };
  setHint('옮길 부모 주제 위에 놓으세요');
}
function moveGhost(e) {
  if (!ghost) return;
  const p = svgPt(e);
  const x = (p.x - view.x) / view.k, y = (p.y - view.y) / view.k;
  ghost.setAttribute('transform', `translate(${x - ghost._off.w / 2},${y - ghost._off.h / 2})`);
  dropTarget = null;
  for (const n of visible()) {
    const L = layoutMap.get(n.id);
    if (x >= L.x && x <= L.x + L.w && y >= L.y && y <= L.y + L.h && n.id !== sel) { dropTarget = n.id; break; }
  }
  $$('#vp [data-id]').forEach(g2 => g2.style.opacity = (g2.getAttribute('data-id') === dropTarget) ? .55 : '');
}
function endGhost(e) {
  if (ghost) { ghost.remove(); ghost = null; }
  $$('#vp [data-id]').forEach(g2 => g2.style.opacity = '');
  setHint('');
  if (e && dropTarget && sel) moveNode(sel, dropTarget);
  dropTarget = null;
}
function moveNode(id, newParentId) {
  const a = find(id), b = find(newParentId);
  if (!a || !b || !a.parent) return;
  let bad = false; walk(a.n, (m) => { if (m.id === newParentId) bad = true; });
  if (bad) { toast('자기 하위로는 옮길 수 없어요'); return; }
  mutate(() => { a.parent.c.splice(a.parent.c.indexOf(a.n), 1); b.n.c.push(a.n); b.n.collapsed = false; }, { reveal: true });
}

/* ---------- 편집 ---------- */
let editing = null;
function startEdit(isNew) {
  const f = find(sel); if (!f) return;
  editing = { id: sel, isNew: !!isNew, orig: f.n.t };
  const ta = $('#editText');
  ta.value = f.n.t;
  $('#editor').hidden = false;
  reveal(sel);
  setTimeout(() => { ta.focus(); ta.select(); }, 30);
}
function commitEdit(then) {
  if (!editing) return;
  const id = editing.id, isNew = editing.isNew, txt = $('#editText').value.replace(/\s+$/, '');
  editing = null; $('#editor').hidden = true;
  const f = find(id); if (!f) return;
  if (isNew && !txt) { // 비어있는 새 주제는 취소
    mutate(() => { if (f.parent) f.parent.c.splice(f.parent.c.indexOf(f.n), 1); });
    sel = f.parent ? f.parent.id : null; render(); return;
  }
  if (txt !== f.n.t) mutate(() => { f.n.t = txt || f.n.t; });
  if (then === 'child') addChild(true); else if (then === 'sibling') addSibling(true);
}
function cancelEdit() {
  if (!editing) return;
  const id = editing.id, isNew = editing.isNew;
  editing = null; $('#editor').hidden = true;
  if (isNew) { const f = find(id); if (f && f.parent) { mutate(() => f.parent.c.splice(f.parent.c.indexOf(f.n), 1)); sel = f.parent.id; render(); } }
}
$('#edOk').onclick = () => commitEdit();
$('#edCancel').onclick = cancelEdit;
$('#edChild').onclick = () => commitEdit('child');
$('#edSib').onclick = () => commitEdit('sibling');
$('#editText').addEventListener('keydown', (e) => {
  if (e.isComposing) return;
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitEdit(e.ctrlKey || e.metaKey ? 'sibling' : undefined); }
  else if (e.key === 'Tab') { e.preventDefault(); commitEdit('child'); }
  else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
});

/* ---------- 노드 조작 ---------- */
function addChild(edit) {
  if (!sel) { toast('먼저 주제를 선택하세요'); return; }
  const nn = newNode('');
  mutate(() => { const f = find(sel).n; f.collapsed = false; f.c.push(nn); sel = nn.id; }, { reveal: true });
  if (edit) startEdit(true);
}
function addSibling(edit) {
  if (!sel) { toast('먼저 주제를 선택하세요'); return; }
  const f = find(sel);
  if (!f.parent) { addChild(edit); return; }
  const nn = newNode('');
  mutate(() => { f.parent.c.splice(f.parent.c.indexOf(f.n) + 1, 0, nn); sel = nn.id; }, { reveal: true });
  if (edit) startEdit(true);
}
function delNode() {
  if (!sel) return;
  const f = find(sel);
  if (!f.parent) { toast('중심 주제는 삭제할 수 없어요'); return; }
  const ids = new Set(); walk(f.n, m => ids.add(m.id));
  const idxN = f.parent.c.indexOf(f.n);
  mutate(() => {
    f.parent.c.splice(idxN, 1);
    doc.rels = doc.rels.filter(r => !ids.has(r.from) && !ids.has(r.to));
    sel = (f.parent.c[idxN] || f.parent.c[idxN - 1] || f.parent).id;
  });
  toast('삭제했어요 · ↶로 되돌릴 수 있어요');
}
function moveSibling(dir) {
  const f = find(sel); if (!f || !f.parent) return;
  const i = f.parent.c.indexOf(f.n), j = i + dir;
  if (j < 0 || j >= f.parent.c.length) return;
  mutate(() => { f.parent.c.splice(i, 1); f.parent.c.splice(j, 0, f.n); }, { reveal: true });
}
function navigate(dir) {
  if (!sel) { sel = doc.root.id; render(); return; }
  const f = find(sel), L = layoutMap.get(sel), vertical = doc.structure === 'org';
  const sib = (d) => { if (!f.parent) return null; const a = f.parent.c, i = a.indexOf(f.n) + d; return a[i] || null; };
  let t = null;
  const toChild = () => (f.n.collapsed ? null : f.n.c[Math.floor((f.n.c.length - 1) / 2)]) || null;
  if (vertical) {
    if (dir === 'down') t = toChild(); else if (dir === 'up') t = f.parent;
    else if (dir === 'right') t = sib(1); else if (dir === 'left') t = sib(-1);
  } else {
    const away = L.sign > 0 ? 'right' : 'left', back = L.sign > 0 ? 'left' : 'right';
    if (!f.parent) { // 루트
      const side = dir === 'right' ? 1 : dir === 'left' ? -1 : 0;
      if (side) t = f.n.c.find(c => layoutMap.get(c.id).sign === side) || null;
    } else if (dir === away) t = toChild();
    else if (dir === back) t = f.parent;
    else if (dir === 'down') t = sib(1); else if (dir === 'up') t = sib(-1);
  }
  if (t) { sel = t.id; render(); reveal(sel); }
}

/* ---------- 연결선 ---------- */
function startRel() {
  if (!sel) { toast('시작 주제를 먼저 선택하세요'); return; }
  relFrom = sel; setHint('연결할 대상 주제를 탭하세요'); render();
}
function finishRel(to) {
  const from = relFrom; relFrom = null; setHint('');
  if (from === to) { render(); return; }
  mutate(() => { doc.rels.push({ id: uid(), from, to }); });
  toast('연결선을 추가했어요');
}
function openRelSheet(rid) {
  openSheet([{ k: 'rel', n: '연결선', build: (b) => {
    b.innerHTML = `<div class="list"><button class="wide dng" id="rdel">연결선 삭제</button></div>`;
    $('#rdel', b).onclick = () => { closeSheet(); mutate(() => { doc.rels = doc.rels.filter(r => r.id !== rid); }); };
  } }]);
}

/* ---------- 시트 (더보기) ---------- */
let sheetTabs = [], sheetCur = 0;
function openSheet(tabs, start = 0) {
  sheetTabs = tabs; sheetCur = start;
  $('#scrim').hidden = false; $('#sheet').hidden = false;
  buildSheet();
}
function closeSheet() { $('#scrim').hidden = true; $('#sheet').hidden = true; }
function buildSheet() {
  const tb = $('#sheetTabs'); tb.textContent = '';
  tb.style.display = sheetTabs.length > 1 ? 'flex' : 'none';
  sheetTabs.forEach((t, i) => {
    const b = document.createElement('button'); b.textContent = t.n; b.className = i === sheetCur ? 'on' : '';
    b.onclick = () => { sheetCur = i; buildSheet(); };
    tb.appendChild(b);
  });
  const body = $('#sheetBody'); body.textContent = '';
  sheetTabs[sheetCur].build(body);
}
$('#scrim').onclick = () => { closeSheet(); closeDrawer(); };

function chips(parent, items, cur, onPick, cls = '') {
  const w = document.createElement('div'); w.className = 'chips';
  items.forEach(([k, label]) => {
    const b = document.createElement('button'); b.textContent = label; b.className = (k === cur ? 'on ' : '') + cls;
    b.onclick = () => onPick(k); w.appendChild(b);
  });
  parent.appendChild(w); return w;
}
function h4(parent, t) { const h = document.createElement('h4'); h.textContent = t; parent.appendChild(h); }

function openMore() {
  if (!sel) { toast('주제를 먼저 선택하세요'); return; }
  openSheet([
    { n: '스타일', build: buildStyleTab },
    { n: '사진', build: buildImageTab },
    { n: '마커', build: buildMarkTab },
    { n: '메모·링크', build: buildNoteTab },
    { n: '작업', build: buildTaskTab },
    { n: '구조', build: buildStructTab },
    { n: '관리', build: buildManageTab },
  ]);
}
function buildStyleTab(b) {
  const f = find(sel).n;
  h4(b, '채우기 색');
  const sw = document.createElement('div'); sw.className = 'sw';
  SWATCH.forEach(c => {
    const x = document.createElement('button'); x.className = (f.col || '') === c ? 'on' : '';
    x.style.background = c || 'repeating-linear-gradient(45deg,#ddd 0 4px,#fff 4px 8px)';
    x.setAttribute('aria-label', c || '기본');
    x.onclick = () => { mutate(() => { if (c) f.col = c; else delete f.col; }); buildSheet(); };
    sw.appendChild(x);
  });
  b.appendChild(sw);
  h4(b, '모양');
  chips(b, Object.entries(SHAPES), f.shape || '', (k) => { mutate(() => { f.shape = k; }); buildSheet(); });
  h4(b, '경계(하위 묶기)');
  chips(b, [[1, '경계 켜기'], [0, '끄기']], f.bound ? 1 : 0, (k) => { mutate(() => { f.bound = !!k; }); buildSheet(); });
}
/* 사진: 긴 변 480px로 줄여 dataURL로 저장 (브라우저 저장 용량 절약) */
function loadImageFile(file) {
  return new Promise((res, rej) => {
    if (!file || !/^image\//.test(file.type)) { rej(new Error('이미지 파일이 아니에요')); return; }
    const url = URL.createObjectURL(file), im = new Image();
    im.onload = () => {
      const s = Math.min(1, 480 / Math.max(im.naturalWidth, im.naturalHeight));
      const w = Math.max(1, Math.round(im.naturalWidth * s)), h = Math.max(1, Math.round(im.naturalHeight * s));
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(im, 0, 0, w, h);
      URL.revokeObjectURL(url);
      const png = /png|gif|webp|svg/.test(file.type);
      res({ data: c.toDataURL(png ? 'image/png' : 'image/jpeg', 0.82), ratio: h / w });
    };
    im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('이미지를 읽을 수 없어요')); };
    im.src = url;
  });
}
function buildImageTab(b) {
  const f = find(sel).n;
  h4(b, '노드 사진');
  if (f.img) {
    const pv = document.createElement('img'); pv.src = f.img; pv.alt = '미리보기';
    pv.style.cssText = 'width:100%;max-height:180px;object-fit:contain;border-radius:12px;background:var(--bg);display:block';
    b.appendChild(pv);
  }
  const pick = document.createElement('label'); pick.className = 'btn'; pick.style.cssText = 'display:block;text-align:center;margin-top:10px;padding:13px';
  pick.textContent = f.img ? '사진 바꾸기 (앨범/카메라)' : '사진 추가 (앨범/카메라)';
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.hidden = true;
  inp.onchange = async () => {
    const file = inp.files[0]; if (!file) return;
    try {
      const r = await loadImageFile(file);
      mutate(() => { f.img = r.data; f.imgR = r.ratio; f.imgW = f.imgW || 160; }, { reveal: true });
      buildSheet();
    } catch (err) { toast(err.message); }
  };
  pick.appendChild(inp); b.appendChild(pick);
  if (f.img) {
    h4(b, '표시 크기');
    chips(b, [[100, '작게'], [160, '보통'], [240, '크게']], f.imgW || 160, (k) => { mutate(() => { f.imgW = k; }, { reveal: true }); buildSheet(); });
    const w = document.createElement('div'); w.className = 'list'; w.style.marginTop = '12px';
    w.innerHTML = '<button class="wide dng">사진 삭제</button>';
    w.firstChild.onclick = () => { mutate(() => { delete f.img; delete f.imgR; delete f.imgW; }); buildSheet(); };
    b.appendChild(w);
  }
}
function buildMarkTab(b) {
  const f = find(sel).n;
  h4(b, '마커 (탭하여 추가/제거)');
  const w = document.createElement('div'); w.className = 'chips';
  MARKERS.forEach(m => {
    const x = document.createElement('button'); x.textContent = m; x.className = 'mk' + ((f.marks || []).includes(m) ? ' on' : '');
    x.onclick = () => { mutate(() => { f.marks = f.marks || []; const i = f.marks.indexOf(m); if (i >= 0) f.marks.splice(i, 1); else f.marks.push(m); if (!f.marks.length) delete f.marks; }); buildSheet(); };
    w.appendChild(x);
  });
  b.appendChild(w);
  h4(b, '레이블 (쉼표로 구분)');
  const inp = document.createElement('input'); inp.type = 'text'; inp.value = (f.labels || []).join(', '); inp.placeholder = '예: 중요, 검토';
  inp.onchange = () => mutate(() => { const l = inp.value.split(',').map(s => s.trim()).filter(Boolean); if (l.length) f.labels = l; else delete f.labels; });
  b.appendChild(inp);
}
function buildNoteTab(b) {
  const f = find(sel).n;
  h4(b, '메모');
  const ta = document.createElement('textarea'); ta.value = f.note || ''; ta.placeholder = '메모를 입력하세요';
  ta.onchange = () => mutate(() => { if (ta.value.trim()) f.note = ta.value; else delete f.note; });
  b.appendChild(ta);
  h4(b, '하이퍼링크');
  const u = document.createElement('input'); u.type = 'url'; u.value = f.link || ''; u.placeholder = 'https://';
  u.onchange = () => mutate(() => { let v = u.value.trim(); if (v && !/^[a-z]+:/i.test(v)) v = 'https://' + v; if (v) f.link = v; else delete f.link; });
  b.appendChild(u);
  if (f.link) {
    const a = document.createElement('div'); a.className = 'list';
    a.innerHTML = '<button class="wide">링크 열기 ↗</button>';
    a.firstChild.onclick = () => window.open(f.link, '_blank', 'noopener');
    b.appendChild(a);
  }
}
function buildTaskTab(b) {
  const f = find(sel).n;
  h4(b, '작업 진행률');
  chips(b, [[null, '없음'], [0, '시작 전'], [25, '25%'], [50, '50%'], [75, '75%'], [100, '완료']], f.task == null ? null : f.task,
    (k) => { mutate(() => { if (k == null) delete f.task; else f.task = k; }); buildSheet(); });
}
function buildStructTab(b) {
  h4(b, '구조');
  chips(b, Object.entries(STRUCTS), doc.structure, (k) => { mutate(() => { doc.structure = k; }); buildSheet(); setTimeout(fitView, 0); });
  h4(b, '테마');
  chips(b, Object.entries(THEMES).map(([k, v]) => [k, v.name]), doc.theme, (k) => { mutate(() => { doc.theme = k; }); buildSheet(); });
}
function buildManageTab(b) {
  const f = find(sel);
  const w = document.createElement('div'); w.className = 'list';
  const items = [
    ['접기/펼치기', () => { mutate(() => { f.n.collapsed = !f.n.collapsed; }); closeSheet(); }, f.n.c.length > 0],
    ['모두 펼치기', () => { mutate(() => walk(doc.root, n => { delete n.collapsed; })); closeSheet(); }, true],
    ['↑ 위로 이동', () => moveSibling(-1), !!f.parent],
    ['↓ 아래로 이동', () => moveSibling(1), !!f.parent],
    ['복제 (하위 포함)', () => { const cp = cloneNode(f.n); mutate(() => { f.parent.c.splice(f.parent.c.indexOf(f.n) + 1, 0, cp); sel = cp.id; }, { reveal: true }); closeSheet(); }, !!f.parent],
    ['하위 주제 일괄 입력', () => { closeSheet(); bulkAdd(); }, true],
    ['삭제', () => { closeSheet(); delNode(); }, !!f.parent, 'dng'],
  ];
  items.forEach(([label, fn, ok, cls]) => { if (!ok) return; const x = document.createElement('button'); x.className = 'wide ' + (cls || ''); x.textContent = label; x.onclick = fn; w.appendChild(x); });
  b.appendChild(w);
}
function cloneNode(n) { const c = JSON.parse(JSON.stringify(n)); walk(c, m => { m.id = uid(); }); return c; }
function bulkAdd() {
  const f = find(sel).n;
  const txt = prompt('한 줄에 하나씩 입력하세요. 들여쓰기(공백 2칸/탭)로 하위 단계를 만들 수 있어요.');
  if (!txt) return;
  mutate(() => { f.collapsed = false; f.c.push(...parseIndented(txt)); }, { reveal: true });
}
function parseIndented(txt) {
  const root = { c: [] }, stack = [{ lvl: -1, node: root }];
  for (const raw of txt.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const m = /^(\s*)(?:[-*+]\s+|\d+[.)]\s+)?(.*)$/.exec(raw);
    const lvl = m[1].replace(/\t/g, '  ').length;
    const n = newNode(m[2].trim());
    while (stack.length > 1 && stack[stack.length - 1].lvl >= lvl) stack.pop();
    stack[stack.length - 1].node.c.push(n);
    stack.push({ lvl, node: n });
  }
  return root.c;
}

/* ---------- 툴바 ---------- */
function updateToolbar() {
  const tb = $('#toolbar');
  tb.classList.toggle('off', !sel && !relFrom);
  $$('#toolbar button').forEach(b => b.classList.toggle('on', b.dataset.act === 'rel' && !!relFrom));
  const f = sel && find(sel);
  $('[data-act=delete]').style.visibility = f && f.parent ? 'visible' : 'hidden';
  $('[data-act=sibling]').style.visibility = f && f.parent ? 'visible' : 'hidden';
  if (!sel && !relFrom && !$('#hint').textContent) setHint('주제를 탭해 선택하세요');
  else if (sel && $('#hint').textContent === '주제를 탭해 선택하세요') setHint('');
}
$('#toolbar').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  const a = b.dataset.act;
  if (a === 'child') addChild(true); else if (a === 'sibling') addSibling(true);
  else if (a === 'edit') startEdit(); else if (a === 'rel') (relFrom ? (relFrom = null, setHint(''), render()) : startRel());
  else if (a === 'delete') delNode(); else if (a === 'more') openMore();
});
$('#btnUndo').onclick = undo; $('#btnRedo').onclick = redo; $('#btnFit').onclick = fitView;
function setHint(t) { $('#hint').textContent = t; }
let toastT;
function toast(t) { const e = $('#toast'); e.textContent = t; e.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => e.hidden = true, 2200); }

/* ---------- 개요(아웃라인) ---------- */
function renderOutline() {
  const box = $('#outline'); box.textContent = '';
  const mk = (n, top) => {
    const ul = document.createElement('ul'); ul.className = 'ol' + (top ? ' top' : '');
    const li = document.createElement('li');
    const it = document.createElement('div'); it.className = 'it' + (n.id === sel ? ' sel' : '');
    const tg = document.createElement('span'); tg.className = 'tg'; tg.textContent = n.c.length ? (n.collapsed ? '▸' : '▾') : '•';
    tg.onclick = (e) => { e.stopPropagation(); if (n.c.length) mutate(() => { n.collapsed = !n.collapsed; }); };
    const tx = document.createElement('span'); tx.className = 'tx'; tx.textContent = (n.img ? '🖼 ' : '') + (n.marks || []).join('') + ' ' + (n.t || '(비어 있음)');
    it.append(tg, tx);
    if (n.task != null) { const bd = document.createElement('span'); bd.className = 'bd'; bd.textContent = n.task + '%'; it.appendChild(bd); }
    let lt = 0;
    it.onclick = () => { const now = Date.now(); if (sel === n.id && now - lt < 450) { startEdit(); } sel = n.id; lt = now; renderOutlineSoft(); updateToolbar(); };
    li.appendChild(it);
    if (n.c.length && !n.collapsed) n.c.forEach(c => li.appendChild(mk(c, false)));
    ul.appendChild(li); return ul;
  };
  box.appendChild(mk(doc.root, true));
}
function renderOutlineSoft() { const st = $('#outline').scrollTop; renderOutline(); $('#outline').scrollTop = st; }
function setMode(m) {
  mode = m;
  $$('#viewSeg button').forEach(b => b.classList.toggle('on', b.dataset.view === m));
  $('#outline').hidden = m !== 'outline';
  $('#svg').style.visibility = m === 'map' ? 'visible' : 'hidden';
  $('#btnFit').style.display = m === 'map' ? '' : 'none';
  if (m === 'outline') renderOutline(); else fitIfNeeded();
}
function fitIfNeeded() { render(); }
$('#viewSeg').onclick = (e) => { const b = e.target.closest('button'); if (b) setMode(b.dataset.view); };

/* ---------- 문서 / 드로어 ---------- */
function openDrawer() { buildDocList(); $('#scrim').hidden = false; $('#drawer').hidden = false; }
function closeDrawer() { $('#drawer').hidden = true; if ($('#sheet').hidden) $('#scrim').hidden = true; }
function buildDocList() {
  const ul = $('#docList'); ul.textContent = '';
  idx().forEach(d => {
    const li = document.createElement('li'); if (d.id === doc.id) li.className = 'cur';
    const b = document.createElement('button'); b.className = 'nm'; b.textContent = d.title;
    b.onclick = () => { closeDrawer(); loadDoc(d.id); };
    const r = document.createElement('button'); r.className = 'rm'; r.textContent = '🗑'; r.setAttribute('aria-label', '삭제');
    r.onclick = () => {
      if (!confirm(`"${d.title}" 마인드맵을 삭제할까요?`)) return;
      LS.del('mf:doc:' + d.id); LS.set('mf:index', JSON.stringify(idx().filter(x => x.id !== d.id)));
      if (d.id === doc.id) { const rest = idx(); if (rest.length) loadDoc(rest[0].id); else { doc = newDoc(); afterDocChange(true); } }
      buildDocList();
    };
    li.append(b, r); ul.appendChild(li);
  });
}
$('#btnMenu').onclick = openDrawer; $('#drClose').onclick = closeDrawer;
$('#drNew').onclick = () => { closeDrawer(); doc = newDoc(); sel = null; undoStack = []; redoStack = []; afterDocChange(true); };
$('#docTitle').onclick = () => {
  const t = prompt('마인드맵 제목', doc.title);
  if (t && t.trim()) mutate(() => { doc.title = t.trim(); });
};

/* ---------- 가져오기 / 내보내기 ---------- */
function download(name, blob) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
const safeName = () => (doc.title || 'mindmap').replace(/[\\/:*?"<>|]+/g, '_');
function toMarkdown() {
  const lines = [];
  walk(doc.root, (n, p, d) => {
    const mk = (n.marks || []).join('');
    let line = '  '.repeat(d) + '- ' + (mk ? mk + ' ' : '') + n.t.replace(/\n/g, ' ');
    if (n.link) line += ` (${n.link})`;
    lines.push(line);
    if (n.note) n.note.split('\n').forEach(l => lines.push('  '.repeat(d + 1) + '> ' + l));
  });
  return `# ${doc.title}\n\n` + lines.join('\n') + '\n';
}
function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
}
async function ensureZip() {
  if (window.JSZip) return;
  try { await loadScript('jszip.min.js'); }                 // 서버에 내장된 사본 (오프라인·모바일 안전)
  catch { await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'); }
}
function nodeToXmind(n) {
  const t = { id: n.id, class: 'topic', title: n.t };
  if (n.c.length) t.children = { attached: n.c.map(nodeToXmind) };
  if (n.note) t.notes = { plain: { content: n.note } };
  if (n.labels) t.labels = n.labels;
  if (n.link) t.href = n.link;
  if (n.collapsed) t.branch = 'folded';
  return t;
}
/* XMind 마커 ID → 이모지 / 작업 진행률 */
const XM_MARK = { 'symbol-right': '✅', 'symbol-wrong': '❌', 'symbol-question': '❓', 'symbol-exclam': '❗', 'symbol-info': '💡',
  'symbol-plus': '➕', 'symbol-minus': '➖', 'symbol-pause': '⏸', 'symbol-attention': '⚠️' };
function xmMarker(id) {
  if (!id) return null;
  if (XM_MARK[id]) return XM_MARK[id];
  let m = /^priority-(\d)$/.exec(id); if (m) return ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'][+m[1]];
  if (/^flag-/.test(id)) return '🚩';
  if (/^star-/.test(id)) return '⭐';
  if (/^smiley-/.test(id)) return '🙂';
  if (/^people-/.test(id)) return '👤';
  return null;
}
function xmTask(id) {
  const m = /^task-(start|oct|quarter|3quar|half|1oct|2oct|3oct|4oct|5oct|6oct|7oct|done)/.exec(id || '');
  if (!m) return null;
  return { start: 0, quarter: 25, half: 50, '3quar': 75, done: 100 }[m[1]] ?? (m[1].endsWith('oct') ? Math.round(parseInt(m[1]) / 8 * 100) || 50 : 50);
}
async function xmImage(zip, src) {
  try {
    if (!zip || !src) return null;
    const path = String(src).replace(/^xap:/, '');
    const f = zip.file(path) || zip.file(decodeURIComponent(path));
    if (!f) return null;
    const blob = await f.async('blob');
    const ext = (path.split('.').pop() || 'png').toLowerCase();
    const type = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' }[ext] || 'image/png';
    return await loadImageFile(new File([blob], 'x.' + ext, { type }));
  } catch { return null; }
}
async function nodeFromXmind(t, zip) {
  const n = newNode(t.title || '');
  const kids = [...((t.children && t.children.attached) || []), ...((t.children && t.children.detached) || [])];
  for (const k of kids) n.c.push(await nodeFromXmind(k, zip));
  if (t.notes && t.notes.plain && t.notes.plain.content) n.note = t.notes.plain.content;
  if (t.labels && t.labels.length) n.labels = t.labels;
  if (t.href) n.link = t.href;
  if (t.branch === 'folded') n.collapsed = true;
  const marks = [];
  for (const mk of (t.markers || [])) {
    const id = mk.markerId || mk;
    const tk = xmTask(id);
    if (tk != null) n.task = tk; else { const e = xmMarker(id); if (e && !marks.includes(e)) marks.push(e); }
  }
  if (marks.length) n.marks = marks;
  if (t.image && t.image.src) {
    const r = await xmImage(zip, t.image.src);
    if (r) { n.img = r.data; n.imgR = r.ratio; n.imgW = 160; }
  }
  return n;
}
/* 구버전 XMind (content.xml) */
async function nodeFromXmindXml(el, zip) {
  const kids = (parent, name) => [...parent.children].filter(c => c.localName === name);
  const n = newNode((kids(el, 'title')[0] || {}).textContent || '');
  const ch = kids(el, 'children')[0];
  if (ch) for (const tp of kids(ch, 'topics')) for (const t of kids(tp, 'topic')) n.c.push(await nodeFromXmindXml(t, zip));
  const href = el.getAttribute('xlink:href'); if (href && /^https?:/.test(href)) n.link = href;
  if (el.getAttribute('branch') === 'folded') n.collapsed = true;
  const notes = kids(el, 'notes')[0];
  if (notes) { const p = notes.getElementsByTagName('plain')[0]; if (p && p.textContent.trim()) n.note = p.textContent.trim(); }
  const lab = kids(el, 'labels')[0]; if (lab) { const l = [...lab.children].map(x => x.textContent.trim()).filter(Boolean); if (l.length) n.labels = l; }
  const mr = kids(el, 'marker-refs')[0];
  if (mr) { const marks = []; for (const m of mr.children) { const id = m.getAttribute('marker-id'); const tk = xmTask(id); if (tk != null) n.task = tk; else { const e = xmMarker(id); if (e && !marks.includes(e)) marks.push(e); } } if (marks.length) n.marks = marks; }
  return n;
}
async function importXmind(file) {
  await ensureZip();
  let z;
  try { z = await JSZip.loadAsync(file); } catch { throw new Error('올바른 .xmind(zip) 파일이 아니에요'); }
  const base = (file.name || 'XMind').replace(/\.xmind$/i, '');
  const cj = z.file('content.json');
  if (cj) {
    const sheets = JSON.parse(await cj.async('string'));
    const s = sheets[0];
    if (!s || !s.rootTopic) throw new Error('맵 내용을 찾을 수 없어요');
    return { title: s.title || base, root: await nodeFromXmind(s.rootTopic, z), count: sheets.length };
  }
  const cx = z.file('content.xml');
  if (cx) {
    const xml = new DOMParser().parseFromString(await cx.async('string'), 'application/xml');
    const sheet = xml.getElementsByTagName('sheet')[0];
    const top = sheet && [...sheet.children].find(c => c.localName === 'topic');
    if (!top) throw new Error('맵 내용을 찾을 수 없어요');
    const st = [...sheet.children].find(c => c.localName === 'title');
    return { title: (st && st.textContent.trim()) || base, root: await nodeFromXmindXml(top, z), count: xml.getElementsByTagName('sheet').length };
  }
  throw new Error('지원하지 않는 .xmind 구조예요 (content.json/xml 없음)');
}
async function exportXmind() {
  try { await ensureZip(); } catch { toast('.xmind 내보내기는 인터넷 연결이 필요해요'); return; }
  const zip = new JSZip();
  const sheet = [{ id: uid(), class: 'sheet', title: doc.title, rootTopic: nodeToXmind(doc.root) }];
  zip.file('content.json', JSON.stringify(sheet));
  zip.file('metadata.json', JSON.stringify({ creator: { name: 'MindFlow' } }));
  zip.file('manifest.json', JSON.stringify({ 'file-entries': { 'content.json': {}, 'metadata.json': {} } }));
  download(safeName() + '.xmind', await zip.generateAsync({ type: 'blob' }));
}
function exportPng() {
  const b = bbox(), pad = 30, w = Math.ceil(b.x2 - b.x1 + pad * 2), h = Math.ceil(b.y2 - b.y1 + pad * 2);
  const clone = $('#vp').cloneNode(true);
  clone.setAttribute('transform', `translate(${pad - b.x1},${pad - b.y1})`);
  clone.querySelectorAll('[data-toggle]').forEach(x => x.remove());
  const T = THEMES[doc.theme];
  const xml = `<svg xmlns="${NS}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="${T.bg}"/>` +
    $('#defs').outerHTML + new XMLSerializer().serializeToString(clone) + '</svg>';
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas'), s = 2; c.width = w * s; c.height = h * s;
    const x = c.getContext('2d'); x.scale(s, s); x.drawImage(img, 0, 0);
    c.toBlob(bl => download(safeName() + '.png', bl), 'image/png');
  };
  img.onerror = () => toast('PNG 변환에 실패했어요');
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
}
$('.dsect').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-exp]'); if (!b) return;
  const k = b.dataset.exp;
  if (k === 'png') exportPng();
  else if (k === 'xmind') exportXmind();
  else if (k === 'json') download(safeName() + '.json', new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }));
  else if (k === 'md') download(safeName() + '.md', new Blob([toMarkdown()], { type: 'text/markdown' }));
});
$('#fileIn').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  toast('가져오는 중…');
  try {
    let nd, extra = '';
    // 모바일 파일 선택기는 확장자/MIME이 비어 있을 수 있어 내용(시그니처)으로 판별
    const head = new Uint8Array(await f.slice(0, 4).arrayBuffer());
    const isZip = head[0] === 0x50 && head[1] === 0x4b;
    if (isZip) {
      const r = await importXmind(f);
      nd = { id: uid(), title: r.title, structure: 'map', theme: 'fresh', root: r.root, rels: [], at: Date.now() };
      if (r.count > 1) extra = ` (시트 ${r.count}개 중 첫 번째)`;
    } else {
      const text = await f.text();
      if (/^\s*[{[]/.test(text)) {
        nd = JSON.parse(text); if (!nd.root) throw new Error('올바른 JSON이 아니에요'); nd.id = uid(); nd.rels = nd.rels || []; nd.structure = nd.structure || 'map'; nd.theme = THEMES[nd.theme] ? nd.theme : 'fresh';
      } else {
        const items = parseIndented(text);
        if (!items.length) throw new Error('읽을 수 있는 내용이 없어요');
        const root = items.length === 1 ? items[0] : Object.assign(newNode((f.name || '가져온 맵').replace(/\.\w+$/, '')), { c: items });
        nd = { id: uid(), title: root.t, structure: 'map', theme: 'fresh', root, rels: [], at: Date.now() };
      }
    }
    closeDrawer(); doc = nd; sel = null; undoStack = []; redoStack = []; afterDocChange(true); toast('가져왔어요' + extra);
  } catch (err) { toast('가져오기 실패: ' + err.message); }
});

/* ---------- 키보드 (데스크톱) ---------- */
document.addEventListener('keydown', (e) => {
  if (editing || e.target.matches('input,textarea')) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (e.key === 'Tab') { e.preventDefault(); addChild(true); }
  else if (e.key === 'Enter') { e.preventDefault(); addSibling(true); }
  else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); delNode(); }
  else if (e.key === 'F2' || e.key === ' ') { e.preventDefault(); startEdit(); }
  else if (e.key.startsWith('Arrow')) { e.preventDefault(); navigate(e.key.slice(5).toLowerCase()); }
  else if (e.key === 'Escape') { relFrom = null; sel = null; setHint(''); render(); }
});

/* ---------- 시작 ---------- */
window.addEventListener('resize', () => { if (mode === 'map') applyView(); });
(function init() {
  const last = LS.get('mf:last');
  if (!(last && loadDoc(last))) {
    doc = newDoc(); afterDocChange(true);
  }
  // 테스트/디버그용 훅
  window.__mf = { get doc() { return doc; }, get sel() { return sel; }, layout: () => layoutMap };
})();
})();
