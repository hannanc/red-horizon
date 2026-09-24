// Red Horizon: Constants, unit and building definitions, world state (map layers, entity lists, game state) and small helpers.

// ---------- constants ----------
export const T = 32;                 // world tile size (logic runs on a square grid)
export const MW = 64, MH = 64;       // map tiles
export const WPX = MW * T, HPX = MH * T;
export const IW = WPX * 2, IH = HPX; // iso-projected world size (diamond fits in IW x IH)
// UI scale: on large monitors running at 100% (DPR 1) blow the sidebar up so it
// stays readable on 4K; high-DPI screens already get crisp native-size UI.
export const UI = (window.devicePixelRatio || 1) < 1.5 ? (innerWidth >= 3000 ? 2 : innerWidth >= 2200 ? 1.5 : 1) : 1;
document.documentElement.style.setProperty('--ui', UI);
export const SIDEBAR_W = 264 * UI, TOPBAR_H = 30 * UI;
export const PLAYER = 0, ENEMY = 1, NEUTRAL = 2;
export const TEAM_COLOR   = ['#3b7dff', '#e04040', '#c8c0a8'];
export const TEAM_COLOR_D = ['#234a99', '#8c2626'];
export const FACTION = ['allied', 'soviet', 'civ'];   // sprite set per team; the skirmish setup can swap the first two
export const SIDE_NAME = {allied: 'Allied', soviet: 'Soviet'};

// world <-> iso screen projection (2:1 dimetric diamonds)
export function toIso(wx, wy){ return {x: wx - wy + WPX, y: (wx + wy) * 0.5}; }
export function toWorld(ix, iy){ const a = ix - WPX; return {x: iy + a * 0.5, y: iy - a * 0.5}; }
// height of the ground (iso px) at a world point: only the plateau is raised
export function groundZ(x, y){
  const P = TerrainGen.PLATEAU, u = x / T, v = y / T;
  if(!P) return 0;
  if(Math.abs(u - P.x) > P.r + 3 || Math.abs(v - P.y) > P.r + 3) return 0;
  return TerrainGen.elevation(u, v) * TerrainGen.CLIFF_H;
}
// iso position of something standing on the ground at (x, y), `z` px above it
export function isoAt(x, y, z = 0){ const p = toIso(x, y); p.y -= groundZ(x, y) + z; return p; }
// the world point under the screen: looks down the column for raised ground first
export function pickWorld(ix, iy){
  for(let dy = TerrainGen.CLIFF_H; dy > 0; dy -= 2){
    const w = toWorld(ix, iy + dy);
    if(groundZ(w.x, w.y) >= dy - 1) return w;
  }
  return toWorld(ix, iy);
}


// ---------- map state ----------
export const ore      = new Float32Array(MW * MH);
export const occ      = new Int16Array(MW * MH);   // building id, 0 = free, BLOCKED = water / trees / rocks
export const walk     = new Uint8Array(MW * MH);   // 1 = occupied by a flat building units can drive over (depot)
export const water    = new Uint8Array(MW * MH);   // 1 = sea or lake (also BLOCKED in occ unless a dockyard stands on it)
export const explored = new Uint8Array(MW * MH);
export const BLOCKED = -1;
export const idx = (x, y) => y * MW + x;
export const inMap = (x, y) => x >= 0 && y >= 0 && x < MW && y < MH;
export const passable = (x, y) => inMap(x, y) && (occ[idx(x, y)] === 0 || walk[idx(x, y)] === 1);
export const sailable = (x, y) => inMap(x, y) && water[idx(x, y)] === 1 && occ[idx(x, y)] === BLOCKED;   // open water
// what a tile goes back to when a building on it is gone
export const bareOcc = i => water[i] ? BLOCKED : 0;
// ships move on water, everything else on land
export const canMove = (u, x, y) => u.def.naval ? sailable(x, y) : passable(x, y);
export const doodads = [];                          // trees and rocks: {x, y, name, frame}
// redraw requests for the fog and the minimap background
export const flags = {shroudDirty: true, mmBaseDirty: true};

// noise, roads and lakes live in js/terrain.js (shared with the paint workers)
export const {hash2, vnoise, roadHits, lakeVal} = TerrainGen;
export const onRoad = (x, y) => roadHits(x + 0.5, y + 0.5).some(h => h.d < 1.2);


