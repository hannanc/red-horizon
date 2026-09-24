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
  water, trees and rocks.
- **Teams:** `PLAYER = 0` (Allied), `ENEMY = 1` (Soviet AI), `NEUTRAL = 2` (civilian town).
  `FACTION[team]` picks the sprite set.
- **Definitions:**
  - `BUILD_DEFS` and `UNIT_DEFS` hold stats, cost, build time, sidebar tab, prerequisites and weapon.
  - `side: 'allied' | 'soviet'` makes a unit exclusive to one side (`available()`).
  - `TAB_ITEMS` sets the sidebar order.
  - `SOV_NAME` gives Soviet display names for shared units.
- **Weapons:** `{dmg, rof, range (tiles), kind, vs: {inf, heavy, building}}`.
  - `vs` of 0 means the weapon can't hurt that armour class; targeting skips such targets.
  - Always read a unit's weapon through `weaponOf(e)`, because the IFV swaps weapons with its passenger.
  - Kinds are handled in `fireWeapon()`: `bullet`, `shell`, `rocket`, `flak` (projectiles), `beam` (with `chain`), `arc`, `snipe` (instant hit), `bite` (melee), `latch` (drone), and `missile` (lobbed, with `splash`).
- **Units:**
  - `spawnUnit` builds the unit object; `updateUnit` dispatches on its state.
  - Special cases go through their own update functions: `inside` (riding a transport), `latched` (a drone inside a vehicle), `order.type === 'board'`, harvester, engineer.
  - `onMap(u)` is false for riders and latched drones. Use it whenever you look for targets, selectable units or units to draw.
  - `u.fac` is the sprite faction. Captured buildings keep their original `b.fac` and only change `team`.
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

- **Syntax:** extract the main `<script>` and run `node --check` on it.
- **In a browser:** `window.__RH` is a debug handle.
  - It has `spawn(key, tx, ty, team)`, `place(key, tx, ty, team)`, `select([...])`, `look(tx, ty)` and `step(seconds)`, and exposes `units`, `buildings` and `state`.
  - Click `#startBtn` first.
  - The real-time loop keeps running, so for deterministic tests freeze it with `state.over = true` and wrap each `step()` in `over = false` / `over = true`.
  - To test a whole game, script it: spawn units, step, then assert on hp, orders and positions.
- **Checks worth running after gameplay changes:**
  - Simulate 5-8 minutes with `step(1)` in a loop. Confirm the AI builds and attacks, nothing gets stuck (for example units left in `board` or `capture` orders), and there are no console errors.

## Next tasks (recommended order)

"Code" tasks can be done entirely in code, for example in a cloud session. "Art"
tasks also need new models rendered locally; do the code part first with the
fallback drawing.

1. **Aircraft (code plus art).**
   - An altitude layer: units with `air: true` ignore `occ` and path in straight lines, draw higher with a ground shadow, and sort last.
   - A new armour class `air`: most weapons get `vs.air = 0`; flak, rockets and the IFV missiles get `air > 0`.
   - An Airfield building where jets land and rearm (limited ammo per sortie).
   - Units:
     - Allied strike jet: fast, one bomb run, returns to rearm.
     - Soviet heavy airship: very slow, tough, drops bombs, repairs itself.
     - Stealth transport helicopter for 5 infantry, reusing the transport code.
     - Jetpack infantry.
2. **Repair Depot (code plus art).**
   - A building that repairs vehicles parked on it, for credits.
   - It also ejects latched drones, which gives the drone a counter.
3. **Garrisoning (code).** Infantry enter civilian buildings (reuse the `cargo`
   and `inside` mechanics) and fire out of them. Rifle-type infantry can deploy
   behind sandbags for more range and armour.
4. **Special infantry (code plus art):**
   - demolitions expert (timed charge on buildings and vehicles)
   - elite commando (kills infantry in one shot, demolishes buildings)
   - psychic infantry (takes over one enemy unit)
   - radiation trooper (deploys to contaminate an area)
   - spy (disguise; steals money or shuts off power)
   - teleporting infantry
5. **Stealth tank (code plus art).** It looks like a tree while stationary and
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
- Nothing counters a latched drone yet. The Repair Depot above fixes that.
- The AI never builds Engineers.
