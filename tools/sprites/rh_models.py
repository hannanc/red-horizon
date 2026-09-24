"""Procedural block-out models for Red Horizon.

Every builder returns a dict of named Parts ('body', optionally 'turret').
Buildings are centred on their footprint: X spans the footprint width (game x),
Y spans the depth (game y is Blender -Y, so the side facing the viewer on the
lower-left is -Y, the one on the lower-right is +X). Units face +X.

Materials created with team=True become the remappable team colour.
"""
import math
import numpy as np
from rh_lib import Part, mat

PAL = {
    'allied': dict(wall='#c3c8cd', wall2='#a2acb7', roof='#7c8894', dark='#30363e', metal='#8e969e',
                   steel='#646c75', concrete='#9d9c94', trim='#e4e7ea', glass='#56b0ea', accent='#e8c23c',
                   hull='#8a9384', hull2='#626b5c', tread='#2a2c2f', uniform='#6b7a4a', helmet='#4f5c38',
                   brick='#9aa1a8'),
    'soviet': dict(wall='#ad9985', wall2='#8f7d6a', roof='#6b5b4d', dark='#352d28', metal='#877b71',
                   steel='#61574f', concrete='#98928a', trim='#d0bea2', glass='#f2a95c', accent='#d9a531',
                   hull='#6d6553', hull2='#51493c', tread='#2a2826', uniform='#8a7a55', helmet='#5a4838',
                   brick='#8b4a34'),
}


def palette(f):
    P = PAL[f]
    return dict(
        wall=mat(P['wall'], rough=0.6, grime=0.22),
        wall2=mat(P['wall2'], metal=0.2, rough=0.5, grime=0.18),
        roof=mat(P['roof'], rough=0.65, grime=0.25),
        dark=mat(P['dark'], rough=0.7),
        metal=mat(P['metal'], metal=0.6, rough=0.4),
        steel=mat(P['steel'], metal=0.7, rough=0.35),
        concrete=mat(P['concrete'], rough=0.85, grime=0.35),
        trim=mat(P['trim'], rough=0.45),
        glass=mat(P['glass'], metal=0.3, rough=0.15, emit=0.35),
        accent=mat(P['accent'], metal=0.2, rough=0.45),
        hull=mat(P['hull'], metal=0.35, rough=0.5, grime=0.2),
        hull2=mat(P['hull2'], metal=0.35, rough=0.5, grime=0.2),
        tread=mat(P['tread'], metal=0.2, rough=0.85),
        uniform=mat(P['uniform'], rough=0.8),
        helmet=mat(P['helmet'], rough=0.6),
        brick=mat(P['brick'], rough=0.9, grime=0.45),
        team=mat('#c4c4c4', metal=0.25, rough=0.4, team=True, name='team'),
        glow=mat('#8fe6ff', emit=4.0, name='glow'),
        copper=mat('#c77b43', metal=0.9, rough=0.3, name='copper'),
        gold=mat('#e6ad22', metal=0.85, rough=0.28, name='gold'),
        sand=mat('#b8a57a', rough=0.95, grime=0.3, name='sand'),
        yellow=mat('#e8c23c', rough=0.5, name='yellow'),
        skin=mat('#d6a47c', rough=0.7, name='skin'),
    )


def slab(p, w, h, C, z=0.06):
    p.box((0, 0, 0), (w - 0.04, h - 0.04, z), C['concrete'], bevel=0.02)
    return z


def hazard(p, x0, x1, y, z, C, n=8, depth=0.06):
    """Yellow/black hazard stripe along X at depth y."""
    step = (x1 - x0) / n
    for i in range(n):
        p.box((x0 + step * (i + 0.5), y, z), (step, depth, 0.012), C['yellow'] if i % 2 == 0 else C['dark'], bevel=0)

# ================================================================ buildings

