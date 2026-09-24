// Red Horizon: A* over the tile grid, free-tile search and move orders.
import {HPX, MH, MW, T, WPX, clamp, idx, inMap, passable, sailable, tileOf} from './data.js';

export function freeTileNear(tx, ty, maxR, pass = passable){
  for(let r = 0; r <= maxR; r++)
    for(let dy = -r; dy <= r; dy++)
      for(let dx = -r; dx <= r; dx++){
        if(Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = tx + dx, y = ty + dy;
        if(pass(x, y)) return {x, y};
      }
  return null;
}

// ---------- A* pathfinding ----------
export const pfG = new Float32Array(MW * MH);
export const pfFrom = new Int32Array(MW * MH);
export const pfClosed = new Uint8Array(MW * MH);
export function findPath(sx, sy, txx, tyy, pass = passable){
  if(!inMap(sx, sy)) return null;
  if(!pass(txx, tyy)){
    const f = freeTileNear(txx, tyy, 6, pass);
    if(!f) return null;
    txx = f.x; tyy = f.y;
  }
  pfClosed.fill(0); pfFrom.fill(-1);
  const open = [];
  const push = (f, i) => { open.push([f, i]); let c = open.length - 1;
    while(c > 0){ const p = (c - 1) >> 1; if(open[p][0] <= open[c][0]) break; [open[p], open[c]] = [open[c], open[p]]; c = p; } };
  const pop = () => { const top = open[0]; const last = open.pop();
    if(open.length){ open[0] = last; let c = 0;
      while(true){ let l = c * 2 + 1, r = l + 1, m = c;
        if(l < open.length && open[l][0] < open[m][0]) m = l;
        if(r < open.length && open[r][0] < open[m][0]) m = r;
        if(m === c) break; [open[m], open[c]] = [open[c], open[m]]; c = m; } }
    return top; };
  const si = idx(sx, sy), ti = idx(txx, tyy);
  pfG[si] = 0;
  push(Math.hypot(txx - sx, tyy - sy), si);
  const DIRS = [[1,0,1],[-1,0,1],[0,1,1],[0,-1,1],[1,1,1.41],[1,-1,1.41],[-1,1,1.41],[-1,-1,1.41]];
  let expansions = 0;
  while(open.length && expansions++ < 4000){
    const [, ci] = pop();
    if(pfClosed[ci]) continue;
    pfClosed[ci] = 1;
    if(ci === ti) break;
    const cxT = ci % MW, cyT = (ci / MW) | 0;
    for(const [dx, dy, c] of DIRS){
      const nx = cxT + dx, ny = cyT + dy;
      if(!pass(nx, ny)) continue;
      if(dx && dy && (!pass(cxT + dx, cyT) || !pass(cxT, cyT + dy))) continue;
      const ni = idx(nx, ny);
      if(pfClosed[ni]) continue;
      const g = pfG[ci] + c;
      if(pfFrom[ni] === -1 || g < pfG[ni]){
        pfG[ni] = g; pfFrom[ni] = ci;
        push(g + Math.hypot(txx - nx, tyy - ny), ni);
      }
    }
  }
  if(!pfClosed[ti]) return null;
  const path = [];
  let cur = ti;
  while(cur !== si && cur !== -1){
    path.push({x: (cur % MW) * T + T / 2, y: ((cur / MW) | 0) * T + T / 2});
    cur = pfFrom[cur];
  }
  path.reverse();
  return path.length ? path : null;
}

export function orderMove(u, wx, wy){
  if(u.def.air || u.def.blink){   // aircraft fly straight to the spot, blink troopers jump there
    u.path = [{x: clamp(wx, T / 2, WPX - T / 2), y: clamp(wy, T / 2, HPX - T / 2)}]; u.pathI = 0;
    return;
  }
  const t = tileOf(u);
  const pass = u.def.naval ? sailable : passable;
  u.path = findPath(t.x, t.y, Math.floor(wx / T), Math.floor(wy / T), pass);
  u.pathI = 0;
  if(u.path && pass(Math.floor(wx / T), Math.floor(wy / T))) u.path.push({x: wx, y: wy});
}
