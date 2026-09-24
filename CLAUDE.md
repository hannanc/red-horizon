# Red Horizon: notes for Claude

A classic 2.5D isometric RTS in the browser. There is no build step: plain HTML,
JS and pre-rendered sprite sheets. The README covers controls and the unit list.
This file covers how the code works, the rules, and what to build next.

## Rules

- **Never use names, terms or voice lines from Red Alert 2, Command & Conquer,
  or any other commercial game.** The repo will go public. Every unit, building
  and weapon gets an original name, such as "Lancer Tank" rather than
  "Prism Tank". The same applies to code identifiers, file names, comments and
  commit messages. "Allied" and "Soviet" are fine because they are historical terms.
- The original game is only a reference for *feel*: gameplay, the isometric look
  and sidebar UX. Don't copy its assets or text.
- Keep the style of the surrounding code: one big `index.html` script with plain
  functions, terse comments, and no frameworks or build tools.

## Layout

| Path | What |
| --- | --- |
| `index.html` | The whole game: HUD markup, CSS, and one `<script>` with all the logic (about 3000 lines) |
| `js/sprites.js` | `Sprites`: loads `assets/sprites/manifest.json`, tints team colour, and has draw, facing and bbox helpers |
| `js/terrain.js`, `js/terrain-worker.js` | Procedural ground painting (noise, roads, lakes), run in a worker pool |
| `tools/serve.py` | No-cache dev server: `python3 tools/serve.py 8347`, then open http://localhost:8347 |
| `tools/sprites/` | Blender pipeline: `rh_lib.py` (scene, camera, shapes), `rh_models.py` (models), `build_sprites.py` (what to render) |
| `assets/sprites`, `assets/cameos` | Rendered sheets and sidebar pictures, committed to git |

## How the game works (`index.html`)

- **World:** 64x64 tiles, `T = 32` world px per tile. Logic runs on the square
  grid. `toIso` / `toWorld` convert to 2:1 isometric screen space.
  `occ[]` holds the building id on each tile, 0 for free, or `BLOCKED` for
  water, trees and rocks. `walk[]` marks tiles of flat buildings (`def.flat`, the depot) that
  units may drive over; always test movement with `passable()`, placement with `occ`.
- **Teams:** `PLAYER = 0` (Allied), `ENEMY = 1` (Soviet AI), `NEUTRAL = 2` (civilian town).
  `FACTION[team]` picks the sprite set.
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
- **Veil Tank** (`def.treeDisguise`): `fooledBy` keeps enemy scans off it until it has fired in the last 3 s;
  `treeDisguised(u)` (parked for 1 s and quiet) draws it as a tree from the `tree` sheet.
- **Sandbags**: units with `def.deploy` (the rifleman) toggle `u.deployed` with `D`: `weaponOf` returns `def.deployWeapon`,
  `applyDamage` halves damage, they don't chase targets, and any move or board order undeploys them. AI troopers at home dig in.
- **Service Depot** (`def.flat`): drawn before everything else so vehicles sit on it. `serviceDepot()` repairs the most
  damaged stopped vehicle on its footprint (`onFootprint`) for credits and kills drones latched inside parked vehicles.
  The enemy base starts with one, and `aiRepairs()` sends damaged idle AI vehicles to it.
- **Stealth** (`def.stealth`): `stealthTick` sets `u.revealed` when an enemy is within about 2.5 tiles, the unit fired in the last 3 s, or (helicopter) it has landed. `hiddenFrom(u, team)` hides it from targeting, picking, drawing and the minimap.
- **Orders:** the `order.type` values are `idle`, `move`, `attack`, `attackmove`, `capture` (engineer) and `board`.
  - Right-click handling is in `issueCommand()`. The context cursor comes from `cursorType()` and is drawn by `drawCursor()`.
- **AI** (`tickAI`): one production queue (`ai.prodQ`), attack waves on a timer, and `aiTransports()` to fill and unload halftracks.
  `DIFFICULTY[key]` (picked on the start screen, applied by `setDifficulty()`, read through `diff`) scales starting credits, income, first-wave time, wave gap, wave size and army cap. Hard is the original tuning.
- **Rendering:**
  - `draw()` paints terrain chunks, ore, then entities sorted by `x + y`, then health bars, projectiles, effects, shroud and cursor.
  - `drawUnitSprite` falls back to simple procedural shapes when a sheet is missing.
- **Sound:** synthesised with WebAudio in `sfx(type)`. Voices use browser speech: `announce()` for the announcer, `ack()` for unit replies, with per-unit `def.voice` lines.

## Adding a unit