def conyard(f):
    C = palette(f)
    p = Part('body')
    z = slab(p, 3, 3, C)
    # main assembly hall
    p.box((-0.25, 0.3, z), (2.3, 2.1, 0.72), C['wall'], bevel=0.03)
    p.box((-0.25, 0.3, z + 0.56), (2.34, 2.14, 0.11), C['team'], bevel=0.01)
    p.box((-0.25, 0.3, z + 0.72), (2.22, 2.02, 0.1), C['roof'], taper=(0.95, 0.93), bevel=0.02)
    # big bay door on the south face
    p.box((-0.35, -0.77, z), (1.25, 0.06, 0.5), C['dark'], bevel=0.005)
    for i in range(7):
        p.box((-0.9 + i * 0.18, -0.805, z + 0.03), (0.035, 0.03, 0.44), C['steel'], bevel=0)
    hazard(p, -0.95, 0.25, -0.87, z, C, n=8)
    # east-face windows
    for i in range(4):
        p.box((0.915, 1.0 - i * 0.42, z + 0.34), (0.03, 0.24, 0.12), C['glass'], bevel=0)
    # control tower on the front corner
    p.cyl((1.0, -0.95, z), 0.3, 0.8, C['wall2'], seg=24)
    p.cyl((1.0, -0.95, z + 0.8), 0.33, 0.16, C['glass'], seg=24)
    p.cyl((1.0, -0.95, z + 0.96), 0.36, 0.08, C['roof'], r2=0.22, seg=24)
    p.cyl((1.0, -0.95, z + 1.04), 0.015, 0.32, C['steel'], seg=6)
    p.torus((1.0, -0.95, z + 0.5), 0.305, 0.03, C['team'])
    # crane
    cx, cy = 0.95, 1.0
    p.box((cx, cy, z), (0.42, 0.42, 0.2), C['steel'])
    p.box((cx, cy, z + 0.2), (0.14, 0.14, 1.4), C['accent'], bevel=0.01)
    for k in range(6):
        p.box((cx, cy, z + 0.3 + k * 0.22), (0.16, 0.16, 0.025), C['dark'], bevel=0)
    p.box((cx - 0.55, cy, z + 1.6), (1.6, 0.12, 0.12), C['accent'], bevel=0.01)
    p.box((cx + 0.38, cy, z + 1.52), (0.26, 0.24, 0.22), C['dark'])
    p.box((cx, cy, z + 1.6), (0.22, 0.22, 0.2), C['wall2'])
    p.cyl((cx - 1.25, cy, z + 0.98), 0.008, 0.62, C['dark'], seg=4)
    p.box((cx - 1.25, cy, z + 0.9), (0.08, 0.08, 0.09), C['accent'])
    # roof furniture
    if f == 'allied':
        p.sphere((-0.55, 0.05, z + 0.82), 0.26, C['trim'], scale=(1, 1, 0.65), half=True)
        p.cyl((-0.55, 0.05, z + 0.98), 0.02, 0.12, C['steel'], seg=6)
    else:
        for (x, y) in ((-1.05, 1.05), (-0.7, 1.05)):
            p.cyl((x, y, z + 0.82), 0.1, 0.55, C['steel'], seg=14)
            p.cyl((x, y, z + 1.37), 0.12, 0.06, C['dark'], seg=14)
        p.box((-0.45, 0.0, z + 0.82), (0.5, 0.5, 0.06), C['team'], rot=math.radians(45))
    p.cyl((-1.0, 0.95, z + 0.82), 0.12, 0.18, C['metal'])
    p.box((0.25, 0.55, z + 0.82), (0.5, 0.35, 0.14), C['metal'])
    p.box((0.25, 0.55, z + 0.96), (0.4, 0.25, 0.03), C['dark'], bevel=0)
    return {'body': p}


def power(f):
    C = palette(f)
    p = Part('body')
    z = slab(p, 2, 2, C)
    if f == 'allied':
        p.box((0, 0, z), (1.8, 1.8, 0.33), C['wall'])
        p.box((0, 0, z + 0.2), (1.84, 1.84, 0.08), C['team'], bevel=0.01)
        for (x, y) in ((-0.42, 0.42), (0.45, -0.38)):
            p.cyl((x, y, z + 0.33), 0.42, 0.42, C['wall2'], seg=32)
            p.torus((x, y, z + 0.62), 0.425, 0.035, C['glow'])
            p.cyl((x, y, z + 0.75), 0.43, 0.04, C['metal'], seg=32)
            p.sphere((x, y, z + 0.79), 0.41, C['roof'], scale=(1, 1, 0.42), half=True)
            p.cyl((x, y, z + 0.94), 0.09, 0.1, C['steel'])
        p.cyl((-0.05, 0.02, z + 0.46), 0.07, 0.6, C['steel'], axis='X', rot=math.radians(-45))
        for i in range(3):
            p.box((0.55, 0.55 - i * 0.18, z + 0.33), (0.3, 0.1, 0.1), C['metal'])
        p.box((0.905, -0.1, z + 0.08), (0.02, 0.5, 0.16), C['glass'], bevel=0)
    else:
        p.box((0, 0, z), (1.8, 1.8, 0.26), C['wall'])
        p.box((0, 0, z + 0.12), (1.84, 1.84, 0.08), C['team'], bevel=0.01)
        p.cyl((0, 0, z + 0.24), 0.58, 0.28, C['metal'], seg=32, r2=0.5)
        p.cyl((0, 0, z + 0.52), 0.3, 0.6, C['dark'], seg=24)
        for i in range(4):
            p.torus((0, 0, z + 0.6 + i * 0.13), 0.42 - i * 0.05, 0.04, C['copper'])
        p.sphere((0, 0, z + 1.32), 0.22, C['glow'])
        p.torus((0, 0, z + 1.14), 0.2, 0.03, C['steel'])
        for (x, y) in ((0.7, 0.7), (-0.7, 0.7), (0.7, -0.7), (-0.7, -0.7)):
            p.box((x, y, z + 0.24), (0.2, 0.2, 0.5), C['wall2'], taper=(0.55, 0.55))
            p.sphere((x, y, z + 0.8), 0.07, C['glow'])
    return {'body': p}


