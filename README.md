# Red Horizon

A classic 2.5D isometric real-time strategy game that runs in the browser: base
building, harvesting, power, production queues and an AI opponent, drawn with
pre-rendered 3D sprites.

## Play

```bash
python3 tools/serve.py 8347
```

Then open http://localhost:8347.

## Controls

Right-click gives orders.

| Action | Input |
| --- | --- |
| Select / box-select | Left-click / left-drag (Shift adds to the selection) |
| Move, attack, set a rally point (factory selected) | Right-click |
| Force-fire, or attack-move on open ground | Ctrl + right-click |
| Deploy the Construction Vehicle | `D`, or click the selected vehicle again |
| Capture an enemy building, or fully repair your own | Right-click it with an Engineer selected |
| Board a transport / unload it | Right-click the transport with infantry selected / `D`, or click the selected transport again |
| Repair / sell mode | `K` / `L`, or the sidebar buttons |
| Queue units | Left-click a picture repeatedly (up to 9 per tab) |
| Hold, then cancel | Right-click the picture (a second right-click refunds) |
| Control groups | `Ctrl+1-9` to assign, `1-9` to recall |
| Stop | `S` |
| Scroll | Arrow keys or the screen edge |
| Zoom | Mouse wheel or `+` / `-` |

The minimap only works while you have a powered Radar.

## Units

Each side has its own roster.

| | Allied | Soviet |
| --- | --- | --- |
| Infantry | Rifleman, Rocket Soldier, Engineer, Hound (fast melee anti-infantry), Marksman (long-range anti-infantry) | Trooper, AT Trooper, Engineer, Arc Trooper (electric anti-armour) |
| Vehicles | Warden Tank, Ranger IFV (carries 1; its weapon changes with the passenger, and an Engineer inside repairs nearby vehicles), Lancer Tank (beam that arcs to nearby enemies), Paladin Tank, Ore Hauler, Construction Vehicle | Bison Tank, Bulwark Halftrack (carries 5, flak gun), Siege Launcher (long-range missile artillery), Leech Drone (crawls into vehicles and eats them from within), Ironclad Tank, Ore Truck, Construction Vehicle |

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
