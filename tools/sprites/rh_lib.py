"""Shared Blender helpers for the Red Horizon sprite pipeline.

Coordinate conventions (must match the game):
  game world x  -> Blender +X
  game world y  -> Blender -Y
  up            -> Blender +Z
  1 map tile    =  1 Blender unit (BU)

The camera is orthographic, pitched 30 deg above the ground plane and turned
45 deg, which gives the classic 2:1 dimetric look: one tile renders as a
64 x 32 px diamond, and 1 BU of height renders as ~39 px.
"""
import bpy, bmesh, math, os, struct, zlib
import numpy as np
from mathutils import Vector, Matrix

PX_PER_BU = 64 / math.sqrt(2)          # screen px per BU along a ground diagonal
HEIGHT_PX = PX_PER_BU * math.cos(math.radians(30))   # px per BU of vertical height

# ---------------------------------------------------------------- scene setup

def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        sc.cycles.device = 'GPU'
    except Exception as e:  # fall back to CPU rendering
        print('GPU unavailable:', e)
    sc.cycles.use_adaptive_sampling = True
    sc.cycles.use_denoising = False
    sc.cycles.filter_width = 1.0          # crisp pixels, closer to the classic look
    sc.cycles.max_bounces = 4
    sc.render.film_transparent = True
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.render.resolution_percentage = 100
    return sc


def setup_world(strength=1.0, color=(0.42, 0.45, 0.52)):
    sc = bpy.context.scene
    w = bpy.data.worlds.new('world')
    w.use_nodes = True
    bg = w.node_tree.nodes.get('Background')
    bg.inputs['Color'].default_value = (*color, 1)
    bg.inputs['Strength'].default_value = strength
    sc.world = w


def setup_lights():
    """Warm key light from screen-right so shadows fall to the left (the east
    face is lit, the south face mostly in shade), plus a cool shadowless fill
    from the front-left."""
    sc = bpy.context.scene
    key = bpy.data.lights.new('key', 'SUN')
    key.energy = 3.6
    key.angle = math.radians(3)
    key.color = (1.0, 0.96, 0.88)
    ko = bpy.data.objects.new('key', key)
    ko.rotation_euler = (0, math.radians(48), math.radians(31))
    sc.collection.objects.link(ko)

    fill = bpy.data.lights.new('fill', 'SUN')
    fill.energy = 0.9
    fill.use_shadow = False
    fill.color = (0.8, 0.86, 1.0)
    fo = bpy.data.objects.new('fill', fill)
    fo.rotation_euler = (0, math.radians(55), math.radians(-122))
    sc.collection.objects.link(fo)


def setup_ground():
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=40)
    me = bpy.data.meshes.new('ground')
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new('ground', me)
    ob.is_shadow_catcher = True
    bpy.context.scene.collection.objects.link(ob)
    return ob


def setup_camera(W, H, ax, ay, zoom=1.0):
    """Ortho 2:1 camera. The world origin lands on pixel (ax, ay) of a W x H frame
    (pixel coords from the top-left). zoom > 1 magnifies (used for cameos)."""
    sc = bpy.context.scene
    sc.render.resolution_x = W
    sc.render.resolution_y = H
    cam = bpy.data.cameras.new('cam')
    cam.type = 'ORTHO'
    M = max(W, H)
    cam.ortho_scale = M / (PX_PER_BU * zoom)
    cam.shift_x = (W / 2 - ax) / M
    cam.shift_y = (ay - H / 2) / M
    cam.clip_start = 0.1
    cam.clip_end = 200
    co = bpy.data.objects.new('cam', cam)
    d = 60
    el, az = math.radians(30), math.radians(-45)
    co.location = (d * math.cos(el) * math.cos(az), d * math.cos(el) * math.sin(az), d * math.sin(el))
    co.rotation_euler = (math.radians(60), 0, math.radians(45))
    sc.collection.objects.link(co)
    sc.camera = co
    return co

# ---------------------------------------------------------------- materials

def srgb_to_lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgb(h):
    h = h.lstrip('#')
    return tuple(srgb_to_lin(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4))