def refinery(f):
    C = palette(f)
    p = Part('body')
    z = slab(p, 3, 3, C)
    # processing hall
    p.box((-0.5, 0.55, z), (1.8, 1.7, 0.75), C['wall'])
    p.box((-0.5, 0.55, z + 0.6), (1.84, 1.74, 0.1), C['team'], bevel=0.01)
    p.box((-0.5, 0.55, z + 0.75), (1.75, 1.6, 0.28), C['roof'], taper=(0.95, 0.35))
    for i in range(3):
        p.box((0.415, 1.1 - i * 0.4, z + 0.32), (0.03, 0.22, 0.12), C['glass'], bevel=0)
    # ore hopper with gold on the roof
    p.box((-0.9, 0.95, z + 0.75), (0.55, 0.5, 0.35), C['metal'])
    for i in range(7):
        a = i * 2.3
        p.ico((-0.9 + math.cos(a) * 0.15, 0.95 + math.sin(a) * 0.12, z + 1.1), 0.08, C['gold'], subdiv=1,
              jitter=0.4, seed=i, smooth=False)
    # silos
    for y in (0.95, 0.15):
        p.cyl((0.95, y, z), 0.36, 1.1, C['wall2'], seg=28)
        p.sphere((0.95, y, z + 1.1), 0.36, C['roof'], scale=(1, 1, 0.5), half=True)
        p.torus((0.95, y, z + 0.62), 0.365, 0.03, C['team'])
        p.cyl((0.95, y, z + 1.26), 0.06, 0.1, C['steel'])
    # docking pad in front
    p.box((0.1, -1.0, z), (1.5, 0.9, 0.025), C['dark'], bevel=0.005)
    for i in range(3):
        p.box((-0.35 + i * 0.45, -1.0, z + 0.025), (0.22, 0.22, 0.008), C['yellow'], bevel=0, rot=math.radians(45))
    # unloading chute
    p.box((-0.3, -0.5, z), (0.45, 0.4, 0.62), C['steel'], taper=(1, 0.4), shift=(0, 0.1))
    p.box((-0.3, -0.72, z), (0.5, 0.06, 0.2), C['dark'])
    # smokestack
    p.cyl((-1.25, 1.25, z), 0.1, 1.45, C['steel'], seg=14)
    p.cyl((-1.25, 1.25, z + 1.45), 0.12, 0.07, C['dark'], seg=14)
    p.torus((-1.25, 1.25, z + 1.1), 0.1, 0.02, C['team'])
    return {'body': p}


def barracks(f):
    C = palette(f)
    p = Part('body')
    z = slab(p, 2, 2, C)
    if f == 'allied':
        R = 0.6
        half = [(R * math.cos(a), R * math.sin(a)) for a in np.linspace(0, math.pi, 14)]
        p.extrude_x((-0.1, 0.25, z), half, 1.5, C['wall2'], smooth=True)
        for x in (-0.55, 0.35):
            band = [(1.03 * R * math.cos(a), 1.03 * R * math.sin(a)) for a in np.linspace(0, math.pi, 14)]
            p.extrude_x((x, 0.25, z), band, 0.1, C['team'], smooth=True)
        p.box((0.66, 0.25, z), (0.04, 0.34, 0.36), C['dark'], bevel=0.005)
        p.box((0.68, 0.25, z + 0.36), (0.05, 0.42, 0.05), C['metal'])
        for i in range(3):
            p.box((-0.1 - 0.45 + i * 0.45, -0.34, z + 0.25), (0.14, 0.03, 0.08), C['glass'], bevel=0)
    else:
        p.box((0, 0.2, z), (1.6, 1.2, 0.5), C['brick'])
        p.box((0, 0.2, z + 0.5), (1.72, 1.34, 0.36), C['roof'], taper=(1, 0.04))
        p.box((0, 0.2, z + 0.42), (1.64, 1.24, 0.08), C['team'], bevel=0.005)
        p.cyl((-0.5, 0.5, z + 0.5), 0.08, 0.5, C['brick'], seg=8)
        p.box((0.81, 0.2, z), (0.04, 0.3, 0.34), C['dark'], bevel=0.005)
        for i in range(3):
            p.box((-0.5 + i * 0.5, -0.41, z + 0.22), (0.16, 0.03, 0.12), C['glass'], bevel=0)
    # sandbags
    for row in range(2):
        for i in range(6):
            p.box((-0.6 + i * 0.2 + row * 0.1, -0.78, z + row * 0.07), (0.18, 0.12, 0.075), C['sand'], bevel=0.03)
    # flag
    p.cyl((-0.8, -0.55, z), 0.015, 0.95, C['metal'], seg=6)
    p.box((-0.66, -0.55, z + 0.73), (0.28, 0.012, 0.18), C['team'], bevel=0)
    return {'body': p}


def radar(f, frame=0, frames=8):
    """Radar station; frame rotates the dish / antenna."""
    C = palette(f)
    p = Part('body')
    z = slab(p, 2, 2, C)
    spin = 2 * math.pi * frame / frames
    if f == 'allied':
        p.box((-0.2, 0.2, z), (1.3, 1.3, 0.45), C['wall'])
        p.box((-0.2, 0.2, z + 0.3), (1.34, 1.34, 0.08), C['team'], bevel=0.01)
        p.box((-0.2, 0.2, z + 0.45), (1.2, 1.2, 0.06), C['roof'])
        for i in range(3):
            p.box((0.465, 0.55 - i * 0.35, z + 0.18), (0.03, 0.2, 0.1), C['glass'], bevel=0)
        p.box((0.45, -0.55, z), (0.5, 0.5, 0.25), C['wall2'])
        p.cyl((0.45, -0.55, z + 0.25), 0.18, 0.12, C['glass'], seg=16)
        # dish on a pedestal
        p.cyl((-0.2, 0.2, z + 0.51), 0.12, 0.3, C['steel'], seg=12)
        dish = Part('dish', p)
        dish.root.location = (-0.2, 0.2, z + 0.9)
        dish.root.rotation_euler = (0, math.radians(-35), spin)
        dish.sphere((0, 0, 0), 0.5, C['trim'], scale=(1, 1, 0.35), half=True)
        dish.cyl((0, 0, 0.1), 0.02, 0.35, C['dark'], seg=6)
        dish.sphere((0, 0, 0.45), 0.04, C['team'])
    else:
        for (x, y) in ((-0.45, -0.45), (0.45, -0.45), (0.45, 0.45), (-0.45, 0.45)):
            p.box((x, y, z), (0.12, 0.12, 1.3), C['steel'], shift=(-x * 0.55, -y * 0.55), bevel=0.01)
        for k in range(4):
            h = z + 0.25 + k * 0.28
            s = 0.9 - k * 0.17
            p.box((0, 0, h), (s + 0.08, s + 0.08, 0.04), C['metal'], bevel=0)
        p.box((0, 0, z), (0.8, 0.8, 0.35), C['wall'])
        p.box((0, 0, z + 0.2), (0.84, 0.84, 0.07), C['team'], bevel=0.005)
        p.box((0, 0, z + 1.36), (0.35, 0.35, 0.2), C['wall2'])
        p.cyl((0, 0, z + 1.56), 0.05, 0.12, C['steel'], seg=8)
        ant = Part('antenna', p)
        ant.root.location = (0, 0, z + 1.72)
        ant.root.rotation_euler = (0, 0, spin)
        ant.box((0, 0, 0), (0.1, 1.0, 0.18), C['dark'], bevel=0.01)
        ant.box((0.06, 0, 0.02), (0.02, 0.95, 0.14), C['team'], bevel=0)
        for x, y in ((0.75, 0.6), (-0.75, 0.6)):
            p.box((x, y, z), (0.35, 0.5, 0.22), C['metal'])
    return {'body': p}


