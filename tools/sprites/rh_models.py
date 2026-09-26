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

def airfield(f):
    """Two landing pads for jets, a control tower and a small hangar."""
    C = palette(f)
    p = Part('body')
    z = slab(p, 3, 3, C)
    for (x, y) in ((-0.62, -0.55), (0.55, 0.62)):
        p.cyl((x, y, z), 0.62, 0.025, C['dark'], seg=32)
        p.torus((x, y, z + 0.03), 0.52, 0.018, C['yellow'])
        p.torus((x, y, z + 0.03), 0.3, 0.012, C['team'])
        for i in range(8):
            a = i * math.pi / 4
            p.box((x + math.cos(a) * 0.57, y + math.sin(a) * 0.57, z + 0.025), (0.05, 0.05, 0.03),
                  mat('#fff2c0', emit=2.0, name='padlight'), bevel=0)
    # control tower on the back-left corner
    tx, ty = -0.95, 0.95
    p.box((tx, ty, z), (0.42, 0.42, 0.7), C['wall'])
    p.box((tx, ty, z + 0.55), (0.46, 0.46, 0.06), C['team'], bevel=0.01)
    p.box((tx, ty, z + 0.7), (0.5, 0.5, 0.18), C['glass'], taper=(1.12, 1.12), bevel=0.01)
    p.box((tx, ty, z + 0.88), (0.6, 0.6, 0.05), C['roof'])
    p.cyl((tx, ty, z + 0.93), 0.02, 0.2, C['steel'], seg=6)
    p.sphere((tx + 0.12, ty, z + 1.1), 0.09, C['trim'], scale=(1, 1, 0.4), half=True)
    # hangar along the east side
    p.box((0.95, -0.2, z), (0.5, 0.9, 0.36), C['wall2'])
    p.box((0.95, -0.2, z + 0.36), (0.54, 0.94, 0.1), C['roof'], taper=(0.8, 0.95))
    p.box((0.7, -0.2, z), (0.02, 0.6, 0.28), C['dark'], bevel=0)
    hazard(p, -1.3, -0.1, -1.3, z, C, n=8, depth=0.05)
    return {'body': p}

def depot(f):
    """Service depot: a low drive-on repair platform (vehicles park on top of it,
    so keep the middle flat) with a gantry crane along the back edge."""
    C = palette(f)
    p = Part('body')
    z = slab(p, 3, 3, C)
    p.box((0, 0, z), (1.9, 1.9, 0.04), C['steel'], bevel=0.01)
    p.torus((0, 0, z + 0.05), 0.75, 0.02, C['yellow'])
    p.torus((0, 0, z + 0.05), 0.5, 0.015, C['team'])
    for s in (-1, 1):
        hazard(p, -0.95, 0.95, s * 0.98, z + 0.04, C, n=10, depth=0.07)
    # gantry crane over the back edge
    for x in (-1.25, 1.25):
        p.box((x, 1.2, z), (0.12, 0.12, 1.0), C['accent'], bevel=0.01)
    p.box((0, 1.2, z + 1.0), (2.62, 0.16, 0.12), C['accent'], bevel=0.01)
    p.box((0.25, 1.2, z + 0.82), (0.3, 0.26, 0.18), C['dark'])
    p.cyl((0.25, 1.2, z + 0.45), 0.012, 0.37, C['steel'], seg=4)
    p.box((0.25, 1.2, z + 0.38), (0.1, 0.1, 0.07), C['accent'])
    # tool shed on the left and lamp posts at the front corners
    p.box((-1.18, 0.1, z), (0.46, 0.9, 0.42), C['wall2'])
    p.box((-1.18, 0.1, z + 0.42), (0.52, 0.96, 0.06), C['team'], bevel=0.005)
    p.box((-0.94, 0.1, z + 0.05), (0.02, 0.4, 0.3), C['dark'], bevel=0)
    for (x, y) in ((1.3, -1.3), (-1.3, -1.3)):
        p.cyl((x, y, z), 0.025, 0.5, C['steel'], seg=6)
        p.sphere((x, y, z + 0.52), 0.05, C['glow'])
    return {'body': p}

def shipyard(f):
    """Naval yard placed on water: a U-shaped pier on pilings around a slipway
    channel that opens to the +X edge (ships leave there), a gantry crane
    astride the channel and a dock office. Nothing goes below z = 0."""
    C = palette(f)
    p = Part('body')
    dz, th = 0.08, 0.08                     # deck underside (pilings show below it) and thickness
    z = dz + th
    for s in (-1, 1):                       # side piers, channel between y = -0.64 .. 0.64
        p.box((0, s * 1.06, dz), (2.96, 0.84, th), C['concrete'], bevel=0.015)
    p.box((-1.13, 0, dz), (0.7, 1.32, th), C['concrete'], bevel=0.015)     # back pier
    for x in (-1.38, -0.6, 0.2, 1.0, 1.42):
        for s in (-1, 1):
            for yy in (0.68, 1.42):
                p.cyl((x, s * yy, 0), 0.04, dz + 0.005, C['steel'], seg=8)
    for s in (-1, 1):                       # rubber fenders and edge hazard stripes along the channel
        p.box((0.36, s * 0.625, dz - 0.03), (2.2, 0.03, th + 0.02), C['dark'], bevel=0.008)
        hazard(p, -0.72, 1.44, s * 0.7, z, C, n=12, depth=0.05)
    # slipway: a ramp from the back pier down into the water, with launch rails
    p.box((-0.45, 0, 0), (0.7, 1.0, z), C['concrete'], taper=(0.02, 1), shift=(-0.34, 0), bevel=0.01)
    for s in (-1, 1):
        p.box((-0.45, s * 0.25, 0), (0.7, 0.04, z + 0.012), C['steel'], taper=(0.02, 1), shift=(-0.34, 0), bevel=0)
    # gantry crane on rails along both piers
    for s in (-1, 1):
        for dy in (-0.06, 0.06):
            p.box((0.47, s * 0.95 + dy, z), (1.94, 0.02, 0.012), C['steel'], bevel=0)
    for x in (-0.1, 0.55):
        for s in (-1, 1):
            p.box((x, s * 0.95, z), (0.24, 0.22, 0.08), C['steel'])
            p.box((x, s * 0.95, z + 0.08), (0.1, 0.1, 0.9), C['accent'], taper=(0.8, 0.8), bevel=0.01)
        p.box((x, 0, z + 0.98), (0.12, 2.1, 0.12), C['accent'], bevel=0.01)
    for s in (-1, 1):
        p.box((0.225, s * 0.95, z + 0.98), (0.77, 0.08, 0.08), C['accent'], bevel=0.01)
    for k in range(4):                      # cross bracing
        p.box((-0.1 if k < 2 else 0.55, (1 if k % 2 else -1) * 0.95, z + 0.45), (0.12, 0.12, 0.025), C['dark'], bevel=0)
    p.box((0.225, 0.2, z + 1.1), (0.78, 0.26, 0.12), C['team'], bevel=0.01)     # trolley
    p.box((0.225, 0.2, z + 0.84), (0.2, 0.18, 0.26), C['wall2'], bevel=0.01)    # operator cab
    p.box((0.33, 0.2, z + 0.88), (0.015, 0.14, 0.07), C['glass'], bevel=0)
    p.cyl((0.225, 0.2, z + 0.42), 0.006, 0.42, C['dark'], seg=4)
    p.box((0.225, 0.2, z + 0.34), (0.08, 0.08, 0.08), C['yellow'], bevel=0.01)  # hook block
    # dock office on the back corner
    ox, oy = -1.05, 1.05
    p.box((ox, oy, z), (0.62, 0.56, 0.46), C['wall'])
    p.box((ox, oy, z + 0.34), (0.66, 0.6, 0.07), C['team'], bevel=0.01)
    p.box((ox, oy, z + 0.46), (0.66, 0.6, 0.05), C['roof'])
    for i in range(3):
        p.box((ox + 0.315, oy - 0.18 + i * 0.18, z + 0.16), (0.02, 0.1, 0.1), C['glass'], bevel=0)
    for i in range(2):
        p.box((ox - 0.12 + i * 0.25, oy - 0.285, z + 0.16), (0.12, 0.02, 0.1), C['glass'], bevel=0)
    if f == 'allied':
        p.sphere((ox - 0.1, oy + 0.05, z + 0.51), 0.12, C['trim'], scale=(1, 1, 0.7), half=True)
    else:
        p.cyl((ox - 0.15, oy + 0.1, z + 0.51), 0.05, 0.35, C['steel'], seg=12)
        p.cyl((ox - 0.15, oy + 0.1, z + 0.86), 0.06, 0.04, C['dark'], seg=12)
    p.cyl((ox + 0.15, oy - 0.1, z + 0.51), 0.012, 0.3, C['steel'], seg=6)
    # front pier: fuel tanks, crates, bollards
    for x in (-1.1, -0.8):
        p.cyl((x, -1.1, z), 0.13, 0.3, C['wall2'], seg=20)
        p.cyl((x, -1.1, z + 0.3), 0.135, 0.03, C['team'], seg=20)
    for (x, y) in ((-0.5, -1.28), (-0.34, -1.28), (-0.42, -1.12)):
        p.box((x, y, z), (0.14, 0.14, 0.13), mat('#9a7a4a', rough=0.9, name='crate'))
    for x in (0.0, 0.5, 1.0):
        for s in (-1, 1):
            p.cyl((x, s * 0.78, z), 0.025, 0.05, C['dark'], seg=8)
    # navigation lights at the channel mouth: red on one side, green on the other
    for s, col in ((-1, '#ff4a3a'), (1, '#5dff7a')):
        p.cyl((1.4, s * 0.8, z), 0.03, 0.14, C['dark'], seg=8)
        p.sphere((1.4, s * 0.8, z + 0.16), 0.03, mat(col, emit=5.0, name='navlight' + col))
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
    body.cyl((-L / 2 + 0.12, 0.2, 0.32), 0.035, 0.32, C['steel'], seg=8)
    if f == 'allied':
        return {'body': body}
    # pintle machine gun on a post just behind the cab. It sits on the unit's
    # origin because the game turns turret sheets about the unit centre.
    tur = Part('turret')
    tur.cyl((0, 0, 0.5), 0.022, 0.2, C['steel'], seg=8)
    tur.cyl((0, 0, 0.69), 0.04, 0.03, C['hull2'], seg=12)
    tur.box((0.02, 0, 0.72), (0.14, 0.05, 0.05), C['dark'], bevel=0.006)
    tur.box((0.1, 0, 0.7), (0.02, 0.14, 0.1), C['team'], bevel=0.004)           # gun shield
    tur.box((0.03, 0.035, 0.7), (0.06, 0.03, 0.04), C['metal'], bevel=0.004)   # ammo box
    tur.cyl((0.09, 0, 0.745), 0.011, 0.2, C['dark'], axis='X', seg=6)
    tur.cyl((0.28, 0, 0.745), 0.016, 0.025, C['dark'], axis='X', seg=8)
    return {'body': body, 'turret': tur}

