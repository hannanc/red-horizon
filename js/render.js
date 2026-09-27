// Red Horizon: Canvas and camera, terrain chunks, sprites and fallback drawing, effects, the frame, the minimap.
import {missileZ} from './combat.js';
import {BUILD_DEFS, ENEMY, FACTION, HPX, IH, IW, MH, MW, PLAYER, SIDEBAR_W, T, TEAM_COLOR, TOPBAR_H, UI, UNIT_DEFS, WPX, buildings, clamp, doodads, effects, explored, flags, hasTurret, hash2, idx, inMap, isInf, isoAt, occ, onMap, ore, projectiles, sailable, selection, setup, state, tileOf, toIso, toWorld, uName, units} from './data.js';
import {announce, cursorType, modeTarget, mouse} from './ui.js';
import {canPlace, capacity, hasBuilding, hiddenFrom, patrolRoute, powerOf, radSources, treeDisguised} from './units.js';

// ---------- canvas ----------
export const cv = document.getElementById('game');
export let cx = cv.getContext('2d');   // swapped temporarily when rendering cameo icons
export const mainCx = cx;
// CW/CH: canvas size in CSS px. VW/VH: visible world area in iso px (CSS px / ZOOM).
export let CW = 0, CH = 0, VW = 0, VH = 0, DPR = 1, ZOOM = 1;
export const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];
export function resize(){
  DPR = window.devicePixelRatio || 1;     // full native resolution, 4K included
  CW = window.innerWidth - SIDEBAR_W;
  CH = window.innerHeight - TOPBAR_H;
  cv.style.width = CW + 'px'; cv.style.height = CH + 'px';
  cv.width = Math.round(CW * DPR); cv.height = Math.round(CH * DPR);
  VW = CW / ZOOM; VH = CH / ZOOM;
}
window.addEventListener('resize', resize); resize();
// big monitor at 100% scaling (e.g. 4K at DPR 1): start zoomed in so units aren't tiny
if(DPR < 1.5 && CW >= 2400) ZOOM = 2; else if(DPR < 1.5 && CW >= 1700) ZOOM = 1.5;
resize();


export function makeCameoIcon(key, isUnit){
  const pic = Sprites.cameo(key + '_' + FACTION[PLAYER], PLAYER);
  if(pic){
    const c = document.createElement('canvas');
    c.width = pic.width; c.height = pic.height;
    c.className = 'pic';
    c.getContext('2d').drawImage(pic, 0, 0);
    return c;
  }
  const c = document.createElement('canvas');
  c.width = 92; c.height = 48;
  c.style.width = '92px'; c.style.height = '48px';
  const g = c.getContext('2d');
  const prev = cx; cx = g;
  try{
    if(isUnit){
      const def = UNIT_DEFS[key];
      const mock = {x: 0, y: 0, def, team: PLAYER, face: Math.PI / 8, carry: 300, flash: 0};
      const p = toIso(0, 0);
      g.save();
      g.translate(46 - p.x, (isInf(def) ? 36 : 32) - p.y);
      drawUnitSprite(mock);
      g.restore();
    } else {
      const def = BUILD_DEFS[key];
      const mock = {tx: 0, ty: 0, w: def.w, h: def.h, def, team: PLAYER, buildUp: 1, flash: 0, id: 0,
                    x: def.w * T / 2, y: def.h * T / 2};
      const c0 = toIso(def.w * T / 2, def.h * T / 2);
      const s = def.w > 1 ? 0.44 : 0.62;
      g.save();
      g.translate(46 - c0.x * s, 30 + def.z * s * 0.5 - c0.y * s);
      g.scale(s, s);
      drawBuildingSprite(mock);
      g.restore();
    }
  } finally { cx = prev; }
  return c;
}


export function setZoom(z, ax = CW / 2, ay = CH / 2){
  // keep the world point under (ax, ay) fixed on screen
  const ix = ax / ZOOM + state.camX, iy = ay / ZOOM + state.camY;
  ZOOM = z;
  VW = CW / ZOOM; VH = CH / ZOOM;
  state.camX = clamp(ix - ax / ZOOM, 0, Math.max(0, IW - VW));
  state.camY = clamp(iy - ay / ZOOM, 0, Math.max(0, IH - VH));
}
export function stepZoom(dir, ax, ay){
  let i = ZOOMS.findIndex(z => z >= ZOOM - 1e-6);
  if(i < 0) i = ZOOMS.length - 1;
  i = clamp(i + dir, 0, ZOOMS.length - 1);
  setZoom(ZOOMS[i], ax, ay);
}

// minimap interaction
export const mmC = document.getElementById('minimap');
export const mmX = mmC.getContext('2d');
export const MMW = 220, MMH = 120;
export const MM_RES = DPR * UI;   // minimap backing-store scale
mmC.width = Math.round(MMW * MM_RES); mmC.height = Math.round(MMH * MM_RES);
export const mmSX = MMW / IW, mmSY = MMH / IH;

// ---------- terrain pre-render (iso) ----------
export function tilePath(g, x, y, grow){
  const e = grow || 0;
  const t = toIso(x * T - e, y * T - e), r = toIso((x + 1) * T + e, y * T - e);
  const b = toIso((x + 1) * T + e, (y + 1) * T + e), l = toIso(x * T - e, (y + 1) * T + e);
  g.beginPath(); g.moveTo(t.x, t.y); g.lineTo(r.x, r.y); g.lineTo(b.x, b.y); g.lineTo(l.x, l.y); g.closePath();
}

// ---------- terrain ----------
// The ground is painted at TERRAIN_SCALE px per iso px in CHUNK x CHUNK iso-px
// chunks by a pool of workers. A quick low-res copy (also the minimap source)
// fills any chunk that isn't ready yet. Scorch marks are painted into both.
export const TERRAIN_SCALE = 2, CHUNK = 256, LOW_SCALE = 0.25;
export const chunkCols = Math.ceil(IW / CHUNK), chunkRows = Math.ceil(IH / CHUNK);
export const chunks = new Array(chunkCols * chunkRows).fill(null);   // canvas | 'void' | 'pending' | null
export const scorches = [];

export const lowC = document.createElement('canvas');
lowC.width = IW * LOW_SCALE; lowC.height = IH * LOW_SCALE;
export function paintLow(){
  const g = lowC.getContext('2d');
  const img = g.createImageData(lowC.width, lowC.height);
  TerrainGen.paint(img.data, lowC.width, lowC.height, 0, 0, LOW_SCALE);
  g.putImageData(img, 0, 0);
}

// does the chunk overlap the map diamond at all?
export function chunkInMap(ci, cj){
  const x0 = ci * CHUNK, y0 = cj * CHUNK;
  for(let sy = 0; sy <= 8; sy++)
    for(let sx = 0; sx <= 8; sx++){
      const w = toWorld(x0 + sx * CHUNK / 8, y0 + sy * CHUNK / 8);
      if(w.x > -T && w.y > -T && w.x < WPX + T && w.y < HPX + T) return true;
    }
  return false;
}