_mats = {}

def mat(color, metal=0.0, rough=0.55, emit=0.0, team=False, grime=0.0, name=None):
    """Principled material. team=True marks it as remappable team colour.
    grime adds low-frequency noise to the albedo (painted/weathered look)."""
    key = name or f'{color}_{metal}_{rough}_{emit}_{team}_{grime}'
    if key in _mats:
        return _mats[key]
    m = bpy.data.materials.new(key)
    m.use_nodes = True
    nt = m.node_tree
    p = nt.nodes['Principled BSDF']
    rgb = hex_rgb(color)
    p.inputs['Base Color'].default_value = (*rgb, 1)
    p.inputs['Metallic'].default_value = metal
    p.inputs['Roughness'].default_value = rough
    if emit > 0:
        p.inputs['Emission Color'].default_value = (*rgb, 1)
        p.inputs['Emission Strength'].default_value = emit
    if grime > 0:
        tc = nt.nodes.new('ShaderNodeTexCoord')
        nz = nt.nodes.new('ShaderNodeTexNoise')
        nz.inputs['Scale'].default_value = 6.0
        nz.inputs['Detail'].default_value = 6.0
        nt.links.new(tc.outputs['Object'], nz.inputs['Vector'])
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = grime
        mix.inputs['A'].default_value = (*rgb, 1)
        ramp = nt.nodes.new('ShaderNodeValToRGB')
        ramp.color_ramp.elements[0].position = 0.3
        ramp.color_ramp.elements[0].color = (0.55, 0.55, 0.55, 1)
        ramp.color_ramp.elements[1].position = 0.7
        ramp.color_ramp.elements[1].color = (1.15, 1.15, 1.15, 1)
        nt.links.new(nz.outputs['Fac'], ramp.inputs['Fac'])
        nt.links.new(ramp.outputs['Color'], mix.inputs['B'])
        nt.links.new(mix.outputs['Result'], p.inputs['Base Color'])
    m['team'] = 1 if team else 0
    _mats[key] = m
    return m


def clear_material_cache():
    _mats.clear()

# ---------------------------------------------------------------- mesh building