def beam_tank(f):
    """Light hull with a turret-mounted focusing crystal."""
    C = palette(f)
    body, tur = Part('body'), Part('turret')
    L, W = 0.98, 0.6
    tracks(body, L, W / 2 - 0.09, 0.2, 0.17, C)
    body.hull((0, 0, 0.08), L * 0.98, W - 0.1, 0.16, C['hull'], nose=0.22, tail=0.1, top_w=0.85)
    for s in (-1, 1):
        body.box((0, s * (W / 2 - 0.09), 0.17), (L * 0.96, 0.22, 0.03), C['hull2'])
    body.box((-0.12, 0, 0.24), (L * 0.36, W * 0.5, 0.018), C['team'], bevel=0.004)
    body.box((-L / 2 + 0.07, 0, 0.18), (0.08, 0.3, 0.06), C['dark'])
    crystal = mat('#bdefff', metal=0.1, rough=0.05, emit=2.5, name='crystal')
    tur.cyl((-0.02, 0, 0.24), 0.2, 0.07, C['team'], seg=16, r2=0.17)
    tur.cyl((-0.02, 0, 0.31), 0.13, 0.05, C['metal'], seg=12)
    tur.box((0.02, 0, 0.33), (0.24, 0.17, 0.13), C['trim'], taper=(0.65, 0.75), shift=(0.03, 0))
    for s in (-1, 1):
        tur.box((0.0, s * 0.1, 0.33), (0.16, 0.03, 0.16), C['steel'], taper=(0.5, 1), shift=(0.03, 0))
    tur.cyl((0.04, 0, 0.46), 0.075, 0.07, crystal, seg=6, r2=0.09)
    tur.cyl((0.04, 0, 0.53), 0.09, 0.13, crystal, seg=6, r2=0.0)
    tur.cyl((0.12, 0, 0.4), 0.035, 0.12, C['steel'], axis='X', seg=10)
    tur.cyl((0.24, 0, 0.4), 0.03, 0.025, crystal, axis='X', seg=10)
    return {'body': body, 'turret': tur}


def siege_launcher(f):
    """Six-wheeled truck with an inclined launch rail; the missile is its own
    part so the game can hide it while the launcher reloads."""
    C = palette(f)
    body, msl = Part('body'), Part('missile')
    L, W = 1.2, 0.56
    for x in (-0.42, -0.14, 0.38):
        for s in (-1, 1):
            body.cyl((x, -0.3 if s < 0 else 0.23, 0.1), 0.1, 0.07, C['tread'], axis='Y', seg=14)
            body.cyl((x, -0.305 if s < 0 else 0.3, 0.1), 0.05, 0.005, C['steel'], axis='Y', seg=10)
    body.box((0, 0, 0.1), (L, W - 0.14, 0.1), C['hull2'])
    for s in (-1, 1):
        body.box((-0.28, s * 0.25, 0.2), (0.62, 0.06, 0.04), C['hull2'], bevel=0.01)
        body.box((0.38, s * 0.25, 0.2), (0.24, 0.06, 0.04), C['hull2'], bevel=0.01)
    cab_x = L / 2 - 0.16
    body.box((cab_x, 0, 0.18), (0.3, W - 0.06, 0.28), C['hull'], taper=(0.8, 0.95), shift=(-0.03, 0))
    body.box((cab_x + 0.12, 0, 0.33), (0.02, W - 0.2, 0.09), C['glass'], bevel=0)
    body.box((cab_x - 0.03, 0, 0.46), (0.2, W - 0.16, 0.02), C['team'], bevel=0.004)
    body.box((-0.15, 0, 0.2), (0.82, W - 0.04, 0.05), C['hull'])
    body.box((-0.47, 0, 0.25), (0.12, 0.22, 0.08), C['dark'])
    body.box((-0.06, 0, 0.25), (0.06, 0.09, 0.13), C['steel'])
    rail = Part('rail', body)
    rail.root.location = (-0.5, 0, 0.29)
    rail.root.rotation_euler.y = math.radians(-16)
    rail.box((0.42, 0, 0), (0.86, 0.13, 0.035), C['steel'])
    for s in (-1, 1):
        rail.box((0.42, s * 0.06, 0.035), (0.8, 0.015, 0.03), C['dark'], bevel=0)
    tilt = Part('mtilt', msl)
    tilt.root.location = (-0.5, 0, 0.29)
    tilt.root.rotation_euler.y = math.radians(-16)
    white = mat('#d9d6cc', metal=0.3, rough=0.45, name='missile')
    tilt.cyl((0.02, 0, 0.1), 0.07, 0.72, white, axis='X', seg=14)
    tilt.cyl((0.3, 0, 0.1), 0.072, 0.06, C['team'], axis='X', seg=14)
    tilt.cyl((0.74, 0, 0.1), 0.07, 0.2, mat('#c8452f', rough=0.5, name='warhead'), axis='X', seg=14, r2=0.0)
    tilt.box((0.08, 0, 0.094), (0.12, 0.26, 0.012), C['dark'], bevel=0)     # tail fins
    tilt.box((0.08, 0, -0.03), (0.12, 0.012, 0.26), C['dark'], bevel=0)
    return {'body': body, 'missile': msl}


def leech_drone(f):
    """Small six-legged robot."""
    C = palette(f)
    body = Part('body')
    body.sphere((0, 0, 0.13), 0.1, C['steel'], scale=(1.25, 1, 0.55))
    body.sphere((-0.01, 0, 0.15), 0.075, C['team'], scale=(1.1, 1, 0.6), half=True)
    body.sphere((0.1, 0, 0.13), 0.028, mat('#ff4030', emit=6.0, name='eye'))
    for s in (-1, 1):
        body.box((0.11, s * 0.035, 0.08), (0.05, 0.012, 0.02), C['dark'], bevel=0, shift=(0.03, 0))
    for x in (0.07, 0.0, -0.07):
        for s in (-1, 1):
            kx, ky, kz = x * 1.6, s * 0.17, 0.2
            body.box((x, s * 0.07, 0.12), (0.022, 0.022, kz - 0.12), C['metal'], bevel=0,
                     shift=(kx - x, ky - s * 0.07))
            fx, fy = x * 2.0, s * 0.25
            body.box((fx, fy, 0), (0.02, 0.02, kz), C['dark'], bevel=0, shift=(kx - fx, ky - fy))
    return {'body': body}

def ifv(f):
    """Fast 4x4 infantry fighting vehicle with a twin missile pod turret."""
    C = palette(f)
    body, tur = Part('body'), Part('turret')
    L, W = 0.98, 0.56
    for x in (-0.3, 0.3):
        for s in (-1, 1):
            body.cyl((x, -0.31 if s < 0 else 0.22, 0.11), 0.11, 0.09, C['tread'], axis='Y', seg=16)
            body.cyl((x, -0.315 if s < 0 else 0.31, 0.11), 0.055, 0.005, C['steel'], axis='Y', seg=10)
    body.hull((0, 0, 0.09), L, W - 0.1, 0.2, C['hull'], nose=0.28, tail=0.06, top_w=0.82)
    for s in (-1, 1):
        body.box((0, s * 0.22, 0.2), (0.86, 0.1, 0.03), C['hull2'], bevel=0.01)      # fenders
    body.box((-0.1, 0, 0.29), (0.42, 0.3, 0.018), C['team'], bevel=0.004)
    body.box((-L / 2 + 0.005, 0, 0.12), (0.02, 0.22, 0.14), C['dark'], bevel=0)   # rear door
    body.box((0.27, 0, 0.27), (0.07, 0.26, 0.012), C['glass'], bevel=0)             # vision block
    tur.cyl((0.02, 0, 0.29), 0.13, 0.06, C['hull2'], seg=14)
    tur.box((0.02, 0, 0.35), (0.16, 0.12, 0.08), C['team'], bevel=0.01)
    for s in (-1, 1):
        tur.box((0.04, s * 0.11, 0.33), (0.24, 0.08, 0.1), C['hull'], bevel=0.01)
        for dy in (-0.02, 0.02):
            tur.cyl((0.16, s * 0.11 + dy, 0.38), 0.016, 0.01, C['dark'], axis='X', seg=8)
    tur.cyl((-0.08, 0.05, 0.43), 0.006, 0.18, C['dark'], seg=4)
    return {'body': body, 'turret': tur}