// ---------- entities ----------
export let nextId = 1;
export function newId(){ return nextId++; }
export function resetIds(){ nextId = 1; }
export function setNextId(n){ nextId = n; }
export const buildings = [];
// selected units / buildings: one shared array, replaced through setSelection()
export const selection = [];
export function setSelection(list){ selection.splice(0, selection.length, ...list); }
export const units = [];
export const projectiles = [];
export const effects = [];

// armor: inf | heavy | building | air (aircraft and jetpack troops) | sub: most weapons can't reach the last two
export const BUILD_DEFS = {
  conyard : {name:'Construction Hub',  cost:3000, power:0,    w:3, h:3, hp:1500, time:0,  tab:null, z:36},
  power   : {name:'Power Plant',       cost:800,  power:100,  w:2, h:2, hp:600,  time:10, tab:'structure', prereq:[], z:34},
  refinery: {name:'Ore Refinery',      cost:2000, power:-50,  w:3, h:3, hp:900,  time:18, tab:'structure', prereq:['power'], z:32},
  barracks: {name:'Barracks',          cost:500,  power:-10,  w:2, h:2, hp:700,  time:9,  tab:'structure', prereq:['power'], z:26},
  factory : {name:'Vehicle Factory',   cost:2000, power:-25,  w:3, h:3, hp:1100, time:18, tab:'structure', prereq:['refinery'], z:36},
  radar   : {name:'Radar',             cost:1000, power:-50,  w:2, h:2, hp:1000, time:12, tab:'structure', prereq:['refinery'], z:44, anim:true},
  civ     : {name:'Civilian Building', cost:0,    power:0,    w:2, h:2, hp:700,  time:0,  tab:null, z:30, garrison:5},
  pillbox : {name:'Pillbox',           cost:600,  power:-10,  w:1, h:1, hp:450,  time:8,  tab:'defense',   prereq:['barracks'], z:12,
             weapon:{dmg:11, rof:0.35, range:5.6, kind:'bullet', vs:{inf:1.6, heavy:0.35, building:0.4}}},
  beamtower:{name:'Beam Tower',        cost:1500, power:-75,  w:1, h:1, hp:600,  time:14, tab:'defense',   prereq:['barracks'], z:66, side:'allied',
             weapon:{dmg:110, rof:3.2, range:7.6, kind:'beam', vs:{inf:1.2, heavy:1, building:0.8}}},
  arctower: {name:'Arc Tower',         cost:1500, power:-75,  w:1, h:1, hp:600,  time:14, tab:'defense',   prereq:['barracks'], z:54, side:'soviet',
             weapon:{dmg:110, rof:3.2, range:7.2, kind:'arc', vs:{inf:1.4, heavy:1, building:0.8}}},
  // vehicles drive onto it (flat: its tiles stay passable) to be repaired; it also pulls out latched drones
  depot   : {name:'Service Depot',     cost:800,  power:-20,  w:3, h:3, hp:900,  time:12, tab:'structure', prereq:['factory'], z:12, flat:true},
  // built on water; ships come out of it
  shipyard: {name:'Dockyard',          cost:1000, power:-30,  w:3, h:3, hp:1200, time:14, tab:'structure', prereq:['refinery'], z:20, onWater:true},
  // jets land on its two pads to rearm; the helicopter is built here too
  airfield: {name:'Airfield',          cost:1200, power:-40,  w:3, h:3, hp:1000, time:15, tab:'structure', prereq:['radar'], z:30, side:'allied',
             pads: [[-0.62, 0.55], [0.55, -0.62]]},   // pad centres, tiles from the footprint centre
};
for(const k in BUILD_DEFS){ BUILD_DEFS[k].key = k; BUILD_DEFS[k].armor = 'building'; }

