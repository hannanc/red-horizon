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
  function vnoise(x, y){
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y){ return vnoise(x, y) * 0.55 + vnoise(x * 2.1, y * 2.1) * 0.3 + vnoise(x * 4.3, y * 4.3) * 0.15; }

  // ---------- map features ----------
  // roads: 'x' roads run along game x at centre line y = c, 'y' roads along game y
  const ROADS = [{axis: 'x', c: 40, from: 3, to: 44}, {axis: 'y', c: 23, from: 20, to: 61}];
  const TOWN = {x: 23, y: 40};
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
  const LAKES = [{x: 24, y: 12, r: 4.2}, {x: 40, y: 52, r: 4.6}];
  function lakeVal(u, v){
    let m = -9;
    for(const l of LAKES) m = Math.max(m, 1 - Math.hypot(u - l.x, v - l.y) / l.r);
    return m + (vnoise(u * 0.45 + 7, v * 0.45 + 3) - 0.5) * 0.45;
  }

  // ---------- painter ----------
  // Low-frequency fields (dirt, tone, relief, lakes) on a 1/4-tile grid.
  const FR = 4, GW = MW * FR + 2, GH = MH * FR + 2;
  let F = null;
  function fields(){
    if(F) return F;
    F = {dirt: new Float32Array(GW * GH), tone: new Float32Array(GW * GH),
         rel: new Float32Array(GW * GH), lake: new Float32Array(GW * GH)};
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
        const u = (iy + a * 0.5) / T, v = (iy - a * 0.5) / T;
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
        d[o] = r * shade; d[o + 1] = gg * shade; d[o + 2] = b * shade;
      }
  }

  return {T, MW, MH, hash2, vnoise, fbm, ROADS, TOWN, roadHits, nearRoad, LAKES, lakeVal, paint};
})();