def halftrack(f):
    """Half-track troop carrier: wheels up front, tracks behind, open troop bed
    with a twin flak gun on a pedestal."""
    C = palette(f)
    body, tur = Part('body'), Part('turret')
    W = 0.6
    for s in (-1, 1):   # rear tracks
        body.box((-0.2, s * 0.21, 0), (0.62, 0.16, 0.17), C['tread'], bevel=0.035)
        for i in range(4):
            body.cyl((-0.44 + i * 0.16, -0.3 if s < 0 else 0.28, 0.08), 0.06, 0.02, C['steel'], axis='Y', seg=10)
    for s in (-1, 1):   # front wheels
        body.cyl((0.4, -0.3 if s < 0 else 0.21, 0.1), 0.1, 0.09, C['tread'], axis='Y', seg=16)
    body.box((0.0, 0, 0.1), (1.12, W - 0.14, 0.1), C['hull2'])
    # engine bay and cab
    body.box((0.44, 0, 0.18), (0.26, 0.4, 0.14), C['hull'], taper=(0.85, 0.9), shift=(-0.02, 0))
    body.box((0.24, 0, 0.18), (0.16, W - 0.06, 0.22), C['hull'])
    body.box((0.325, 0, 0.3), (0.012, W - 0.16, 0.08), C['glass'], bevel=0)
    body.box((0.24, 0, 0.4), (0.12, W - 0.1, 0.018), C['team'], bevel=0.004)
    # open troop bed: floor and side walls
    body.box((-0.25, 0, 0.2), (0.78, W - 0.06, 0.03), C['dark'], bevel=0)
    for s in (-1, 1):
        body.box((-0.25, s * (W / 2 - 0.04), 0.2), (0.78, 0.035, 0.17), C['hull'], bevel=0.008)
        body.box((-0.25, s * (W / 2 - 0.035), 0.3), (0.5, 0.04, 0.04), C['team'], bevel=0.004)
    body.box((-0.63, 0, 0.2), (0.035, W - 0.06, 0.17), C['hull'], bevel=0.008)
    # twin flak gun on the rear pedestal
    tur.cyl((-0.3, 0, 0.23), 0.06, 0.14, C['steel'], seg=10)
    tur.box((-0.3, 0, 0.35), (0.16, 0.16, 0.08), C['hull2'], bevel=0.01)
    tur.box((-0.34, 0, 0.36), (0.03, 0.2, 0.12), C['steel'], bevel=0.005)          # gun shield
    for dy in (-0.035, 0.035):
        tur.cyl((-0.25, dy, 0.4), 0.018, 0.4, C['dark'], axis='X', seg=8)
        tur.cyl((0.1, dy, 0.4), 0.026, 0.05, C['dark'], axis='X', seg=8)
    return {'body': body, 'turret': tur}


def veil_tank(f):
    """Low faceted stealth tank: slanted skirts over the tracks and a slim
    turret with a twin missile pod on each side."""
    C = palette(f)
    body, tur = Part('body'), Part('turret')
    skin = mat('#5f666e', metal=0.4, rough=0.45, name='stealth')
    L, W = 0.92, 0.58
    tracks(body, L - 0.06, W / 2 - 0.1, 0.18, 0.13, C)
    body.hull((0, 0, 0.06), L, W - 0.08, 0.14, skin, nose=0.3, tail=0.14, top_w=0.68)
    for s in (-1, 1):       # slanted side skirts
        body.box((0, s * (W / 2 - 0.03), 0.04), (L * 0.9, 0.05, 0.12), skin, taper=(0.86, 0.4), shift=(0, -s * 0.03))
        body.box((0.02, s * (W / 2 - 0.06), 0.16), (L * 0.5, 0.012, 0.012), C['team'], bevel=0)
    body.box((-0.1, 0, 0.2), (0.3, 0.18, 0.012), C['team'], bevel=0.003)
    body.box((L / 2 - 0.2, 0, 0.145), (0.06, 0.24, 0.03), C['dark'], bevel=0, shift=(-0.02, 0))   # sensor slit
    body.box((-L / 2 + 0.08, 0, 0.12), (0.05, 0.3, 0.05), C['dark'], bevel=0.004)                # baffled exhaust
    red = mat('#c8452f', rough=0.5, name='warhead')
    tur.hull((-0.04, 0, 0.2), 0.38, 0.26, 0.07, skin, nose=0.12, tail=0.08, top_w=0.6)
    tur.box((-0.05, 0, 0.27), (0.12, 0.09, 0.025), C['team'], taper=(0.7, 0.7), bevel=0.003)
    tur.cyl((-0.14, 0.06, 0.27), 0.005, 0.18, C['dark'], seg=4)
    for s in (-1, 1):
        tur.box((-0.02, s * 0.14, 0.23), (0.08, 0.05, 0.04), C['steel'], bevel=0.005)
        tur.box((0.0, s * 0.19, 0.22), (0.34, 0.08, 0.08), skin, taper=(0.85, 0.8), shift=(-0.02, 0))
        tur.box((-0.01, s * 0.19, 0.3), (0.26, 0.06, 0.008), C['team'], bevel=0)
        for dz in (-0.02, 0.02):
            tur.cyl((0.165, s * 0.19, 0.26 + dz), 0.017, 0.02, C['dark'], axis='X', seg=10)
            tur.cyl((0.18, s * 0.19, 0.26 + dz), 0.013, 0.035, red, axis='X', seg=10, r2=0.0)
    return {'body': body, 'turret': tur}

# ================================================================ ships
# Ships float with the waterline at z = 0 and nothing below it. Turrets sit on
# the origin because the game turns turret sheets about the unit centre.

def navy(f):
    """Ship paint and deck materials."""
    return (mat('#8b949c' if f == 'allied' else '#6f6d63', metal=0.35, rough=0.5, grime=0.2, name='navy_' + f),
            mat('#4f5358' if f == 'allied' else '#4a4640', rough=0.8, grime=0.3, name='deck_' + f))


def ship_outline(l, w, bow):
    """Top view of a hull along +X (counter-clockwise): cut stern, pointed bow."""
    return [(-l, -w * 0.75), (-l + 0.1, -w), (l - bow, -w), (l - bow * 0.4, -w * 0.55), (l, 0),
            (l - bow * 0.4, w * 0.55), (l - bow, w), (-l + 0.1, w), (-l, w * 0.75)]


def ship_hull(p, L, W, h, bow, skin, deck, C):
    """Waterline stripe, hull sides and deck. Returns the deck height."""
    p.prism((0, 0, 0), ship_outline(L / 2, W / 2, bow), 0.03, C['dark'], bevel=0.004)
    p.prism((0, 0, 0.03), ship_outline(L / 2 + 0.01, W / 2 + 0.01, bow), h - 0.03, skin, bevel=0.012)
    p.prism((0, 0, h), ship_outline(L / 2 - 0.025, W / 2 - 0.025, bow * 0.96), 0.01, deck, bevel=0)
    return h + 0.01


def hull_band(p, x, length, W, z, C):
    """Team-colour band along both sides of the hull just below the deck edge."""
    for s in (-1, 1):
        p.box((x, s * (W / 2 + 0.012), z - 0.06), (length, 0.012, 0.035), C['team'], bevel=0)


def lander(f):
    """Landing craft for vehicles: open well deck between high sides, a bow
    ramp (raised), and the bridge at the stern."""
    C = palette(f)
    skin, deck = navy(f)
    body = Part('body')
    L, W = 1.7, 0.66
    z = ship_hull(body, L, W, 0.14, 0.12, skin, deck, C)
    for s in (-1, 1):
        body.box((0.1, s * (W / 2 - 0.035), z), (L - 0.52, 0.05, 0.12), skin, bevel=0.008)
        body.box((0.1, s * (W / 2 - 0.035), z + 0.12), (L - 0.52, 0.056, 0.02), C['team'], bevel=0.004)
    # bow ramp, hinged at the deck and leaning back a little
    rx = L / 2 - 0.1
    body.cyl((rx - 0.02, -(W - 0.16) / 2, z), 0.02, W - 0.16, C['steel'], axis='Y', seg=8)
    body.box((rx, 0, z), (0.04, W - 0.12, 0.2), skin, shift=(-0.04, 0), bevel=0.008)
    for s in (-1, 1):
        body.box((rx + 0.002, s * 0.1, z + 0.05), (0.04, 0.12, 0.012), C['team'], shift=(-0.02, 0), bevel=0)
    # well deck markings
    body.box((0.15, 0, z), (0.9, 0.02, 0.004), C['yellow'], bevel=0)
    for x in (-0.3, 0.05, 0.4):
        for s in (-1, 1):
            body.box((x, s * 0.2, z), (0.03, 0.03, 0.012), C['yellow'], bevel=0)
    # stern bridge
    body.box((-0.62, 0, z), (0.3, W - 0.14, 0.2), skin, bevel=0.01)
    body.box((-0.61, 0, z + 0.2), (0.2, 0.34, 0.14), C['wall2'], taper=(0.9, 0.95), bevel=0.01)
    body.box((-0.51, 0, z + 0.25), (0.02, 0.28, 0.05), C['glass'], bevel=0)
    body.box((-0.61, 0, z + 0.34), (0.24, 0.38, 0.02), C['team'], bevel=0.004)
    body.cyl((-0.66, 0, z + 0.36), 0.012, 0.3, C['steel'], seg=6)
    body.box((-0.66, 0, z + 0.56), (0.02, 0.2, 0.015), C['dark'], bevel=0)
    for s in (-1, 1):
        body.cyl((-0.76, s * 0.2, z), 0.035, 0.28, C['dark'], seg=10)
    return {'body': body}