export const UNIT_DEFS = {
  rifle  : {name:'Rifleman',      cost:200,  hp:125, speed:58,  r:8,  armor:'inf',  time:4,  tab:'infantry', from:'barracks',
            deploy:true,   // D: dig in behind sandbags (deployWeapon, half damage taken)
            weapon:{dmg:9,  rof:0.55, range:4.6, kind:'bullet', vs:{inf:1.5, heavy:0.45, building:0.35}}},
  rocket : {name:'Rocket Soldier', cost:350,  hp:100, speed:52,  r:8,  armor:'inf',  time:6,  tab:'infantry', from:'barracks',
            weapon:{dmg:34, rof:1.9,  range:5.6, kind:'rocket', vs:{inf:0.6, heavy:1.6, building:1.6, air:1.2}}},
  ltank  : {name:'Warden Tank',   cost:700,  hp:320, speed:82,  r:13, armor:'heavy',time:8,  tab:'vehicle',  from:'factory',
            weapon:{dmg:42, rof:1.6,  range:5.2, kind:'shell', vs:{inf:0.8, heavy:1, building:1}}},
  htank  : {name:'Paladin Tank',  cost:1600, hp:820, speed:52,  r:15, armor:'heavy',time:16, tab:'vehicle',  from:'factory', prereq:['radar'],
            weapon:{dmg:105,rof:2.4,  range:5.8, kind:'shell', vs:{inf:0.9, heavy:1.25, building:1.15}}},
  harv   : {name:'Ore Hauler',    cost:1400, hp:650, speed:64,  r:14, armor:'heavy',time:12, tab:'vehicle',  from:'factory', harvester:true},
  mcv    : {name:'Construction Vehicle', cost:3000, hp:1000,speed:42,  r:17, armor:'heavy',time:25, tab:'vehicle',  from:'factory', prereq:['radar'], mcv:true},
  // engineers capture enemy structures or fully repair friendly ones, and are used up doing it
  engineer:{name:'Engineer',      cost:500,  hp:75,  speed:50,  r:8,  armor:'inf',  time:5,  tab:'infantry', from:'barracks', engineer:true},
  // allied only
  dog    : {name:'Hound',         cost:200,  hp:100, speed:112, r:7,  armor:'inf',  time:3,  tab:'infantry', from:'barracks', side:'allied',
            weapon:{dmg:200,rof:1.0,  range:1.0, kind:'bite', vs:{inf:1, heavy:0, building:0}}},
  sniper : {name:'Marksman',      cost:600,  hp:100, speed:50,  r:8,  armor:'inf',  time:7,  tab:'infantry', from:'barracks', side:'allied', prereq:['radar'],
            weapon:{dmg:125,rof:3.0,  range:9.5, kind:'snipe', vs:{inf:1, heavy:0, building:0}}},
  beamtank:{name:'Lancer Tank',   cost:1400, hp:300, speed:70,  r:14, armor:'heavy',time:13, tab:'vehicle',  from:'factory', side:'allied', prereq:['radar'],
            weapon:{dmg:75, rof:3.0,  range:7.5, kind:'beam', chain:2, vs:{inf:1, heavy:0.9, building:1.3}}},
  veiltank:{name:'Veil Tank',     cost:1000, hp:280, speed:80,  r:13, armor:'heavy',time:11, tab:'vehicle',  from:'factory', side:'allied', prereq:['radar'],
            treeDisguise:true,   // passes for a tree while parked; enemies don't pick it as a target until it fires
            weapon:{dmg:48, rof:2.0,  range:6,   kind:'rocket', vs:{inf:0.6, heavy:1.3, building:1}}},
  // soviet only
  arctrooper:{name:'Arc Trooper', cost:500,  hp:140, speed:44,  r:9,  armor:'inf',  time:7,  tab:'infantry', from:'barracks', side:'soviet',
            weapon:{dmg:45, rof:1.8,  range:4.2, kind:'arc', vs:{inf:1.3, heavy:1.3, building:0.8}}},
  launcher:{name:'Siege Launcher',cost:1000, hp:160, speed:56,  r:15, armor:'heavy',time:12, tab:'vehicle',  from:'factory', side:'soviet', prereq:['radar'],
            turret:false, scan:9,
            weapon:{dmg:220,rof:8.0,  range:14,  kind:'missile', splash:1.6, vs:{inf:1, heavy:0.8, building:1.5}}},
  // transports: infantry board with a right-click, unload with D (or by clicking the transport again)
  ifv    : {name:'Ranger IFV',    cost:700,  hp:220, speed:104, r:13, armor:'heavy',time:8,  tab:'vehicle',  from:'factory', side:'allied',
            transport:1, ifv:true,     // its weapon depends on who rides in it (IFV_WEAPONS)
            weapon:{dmg:30, rof:1.4,  range:6,   kind:'rocket', vs:{inf:0.5, heavy:1.3, building:0.6, air:1.5}}},
  halftrack:{name:'Bulwark Halftrack', cost:500, hp:200, speed:90, r:14, armor:'heavy',time:8, tab:'vehicle',  from:'factory', side:'soviet',
            transport:5,
            weapon:{dmg:20, rof:0.8,  range:5.5, kind:'flak', vs:{inf:1.3, heavy:0.5, building:0.4, air:1.8}}},
  drone  : {name:'Leech Drone',   cost:400,  hp:90,  speed:122, r:8,  armor:'heavy',time:5,  tab:'vehicle',  from:'factory', side:'soviet',
            turret:false, drain:45,   // damage per second once latched inside a vehicle
            weapon:{dmg:150,rof:1.0,  range:0.8, kind:'latch', vs:{inf:1, heavy:1, building:0}}},
  // special infantry
  sapper : {name:'Sapper',        cost:500,  hp:120, speed:55,  r:8,  armor:'inf',  time:6,  tab:'infantry', from:'barracks', side:'soviet',
            weapon:{dmg:420,rof:5.0,  range:0.8, kind:'charge', fuse:3.5, vs:{inf:0, heavy:1, building:1.8}}},   // timed charge
  striker: {name:'Striker',       cost:1500, hp:160, speed:64,  r:8,  armor:'inf',  time:14, tab:'infantry', from:'barracks', side:'allied', prereq:['radar'],
            unique:true,   // one at a time; shoots infantry dead, blows up buildings (demolish) but ignores vehicles
            weapon:{dmg:180,rof:1.0,  range:5.5, kind:'snipe', vs:{inf:1, heavy:0, building:0}},
            demolish:{dmg:5000,rof:3.0, range:0.8, kind:'charge', fuse:1.5, vs:{inf:0, heavy:0, building:1}}},
  psion  : {name:'Psion',         cost:1200, hp:100, speed:50,  r:8,  armor:'inf',  time:12, tab:'infantry', from:'barracks', side:'soviet', prereq:['radar'],
            weapon:{dmg:0,  rof:2.0,  range:6,   kind:'mind', vs:{inf:1, heavy:1, building:0}}},   // takes over one enemy unit
  isotope: {name:'Isotope Trooper', cost:700, hp:150, speed:46, r:9,  armor:'inf',  time:8,  tab:'infantry', from:'barracks', side:'soviet', prereq:['radar'],
            deploy:true, radiate:2.6,   // D: irradiates everything within `radiate` tiles while deployed
            weapon:{dmg:30, rof:1.2,  range:4.2, kind:'rad', vs:{inf:1.5, heavy:0.3, building:0}}},
  infiltrator:{name:'Infiltrator', cost:1000, hp:60, speed:60,  r:8,  armor:'inf',  time:8,  tab:'infantry', from:'barracks', side:'allied', prereq:['radar'],
            spy:true, disguise:true},   // enemies ignore it (hounds excepted); walks into enemy buildings
  blink  : {name:'Blink Trooper', cost:900,  hp:110, speed:50,  r:8,  armor:'inf',  time:9,  tab:'infantry', from:'barracks', side:'allied', prereq:['radar'],
            blink:true,   // teleports to where it is sent instead of walking
            weapon:{dmg:40, rof:1.5,  range:5,   kind:'beam', vs:{inf:1, heavy:0.8, building:0.6}}},
  // ships (naval: true) move only on open water and come out of a Dockyard
  lander : {name:'Landing Craft', cost:900,  hp:500, speed:70,  r:18, armor:'heavy',time:10, tab:'vehicle',  from:'shipyard',
            naval:true, turret:false, transport:5, carriesVehicles:true},   // loads and unloads at a shore
  frigate: {name:'Frigate',       cost:1000, hp:600, speed:70,  r:18, armor:'heavy',time:12, tab:'vehicle',  from:'shipyard', side:'allied',
            naval:true, weapon:{dmg:55, rof:2.2,  range:7,   kind:'shell', vs:{inf:0.8, heavy:1.1, building:1.1, sub:2.5}}},   // the sub hunter
  picket : {name:'Picket Cruiser', cost:1100, hp:650, speed:60, r:18, armor:'heavy',time:13, tab:'vehicle',  from:'shipyard', side:'allied', prereq:['radar'],
            naval:true, weapon:{dmg:40, rof:1.2,  range:8,   kind:'rocket', vs:{inf:0.2, heavy:0.4, building:0.2, air:2}}},
  sub    : {name:'Barracuda Sub', cost:1000, hp:550, speed:60,  r:16, armor:'sub',  time:12, tab:'vehicle',  from:'shipyard', side:'soviet',
            naval:true, turret:false,   // armour 'sub': only frigates can hurt it
            weapon:{dmg:110,rof:3.0,  range:6,   kind:'torpedo', seaOnly:true, vs:{heavy:1.4, building:1.2, sub:1}}},
  flakboat:{name:'Hornet Flak Boat', cost:700, hp:350, speed:110, r:14, armor:'heavy',time:8, tab:'vehicle',  from:'shipyard', side:'soviet',
            naval:true, weapon:{dmg:22, rof:0.7,  range:6,   kind:'flak', vs:{inf:1.2, heavy:0.4, building:0.3, air:1.6}}},
  // aircraft (air: true) fly straight over anything at altitude `alt` px and only take AA fire
  jet    : {name:'Talon Jet',     cost:1200, hp:180, speed:230, r:12, armor:'air',  time:12, tab:'vehicle',  from:'airfield', side:'allied',
            air:true, alt:64, turret:false, jet:true, ammo:1, rearm:8,   // one bomb run, then back to a pad
            weapon:{dmg:170,rof:0.3,  range:0.9, kind:'bomb', splash:1.3, vs:{inf:0.9, heavy:1.3, building:1.4}}},
  heli   : {name:'Shade Transport', cost:900, hp:360, speed:120, r:13, armor:'air',  time:10, tab:'vehicle',  from:'airfield', side:'allied',
            air:true, alt:52, turret:false, transport:5, stealth:true, lands:true},   // unseen by the enemy while flying
  airship: {name:'Tempest Airship', cost:2000, hp:1600, speed:22, r:22, armor:'air',  time:22, tab:'vehicle',  from:'factory', side:'soviet', prereq:['radar'],
            air:true, alt:74, turret:false, selfRepair:7, scan:5,
            weapon:{dmg:170,rof:2.6,  range:0.7, kind:'bomb', splash:1.4, vs:{inf:0.8, heavy:1, building:1.8}}},
  jetpack: {name:'Skytrooper',    cost:600,  hp:110, speed:74,  r:8,  armor:'air',  time:7,  tab:'infantry', from:'barracks', side:'allied', prereq:['airfield'],
            air:true, alt:22, turret:false, flyInf:true,
            weapon:{dmg:12, rof:0.45, range:4.4, kind:'bullet', vs:{inf:1.5, heavy:0.4, building:0.3}}},
};
for(const k in UNIT_DEFS) UNIT_DEFS[k].key = k;
UNIT_DEFS.rifle.deployWeapon = {...UNIT_DEFS.rifle.weapon, range: 6, rof: 0.45};
export const available = (def, team) => !def.side || def.side === FACTION[team];

