# Red Horizon: notes for Claude

A classic 2.5D isometric RTS in the browser. There is no build step: plain HTML,
JS (ES modules) and pre-rendered sprite sheets. The README covers controls and the unit list.
This file covers how the code works, the rules, and what to build next.

## Rules

- **Never use names, terms or voice lines from Red Alert 2, Command & Conquer,
  or any other commercial game.** The repo will go public. Every unit, building
  and weapon gets an original name, such as "Lancer Tank" rather than
  "Prism Tank". The same applies to code identifiers, file names, comments and
  commit messages. "Allied" and "Soviet" are fine because they are historical terms.
- The original game is only a reference for *feel*: gameplay, the isometric look
  and sidebar UX. Don't copy its assets or text.
- Keep the style of the surrounding code: plain functions in the ES modules under `js/`,
  terse comments, and no frameworks or build tools.
- Anything the simulation decides at random uses `rand()` from `js/rng.js`, never `Math.random()`,
  so a seed replays the same game. Drawing and sound may use `Math.random()`.

## Layout

| Path | What |
| --- | --- |
| `index.html` | HUD markup and CSS; loads `js/terrain.js`, `js/sprites.js` (classic scripts) and `js/main.js` (module) |
| `js/data.js` | Constants, `BUILD_DEFS` / `UNIT_DEFS`, world state (map layers, `units`, `buildings`, `effects`, `state`, `selection`, `setup`) and small helpers (`dist`, `clamp`, `isoAt`, `groundZ`, `weaponOf`, ...) |
| `js/rng.js` | `rand()`, the seedable random numbers the simulation uses (`seedRandom`, `randState`) |
| `js/pathfinding.js` | A* (`findPath`), `freeTileNear`, `orderMove` |
| `js/combat.js` | `weaponFor` / `canHurt`, damage and death, `fireWeapon`, `combatStep`, projectiles, splash |
| `js/units.js` | Building placement, `spawnUnit`, production, harvesters, `updateUnit` and every unit behaviour (aircraft, transports, engineers, garrisons, specialists, depot) |
| `js/ai.js` | `DIFFICULTY`, the `ai` state and `tickAI` with its helpers |
| `js/render.js` | Canvas, zoom and camera size, terrain chunks and workers, sprite and fallback drawing, effects, `draw()`, the minimap |
| `js/sound.js` | Synthesised sound effects: `SOUNDS`, `sfx(type, at, size)`, the mixing bus, `renderSfx()` for tests |
| `js/ui.js` | Speech, announcer, sidebar, mouse and keyboard input (`initUI`), `issueCommand`, sell/repair, the HUD |
| `js/save.js` | Save and load: `pack` / `unpack` (object graph to JSON), `snapshot()` / `restore()`, localStorage slots |
| `js/main.js` | Map setup, `tick()` and the fixed-step `loop()`, `newWorld()`, the start screen, `window.__RH` |
| `js/sprites.js` | `Sprites`: loads `assets/sprites/manifest.json`, tints team colour, and has draw, facing and bbox helpers |
| `js/terrain.js`, `js/terrain-worker.js` | Procedural ground painting (noise, roads, lakes), run in a worker pool |
| `tools/serve.py` | No-cache dev server: `python3 tools/serve.py 8347`, then open http://localhost:8347 |
| `tools/sprites/` | Blender pipeline: `rh_lib.py` (scene, camera, shapes), `rh_models.py` (models), `build_sprites.py` (what to render) |
| `assets/sprites`, `assets/cameos` | Rendered sheets and sidebar pictures, committed to git |

## How the game works (`js/`)

- **Modules:** each file exports its top-level functions and constants and imports what it uses; the import
  graph has cycles, which is fine for functions. Top-level code in a module may only touch its own and
  `data.js`'s bindings (listeners that need the canvas are registered in `initUI()`, called by `main.js`).
  A module can't assign another module's `let`, so shared mutable state lives in objects (`state`, `flags`, `ai`,
  `setup`), in arrays changed in place (`selection` via `setSelection`), or behind a function (`newId()`).