def frigate(f):
    """Gun frigate: sharp bow, a gun turret midships, bridge, mast and funnel aft."""
    C = palette(f)
    skin, deck = navy(f)
    body, tur = Part('body'), Part('turret')
    L, W = 1.9, 0.5
    z = ship_hull(body, L, W, 0.18, 0.45, skin, deck, C)
    hull_band(body, -0.1, 1.0, W, z, C)
    body.box((0.42, 0, z), (0.02, 0.3, 0.05), skin, bevel=0.005)                 # breakwater
    body.cyl((0.62, 0.05, z), 0.02, 0.02, C['dark'], seg=8)                      # anchor gear
    body.box((0.7, 0, z), (0.14, 0.012, 0.006), C['dark'], bevel=0)
    body.box((-0.42, 0, z), (0.42, 0.34, 0.16), skin, taper=(0.95, 0.9), bevel=0.01)
    body.box((-0.3, 0, z + 0.16), (0.18, 0.26, 0.12), skin, taper=(0.9, 0.9), bevel=0.01)
    body.box((-0.215, 0, z + 0.2), (0.02, 0.22, 0.05), C['glass'], bevel=0)
    body.box((-0.3, 0, z + 0.28), (0.2, 0.3, 0.02), C['team'], bevel=0.004)
    body.box((-0.34, 0, z + 0.3), (0.05, 0.05, 0.3), C['steel'], taper=(0.4, 0.4), bevel=0)
    body.box((-0.34, 0, z + 0.48), (0.03, 0.24, 0.015), C['dark'], bevel=0)
    body.box((-0.34, 0, z + 0.6), (0.03, 0.14, 0.035), C['trim'], bevel=0.004)
    body.box((-0.55, 0, z + 0.16), (0.16, 0.14, 0.2), skin, taper=(0.85, 0.85), shift=(-0.02, 0), bevel=0.01)
    body.box((-0.57, 0, z + 0.36), (0.14, 0.12, 0.03), C['dark'], bevel=0.004)
    body.box((-0.8, 0, z), (0.12, 0.28, 0.03), C['dark'], bevel=0.004)           # depth charge rack
    tur.cyl((0, 0, z), 0.13, 0.04, C['steel'], seg=16)
    tur.hull((-0.01, 0, z + 0.04), 0.3, 0.22, 0.11, skin, nose=0.1, tail=0.03, top_w=0.8)
    tur.box((-0.03, 0, z + 0.15), (0.12, 0.12, 0.012), C['team'], bevel=0.003)
    tur.cyl((0.1, 0, z + 0.1), 0.02, 0.36, C['steel'], axis='X', seg=10)
    tur.cyl((0.44, 0, z + 0.1), 0.028, 0.03, C['dark'], axis='X', seg=10)
    return {'body': body, 'turret': tur}


def picket(f):
    """Air-defence cruiser: radar mast and radome aft, a tilted missile box
    launcher midships."""
    C = palette(f)
    skin, deck = navy(f)
    body, tur = Part('body'), Part('turret')
    L, W = 1.9, 0.52
    z = ship_hull(body, L, W, 0.18, 0.42, skin, deck, C)
    hull_band(body, -0.1, 1.0, W, z, C)
    body.cyl((0.55, 0, z), 0.06, 0.06, skin, seg=14)                              # close-in gun dome
    body.sphere((0.55, 0, z + 0.06), 0.06, C['trim'], half=True)
    body.cyl((0.6, 0, z + 0.09), 0.008, 0.08, C['dark'], axis='X', seg=6)
    body.box((-0.5, 0, z), (0.5, 0.36, 0.18), skin, bevel=0.01)
    body.box((-0.35, 0, z + 0.18), (0.2, 0.28, 0.12), skin, taper=(0.9, 0.9), bevel=0.01)
    body.box((-0.255, 0, z + 0.22), (0.02, 0.24, 0.05), C['glass'], bevel=0)
    body.box((-0.35, 0, z + 0.3), (0.22, 0.3, 0.02), C['team'], bevel=0.004)
    # lattice radar mast
    body.box((-0.47, 0, z + 0.18), (0.12, 0.12, 0.44), C['steel'], taper=(0.35, 0.35), bevel=0)
    for k in range(3):
        body.box((-0.47, 0, z + 0.3 + k * 0.1), (0.13 - k * 0.02, 0.13 - k * 0.02, 0.012), C['dark'], bevel=0)
    body.box((-0.47, 0, z + 0.62), (0.04, 0.28, 0.1), C['trim'], bevel=0.006)
    body.box((-0.445, 0, z + 0.65), (0.008, 0.2, 0.04), C['team'], bevel=0)
    body.sphere((-0.64, 0, z + 0.18), 0.08, C['trim'], half=True)                # radome
    body.box((-0.84, 0, z), (0.1, 0.26, 0.04), C['dark'], bevel=0.004)
    tur.cyl((0, 0, z), 0.12, 0.05, C['steel'], seg=16)
    tur.box((0, 0, z + 0.05), (0.16, 0.18, 0.06), skin, bevel=0.008)
    for s in (-1, 1):
        tur.box((0, s * 0.11, z + 0.05), (0.08, 0.03, 0.13), C['steel'], bevel=0.004)
    box = Part('mbox', tur)
    box.root.location = (0, 0, z + 0.17)
    box.root.rotation_euler.y = math.radians(-22)
    box.box((0, 0, -0.07), (0.28, 0.2, 0.14), skin, bevel=0.01)
    box.box((-0.02, 0, 0.07), (0.22, 0.16, 0.01), C['team'], bevel=0)
    red = mat('#c8452f', rough=0.5, name='warhead')
    for i in range(3):
        for j in range(2):
            y, zz = -0.06 + i * 0.06, -0.025 + j * 0.05
            box.box((0.14, y, zz - 0.02), (0.008, 0.046, 0.04), C['dark'], bevel=0)
            box.cyl((0.14, y, zz), 0.013, 0.008, red, axis='X', seg=8)
    return {'body': body, 'turret': tur}


def sub(f):
    """Attack submarine running on the surface: long low rounded hull with a
    conning tower and an upper stern fin. Body only."""
    C = palette(f)
    body = Part('body')
    dark = mat('#2f3336', metal=0.3, rough=0.55, grime=0.25, name='subhull')
    L, R = 2.0, 0.2
    body.sphere((0, 0, 0), R, dark, scale=(L / 2 / R, 1, 0.9), seg=24, half=True)
    body.box((0.05, 0, 0.12), (1.2, 0.14, 0.07), dark, taper=(0.95, 0.8), bevel=0.01)      # deck casing
    body.box((-0.5, 0, 0.19), (0.3, 0.05, 0.006), C['team'], bevel=0)
    for x in (0.5, -0.3):
        body.cyl((x, 0, 0.19), 0.028, 0.012, C['steel'], seg=10)                          # hatches
    # conning tower
    body.box((0.15, 0, 0.15), (0.36, 0.12, 0.26), dark, taper=(0.8, 0.85), shift=(-0.03, 0), bevel=0.012)
    body.box((0.133, 0, 0.3), (0.325, 0.116, 0.04), C['team'], bevel=0.005)
    body.box((0.2, 0, 0.3), (0.08, 0.34, 0.012), dark, bevel=0.004)                    # sail planes
    body.cyl((0.1, 0.02, 0.41), 0.01, 0.12, C['steel'], seg=6)                         # periscope
    body.cyl((0.16, -0.02, 0.41), 0.008, 0.08, C['steel'], seg=6)
    body.box((-0.95, 0, 0.04), (0.14, 0.018, 0.16), dark, taper=(0.5, 1), shift=(-0.04, 0), bevel=0.003)
    return {'body': body}


def flakboat(f):
    """Fast patrol boat with a twin flak mount midships and a wheelhouse aft."""
    C = palette(f)
    skin, deck = navy(f)
    body, tur = Part('body'), Part('turret')
    L, W = 1.3, 0.4
    z = ship_hull(body, L, W, 0.14, 0.34, skin, deck, C)
    hull_band(body, -0.05, 0.7, W, z, C)
    body.box((0.36, 0, z), (0.12, 0.12, 0.004), C['team'], bevel=0, rot=math.radians(45))
    body.box((-0.3, 0, z), (0.26, 0.28, 0.16), skin, taper=(0.9, 0.9), bevel=0.01)
    body.box((-0.172, 0, z + 0.08), (0.02, 0.22, 0.05), C['glass'], bevel=0)
    body.box((-0.3, 0, z + 0.16), (0.22, 0.24, 0.02), C['team'], bevel=0.004)
    body.cyl((-0.34, 0, z + 0.18), 0.01, 0.22, C['steel'], seg=6)
    body.box((-0.34, 0, z + 0.34), (0.02, 0.16, 0.012), C['dark'], bevel=0)
    for s in (-1, 1):
        body.cyl((-0.52, s * 0.1, z), 0.025, 0.1, C['dark'], seg=8)
    tur.cyl((0, 0, z), 0.1, 0.04, C['steel'], seg=14)
    tur.box((0, 0, z + 0.04), (0.14, 0.18, 0.08), skin, bevel=0.008)
    tur.box((-0.03, 0, z + 0.04), (0.03, 0.24, 0.14), C['steel'], bevel=0.005)          # gun shield
    tur.box((0.01, 0, z + 0.12), (0.1, 0.1, 0.01), C['team'], bevel=0)
    for dy in (-0.035, 0.035):
        tur.cyl((0.02, dy, z + 0.13), 0.018, 0.34, C['dark'], axis='X', seg=8)
        tur.cyl((0.34, dy, z + 0.13), 0.026, 0.05, C['dark'], axis='X', seg=8)
    return {'body': body, 'turret': tur}

# ================================================================ aircraft
# Aircraft are built around the origin (their centre of mass) and rendered with
# no ground: the game draws them at altitude and paints their shadow itself.