1. **Model:** add a builder in `tools/sprites/rh_models.py`.
   - Vehicles return `{'body': Part, 'turret': Part, ...}`. Extra named parts become separate sheets; the launcher's `missile` is one.
   - Infantry are a `Soldier` kind, or a class with `.body` and `.pose(anim, k)` (see `Dog`).
2. **Register it:** add an entry to `VEHICLES` or `INFANTRY` in `build_sprites.py` with frame size, cameo zoom and factions.
3. **Render** (needs Blender with a GPU, so on the Mac; about 1 minute per vehicle or infantry per faction):
   ```bash
   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/sprites/build_sprites.py -- --only <key>
   ```
4. **Game:** add a `UNIT_DEFS` entry, add it to `TAB_ITEMS`, and add it to `ai.prodQ` if the AI should build it.
5. **Docs:** update the README unit table and the in-game help if it adds a control.

Without step 3 the unit still works but uses the procedural fallback drawing,
so code-only work can land first and the art can follow.

## Testing

- **Run the tests** after any gameplay change, and add a test for new mechanics:
  ```bash
  npm install && npx playwright install chromium   # first time only
  npm test                                          # all tests, about 30 s
  npm run test:quick                                # skips the slow whole-game AI test
  ```
  The tests are headless Chromium, run by Playwright against `tools/serve.py` on port 8399.
  - `tests/units.spec.js`: a scenario per unit ability.
  - `tests/air.spec.js`: aircraft, the air armour class, jets and the Airfield, stealth.
  - `tests/depot.spec.js`: the Service Depot.
  - `tests/garrison.spec.js`: garrisons and sandbags.
  - `tests/infantry.spec.js`: the special infantry.
  - `tests/veiltank.spec.js`: the stealth tank.
  - `tests/ui.spec.js`: real mouse clicks and the sidebar.
  - `tests/ai.spec.js`: 7 simulated minutes of AI play; checks it builds everything, attacks, and nothing gets stuck.
  - Every test also fails on any console error.
- **Debug handle:** `window.__RH` has `ready`, `start()`, `pause(on)`, `step(seconds)`,
  `spawn(key, tx, ty, team)`, `place(key, tx, ty, team)`, `canPlace(key, tx, ty, team)`, `canBoard(u, t)`, `applyDamage(target, dmg, vs, attacker)`, `powerOf(team)`, `prodQ`, `radiation()`, `deliver(key, team)` (as if a factory
  finished it; jets get a pad), `orderMove(u, wx, wy)`, `block(tx, ty)`, `clear(tx, ty, w, h)`
  (opens a patch of ground for a test arena), `select([...])`, `look(tx, ty)`,
  `toScreen(e)`, `weaponOf`, `canHurt`, and exposes `units`, `buildings`, `effects`, `state`.
  Tests call `start()` then `pause(true)`, so the real-time clock is stopped and only `step()` moves the game.
- **Syntax only:** extract the main `<script>` and run `node --check` on it.

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
2. **Done: Repair Depot (code plus art).** Model `depot` is written but not rendered yet.
   - A building that repairs vehicles parked on it, for credits.
   - It also ejects latched drones, which gives the drone a counter.
3. **Done: Garrisoning (code).** Infantry enter civilian buildings (reuse the `cargo`
   and `inside` mechanics) and fire out of them. Rifle-type infantry can deploy
   behind sandbags for more range and armour.
4. **Done: Special infantry (code plus art):** models written, not rendered yet.
   - demolitions expert (timed charge on buildings and vehicles)
   - elite commando (kills infantry in one shot, demolishes buildings)
   - psychic infantry (takes over one enemy unit)
   - radiation trooper (deploys to contaminate an area)
   - spy (disguise; steals money or shuts off power)
   - teleporting infantry
5. **Done: Stealth tank (code plus art).** The Veil Tank; model `veiltank` written, not rendered yet. It looks like a tree while stationary and
   can't be auto-targeted until it fires.
6. **Naval (code plus art).** Needs a map with a real sea (terrain generation,
   plus water pathing for ships), a Shipyard, transports that carry vehicles,
   destroyers, subs and AA cruisers. This is the biggest item.
7. **Polish:**
   - animated explosion sprites
   - terrain height levels and cliffs
   - a gun on the Soviet ore truck, and teleport-to-refinery for the Allied hauler
   - AI engineers that capture player buildings
   - a skirmish setup screen (map seed, starting credits, pick a side)

### Known issues

- Engineers sent into the enemy base usually die to the Arc Towers before reaching a building. That's expected; there's no infiltration mechanic yet.
- The AI never builds Engineers.
