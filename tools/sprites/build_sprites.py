"""Render Red Horizon sprite sheets with Blender.

Usage (from the repo root):
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
      -P tools/sprites/build_sprites.py -- [--only name1,name2] [--samples 48]

Writes assets/sprites/<name>.png (+ <name>_mask.png for team colour),
assets/cameos/<name>.png and assets/sprites/manifest.json.
Partial runs (--only) merge into the existing manifest.
"""
import bpy, sys, os, math, json, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import rh_lib as L
import rh_models as M

ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(ROOT, 'assets', 'sprites')
CAMEO_OUT = os.path.join(ROOT, 'assets', 'cameos')
TMP = os.path.join(bpy.app.tempdir or '/tmp', 'rh_frame.png')

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default
ONLY = set(arg('--only').split(',')) if arg('--only') else None
SAMPLES = int(arg('--samples', 48))
# Render scale: 1 = one map tile is a 64x32 px diamond (classic 800x600-era pixel density),
# 2 = 128x64 px for high-DPI / 4K displays. Layout below is written at scale 1.
S = int(arg('--scale', 2))
NO_CAMEO = '--no-cameo' in argv

# ---------------------------------------------------------------- spec table
CAMEO_W, CAMEO_H = 128, 96          # logical size; rendered at S x
FACTIONS = ('allied', 'soviet')

BUILDINGS = {  # key: (footprint, height in BU, builder, factions, frames, frame -> builder kwargs)
    'conyard':  ((3, 3), 1.85, M.conyard, FACTIONS, 1, None),
    'power':    ((2, 2), 1.45, M.power, FACTIONS, 1, None),
    'refinery': ((3, 3), 1.6, M.refinery, FACTIONS, 1, None),
    'barracks': ((2, 2), 1.05, M.barracks, FACTIONS, 1, None),
    'factory':  ((3, 3), 1.5, M.factory, FACTIONS, 5, lambda k: dict(door=k / 4)),
    'radar':    ((2, 2), 1.9, M.radar, FACTIONS, 8, lambda k: dict(frame=k, frames=8)),
    'pillbox':  ((1, 1), 0.45, M.pillbox, FACTIONS, 1, None),
    'beamtower': ((1, 1), 1.9, M.beam_tower, ('allied',), 1, None),
    'arctower':  ((1, 1), 1.55, M.arc_tower, ('soviet',), 1, None),
    'airfield':  ((3, 3), 1.3, M.airfield, ('allied',), 1, None),
}
VEHICLES = {  # key: (builder, (W, H, ax, ay), cameo zoom, factions)
    'ltank':    (M.light_tank, (104, 72, 58, 44), 1.9, FACTIONS),
    'htank':    (M.heavy_tank, (128, 84, 70, 50), 1.45, FACTIONS),
    'harv':     (M.harvester, (124, 84, 68, 50), 1.5, FACTIONS),
    'mcv':      (M.mcv, (148, 100, 80, 60), 1.25, FACTIONS),
    'beamtank': (M.beam_tank, (104, 80, 58, 50), 1.8, ('allied',)),
    'launcher': (M.siege_launcher, (136, 92, 74, 56), 1.35, ('soviet',)),
    'drone':    (M.leech_drone, (72, 52, 40, 32), 3.0, ('soviet',)),
    'ifv':      (M.ifv, (108, 76, 60, 46), 1.8, ('allied',)),
    'halftrack': (M.halftrack, (124, 84, 68, 50), 1.5, ('soviet',)),
}
INFANTRY = {  # key: (kind, frame, cameo zoom, factions)
    'rifle':      ('rifle', (64, 48, 38, 38), 3.4, FACTIONS),
    'rocket':     ('rocket', (64, 48, 38, 38), 3.4, FACTIONS),
    'engineer':   ('engineer', (64, 48, 38, 38), 3.4, FACTIONS),
    'sniper':     ('sniper', (64, 48, 38, 38), 3.4, ('allied',)),
    'arctrooper': ('arc', (64, 48, 38, 38), 3.2, ('soviet',)),
    'dog':        ('dog', (64, 48, 38, 38), 3.6, ('allied',)),
    'jetpack':    ('jetpack', (64, 56, 32, 40), 3.2, ('allied',)),
}
AIRBORNE_INF = {'jetpack'}      # rendered without ground; the game draws the shadow
# Aircraft: rendered without ground around their centre. (builder, (W, H, ax, ay), cameo zoom, factions)
# A part named 'rotor' gets ROTOR_FRAMES spin frames at one facing instead of 32 facings.
AIRCRAFT = {
    'jet':     (M.jet, (100, 72, 50, 36), 2.2, ('allied',)),
    'airship': (M.airship, (156, 108, 78, 54), 1.25, ('soviet',)),
    'heli':    (M.heli, (120, 88, 60, 44), 1.9, ('allied',)),
}
ROTOR_FRAMES = 4
VEHICLE_FACINGS = 32
INF_FACINGS = 8
INF_SEQ = [('stand', 0), ('walk', 0), ('walk', 1), ('walk', 2), ('walk', 3), ('walk', 4), ('walk', 5),
           ('fire', 0), ('fire', 1)]