export const terrainJobs = [];
export let terrainWorkers = [], terrainGen = 0;   // bumped per world so late chunks of an old map are dropped
export function startTerrainWorkers(focusX, focusY){
  for(const w of terrainWorkers) w.terminate();
  terrainWorkers = []; terrainJobs.length = 0; chunks.fill(null);
  const gen = ++terrainGen;
  for(let cj = 0; cj < chunkRows; cj++)
    for(let ci = 0; ci < chunkCols; ci++){
      const id = cj * chunkCols + ci;
      if(!chunkInMap(ci, cj)){ chunks[id] = 'void'; continue; }
      terrainJobs.push(id);
    }
  // nearest to the starting view first
  const d = id => Math.hypot((id % chunkCols + 0.5) * CHUNK - focusX, (Math.floor(id / chunkCols) + 0.5) * CHUNK - focusY);
  terrainJobs.sort((a, b) => d(a) - d(b));
  const n = Math.max(2, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
  try{
    for(let i = 0; i < n; i++){
      const w = new Worker('js/terrain-worker.js');
      w.onmessage = ev => { if(gen !== terrainGen) return; finishChunk(ev.data.id, ev.data.data); feedWorker(w); };
      terrainWorkers.push(w);
      feedWorker(w);
    }
  }catch(e){ console.warn('terrain workers unavailable, using low-res ground', e); }
}
export function feedWorker(w){
  const id = terrainJobs.shift();
  if(id == null){ w.terminate(); return; }
  chunks[id] = 'pending';
  const px = CHUNK * TERRAIN_SCALE;
  w.postMessage({id, ix0: (id % chunkCols) * CHUNK, iy0: Math.floor(id / chunkCols) * CHUNK, w: px, h: px, scale: TERRAIN_SCALE, map: TerrainGen.map});
}
export function finishChunk(id, data){
  const px = CHUNK * TERRAIN_SCALE;
  const c = document.createElement('canvas');
  c.width = c.height = px;
  c.getContext('2d').putImageData(new ImageData(data, px, px), 0, 0);
  chunks[id] = c;
  for(const s of scorches) paintScorch(c, (id % chunkCols) * CHUNK, Math.floor(id / chunkCols) * CHUNK, TERRAIN_SCALE, s);
}

export function paintScorch(canvas, ox, oy, scale, s){
  const p = toIso(s.x, s.y);
  if(p.x + s.r < ox || p.x - s.r > ox + canvas.width / scale || p.y + s.r < oy || p.y - s.r > oy + canvas.height / scale) return;
  const g = canvas.getContext('2d');
  g.save();
  g.setTransform(scale, 0, 0, scale * 0.5, (p.x - ox) * scale, (p.y - oy) * scale);
  const grd = g.createRadialGradient(0, 0, 0, 0, 0, s.r);
  grd.addColorStop(0, 'rgba(15,12,10,0.75)');
  grd.addColorStop(0.6, 'rgba(25,20,15,0.35)');
  grd.addColorStop(1, 'rgba(30,25,20,0)');
  g.fillStyle = grd;
  g.beginPath(); g.arc(0, 0, s.r, 0, Math.PI * 2); g.fill();
  g.restore();
}

// draw the ground for the visible iso rect (context already in iso px)
export function drawTerrain(){
  const c0 = Math.max(0, Math.floor(state.camX / CHUNK)), c1 = Math.min(chunkCols - 1, Math.floor((state.camX + VW) / CHUNK));
  const r0 = Math.max(0, Math.floor(state.camY / CHUNK)), r1 = Math.min(chunkRows - 1, Math.floor((state.camY + VH) / CHUNK));
  for(let cj = r0; cj <= r1; cj++)
    for(let ci = c0; ci <= c1; ci++){
      const c = chunks[cj * chunkCols + ci];
      const x = ci * CHUNK, y = cj * CHUNK;
      if(c === 'void') continue;
      if(c && c !== 'pending') cx.drawImage(c, x, y, CHUNK + 0.5, CHUNK + 0.5);   // slight overlap hides seams
      else {
        const sm = cx.imageSmoothingEnabled;
        cx.imageSmoothingEnabled = true;       // low-res stand-in: blur beats blocks
        cx.drawImage(lowC, x * LOW_SCALE, y * LOW_SCALE, CHUNK * LOW_SCALE, CHUNK * LOW_SCALE, x, y, CHUNK + 0.5, CHUNK + 0.5);
        cx.imageSmoothingEnabled = sm;
      }
    }
}

// ---------- drawing: sprites ----------
export function shade(hex, f){ // quick brightness adjust of #rrggbb
  const n = parseInt(hex.slice(1), 16);
  const r = clamp(((n >> 16) & 255) * f | 0, 0, 255), g = clamp(((n >> 8) & 255) * f | 0, 0, 255), b = clamp((n & 255) * f | 0, 0, 255);
  return `rgb(${r},${g},${b})`;
}

// extruded iso box: footprint (tiles), height z px. Returns roof corner points.
export function isoBox(tx, ty, w, h, z, wall, roofC){
  const t = toIso(tx * T, ty * T), r = toIso((tx + w) * T, ty * T);
  const b = toIso((tx + w) * T, (ty + h) * T), l = toIso(tx * T, (ty + h) * T);
  // left (SW-facing) face — darker
  cx.fillStyle = shade(wall, 0.62);
  cx.beginPath(); cx.moveTo(l.x, l.y); cx.lineTo(b.x, b.y); cx.lineTo(b.x, b.y - z); cx.lineTo(l.x, l.y - z); cx.closePath(); cx.fill();
  // right (SE-facing) face — lighter
  cx.fillStyle = shade(wall, 0.88);
  cx.beginPath(); cx.moveTo(b.x, b.y); cx.lineTo(r.x, r.y); cx.lineTo(r.x, r.y - z); cx.lineTo(b.x, b.y - z); cx.closePath(); cx.fill();
  // roof
  cx.fillStyle = roofC;
  cx.beginPath(); cx.moveTo(t.x, t.y - z); cx.lineTo(r.x, r.y - z); cx.lineTo(b.x, b.y - z); cx.lineTo(l.x, l.y - z); cx.closePath(); cx.fill();
  cx.strokeStyle = 'rgba(0,0,0,0.25)'; cx.lineWidth = 1;
  cx.stroke();
  return {t, r, b, l};
}

export function groundShadow(tx, ty, w, h){
  cx.fillStyle = 'rgba(0,0,0,0.28)';
  const t = toIso(tx * T, ty * T), r = toIso((tx + w) * T + 8, ty * T);
  const b = toIso((tx + w) * T + 8, (ty + h) * T + 8), l = toIso(tx * T, (ty + h) * T + 8);
  cx.beginPath(); cx.moveTo(t.x, t.y); cx.lineTo(r.x, r.y); cx.lineTo(b.x, b.y); cx.lineTo(l.x, l.y); cx.closePath(); cx.fill();
}

export function roofDiamond(c, z, fx, fy, scale, fill){ // small diamond on the roof, offsets in world px
  const p = toIso(c.wx + fx, c.wy + fy);
  cx.fillStyle = fill;
  cx.beginPath();
  cx.moveTo(p.x, p.y - z - scale * 0.5);
  cx.lineTo(p.x + scale, p.y - z);
  cx.lineTo(p.x, p.y - z + scale * 0.5);
  cx.lineTo(p.x - scale, p.y - z);
  cx.closePath(); cx.fill();
}

export function cylinder(px, py, rad, hgt, color, topColor){
  cx.fillStyle = shade(color, 0.75);
  cx.beginPath();
  cx.ellipse(px, py, rad, rad * 0.5, 0, 0, Math.PI);
  cx.lineTo(px - rad, py - hgt);
  cx.ellipse(px, py - hgt, rad, rad * 0.5, 0, Math.PI, 0, true);
  cx.closePath(); cx.fill();
  // light strip
  cx.fillStyle = shade(color, 1.05);
  cx.fillRect(px + rad * 0.2, py - hgt, rad * 0.45, hgt);
  cx.fillStyle = topColor || shade(color, 1.15);
  cx.beginPath(); cx.ellipse(px, py - hgt, rad, rad * 0.5, 0, 0, Math.PI * 2); cx.fill();
  cx.strokeStyle = 'rgba(0,0,0,0.3)'; cx.lineWidth = 1;
  cx.beginPath(); cx.ellipse(px, py - hgt, rad, rad * 0.5, 0, 0, Math.PI * 2); cx.stroke();
}

export const bName = b => b.def.key === 'civ' ? 'civ' : b.def.key + '_' + b.fac;

// animation frame of a building sheet: town variants, factory door, spinning radar
export function buildingFrame(b, e){
  if(e.frames <= 1) return 0;
  if(b.def.key === 'civ') return b.variant % e.frames;
  if(b.def.key === 'factory'){
    const t = b.doorT;
    if(t == null || t > 1.6) return 0;
    const last = e.frames - 1;
    if(t < 0.3) return Math.floor(t / 0.3 * last);
    if(t < 1.3) return last;
    return Math.max(0, last - Math.floor((t - 1.3) / 0.3 * last));
  }
  if(b.def.anim){
    const p = powerOf(b.team);
    return p.used <= p.prod ? Math.floor(state.time * 7 + b.id) % e.frames : 0;
  }
  return 0;
}

// hit flash: a canvas brightness filter where the browser has one (not Safari), else the sprite drawn again additively
const HAS_FILTER = typeof mainCx.filter === 'string';
function flashed(on, bright, paint){
  if(on && HAS_FILTER) cx.filter = `brightness(${bright})`;
  paint();
  if(on && !HAS_FILTER){ cx.globalCompositeOperation = 'lighter'; cx.globalAlpha *= 0.55; paint(); }
}
export function drawBuildingSprite(b){
  const name = bName(b);
  if(Sprites.has(name)){
    const p = toIso(b.x, b.y);
    const e = Sprites.get(name);
    cx.save();
    // build-up: the structure rises out of the ground
    const clipTop = b.buildUp < 1 ? e.fh * (1 - b.buildUp) : 0;
    flashed(b.flash > 0, 1.8, () => Sprites.draw(cx, name, b.team, buildingFrame(b, e), p.x, p.y, clipTop));
    cx.restore();
    drawBuildingFx(b, p, e);
    return;
  }
  const k = b.def.key;
  const tc = TEAM_COLOR[b.team];
  const up = clamp(b.buildUp, 0.12, 1);
  const z = b.def.z * up;
  const ctr = toIso(b.x, b.y);
  const wxc = b.x, wyc = b.y;
  const cInfo = {wx: wxc, wy: wyc};

  cx.save();
  if(b.flash > 0) cx.filter = 'brightness(1.9)';
  if(b.buildUp < 1) cx.globalAlpha = 0.45 + b.buildUp * 0.55;

  groundShadow(b.tx, b.ty, b.w, b.h);

  const allied = b.team === PLAYER;
  const wall = allied ? '#8f99a8' : '#93857a';
  const roof = allied ? shade('#aab4c4', 1) : shade('#a89a8c', 1);

  if(k === 'conyard'){
    const c = isoBox(b.tx, b.ty, b.w, b.h, z, wall, roof);
    // roof deck + team trim
    cx.strokeStyle = tc; cx.lineWidth = 2.5;
    cx.beginPath(); cx.moveTo(c.t.x, c.t.y - z); cx.lineTo(c.r.x, c.r.y - z); cx.lineTo(c.b.x, c.b.y - z); cx.lineTo(c.l.x, c.l.y - z); cx.closePath(); cx.stroke();
    // crane tower + jib
    const cb = toIso(wxc - 14, wyc - 10);
    cx.strokeStyle = '#e9b83a'; cx.lineWidth = 4;
    cx.beginPath(); cx.moveTo(cb.x, cb.y - z); cx.lineTo(cb.x, cb.y - z - 26); cx.stroke();
    cx.lineWidth = 3;
    cx.beginPath(); cx.moveTo(cb.x, cb.y - z - 26); cx.lineTo(cb.x + 30, cb.y - z - 18); cx.stroke();
    cx.strokeStyle = '#666'; cx.lineWidth = 1;
    cx.beginPath(); cx.moveTo(cb.x + 30, cb.y - z - 18); cx.lineTo(cb.x + 30, cb.y - z - 4); cx.stroke();
    cx.fillStyle = '#333'; cx.fillRect(cb.x + 27, cb.y - z - 6, 6, 5);
    // roof hatch + vents
    roofDiamond(cInfo, z, 16, 16, 9, '#5f6774');
    roofDiamond(cInfo, z, 16, 16, 5, '#3d434e');
    cylinder(ctr.x + 22, ctr.y - z * 0.2, 4, 8 + z * 0.2, '#7d8694');
  } else if(k === 'power'){
    const c = isoBox(b.tx, b.ty, b.w, b.h, z, wall, allied ? '#7f92ad' : '#8d7f74');
    // twin cooling stacks
    cylinder(ctr.x - 10, ctr.y - z + 10, 7, 18, allied ? '#93a5bf' : '#9a8a7c');
    cylinder(ctr.x + 12, ctr.y - z + 12, 7, 18, allied ? '#93a5bf' : '#9a8a7c');
    // glowing core between them
    const glow = 0.55 + Math.sin(state.time * 4 + b.id) * 0.3;
    cx.fillStyle = allied ? `rgba(120,220,255,${glow})` : `rgba(255,140,120,${glow})`;
    cx.beginPath(); cx.ellipse(ctr.x + 1, ctr.y - z + 4, 6, 3.5, 0, 0, 7); cx.fill();
    cx.strokeStyle = tc; cx.lineWidth = 2;
    cx.beginPath(); cx.moveTo(c.l.x, c.l.y - z); cx.lineTo(c.b.x, c.b.y - z); cx.lineTo(c.r.x, c.r.y - z); cx.stroke();
  } else if(k === 'refinery'){
    const c = isoBox(b.tx, b.ty, b.w, b.h, z, wall, roof);
    // ore silo (gold-topped cylinder)
    cylinder(ctr.x - 20, ctr.y - z + 16, 12, 22, allied ? '#8f99a8' : '#93857a', '#d9a520');
    cx.fillStyle = '#ffdf6b';
    cx.beginPath(); cx.ellipse(ctr.x - 20, ctr.y - z - 6, 7, 3.5, 0, 0, 7); cx.fill();
    // smokestack
    cylinder(ctr.x + 18, ctr.y - z + 8, 4, 16, '#6b7280');
    // docking bay: flat pad in front (south corner) with hazard chevrons
    const pad = toIso(wxc + 6, wyc + b.h * T * 0.5 + 12);
    cx.fillStyle = '#3c4148';
    cx.beginPath(); cx.moveTo(pad.x, pad.y - 10); cx.lineTo(pad.x + 26, pad.y + 3); cx.lineTo(pad.x, pad.y + 16); cx.lineTo(pad.x - 26, pad.y + 3); cx.closePath(); cx.fill();
    cx.fillStyle = '#f5c542';
    for(let i = -1; i <= 1; i++){
      cx.beginPath(); cx.moveTo(pad.x + i * 12, pad.y - 2); cx.lineTo(pad.x + 6 + i * 12, pad.y + 3); cx.lineTo(pad.x + i * 12, pad.y + 8); cx.lineTo(pad.x - 6 + i * 12, pad.y + 3); cx.closePath(); cx.fill();
    }
    cx.strokeStyle = tc; cx.lineWidth = 2;
    cx.beginPath(); cx.moveTo(c.t.x, c.t.y - z); cx.lineTo(c.r.x, c.r.y - z); cx.stroke();
  } else if(k === 'barracks'){
    const c = isoBox(b.tx, b.ty, b.w, b.h, z, allied ? '#98a3b0' : '#9a8a76', allied ? '#5f7d5a' : '#7d6a52');
    // roof ridge
    cx.strokeStyle = 'rgba(255,255,255,0.25)'; cx.lineWidth = 1.5;
    cx.beginPath(); cx.moveTo(c.l.x + 6, c.l.y - z); cx.lineTo(c.r.x - 6, c.r.y - z); cx.stroke();
    // door on SE face
    const dm = toIso(wxc + b.w * T * 0.5, wyc + 6);
    cx.fillStyle = '#2c313a';
    cx.fillRect(dm.x - 12, dm.y - 14, 10, 14);
    // flag pole + team flag
    const fp = toIso(b.tx * T + 6, b.ty * T + 6);
    cx.strokeStyle = '#cfd4dc'; cx.lineWidth = 1.5;
    cx.beginPath(); cx.moveTo(fp.x, fp.y - z); cx.lineTo(fp.x, fp.y - z - 20); cx.stroke();
    cx.fillStyle = tc;
    cx.beginPath(); cx.moveTo(fp.x, fp.y - z - 20); cx.lineTo(fp.x + 13, fp.y - z - 16.5); cx.lineTo(fp.x, fp.y - z - 13); cx.closePath(); cx.fill();
  } else if(k === 'factory'){
    const c = isoBox(b.tx, b.ty, b.w, b.h, z, wall, roof);
    // huge SE-face door with hazard stripes
    const b0 = toIso((b.tx + b.w) * T, (b.ty + b.h) * T);
    const r0 = toIso((b.tx + b.w) * T, b.ty * T);
    const doorTopY = -z + 6;
    cx.fillStyle = '#333941';
    cx.beginPath();
    cx.moveTo(b0.x + (r0.x - b0.x) * 0.18, b0.y + (r0.y - b0.y) * 0.18);
    cx.lineTo(b0.x + (r0.x - b0.x) * 0.82, b0.y + (r0.y - b0.y) * 0.82);
    cx.lineTo(b0.x + (r0.x - b0.x) * 0.82, b0.y + (r0.y - b0.y) * 0.82 + doorTopY);
    cx.lineTo(b0.x + (r0.x - b0.x) * 0.18, b0.y + (r0.y - b0.y) * 0.18 + doorTopY);
    cx.closePath(); cx.fill();
    cx.strokeStyle = '#f5c542'; cx.lineWidth = 2;
    for(let i = 0.3; i <= 0.7; i += 0.2){
      cx.beginPath();
      cx.moveTo(b0.x + (r0.x - b0.x) * i, b0.y + (r0.y - b0.y) * i);
      cx.lineTo(b0.x + (r0.x - b0.x) * i, b0.y + (r0.y - b0.y) * i + doorTopY + 2);
      cx.stroke();
    }
    // sawtooth roof lights
    for(let i = 0; i < 3; i++)
      roofDiamond(cInfo, z, -18 + i * 18, -14 + i * 2, 6, i % 2 ? '#c9d2e0' : '#79828f');
    // chimneys
    cylinder(ctr.x - 26, ctr.y - z + 6, 4.5, 20, '#5b626e');
    cylinder(ctr.x - 14, ctr.y - z + 2, 4.5, 24, '#5b626e');
    cx.strokeStyle = tc; cx.lineWidth = 2.5;
    cx.beginPath(); cx.moveTo(c.t.x, c.t.y - z); cx.lineTo(c.l.x, c.l.y - z); cx.stroke();
  } else if(k === 'shipyard'){
    // piers round a channel that opens to the east
    isoBox(b.tx, b.ty, b.w, 1, 5 * up, '#8f8c84', '#a19e96');
    isoBox(b.tx, b.ty + b.h - 1, b.w, 1, 5 * up, '#8f8c84', '#a19e96');
    isoBox(b.tx, b.ty + 1, 1, 1, 5 * up, '#8f8c84', '#a19e96');
    const g1 = toIso((b.tx + 1.2) * T, b.ty * T + 16), g2 = toIso((b.tx + 1.2) * T, (b.ty + b.h) * T - 16);
    cx.strokeStyle = '#e9b83a'; cx.lineWidth = 3;
    cx.beginPath(); cx.moveTo(g1.x, g1.y - 5); cx.lineTo(g1.x, g1.y - 34 * up); cx.lineTo(g2.x, g2.y - 34 * up); cx.lineTo(g2.x, g2.y - 5); cx.stroke();
    cx.fillStyle = tc; const f = toIso(b.tx * T + 16, b.ty * T + 16); cx.fillRect(f.x - 4, f.y - 16 * up, 8, 6);
  } else if(k === 'depot'){
    isoBox(b.tx, b.ty, b.w, b.h, 3 * up, '#6d737c', '#5d636b');
    const pc = toIso(wxc, wyc);
    cx.fillStyle = '#454b53'; cx.beginPath(); cx.ellipse(pc.x, pc.y - 3, 34, 17, 0, 0, 7); cx.fill();
    cx.strokeStyle = '#f5c542'; cx.lineWidth = 2; cx.beginPath(); cx.ellipse(pc.x, pc.y - 3, 28, 14, 0, 0, 7); cx.stroke();
    cx.strokeStyle = tc; cx.beginPath(); cx.ellipse(pc.x, pc.y - 3, 16, 8, 0, 0, 7); cx.stroke();
    // gantry along the back edge
    const g1 = toIso(b.tx * T + 4, b.ty * T + 4), g2 = toIso((b.tx + b.w) * T - 4, b.ty * T + 4);
    cx.strokeStyle = '#e9b83a'; cx.lineWidth = 3;
    cx.beginPath(); cx.moveTo(g1.x, g1.y); cx.lineTo(g1.x, g1.y - 34 * up); cx.lineTo(g2.x, g2.y - 34 * up); cx.lineTo(g2.x, g2.y); cx.stroke();
  } else if(k === 'airfield'){
    isoBox(b.tx, b.ty, b.w, b.h, 5 * up, '#6d737c', '#565c64');
    for(const [ox, oy] of b.def.pads){
      const pp = toIso(wxc + ox * T, wyc + oy * T);
      cx.fillStyle = '#2e3238'; cx.beginPath(); cx.ellipse(pp.x, pp.y - 5 * up, 19, 9.5, 0, 0, 7); cx.fill();
      cx.strokeStyle = '#f5c542'; cx.lineWidth = 1.5; cx.beginPath(); cx.ellipse(pp.x, pp.y - 5 * up, 15, 7.5, 0, 0, 7); cx.stroke();
      cx.strokeStyle = tc; cx.beginPath(); cx.ellipse(pp.x, pp.y - 5 * up, 8, 4, 0, 0, 7); cx.stroke();
    }
    isoBox(b.tx, b.ty + b.h - 1, 1, 1, 26 * up, wall, '#9fb4c8');   // control tower
  } else if(k === 'pillbox'){
    // sandbag bunker: low dome
    cx.fillStyle = '#7a7a5c';
    cx.beginPath(); cx.ellipse(ctr.x, ctr.y - 4, 16, 9, 0, 0, 7); cx.fill();
    cx.fillStyle = '#8f8f6d';
    cx.beginPath(); cx.ellipse(ctr.x, ctr.y - 8, 12, 6.5, 0, 0, 7); cx.fill();
    // sandbag texture
    cx.strokeStyle = 'rgba(0,0,0,0.25)'; cx.lineWidth = 1;
    for(let i = -2; i <= 2; i++){
      cx.beginPath(); cx.ellipse(ctr.x + i * 6, ctr.y - 2, 3, 1.6, 0, 0, 7); cx.stroke();
    }
    // gun slit + barrel
    cx.fillStyle = '#20242c';
    cx.fillRect(ctr.x - 6, ctr.y - 10, 12, 3.5);
    const ta = b.target ? Math.atan2(b.target.y - b.y, b.target.x - b.x) : Math.PI / 4;
    const gx = Math.cos(ta) - Math.sin(ta), gy = (Math.cos(ta) + Math.sin(ta)) * 0.5;
    const gl = Math.hypot(gx, gy);
    cx.strokeStyle = '#20242c'; cx.lineWidth = 2.5;
    cx.beginPath(); cx.moveTo(ctr.x, ctr.y - 8); cx.lineTo(ctr.x + gx / gl * 13, ctr.y - 8 + gy / gl * 13); cx.stroke();
    cx.fillStyle = tc; cx.fillRect(ctr.x - 5, ctr.y + 2, 10, 3);
  } else if(k === 'beamtower' || k === 'arctower'){
    // tall narrow tower
    const twr = k === 'beamtower' ? '#c3cbd8' : '#4c525e';
    cx.fillStyle = shade(twr, 0.7);
    cx.beginPath(); cx.moveTo(ctr.x - 7, ctr.y); cx.lineTo(ctr.x - 4, ctr.y - z); cx.lineTo(ctr.x, ctr.y - z + 2); cx.lineTo(ctr.x, ctr.y + 4); cx.closePath(); cx.fill();
    cx.fillStyle = twr;
    cx.beginPath(); cx.moveTo(ctr.x + 7, ctr.y); cx.lineTo(ctr.x + 4, ctr.y - z); cx.lineTo(ctr.x, ctr.y - z + 2); cx.lineTo(ctr.x, ctr.y + 4); cx.closePath(); cx.fill();
    // base pad
    cx.fillStyle = '#565c66';
    cx.beginPath(); cx.ellipse(ctr.x, ctr.y + 3, 13, 7, 0, 0, 7); cx.fill();
    cx.fillStyle = tc;
    cx.beginPath(); cx.ellipse(ctr.x, ctr.y + 2, 9, 4.5, 0, 0, 7); cx.fill();
    const pulse = 0.5 + Math.sin(state.time * 6 + b.id) * 0.4;
    if(k === 'beamtower'){
      // crystal head
      cx.fillStyle = `rgba(150,225,255,${0.55 + pulse * 0.4})`;
      cx.beginPath();
      cx.moveTo(ctr.x, ctr.y - z - 12);
      cx.lineTo(ctr.x + 7, ctr.y - z - 2);
      cx.lineTo(ctr.x, ctr.y - z + 4);
      cx.lineTo(ctr.x - 7, ctr.y - z - 2);
      cx.closePath(); cx.fill();
      cx.strokeStyle = 'rgba(255,255,255,0.7)'; cx.lineWidth = 1;
      cx.beginPath(); cx.moveTo(ctr.x, ctr.y - z - 12); cx.lineTo(ctr.x, ctr.y - z + 4); cx.stroke();
    } else {
      // arc tower rings + orb
      cx.strokeStyle = '#6e7686'; cx.lineWidth = 2;
      for(let i = 0; i < 3; i++){
        cx.beginPath(); cx.ellipse(ctr.x, ctr.y - z + 2 - i * 5, 8 - i, 3.5 - i * 0.7, 0, 0, 7); cx.stroke();
      }
      cx.fillStyle = `rgba(140,200,255,${0.5 + pulse * 0.5})`;
      cx.beginPath(); cx.arc(ctr.x, ctr.y - z - 8, 5, 0, 7); cx.fill();
      if(pulse > 0.7){
        cx.strokeStyle = `rgba(160,220,255,${pulse})`; cx.lineWidth = 1;
        cx.beginPath();
        cx.moveTo(ctr.x - 4, ctr.y - z - 10);
        cx.lineTo(ctr.x + 2, ctr.y - z - 5);
        cx.lineTo(ctr.x - 2, ctr.y - z - 2);
        cx.stroke();
      }
    }
  }

  cx.restore();
}

// fires on badly damaged structures (smoke is emitted in updateBuilding)
export function drawBuildingFx(b, p, e){
  const frac = b.hp / b.maxHp;
  if(frac >= 0.5 || b.buildUp < 1) return;
  const bb = Sprites.bbox(bName(b), 0);
  if(!bb) return;
  const n = frac < 0.25 ? 3 : 1;
  cx.save();
  cx.globalCompositeOperation = 'lighter';
  for(let i = 0; i < n; i++){
    const fx = p.x + bb.x0 + (bb.x1 - bb.x0) * (0.3 + hash2(b.id, i) * 0.4);
    const fy = p.y + bb.y0 + (bb.y1 - bb.y0) * (0.25 + hash2(i, b.id) * 0.3);
    const fl = 0.75 + Math.sin(state.time * 17 + i * 3) * 0.25;
    const r = 9 * fl;
    const grd = cx.createRadialGradient(fx, fy, 0, fx, fy - 3, r);
    grd.addColorStop(0, 'rgba(255,230,140,0.95)');
    grd.addColorStop(0.45, 'rgba(255,120,30,0.7)');
    grd.addColorStop(1, 'rgba(160,30,0,0)');
    cx.fillStyle = grd;
    cx.beginPath(); cx.ellipse(fx, fy - 3, r * 0.7, r, 0, 0, Math.PI * 2); cx.fill();
  }
  cx.restore();
}

// iso direction of a world-facing angle
export function isoDir(f){
  const x = Math.cos(f) - Math.sin(f), y = (Math.cos(f) + Math.sin(f)) * 0.5;
  const l = Math.hypot(x, y);
  return {x: x / l, y: y / l};
}

// frame of an infantry sheet for the unit's current action
export function infantryFrame(u, e){
  let f = Sprites.facing(e, u.face) * e.seq;
  if(u.fireT < 0.18) f += e.anims.fire[0] + (u.fireT < 0.09 ? 0 : 1);
  else if(u.moving) f += e.anims.walk[0] + Math.floor(u.walkPhase) % e.anims.walk[1];
  return f;
}

// fallback uniform colours of the special infantry
export const UNIFORM = {sapper: '#7a5a3a', striker: '#3d4238', psion: '#5a3a6a', isotope: '#b8b43a', infiltrator: '#2c3440', blink: '#6e9ec8',
                 jetpack: '#4e6a8c', engineer: '#c9a23a', sniper: '#4f5f3a', arctrooper: '#6d5b4c'};

// a ring of sandbags round a dug-in rifleman
export function drawSandbags(p){
  for(let i = 0; i < 9; i++){
    const a = i / 9 * Math.PI * 2 + 0.3;
    const x = p.x + Math.cos(a) * 11, y = p.y + Math.sin(a) * 5.5;
    cx.fillStyle = '#8c7f5c'; cx.beginPath(); cx.ellipse(x, y - 1, 4.2, 2.6, 0, 0, 7); cx.fill();
    cx.strokeStyle = 'rgba(0,0,0,0.3)'; cx.lineWidth = 0.8; cx.stroke();
  }
}

// shadow of an aircraft on the ground below it
export function drawAirShadow(u){
  const p = isoAt(u.x, u.y);
  const r = u.def.r * (1.1 - Math.min(0.4, (u.z || 0) / 200));
  cx.fillStyle = 'rgba(0,0,0,0.28)';
  cx.beginPath(); cx.ellipse(p.x, p.y, r, r * 0.5, 0, 0, 7); cx.fill();
}

export function drawUnitSprite(u){
  const p = isoAt(u.x, u.y, u.z || 0);                                    // aircraft sheets are anchored on the aircraft itself
  const name = uName(u);
  const inf = Sprites.get(name);
  const body = Sprites.get(name + '_body');
  const ghost = u.def.stealth && !u.revealed;         // our own stealth units show faintly
  if(u.def.naval && u.moving) drawWake(u, p);
  const tint = u.def.disguise && u.team === PLAYER ? ENEMY : u.team;   // an infiltrator wears the enemy's colours
  if(u.deployed && u.def.deployWeapon) drawSandbags(p);
  if(treeDisguised(u)){
    const tree = Sprites.get('tree');
    if(tree) Sprites.draw(cx, 'tree', 0, u.id % tree.frames, p.x, p.y);
    else { cx.fillStyle = '#35592a'; cx.beginPath(); cx.ellipse(p.x, p.y - 16, 13, 15, 0, 0, 7); cx.fill(); }
    if(u.team === PLAYER){   // our own "tree" keeps a small team marker
      cx.fillStyle = TEAM_COLOR[PLAYER];
      cx.beginPath(); cx.moveTo(p.x, p.y - 4); cx.lineTo(p.x + 4, p.y - 1); cx.lineTo(p.x, p.y + 2); cx.lineTo(p.x - 4, p.y - 1); cx.closePath(); cx.fill();
    }
    return;
  }
  if(inf || body){
    cx.save();
    if(ghost) cx.globalAlpha = 0.45;
    flashed(u.flash > 0, 1.9, () => {
      if(inf) Sprites.draw(cx, name, tint, infantryFrame(u, inf), p.x, p.y);
      else {
        Sprites.draw(cx, name + '_body', tint, Sprites.facing(body, u.face), p.x, p.y);
        const tur = Sprites.get(name + '_turret');
        if(tur) Sprites.draw(cx, name + '_turret', tint, Sprites.facing(tur, u.tface), p.x, p.y);
        const msl = Sprites.get(name + '_missile');       // reloaded when the cooldown is nearly over
        if(msl && u.cool < 1.5) Sprites.draw(cx, name + '_missile', tint, Sprites.facing(msl, u.face), p.x, p.y);
        const bombs = Sprites.get(name + '_bombs');       // a jet's bombs hang under it until dropped
        if(bombs && u.ammo > 0) Sprites.draw(cx, name + '_bombs', tint, Sprites.facing(bombs, u.face), p.x, p.y);
        const rotor = Sprites.get(name + '_rotor');
        if(rotor) Sprites.draw(cx, name + '_rotor', tint, u.moving ? Math.floor(state.time * 24) % rotor.frames : 0, p.x, p.y);
      }
    });
    cx.restore();
    return;
  }
  const k = u.def.key;
  const tc = TEAM_COLOR[tint];
  const allied = u.team === PLAYER;

  cx.save();
  if(u.flash > 0) cx.filter = 'brightness(1.9)';
  if(ghost) cx.globalAlpha = 0.45;

  // shadow (aircraft get theirs from drawAirShadow; ships sit in the water)
  if(!u.def.air && !u.def.naval){
    cx.fillStyle = 'rgba(0,0,0,0.3)';
    cx.beginPath(); cx.ellipse(p.x, p.y + 1, u.def.r + 2, (u.def.r + 2) * 0.5, 0, 0, 7); cx.fill();
  }

  if(u.def.naval) drawShipFallback(u, p, tc);
  else if(u.def.air && !isInf(u.def)) drawAircraftFallback(u, p, tc);
  else if(isInf(u.def)){
    const d = isoDir(u.face);
    const uni = UNIFORM[k] || (k === 'rifle' ? (allied ? '#5d7244' : '#8a7a5a') : (allied ? '#4e6a8c' : '#6d5b4c'));
    // legs
    cx.strokeStyle = '#2e3324'; cx.lineWidth = 2;
    cx.beginPath(); cx.moveTo(p.x - 2, p.y); cx.lineTo(p.x - 2, p.y - 5); cx.moveTo(p.x + 2, p.y); cx.lineTo(p.x + 2, p.y - 5); cx.stroke();
    // torso
    cx.fillStyle = uni;
    cx.fillRect(p.x - 3.5, p.y - 12, 7, 8);
    // team armband
    cx.fillStyle = tc; cx.fillRect(p.x - 3.5, p.y - 11, 7, 2);
    // head + helmet
    cx.fillStyle = '#caa27b';
    cx.beginPath(); cx.arc(p.x, p.y - 14.5, 2.6, 0, 7); cx.fill();
    cx.fillStyle = allied ? '#44522f' : '#6d3b32';
    cx.beginPath(); cx.arc(p.x, p.y - 15.4, 2.8, Math.PI, 0); cx.fill();
    // weapon
    if(k !== 'rocket'){
      cx.strokeStyle = '#23272e'; cx.lineWidth = 2;
      cx.beginPath(); cx.moveTo(p.x, p.y - 9); cx.lineTo(p.x + d.x * 9, p.y - 9 + d.y * 9); cx.stroke();
    } else {
      // shoulder rocket tube
      cx.strokeStyle = '#3f4c38'; cx.lineWidth = 3.5;
      cx.beginPath(); cx.moveTo(p.x - d.x * 4, p.y - 13 - d.y * 4); cx.lineTo(p.x + d.x * 9, p.y - 13 + d.y * 9); cx.stroke();
      cx.fillStyle = '#e05038';
      cx.beginPath(); cx.arc(p.x + d.x * 9, p.y - 13 + d.y * 9, 1.8, 0, 7); cx.fill();
    }
  } else {
    // vehicles: draw hull in a foreshortened rotated frame
    const hullC = k === 'harv'
      ? (allied ? '#7c8aa0' : '#8d6f52')
      : (allied ? '#7688a0' : '#87604f');
    const dark = shade(hullC, 0.6), light = shade(hullC, 1.15);
    const L = k === 'htank' ? 21 : k === 'harv' ? 19 : 16;   // half length
    const Wd = k === 'htank' ? 13 : k === 'harv' ? 13 : 10;  // half width

    cx.translate(p.x, p.y - 4);
    cx.save();
    cx.scale(1, 0.5);
    cx.rotate(u.face + Math.PI / 4);
    // treads
    cx.fillStyle = '#23262c';
    cx.fillRect(-L, -Wd - 3, L * 2, 6);
    cx.fillRect(-L, Wd - 3, L * 2, 6);
    // tread links
    cx.fillStyle = '#3a3e46';
    for(let i = -L + 2; i < L; i += 5){ cx.fillRect(i, -Wd - 2, 2, 4); cx.fillRect(i, Wd - 2, 2, 4); }
    // hull
    cx.fillStyle = hullC;
    cx.fillRect(-L + 2, -Wd + 1, L * 2 - 4, Wd * 2 - 2);
    cx.fillStyle = light;
    cx.fillRect(-L + 2, -Wd + 1, L * 2 - 4, 3);
    cx.fillStyle = dark;
    cx.fillRect(-L + 2, Wd - 4, L * 2 - 4, 3);
    // front glacis marker
    cx.fillStyle = dark;
    cx.beginPath(); cx.moveTo(L - 2, -Wd + 1); cx.lineTo(L + 4, 0); cx.lineTo(L - 2, Wd - 1); cx.closePath(); cx.fill();

    if(k === 'harv'){
      // cab + ore hopper
      cx.fillStyle = shade(hullC, 1.25);
      cx.fillRect(L - 12, -Wd + 2, 9, Wd * 2 - 4);
      cx.fillStyle = '#1d2026';
      cx.fillRect(L - 10, -Wd + 3, 3, Wd * 2 - 6);
      cx.fillStyle = dark;
      cx.fillRect(-L + 3, -Wd + 3, L + 4, Wd * 2 - 6);
      if(u.carry > 0){
        cx.fillStyle = '#e8b62e';
        const fill = Math.min(1, u.carry / 700);
        cx.fillRect(-L + 4, -Wd + 4, (L + 2) * fill, Wd * 2 - 8);
        cx.fillStyle = '#ffdf6b';
        cx.fillRect(-L + 5, -Wd + 5, (L) * fill, 2);
      }
      // scoop arm
      cx.fillStyle = '#4a4f58';
      cx.fillRect(L + 2, -4, 7, 8);
    }
    cx.restore();

    if(k !== 'harv'){
      // turret (screen space, slightly raised)
      const d = isoDir(u.face);
      const ty0 = -5;
      cx.fillStyle = shade(hullC, 1.1);
      cx.beginPath(); cx.ellipse(0, ty0, k === 'htank' ? 9 : 7, (k === 'htank' ? 9 : 7) * 0.55, 0, 0, 7); cx.fill();
      cx.strokeStyle = 'rgba(0,0,0,0.35)'; cx.lineWidth = 1;
      cx.beginPath(); cx.ellipse(0, ty0, k === 'htank' ? 9 : 7, (k === 'htank' ? 9 : 7) * 0.55, 0, 0, 7); cx.stroke();
      // barrel(s): twin barrels for the Soviet heavy tank
      const twin = k === 'htank' && u.team === ENEMY;
      const bl = k === 'htank' ? 17 : 14;
      cx.strokeStyle = '#23272e';
      cx.lineWidth = k === 'htank' ? 3 : 2.5;
      if(twin){
        const px2 = -d.y * 2.4, py2 = d.x * 1.4;
        cx.beginPath();
        cx.moveTo(px2, ty0 + py2); cx.lineTo(px2 + d.x * bl, ty0 + py2 + d.y * bl);
        cx.moveTo(-px2, ty0 - py2); cx.lineTo(-px2 + d.x * bl, ty0 - py2 + d.y * bl);
        cx.stroke();
      } else {
        cx.beginPath(); cx.moveTo(0, ty0); cx.lineTo(d.x * bl, ty0 + d.y * bl); cx.stroke();
        cx.fillStyle = '#23272e';
        cx.fillRect(d.x * bl - 1.5, ty0 + d.y * bl - 1.5, 3, 3);
      }
      // team color hatch on turret
      cx.fillStyle = tc;
      cx.beginPath(); cx.ellipse(-2, ty0 - 1, 2.6, 1.6, 0, 0, 7); cx.fill();
    }
  }
  cx.restore();
}

// foam behind a moving ship
export function drawWake(u, p){
  const d = isoDir(u.face);
  cx.strokeStyle = 'rgba(235,245,255,0.45)'; cx.lineWidth = 2;
  for(const s of [-1, 1]){
    cx.beginPath();
    cx.moveTo(p.x - d.x * u.def.r * 0.6, p.y - d.y * u.def.r * 0.6);
    cx.lineTo(p.x - d.x * u.def.r * 1.8 - d.y * s * 9, p.y - d.y * u.def.r * 1.8 + d.x * s * 4.5);
    cx.stroke();
  }
}

// simple hull shapes for ships without a sprite sheet
export function drawShipFallback(u, p, tc){
  const k = u.def.key, L = u.def.r * 1.3, W = u.def.r * 0.45;
  const hull = k === 'sub' ? '#2e343a' : u.team === PLAYER ? '#7d8894' : '#80786a';
  cx.save();
  cx.translate(p.x, p.y);
  cx.save();
  cx.scale(1, 0.5);
  cx.rotate(u.face + Math.PI / 4);
  cx.fillStyle = shade(hull, 0.7);
  cx.beginPath(); cx.moveTo(L + 6, 0); cx.lineTo(L - 6, -W); cx.lineTo(-L, -W); cx.lineTo(-L, W); cx.lineTo(L - 6, W); cx.closePath(); cx.fill();
  cx.fillStyle = hull;
  cx.beginPath(); cx.moveTo(L + 2, 0); cx.lineTo(L - 7, -W + 2); cx.lineTo(-L + 2, -W + 2); cx.lineTo(-L + 2, W - 2); cx.lineTo(L - 7, W - 2); cx.closePath(); cx.fill();
  cx.fillStyle = tc; cx.fillRect(-L + 4, -2, 6, 4);
  if(k === 'lander'){ cx.fillStyle = '#5a6068'; cx.fillRect(L - 8, -W + 2, 4, W * 2 - 4); }   // bow ramp
  cx.restore();
  // superstructure / conning tower, raised above the deck
  if(k === 'sub'){ cx.fillStyle = '#23282d'; cx.fillRect(-3, -9, 6, 7); }
  else if(k === 'lander'){ const d = isoDir(u.face); cx.fillStyle = shade(hull, 1.2); cx.fillRect(-d.x * L * 0.7 - 4, -d.y * L * 0.7 - 10, 8, 8); }
  else {
    cx.fillStyle = shade(hull, 1.15); cx.fillRect(-5, -10, 10, 8);
    const d = isoDir(u.tface);
    cx.strokeStyle = '#23272e'; cx.lineWidth = 2.5;
    cx.beginPath(); cx.moveTo(0, -8); cx.lineTo(d.x * 14, -8 + d.y * 14); cx.stroke();
  }
  cx.restore();
}

// simple shapes for aircraft without a sprite sheet
export function drawAircraftFallback(u, p, tc){
  const k = u.def.key;
  const skin = u.team === PLAYER ? '#a3adb8' : '#978d7e';
  cx.save();
  cx.translate(p.x, p.y);
  cx.save();
  cx.scale(1, 0.5);
  cx.rotate(u.face + Math.PI / 4);
  if(k === 'airship'){
    cx.fillStyle = skin;
    cx.beginPath(); cx.ellipse(0, 0, 40, 13, 0, 0, 7); cx.fill();
    cx.fillStyle = tc; cx.fillRect(-2, -13, 5, 26);
    cx.fillStyle = shade(skin, 0.6);
    cx.beginPath(); cx.moveTo(-34, 0); cx.lineTo(-46, -12); cx.lineTo(-46, 12); cx.closePath(); cx.fill();
  } else if(k === 'heli'){
    cx.fillStyle = '#5f666e';
    cx.beginPath(); cx.ellipse(4, 0, 16, 9, 0, 0, 7); cx.fill();
    cx.fillRect(-28, -2, 20, 4);
    cx.fillStyle = tc; cx.fillRect(-2, -9, 8, 3);
  } else {   // jet: delta wing
    cx.fillStyle = skin;
    cx.beginPath(); cx.moveTo(18, 0); cx.lineTo(-12, -15); cx.lineTo(-8, 0); cx.lineTo(-12, 15); cx.closePath(); cx.fill();
    cx.fillStyle = tc; cx.fillRect(-10, -14, 4, 4); cx.fillRect(-10, 10, 4, 4);
    if(u.ammo > 0){ cx.fillStyle = '#2b2f36'; cx.fillRect(-4, -8, 8, 3); cx.fillRect(-4, 5, 8, 3); }
  }
  cx.restore();
  if(k === 'airship'){   // gondola hangs below the envelope
    cx.fillStyle = shade(skin, 0.7); cx.fillRect(-8, 6, 16, 6);
  } else if(k === 'heli'){ // rotor disc
    cx.strokeStyle = 'rgba(40,44,50,0.7)'; cx.lineWidth = 1.5;
    const a = u.moving ? state.time * 20 : 0;
    cx.beginPath();
    for(let i = 0; i < 2; i++){ const b = a + i * Math.PI / 2; cx.moveTo(-Math.cos(b) * 22, -8 - Math.sin(b) * 11); cx.lineTo(Math.cos(b) * 22, -8 + Math.sin(b) * 11); }
    cx.stroke();
  }
  cx.restore();
}

// segmented health bar in a black box
export function drawHealthBar(sx, sy, w, frac){
  cx.fillStyle = 'rgba(6,8,12,0.85)';
  cx.fillRect(sx - w / 2 - 1, sy - 1, w + 2, 6);
  const col = frac > 0.55 ? '#3ee653' : frac > 0.25 ? '#f5c542' : '#e04040';
  const pipW = 3, gap = 1, n = Math.floor(w / (pipW + gap));
  const lit = Math.ceil(frac * n);
  for(let i = 0; i < n; i++){
    cx.fillStyle = i < lit ? col : '#20242c';
    cx.fillRect(sx - w / 2 + i * (pipW + gap), sy, pipW, 4);
  }
}

export function drawFlag(x, y, color){
  cx.strokeStyle = '#e8edf3'; cx.lineWidth = 1.5;
  cx.beginPath(); cx.moveTo(x, y); cx.lineTo(x, y - 18); cx.stroke();
  const w = Math.sin(state.time * 6) * 1.5;
  cx.fillStyle = color;
  cx.beginPath(); cx.moveTo(x, y - 18); cx.lineTo(x + 11, y - 15 + w); cx.lineTo(x, y - 11); cx.closePath(); cx.fill();
  cx.strokeStyle = 'rgba(0,0,0,.5)'; cx.lineWidth = 1; cx.stroke();
}

// veterancy: one gold chevron for veteran, two for elite
export function drawChevrons(x, y, n){
  for(let i = 0; i < n; i++){
    const yy = y + i * 4;
    cx.strokeStyle = '#000'; cx.lineWidth = 3.5;
    cx.beginPath(); cx.moveTo(x, yy); cx.lineTo(x + 4, yy + 3); cx.lineTo(x + 8, yy); cx.stroke();
    cx.strokeStyle = '#ffd24a'; cx.lineWidth = 2;
    cx.beginPath(); cx.moveTo(x, yy); cx.lineTo(x + 4, yy + 3); cx.lineTo(x + 8, yy); cx.stroke();
  }
}


export function drawCursor(){
  if(!mouse.inCanvas) return;
  const type = cursorType();
  const x = mouse.x, y = mouse.y, t = state.time + performance.now() / 1000;
  const pulse = (Math.sin(t * 8) + 1) / 2;
  cx.save();
  cx.lineJoin = 'round';
  const stroke2 = (color, w, draw) => {
    cx.strokeStyle = '#000'; cx.lineWidth = w + 2.5; cx.beginPath(); draw(); cx.stroke();
    cx.strokeStyle = color; cx.lineWidth = w; cx.beginPath(); draw(); cx.stroke();
  };
  if(type === 'arrow' || type === 'rally'){
    cx.fillStyle = '#e9eef4'; cx.strokeStyle = '#11161d'; cx.lineWidth = 1.5;
    cx.beginPath();
    cx.moveTo(x, y); cx.lineTo(x, y + 17); cx.lineTo(x + 4.5, y + 13); cx.lineTo(x + 8, y + 20);
    cx.lineTo(x + 10.5, y + 19); cx.lineTo(x + 7.5, y + 12); cx.lineTo(x + 13, y + 12); cx.closePath();
    cx.fill(); cx.stroke();
    if(type === 'rally') drawFlag(x + 14, y + 24, TEAM_COLOR[PLAYER]);
  } else if(type === 'select'){
    const r = 9 + pulse * 3, L = 5;
    stroke2('#ffffff', 1.5, () => {
      for(const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]){
        cx.moveTo(x + sx * r, y + sy * (r - L)); cx.lineTo(x + sx * r, y + sy * r); cx.lineTo(x + sx * (r - L), y + sy * r);
      }
    });
  } else if(type === 'move' || type === 'deploy'){
    // four arrowheads converging on (move) or pointing away from (deploy) the spot
    const col = type === 'move' ? '#55f06a' : '#ffd24a';
    const r = 7 + pulse * 5, dir = type === 'move' ? -1 : 1;
    cx.fillStyle = col; cx.strokeStyle = '#000'; cx.lineWidth = 1.2;
    for(let k = 0; k < 4; k++){
      const a = k * Math.PI / 2 + Math.PI / 4;
      const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r * 0.75;
      const ux = Math.cos(a) * dir, uy = Math.sin(a) * dir;
      cx.beginPath();
      cx.moveTo(px + ux * 6, py + uy * 6);
      cx.lineTo(px - uy * 4, py + ux * 4); cx.lineTo(px + uy * 4, py - ux * 4);
      cx.closePath(); cx.fill(); cx.stroke();
    }
  } else if(type === 'attack'){
    const r = 11;
    stroke2('#ff4a3a', 2, () => { cx.arc(x, y, r, 0, Math.PI * 2); });
    stroke2('#ff4a3a', 2, () => {
      for(let k = 0; k < 4; k++){
        const a = k * Math.PI / 2 + t * 2;
        cx.moveTo(x + Math.cos(a) * (r - 5), y + Math.sin(a) * (r - 5));
        cx.lineTo(x + Math.cos(a) * (r + 5), y + Math.sin(a) * (r + 5));
      }
    });
    cx.fillStyle = '#ff4a3a'; cx.fillRect(x - 1, y - 1, 2, 2);
  } else if(type === 'nomove' || type === 'nodeploy'){
    stroke2('#ff4a3a', 2.2, () => { cx.arc(x, y, 9, 0, Math.PI * 2); });
    stroke2('#ff4a3a', 2.2, () => { cx.moveTo(x - 6, y - 6); cx.lineTo(x + 6, y + 6); });
  } else if(type === 'capture' || type === 'fix' || type === 'enter'){
    // engineer / passenger: an outline with an arrow walking into it
    const col = type === 'capture' ? '#ffd24a' : type === 'enter' ? '#6ec8ff' : '#55f06a';
    stroke2(col, 2, () => {
      cx.moveTo(x - 10, y + 8); cx.lineTo(x - 10, y - 4); cx.lineTo(x, y - 11); cx.lineTo(x + 10, y - 4); cx.lineTo(x + 10, y + 8); cx.closePath();
    });
    cx.fillStyle = col; cx.strokeStyle = '#000'; cx.lineWidth = 1.2;
    const k = pulse * 3;
    cx.beginPath(); cx.moveTo(x - 4, y - 3 + k); cx.lineTo(x + 4, y - 3 + k); cx.lineTo(x, y + 4 + k); cx.closePath(); cx.fill(); cx.stroke();
    if(type === 'fix'){ cx.font = 'bold 10px sans-serif'; cx.textAlign = 'center'; cx.fillText('+', x + 12, y - 9); }
  } else if(type === 'sell' || type === 'repair'){
    const ok = !!modeTarget();
    cx.font = 'bold 20px sans-serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
    cx.strokeStyle = '#000'; cx.lineWidth = 3;
    const glyph = type === 'sell' ? '$' : '🔧';
    cx.fillStyle = ok ? '#ffd24a' : '#ff5b5b';
    cx.strokeText(glyph, x, y); cx.fillText(glyph, x, y);
    if(!ok){   // small "no" badge in the corner, so the glyph itself stays readable
      const bx = x + 11, by = y + 10;
      cx.fillStyle = 'rgba(0,0,0,0.55)'; cx.beginPath(); cx.arc(bx, by, 6.5, 0, Math.PI * 2); cx.fill();
      stroke2('#ff4a3a', 1.8, () => { cx.arc(bx, by, 5, 0, Math.PI * 2); });
      stroke2('#ff4a3a', 1.8, () => { cx.moveTo(bx - 3.5, by - 3.5); cx.lineTo(bx + 3.5, by + 3.5); });
    }
  }
  cx.restore();
}