def mcv(f):
    """Mobile Construction Vehicle: big tracked truck carrying a folded yard."""
    C = palette(f)
    body = Part('body')
    L, W = 1.35, 0.78
    tracks(body, L, W / 2 - 0.1, 0.24, 0.2, C, wheels=7)
    body.box((0, 0, 0.12), (L * 0.95, W - 0.14, 0.2), C['hull'])
    for s in (-1, 1):
        body.box((0, s * (W / 2 - 0.1), 0.2), (L * 0.95, 0.26, 0.03), C['hull2'])
    cab_x = L / 2 - 0.18
    body.box((cab_x, 0, 0.32), (0.32, W - 0.18, 0.26), C['hull2'], taper=(0.8, 0.95), shift=(-0.03, 0))
    body.box((cab_x + 0.14, 0, 0.42), (0.02, W - 0.3, 0.1), C['glass'], bevel=0)
    # folded structure: stacked modules, crane arm lying along the top
    body.box((-0.2, 0, 0.32), (0.8, W - 0.16, 0.26), C['team'])
    body.box((-0.25, 0, 0.58), (0.62, W - 0.3, 0.14), C['wall'])
    body.box((-0.1, 0.12, 0.72), (0.9, 0.08, 0.08), C['accent'], bevel=0.01)
    body.box((-0.55, 0.12, 0.66), (0.14, 0.14, 0.14), C['dark'])
    body.sphere((-0.3, -0.15, 0.72), 0.12, C['trim'], scale=(1, 1, 0.6), half=True)
    body.cyl((-L / 2 + 0.14, -0.26, 0.32), 0.035, 0.3, C['steel'], seg=8)
    return {'body': body}


def factory(f, door=0.0):
    C = palette(f)
    p = Part('body')
    z = slab(p, 3, 3, C)
    p.box((0, 0.25, z), (2.7, 2.3, 0.8), C['wall'])
    p.box((0, 0.25, z + 0.64), (2.74, 2.34, 0.1), C['team'], bevel=0.01)
    # sawtooth roof, glazing faces south
    for i in range(4):
        y0 = -0.62 + i * 0.58
        prof = [(-0.29, 0.0), (0.29, 0.0), (-0.29, 0.3)]
        p.extrude_x((0, y0, z + 0.8), prof, 2.6, C['roof'])
        p.box((0, y0 - 0.3, z + 0.83), (2.5, 0.02, 0.22), C['glass'], bevel=0)
    # vehicle door: a dark bay with a shutter that rolls up by `door` (0 closed .. 1 open)
    p.box((0, -0.86, z), (1.4, 0.2, 0.62), mat('#141619', rough=0.9, name='bay'), bevel=0)
    shut = 0.56 * (1 - door)
    if shut > 0.01:
        p.box((0, -0.96, z + 0.62 - shut - 0.03), (1.38, 0.03, shut), C['steel'], bevel=0.004)
        for i in range(int(shut / 0.07)):
            p.box((0, -0.978, z + 0.59 - (i + 1) * 0.07), (1.36, 0.01, 0.012), C['dark'], bevel=0)
    for x in (-0.78, 0.78):
        p.box((x, -0.96, z), (0.14, 0.1, 0.72), C['team'])
    hazard(p, -0.72, 0.72, -1.0, z + 0.62, C, n=10, depth=0.04)
    # apron with arrows
    p.box((0, -1.25, z), (1.6, 0.45, 0.02), C['dark'], bevel=0)
    for x in (-0.4, 0, 0.4):
        p.box((x, -1.25, z + 0.02), (0.12, 0.12, 0.006), C['yellow'], bevel=0, rot=math.radians(45))
    # chimneys + east-side vents
    for (x, y) in ((-1.05, 1.1), (-0.75, 1.1)):
        p.cyl((x, y, z + 0.8), 0.09, 0.62, C['steel'], seg=14)
    for i in range(3):
        p.box((1.37, 0.9 - i * 0.45, z + 0.2), (0.06, 0.3, 0.3), C['metal'])
    return {'body': p}


def pillbox(f):
    C = palette(f)
    p = Part('body')
    p.cyl((0, 0, 0), 0.36, 0.22, C['concrete'], seg=8)
    p.cyl((0, 0, 0.13), 0.365, 0.05, C['dark'], seg=8)
    p.cyl((0, 0, 0.22), 0.36, 0.1, C['concrete'], seg=8, r2=0.25)
    p.cyl((0, 0, 0.32), 0.18, 0.04, C['team'], seg=8)
    p.cyl((0.28, 0, 0.155), 0.025, 0.22, C['dark'], axis='X', seg=8)
    for i in range(12):
        a = i * math.pi * 2 / 12
        p.sphere((math.cos(a) * 0.44, math.sin(a) * 0.44, 0.03), 0.07, C['sand'], scale=(1.3, 0.9, 0.55))
    return {'body': p}