def wanted(name):
    return ONLY is None or name in ONLY or name.split('_')[0] in ONLY


def fresh_scene(W, H, ax, ay, zoom=1.0, ground=True):
    L.reset_scene()
    L.clear_material_cache()
    sc = bpy.context.scene
    sc.cycles.samples = SAMPLES
    L.setup_world(0.85)
    L.setup_lights()
    if ground:
        L.setup_ground()
    L.setup_camera(round(W * S), round(H * S), ax * S, ay * S, zoom * S)


def set_camera(W, H, ax, ay, zoom=1.0):
    cam = bpy.context.scene.camera
    bpy.data.objects.remove(cam, do_unlink=True)
    L.setup_camera(round(W * S), round(H * S), ax * S, ay * S, zoom * S)


def shoot(with_mask=True):
    col = L.clean_alpha(L.render_to_array(TMP))
    if not with_mask:
        return col, None
    with L.MaskMode():
        m = L.render_to_array(TMP)
    mask = m.copy()
    mask[..., 3] = (m[..., 0].astype(float) * m[..., 3] / 255).astype('uint8')
    mask[..., 0:3] = 255
    mask[col[..., 3] == 0] = 0
    return col, mask


def save(name, frames, masks, cols, meta):
    os.makedirs(OUT, exist_ok=True)
    L.write_png(os.path.join(OUT, name + '.png'), L.pack_sheet(frames, cols))
    has_mask = masks is not None and any(m[..., 3].any() for m in masks)
    if has_mask:
        L.write_png(os.path.join(OUT, name + '_mask.png'), L.pack_sheet(masks, cols))
    H, W, _ = frames[0].shape
    entry = dict(img='assets/sprites/' + name + '.png',
                 mask=('assets/sprites/' + name + '_mask.png') if has_mask else None,
                 fw=W, fh=H, cols=cols, frames=len(frames), scale=S)
    entry.update(meta)
    entry['ax'], entry['ay'] = meta['ax'] * S, meta['ay'] * S     # anchors in sheet pixels
    MANIFEST['sprites'][name] = entry


def save_cameo(name):
    if NO_CAMEO:
        return
    col, _ = shoot(with_mask=False)
    os.makedirs(CAMEO_OUT, exist_ok=True)
    # team-colour mask for cameos too, so the sidebar shows the player's colour
    with L.MaskMode():
        m = L.render_to_array(TMP)
    L.write_png(os.path.join(CAMEO_OUT, name + '.png'), col)
    mask = m.copy()
    mask[..., 3] = (m[..., 0].astype(float) * m[..., 3] / 255).astype('uint8')
    mask[..., 0:3] = 255
    mask[col[..., 3] == 0] = 0
    has = bool(mask[..., 3].any())
    if has:
        L.write_png(os.path.join(CAMEO_OUT, name + '_mask.png'), mask)
    MANIFEST['cameos'][name] = dict(scale=S, img='assets/cameos/' + name + '.png',
                                    mask=('assets/cameos/' + name + '_mask.png') if has else None)

# ---------------------------------------------------------------- renderers

def building_frame(fp, hbu):
    w, h = fp
    pad = 6
    sl = int(hbu * 50)
    W = 32 * (w + h) + sl + 2 * pad
    H = int(16 * (w + h) + hbu * L.HEIGHT_PX + 2 * pad)
    W += W % 2
    H += H % 2
    ax = pad + sl + 16 * (w + h)
    ay = H - pad - 8 * (w + h)
    return W, H, ax, ay, sl, pad