// white corner selection brackets
export function drawBrackets(sx, sy, w, h){
  const L = Math.min(7, w * 0.3);
  cx.strokeStyle = 'rgba(255,255,255,0.92)';
  cx.lineWidth = 1.5;
  cx.beginPath();
  cx.moveTo(sx + L, sy); cx.lineTo(sx, sy); cx.lineTo(sx, sy + L);
  cx.moveTo(sx + w - L, sy); cx.lineTo(sx + w, sy); cx.lineTo(sx + w, sy + L);
  cx.moveTo(sx + L, sy + h); cx.lineTo(sx, sy + h); cx.lineTo(sx, sy + h - L);
  cx.moveTo(sx + w - L, sy + h); cx.lineTo(sx + w, sy + h); cx.lineTo(sx + w, sy + h - L);
  cx.stroke();
}

export function drawProjectile(p){
  if(p.kind === 'bomb'){
    const g = isoAt(p.x, p.y);
    cx.fillStyle = 'rgba(0,0,0,0.22)';
    cx.beginPath(); cx.ellipse(g.x, g.y, 4, 2, 0, 0, 7); cx.fill();
    cx.fillStyle = '#2b2f36';
    cx.beginPath(); cx.ellipse(g.x, g.y - p.z, 2.2, 4.5, 0, 0, 7); cx.fill();
    return;
  }
  if(p.kind === 'missile'){
    const g = isoAt(p.x, p.y), z = missileZ(p);
    // shadow on the ground, then the missile pitched along its arc
    cx.fillStyle = 'rgba(0,0,0,0.25)';
    cx.beginPath(); cx.ellipse(g.x, g.y, 7, 3, 0, 0, 7); cx.fill();
    const ux = (p.tx - p.sx) / p.total, uy = (p.ty - p.sy) / p.total;
    const g2 = isoAt(p.x + ux, p.y + uy);
    const f = clamp(1 - Math.hypot(p.tx - p.x, p.ty - p.y) / p.total, 0, 1);
    const dz = Math.cos(f * Math.PI) * Math.PI * Math.min(220, p.total * 0.45) / p.total;
    const a = Math.atan2(g2.y - g.y - dz, g2.x - g.x);
    cx.save(); cx.translate(g.x, g.y - z); cx.rotate(a);
    cx.fillStyle = '#ffb347'; cx.beginPath(); cx.moveTo(-9, -2); cx.lineTo(-16 - Math.random() * 5, 0); cx.lineTo(-9, 2); cx.fill();
    cx.fillStyle = '#e4e1d8'; cx.fillRect(-9, -2.5, 14, 5);
    cx.fillStyle = TEAM_COLOR[p.team]; cx.fillRect(-4, -2.6, 2, 5.2);
    cx.fillStyle = '#c8452f'; cx.beginPath(); cx.moveTo(5, -2.5); cx.lineTo(10, 0); cx.lineTo(5, 2.5); cx.fill();
    cx.restore();
    return;
  }
  const s = isoAt(p.x, p.y);
  const t = isoAt(p.tx, p.ty);
  // shots to and from aircraft climb or drop along the way
  const k = p.total ? clamp(1 - Math.hypot(p.tx - p.x, p.ty - p.y) / p.total, 0, 1) : 1;
  s.y -= 8 + (p.z0 || 0) * (1 - k) + (p.zt || 0) * k; t.y -= 6 + (p.zt || 0);
  const a = Math.atan2(t.y - s.y, t.x - s.x);
  if(p.kind === 'torpedo'){   // a dark streak just under the surface, with a foam trail
    const g = isoAt(p.x, p.y), a2 = Math.atan2(t.y + 6 - g.y, t.x - g.x);
    cx.strokeStyle = 'rgba(230,245,255,0.6)'; cx.lineWidth = 2;
    cx.beginPath(); cx.moveTo(g.x, g.y); cx.lineTo(g.x - Math.cos(a2) * 14, g.y - Math.sin(a2) * 14); cx.stroke();
    cx.fillStyle = '#20262c'; cx.beginPath(); cx.ellipse(g.x, g.y, 4, 2, a2, 0, 7); cx.fill();
    return;
  }
  if(p.kind === 'bullet'){
    cx.strokeStyle = '#ffe9a0'; cx.lineWidth = 1.5;
    cx.beginPath(); cx.moveTo(s.x, s.y); cx.lineTo(s.x - Math.cos(a) * 8, s.y - Math.sin(a) * 8); cx.stroke();
  } else if(p.kind === 'flak'){
    cx.fillStyle = '#ffe08a';
    cx.fillRect(s.x - 1.5, s.y - 1.5, 3, 3);
  } else if(p.kind === 'shell'){
    cx.fillStyle = '#ffcf5a';
    cx.beginPath(); cx.arc(s.x, s.y, 2.5, 0, 7); cx.fill();
  } else {
    cx.save(); cx.translate(s.x, s.y); cx.rotate(a);
    cx.fillStyle = '#d8dee9'; cx.fillRect(-5, -1.5, 10, 3);
    cx.fillStyle = '#ff9a3b'; cx.fillRect(-8, -1, 3, 2);
    cx.restore();
  }
}