def beam_tower(f):
    C = palette(f)
    p = Part('body')
    p.cyl((0, 0, 0), 0.42, 0.1, C['concrete'], seg=8)
    p.cyl((0, 0, 0.1), 0.3, 0.12, C['metal'], seg=8, r2=0.22)
    p.box((0, 0, 0.22), (0.32, 0.32, 1.15), C['trim'], taper=(0.5, 0.5))
    p.box((0, 0, 0.55), (0.27, 0.27, 0.09), C['team'], taper=(0.95, 0.95))
    p.box((0, 0, 1.0), (0.2, 0.2, 0.07), C['team'])
    for a in range(4):
        ang = a * math.pi / 2 + math.pi / 4
        p.box((math.cos(ang) * 0.14, math.sin(ang) * 0.14, 1.28), (0.05, 0.05, 0.3), C['metal'], taper=(0.5, 0.5))
    crystal = mat('#bdefff', metal=0.1, rough=0.05, emit=2.5, name='crystal')
    p.cyl((0, 0, 1.36), 0.02, 0.14, crystal, seg=6, r2=0.17)
    p.cyl((0, 0, 1.5), 0.17, 0.32, crystal, seg=6, r2=0.0)
    return {'body': p}


def arc_tower(f):
    C = palette(f)
    p = Part('body')
    p.cyl((0, 0, 0), 0.42, 0.12, C['concrete'], seg=8)
    p.cyl((0, 0, 0.12), 0.3, 0.2, C['dark'], seg=12, r2=0.22)
    p.torus((0, 0, 0.3), 0.26, 0.03, C['team'])
    p.cyl((0, 0, 0.32), 0.1, 0.92, C['metal'], seg=12)
    for i in range(4):
        p.torus((0, 0, 0.52 + i * 0.15), 0.27 - i * 0.03, 0.04, C['copper'])
    for a in range(3):
        ang = a * 2 * math.pi / 3
        p.box((math.cos(ang) * 0.22, math.sin(ang) * 0.22, 0.12), (0.06, 0.06, 0.95), C['steel'],
              shift=(-math.cos(ang) * 0.12, -math.sin(ang) * 0.12))
    p.torus((0, 0, 1.2), 0.2, 0.03, C['steel'])
    p.sphere((0, 0, 1.34), 0.16, C['glow'])
    return {'body': p}

# ================================================================ vehicles

def tracks(p, L, y, w, h, C, wheels=5):
    for s in (-1, 1):
        p.box((0, s * y, 0), (L, w, h), C['tread'], bevel=0.035)
        for i in range(wheels):
            x = -L / 2 + 0.1 + i * (L - 0.2) / (wheels - 1)
            yo = s * (y + w / 2) - (0.02 if s < 0 else 0)
            p.cyl((x, yo, h * 0.45), 0.06, 0.02, C['steel'], axis='Y', seg=10)


def light_tank(f):
    C = palette(f)
    body, tur = Part('body'), Part('turret')
    big = f == 'soviet'
    L, W = (0.98, 0.62) if big else (0.9, 0.56)
    tracks(body, L, W / 2 - 0.09, 0.2, 0.17, C)
    body.hull((0, 0, 0.08), L * 0.98, W - 0.1, 0.17, C['hull'], nose=0.2, tail=0.08, top_w=0.85)
    for s in (-1, 1):
        body.box((0, s * (W / 2 - 0.09), 0.17), (L * 0.96, 0.22, 0.03), C['hull2'])
    body.box((-0.06, 0, 0.25), (L * 0.5, W * 0.55, 0.018), C['team'], bevel=0.004)
    body.box((-L / 2 + 0.07, 0, 0.18), (0.08, 0.3, 0.06), C['dark'])
    body.cyl((L / 2 - 0.12, 0.17, 0.2), 0.03, 0.03, C['trim'], seg=8)
    body.cyl((L / 2 - 0.12, -0.17, 0.2), 0.03, 0.03, C['trim'], seg=8)
    tl, tw = (0.5, 0.42) if big else (0.44, 0.36)
    tur.hull((-0.03, 0, 0.25), tl, tw, 0.14, C['team'], nose=0.12, tail=0.06, top_w=0.75)
    tur.box((tl / 2 - 0.04, 0, 0.28), (0.09, 0.15, 0.08), C['hull2'])
    blen = 0.5 if big else 0.42
    tur.cyl((tl / 2 - 0.02, 0, 0.32), 0.032, blen, C['steel'], axis='X', seg=10)
    tur.cyl((tl / 2 - 0.02 + blen - 0.02, 0, 0.32), 0.045, 0.07, C['dark'], axis='X', seg=10)
    tur.cyl((-0.1, 0.08, 0.39), 0.055, 0.035, C['hull2'])
    tur.cyl((-0.16, -0.1, 0.38), 0.008, 0.25, C['dark'], seg=4)
    return {'body': body, 'turret': tur}