def do_building(key, fp, hbu, builder, faction, frames=1, kw=None):
    name = f'{key}_{faction}'
    W, H, ax, ay, sl, pad = building_frame(fp, hbu)
    cols, masks = [], []
    for k in range(frames):
        fresh_scene(W, H, ax, ay)
        builder(faction, **(kw(k) if kw else {}))
        c, m = shoot()
        cols.append(c)
        masks.append(m)
    save(name, cols, masks, frames, dict(ax=ax, ay=ay, facings=1, seq=frames, kind='building', fp=list(fp)))
    # cameo: fit the (shadowless) content box into the cameo frame
    cw, ch = 32 * (fp[0] + fp[1]), H - 2 * pad
    zoom = min((CAMEO_W - 10) / cw, (CAMEO_H - 8) / ch)
    cxs, cys = pad + sl + cw / 2, H / 2
    set_camera(CAMEO_W, CAMEO_H, CAMEO_W / 2 + (ax - cxs) * zoom, CAMEO_H / 2 + (ay - cys) * zoom, zoom)
    save_cameo(name)


def do_vehicle(key, builder, frame, czoom, faction):
    name = f'{key}_{faction}'
    W, H, ax, ay = frame
    fresh_scene(W, H, ax, ay)
    parts = builder(faction)
    meshes = {n: [o for o in p.root.children_recursive if o.type == 'MESH'] for n, p in parts.items()}
    for pname, part in parts.items():
        for other, obs in meshes.items():
            for ob in obs:
                ob.hide_render = other != pname
        frames, masks = [], []
        for i in range(VEHICLE_FACINGS):
            ang = 2 * math.pi * i / VEHICLE_FACINGS
            for p in parts.values():
                p.root.rotation_euler.z = -ang
            c, m = shoot()
            frames.append(c)
            masks.append(m)
        save(f'{name}_{pname}', frames, masks, 8, dict(ax=ax, ay=ay, facings=VEHICLE_FACINGS, seq=1, kind='vehicle'))
    # cameo, all parts visible, turned toward the viewer's lower right
    for obs in meshes.values():
        for ob in obs:
            ob.hide_render = False
        p.root.rotation_euler.z = -0.45
    set_camera(CAMEO_W, CAMEO_H, CAMEO_W / 2 - 4, CAMEO_H / 2 + 12, czoom)
    save_cameo(name)


def do_infantry(key, kind, frame, czoom, faction):
    name = f'{key}_{faction}'
    W, H, ax, ay = frame
    airborne = key in AIRBORNE_INF
    fresh_scene(W, H, ax, ay, ground=not airborne)
    s = M.Dog(faction) if kind == 'dog' else M.Soldier(faction, kind)
    frames, masks = [], []
    for fi in range(INF_FACINGS):
        s.body.root.rotation_euler.z = -2 * math.pi * fi / INF_FACINGS
        for anim, k in INF_SEQ:
            s.pose(anim, k)
            c, m = shoot()
            frames.append(c)
            masks.append(m)
    anims = {'stand': [0, 1], 'walk': [1, 6], 'fire': [7, 2]}
    save(name, frames, masks, len(INF_SEQ),
         dict(ax=ax, ay=ay, facings=INF_FACINGS, seq=len(INF_SEQ), anims=anims, kind='infantry', air=airborne))
    # death sequence (one facing is enough; it is drawn at the unit's facing-0 frame)
    frames, masks = [], []
    s.body.root.rotation_euler.z = -math.pi / 4
    for k in range(4):
        s.pose('die', k)
        c, m = shoot()
        frames.append(c)
        masks.append(m)
    save(name + '_die', frames, masks, 4, dict(ax=ax, ay=ay, facings=1, seq=4, kind='infantry'))
    # cameo: facing the viewer
    s.pose('stand', 0)
    s.body.root.rotation_euler.z = -math.pi / 4 - 0.35
    set_camera(CAMEO_W, CAMEO_H, CAMEO_W / 2, CAMEO_H - 10, czoom)
    save_cameo(name)