export function drawEffect(e){
  if(e.t < 0 || e.type === 'delay' || e.type === 'smokecol') return;
  const f = e.t / e.dur;
  if(e.type === 'boom' && Sprites.has('explosion')){
    // rendered fireball: frames 0-4 flame, 5-7 smoke; scaled to the blast
    const p = isoAt(e.x, e.y), sheet = Sprites.get('explosion'), k = e.size / 26;
    cx.save(); cx.translate(p.x, p.y); cx.scale(k, k);
    Sprites.draw(cx, 'explosion', 0, Math.min(sheet.frames - 1, Math.floor(f * sheet.frames)), 0, 0);
    cx.restore();
  } else if(e.type === 'boom'){
    // fireball: bright core that swells upward, then fades into the puffs around it
    const p = isoAt(e.x, e.y);
    const r = e.size * (0.5 + Math.sqrt(f) * 0.9);
    const lift = f * e.size * 0.6;
    cx.save();
    cx.globalCompositeOperation = 'lighter';
    const g = cx.createRadialGradient(p.x, p.y - lift, 0, p.x, p.y - lift, r);
    const a = Math.max(0, 1 - f * 1.3);
    g.addColorStop(0, `rgba(255,250,210,${a})`);
    g.addColorStop(0.3, `rgba(255,190,70,${a * 0.9})`);
    g.addColorStop(0.7, `rgba(230,80,10,${a * 0.5})`);
    g.addColorStop(1, 'rgba(120,20,0,0)');
    cx.fillStyle = g;
    cx.beginPath(); cx.ellipse(p.x, p.y - lift, r, r * 0.8, 0, 0, Math.PI * 2); cx.fill();
    cx.restore();
    if(f < 0.15){ // ground flash
      cx.fillStyle = `rgba(255,220,150,${0.35 * (1 - f / 0.15)})`;
      cx.beginPath(); cx.ellipse(p.x, p.y, e.size * 1.6, e.size * 0.8, 0, 0, Math.PI * 2); cx.fill();
    }
  } else if(e.type === 'puff'){
    const p = isoAt(e.x, e.y);
    const r = e.r * (0.6 + f * 1.1);
    const a = (e.dark ? 0.45 : 0.55) * (1 - f) * Math.min(1, e.t * 8);
    const c = e.dark ? 40 + f * 60 : 90 + f * 70;
    const g = cx.createRadialGradient(p.x, p.y - e.z, 0, p.x, p.y - e.z, r);
    g.addColorStop(0, `rgba(${c},${c * 0.95},${c * 0.9},${a})`);
    g.addColorStop(1, `rgba(${c},${c},${c},0)`);
    cx.fillStyle = g;
    cx.beginPath(); cx.arc(p.x, p.y - e.z, r, 0, Math.PI * 2); cx.fill();
  } else if(e.type === 'corpse'){
    const p = isoAt(e.x, e.y);
    cx.save();
    cx.globalAlpha = e.t > e.dur - 1 ? e.dur - e.t : 1;
    Sprites.draw(cx, e.name, e.team, Math.min(3, Math.floor(e.t / 0.1)), p.x, p.y);
    cx.restore();
  } else if(e.type === 'spark'){
    const p = isoAt(e.x, e.y);
    cx.fillStyle = `rgba(255,${180 - f * 120 | 0},60,${1 - f})`;
    cx.fillRect(p.x - 2, p.y - 8 - f * 6, 4, 4);
  } else if(e.type === 'hit'){
    const p = isoAt(e.x, e.y);
    cx.fillStyle = `rgba(255,200,90,${1 - f})`;
    cx.beginPath(); cx.arc(p.x, p.y - 6 - (e.z || 0), (e.big ? 9 : 4.5) * (0.5 + f), 0, 7); cx.fill();
  } else if(e.type === 'muzzle'){
    const p = isoAt(e.x, e.y);
    const d = isoDir(e.a);
    cx.strokeStyle = `rgba(255,240,160,${1 - f})`;
    cx.lineWidth = 3;
    cx.beginPath();
    cx.moveTo(p.x + d.x * 8, p.y - e.z + d.y * 8);
    cx.lineTo(p.x + d.x * 15, p.y - e.z + d.y * 15);
    cx.stroke();
  } else if(e.type === 'smoke'){
    const p = isoAt(e.x, e.y);
    cx.fillStyle = `rgba(190,190,190,${0.5 * (1 - f)})`;
    cx.beginPath(); cx.arc(p.x, p.y - (e.z || 8), e.z ? 3 + f * 8 : 2 + f * 4, 0, 7); cx.fill();
  } else if(e.type === 'tracer'){
    const p1 = isoAt(e.x1, e.y1), p2 = isoAt(e.x2, e.y2);
    cx.strokeStyle = `rgba(255,250,220,${1 - f})`; cx.lineWidth = 1.2;
    cx.beginPath(); cx.moveTo(p1.x, p1.y - 10); cx.lineTo(p2.x, p2.y - 6); cx.stroke();
  } else if(e.type === 'beam'){
    const p1 = isoAt(e.x1, e.y1), p2 = isoAt(e.x2, e.y2);
    cx.strokeStyle = e.heal ? `rgba(120,255,140,${1 - f})` : `rgba(${e.col || '150,230,255'},${1 - f})`; cx.lineWidth = (4 * (1 - f) + 1) * (e.thin ? 0.5 : 1);
    cx.beginPath(); cx.moveTo(p1.x, p1.y - e.z1); cx.lineTo(p2.x, p2.y - 6); cx.stroke();
    cx.strokeStyle = `rgba(255,255,255,${1 - f})`; cx.lineWidth = 1.5;
    cx.beginPath(); cx.moveTo(p1.x, p1.y - e.z1); cx.lineTo(p2.x, p2.y - 6); cx.stroke();
  } else if(e.type === 'arc'){
    const p1 = isoAt(e.x1, e.y1), p2 = isoAt(e.x2, e.y2);
    const y1 = p1.y - e.z1, y2 = p2.y - 6;
    cx.strokeStyle = `rgba(${e.col || '140,200,255'},${1 - f})`; cx.lineWidth = 2.5;
    cx.beginPath(); cx.moveTo(p1.x, y1);
    const seg = 6;
    for(let i = 1; i <= seg; i++){
      const px = p1.x + (p2.x - p1.x) * i / seg + (i < seg ? (Math.random() - 0.5) * 16 : 0);
      const py = y1 + (y2 - y1) * i / seg + (i < seg ? (Math.random() - 0.5) * 16 : 0);
      cx.lineTo(px, py);
    }
    cx.stroke();
  } else if(e.type === 'charge'){
    const p = isoAt(e.x, e.y);
    if(Math.floor(e.t * (e.dur - e.t < 1 ? 10 : 4)) % 2 === 0){
      cx.fillStyle = '#ff3a2a';
      cx.beginPath(); cx.arc(p.x, p.y - 10 - (e.target.z || 0), 3, 0, 7); cx.fill();
    }
  } else if(e.type === 'blink'){
    const p = isoAt(e.x, e.y);
    const r = e.arrive ? 6 + f * 18 : 18 * (1 - f) + 4;
    cx.strokeStyle = `rgba(150,215,255,${e.arrive ? 1 - f : 0.4 + f * 0.6})`; cx.lineWidth = 2;
    cx.beginPath(); cx.ellipse(p.x, p.y - 2, r, r * 0.5, 0, 0, 7); cx.stroke();
    cx.beginPath(); cx.moveTo(p.x, p.y - 2); cx.lineTo(p.x, p.y - 26 * (e.arrive ? 1 - f : f)); cx.stroke();
  } else if(e.type === 'cmd'){
    const p = isoAt(e.x, e.y);
    cx.strokeStyle = e.red ? `rgba(255,90,90,${1 - f})` : `rgba(120,255,120,${1 - f})`;
    cx.lineWidth = 2;
    cx.beginPath(); cx.ellipse(p.x, p.y, 16 * (1 - f) + 3, (16 * (1 - f) + 3) * 0.5, 0, 0, 7); cx.stroke();
  }
}