// The IFV swaps its missile pod for its passenger's speciality. An engineer inside
// turns it into a field repair vehicle (no weapon, fixes nearby vehicles).
export const IFV_WEAPONS = {
  rifle:    {dmg:14,  rof:0.35, range:5.5, kind:'bullet', vs:{inf:1.6, heavy:0.35, building:0.4}},
  rocket:   {dmg:48,  rof:1.6,  range:6.5, kind:'rocket', vs:{inf:0.6, heavy:1.6, building:1.3, air:1.5}},
  sniper:   {dmg:125, rof:2.5,  range:10,  kind:'snipe',  vs:{inf:1, heavy:0, building:0}},
  engineer: null,
};
// the Soviet ore truck has a machine gun on a post behind the cab
export const TRUCK_GUN = {dmg:10, rof:0.5, range:4.5, kind:'bullet', vs:{inf:1.4, heavy:0.3, building:0.2}};
export function weaponOf(e){
  if(e.def.harvester) return e.fac === 'soviet' ? TRUCK_GUN : null;
  if(e.def.ifv && e.cargo && e.cargo.length){
    const k = e.cargo[0].def.key;
    if(k in IFV_WEAPONS) return IFV_WEAPONS[k];
  }
  if(e.deployed && e.def.deployWeapon) return e.def.deployWeapon;
  if(e.def.key === 'psion' && e.controlled && !e.controlled.dead) return null;   // busy holding a mind
  return e.def.weapon || null;
}
// unit-specific voice lines (null: no speech, just a sound)
UNIT_DEFS.engineer.voice = {select: ['Engineer reporting', 'Tools ready', 'Need something fixed?'],
                            move: ['On my way', 'Moving'], attack: ['I will take it over', 'Going in']};