def jet(f):
    """Delta-wing strike jet. Its bombs are a separate part, hidden once dropped."""
    C = palette(f)
    body, bombs = Part('body'), Part('bombs')
    skin = mat('#aab4bd' if f == 'allied' else '#9a9282', metal=0.5, rough=0.35, name='jetskin_' + f)
    body.cyl((-0.5, 0, 0), 0.07, 0.86, skin, axis='X', seg=16)
    body.cyl((0.36, 0, 0), 0.07, 0.22, skin, axis='X', seg=16, r2=0.0)
    body.cyl((-0.56, 0, 0), 0.05, 0.07, C['dark'], axis='X', seg=12)                 # exhaust
    body.sphere((0.2, 0, 0.055), 0.06, C['glass'], scale=(2.0, 0.8, 0.7))            # canopy
    wing = [(0.18, 0.05), (-0.42, 0.52), (-0.5, 0.52), (-0.46, 0.05)]
    for s in (-1, 1):
        body.prism((0, 0, -0.015), [(x, s * y) for x, y in (wing if s > 0 else reversed(wing))], 0.02, skin, bevel=0.005)
        body.box((-0.46, s * 0.49, -0.018), (0.1, 0.05, 0.026), C['team'], bevel=0)   # wing tips
        body.box((0.05, s * 0.1, -0.06), (0.26, 0.05, 0.06), C['hull2'], bevel=0.01)   # intakes
    body.box((-0.42, 0, 0.05), (0.2, 0.015, 0.2), skin, taper=(0.35, 1), shift=(-0.1, 0), bevel=0)  # fin
    body.box((-0.47, 0, 0.19), (0.07, 0.02, 0.05), C['team'], bevel=0)
    body.box((-0.1, 0, 0.066), (0.3, 0.06, 0.012), C['team'], bevel=0)
    red = mat('#c8452f', rough=0.5, name='warhead')
    for s in (-1, 1):
        bombs.cyl((-0.2, s * 0.26, -0.07), 0.035, 0.26, C['dark'], axis='X', seg=10)
        bombs.cyl((0.06, s * 0.26, -0.07), 0.035, 0.06, red, axis='X', seg=10, r2=0.0)
        bombs.box((-0.07, s * 0.26, -0.04), (0.08, 0.01, 0.03), C['steel'], bevel=0)
    return {'body': body, 'bombs': bombs}


def airship(f):
    """Heavy bomber airship: long envelope, gondola, fins and engine pods."""
    C = palette(f)
    body = Part('body')
    env = mat('#8a8676' if f == 'soviet' else '#9aa0a6', metal=0.1, rough=0.6, grime=0.25, name='envelope_' + f)
    L, R = 1.15, 0.36
    body.sphere((0, 0, 0.12), R, env, scale=(L / R, 1, 1), seg=32)
    for x in (-0.55, 0.05, 0.6):                     # rigid frame bands
        r = R * math.sqrt(max(0.0, 1 - (x / L) ** 2)) + 0.006
        body.cyl((x - 0.02, 0, 0.12), r, 0.04, C['team'] if x == 0.05 else C['steel'], axis='X', seg=32)
    for a in (0, 90, 180, 270):                      # cruciform tail fins
        r = math.radians(a)
        cy, cz = math.cos(r), math.sin(r)
        if a in (0, 180):
            body.box((-0.95, cy * 0.2, 0.11), (0.3, 0.3, 0.02), C['hull2'], taper=(0.4, 1), shift=(-0.08, cy * 0.1), bevel=0.005)
        else:
            body.box((-0.95, 0, 0.12 if cz > 0 else -0.18), (0.3, 0.02, 0.3), C['hull2'],
                     taper=(0.4, 1) if cz > 0 else (1, 1), shift=(-0.08, 0), bevel=0.005)
    # gondola underneath with a bomb bay
    body.box((0.1, 0, -0.34), (0.62, 0.2, 0.14), C['hull'], taper=(0.9, 0.9), bevel=0.02)
    body.box((0.36, 0, -0.3), (0.1, 0.16, 0.07), C['glass'], taper=(0.6, 0.8), bevel=0.01)
    body.box((-0.05, 0, -0.35), (0.26, 0.12, 0.012), C['dark'], bevel=0)
    body.box((0.1, 0, -0.2), (0.4, 0.08, 0.02), C['steel'], bevel=0)
    # engine pods with propellers
    for s in (-1, 1):
        body.cyl((-0.25, s * 0.42, -0.08), 0.06, 0.26, C['hull2'], axis='X', seg=14)
        body.box((-0.12, s * 0.33, -0.06), (0.1, 0.16, 0.025), C['steel'], bevel=0)
        body.cyl((-0.3, s * 0.42, -0.08), 0.1, 0.012, mat('#3a3d42', rough=0.5, name='prop'), axis='X', seg=20)
    return {'body': body}


def heli(f):
    """Faceted stealth transport helicopter. The rotor is its own part and
    gets a few spin frames instead of facings."""
    C = palette(f)
    body, rotor = Part('body'), Part('rotor')
    skin = mat('#5f666e', metal=0.4, rough=0.45, name='stealth')
    body.box((-0.02, 0, -0.14), (0.66, 0.36, 0.26), skin, taper=(0.78, 0.8), shift=(0.03, 0), bevel=0.025)
    body.box((0.38, 0, -0.12), (0.2, 0.28, 0.18), skin, taper=(0.3, 0.6), shift=(0.06, 0), bevel=0.02)
    body.box((0.3, 0, 0.0), (0.22, 0.24, 0.1), C['glass'], taper=(0.5, 0.8), shift=(-0.04, 0), bevel=0.012)
    body.cyl((-0.82, 0, 0.0), 0.035, 0.54, skin, axis='X', seg=10, r2=0.06)     # tail boom
    for s_ in (-1, 1):
        body.box((-0.05, s_ * 0.185, -0.08), (0.42, 0.012, 0.12), C['team'], bevel=0)   # side stripes
        body.box((0.0, s_ * 0.2, -0.16), (0.2, 0.08, 0.08), C['hull2'], bevel=0.01)     # sponsons
    body.box((-0.08, 0, 0.12), (0.26, 0.16, 0.06), C['team'], bevel=0.01)
    body.box((-0.76, 0, 0.0), (0.16, 0.025, 0.2), skin, taper=(0.5, 1), shift=(-0.06, 0), bevel=0)
    body.cyl((-0.78, 0.02, 0.1), 0.08, 0.01, mat('#2d3035', name='trotor'), axis='Y', seg=16)
    body.cyl((-0.04, 0, 0.14), 0.04, 0.08, C['steel'], seg=10)                 # rotor mast
    for s_ in (-1, 1):                                                         # skids
        body.cyl((-0.3, s_ * 0.2, -0.32), 0.016, 0.62, C['dark'], axis='X', seg=8)
        for x in (-0.15, 0.15):
            body.box((x, s_ * 0.18, -0.32), (0.025, 0.025, 0.1), C['dark'], bevel=0, shift=(0, -s_ * 0.03))
    blade = mat('#2a2d31', rough=0.6, name='blade')
    rotor.cyl((-0.04, 0, 0.21), 0.06, 0.035, C['steel'], seg=12)
    for k in range(4):
        a = k * math.pi / 2
        rotor.box((-0.04 + math.cos(a) * 0.35, math.sin(a) * 0.35, 0.225), (0.7, 0.07, 0.012), blade, bevel=0, rot=a)
    return {'body': body, 'rotor': rotor}

# ================================================================ infantry