// ---------- drawing: frame ----------
export function visibleTileBounds(){
  // world-space bounding box of the 4 screen corners
  const c = [
    toWorld(state.camX, state.camY),
    toWorld(state.camX + VW, state.camY),
    toWorld(state.camX, state.camY + VH),
    toWorld(state.camX + VW, state.camY + VH),
  ];
  const pad = 2;
  return {
    x0: clamp(Math.floor(Math.min(c[0].x, c[1].x, c[2].x, c[3].x) / T) - pad, 0, MW - 1),
    x1: clamp(Math.ceil (Math.max(c[0].x, c[1].x, c[2].x, c[3].x) / T) + pad, 0, MW - 1),
    y0: clamp(Math.floor(Math.min(c[0].y, c[1].y, c[2].y, c[3].y) / T) - pad, 0, MH - 1),
    y1: clamp(Math.ceil (Math.max(c[0].y, c[1].y, c[2].y, c[3].y) / T) + pad, 0, MH - 1),
  };
}

// screen-space bounds of an entity's visible pixels (for brackets / health bars)
export function screenBox(e){
  const p = e.kind === 'unit' ? isoAt(e.x, e.y, e.z || 0) : toIso(e.x, e.y);
  const name = e.kind === 'unit' ? uName(e) : '';
  const fromSprite = (sp, bb, grow) => ({
    x0: p.x + bb.x0, y0: p.y + bb.y0 - (grow || 0), x1: p.x + bb.x1, y1: p.y + bb.y1,
  });
  if(e.kind === 'building'){
    const sp = Sprites.get(bName(e)), bb = Sprites.bbox(bName(e), 0);
    if(sp && bb) return fromSprite(sp, bb);
    const t = toIso(e.tx * T, e.ty * T), r = toIso((e.tx + e.w) * T, e.ty * T);
    const b2 = toIso((e.tx + e.w) * T, (e.ty + e.h) * T), l = toIso(e.tx * T, (e.ty + e.h) * T);
    return {x0: l.x, y0: t.y - e.def.z, x1: r.x, y1: b2.y};
  }
  const inf = Sprites.get(name), body = Sprites.get(name + '_body');
  if(inf){ const bb = Sprites.bbox(name, infantryFrame(e, inf)); if(bb) return fromSprite(inf, bb); }
  if(body){
    const bb = Sprites.bbox(name + '_body', Sprites.facing(body, e.face));
    if(bb) return fromSprite(body, bb, hasTurret(e.def) ? 7 : 0);
  }
  const r = e.def.r + 6;
  return {x0: p.x - r, y0: p.y - r - 8, x1: p.x + r, y1: p.y + 4};
}

