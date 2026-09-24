"use strict";
/* =========================================================
   Terrain generator shared by the game and its paint workers
   (js/terrain-worker.js). Pure functions only, no DOM.

   Coordinates: tile (u, v) in [0, MW) x [0, MH); world px = tile * T;
   iso px (ix, iy): ix = wx - wy + WPX, iy = (wx + wy) / 2.
   ========================================================= */
const TerrainGen = (() => {
  const T = 32, MW = 64, MH = 64;        // keep in sync with the game constants
  const WPX = MW * T;

  // ---------- noise ----------
  function hash2(x, y){
    let h = (x * 374761393 + y * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  // the map's noise offset: every map (and every random seed) gets its own ground
  let SX = 0, SY = 0;
  function vnoise(x, y){
    x += SX; y += SY;
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y){ return vnoise(x, y) * 0.55 + vnoise(x * 2.1, y * 2.1) * 0.3 + vnoise(x * 4.3, y * 4.3) * 0.15; }

  let F = null;   // painter fields, rebuilt when the map changes

  // ---------- maps ----------
  // A map lays out a battlefield, in tiles: bases (the player's construction vehicle, the enemy's hub),
  // ore fields [x, y, radius, amount], the sea along some edges ('n', 'e', 's', 'w'), lakes, roads
  // ('x' roads run along game x at y = c, 'y' roads along game y), a town with its building lots, and
  // at most one plateau (ramps are angles from its centre). `trees` seeds the woods, `seed` the noise.
  const townLots = (x, y) => [[x - 4, y - 4], [x - 7, y - 4], [x + 2, y - 4], [x + 5, y - 4], [x - 4, y + 2], [x - 7, y + 2],
                              [x + 2, y + 2], [x + 5, y + 2], [x - 4, y + 5], [x + 2, y - 7]];
  const MAPS = {
    classic: {id: 'classic', name: 'Classic', seed: 1, trees: 777,
      bases: [{x: 9, y: 51}, {x: 52, y: 8}],
      ore: [[14, 47, 4, 500], [49, 16, 4, 500], [32, 32, 5, 650], [50, 50, 3, 450], [13, 13, 3, 450]],
      sea: {edges: 'wn', width: 4.5},
      lakes: [{x: 24, y: 12, r: 4.2}, {x: 40, y: 52, r: 4.6}],
      roads: [{axis: 'x', c: 40, from: 8, to: 44}, {axis: 'y', c: 23, from: 20, to: 61}],
      town: {x: 23, y: 40, lots: townLots(23, 40)},
      plateau: {x: 44, y: 29, r: 5.5, ramps: [Math.PI, Math.PI / 2]}},
    // two big lakes split the middle into three lanes; the town sits on the central crossroads
    twinlakes: {id: 'twinlakes', name: 'Twin Lakes', seed: 3, trees: 4242,
      bases: [{x: 9, y: 51}, {x: 52, y: 8}],
      ore: [[15, 46, 4, 500], [48, 17, 4, 500], [12, 12, 4, 700], [51, 51, 4, 700], [26, 44, 3, 450], [37, 19, 3, 450]],
      sea: null,
      lakes: [{x: 22, y: 23, r: 6.5}, {x: 41, y: 40, r: 6.5}],
      roads: [{axis: 'x', c: 32, from: 16, to: 48}, {axis: 'y', c: 32, from: 16, to: 48}],
      town: {x: 32, y: 32, lots: townLots(32, 32)},
      plateau: null},
    // bases in the north-west and south-east; a high plateau in the middle with rich ore on top, four ramps up
    highland: {id: 'highland', name: 'Highland Pass', seed: 5, trees: 9001,
      bases: [{x: 9, y: 9}, {x: 52, y: 51}],
      ore: [[15, 15, 4, 500], [48, 48, 4, 500], [32, 32, 3, 900], [12, 50, 4, 600], [51, 13, 4, 600]],
      sea: {edges: 's', width: 3.5},
      lakes: [{x: 20, y: 43, r: 3.4}, {x: 43, y: 20, r: 3.4}],
      roads: [{axis: 'x', c: 12, from: 6, to: 22}, {axis: 'x', c: 51, from: 41, to: 57}],
      town: null,
      plateau: {x: 32, y: 32, r: 8.5, ramps: [-3 * Math.PI / 4, Math.PI / 4, 3 * Math.PI / 4, -Math.PI / 4]}},
  };

  // Random map from a seed: bases in opposite corners, and everything else mirrored through the
  // centre so neither side is favoured: ore by each base, in the middle and on the flanks, lakes in
  // pairs, maybe a sea joining one edge by each base, maybe a plateau in the middle, maybe a town.
  function randomMap(seed){
    let s = (seed * 2654435761) >>> 0 || 1;
    const rnd = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const mirror = p => ({x: MW - 1 - p.x, y: MH - 1 - p.y});
    const CORNER = {sw: {x: 9, y: 51}, ne: {x: 52, y: 8}, nw: {x: 9, y: 9}, se: {x: 52, y: 51}};
    const pair = rnd() < 0.5 ? ['sw', 'ne'] : ['nw', 'se'];
    if(rnd() < 0.5) pair.reverse();
    const bases = pair.map(c => ({...CORNER[c]}));
    const far = (p, r) => bases.every(b => Math.hypot(p.x - b.x - 1, p.y - b.y - 1) > r);
    const m = {id: 'random', name: 'Random #' + seed, seed: 1000 + seed, trees: 777 + seed * 7919, bases,
               ore: [], sea: null, lakes: [], roads: [], town: null, plateau: null};
    // a sea along one edge by each base, the two edges meeting in a corner
    if(rnd() < 0.6){
      const opp = {n: 's', s: 'n', e: 'w', w: 'e'};
      const opts = [];
      for(const a of pair[0]) for(const b of pair[1]) if(a !== b && opp[a] !== b) opts.push(a + b);
      m.sea = {edges: opts[Math.floor(rnd() * opts.length)], width: 3.5 + rnd() * 1.5};
    }
    const awayFromTown = (p, d) => !m.town || Math.hypot(p.x - m.town.x, p.y - m.town.y) > d;
    const seaD = p => m.sea ? Math.min(...[...m.sea.edges].map(e => e === 'w' ? p.x : e === 'n' ? p.y : e === 'e' ? MW - 1 - p.x : MH - 1 - p.y)) : 99;
    // ore: a field by each base (towards the middle), one in the middle, a pair on the flanks
    for(const b of bases){
      const sx = Math.sign(32 - b.x), sy = Math.sign(32 - b.y);
      m.ore.push([b.x + 1 + sx * 6, b.y + 1 + sy * 5, 4, 500]);
    }
    if(rnd() < 0.45) m.plateau = {x: 32, y: 32, r: 6 + rnd() * 2.5, ramps: [0, 1, 2, 3].map(k => k * Math.PI / 2 + Math.PI / 4)};
    m.ore.push([32, 32, m.plateau ? 3 : 5, m.plateau ? 900 : 650]);
    // a town off to one side of the line between the bases, with two roads through it (placed before
    // the flank ore and lakes, which keep clear of it)
    if(rnd() < 0.8) for(let tries = 0; tries < 8 && !m.town; tries++){
      const side = rnd() < 0.5 ? 1 : -1, d = 15 + rnd() * 6;
      const dx = bases[1].x - bases[0].x, dy = bases[1].y - bases[0].y, l = Math.hypot(dx, dy);
      const t = {x: Math.round(32 - dy / l * d * side), y: Math.round(32 + dx / l * d * side)};
      const clear = m.ore.every(o => Math.hypot(o[0] - t.x, o[1] - t.y) > o[2] + 8) &&
                    far(t, 16) && seaD(t) > 12 && (!m.plateau || Math.hypot(t.x - 32, t.y - 32) > m.plateau.r + 9);
      if(clear){
        m.town = {x: t.x, y: t.y, lots: townLots(t.x, t.y)};
        m.roads.push({axis: 'x', c: t.y, from: Math.max(4, t.x - 14), to: Math.min(MW - 5, t.x + 14)},
                     {axis: 'y', c: t.x, from: Math.max(4, t.y - 14), to: Math.min(MH - 5, t.y + 14)});
      }
    }
    const spots = [];
    for(let tries = 0; tries < 200 && spots.length < 3; tries++){
      const p = {x: Math.round(6 + rnd() * (MW - 12)), y: Math.round(6 + rnd() * (MH - 12))};
      const q = mirror(p);
      const ok = pt => far(pt, 15) && Math.hypot(pt.x - 32, pt.y - 32) > (m.plateau ? m.plateau.r + 5 : 11) && seaD(pt) > 8 &&
                       spots.every(o => Math.hypot(o.x - pt.x, o.y - pt.y) > 11) && m.ore.every(o => Math.hypot(o[0] - pt.x, o[1] - pt.y) > 9) && awayFromTown(pt, 11);
      if(Math.hypot(p.x - q.x, p.y - q.y) > 14 && ok(p) && ok(q)) spots.push(p, q);
    }
    if(spots.length >= 2) m.ore.push([spots[0].x, spots[0].y, 3, 450], [spots[1].x, spots[1].y, 3, 450]);
    // lakes in mirrored pairs, clear of bases, ore, the middle and the sea
    for(let tries = 0; tries < 300 && m.lakes.length < 4; tries++){
      const r = 3.2 + rnd() * 2;
      const p = {x: 6 + rnd() * (MW - 12), y: 6 + rnd() * (MH - 12)}, q = mirror(p);
      const ok = pt => far(pt, 14 + r) && Math.hypot(pt.x - 32, pt.y - 32) > (m.plateau ? m.plateau.r + r + 4 : r + 8) && seaD(pt) > r + 5 &&
                       m.ore.every(o => Math.hypot(o[0] - pt.x, o[1] - pt.y) > o[2] + r + 3) &&
                       m.lakes.every(l => Math.hypot(l.x - pt.x, l.y - pt.y) > l.r + r + 5) && awayFromTown(pt, r + 9);
      if(Math.hypot(p.x - q.x, p.y - q.y) > 2 * r + 6 && ok(p) && ok(q)){ m.lakes.push({x: p.x, y: p.y, r}, {x: q.x, y: q.y, r}); if(rnd() < 0.5) break; }
    }
    return m;
  }

  let MAP = MAPS.classic, ROADS = MAP.roads, LAKES = MAP.lakes, PLATEAU = MAP.plateau;
  // make a map current (the game and each paint worker call this)
  function setMap(map){
    MAP = map; ROADS = map.roads; LAKES = map.lakes; PLATEAU = map.plateau;
    SX = map.seed === 1 ? 0 : (map.seed * 7919) % 10007; SY = map.seed === 1 ? 0 : (map.seed * 104729) % 10009;
    F = null;
  }
  // the map for a setup choice: a handmade one by name, or a random one from the seed
  const makeMap = (id, seed) => MAPS[id] || randomMap(seed);

  function roadHits(u, v){
    const hits = [];
    for(const R of ROADS){
      const along = R.axis === 'x' ? u : v, across = R.axis === 'x' ? v : u;
      if(along < R.from || along > R.to) continue;
      const d = Math.abs(across - R.c);
      if(d < 1.3) hits.push({d, along});
    }
    return hits;
  }
  function nearRoad(u, v){   // cheap pre-test for the per-pixel loop
    for(let i = 0; i < ROADS.length; i++){
      const R = ROADS[i];
      if(Math.abs((R.axis === 'x' ? v : u) - R.c) < 1.3) return true;
    }
    return false;
  }

  // lakes: > 0 is water, a thin band below 0 is the sandy shore
  // the sea: a band about sea.width tiles wide along the map's sea edges
  function seaVal(u, v){
    const S = MAP.sea;
    if(!S) return -9;
    let d = 99;
    for(const e of S.edges) d = Math.min(d, e === 'w' ? u : e === 'n' ? v : e === 'e' ? MW - u : MH - v);
    return (S.width - d) / 2 + (vnoise(u * 0.35 + 13, v * 0.35 + 17) - 0.5) * 0.8;
  }
  function lakeVal(u, v){
    let m = -9;
    for(const l of LAKES) m = Math.max(m, 1 - Math.hypot(u - l.x, v - l.y) / l.r);
    return Math.max(m + (vnoise(u * 0.45 + 7, v * 0.45 + 3) - 0.5) * 0.45, seaVal(u, v));
  }

  // plateau: a raised table of land with cliff sides, climbed by its ramps.
  // platVal > 0 is the top; elevation() is 0 on the ground, 1 on top, in between on ramps and cliff faces.
  const CLIFF_H = 26;                        // iso px from the ground to the top
  function platVal(u, v){
    if(!PLATEAU) return -9;
    return 1 - Math.hypot(u - PLATEAU.x, v - PLATEAU.y) / PLATEAU.r + (vnoise(u * 0.5 + 31, v * 0.5 + 47) - 0.5) * 0.25;
  }
  function onRamp(u, v){
    if(!PLATEAU) return false;
    const a = Math.atan2(v - PLATEAU.y, u - PLATEAU.x);
    return PLATEAU.ramps.some(r => Math.abs(Math.atan2(Math.sin(a - r), Math.cos(a - r))) < 0.3);
  }
  function elevation(u, v, p = platVal(u, v)){
    const [lo, hi] = onRamp(u, v) ? [-0.35, 0.15] : [-0.03, 0.03];   // a long ramp, or a sheer face
    return Math.min(1, Math.max(0, (p - lo) / (hi - lo)));
  }
  const nearPlateau = (u, v) => !!PLATEAU && Math.abs(u - PLATEAU.x) < PLATEAU.r + 3 && Math.abs(v - PLATEAU.y) < PLATEAU.r + 3;

  // ---------- painter ----------
  // Low-frequency fields (dirt, tone, relief, lakes) on a 1/4-tile grid.
  const FR = 4, GW = MW * FR + 2, GH = MH * FR + 2;
  function fields(){
    if(F) return F;
    F = {dirt: new Float32Array(GW * GH), tone: new Float32Array(GW * GH),
         rel: new Float32Array(GW * GH), lake: new Float32Array(GW * GH), plat: new Float32Array(GW * GH)};
    for(let j = 0; j < GH; j++)
      for(let i = 0; i < GW; i++){
        const u = i / FR, v = j / FR, k = j * GW + i;
        const big = fbm(u * 0.085, v * 0.085);
        const tone = vnoise(u * 0.6 + 11, v * 0.6 + 5);
        F.dirt[k] = Math.min(1, Math.max(0, (big + (tone - 0.5) * 0.14 - 0.57) / 0.1));
        F.tone[k] = tone;
        // relief lit from the east (+u), matching the sprites' key light
        F.rel[k] = (vnoise((u + 0.35) * 0.4, v * 0.4) - vnoise(u * 0.4, (v + 0.35) * 0.4)) * 1.3;
        F.lake[k] = lakeVal(u, v);
        F.plat[k] = platVal(u, v);
      }
    return F;
  }
  function sample(f, u, v){
    const x = u * FR, y = v * FR, xi = x | 0, yi = y | 0, xf = x - xi, yf = y - yi, k = yi * GW + xi;
    return (f[k] * (1 - xf) + f[k + 1] * xf) * (1 - yf) + (f[k + GW] * (1 - xf) + f[k + GW + 1] * xf) * yf;
  }
  const lerp = (a, b, t) => a + (b - a) * t;

  // Paint a w x h pixel block whose top-left is iso (ix0, iy0), at `scale`
  // pixels per iso px, into RGBA `d`. Texture detail is defined in iso px so
  // the look is the same at any scale, just sharper at higher ones.
  function paint(d, w, h, ix0, iy0, scale){
    const f = fields();
    for(let py = 0; py < h; py++)
      for(let px = 0; px < w; px++){
        const o = (py * w + px) * 4;
        d[o + 3] = 255;
        const ix = ix0 + (px + 0.5) / scale, iy = iy0 + (py + 0.5) / scale;
        const a = ix - WPX;
        let u = (iy + a * 0.5) / T, v = (iy - a * 0.5) / T;
        // near the plateau, march down the screen column to find the raised surface this pixel shows
        let face = 0, lift = 0, pTop = -9;
        if(nearPlateau(u, v) || nearPlateau(u + CLIFF_H / T, v + CLIFF_H / T)){
          for(let dy = CLIFF_H; dy >= 0; dy -= 1.5){
            const uu = (iy + dy + a * 0.5) / T, vv = (iy + dy - a * 0.5) / T;
            const p = sample(f.plat, Math.min(MW - 0.01, Math.max(0, uu)), Math.min(MH - 0.01, Math.max(0, vv)));
            const e = elevation(uu, vv, p);
            if(e * CLIFF_H >= dy - 0.01 && e > 0){
              u = uu; v = vv; lift = e; pTop = p;
              // a steep bit that isn't a ramp is rock
              if(e < 0.97 && !onRamp(uu, vv)) face = 1 + (Math.cos(Math.atan2(vv - PLATEAU.y, uu - PLATEAU.x)) + 1) * 0.3;
              break;
            }
          }
        }
        if(u < 0 || v < 0 || u >= MW || v >= MH){ d[o] = 4; d[o + 1] = 7; d[o + 2] = 13; continue; }
        const tone = sample(f.tone, u, v), dirt = sample(f.dirt, u, v);
        const grain = hash2(Math.floor(ix0 * scale) + px, Math.floor(iy0 * scale) + py);
        const blade = vnoise(ix * 0.5, iy * 1.0);         // short streaks, reads as grass
        const clump = vnoise(ix * 0.11, iy * 0.2);        // tufts and bare spots
        // grass
        let r = lerp(64, 102, tone), gg = lerp(92, 128, tone), b = lerp(40, 56, tone);
        const gs = 0.78 + blade * 0.3 + grain * 0.16 + (clump - 0.5) * 0.22;
        r *= gs; gg *= gs; b *= gs;
        // dirt
        if(dirt > 0){
          const ds = 0.88 + grain * 0.2;
          r = lerp(r, lerp(118, 140, tone) * ds, dirt);
          gg = lerp(gg, lerp(98, 118, tone) * ds, dirt);
          b = lerp(b, lerp(66, 80, tone) * ds, dirt);
        }
        let shade = 1 + sample(f.rel, u, v) * 0.22;
        // lakes and shores
        const lv = sample(f.lake, u, v);
        if(lv > 0){
          const depth = Math.min(1, lv / 0.35);
          const rip = 0.92 + vnoise(ix * 0.06, iy * 0.22) * 0.16 + grain * 0.03;
          r = lerp(70, 26, depth) * rip; gg = lerp(128, 72, depth) * rip; b = lerp(138, 108, depth) * rip;
          shade = 1;
          if(lv < 0.05){ const t = 1 - lv / 0.05; r = lerp(r, 170, t * 0.5); gg = lerp(gg, 190, t * 0.5); b = lerp(b, 185, t * 0.5); }
        } else if(lv > -0.16){
          const t = (lv + 0.16) / 0.16;                 // 0 at grass edge, 1 at waterline
          const sf = Math.min(1, t * 1.8);
          const wet = t > 0.7 ? (t - 0.7) / 0.3 * 0.25 : 0;
          r = lerp(r, 194 * (0.9 + grain * 0.14), sf) * (1 - wet);
          gg = lerp(gg, 174 * (0.9 + grain * 0.14), sf) * (1 - wet);
          b = lerp(b, 128 * (0.9 + grain * 0.14), sf) * (1 - wet);
        }
        // asphalt roads with kerbs, edge lines and a dashed centre line
        if(nearRoad(u, v)){
          const rh = roadHits(u, v);
          if(rh.length){
            let hh = rh[0], n = 0;
            for(const c of rh){ if(c.d < hh.d) hh = c; if(c.d < 1) n++; }
            const cross = n > 1;
            if(hh.d < 1){
              const k = 0.9 + grain * 0.12 + (blade - 0.5) * 0.05;
              r = 78 * k; gg = 78 * k; b = 80 * k;
              if(!cross && hh.d > 0.84 && hh.d < 0.9){ r = 196; gg = 196; b = 188; }
              if(!cross && hh.d < 0.035 && (hh.along * 1.4) % 1 < 0.55){ r = 214; gg = 180; b = 60; }
              shade = 1;
            } else if(hh.d < 1.22){
              const k = 0.92 + grain * 0.1;
              r = 158 * k; gg = 154 * k; b = 146 * k; shade = 1;
            }
          }
        }
        if(face){   // cliff face: layered dark rock, lit from the east, darker towards the foot
          const band = 0.8 + vnoise(ix * 0.12, iy * 0.7) * 0.35 + grain * 0.1;
          const foot = 0.7 + lift * 0.3;
          r = 92 * band * foot; gg = 82 * band * foot; b = 70 * band * foot; shade = face * 0.9;
        } else if(lift > 0.97){
          // the top: drier grass, a pale rim along the edge
          r = lerp(r, 150, 0.22); gg = lerp(gg, 138, 0.22); b = lerp(b, 92, 0.22);
          shade *= pTop < 0.06 && !onRamp(u, v) ? 1.25 : 1.05;
        } else if(nearPlateau(u, v)){
          // shadow pooled at the foot of the cliffs
          const p0 = sample(f.plat, u, v);
          if(p0 > -0.25 && p0 < 0 && !onRamp(u, v)) shade *= 0.72 + (-p0 / 0.25) * 0.28;
        }
        d[o] = r * shade; d[o + 1] = gg * shade; d[o + 2] = b * shade;
      }
  }

  return {T, MW, MH, hash2, vnoise, fbm, roadHits, nearRoad, seaVal, lakeVal, paint,
          MAPS, randomMap, makeMap, setMap, CLIFF_H, platVal, onRamp, elevation, nearPlateau,
          get map(){ return MAP; }, get PLATEAU(){ return PLATEAU; }};
})();
