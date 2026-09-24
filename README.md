# Red Horizon

A classic 2.5D isometric real-time strategy game that runs in the browser: base
building, harvesting, power, production queues and an AI opponent, drawn with
pre-rendered 3D sprites.

## Play

```bash
python3 tools/serve.py 8347
```

Then open http://localhost:8347 (the game is plain ES modules, so it has to be served over
http rather than opened from disk). The start screen sets up the skirmish:

- **Side:** play the Allies or the Soviets; the AI takes the other side.
- **Credits:** 5,000, 8,000 or 12,000 to start with (the AI's start scales with it).
- **Map seed:** any number gives its own lakes, coastline and woods; 1 (Classic) is the original map.
- **Difficulty:** Easy, Normal or Hard sets the AI's income, army size and how often and how hard it attacks.

## Controls

Right-click gives orders.

| Action | Input |
| --- | --- |
| Select / box-select | Left-click / left-drag (Shift adds to the selection) |
| Move, attack, set a rally point (factory selected) | Right-click |
| Force-fire, or attack-move on open ground | Ctrl + right-click |
| Deploy the Construction Vehicle | `D`, or click the selected vehicle again |
| Capture an enemy building, or fully repair your own | Right-click it with an Engineer selected |
| Board a transport / unload it | Right-click the transport with infantry selected / `D`, or click the selected transport again (a helicopter lands first) |
| Bomb run with a Talon Jet | Right-click a ground target; the jet drops its bombs, flies back to a free Airfield pad and rearms |
| Send jets home | Right-click an Airfield |
| Garrison a town building | Right-click it with armed infantry selected (up to 5). Empty it with `D`, or by clicking or right-clicking the selected building |
| Dig in behind sandbags (Riflemen / Troopers) | `D` with them selected: more range, half damage taken, they hold position. `D` or a move order climbs out |
| Sabotage with an Infiltrator | Right-click an enemy building: a Refinery loses half its credits to you, a Power Plant blacks out their power for 45 s, a Radar reveals the map |
| Blow up a building with the Striker | Right-click it (the Striker only shoots infantry on its own) |
| Switch on an Isotope Trooper's radiation field | `D` |
| Load a Landing Craft | Bring it to the shore and right-click it with infantry or vehicles selected; unload with `D` (it must be next to a beach) |
| Repair vehicles | Right-click your Service Depot with vehicles selected; they park on it and are fixed for credits (a latched Leech Drone is removed) |
| Repair / sell mode | `K` / `L`, or the sidebar buttons |
| Queue units | Left-click a picture repeatedly (up to 9 per tab) |
| Hold, then cancel | Right-click the picture (a second right-click refunds) |
| Control groups | `Ctrl+1-9` to assign, `1-9` to recall |
| Stop | `S` |
| Scroll | Arrow keys or the screen edge |
| Zoom | Mouse wheel or `+` / `-` |

The minimap only works while you have a powered Radar.

The map has a sea along its west and north edges, so both bases have a coast.
Ships only move on water. East of the centre stands a plateau: its cliffs can only
be climbed by two ramps, nothing can be built on it, and units up there shoot one
tile further at targets below. East of the centre stands a plateau: its cliffs can only
be climbed by two ramps, nothing can be built on it, and units up there shoot one
tile further at targets below.

Aircraft fly straight over water, trees and buildings. Only rockets (Rocket
Soldiers, AT Troopers, the Ranger IFV) and the halftrack's flak can hit them.

## Units

Each side has its own roster.

| | Allied | Soviet |
| --- | --- | --- |
| Infantry | Rifleman, Rocket Soldier, Engineer, Hound (fast melee anti-infantry), Marksman (long-range anti-infantry), Skytrooper (jetpack; hovers over obstacles, needs an Airfield), Striker (elite commando, one at a time: kills infantry in one shot, demolishes buildings), Infiltrator (the enemy ignores it; sabotages buildings), Blink Trooper (teleports instead of walking) | Trooper, AT Trooper, Engineer, Arc Trooper (electric anti-armour), Sapper (timed charges on buildings and vehicles), Psion (takes over one enemy unit until it dies), Isotope Trooper (shots leave radiation; deploys to irradiate the area) |
| Vehicles | Warden Tank, Ranger IFV (carries 1; its weapon changes with the passenger, and an Engineer inside repairs nearby vehicles), Lancer Tank (beam that arcs to nearby enemies), Veil Tank (stealth missile tank: looks like a tree while parked, and the enemy doesn't pick it as a target until it fires), Paladin Tank, Ore Hauler (jumps back to the refinery with a full load), Construction Vehicle | Bison Tank, Bulwark Halftrack (carries 5, flak gun), Siege Launcher (long-range missile artillery), Leech Drone (crawls into vehicles and eats them from within), Ironclad Tank, Ore Truck (machine gun), Construction Vehicle |
| Aircraft | Talon Jet (one bomb run, then rearms on an Airfield pad; two jets per Airfield), Shade Transport (helicopter for 5 infantry; the enemy can't see it in flight unless something is close) | Tempest Airship (very slow and tough, bombs what's below it, repairs itself) |
| Ships | Landing Craft (carries 5 infantry or vehicles), Frigate (shells ships and the shore; the only thing that can hurt a sub), Picket Cruiser (anti-air) | Landing Craft, Barracuda Sub (torpedoes; attacks ships only), Hornet Flak Boat (fast; anti-air and anti-infantry) |
| Structures | Airfield (builds jets and the helicopter, and rearms jets), Service Depot, Dockyard (built on water; builds ships) | Repair Bay (the same depot), Sea Works (the same dockyard) |

## Display

Art is rendered at 2× (one map tile is a 128×64 px diamond), and the ground is
painted at the same density by background workers. That makes the game sharp on
Retina and 4K displays. The canvas runs at the screen's native resolution. Zoom
levels that map the art to whole screen pixels are drawn without smoothing, and
other levels are smoothed. On a large monitor at 100% scaling, the game starts
zoomed in and enlarges the sidebar so it stays readable.

## Art pipeline

Units, buildings, trees and ore are 3D models built in code and rendered by
Blender into sprite sheets, using a classic isometric camera: orthographic, 30° above the ground, turned 45°. One
tile is a 64×32 px diamond. Vehicles are rendered at 32 facings, and infantry at
8 facings, each with walk and fire frames. Each frame also gets a team-colour
mask, which the game uses to recolour units at load time.

- `tools/sprites/rh_lib.py` sets up the camera, lights, shadows, shapes, masks and PNG packing.
- `tools/sprites/rh_models.py` has the models, one function per unit or building, for each side.
- `tools/sprites/build_sprites.py` is the list of what to render. It writes
  `assets/sprites/*.png`, `assets/cameos/*.png` and `assets/sprites/manifest.json`.

To re-render everything (about 12 minutes on an M4 at 2×; pass `--scale 1` for 64×32 px tiles) or selected sprites:

```bash
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/sprites/build_sprites.py
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/sprites/build_sprites.py -- --only ltank,power
```

To improve a model, replace its function in `rh_models.py`. You can also load a
detailed `.blend` or `.glb` model there instead. Then re-render, and the game picks up the
new sheet automatically. The same models can move straight into Godot or Unity later.