export function drawOreFallback(x, y, a){
  const n = Math.min(5, 1 + Math.floor(a / 120));
  let hsh = (x * 73856093 ^ y * 19349663) >>> 0;
  for(let i = 0; i < n; i++){
    hsh = (hsh * 1103515245 + 12345) >>> 0;
    const fx = (hsh % 100) / 100;
    hsh = (hsh * 1103515245 + 12345) >>> 0;
    const fy = (hsh % 100) / 100;
    const p = toIso((x + 0.2 + fx * 0.6) * T, (y + 0.2 + fy * 0.6) * T);
    cx.fillStyle = '#c8951c';
    cx.beginPath();
    cx.moveTo(p.x, p.y - 7); cx.lineTo(p.x + 3.5, p.y - 2); cx.lineTo(p.x, p.y + 1); cx.lineTo(p.x - 3.5, p.y - 2);
    cx.closePath(); cx.fill();
  }
}

// shroud texture: one pixel per tile, opaque where unexplored
export const shroudC = document.createElement('canvas');
shroudC.width = MW; shroudC.height = MH;
export const shroudX = shroudC.getContext('2d');
export function updateShroud(){
  const img = shroudX.createImageData(MW, MH);
  for(let i = 0; i < MW * MH; i++){
    img.data[i * 4] = 4; img.data[i * 4 + 1] = 7; img.data[i * 4 + 2] = 13;
    img.data[i * 4 + 3] = explored[i] ? 0 : 255;
  }
  shroudX.putImageData(img, 0, 0);
  flags.shroudDirty = false;
}