- **Time:** `loop()` runs `tick(STEP)` in fixed steps of `STEP = 1/30` s from an accumulator and redraws every frame.
  `__RH.step(seconds)` runs `round(seconds / STEP)` steps. `newWorld()` reseeds `rand()` from the map seed, so a
  seed plus the same inputs gives the same game.

- **World:** 64x64 tiles, `T = 32` world px per tile. Logic runs on the square
  grid. `toIso` / `toWorld` convert to 2:1 isometric screen space.
  `occ[]` holds the building id on each tile, 0 for free, or `BLOCKED` for
  water, trees and rocks. `walk[]` marks tiles of flat buildings (`def.flat`, the depot) that
  units may drive over; always test movement with `passable()`, placement with `occ`.
  `water[]` marks sea and lake tiles (they are `BLOCKED` in `occ` unless a Dockyard stands on them); ships move where
  `sailable()` is true. `canMove(u, x, y)` picks the right test, `findPath` and `freeTileNear` take one as an argument,
  and `bareOcc(i)` is what a tile reverts to when a building on it goes.
  The sea is a band along the west and north edges (`TerrainGen.seaVal` in `js/terrain.js`, folded into `lakeVal`).
- **Height:** one plateau (`TerrainGen.PLATEAU`, `elevation(u, v)` 0..1, `CLIFF_H` iso px). The painter raycasts each
  screen column to draw its raised top and rock faces. Cliff tiles are `BLOCKED` (set in `setupScenery`); the ramps
  (`onRamp`) are open. `groundZ(x, y)` gives the height at a world point: draw anything standing on the ground with
  `isoAt(x, y, z)` instead of `toIso`, and map the mouse with `pickWorld()`. Nothing is built on it (`canPlace`), and
  `highGround()` adds a tile of range when shooting down.
- **Teams:** `PLAYER = 0`, `ENEMY = 1` (the AI), `NEUTRAL = 2` (civilian town). `FACTION[team]` is the side
  (`'allied'` / `'soviet'`) and picks the sprite set; the player is Allied unless the setup screen says otherwise.
  Use `FACTION[...]` and `SIDE_NAME`, not hard-coded side names, in anything that depends on who plays what.
- **Skirmish setup** (`setup = {side, credits, map, seed}`, saved in localStorage): `newWorld()` clears every world
  array, sets `FACTION`, the AI's queue (`AI_QUEUE`, `AI_SHIPS`), makes the map current and runs `setupMap()`. It runs
  at load, and again at start if the settings changed. Playing Soviet also turns the sidebar red (`body.soviet`).