def heavy_tank(f):
    C = palette(f)
    body, tur = Part('body'), Part('turret')
    L, W = 1.25, 0.8
    if f == 'soviet':
        for y in (0.2, 0.32):
            tracks(body, L, y + 0.02, 0.13, 0.17, C, wheels=6)
    else:
        tracks(body, L, W / 2 - 0.1, 0.24, 0.19, C, wheels=6)
    body.hull((0, 0, 0.09), L * 0.98, W - 0.12, 0.19, C['hull'], nose=0.26, tail=0.1, top_w=0.84)
    for s in (-1, 1):
        body.box((0, s * (W / 2 - 0.1), 0.19), (L * 0.95, 0.26, 0.035), C['hull2'])
    body.box((-0.08, 0, 0.28), (L * 0.5, W * 0.55, 0.02), C['team'], bevel=0.004)
    body.box((-L / 2 + 0.1, 0, 0.2), (0.12, 0.4, 0.08), C['dark'])
    tur.hull((-0.06, 0, 0.28), 0.64, 0.52, 0.18, C['team'], nose=0.14, tail=0.07, top_w=0.78)
    tur.box((0.27, 0, 0.3), (0.1, 0.24, 0.12), C['hull2'])
    if f == 'soviet':
        for y in (-0.07, 0.07):
            tur.cyl((0.28, y, 0.37), 0.035, 0.55, C['steel'], axis='X', seg=10)
            tur.cyl((0.8, y, 0.37), 0.048, 0.07, C['dark'], axis='X', seg=10)
        for s in (-1, 1):
            tur.box((-0.08, s * 0.31, 0.3), (0.3, 0.1, 0.12), C['hull2'])
            for k in range(3):
                tur.cyl((0.07, s * 0.31 + (k - 1) * 0.028, 0.36), 0.012, 0.01, C['dark'], axis='X', seg=6)
    else:
        tur.cyl((0.3, 0, 0.37), 0.042, 0.62, C['steel'], axis='X', seg=12)
        tur.cyl((0.88, 0, 0.37), 0.055, 0.08, C['dark'], axis='X', seg=12)
    tur.cyl((-0.15, 0.1, 0.46), 0.065, 0.04, C['hull2'])
    tur.cyl((-0.25, -0.15, 0.45), 0.008, 0.3, C['dark'], seg=4)
    return {'body': body, 'turret': tur}


def harvester(f):
    C = palette(f)
    body = Part('body')
    L, W = (1.05, 0.66) if f == 'allied' else (1.15, 0.7)
    tracks(body, L, W / 2 - 0.1, 0.22, 0.18, C, wheels=6)
    body.box((0, 0, 0.1), (L * 0.95, W - 0.16, 0.22), C['hull'])
    for s in (-1, 1):
        body.box((0, s * (W / 2 - 0.1), 0.18), (L * 0.95, 0.24, 0.03), C['hull2'])
    # cab (front, +X)
    cab_x = L / 2 - 0.17
    body.box((cab_x, 0, 0.32), (0.3, W - 0.16, 0.24), C['hull2'], taper=(0.75, 0.95), shift=(-0.03, 0))
    body.box((cab_x + 0.13, 0, 0.4), (0.02, W - 0.26, 0.1), C['glass'], bevel=0)
    # hopper (team coloured, filled with ore)
    hx = -0.15
    body.box((hx, 0, 0.32), (0.58, W - 0.12, 0.2), C['team'])
    body.box((hx, 0, 0.52), (0.5, W - 0.2, 0.02), C['dark'], bevel=0)
    for i in range(9):
        a = i * 2.4
        body.ico((hx + math.cos(a) * 0.14, math.sin(a) * 0.12, 0.55), 0.07, C['gold'], subdiv=1, jitter=0.4,
                 seed=i + 3, smooth=False)
    # scoop arm at the front
    body.box((L / 2 + 0.02, 0, 0.05), (0.08, W - 0.24, 0.12), C['steel'], shift=(0.04, 0))
    if f == 'soviet':
        body.cyl((cab_x - 0.02, 0.0, 0.56), 0.06, 0.06, C['hull2'])
        body.cyl((cab_x + 0.02, 0.0, 0.59), 0.012, 0.18, C['dark'], axis='X', seg=6)
    body.cyl((-L / 2 + 0.12, 0.2, 0.32), 0.035, 0.32, C['steel'], seg=8)
    return {'body': body}

# ================================================================ infantry