class Soldier:
    """Articulated soldier. Limb Parts pivot at the hip / shoulder.
    kind: rifle | rocket | engineer | sniper | arc | jetpack | sapper | striker | psion | isotope |
          infiltrator | blink"""
    HAND = ('engineer', 'sapper', 'psion', 'infiltrator')    # carry their tool in the hand, not a shouldered gun
    RAISE = {'sapper': -70, 'psion': -125, 'infiltrator': -88}  # tool-arm angle while firing

    def __init__(self, f, kind):
        C = palette(f)
        self.kind = kind
        self.body = Part('body')
        b = self.body
        vest = C['team']
        bulky = kind in ('arc', 'sapper', 'isotope')
        gloved = bulky or kind == 'blink'
        uniform = C['uniform']
        if kind == 'sniper':
            uniform = mat('#55603f', rough=0.9, name='ghillie')
        elif kind == 'arc':
            uniform = C['steel']
        elif kind == 'striker':
            uniform = mat('#3b4032', rough=0.85, name='fatigues')
        elif kind == 'psion':
            uniform = mat('#3a3440', rough=0.75, name='longcoat')
        elif kind == 'isotope':
            uniform = mat('#b5a642', rough=0.45, name='hazmat')
        elif kind == 'infiltrator':
            uniform = mat('#2f343d', rough=0.6, name='suit')
        elif kind == 'blink':
            uniform = mat('#b4bfcc', metal=0.45, rough=0.35, name='blinkarmor')
        torso = uniform if kind in ('psion', 'infiltrator') else vest   # coat / jacket instead of a vest
        psy = mat('#d58cff', emit=6.0, name='psyglow')
        rad = mat('#7dff5a', emit=5.0, name='radglow')
        phase = mat('#d8f0ff', emit=6.0, name='blinkglow')
        lw, tw = (0.09, 0.2) if bulky else (0.075, 0.17)
        k = 1.22 if bulky else 1.0            # limb thickness
        # legs: tapered thigh and shin with a knee between them, and a boot
        self.legs, self.knees = [], []
        for s in (-1, 1):
            leg = Part('leg', b)
            leg.root.location = (0, s * (0.05 if bulky else 0.044), 0.24)
            leg.sphere((0, 0, -0.005), 0.036 * k, uniform)
            leg.cyl((0, 0, -0.12), 0.028 * k, 0.12, uniform, seg=12, r2=0.037 * k)
            knee = Part('knee', leg)
            knee.root.location = (0, 0, -0.12)
            knee.sphere((0, 0, 0), 0.028 * k, uniform)
            knee.cyl((0, 0, -0.095), 0.022 * k, 0.095, uniform, seg=12, r2=0.028 * k)
            knee.box((0.018, 0, -0.12), (0.078, 0.042 * k, 0.034), C['dark'], bevel=0.014)
            knee.cyl((0, 0, -0.1), 0.026 * k, 0.03, C['dark'], seg=10)
            if bulky:
                knee.box((0.016, 0, -0.03), (0.035, 0.05, 0.05), vest, bevel=0.012)
            self.legs.append(leg)
            self.knees.append(knee)
        # torso, belt, pack
        b.box((0, 0, 0.225), (0.13 if bulky else 0.105, tw - 0.03, 0.21 if bulky else 0.2), torso,
              bevel=0.03, taper=(1.15, 1.22))
        b.box((0, 0, 0.225), (0.125 if bulky else 0.11, tw - 0.02, 0.028), C['dark'], bevel=0.01)
        for s in (-1, 1):
            b.sphere((0, s * (tw / 2 - 0.02), 0.405), 0.036 * k, torso)
        b.cyl((0, 0, 0.42), 0.024, 0.04, C['skin'], seg=10)                   # neck
        if kind == 'engineer':
            # big tool pack with a coil of cable
            b.box((-0.1, 0, 0.25), (0.08, 0.15, 0.17), C['hull2'], bevel=0.015)
            b.torus((-0.1, 0, 0.42), 0.05, 0.014, C['dark'])
        elif kind == 'jetpack':
            # twin-thruster flight pack with flames underneath
            b.box((-0.11, 0, 0.22), (0.09, 0.2, 0.22), C['steel'], bevel=0.015)
            b.box((-0.11, 0, 0.44), (0.07, 0.16, 0.03), vest, bevel=0.005)
            flame = mat('#ffb347', emit=10.0, name='jetflame')
            for s in (-1, 1):
                b.cyl((-0.14, s * 0.07, 0.14), 0.035, 0.12, C['dark'], seg=10)
                b.cyl((-0.14, s * 0.07, -0.12), 0.006, 0.26, flame, seg=10, r2=0.045)
        elif kind == 'arc':
            # generator pack: casing, copper coils and a glowing core
            b.box((-0.12, 0, 0.22), (0.1, 0.18, 0.2), C['dark'], bevel=0.015)
            for k in range(3):
                b.torus((-0.13, 0, 0.27 + k * 0.05), 0.06, 0.016, C['copper'])
            b.sphere((-0.13, 0, 0.43), 0.032, C['glow'])
            for s in (-1, 1):
                b.sphere((0, s * 0.11, 0.42), 0.045, vest, scale=(1.2, 1, 0.8))
        elif kind == 'sapper':
            # charge vest: blocks strapped across the chest, a satchel on the hip, fuse coil on the pack
            charge = mat('#a0522d', rough=0.7, name='charge')
            for (y, z) in ((-0.05, 0.28), (0.05, 0.28), (-0.05, 0.35), (0.05, 0.35)):
                b.box((0.08, y, z), (0.03, 0.07, 0.055), charge, bevel=0.006)
            b.box((0.097, 0, 0.3), (0.006, 0.17, 0.012), C['dark'], bevel=0)
            b.box((-0.03, -0.12, 0.12), (0.1, 0.05, 0.09), C['hull2'], bevel=0.012)
            b.box((-0.12, 0, 0.24), (0.09, 0.17, 0.16), C['hull2'], bevel=0.015)
            b.torus((-0.12, 0, 0.41), 0.045, 0.012, mat('#c83c32', rough=0.5, name='fuse'))
            for s in (-1, 1):
                b.sphere((0, s * 0.11, 0.42), 0.042, vest, scale=(1.2, 1, 0.8))
        elif kind == 'striker':
            # bandolier across the chest, holstered sidearm, light pack
            strap = mat('#4a3a28', rough=0.7, name='bandolier')
            b.box((0.068, -0.05, 0.24), (0.014, 0.03, 0.19), strap, bevel=0, shift=(0, 0.1))
            for i in range(4):
                t = (i + 0.5) / 4
                b.box((0.078, -0.05 + 0.1 * t, 0.228 + 0.19 * t), (0.012, 0.018, 0.024), C['copper'], bevel=0)
            b.box((0.0, 0.095, 0.16), (0.05, 0.02, 0.07), C['dark'], bevel=0.005)
            b.box((-0.08, 0, 0.28), (0.05, 0.12, 0.11), uniform, bevel=0.012)
        elif kind == 'psion':
            # long coat: skirt over the thighs, high collar, team sash; no pack
            b.box((-0.005, 0, 0.09), (0.16, 0.21, 0.15), uniform, bevel=0.012, taper=(0.82, 0.82))
            b.box((0, 0, 0.405), (0.12, 0.16, 0.045), uniform, bevel=0.01, taper=(1.1, 1.1))
            b.box((0.066, -0.05, 0.24), (0.012, 0.03, 0.17), vest, bevel=0, shift=(0, 0.1))
            b.box((0.0, 0, 0.222), (0.145, 0.185, 0.024), vest, bevel=0.004)
        elif kind == 'isotope':
            # sealed-suit air tanks with glowing gauges, hose running to the projector
            b.box((-0.1, 0, 0.22), (0.05, 0.18, 0.2), C['dark'], bevel=0.012)
            for s in (-1, 1):
                b.cyl((-0.145, s * 0.045, 0.2), 0.045, 0.24, C['steel'], seg=12)
                b.sphere((-0.145, s * 0.045, 0.44), 0.045, C['steel'], scale=(1, 1, 0.6), half=True)
                b.torus((-0.145, s * 0.045, 0.33), 0.047, 0.01, rad)
            b.box((-0.19, 0, 0.26), (0.02, 0.12, 0.05), vest, bevel=0.004)
            b.cyl((-0.12, -0.105, 0.3), 0.013, 0.2, C['dark'], axis='X', seg=6)
        elif kind == 'infiltrator':
            # suit jacket: white shirt front and a team-coloured tie; no pack
            shirt = mat('#e8e6df', rough=0.6, name='shirt')
            b.box((0.066, 0, 0.34), (0.008, 0.05, 0.09), shirt, bevel=0, taper=(1, 1.6))
            b.box((0.072, 0, 0.3), (0.008, 0.024, 0.12), vest, bevel=0, taper=(1, 0.55))
            for s in (-1, 1):
                b.box((0.067, s * 0.045, 0.3), (0.008, 0.03, 0.13), C['dark'], bevel=0, shift=(0, -s * 0.01))
        elif kind == 'blink':
            # phase generator pack: casing, glowing rings and core
            b.box((-0.1, 0, 0.24), (0.07, 0.16, 0.19), C['steel'], bevel=0.015)
            b.cyl((-0.16, 0, 0.25), 0.05, 0.17, C['dark'], seg=14)
            for k in range(2):
                b.torus((-0.16, 0, 0.3 + k * 0.07), 0.058, 0.012, phase)
            b.sphere((-0.16, 0, 0.45), 0.035, phase)
            for s in (-1, 1):
                b.sphere((0, s * 0.1, 0.415), 0.04, vest, scale=(1.2, 1, 0.7))
        else:
            b.box((-0.085, 0, 0.27), (0.06, 0.13, 0.13), uniform, bevel=0.015)
        # head: everything on it goes into its own part, shrunk towards the neck, so the
        # proportions read as a person rather than a toy (head about 1/7 of the height)
        body = b
        b = Part('head', body)
        b.root.location = (0, 0, 0.44)
        b.root.scale = (0.8, 0.8, 0.8)
        head_first = len(b.objects)
        b.sphere((0, 0, 0.475), 0.055, C['skin'])
        if kind == 'engineer':
            hat = mat('#e8c23c', rough=0.45, name='hardhat')
            b.sphere((0, 0, 0.49), 0.064, hat, scale=(1.05, 1, 0.9), half=True)
            b.cyl((0.012, 0, 0.485), 0.078, 0.008, hat, seg=16)
        elif kind == 'sniper':
            b.cyl((0, 0, 0.49), 0.085, 0.01, uniform, seg=14)
            b.cyl((0, 0, 0.495), 0.055, 0.04, uniform, seg=12, r2=0.045)
        elif kind == 'arc':
            b.sphere((0, 0, 0.475), 0.07, C['steel'], scale=(1.05, 1, 1.05))
            b.box((0.05, 0, 0.46), (0.03, 0.08, 0.035), C['glow'], bevel=0.004)
        elif kind == 'sapper':
            b.sphere((0, 0, 0.488), 0.068, C['helmet'], scale=(1.05, 1, 0.85), half=True)
            b.box((0.048, 0, 0.462), (0.02, 0.1, 0.03), C['dark'], bevel=0.004)      # blast goggles
            for s in (-1, 1):
                b.cyl((0.056, s * 0.024, 0.477), 0.012, 0.008, C['glass'], axis='X', seg=8)
        elif kind == 'striker':
            beret = mat('#2d2a2e', rough=0.8, name='beret')
            b.sphere((-0.004, 0.012, 0.512), 0.062, beret, scale=(1.05, 1.05, 0.42))
            b.box((0.05, -0.02, 0.505), (0.012, 0.02, 0.02), vest, bevel=0)
        elif kind == 'psion':
            # circlet with glowing points and a brow gem
            b.torus((0, 0, 0.5), 0.058, 0.009, C['steel'])
            for i in range(5):
                a = i * 2 * math.pi / 5
                b.cyl((math.cos(a) * 0.058, math.sin(a) * 0.058, 0.5), 0.008, 0.032, C['steel'], seg=6, r2=0.003)
                b.sphere((math.cos(a) * 0.058, math.sin(a) * 0.058, 0.535), 0.01, psy)
            b.box((0.054, 0, 0.49), (0.012, 0.028, 0.02), psy, bevel=0)
        elif kind == 'isotope':
            visor = mat('#2c4a36', metal=0.4, rough=0.1, emit=0.5, name='hazvisor')
            b.sphere((0, 0, 0.48), 0.075, uniform, scale=(1.05, 1, 1.0))
            b.sphere((0.035, 0, 0.485), 0.055, visor, scale=(0.9, 1, 0.72))
            b.cyl((0.065, 0, 0.44), 0.022, 0.035, C['dark'], axis='X', seg=10)       # filter canister
        elif kind == 'infiltrator':
            cap = mat('#4a4e55', rough=0.85, name='flatcap')
            b.sphere((-0.004, 0, 0.482), 0.058, mat('#3a2a1e', rough=0.8, name='hair'), scale=(1, 1, 0.9), half=True)
            b.cyl((0.004, 0, 0.5), 0.06, 0.012, vest, seg=16)                         # cap band
            b.sphere((0.006, 0, 0.51), 0.062, cap, scale=(1.1, 1.02, 0.45), half=True)
            b.box((0.062, 0, 0.505), (0.05, 0.085, 0.01), cap, bevel=0.004)          # brim
        elif kind == 'blink':
            b.sphere((0, 0, 0.48), 0.066, uniform, scale=(1.08, 1, 1.0))
            b.box((0.045, 0, 0.463), (0.03, 0.09, 0.028), phase, bevel=0.006)          # visor
        else:
            b.sphere((0, 0, 0.488), 0.066, C['helmet'], scale=(1.05, 1, 0.85), half=True)
        for ob in b.objects[head_first:]:
            ob.location.z = -0.44                 # built at body height; the part root sits at the neck
        b = body
        # arms
        self.arms, self.elbows = [], []
        for s in (-1, 1):
            arm = Part('arm', b)
            arm.root.location = (0, s * (0.12 if bulky else 0.1), 0.405)
            arm.cyl((0, 0, -0.09), 0.023 * k, 0.09, uniform, seg=10, r2=0.029 * k)
            elbow = Part('elbow', arm)
            elbow.root.location = (0, 0, -0.09)
            elbow.sphere((0, 0, 0), 0.023 * k, uniform)
            elbow.cyl((0, 0, -0.078), 0.019 * k, 0.078, uniform, seg=10, r2=0.023 * k)
            elbow.sphere((0.004, 0, -0.09), 0.02 * k, C['dark'] if gloved else C['skin'], scale=(1.1, 0.85, 1.2))
            self.arms.append(arm)
            self.elbows.append(elbow)
        # weapon (or tools)
        flash_mat = mat('#ffd36b', emit=12.0, name='flash')
        if kind == 'engineer':
            self.gun = Part('gun', self.arms[0])
            self.gun.box((0.0, 0, -0.29), (0.12, 0.05, 0.08), mat('#c83c32', rough=0.5, name='toolbox'), bevel=0.008)
            self.gun.box((0.0, 0, -0.21), (0.05, 0.012, 0.012), C['dark'], bevel=0)
            self.flash = self.gun.ico((0, 0, -0.3), 0.01, flash_mat, subdiv=1)
        elif kind == 'rocket':
            self.gun = Part('gun', b)
            self.gun.root.location = (-0.02, -0.1, 0.47)
            self.gun.cyl((-0.16, 0, 0), 0.038, 0.38, C['hull2'], axis='X', seg=10)
            self.gun.cyl((0.22, 0, 0), 0.03, 0.07, mat('#c8452f', rough=0.5, name='warhead'), axis='X', seg=10, r2=0.01)
            self.flash = self.gun.ico((0.32, 0, 0), 0.06, flash_mat, subdiv=1)
        elif kind == 'sniper':
            self.gun = Part('gun', b)
            self.gun.root.location = (0.06, -0.035, 0.34)
            self.gun.box((0.1, 0, -0.015), (0.4, 0.02, 0.035), C['dark'], bevel=0.004)
            self.gun.box((-0.06, 0, -0.04), (0.1, 0.024, 0.06), mat('#5a4330', rough=0.8, name='stock'), bevel=0.006)
            self.gun.cyl((0.0, 0, 0.035), 0.016, 0.12, C['steel'], axis='X', seg=8)
            self.flash = self.gun.ico((0.33, 0, 0), 0.04, flash_mat, subdiv=1)
        elif kind == 'arc':
            self.gun = Part('gun', b)
            self.gun.root.location = (0.06, -0.05, 0.33)
            self.gun.box((0.05, 0, -0.035), (0.2, 0.05, 0.07), C['dark'], bevel=0.008)
            for k in range(3):
                self.gun.cyl((0.08 + k * 0.045, 0, 0), 0.034, 0.022, C['copper'], axis='X', seg=10)
            self.gun.cyl((0.2, 0, 0), 0.016, 0.06, C['metal'], axis='X', seg=8)
            self.flash = self.gun.ico((0.27, 0, 0), 0.05, mat('#9fdcff', emit=14.0, name='arcflash'), subdiv=1)
        elif kind == 'sapper':
            # hand-held detonator: the flash is its red firing lamp
            self.gun = Part('gun', self.arms[0])
            self.gun.box((0.0, 0, -0.27), (0.05, 0.036, 0.08), C['dark'], bevel=0.006)
            self.gun.cyl((0.0, 0.012, -0.33), 0.004, 0.06, C['steel'], seg=4)
            self.gun.box((0.026, 0, -0.24), (0.008, 0.02, 0.02), mat('#c83c32', rough=0.5, name='toolbox'), bevel=0)
            self.flash = self.gun.ico((0.03, 0, -0.23), 0.02, mat('#ff3a2a', emit=12.0, name='detflash'), subdiv=1)
        elif kind == 'striker':
            # compact suppressed carbine
            self.gun = Part('gun', b)
            self.gun.root.location = (0.06, -0.035, 0.34)
            self.gun.box((0.04, 0, -0.02), (0.2, 0.028, 0.05), C['dark'], bevel=0.005)
            self.gun.cyl((0.14, 0, 0.005), 0.014, 0.1, C['steel'], axis='X', seg=8)
            self.gun.box((0.03, 0, -0.065), (0.03, 0.02, 0.05), C['dark'], bevel=0.004)
            self.gun.box((-0.08, 0, -0.035), (0.06, 0.022, 0.04), C['hull2'], bevel=0.004)
            self.flash = self.gun.ico((0.26, 0, 0.005), 0.035, flash_mat, subdiv=1)
        elif kind == 'psion':
            # nothing held: a glow in the palm that flares when the hand is raised
            self.gun = Part('gun', self.arms[0])
            self.gun.sphere((0.0, 0, -0.2), 0.02, psy)
            self.flash = self.gun.ico((0.0, 0, -0.25), 0.07, mat('#e7b8ff', emit=14.0, name='psyflash'), subdiv=2)
        elif kind == 'isotope':
            # projector: body, glowing ring, flared nozzle
            self.gun = Part('gun', b)
            self.gun.root.location = (0.06, -0.05, 0.33)
            self.gun.box((0.03, 0, -0.03), (0.16, 0.05, 0.06), C['dark'], bevel=0.008)
            self.gun.cyl((0.1, 0, 0), 0.02, 0.14, C['steel'], axis='X', seg=10)
            self.gun.cyl((0.16, 0, 0), 0.028, 0.02, rad, axis='X', seg=12)
            self.gun.cyl((0.24, 0, 0), 0.026, 0.03, C['dark'], axis='X', seg=10, r2=0.034)
            self.flash = self.gun.ico((0.32, 0, 0), 0.06, mat('#9bff7a', emit=14.0, name='radflash'), subdiv=1)
        elif kind == 'infiltrator':
            # small pistol in one hand, briefcase in the other
            self.gun = Part('gun', self.arms[0])
            self.gun.box((0.0, 0, -0.29), (0.022, 0.018, 0.1), C['dark'], bevel=0.004)
            self.gun.box((-0.025, 0, -0.215), (0.04, 0.018, 0.026), C['dark'], bevel=0.004)
            self.flash = self.gun.ico((0, 0, -0.31), 0.03, flash_mat, subdiv=1)
            case = Part('case', self.arms[1])
            leather = mat('#4a3322', rough=0.6, name='leather')
            case.box((0, 0, -0.33), (0.14, 0.035, 0.11), leather, bevel=0.008)
            case.box((0, 0, -0.225), (0.05, 0.012, 0.012), C['dark'], bevel=0)
            case.box((0, 0, -0.29), (0.145, 0.04, 0.015), vest, bevel=0)
        elif kind == 'blink':
            # short rifle with a glowing charge strip
            self.gun = Part('gun', b)
            self.gun.root.location = (0.06, -0.035, 0.34)
            self.gun.box((0.04, 0, -0.02), (0.22, 0.026, 0.05), C['trim'], bevel=0.006)
            self.gun.box((0.05, 0, 0.03), (0.12, 0.012, 0.006), phase, bevel=0)
            self.gun.box((-0.07, 0, -0.035), (0.06, 0.024, 0.05), C['dark'], bevel=0.005)
            self.flash = self.gun.ico((0.19, 0, 0.005), 0.04, mat('#e6f6ff', emit=14.0, name='blinkflash'), subdiv=1)
        else:
            self.gun = Part('gun', b)
            self.gun.root.location = (0.06, -0.035, 0.34)
            self.gun.box((0.06, 0, -0.02), (0.28, 0.025, 0.045), C['dark'], bevel=0.005)
            self.gun.box((-0.05, 0, -0.04), (0.08, 0.024, 0.06), C['hull2'], bevel=0.005)
            self.flash = self.gun.ico((0.23, 0, 0), 0.045, flash_mat, subdiv=1)
        self.flash.hide_render = True
        self.gun_x = self.gun.root.location.x

    def pose(self, anim, k):
        legL, legR = self.legs
        armL, armR = self.arms
        hand = self.kind in self.HAND
        self.body.root.rotation_euler.y = 0
        self.body.root.location.z = 0
        self.flash.hide_render = True
        self.gun.root.location.x = self.gun_x
        elL, elR = self.elbows
        kL, kR = self.knees
        elL.root.rotation_euler.y = elR.root.rotation_euler.y = 0
        kL.root.rotation_euler.y = kR.root.rotation_euler.y = 0
        if self.kind == 'rocket':
            armR.root.rotation_euler.y, armL.root.rotation_euler.y = math.radians(-150), math.radians(-120)
        elif hand:
            armR.root.rotation_euler.y, armL.root.rotation_euler.y = math.radians(-6), math.radians(-10)
        else:   # both hands on the gun, elbows bent
            armR.root.rotation_euler.y, armL.root.rotation_euler.y = math.radians(-32), math.radians(-24)
            elR.root.rotation_euler.y, elL.root.rotation_euler.y = math.radians(-52), math.radians(-62)
        legL.root.rotation_euler.y = legR.root.rotation_euler.y = 0
        if self.kind == 'jetpack' and anim != 'die':
            legL.root.rotation_euler.y = math.radians(14)
            legR.root.rotation_euler.y = math.radians(22)
            kL.root.rotation_euler.y, kR.root.rotation_euler.y = math.radians(20), math.radians(32)
            if anim == 'walk':      # hovering bob and a lazy leg sway instead of steps
                ph = k / 6 * 2 * math.pi
                self.body.root.location.z = math.sin(ph) * 0.015
                legL.root.rotation_euler.y += math.sin(ph) * math.radians(6)
                legR.root.rotation_euler.y -= math.sin(ph) * math.radians(6)
                return
        if anim == 'walk':
            ph = k / 6 * 2 * math.pi
            legL.root.rotation_euler.y = math.sin(ph) * math.radians(30)
            legR.root.rotation_euler.y = -math.sin(ph) * math.radians(30)
            # the knee folds while that leg swings forward
            kL.root.rotation_euler.y = math.radians(38) * max(0.0, math.cos(ph))
            kR.root.rotation_euler.y = math.radians(38) * max(0.0, -math.cos(ph))
            self.body.root.location.z = abs(math.cos(ph)) * 0.012
            if hand:
                armL.root.rotation_euler.y = -math.sin(ph) * math.radians(22)
                armR.root.rotation_euler.y = math.sin(ph) * math.radians(10) - math.radians(4)
        elif anim == 'fire':
            if self.kind in self.RAISE:
                armL.root.rotation_euler.y = math.radians(self.RAISE[self.kind])
            if k == 0:
                self.flash.hide_render = self.kind == 'engineer'
            elif not hand:
                self.gun.root.location.x -= 0.02
        elif anim == 'die':
            self.body.root.rotation_euler.y = -math.radians([0, 30, 62, 88][k])
            armR.root.rotation_euler.y = armL.root.rotation_euler.y = math.radians(-160)