class Part:
    """A named group of meshes parented to an empty, so it can be rotated as one."""
    def __init__(self, name, parent=None):
        self.root = bpy.data.objects.new(name, None)
        bpy.context.scene.collection.objects.link(self.root)
        if parent is not None:
            self.root.parent = parent.root if isinstance(parent, Part) else parent
        self.objects = []

    def _add(self, name, bm, material, bevel=0.0, smooth_sides=False, smooth_all=False):
        if smooth_sides or smooth_all:
            bm.normal_update()
            for f in bm.faces:
                f.smooth = smooth_all or abs(f.normal.z) < 0.6
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        me.materials.append(material)
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        ob.parent = self.root
        if bevel > 0:
            mod = ob.modifiers.new('bevel', 'BEVEL')
            mod.width = bevel
            mod.segments = 2
            mod.limit_method = 'ANGLE'
            mod.angle_limit = math.radians(40)
        self.objects.append(ob)
        return ob

    # --- primitives. loc is the centre of the bottom face unless stated.
    def box(self, loc, size, material, bevel=0.02, taper=(1, 1), shift=(0, 0), rot=0.0):
        """Box of size (sx, sy, sz) resting on loc. taper scales the top face,
        shift moves the top face (for sloped armour and roofs)."""
        sx, sy, sz = size
        bm = bmesh.new()
        tx, ty = taper
        hx, hy = sx / 2, sy / 2
        pts = [(-hx, -hy, 0), (hx, -hy, 0), (hx, hy, 0), (-hx, hy, 0),
               (-hx * tx + shift[0], -hy * ty + shift[1], sz), (hx * tx + shift[0], -hy * ty + shift[1], sz),
               (hx * tx + shift[0], hy * ty + shift[1], sz), (-hx * tx + shift[0], hy * ty + shift[1], sz)]
        v = [bm.verts.new(p) for p in pts]
        for f in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
            bm.faces.new([v[i] for i in f])
        self._xform(bm, loc, rot)
        return self._add('box', bm, material, bevel)

    def hull(self, loc, length, width, height, material, nose=0.25, tail=0.12, top_w=0.8, bevel=0.02, rot=0.0):
        """Tank-style hull along +X with a sloped glacis (nose) and tail."""
        L, Wd, Hh = length / 2, width / 2, height
        tw = Wd * top_w
        pts = [(-L, -Wd, 0), (L, -Wd, 0), (L, Wd, 0), (-L, Wd, 0),
               (-L + tail, -tw, Hh), (L - nose, -tw, Hh), (L - nose, tw, Hh), (-L + tail, tw, Hh)]
        bm = bmesh.new()
        v = [bm.verts.new(p) for p in pts]
        for f in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
            bm.faces.new([v[i] for i in f])
        self._xform(bm, loc, rot)
        return self._add('hull', bm, material, bevel)

    def cyl(self, loc, r, h, material, seg=20, r2=None, bevel=0.0, axis='Z', rot=0.0):
        """Cylinder / cone. loc is the bottom centre (for axis Z) or the start
        point (for axis X / Y, extending along +axis)."""
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg,
                              radius1=r, radius2=r if r2 is None else r2, depth=h)
        bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0, h / 2))
        if axis == 'X':
            bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(90), 3, 'Y'))
        elif axis == 'Y':
            bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(-90), 3, 'X'))
        # smooth the curved side, keep the caps flat
        bm.normal_update()
        ax = {'X': Vector((1, 0, 0)), 'Y': Vector((0, 1, 0)), 'Z': Vector((0, 0, 1))}[axis]
        for f in bm.faces:
            f.smooth = abs(f.normal.dot(ax)) < 0.6
        self._xform(bm, loc, rot)
        return self._add('cyl', bm, material, bevel)

    def sphere(self, loc, r, material, scale=(1, 1, 1), seg=16, half=False):
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=max(6, seg // 2), radius=r)
        if half:
            bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -1e-4], context='VERTS')
            edges = [e for e in bm.edges if e.is_boundary]
            if edges:
                bmesh.ops.holes_fill(bm, edges=edges)
        bmesh.ops.scale(bm, verts=bm.verts, vec=scale)
        self._xform(bm, loc, 0)
        return self._add('sph', bm, material, smooth_all=True)

    def ico(self, loc, r, material, subdiv=2, scale=(1, 1, 1), jitter=0.0, seed=0, smooth=True):
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=r)
        if jitter:
            rng = np.random.default_rng(seed)
            for v in bm.verts:
                v.co *= 1 + (rng.random() - 0.5) * jitter
        bmesh.ops.scale(bm, verts=bm.verts, vec=scale)
        self._xform(bm, loc, 0)
        return self._add('ico', bm, material, smooth_all=smooth)

    def torus(self, loc, R, r, material, seg=24, rseg=8):
        bm = bmesh.new()
        rings = []
        for i in range(seg):
            a = 2 * math.pi * i / seg
            ring = []
            for j in range(rseg):
                b = 2 * math.pi * j / rseg
                ring.append(bm.verts.new(((R + r * math.cos(b)) * math.cos(a),
                                          (R + r * math.cos(b)) * math.sin(a), r * math.sin(b))))
            rings.append(ring)
        for i in range(seg):
            for j in range(rseg):
                a, b = rings[i], rings[(i + 1) % seg]
                bm.faces.new((a[j], b[j], b[(j + 1) % rseg], a[(j + 1) % rseg]))
        self._xform(bm, loc, 0)
        return self._add('torus', bm, material, smooth_all=True)

    def prism(self, loc, pts2d, h, material, bevel=0.015, rot=0.0):
        """Extrude a 2D polygon (counter-clockwise) upward by h."""
        bm = bmesh.new()
        bot = [bm.verts.new((x, y, 0)) for x, y in pts2d]
        top = [bm.verts.new((x, y, h)) for x, y in pts2d]
        n = len(pts2d)
        bm.faces.new(list(reversed(bot)))
        bm.faces.new(top)
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((bot[i], bot[j], top[j], top[i]))
        self._xform(bm, loc, rot)
        return self._add('prism', bm, material, bevel)

    def extrude_x(self, loc, pts_yz, length, material, bevel=0.015, smooth=False, rot=0.0):
        """Extrude a (y, z) profile along +X, centred on loc (profiles like a
        quonset hut's half circle). smooth shades the curved sides."""
        bm = bmesh.new()
        a = [bm.verts.new((-length / 2, y, z)) for y, z in pts_yz]
        b = [bm.verts.new((length / 2, y, z)) for y, z in pts_yz]
        n = len(pts_yz)
        bm.faces.new(a)
        bm.faces.new(list(reversed(b)))
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[j], a[i], b[i], b[j]))
        bm.normal_update()
        for f in bm.faces:
            f.smooth = smooth and abs(f.normal.x) < 0.5
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        self._xform(bm, loc, rot)
        return self._add('ext', bm, material, bevel)

    def _xform(self, bm, loc, rot):
        if rot:
            bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(rot, 3, 'Z'))
        bmesh.ops.translate(bm, verts=bm.verts, vec=loc)