class Soldier:
    """Articulated soldier. Limb Parts pivot at the hip / shoulder."""
    def __init__(self, f, kind):
        C = palette(f)
        self.kind = kind
        self.body = Part('body')
        b = self.body
        vest = C['team']
        # legs
        self.legs = []
        for s in (-1, 1):
            leg = Part('leg', b)
            leg.root.location = (0, s * 0.045, 0.24)
            leg.box((0, 0, -0.24), (0.075, 0.07, 0.24), C['uniform'], bevel=0.01)
            leg.box((0.015, 0, -0.24), (0.1, 0.075, 0.05), C['dark'], bevel=0.01)
            self.legs.append(leg)
        # torso, belt, pack
        b.box((0, 0, 0.23), (0.13, 0.17, 0.2), vest, bevel=0.02)
        b.box((0, 0, 0.225), (0.135, 0.175, 0.03), C['dark'], bevel=0.005)
        b.box((-0.085, 0, 0.27), (0.06, 0.13, 0.13), C['uniform'], bevel=0.015)
        # head
        b.sphere((0, 0, 0.475), 0.055, C['skin'])
        b.sphere((0, 0, 0.488), 0.066, C['helmet'], scale=(1.05, 1, 0.85), half=True)
        # arms
        self.arms = []
        for s in (-1, 1):
            arm = Part('arm', b)
            arm.root.location = (0, s * 0.105, 0.41)
            arm.box((0, 0, -0.17), (0.055, 0.05, 0.17), C['uniform'], bevel=0.01)
            arm.sphere((0, 0, -0.18), 0.028, C['skin'])
            self.arms.append(arm)
        # weapon
        self.gun = Part('gun', b)
        flash_mat = mat('#ffd36b', emit=12.0, name='flash')
        if kind == 'rocket':
            self.gun.root.location = (-0.02, -0.1, 0.47)
            self.gun.cyl((-0.16, 0, 0), 0.038, 0.38, C['hull2'], axis='X', seg=10)
            self.gun.cyl((0.22, 0, 0), 0.03, 0.07, mat('#c8452f', rough=0.5, name='warhead'), axis='X', seg=10, r2=0.01)
            self.flash = self.gun.ico((0.32, 0, 0), 0.06, flash_mat, subdiv=1)
        else:
            self.gun.root.location = (0.06, -0.035, 0.34)
            self.gun.box((0.06, 0, -0.02), (0.28, 0.025, 0.045), C['dark'], bevel=0.005)
            self.gun.box((-0.05, 0, -0.04), (0.08, 0.024, 0.06), C['hull2'], bevel=0.005)
            self.flash = self.gun.ico((0.23, 0, 0), 0.045, flash_mat, subdiv=1)
        self.flash.hide_render = True

    def pose(self, anim, k):
        legL, legR = self.legs
        armL, armR = self.arms
        self.body.root.rotation_euler.y = 0
        self.body.root.location.z = 0
        self.flash.hide_render = True
        self.gun.root.location.x = 0.06 if self.kind != 'rocket' else -0.02
        hold = math.radians(-65) if self.kind != 'rocket' else math.radians(-150)
        armR.root.rotation_euler.y = hold
        armL.root.rotation_euler.y = math.radians(-50) if self.kind != 'rocket' else math.radians(-120)
        legL.root.rotation_euler.y = legR.root.rotation_euler.y = 0
        if anim == 'walk':
            ph = k / 6 * 2 * math.pi
            legL.root.rotation_euler.y = math.sin(ph) * math.radians(32)
            legR.root.rotation_euler.y = -math.sin(ph) * math.radians(32)
            self.body.root.location.z = abs(math.cos(ph)) * 0.012
        elif anim == 'fire':
            if k == 0:
                self.flash.hide_render = False
            else:
                self.gun.root.location.x -= 0.02
        elif anim == 'die':
            self.body.root.rotation_euler.y = -math.radians([0, 30, 62, 88][k])
            armR.root.rotation_euler.y = armL.root.rotation_euler.y = math.radians(-160)

# ================================================================ civilian town

def civ(variant):
    """Neutral 2x2 town buildings (no team colour)."""
    p = Part('body')
    walls = ['#e2d6b8', '#b9cbd6', '#e8d9a0', '#a8564a', '#d8d2c8', '#c9b39a']
    roofs = ['#8a3a2e', '#4b5058', '#6d4a33', '#3e4248', '#8a3a2e', '#5a5f45']
    W = mat(walls[variant], rough=0.8, grime=0.25, name='cw%d' % variant)
    R = mat(roofs[variant], rough=0.7, grime=0.3, name='cr%d' % variant)
    glass = mat('#6fa4c8', metal=0.3, rough=0.15, emit=0.2, name='cglass')
    frame = mat('#f2efe8', rough=0.6, name='cframe')
    dark = mat('#3a3431', rough=0.8, name='cdark')
    lawn = mat('#5d7f3a', rough=0.95, grime=0.4, name='clawn')
    pave = mat('#a7a39a', rough=0.9, grime=0.3, name='cpave')
    p.box((0, 0, 0), (1.94, 1.94, 0.03), lawn if variant in (0, 1, 3) else pave, bevel=0.01)

    def windows(x0, y_face, z0, n, step, axis='x'):
        for i in range(n):
            if axis == 'x':   # windows on the south (-Y) face, spread along X
                p.box((x0 + i * step, y_face - 0.012, z0), (0.16, 0.02, 0.18), frame, bevel=0)
                p.box((x0 + i * step, y_face - 0.022, z0 + 0.02), (0.12, 0.02, 0.14), glass, bevel=0)
            else:             # windows on the east (+X) face, spread along Y
                p.box((y_face + 0.012, x0 + i * step, z0), (0.02, 0.16, 0.18), frame, bevel=0)
                p.box((y_face + 0.022, x0 + i * step, z0 + 0.02), (0.02, 0.12, 0.14), glass, bevel=0)

    if variant in (0, 4):   # gable-roofed house
        p.box((0.05, 0.15, 0.03), (1.3, 1.1, 0.55), W)
        p.box((0.05, 0.15, 0.58), (1.44, 1.24, 0.45), R, taper=(1, 0.04))
        p.box((0.45, 0.35, 0.7), (0.14, 0.14, 0.45), mat('#8a5a44', rough=0.9, name='chim'))
        windows(-0.4, -0.4, 0.28, 3, 0.4)
        windows(0.45, 0.7, 0.28, 2, -0.45, axis='y')
        p.box((0.35, -0.42, 0.03), (0.2, 0.03, 0.34), dark, bevel=0)
        for i in range(5):
            p.box((-0.8 + i * 0.35, -0.9, 0.03), (0.04, 0.04, 0.16), frame, bevel=0)
        p.box((-0.1, -0.9, 0.13), (1.44, 0.03, 0.03), frame, bevel=0)
    elif variant in (1, 5):  # two-storey with hip roof
        p.box((-0.1, 0.1, 0.03), (1.4, 1.4, 0.95), W)
        p.box((-0.1, 0.1, 0.98), (1.52, 1.52, 0.4), R, taper=(0.3, 0.3))
        for zz in (0.25, 0.62):
            windows(-0.6, -0.6, zz, 4, 0.33)
            windows(-0.4, 0.6, zz, 3, 0.33, axis='y')
        p.box((0.2, -0.62, 0.03), (0.22, 0.03, 0.36), dark, bevel=0)
    elif variant == 2:      # corner shop with awning and sign
        p.box((0, 0.1, 0.03), (1.6, 1.4, 0.7), W)
        p.box((0, 0.1, 0.73), (1.66, 1.46, 0.08), mat('#d7d2c4', rough=0.7, name='parapet'))
        p.box((0, -0.62, 0.03), (1.5, 0.02, 0.4), glass, bevel=0)
        p.box((0, -0.76, 0.42), (1.6, 0.3, 0.04), mat('#c83c32', rough=0.6, name='awning'), taper=(1, 1), shift=(0, 0.1))
        p.box((0.0, -0.62, 0.52), (0.9, 0.04, 0.16), mat('#f0c43a', rough=0.5, emit=0.3, name='sign'), bevel=0)
        windows(-0.4, 0.8, 0.3, 3, 0.4, axis='y')
        p.box((-0.4, 0.4, 0.81), (0.4, 0.3, 0.18), mat('#8b9096', metal=0.5, rough=0.4, name='ac'))
    else:                   # brick warehouse
        p.box((0, 0.1, 0.03), (1.7, 1.5, 0.75), W)
        prof = [(-0.75, 0.0), (0.75, 0.0), (0.0, 0.3)]
        p.extrude_x((0, 0.1, 0.78), prof, 1.76, R)
        p.box((0.2, -0.66, 0.03), (0.6, 0.03, 0.5), mat('#6b7076', metal=0.4, rough=0.5, name='rolldoor'), bevel=0)
        windows(-0.55, -0.65, 0.5, 2, 0.3)
        windows(-0.4, 0.85, 0.45, 3, 0.4, axis='y')
        for i in range(3):
            p.box((-0.6 + i * 0.25, -0.85, 0.03), (0.2, 0.2, 0.2), mat('#9a7a4a', rough=0.9, name='crate'))
    return {'body': p}


