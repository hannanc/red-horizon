"use strict";
/* =========================================================
   Sprite sheets rendered by tools/sprites/build_sprites.py.
   Each sheet may have a team mask; at load time we bake one
   tinted copy of the sheet per team colour.
   ========================================================= */
const Sprites = (() => {
  const data = {};      // name -> manifest entry
  const cameos = {};    // name -> manifest entry
  const baked = {};     // `${name}|${team}` -> canvas
  const bboxes = {};    // `${name}|${frame}` -> {x0,y0,x1,y1} opaque bounds within frame
  let teamColors = [];
  let ready = false;

  function loadImage(src){
    return new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error('failed to load ' + src));
      im.src = src;
    });
  }

  function hexRgb(h){
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // Replace masked pixels with the team colour, keeping the rendered shading.
  function tint(img, maskImg, rgb){
    const w = img.width, h = img.height;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d', {willReadFrequently: true});
    g.drawImage(img, 0, 0);
    if(!maskImg) return c;
    const base = g.getImageData(0, 0, w, h);
    const mc = document.createElement('canvas');
    mc.width = w; mc.height = h;
    const mg = mc.getContext('2d', {willReadFrequently: true});
    mg.drawImage(maskImg, 0, 0);
    const m = mg.getImageData(0, 0, w, h).data;
    const d = base.data;
    const tr = rgb[0] / 255, tg = rgb[1] / 255, tb = rgb[2] / 255;
    for(let i = 0; i < d.length; i += 4){
      const a = m[i + 3];
      if(!a) continue;
      const k = a / 255;
      const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      const hi = Math.max(0, lum - 0.72) * 1.4;           // keep specular glints
      const s = lum * 1.45;
      d[i]     = d[i]     * (1 - k) + Math.min(255, (tr * s + hi) * 255) * k;
      d[i + 1] = d[i + 1] * (1 - k) + Math.min(255, (tg * s + hi) * 255) * k;
      d[i + 2] = d[i + 2] * (1 - k) + Math.min(255, (tb * s + hi) * 255) * k;
    }
    g.putImageData(base, 0, 0);
    return c;
  }

  // Opaque (non-shadow) bounds of every frame, used for selection brackets.
  function measure(name, e, img){
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d', {willReadFrequently: true});
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, img.width, img.height).data;
    for(let f = 0; f < e.frames; f++){
      const ox = (f % e.cols) * e.fw, oy = Math.floor(f / e.cols) * e.fh;
      let x0 = e.fw, y0 = e.fh, x1 = -1, y1 = -1;
      for(let y = 0; y < e.fh; y++)
        for(let x = 0; x < e.fw; x++){
          const i = ((oy + y) * img.width + ox + x) * 4;
          // shadow pixels are pure black with partial alpha; skip them
          if(d[i + 3] > 200 && (d[i] + d[i + 1] + d[i + 2]) > 30){
            if(x < x0) x0 = x; if(x > x1) x1 = x;
            if(y < y0) y0 = y; if(y > y1) y1 = y;
          }
        }
      bboxes[name + '|' + f] = x1 >= 0 ? {x0, y0, x1, y1} : {x0: 0, y0: 0, x1: e.fw, y1: e.fh};
    }
  }

  async function load(colors){
    teamColors = colors.map(hexRgb);
    const man = await (await fetch('assets/sprites/manifest.json')).json();
    const jobs = [];
    for(const [name, e] of Object.entries(man.sprites)){
      data[name] = e;
      jobs.push((async () => {
        const img = await loadImage(e.img);
        const mask = e.mask ? await loadImage(e.mask) : null;
        if(e.kind === 'building' || (e.kind === 'vehicle' || e.kind === 'aircraft') && name.endsWith('_body')) measure(name, e, img);
        if(e.kind === 'infantry' && !name.endsWith('_die')) measure(name, e, img);
        if(mask) teamColors.forEach((rgb, t) => { baked[name + '|' + t] = tint(img, mask, rgb); });
        else baked[name + '|*'] = tint(img, null, null);
      })());
    }
    for(const [name, e] of Object.entries(man.cameos || {})){
      cameos[name] = e;
      jobs.push((async () => {
        const img = await loadImage(e.img);
        const mask = e.mask ? await loadImage(e.mask) : null;
        teamColors.forEach((rgb, t) => { baked['cameo:' + name + '|' + t] = tint(img, mask, rgb); });
      })());
    }
    await Promise.all(jobs);
    ready = true;
  }

  function sheet(name, team){ return baked[name + '|' + team] || baked[name + '|*'] || null; }

  // facing index for a world angle (radians, game convention)
  function facing(e, angle){
    const n = e.facings;
    const step = Math.PI * 2 / n;
    return ((Math.round(angle / step) % n) + n) % n;
  }

  // Draw frame f of a sheet with its anchor at iso (x, y). Sheets may be
  // rendered at `scale` texels per iso px; positions snap to device pixels.
  const api = {snap: 1};
  function draw(g, name, team, f, x, y, clipTop){
    const e = data[name];
    const s = sheet(name, team);
    if(!e || !s) return false;
    const k = 1 / (e.scale || 1), q = api.snap;
    const sx = (f % e.cols) * e.fw, sy = Math.floor(f / e.cols) * e.fh;
    const top = clipTop ? Math.floor(clipTop) : 0;   // build-up: hide the top rows (sheet px)
    const dx = Math.round((x - e.ax * k) * q) / q, dy = Math.round((y - e.ay * k) * q) / q;
    g.drawImage(s, sx, sy + top, e.fw, e.fh - top, dx, dy + top * k, e.fw * k, (e.fh - top) * k);
    return true;
  }

  // opaque bounds of a frame in iso px, relative to the sprite's anchor
  function bbox(name, f){
    const b = bboxes[name + '|' + f], e = data[name];
    if(!b || !e) return null;
    const k = 1 / (e.scale || 1);
    return {x0: (b.x0 - e.ax) * k, y0: (b.y0 - e.ay) * k, x1: (b.x1 - e.ax) * k, y1: (b.y1 - e.ay) * k};
  }

  Object.assign(api, {
    load, draw, facing, sheet, bbox,
    has: name => !!data[name] && !!sheet(name, 0),
    get: name => data[name],
    cameo: (name, team) => baked['cameo:' + name + '|' + team] || null,
  });
  Object.defineProperty(api, 'ready', {get: () => ready});
  return api;
})();