# ---------------------------------------------------------------- rendering

def all_mesh_objects():
    return [o for o in bpy.context.scene.objects if o.type == 'MESH' and o.name != 'ground']


def render_to_array(tmp_path):
    sc = bpy.context.scene
    sc.render.filepath = tmp_path
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(tmp_path)
    W, H = img.size
    buf = np.empty(W * H * 4, np.float32)
    img.pixels.foreach_get(buf)
    bpy.data.images.remove(img)
    arr = (np.clip(buf.reshape(H, W, 4)[::-1], 0, 1) * 255 + 0.5).astype(np.uint8)
    return arr


class MaskMode:
    """Temporarily swaps every material for flat white (team colour) or black,
    hides the shadow catcher and renders with minimal samples."""
    def __init__(self):
        self.white = bpy.data.materials.get('__mask_white') or self._emit('__mask_white', 1.0)
        self.black = bpy.data.materials.get('__mask_black') or self._emit('__mask_black', 0.0)

    @staticmethod
    def _emit(name, v):
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        nt = m.node_tree
        for n in list(nt.nodes):
            nt.nodes.remove(n)
        e = nt.nodes.new('ShaderNodeEmission')
        e.inputs['Color'].default_value = (v, v, v, 1)
        o = nt.nodes.new('ShaderNodeOutputMaterial')
        nt.links.new(e.outputs['Emission'], o.inputs['Surface'])
        return m

    def __enter__(self):
        sc = bpy.context.scene
        self.saved = []
        for ob in all_mesh_objects():
            for slot in ob.material_slots:
                orig = slot.material
                self.saved.append((slot, orig))
                slot.material = self.white if (orig and orig.get('team')) else self.black
        g = bpy.data.objects.get('ground')
        if g:
            g.hide_render = True
        self.samples = sc.cycles.samples
        sc.cycles.samples = 4
        return self

    def __exit__(self, *a):
        for slot, orig in self.saved:
            slot.material = orig
        g = bpy.data.objects.get('ground')
        if g:
            g.hide_render = False
        bpy.context.scene.cycles.samples = self.samples


def write_png(path, arr):
    """Minimal RGBA PNG writer (no external deps)."""
    h, w, _ = arr.shape
    raw = b''.join(b'\x00' + arr[y].tobytes() for y in range(h))

    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) \
        + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(data)


def pack_sheet(frames, cols):
    n = len(frames)
    H, W, _ = frames[0].shape
    rows = (n + cols - 1) // cols
    sheet = np.zeros((rows * H, cols * W, 4), np.uint8)
    for i, fr in enumerate(frames):
        r, c = divmod(i, cols)
        sheet[r * H:(r + 1) * H, c * W:(c + 1) * W] = fr
    return sheet


def clean_alpha(arr, lo=10):
    a = arr[..., 3]
    arr[a < lo] = 0
    return arr