def lamp(seed):
    p = Part('body')
    pole = mat('#4a4f55', metal=0.6, rough=0.4, name='pole')
    p.cyl((0, 0, 0), 0.025, 0.7, pole, seg=8)
    p.box((0.08, 0, 0.68), (0.18, 0.03, 0.03), pole, bevel=0)
    p.box((0.16, 0, 0.64), (0.07, 0.05, 0.04), mat('#fff2c0', emit=3.0, name='bulb'), bevel=0)
    return {'body': p}

# ================================================================ doodads

def tree(seed):
    rng = np.random.default_rng(seed)
    p = Part('body')
    trunk = mat('#5a4330', rough=0.9, name='trunk')
    leaves = [mat(c, rough=0.8, grime=0.45, name='leaf' + c) for c in ('#3f6b2a', '#4f7d31', '#34592a', '#5b8a3a')]
    if seed % 2 == 0:  # broadleaf
        p.cyl((0, 0, 0), 0.05, 0.42, trunk, seg=8, r2=0.035)
        for i in range(7):
            a = rng.random() * 2 * math.pi
            r = rng.random() * 0.17
            p.ico((math.cos(a) * r, math.sin(a) * r, 0.5 + rng.random() * 0.28), 0.15 + rng.random() * 0.08,
                  leaves[i % 4], subdiv=2, jitter=0.35, seed=seed * 10 + i)
    else:  # conifer
        p.cyl((0, 0, 0), 0.045, 0.3, trunk, seg=8)
        for i in range(4):
            p.cyl((0, 0, 0.18 + i * 0.2), 0.3 - i * 0.06, 0.34, leaves[(i + seed) % 3], seg=9, r2=0.02)
    return {'body': p}


def rock(seed):
    p = Part('body')
    stone = mat('#8a8578', rough=0.9, grime=0.5, name='stone')
    rng = np.random.default_rng(seed)
    for i in range(3):
        p.ico(((rng.random() - 0.5) * 0.3, (rng.random() - 0.5) * 0.3, 0.05), 0.12 + rng.random() * 0.1, stone,
              subdiv=1, jitter=0.5, seed=seed * 7 + i, scale=(1.2, 1, 0.7), smooth=False)
    return {'body': p}


def ore(level, seed):
    """Clusters of small faceted gold nuggets; level 0-3 is the density."""
    p = Part('body')
    golds = [mat(c, metal=0.45, rough=0.35, name='ore' + c) for c in ('#f0c94a', '#d9a832', '#f7dc73')]
    dirt = mat('#6e5a36', rough=0.95, name='oredirt')
    rng = np.random.default_rng(seed * 31 + level)
    n = [6, 10, 15, 22][level]
    for i in range(n):
        a = rng.random() * 2 * math.pi
        r = math.sqrt(rng.random()) * 0.38
        s = 0.022 + rng.random() * 0.03 + level * 0.005
        x, y = math.cos(a) * r, math.sin(a) * r
        p.ico((x, y, 0), s * 1.3, dirt, subdiv=1, scale=(1.4, 1.4, 0.25), smooth=False)
        p.ico((x, y, s * 0.4), s, golds[i % 3], subdiv=1, jitter=0.6,
              seed=seed * 100 + i, scale=(1, 1, 0.9 + rng.random() * 0.7), smooth=False)
    return {'body': p}