UNIT_DEFS.sniper.voice = {select: ['Marksman ready', 'Eyes open', 'Scope clear'],
                          move: ['Relocating', 'Finding a perch'], attack: ['Target in sight', 'One shot']};
UNIT_DEFS.arctrooper.voice = {select: ['Fully charged', 'Arc trooper ready'],
                              move: ['Moving', 'Charging ahead'], attack: ['Discharging', 'Let it arc']};
UNIT_DEFS.launcher.voice = {select: ['Launcher ready', 'Missile loaded'],
                            move: ['Repositioning', 'Moving'], attack: ['Target locked', 'Missile away']};
UNIT_DEFS.beamtank.voice = {select: ['Lancer ready', 'Lens charged'],
                            move: ['Rolling', 'Moving out'], attack: ['Focusing beam', 'Target acquired']};
UNIT_DEFS.jet.voice = {select: ['Talon ready', 'Wings level'], move: ['Vector set', 'Heading out'], attack: ['Starting my run', 'Marking the target']};
UNIT_DEFS.heli.voice = {select: ['Rotors turning', 'Transport ready'], move: ['Lifting off', 'En route']};
UNIT_DEFS.airship.voice = {select: ['Airship holding altitude', 'Engines steady'], move: ['Adjusting course', 'Slow and steady'],
                           attack: ['Payload armed', 'Target below']};
