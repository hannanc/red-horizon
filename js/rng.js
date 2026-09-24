// Red Horizon: seedable random numbers for everything the simulation decides (mulberry32).
// Drawing and sound may keep using Math.random; anything that changes the game uses rand().
let s = 1;

// start the sequence over from a seed (newWorld does this from the map seed)
export function seedRandom(seed){ s = (seed >>> 0) || 1; }

// a float in [0, 1)
export function rand(){
  s = (s + 0x6D2B79F5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// the generator's position, for saving a game and picking it up again
export function randState(){ return s; }
export function setRandState(v){ s = v | 0; }