- **Maps** (`js/terrain.js`): a map object lists `bases` (player vehicle, enemy hub), `ore` fields, `sea` edges,
  `lakes`, `roads`, a `town` with its lots, an optional `plateau` with `ramps`, and seeds for noise and trees.
  `TerrainGen.MAPS` holds the handmade ones (classic, twinlakes, highland); `randomMap(seed)` builds one with bases in
  opposite corners, a matching ore field by each, a middle field, mirrored flank ore and lakes, and often a town (placed
  before the flank ore and lakes, which keep clear of it). `makeMap(id, seed)` picks; `setMap(map)` makes it
  current, in the game and in each paint worker (the map rides along with every chunk request). Everything in the
  game reads the current map through `TerrainGen.map` (setupMap, scenery, the AI's idea of where the player lives).
  Random trees could wall a base in, so `setupMap()` calls `openWay()`, which cuts a lane through the woods between
  the bases when no path joins them. A new map must pass `tests/maps.spec.js`.
- **Definitions:**
  - `BUILD_DEFS` and `UNIT_DEFS` hold stats, cost, build time, sidebar tab, prerequisites and weapon.
  - `side: 'allied' | 'soviet'` makes a unit exclusive to one side (`available()`).
  - `TAB_ITEMS` sets the sidebar order.
  - `SOV_NAME` gives Soviet display names for shared units.
- **Weapons:** `{dmg, rof, range (tiles), kind, vs: {inf, heavy, building, air}}`.
  - `vs` of 0 means the weapon can't hurt that armour class; targeting skips such targets.
  - A missing `vs.air` means 0 (`vsMult`): only weapons that list `air` (rockets, flak, IFV missiles) can hit aircraft.
  - Always read a unit's weapon through `weaponOf(e)`, because the IFV swaps weapons with its passenger.
  - Kinds are handled in `fireWeapon()`: `bullet`, `shell`, `rocket`, `flak` (projectiles), `beam` (with `chain`), `arc`, `snipe` (instant hit), `bite` (melee), `latch` (drone), `missile` (lobbed, with `splash`) and `bomb` (dropped from altitude, with `splash`).
- **Units:**
  - `spawnUnit` builds the unit object; `updateUnit` dispatches on its state.
  - Special cases go through their own update functions: `inside` (riding a transport), `latched` (a drone inside a vehicle), `order.type === 'board'`, harvester, engineer.
  - `onMap(u)` is false for riders and latched drones. Use it whenever you look for targets, selectable units or units to draw.
  - `u.fac` is the sprite faction. Captured buildings keep their original `b.fac` and only change `team`.
  - Use `isInf(def)` for "is a foot soldier": it covers jetpack troops, whose armour is `air`.
- **Aircraft** (`def.air`):
  - `u.z` is the altitude in px (`def.alt` when flying). `orderMove` gives them a single straight waypoint and `followPath` ignores `occ`; ground and air units don't push each other.
  - Drawn in their own pass after all ground entities: shadow at `toIso(x, y)`, sprite shifted up by `z`. `pickEntity`, `screenBox` and box-select account for `z`.
  - Jets (`def.jet`, `updateJet`): parked on an Airfield pad (`u.pad = {b, i}`, `padPos`, `freePad`), one bomb run per `def.ammo`, then back to a pad to rearm for `def.rearm` seconds. With no pad they circle.
  - The helicopter (`def.lands`, `updateHeli`) lands whenever it's idle. Infantry board it only on the ground; `unloadTransport` makes it land first.
  - The airship has `selfRepair` (hp/s). The AI builds one every few minutes (`airshipDue`) outside its army cap.
- **Garrisons**: town buildings (`def.garrison`, capacity 5) have a `cargo` array like transports, so `canBoard`,
  `updateBoarding` (`atDoor`), `unloadTransport` and the `D` key work on both (`capacity(t)`). A garrisoned building takes
  its occupants' team and `garrisonFire()` shoots each occupant's weapon from it; emptied or destroyed, it goes back to
  `NEUTRAL` and survivors walk out. Garrisons don't count for placement range, the win check, engineers or sell/repair.
  The AI (`aiInfantry`) garrisons empty buildings near a fight.
- **Special infantry**:
  - `weaponFor(e, target)` picks a unit's weapon for a particular target (`def.demolish` for the Striker vs buildings); `canHurt`, `combatStep` and `fireWeapon` use it. Scans skip buildings for units with `demolish`.
  - `charge` weapons (Sapper, Striker) add a `charge` effect that follows its target and detonates in `tick()` after `fuse` s.
  - Weapons with range 1 tile or less measure to a building's footprint edge in `combatStep`.
  - Psion (`mind` weapon): `mindControl` switches a unit's `team` (`origTeam`, `mindOwner`); `releaseMind` on the psion's death. It holds one unit at a time (`weaponOf` returns null while it does).
  - Isotope Trooper: `rad` shots leave `radPuddles`; deployed (`def.radiate`) it is a radiation source too. `tickRadiation` damages with `RAD_VS`.
  - Infiltrator (`def.spy`, `def.disguise`): ignored by enemy targeting except hounds (`fooledBy`); walks in like an engineer (`updateEngineer` → `spyEnter`). Power sabotage sets `state.blackout[team]`, which `powerOf` honours.
  - Blink Trooper (`def.blink`): `orderMove` gives it a straight waypoint and `followPath` hands off to `blinkStep`, which charges and jumps.
- **Naval** (`def.naval`): ships path on water only and don't push land units. Armour `sub` (like `air`) takes damage
  only from weapons that list it (the Frigate). `seaOnly` weapons (torpedoes) only hit ships and `onWater` buildings,
  and melee weapons can't reach ships. The Landing Craft (`carriesVehicles`) boards any ground unit from the shore
  (`atDoor`); `unloadTransport` refuses without a beach within 2 tiles. The Dockyard (`onWater`) must be placed on open
  water. AI: a dockyard in its base, `navyDue()` for a few ships outside the army cap, `aiNavy()` sends idle ships at the
  player's ships and dockyards; ships never join land waves.
- **Harvesters**: the Soviet ore truck has `TRUCK_GUN` (`weaponOf` returns it by `u.fac`; `truckGun()` fires it from
  `updateHarvester` without interrupting the job). The Allied hauler returns with `haulerJump()` instead of driving.
- **Explosions**: `boom` effects draw the `explosion` sheet (8 frames) scaled to the blast when it exists, else the
  procedural fireball.
- **Veil Tank** (`def.treeDisguise`): `fooledBy` keeps enemy scans off it until it has fired in the last 3 s;
  `treeDisguised(u)` (parked for 1 s and quiet) draws it as a tree from the `tree` sheet.
- **Sandbags**: units with `def.deploy` (the rifleman) toggle `u.deployed` with `D`: `weaponOf` returns `def.deployWeapon`,
  `applyDamage` halves damage, they don't chase targets, and any move or board order undeploys them. AI troopers at home dig in.
- **Service Depot** (`def.flat`): drawn before everything else so vehicles sit on it. `serviceDepot()` repairs the most
  damaged stopped vehicle on its footprint (`onFootprint`) for credits and kills drones latched inside parked vehicles.
  The enemy base starts with one, and `aiRepairs()` sends damaged idle AI vehicles to it.
- **Stealth** (`def.stealth`): `stealthTick` sets `u.revealed` when an enemy is within about 2.5 tiles, the unit fired in the last 3 s, or (helicopter) it has landed. `hiddenFrom(u, team)` hides it from targeting, picking, drawing and the minimap.
- **Orders:** the `order.type` values are `idle`, `move`, `attack`, `attackmove`, `capture` (engineer), `board` and `patrol`.
  - Patrol (`P`, `patrolSelected` → `orderPatrol`): `{pts, i}` from `patrolRoute(team)`, eight points 3 tiles round the team's
    buildings. A threat within `PATROL_LEASH` tiles of the current point becomes `{type:'attack', patrol, leash}`, which breaks
    off (`resumePatrol`) when the target goes or the unit strays past the leash. Not for aircraft, ships or the utility units (`canPatrol`).
    `P` on a selected Barracks or Factory sets `b.rally = {patrol: true}`: `deliverUnit` puts what it makes straight on patrol,
    and `draw()` shows the loop instead of a flag.
    The AI keeps `diff.patrol` home defenders (none on Easy, 2 on Normal, 3 on Hard; at most half of those at home) on patrol (`aiPatrol`); damaged ones stop
    so `aiRepairs` can take them to the depot, and attack waves take patrollers along. The route only covers buildings
    within 18 tiles of the hub.
  - Right-click handling is in `issueCommand()`. The context cursor comes from `cursorType()` and is drawn by `drawCursor()`.
- **AI** (`tickAI`): one production queue (`ai.prodQ`), attack waves on a timer, and `aiTransports()` to fill and unload halftracks.
  `DIFFICULTY[key]` (picked on the start screen, applied by `setDifficulty()`, read through `diff`) scales starting credits,
  income, first-wave time, wave gap, wave size, army cap, base patrols (`patrol`), and base building (`build` speed, `towers`, `expand`, `navy`, `repairAt`).
  - It starts from a Construction Hub and a few units, like the player, and builds its own base (`aiBase`):
    `aiNextBuilding()` walks a plan (power, refinery, barracks, factory, power, radar, a second refinery, then towers,
    depot, dockyard, more refineries and towers), puts power first whenever the next building would overdraw, and
    rebuilds anything lost (the counts drop). The first `CORE` entries come first; the rest wait for spare money or a
    decent army, so units keep coming.
  - `aiSpot(key)` picks the tile: compact round the hub, towers towards the player (`playerHome`) and spread out,
    refineries by free ore on its side of the map (`aiOreTargets`, creeping with a power plant when it's too far), the
    dockyard on water. Every spot keeps a one-tile gap round other buildings, leaves the rows in front of doors clear
    (`inYard`) and is only used if every factory, barracks and refinery door can still path to the map centre
    (`doorsStayOpen`).
  - Units come from the queue only when it has the buildings for them (`prereqOk(def, ENEMY)`); one it can't build
    yet keeps its turn. It keeps a harvester per refinery plus a spare, and repairs buildings below `diff.repairAt`.
- **Research Lab** (`lab`): a tech tier above Radar; the heaviest units need it (`prereq`). The AI builds it right after
  its core economy on Normal and Hard, and after its first two towers on Easy (`labEarly` in `aiNextBuilding`).
- **Scout** (`def.scout`, not selectable): explores on its own, avoids known enemy ground, flees threats, heads home once
  the map is explored. **Flak Tower**: a defence that only hits aircraft well. The AI builds Flak Towers once it has seen
  real player air activity, and leans its production towards countering the player's visible army (`playerProfile()`).
- **Tactical advisor**: a talking-head panel over the radar window warns about enemy build-ups it sees, about low power
  (after 5 s, `ai.advPowerT` cooldown), and nudges an idle player after 30 s of empty queues. The sidebar flashes `#lowPower`
  while power is short, and hovering a cameo shows `#cameoCard` (`cameoRole`, `matchups`, `missingPrereqs` in `ui.js`). **Training mode** (setup screen): the AI builds and defends but never attacks.
- **Pause menu** (`openMenu` / `closeMenu` / `toggleMenu` / `restartGame` in `main.js`): sets `state.menu` and
  `state.paused`. `settings = {sfx, voice, scroll}` (in `data.js`, saved as `rh-settings`) scale `sfx()` gain, speech
  volume and `tickCamera()` speed. Restart rebuilds the same skirmish with `newWorld()`; Quit reloads the page.
  Anything time-based that must reset with a restart belongs in `state` (e.g. `attackAlertT`, `chargeMsgT`).
- **Save and load** (`js/save.js`, `saveGame` / `loadGame` in `main.js`, 5 slots `rh-save-1..5`): a save stores
  `setup`, the difficulty and a `snapshot()`. `pack()` gives every object a row in a table, so shared references
  (targets, cargo, `inside`) and cycles survive; `UNIT_DEFS`, `BUILD_DEFS` and the other constant tables are stored
  by path, so `u.def === UNIT_DEFS[key]` still holds. It handles plain objects, arrays, typed arrays and `Set`s;
  `-0`, `NaN`, `Infinity` and `undefined` round-trip. Loading runs `newWorld()` for the map, then `restore()` puts
  the arrays, map layers, `state`, `ai`, the RNG state and the next id back. **Any new simulation state must live
  in something `snapshot()` saves** (an entity, `state`, `ai`, or a new root added there), or loaded games drift;
  `tests/save.spec.js` catches it. Bump `VERSION` in `save.js` when old saves can't load any more.
- **Rendering:**
  - `draw()` paints terrain chunks, ore, then entities sorted by `x + y`, then health bars, projectiles, effects, shroud and cursor.
  - `drawUnitSprite` falls back to simple procedural shapes when a sheet is missing.
- **Sound** (`js/sound.js`): no audio files (their licences need a human check); everything is synthesised with
  WebAudio from `tone()`, `noise()` and `bell()`. `SOUNDS[type]` has `play(ac, out, t, pitch, size)`, `gap` (least
  time between two), `max` (most at once), `dur`, and `ui: true` for interface cues that ignore position.
  - `sfx(type, at, size)`: pass where it happens (`at` = a unit, building or `{x, y}`) for anything in the world; it
    is panned by screen x and fades out 1.5 screens beyond the view. Leave `at` out for interface sounds.
  - Everything goes through one gain and compressor bus (`makeBus`), scaled by `settings.sfx`; pitch varies a few %.
  - Weapon kinds map to sounds in `fireWeapon()` (`shell` -> `cannon`, `beam` -> `zap`, `arc`, `rocket`, `flak`,
    `torpedo`, `snipe`, `mind`, `rad`, ...); `kill()` plays `death` (infantry), `explosion` or `collapse` (buildings).
  - Tests read `__RH.sfxLog` (what played, or why it was skipped) and `__RH.renderSfx(type)` (renders offline and
    measures peak, RMS and length). A new sound goes in `SOUNDS` and in the list in `tests/sound.spec.js`.
- **Voices** use browser speech: `announce()` for the announcer, `showAdvisor()` for the advisor, `ack()` for unit
  replies (per-unit `def.voice` lines). Every line goes through one channel (`voiceLine` in `ui.js`): never two at
  once and nothing is cut off. Waiting lines are said by priority (`VOICE`: critical alerts, advisor, announcer)
  and go stale after a few seconds; unit replies are only said when the channel is free. Never call
  `speechSynthesis` directly. The advisor uses a different installed voice (`advisorVoice()`) and a higher pitch.
  `tests/voice.spec.js` fakes the speech engine to check ordering and overlap.

## Adding a unit

1. **Model:** add a builder in `tools/sprites/rh_models.py`.
   - Vehicles return `{'body': Part, 'turret': Part, ...}`. Extra named parts become separate sheets; the launcher's `missile` is one.
   - Infantry are a `Soldier` kind, or a class with `.body` and `.pose(anim, k)` (see `Dog`).
2. **Register it:** add an entry to `VEHICLES` or `INFANTRY` in `build_sprites.py` with frame size, cameo zoom and factions.
3. **Render** (needs Blender with a GPU, so on the Mac; about 1 minute per vehicle or infantry per faction):
   ```bash
   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/sprites/build_sprites.py -- --only <key>
   ```
4. **Game:** add a `UNIT_DEFS` entry (`js/data.js`), add it to `TAB_ITEMS` (`js/ui.js`), and to `AI_QUEUE` (`js/ai.js`) if the AI should build it.
5. **Docs:** update the README unit table and the in-game help if it adds a control.

Without step 3 the unit still works but uses the procedural fallback drawing,
so code-only work can land first and the art can follow.

## Testing

- **Run the tests** after any gameplay change, and add a test for new mechanics:
  ```bash
  npm install && npx playwright install            # first time only (Chromium, Firefox and WebKit)
  npm test                                          # all three browsers
  npx playwright test --project=chromium            # one browser, every test (about 8 min)
  npm run test:quick                                # skips the long @slow simulations
  ```
  Playwright runs them headless against `tools/serve.py` on port 8399. Chromium runs everything; Firefox and
  WebKit skip `@slow` (whole-game simulations, plain game logic, the same in every engine). CI
  (`.github/workflows/test.yml`) runs the three browsers in parallel on pull requests and pushes to `main`.
  - Browser differences handled in code: no canvas `filter` in Safari (the hit flash redraws additively instead,
    `flashed()` in `render.js`), Firefox counts mouse-wheel notches in lines (`deltaMode`), and Safari rejects
    `AudioContext.resume()` outside a gesture. Math functions may differ in the last bit between engines, so a
    seed replays exactly only within one browser; saves are portable but a loaded game may drift elsewhere.
  - `tests/units.spec.js`: a scenario per unit ability.
  - `tests/air.spec.js`: aircraft, the air armour class, jets and the Airfield, stealth.
  - `tests/depot.spec.js`: the Service Depot.
  - `tests/garrison.spec.js`: garrisons and sandbags.
  - `tests/infantry.spec.js`: the special infantry.
  - `tests/veiltank.spec.js`: the stealth tank.
  - `tests/naval.spec.js`: the sea, the Dockyard and ships.
  - `tests/polish.spec.js`: ore truck gun, hauler jump, AI engineers.
  - `tests/setup.spec.js`: the skirmish setup screen (side, credits, map, seed).
  - `tests/soviet.spec.js`: a whole game as the Soviets against the Allied AI.
  - `tests/ui.spec.js`: real mouse clicks and the sidebar (hover cards, the low-power banner).
  - `tests/patrol.spec.js`: patrol routes, engaging and breaking off, save and load, the AI's patrols.
  - `tests/ai.spec.js`: 7 simulated minutes of AI play; checks it builds everything, attacks, and nothing gets stuck.
  - `tests/determinism.spec.js`: the same seed replays the same game.
  - `tests/menu.spec.js`: the pause menu and its settings.
  - `tests/sound.spec.js`: every sound renders without clipping; panning, fading, caps, mute; event sounds.
  - `tests/save.spec.js`: a loaded game continues exactly like the saved one (same page and after a reload); the slot UI.
  - `tests/aibase.spec.js`: the AI builds a full base on each level, rebuilds a lost factory, keeps its doors open,
    and an idle defended base falls later on Easy than Normal than Hard.
  - `tests/maps.spec.js`: every handmade map and a spread of random seeds joins the bases, reaches every ore field
    and lets a new factory out; random maps are balanced and repeatable; the AI's doors reach the player on each.
  - Every test also fails on any console error.
- **Debug handle:** `window.__RH` has `ready`, `start()`, `pause(on)`, `step(seconds)`,
  `spawn(key, tx, ty, team)`, `place(key, tx, ty, team)`, `canPlace(key, tx, ty, team)`, `canBoard(u, t)`, `applyDamage(target, dmg, vs, attacker)`, `powerOf(team)`, `prodQ`, `radiation()`, `treeDisguised(u)`, `sailable(x, y)`, `passable(x, y)`, `unload(t)`, `reveal(tx, ty, r)`, `faction` (the `FACTION` array), `ai` (the AI state), `pathOK(sx, sy, tx, ty)`, `zoom(z)`, `settings`, `restart()`, `sfx(type, tx, ty, size)`, `sfxLog`, `renderSfx(type, size)`, `save(slot)`, `load(slot)`, `rebuild({map, seed, ...})` (a new world from other setup choices, before `start()`), `world()` (water and tree layout, for seed tests), `map` (the current map), `plateau`, `onRamp(u, v)`, `groundZ(x, y)`, `deliver(key, team)` (as if a factory
  finished it; jets get a pad), `orderMove(u, wx, wy)`, `patrol([...])`, `tickCamera(dt)`, `block(tx, ty)`, `clear(tx, ty, w, h)`
  (opens a patch of ground for a test arena; pass `keepWater` to keep the sea), `select([...])`, `look(tx, ty)`,
  `toScreen(e)`, `weaponOf`, `canHurt`, and exposes `units`, `buildings`, `effects`, `state`.
  Tests call `start()` then `pause(true)`, so the real-time clock is stopped and only `step()` moves the game.
- **Syntax only:** `node --check --experimental-default-type=module js/<file>.js`.
- `tests/determinism.spec.js` plays four simulated minutes twice with one seed and compares every unit and building.
- The game uses ES modules, so it must be served over http (`tools/serve.py`); opening `index.html` from disk won't work.

## Deploying

`.github/workflows/pages.yml` publishes `index.html`, `js/` and `assets/` to GitHub Pages on every push to `main`
(no build step). Pages has to be enabled in the repo settings with "GitHub Actions" as the source. Keep every
asset path relative: the site is served from `/red-horizon/`, not the domain root.

## Next tasks (recommended order)

"Code" tasks can be done entirely in code, for example in a cloud session. "Art"
tasks also need new models rendered locally; do the code part first with the
fallback drawing.

1. **Done: Aircraft (code plus art).**
   - An altitude layer: units with `air: true` ignore `occ` and path in straight lines, draw higher with a ground shadow, and sort last.
   - A new armour class `air`: most weapons get `vs.air = 0`; flak, rockets and the IFV missiles get `air > 0`.
   - An Airfield building where jets land and rearm (limited ammo per sortie).
   - Units:
     - Allied strike jet: fast, one bomb run, returns to rearm.
     - Soviet heavy airship: very slow, tough, drops bombs, repairs itself.
     - Stealth transport helicopter for 5 infantry, reusing the transport code.
     - Jetpack infantry.
   - **The art is already rendered.** Sheet names are in `assets/sprites/manifest.json`:
     - `jet_allied_body`: 32 facings.
     - `jet_allied_bombs`: 32 facings. Draw it over the body while the jet still carries bombs.
     - `airship_soviet_body`: 32 facings.
     - `heli_allied_body`: 32 facings.
     - `heli_allied_rotor`: 1 facing, 4 spin frames. Cycle it over the body and draw it last.
     - `jetpack_allied` (plus `_die`): a normal infantry sheet with the manifest flag `air: true`.
     - `airfield_allied`: a 3x3 building with two landing pads, centred at about (-0.6, -0.55) and (0.55, 0.6) tiles from the footprint centre in Blender coordinates (game y = -Blender y).
     - Cameos: `jet_allied`, `airship_soviet`, `heli_allied`, `jetpack_allied`, `airfield_allied`.
   - **How aircraft sheets are drawn:** they are rendered with no ground and anchored
     on the aircraft's centre. Draw them at `toIso(x, y)` shifted up by the altitude
     in px, and paint a ground shadow (dark ellipse) at `toIso(x, y)` yourself.
     Jetpack infantry are anchored at the feet, so shift them up by their hover height the same way.
2. **Done: Repair Depot (code plus art).**
   - A building that repairs vehicles parked on it, for credits.
   - It also ejects latched drones, which gives the drone a counter.
3. **Done: Garrisoning (code).** Infantry enter civilian buildings (reuse the `cargo`
   and `inside` mechanics) and fire out of them. Rifle-type infantry can deploy
   behind sandbags for more range and armour.
4. **Done: Special infantry (code plus art).**
   - demolitions expert (timed charge on buildings and vehicles)
   - elite commando (kills infantry in one shot, demolishes buildings)
   - psychic infantry (takes over one enemy unit)
   - radiation trooper (deploys to contaminate an area)
   - spy (disguise; steals money or shuts off power)
   - teleporting infantry
5. **Done: Stealth tank (code plus art).** The Veil Tank. It looks like a tree while stationary and
   can't be auto-targeted until it fires.
6. **Done: Naval (code plus art).** Needs a map with a real sea (terrain generation,
   plus water pathing for ships), a Shipyard, transports that carry vehicles,
   destroyers, subs and AA cruisers. This is the biggest item.
7. **Done: Polish:**
   - Done: animated explosion sprites
   - Done: terrain height levels and cliffs (one plateau with ramps; a map generator could place more)
   - Done: a gun on the Soviet ore truck, and teleport-to-refinery for the Allied hauler
   - Done: AI engineers that capture player buildings (`aiEngineers`)
   - Done: a skirmish setup screen (map seed, starting credits, pick a side)

### Known issues

- Engineers sent into the enemy base usually die to the Arc Towers before reaching a building. That's expected; there's no infiltration mechanic yet.