UNIT_DEFS.jetpack.voice = {select: ['Skytrooper ready', 'Fuel topped off'], move: ['Taking to the air', 'Flying'],
                           attack: ['Strafing', 'Engaging from above']};
UNIT_DEFS.sapper.voice = {select: ['Charges ready', 'Sapper here'], move: ['Moving', 'Quietly now'], attack: ['Setting the fuse', 'Stand clear']};
UNIT_DEFS.striker.voice = {select: ['Striker ready', 'Point me at them'], move: ['On the move', 'Going'], attack: ['Clean shot', 'This one is mine']};
UNIT_DEFS.psion.voice = {select: ['I hear your thoughts', 'Psion listening'], move: ['I drift', 'As you wish'], attack: ['Your will is mine', 'Kneel']};
UNIT_DEFS.isotope.voice = {select: ['Isotope ready', 'Counter is clicking'], move: ['Moving the hot zone', 'Moving'], attack: ['Glow for me', 'Exposure started']};
UNIT_DEFS.infiltrator.voice = {select: ['Papers in order', 'Nobody saw me'], move: ['Blending in', 'On my way'], attack: ['Going inside', 'Leave it to me']};
UNIT_DEFS.blink.voice = {select: ['Blink trooper ready', 'Coordinates?'], move: ['Jumping', 'See you there'], attack: ['Phasing in', 'Engaging']};
UNIT_DEFS.veiltank.voice = {select: ['Veil ready', 'Nobody sees us'], move: ['Moving quietly', 'Changing cover'], attack: ['Dropping the veil', 'Firing']};
UNIT_DEFS.lander.voice = {select: ['Landing craft ready', 'Ramp is up'], move: ['Under way', 'Making for shore']};
UNIT_DEFS.frigate.voice = {select: ['Frigate on station', 'Guns ready'], move: ['Full ahead', 'Changing heading'], attack: ['Fire for effect', 'Engaging']};
UNIT_DEFS.picket.voice = {select: ['Picket cruiser watching the skies', 'Radar sweeping'], move: ['Under way', 'Aye'], attack: ['Missiles away', 'Tracking']};
UNIT_DEFS.sub.voice = {select: ['Running silent', 'Barracuda here'], move: ['Diving', 'Moving under'], attack: ['Torpedo in the water', 'Firing tubes']};
UNIT_DEFS.flakboat.voice = {select: ['Hornet ready', 'Flak loaded'], move: ['Full throttle', 'Moving'], attack: ['Filling the sky', 'Open fire']};
UNIT_DEFS.dog.voice = null;
UNIT_DEFS.drone.voice = null;