class Dog:
    """Attack hound: same frame layout as a Soldier (stand, walk x6, lunge x2, die x4)."""
    def __init__(self, f):
        C = palette(f)
        self.kind = 'dog'
        fur = mat('#7a5634' if f == 'allied' else '#4a4440', rough=0.85, name='fur_' + f)
        fur2 = mat('#b08a5e' if f == 'allied' else '#8a7c6e', rough=0.85, name='fur2_' + f)
        self.body = Part('body')
        b = self.body
        self.torso = Part('torso', b)
        t = self.torso
        t.sphere((-0.02, 0, 0.2), 0.075, fur, scale=(1.9, 0.85, 0.85))
        t.sphere((0.08, 0, 0.215), 0.07, fur, scale=(1.05, 0.95, 1.05))
        t.sphere((0.1, 0, 0.19), 0.05, fur2, scale=(1.0, 0.8, 0.9))
        t.torus((0.13, 0, 0.245), 0.042, 0.013, C['team'])
        self.head = Part('head', t)
        self.head.root.location = (0.15, 0, 0.27)
        h = self.head
        h.sphere((0.02, 0, 0.02), 0.05, fur, scale=(1.2, 0.9, 0.95))
        h.box((0.075, 0, -0.005), (0.08, 0.042, 0.04), fur2, bevel=0.012, taper=(0.9, 0.8))
        h.sphere((0.118, 0, 0.03), 0.012, C['dark'])
        for s in (-1, 1):
            h.box((0.0, s * 0.028, 0.05), (0.025, 0.018, 0.05), fur, bevel=0.004, taper=(0.4, 0.5))
        self.legs = []
        for x, s in ((0.09, -1), (0.09, 1), (-0.12, -1), (-0.12, 1)):
            leg = Part('leg', t)
            leg.root.location = (x, s * 0.042, 0.18)
            leg.box((0, 0, -0.17), (0.034, 0.034, 0.18), fur, bevel=0.008)
            leg.box((0.012, 0, -0.18), (0.052, 0.038, 0.022), fur2, bevel=0.006)
            self.legs.append(leg)
        self.tail = Part('tail', t)
        self.tail.root.location = (-0.15, 0, 0.23)
        self.tail.cyl((-0.13, 0, 0), 0.014, 0.13, fur, axis='X', seg=8, r2=0.02)
        self.flash = self.head.ico((0.12, 0, 0), 0.01, fur2, subdiv=1)
        self.flash.hide_render = True

    def pose(self, anim, k):
        t = self.torso.root
        t.rotation_euler = (0, 0, 0)
        t.location = (0, 0, 0)
        self.head.root.rotation_euler.y = 0
        self.tail.root.rotation_euler.y = math.radians(-35)
        for leg in self.legs:
            leg.root.rotation_euler.y = 0
        if anim == 'walk':      # bounding gallop
            ph = k / 6 * 2 * math.pi
            fl, fr, bl, br = self.legs
            fl.root.rotation_euler.y = math.sin(ph) * math.radians(40)
            fr.root.rotation_euler.y = math.sin(ph + 0.5) * math.radians(40)
            bl.root.rotation_euler.y = -math.sin(ph) * math.radians(40)
            br.root.rotation_euler.y = -math.sin(ph + 0.5) * math.radians(40)
            t.rotation_euler.y = math.sin(ph) * math.radians(6)
            t.location.z = abs(math.sin(ph)) * 0.02
        elif anim == 'fire':    # lunge and bite
            t.location.x = 0.05 + k * 0.03
            t.location.z = 0.03
            t.rotation_euler.y = math.radians(-12)
            fl, fr, bl, br = self.legs
            fl.root.rotation_euler.y = fr.root.rotation_euler.y = math.radians(-50)
            bl.root.rotation_euler.y = br.root.rotation_euler.y = math.radians(35)
            self.head.root.rotation_euler.y = math.radians(15 if k == 0 else -10)
        elif anim == 'die':     # rolls onto its side
            a = [0, 35, 70, 90][k]
            t.rotation_euler.x = math.radians(a)
            t.location.z = math.sin(math.radians(a)) * 0.05
            for leg in self.legs:
                leg.root.rotation_euler.y = math.radians(20)
            self.tail.root.rotation_euler.y = 0

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