def do_aircraft(key, builder, frame, czoom, faction):
    name = f'{key}_{faction}'
    W, H, ax, ay = frame
    fresh_scene(W, H, ax, ay, ground=False)
    parts = builder(faction)
    meshes = {n: [o for o in p.root.children_recursive if o.type == 'MESH'] for n, p in parts.items()}
    for pname, part in parts.items():
        for other, obs in meshes.items():
            for ob in obs:
                ob.hide_render = other != pname
        frames, masks = [], []
        if pname == 'rotor':
            for k in range(ROTOR_FRAMES):
                part.root.rotation_euler.z = k * (math.pi / 2) / ROTOR_FRAMES   # 4 blades: a quarter turn loops
                c, m = shoot()
                frames.append(c)
                masks.append(m)
            part.root.rotation_euler.z = 0
            save(f'{name}_{pname}', frames, masks, ROTOR_FRAMES,
                 dict(ax=ax, ay=ay, facings=1, seq=ROTOR_FRAMES, kind='aircraft'))
            continue
        for i in range(VEHICLE_FACINGS):
            ang = 2 * math.pi * i / VEHICLE_FACINGS
            for n, p in parts.items():
                if n != 'rotor':
                    p.root.rotation_euler.z = -ang
            c, m = shoot()
            frames.append(c)
            masks.append(m)
        save(f'{name}_{pname}', frames, masks, 8, dict(ax=ax, ay=ay, facings=VEHICLE_FACINGS, seq=1, kind='aircraft'))
    for obs in meshes.values():
        for ob in obs:
            ob.hide_render = False
    for p in parts.values():
        p.root.rotation_euler.z = -0.45
    set_camera(CAMEO_W, CAMEO_H, CAMEO_W / 2, CAMEO_H / 2, czoom)
    save_cameo(name)


def do_civ():
    W, H, ax, ay, sl, pad = building_frame((2, 2), 1.45)
    frames = []
    for v in range(6):
        fresh_scene(W, H, ax, ay)
        M.civ(v)
        c, _ = shoot(with_mask=False)
        frames.append(c)
    save('civ', frames, None, len(frames), dict(ax=ax, ay=ay, facings=1, seq=len(frames), kind='building', fp=[2, 2]))


def do_doodads(name, builders, frame):
    W, H, ax, ay = frame
    frames, masks = [], []
    for b in builders:
        fresh_scene(W, H, ax, ay)
        b()
        c, _ = shoot(with_mask=False)
        frames.append(c)
    save(name, frames, None, len(frames), dict(ax=ax, ay=ay, facings=1, seq=len(frames), kind='doodad'))

# ---------------------------------------------------------------- main
MPATH = os.path.join(OUT, 'manifest.json')
MANIFEST = {'sprites': {}, 'cameos': {}}
if os.path.exists(MPATH):
    with open(MPATH) as fh:
        MANIFEST.update(json.load(fh))

t0 = time.time()
for key, (fp, hbu, builder, facs, nfr, kw) in BUILDINGS.items():
    for fac in facs:
        if wanted(f'{key}_{fac}'):
            t = time.time(); do_building(key, fp, hbu, builder, fac, nfr, kw); print(f'[sprites] {key}_{fac} {time.time() - t:.1f}s', flush=True)
for key, (builder, frame, cz, facs) in VEHICLES.items():
    for fac in facs:
        if wanted(f'{key}_{fac}'):
            t = time.time(); do_vehicle(key, builder, frame, cz, fac); print(f'[sprites] {key}_{fac} {time.time() - t:.1f}s', flush=True)
for key, (kind, frame, cz, facs) in INFANTRY.items():
    for fac in facs:
        if wanted(f'{key}_{fac}'):
            t = time.time(); do_infantry(key, kind, frame, cz, fac); print(f'[sprites] {key}_{fac} {time.time() - t:.1f}s', flush=True)
for key, (builder, frame, cz, facs) in AIRCRAFT.items():
    for fac in facs:
        if wanted(f'{key}_{fac}'):
            t = time.time(); do_aircraft(key, builder, frame, cz, fac); print(f'[sprites] {key}_{fac} {time.time() - t:.1f}s', flush=True)
if wanted('civ'):
    do_civ(); print('[sprites] civ', flush=True)
if wanted('lamp'):
    do_doodads('lamp', [lambda: M.lamp(0)], (48, 48, 22, 40)); print('[sprites] lamp', flush=True)
if wanted('tree'):
    do_doodads('tree', [lambda s=s: M.tree(s) for s in range(6)], (104, 96, 60, 80)); print('[sprites] tree', flush=True)
if wanted('rock'):
    do_doodads('rock', [lambda s=s: M.rock(s) for s in range(3)], (84, 52, 48, 34)); print('[sprites] rock', flush=True)
if wanted('ore'):
    do_doodads('ore', [lambda lv=lv, s=s: M.ore(lv, s) for lv in range(4) for s in range(2)], (72, 44, 38, 24)); print('[sprites] ore', flush=True)

os.makedirs(OUT, exist_ok=True)
with open(MPATH, 'w') as fh:
    json.dump(MANIFEST, fh, indent=1, sort_keys=True)
print(f'[sprites] done in {time.time() - t0:.1f}s', flush=True)