// enemy flavor names (same stats, soviet skin)
export const SOV_NAME = {rifle:'Trooper', rocket:'AT Trooper', ltank:'Bison Tank', htank:'Ironclad Tank', harv:'Ore Truck',
                  radar:'Radar Tower', pillbox:'Gun Nest', power:'Dynamo Plant', depot:'Repair Bay', shipyard:'Sea Works'};

export function dispName(def, team){ return FACTION[team] === 'soviet' && SOV_NAME[def.key] ? SOV_NAME[def.key] : def.name; }

// ---------- helpers ----------
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const angDiff = (a, b) => {
  let d = (b - a) % (Math.PI * 2);
  if(d > Math.PI) d -= Math.PI * 2; else if(d < -Math.PI) d += Math.PI * 2;
  return d;
};
export const turnToward = (a, b, max) => { const d = angDiff(a, b); return a + (d > max ? max : d < -max ? -max : d); };
export const hasTurret = def => def.armor !== 'inf' && !def.harvester && !def.mcv && !def.engineer && def.turret !== false;
// foot soldiers, including the ones with jetpacks
export const isInf = def => def.armor === 'inf' || !!def.flyInf;
// damage multiplier of a weapon against an armor class (0 = can't hurt it at all); only listed weapons reach aircraft
export const vsMult = (vs, armor) => vs && vs[armor] != null ? vs[armor] : (armor === 'air' || armor === 'sub') && vs ? 0 : 1;

// latched drones are inside their victim: not on the map as far as anyone else is concerned
export const onMap = u => !u.dead && !u.latched && !u.inside;
// sprite sheet prefix: units keep the look of the side that built them, captured buildings too
export const uName = u => u.def.key + '_' + u.fac;
export function tileOf(e){ return {x: Math.floor(e.x / T), y: Math.floor(e.y / T)}; }
export function clamp(v, a, b){ return v < a ? a : v > b ? b : v; }

// skirmish setup: side, starting credits and map seed, remembered between games
export const setup = {side: 'allied', credits: 8000, map: 'classic', seed: 1};
try { Object.assign(setup, JSON.parse(localStorage.getItem('rh-setup') || '{}')); } catch(e){}
if(!SIDE_NAME[setup.side]) setup.side = 'allied';
if(![5000, 8000, 12000].includes(setup.credits)) setup.credits = 8000;
if(!TerrainGen.MAPS[setup.map] && setup.map !== 'random') setup.map = 'classic';
setup.seed = clamp(Math.floor(setup.seed) || 1, 1, 99999);


// ---------- economy / production ----------
export const state = {
  credits: [8000, 12000],
  camX: 0, camY: 0,      // camera in iso space
  time: 0, started: false, over: false,
  placing: null,
  mode: null,          // 'sell' | 'repair' | null
  lowPower: false,
  blackout: [0, 0, 0],   // power sabotaged until this time, per team
  attackAlertT: -99, chargeMsgT: -99,   // when the 'under attack' and 'charge planted' warnings were last given
  menu: false,           // the pause menu is open
  sndOn: true, voiceOn: true,
};

// player settings from the pause menu: sound and voice volume (0-1), scroll speed (x)
export const settings = {sfx: 0.8, voice: 0.9, scroll: 1};
try { Object.assign(settings, JSON.parse(localStorage.getItem('rh-settings') || '{}')); } catch(e){}
export function saveSettings(){ try { localStorage.setItem('rh-settings', JSON.stringify(settings)); } catch(e){} }