def explosion(k, frames=8):
    """Fireball animation frame k: a white-hot core swells into a cluster of
    yellow and orange puffs that cool, drift up and turn into dark smoke."""
    p = Part('body')
    hot = [mat('#fff4c2', emit=14.0, name='fx_white'), mat('#ffc446', emit=9.0, name='fx_yellow'),
           mat('#ff7a1e', emit=6.0, name='fx_orange'), mat('#c8401a', emit=3.0, name='fx_red')]
    smoke = [mat(c, rough=0.95, name='fx_smoke' + c) for c in ('#3a3634', '#4f4a46', '#625d58')]
    t = k / (frames - 1)
    rng = np.random.default_rng(7)          # same puff layout every frame, so the frames line up
    spread = 0.1 + 0.35 * min(1.0, t * 1.6)
    for i in range(12):
        a, d, lift, rs = rng.random() * 2 * math.pi, math.sqrt(rng.random()), rng.random(), rng.random()
        x, y = math.cos(a) * d * spread, math.sin(a) * d * spread
        zz = 0.08 + (0.1 + 0.5 * lift) * spread + t * t * (0.45 + 0.35 * lift)
        r = (0.1 + 0.1 * rs) * (0.6 + 1.2 * min(1.0, t * 2)) * (1 + 0.25 * max(0.0, t - 0.6))
        heat = 1 - 1.35 * t - 0.3 * d
        if heat > 0.7:
            m = hot[0]
        elif heat > 0.45:
            m = hot[1]
        elif heat > 0.2:
            m = hot[2]
        elif heat > 0.02:
            m = hot[3]
        else:
            m = smoke[i % 3]
        p.ico((x, y, zz), r, m, subdiv=2, jitter=0.3, seed=i)
    core = 0.3 * math.sin(math.pi * (0.15 + 0.85 * min(1.0, t * 1.6)))   # bright core, gone once smoke takes over
    if core > 0.03:
        p.ico((0, 0, 0.12 + t * 0.2), core, hot[0] if t < 0.3 else hot[1], subdiv=2, jitter=0.2, seed=99)
    return {'body': p}