export function draw(){
  cx.setTransform(DPR, 0, 0, DPR, 0, 0);
  cx.fillStyle = '#04070d';
  cx.fillRect(0, 0, CW, CH);
  cx.save();
  // device pixels per iso px; the art is rendered at 2 px per iso px, so an
  // integer ratio of eff / 2 maps texels to whole device pixels (no smoothing)
  const eff = DPR * ZOOM;
  const texel = eff / TERRAIN_SCALE;
  cx.imageSmoothingEnabled = !(texel >= 1 && Math.abs(texel - Math.round(texel)) < 1e-3);
  cx.imageSmoothingQuality = 'high';
  Sprites.snap = eff;
  cx.scale(ZOOM, ZOOM);
  cx.translate(-Math.round(state.camX * eff) / eff, -Math.round(state.camY * eff) / eff);

  drawTerrain();

  const vb = visibleTileBounds();

  // ore (dynamic — depletes)
  const oreSprite = Sprites.has('ore');
  for(let y = vb.y0; y <= vb.y1; y++)
    for(let x = vb.x0; x <= vb.x1; x++){
      const a = ore[idx(x, y)];
      if(a <= 0) continue;
      if(oreSprite){
        const level = a > 380 ? 3 : a > 250 ? 2 : a > 120 ? 1 : 0;
        const p = toIso((x + 0.5) * T, (y + 0.5) * T);
        Sprites.draw(cx, 'ore', 0, level * 2 + (hash2(x, y) < 0.5 ? 0 : 1), p.x, p.y);
      } else drawOreFallback(x, y, a);
    }

  // radiation glows on the ground
  for(const z of radSources()){
    const p = toIso(z.x, z.y), a = 0.16 + Math.sin(state.time * 5 + z.x) * 0.05;
    const g = cx.createRadialGradient(p.x, p.y, 0, p.x, p.y, z.r * 1.4);
    g.addColorStop(0, `rgba(120,255,80,${a * 1.6})`); g.addColorStop(1, 'rgba(120,255,80,0)');
    cx.fillStyle = g;
    cx.beginPath(); cx.ellipse(p.x, p.y, z.r * 1.4, z.r * 0.7, 0, 0, 7); cx.fill();
  }

  // corpses lie on the ground under everything else
  for(const e of effects) if(e.type === 'corpse') drawEffect(e);

  // entities + scenery, painter's order by world depth (x + y)
  const renderables = [];
  for(const b of buildings) if(!b.dead) renderables.push(b);
  for(const u of units) if(onMap(u) && !u.def.air) renderables.push(u);
  for(const d of doodads)
    if(d.tx >= vb.x0 && d.tx <= vb.x1 && d.ty >= vb.y0 && d.ty <= vb.y1) renderables.push(d);
  const depth = e => e.x + e.y - (e.def && e.def.flat ? 1e5 : 0);   // flat buildings lie under whatever drives on them
  renderables.sort((a, b) => depth(a) - depth(b));
  for(const e of renderables){
    if(e.kind === 'building') drawBuildingSprite(e);
    else if(e.kind === 'unit') drawUnitSprite(e);
    else { const p = toIso(e.x, e.y); Sprites.draw(cx, e.name, 0, e.frame, p.x, p.y); }
  }
  // aircraft go over everything on the ground: shadows first, then the craft
  const air = units.filter(u => onMap(u) && u.def.air && !hiddenFrom(u, PLAYER)).sort((a, b) => (a.x + a.y) - (b.x + b.y));
  for(const u of air) drawAirShadow(u);
  for(const u of air){ drawUnitSprite(u); renderables.push(u); }

  // rally points of selected factories
  for(const b of selection){
    if(b.dead || b.kind !== 'building' || !b.rally) continue;
    if(b.rally.patrol){   // a patrol rally: the round its units will walk
      const pts = patrolRoute(b.team, b).map(p => toIso(p.x, p.y));
      cx.save();
      cx.setLineDash([6, 5]); cx.lineDashOffset = -state.time * 20;
      cx.strokeStyle = 'rgba(255,210,74,0.85)'; cx.lineWidth = 1.5;
      cx.beginPath(); pts.forEach((p, i) => i ? cx.lineTo(p.x, p.y) : cx.moveTo(p.x, p.y)); cx.closePath(); cx.stroke();
      cx.restore();
      continue;
    }
    const a = toIso(b.x, b.y), r = toIso(b.rally.x, b.rally.y);
    cx.save();
    cx.setLineDash([6, 5]); cx.lineDashOffset = -state.time * 20;
    cx.strokeStyle = 'rgba(255,255,255,0.85)'; cx.lineWidth = 1.5;
    cx.beginPath(); cx.moveTo(a.x, a.y); cx.lineTo(r.x, r.y); cx.stroke();
    cx.restore();
    drawFlag(r.x, r.y, TEAM_COLOR[b.team]);
  }

  // selection UI + health bars (above sprites)
  for(const e of renderables){
    if(e.kind === 'doodad') continue;
    const sel = selection.includes(e);
    const frac = clamp(e.hp / e.maxHp, 0, 1);
    if(!sel && frac >= 1 && !e.vet && !(e.cargo && e.cargo.length && e.kind === 'building')) continue;
    const box = screenBox(e);
    if(e.kind === 'building'){
      if(sel) drawBrackets(box.x0 - 3, box.y0 - 3, box.x1 - box.x0 + 6, box.y1 - box.y0 + 6);
      drawHealthBar((box.x0 + box.x1) / 2, box.y0 - 10, Math.min(box.x1 - box.x0 - 10, 60), frac);
      if(e.cargo && e.cargo.length){   // garrison: a pip per occupant in the owner's colour
        const n = capacity(e), x0 = (box.x0 + box.x1) / 2 - n * 3;
        for(let i = 0; i < n; i++){
          cx.fillStyle = 'rgba(6,8,12,0.85)'; cx.fillRect(x0 + i * 6 - 0.5, box.y0 - 3.5, 5, 5);
          cx.fillStyle = i < e.cargo.length ? TEAM_COLOR[e.team] : '#2a3140'; cx.fillRect(x0 + i * 6, box.y0 - 3, 4, 4);
        }
      }
      if(e.repairing && Math.floor(state.time * 3) % 2 === 0){
        cx.font = '18px sans-serif'; cx.textAlign = 'center';
        cx.fillText('🔧', (box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2);
      }
    } else {
      if(sel) drawBrackets(box.x0 - 3, box.y0 - 3, box.x1 - box.x0 + 6, box.y1 - box.y0 + 6);
      drawHealthBar((box.x0 + box.x1) / 2, box.y0 - 9, isInf(e.def) ? 16 : 28, frac);
      if(e.cargo && sel){
        const n = e.def.transport, x0 = (box.x0 + box.x1) / 2 - n * 3;
        for(let i = 0; i < n; i++){
          cx.fillStyle = 'rgba(6,8,12,0.85)'; cx.fillRect(x0 + i * 6 - 0.5, box.y0 - 3.5, 5, 5);
          cx.fillStyle = i < e.cargo.length ? '#6ec8ff' : '#2a3140'; cx.fillRect(x0 + i * 6, box.y0 - 3, 4, 4);
        }
      }
      if(e.vet) drawChevrons(box.x1 + 2, box.y0 - 10, e.vet);
    }
  }

  // mind-controlled units wear a purple ring; our disguised infiltrators a blue dot
  for(const u of units){
    if(!onMap(u) || !(u.mindOwner || (u.def.disguise && u.team === PLAYER))) continue;
    const b = screenBox(u), x = (b.x0 + b.x1) / 2, y = b.y0 - 14;
    if(u.mindOwner){
      cx.strokeStyle = `rgba(200,120,255,${0.6 + Math.sin(state.time * 6) * 0.3})`; cx.lineWidth = 2;
      cx.beginPath(); cx.ellipse(x, y, 7, 3, 0, 0, 7); cx.stroke();
    } else { cx.fillStyle = TEAM_COLOR[PLAYER]; cx.beginPath(); cx.arc(x, y + 4, 2.5, 0, 7); cx.fill(); }
  }

  // projectiles + effects
  for(const p of projectiles) if(!p.dead) drawProjectile(p);
  for(const e of effects) if(e.type !== 'corpse') drawEffect(e);

  // shroud: one texel per tile, stretched into iso space with smoothing for soft edges
  if(flags.shroudDirty) updateShroud();
  cx.save();
  cx.transform(T, T / 2, -T, T / 2, WPX, 0);
  cx.imageSmoothingEnabled = true;
  cx.drawImage(shroudC, 0, 0);
  cx.drawImage(shroudC, 0, 0);
  cx.restore();

  // placement ghost
  if(state.placing) drawGhost();

  cx.restore();

  // drag box (screen space)
  if(mouse.dragging){
    cx.strokeStyle = 'rgba(120,255,120,0.9)';
    cx.lineWidth = 1;
    cx.strokeRect(mouse.dragX + 0.5, mouse.dragY + 0.5, mouse.x - mouse.dragX, mouse.y - mouse.dragY);
    cx.fillStyle = 'rgba(120,255,120,0.08)';
    cx.fillRect(mouse.dragX, mouse.dragY, mouse.x - mouse.dragX, mouse.y - mouse.dragY);
  }
  drawCursor();
}

export function drawGhost(){
  const def = BUILD_DEFS[state.placing];
  const tx = Math.floor(mouse.wx / T - def.w / 2 + 0.5);
  const ty = Math.floor(mouse.wy / T - def.h / 2 + 0.5);
  const ok = canPlace(state.placing, tx, ty, PLAYER);
  for(let y = ty; y < ty + def.h; y++)
    for(let x = tx; x < tx + def.w; x++){
      const cellOk = inMap(x, y) && (def.onWater ? sailable(x, y) : occ[idx(x, y)] === 0) && ore[idx(x, y)] <= 0;
      cx.fillStyle = (ok && cellOk) ? 'rgba(80,255,80,0.4)' : 'rgba(255,60,60,0.45)';
      tilePath(cx, x, y); cx.fill();
      cx.strokeStyle = 'rgba(0,0,0,0.3)'; cx.lineWidth = 1; cx.stroke();
    }
}

// ---------- minimap (diamond) ----------
export const mmBase = document.createElement('canvas');
mmBase.width = Math.round(MMW * MM_RES); mmBase.height = Math.round(MMH * MM_RES);
export let radarOn = false, radarT = 0;

// the radar only works with a powered radar building
export function drawMinimap(){
  mmX.setTransform(MM_RES, 0, 0, MM_RES, 0, 0);
  const on = hasBuilding(PLAYER, 'radar') && !state.lowPower;
  if(on !== radarOn){
    radarOn = on; radarT = 0;
    if(state.started) announce(on ? 'Radar online' : 'Radar offline', !on, on ? 'Radar online' : 'Radar offline');
  }
  if(!on){
    mmX.fillStyle = '#06090d';
    mmX.fillRect(0, 0, MMW, MMH);
    for(let i = 0; i < 260; i++){
      const v = 30 + Math.random() * 50 | 0;
      mmX.fillStyle = `rgb(${v},${v + 6},${v + 12})`;
      mmX.fillRect(Math.random() * MMW, Math.random() * MMH, 1 + Math.random() * 2, 1);
    }
    mmX.font = 'bold 11px "Courier New", monospace'; mmX.textAlign = 'center';
    mmX.fillStyle = '#4d6177';
    mmX.fillText(hasBuilding(PLAYER, 'radar') ? 'LOW POWER' : 'RADAR OFFLINE', MMW / 2, MMH / 2 + 4);
    return;
  }
  radarT = Math.min(1, radarT + 0.06);
  if(flags.mmBaseDirty){
    const g = mmBase.getContext('2d');
    g.setTransform(MM_RES, 0, 0, MM_RES, 0, 0);
    g.imageSmoothingQuality = 'high';
    g.drawImage(lowC, 0, 0, MMW, MMH);
    g.fillStyle = '#28401c';
    for(const d of doodads){
      const p = toIso(d.x, d.y);
      g.fillRect(p.x * mmSX - 1, p.y * mmSY - 0.8, 2.2, 1.6);
    }
    flags.mmBaseDirty = false;
  }
  mmX.drawImage(mmBase, 0, 0, MMW, MMH);
  for(let y = 0; y < MH; y++)
    for(let x = 0; x < MW; x++){
      if(!explored[idx(x, y)] || ore[idx(x, y)] <= 0) continue;
      const p = toIso((x + 0.5) * T, (y + 0.5) * T);
      mmX.fillStyle = '#d9a52a';
      mmX.fillRect(p.x * mmSX - 1.2, p.y * mmSY - 0.6, 2.4, 1.2);
    }
  for(const b of buildings){
    if(b.dead) continue;
    if(b.team === PLAYER || explored[idx(b.tx, b.ty)]){
      const p = toIso(b.x, b.y);
      mmX.fillStyle = TEAM_COLOR[b.team];
      mmX.fillRect(p.x * mmSX - b.w * 0.9, p.y * mmSY - b.h * 0.5, b.w * 1.8, b.h);
    }
  }
  for(const u of units){
    if(!onMap(u) || hiddenFrom(u, PLAYER)) continue;
    const t = tileOf(u);
    if(u.team === PLAYER || (inMap(t.x, t.y) && explored[idx(t.x, t.y)])){
      const p = toIso(u.x, u.y);
      mmX.fillStyle = u.team === PLAYER ? '#9cc4ff' : '#ff9a9a';
      mmX.fillRect(p.x * mmSX - 1, p.y * mmSY - 0.8, 2, 1.6);
    }
  }
  if(flags.shroudDirty) updateShroud();
  mmX.save();
  mmX.transform(T * mmSX, T / 2 * mmSY, -T * mmSX, T / 2 * mmSY, WPX * mmSX, 0);
  mmX.drawImage(shroudC, 0, 0);
  mmX.restore();
  mmX.strokeStyle = '#fff';
  mmX.lineWidth = 1;
  mmX.strokeRect(state.camX * mmSX, state.camY * mmSY, VW * mmSX, VH * mmSY);
  if(radarT < 1){   // shutters sliding open
    const h = MMH / 2 * (1 - radarT * radarT);
    mmX.fillStyle = '#10161e';
    mmX.fillRect(0, 0, MMW, h); mmX.fillRect(0, MMH - h, MMW, h);
  }
}
