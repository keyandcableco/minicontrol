"""Draw the harp plates on the front page's minichord: MAP_PLATES in controls.js.

Usage: python3 generate_plate_shapes.py [path to minichord-harp-plates]

Reads each plate's front copper and outline from its gerbers (the plates' own repository,
~/minichord-harp-plates unless another path is given) and writes them into controls.js as SVG
paths in the drawing's coordinates: the plate's outline, and its twelve zones, lowest string
first, each with the spot its string's name goes (the middle of its widest part).
The plates share the stock plate's frame, header for header, and the template they are built from
carries the front panel's drawing in that frame, so the 21 chord buttons there place them: the
fit puts every button within a unit of MAP_ROWS.

The bent board, a full-face plate, is MAP_BENT: every zone's copper, its harp's thirteen places and
its touch areas (the bend rail's five points, the palm pad, the thumb ribbon), each where
make_bentboard.py lays it out. Its sheet isn't drawn: its holes are where the real knobs are, about
3 mm right of the drawing's.

Needs shapely (the plates' generator's venv has it). Run it again when a plate's gerbers change.
"""
import ast
import json
import math
import os
import re
import sys

from shapely import affinity
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import nearest_points, polylabel, unary_union

ROOT = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser('~/minichord-harp-plates')
OUT = 'controls.js'
# by harp plate (243): the board's gerbers, front copper and outline, and how big the string
# names are drawn on it (the stock strip's are 31); the piano's black keys are filled
PLATES = {
    1: ('keymaster PCB/gerber/Keymaster PCB-CuTop.gbr', 'keymaster PCB/gerber/Keymaster PCB-EdgeCuts.gbr', {'size': 24}),
    2: ('piano PCB/gerber/piano PCB-F_Cu.gbr', 'piano PCB/gerber/piano PCB-Edge_Cuts.gbr', {'size': 28, 'black': [1, 3, 6, 8, 10]}),
    3: ('twin rows PCB/gerber/twin rows PCB-F_Cu.gbr', 'twin rows PCB/gerber/twin rows PCB-Edge_Cuts.gbr', {'size': 31}),
    4: ('framed strings PCB/gerber/framed strings PCB-F_Cu.gbr', 'framed strings PCB/gerber/framed strings PCB-Edge_Cuts.gbr', {'size': 28}),
    8: ('zipper 24 PCB/gerber/zipper 24 PCB-F_Cu.gbr', 'zipper 24 PCB/gerber/zipper 24 PCB-Edge_Cuts.gbr', {'size': 20}),
    9: ('arcade wheel PCB/gerber/arcade wheel PCB-F_Cu.gbr', 'arcade wheel PCB/gerber/arcade wheel PCB-Edge_Cuts.gbr', {'size': 18}),
    # piano glide (firmware 114): the piano's keys and a fretless strip down the left edge, each key's copper
    # running on into the strip at its height
    12: ('piano glide PCB/gerber/piano glide PCB-F_Cu.gbr', 'piano glide PCB/gerber/piano glide PCB-Edge_Cuts.gbr', {'size': 28, 'black': [1, 3, 6, 8, 10]}),
    # the drum pads (firmware 101): twelve pads in two columns; the seams between them are where two pads meet
    13: ('drum pads PCB/gerber/drum pads PCB-F_Cu.gbr', 'drum pads PCB/gerber/drum pads PCB-Edge_Cuts.gbr', {'size': 24}),
}
# the bent board: its gerbers, its generator (whose layout constants place the harp's places and
# the rail's points) and how big the places' names are drawn
BENT = ('full face plate/bent board PCB/gerber/bent board PCB-F_Cu.gbr',
        'full face plate/bent board PCB/gerber/bent board PCB-Edge_Cuts.gbr',
        'full face plate/make_bentboard.py', {'size': 26})
# board millimetres to the drawing, fitted to the chord buttons
SCALE, DX, DY = 8.4985, 489.41, -40.61
SIMPLIFY = 0.1   # mm, a third of a pixel on a wide screen
HOVER_LEAD = (1570, 703)   # where the hover label's lead ends, by the label (renderMinichordMap)


def statements(text):
    """The gerber's statements: extended ones (%...%) whole, the rest split at *"""
    out, i = [], 0
    while i < len(text):
        if text[i] == '%':
            j = text.index('%', i + 1)
            out.append(('ext', text[i + 1:j]))
            i = j + 1
        elif text[i].isspace():
            i += 1
        else:
            j = text.index('*', i)
            out.append(('std', text[i:j]))
            i = j + 1
    return out


def arc(centre, start, end, ccw):
    r = math.hypot(start[0] - centre[0], start[1] - centre[1])
    a0 = math.atan2(start[1] - centre[1], start[0] - centre[0])
    a1 = math.atan2(end[1] - centre[1], end[0] - centre[0])
    if ccw:
        while a1 <= a0: a1 += 2 * math.pi
    else:
        while a1 >= a0: a1 -= 2 * math.pi
    n = max(2, int(abs(a1 - a0) * 24))
    return [(centre[0] + r * math.cos(a0 + (a1 - a0) * k / n), centre[1] + r * math.sin(a0 + (a1 - a0) * k / n))
            for k in range(1, n)] + [end]


def read_gerber(path):
    """What KiCad writes for a plate: flashed pads (round, or its FreePoly outlines), each with
    the pad it belongs to, and drawn lines and arcs. Returns [(pad, polygon)], [[points]], in
    the board's millimetres with y down as KiCad has it."""
    macros, apertures, flashes, paths = {}, {}, [], []
    cur, aperture, mode, pad, line = (0.0, 0.0), None, 1, None, None
    for kind, body in statements(open(path).read()):
        if kind == 'ext':
            if body.startswith('AM'):
                name, rest = body[2:].split('*', 1)
                macros[name] = rest
            elif body.startswith('AD'):
                m = re.match(r'ADD(\d+)([^,*]+),?([^*]*)', body)
                apertures[int(m.group(1))] = (m.group(2), m.group(3))
            elif body.startswith('TO.P,'):
                pad = body.split(',')[1]
            elif body.startswith('TD'):
                pad = None
            continue
        if re.fullmatch(r'G0?[123]', body):
            mode = int(body[1:])
            continue
        m = re.fullmatch(r'D(\d+)', body)
        if m and int(m.group(1)) >= 10:
            aperture = int(m.group(1))
            continue
        m = re.fullmatch(r'(?:G0?([123]))?(?:X(-?\d+))?(?:Y(-?\d+))?(?:I(-?\d+))?(?:J(-?\d+))?D0?([123])', body)
        if not m:
            continue
        if m.group(1): mode = int(m.group(1))
        x = int(m.group(2)) / 1e6 if m.group(2) else cur[0]
        y = int(m.group(3)) / 1e6 if m.group(3) else cur[1]
        i = int(m.group(4)) / 1e6 if m.group(4) else 0.0
        j = int(m.group(5)) / 1e6 if m.group(5) else 0.0
        op = int(m.group(6))
        if op != 1 and line and len(line) > 1:
            paths.append(line)
        if op == 2:
            line = [(x, y)]
        elif op == 1:
            line = line or [cur]
            line += [(x, y)] if mode == 1 else arc((cur[0] + i, cur[1] + j), cur, (x, y), mode == 3)
        else:
            line = None
            shape, params = apertures[aperture]
            if shape == 'C':
                poly = Point(x, y).buffer(float(params.split('X')[0]) / 2, 64)
            else:
                nums = [float(v) for v in re.split(r'[,\s*]+', macros[shape].replace('$1', '0')) if v]
                assert nums[0] == 4, f'{shape}: only outline macros are read'
                poly = Polygon([(x + nums[3 + 2 * k], y + nums[4 + 2 * k]) for k in range(int(nums[2]) + 1)]).buffer(0)
            flashes.append((pad, affinity.scale(poly, 1, -1, origin=(0, 0))))
        cur = (x, y)
    if line and len(line) > 1:
        paths.append(line)
    return flashes, [[(px, -py) for px, py in p] for p in paths]


def to_map(x, y):
    return (round(SCALE * x + DX, 1), round(SCALE * y + DY, 1))


def num(v):
    s = f'{v:.1f}'.rstrip('0').rstrip('.')
    return '0' if s in ('-0', '') else s


def ring_d(coords):
    pts = [to_map(x, y) for x, y in coords][:-1]
    steps = [(round(b[0] - a[0], 1), round(b[1] - a[1], 1)) for a, b in zip(pts, pts[1:])]
    return f'M{num(pts[0][0])},{num(pts[0][1])} l ' + ' '.join(f'{num(dx)} {num(dy)}' for dx, dy in steps if dx or dy) + ' z'


def shape_d(poly):
    """A path for a piece of copper or the outline: a round pad as two arcs, the rest simplified"""
    x0, y0, x1, y1 = poly.bounds
    w, h = x1 - x0, y1 - y0
    if abs(w - h) < 0.01 and abs(poly.area / (w * h) - math.pi / 4) < 0.01:
        cx, cy = to_map((x0 + x1) / 2, (y0 + y1) / 2)
        r = round(SCALE * w / 2, 1)
        return f'M{num(cx - r)},{num(cy)} a {num(r)} {num(r)} 0 1 0 {num(2 * r)} 0 a {num(r)} {num(r)} 0 1 0 {num(-2 * r)} 0 z'
    p = poly.simplify(SIMPLIFY)
    return ' '.join([ring_d(p.exterior.coords)] + [ring_d(r.coords) for r in p.interiors])


def rings(lines, tol=0.001):
    """The outline's lines and arcs joined end to end into closed rings"""
    lines, out = [list(l) for l in lines], []
    while lines:
        ring = lines.pop()
        while math.dist(ring[0], ring[-1]) > tol:
            for k, l in enumerate(lines):
                if math.dist(ring[-1], l[0]) <= tol: ring += l[1:]; break
                if math.dist(ring[-1], l[-1]) <= tol: ring += l[-2::-1]; break
            else:
                sys.exit('the outline has an open end')
            lines.pop(k)
        out.append(Polygon(ring))
    return out


def name_spot(zone):
    """Where a zone's string is named: the middle of its widest part (what is left of it pared
    nearly to its deepest point), so a pad's name sits at its centre and a key's where it's wide"""
    deepest = polylabel(zone, 0.01)
    core = zone.buffer(-0.8 * zone.exterior.distance(deepest))
    core = max(getattr(core, 'geoms', [core]), key=lambda p: p.area)
    return core.centroid.x, core.centroid.y


def zones_and_outline(copper, edge):
    """A plate's twelve zones' copper, by T number, and its outline with any holes through it"""
    flashes, _ = read_gerber(os.path.join(ROOT, copper))
    _, edges = read_gerber(os.path.join(ROOT, edge))
    zones = {}
    for pad, poly in flashes:
        if pad and re.fullmatch(r'T\d+', pad):
            zones.setdefault(int(pad[1:]), []).append(poly)
    assert sorted(zones) == list(range(1, 13)), f'{copper}: zones {sorted(zones)}'
    # the outline and any slots through the board: the biggest ring, with the rest as its holes
    outer, *slots = sorted(rings(edges), key=lambda r: -r.area)
    return zones, Polygon(outer.exterior.coords, [r.exterior.coords for r in slots])


def hover_lead(shape):
    """Where the hover label's lead meets a plate: its edge nearest the label"""
    edge = nearest_points(shape.exterior, Point((HOVER_LEAD[0] - DX) / SCALE, (HOVER_LEAD[1] - DY) / SCALE))[0]
    return list(to_map(edge.x, edge.y))


def plate(copper, edge, extra):
    zones, outline = zones_and_outline(copper, edge)
    strings = []
    for t in range(12, 0, -1):   # T12, the lowest string, first
        pieces = sorted(zones[t], key=lambda p: -p.area)
        x, y = to_map(*name_spot(pieces[0]))
        strings.append({'d': ' '.join(shape_d(p) for p in pieces), 'x': x, 'y': y})
    x0, y0, x1, y1 = outline.bounds
    return {**extra, 'bounds': [*to_map(x0, y0), *to_map(x1, y1)], 'lead': hover_lead(outline),
            'outline': shape_d(outline), 'zones': strings}


def layout_constants(path):
    """make_bentboard.py's module-level constants (HARP_T, HARP_Y, RAIL_X ...), read without running it"""
    out = {}
    for node in ast.parse(open(path).read()).body:
        if not isinstance(node, ast.Assign) or len(node.targets) != 1:
            continue
        target = node.targets[0]
        try:
            values = ast.literal_eval(node.value)
        except (ValueError, TypeError, SyntaxError):
            continue
        if isinstance(target, ast.Name):
            out[target.id] = values
        elif isinstance(target, ast.Tuple):
            out.update((n.id, v) for n, v in zip(target.elts, values) if isinstance(n, ast.Name))
    return out


def bent_board(copper, edge, generator, extra):
    """The bent board: its touch areas' copper and its harp's six lines' (top to bottom); the harp as
    one shape and its thirteen places, lowest first, each where it is named (the middle of the
    harp at that place's height); the rail's five points, left to right, each its fifth of the strip and
    the top of its middle, where its name starts; the palm pad and the thumb ribbon, each its copper as
    one shape and the spot its name goes (the palm's running up it)"""
    zones, _ = zones_and_outline(copper, edge)
    c = layout_constants(os.path.join(ROOT, generator))
    whole = lambda ts: unary_union([p for t in ts for p in zones[t]]).buffer(0.3).buffer(-0.3)   # teeth closed up
    spot = lambda shape: to_map(*polylabel(max(getattr(shape, 'geoms', [shape]), key=lambda p: p.area), 0.01).coords[0])
    across = lambda shape, x: LineString([(x, shape.bounds[1] - 1), (x, shape.bounds[3] + 1)]).intersection(shape).bounds
    # the harp: thirteen places of q down its span, place 0 at the bottom
    harp = whole(c['HARP_T'])
    top, bot = c['HARP_Y']
    q = (bot - top) / 13
    hx0, _, hx1, _ = harp.bounds
    places = []
    for k in range(13):
        y = bot - q * (k + 0.5)
        span = LineString([(hx0 - 1, y), (hx1 + 1, y)]).intersection(harp).bounds
        places.append(to_map((span[0] + span[2]) / 2, y))
    # the rail: five points of equal width along RAIL_X, the end ones out to the rail's ends
    rail = whole(c['RAIL_T'])
    x0, x1 = c['RAIL_X']
    xs = [x0 + (x1 - x0) / 5 * i for i in range(6)]
    xs[0], xs[5] = rail.bounds[0] - 1, rail.bounds[2] + 1
    points = []
    for i in range(5):
        piece = rail.intersection(box(xs[i], rail.bounds[1] - 1, xs[i + 1], rail.bounds[3] + 1))
        mid = x0 + (x1 - x0) / 5 * (i + 0.5)
        x, y = to_map(mid, across(rail, mid)[1])
        points.append({'x': x, 'y': y, 'd': shape_d(piece)})
    area = lambda shape: dict(zip('xy', spot(shape)), d=shape_d(shape))
    # the palm's name runs up the pad: the middle of its height where it is widest
    palm = whole([c['PALM_T']])
    x = polylabel(palm, 0.01).x
    _, y0, _, y1 = across(palm, x)
    palm_area = dict(zip('xy', to_map(x, (y0 + y1) / 2)), d=shape_d(palm))
    hb = harp.bounds
    return {**extra, 'bounds': [*to_map(hb[0], hb[1]), *to_map(hb[2], hb[3])], 'lead': hover_lead(harp),
            'copper': [' '.join(shape_d(p) for p in zones[t]) for t in [*c['RAIL_T'], c['PALM_T'], *c['RIBBON_T']]],
            'lines': [' '.join(shape_d(p) for p in zones[t]) for t in c['HARP_T']],
            'harp': shape_d(harp), 'zones': [{'x': x, 'y': y} for x, y in places],
            'rail': points, 'palm': palm_area, 'ribbon': area(whole(c['RIBBON_T']))}


def bent_block():
    b = bent_board(*BENT)
    js = lambda v: json.dumps(v).replace('"x": ', 'x: ').replace('"y": ', 'y: ').replace('"d": ', 'd: ')
    head = ', '.join(f'{k}: {json.dumps(v)}' for k, v in b.items() if k in ('size', 'bounds', 'lead'))
    lines = [f' {head},',
             ' copper: [\n' + ',\n'.join(f'  {json.dumps(d)}' for d in b['copper']) + '\n ],',
             ' lines: [\n' + ',\n'.join(f'  {json.dumps(d)}' for d in b['lines']) + '\n ],',
             f' harp: {json.dumps(b["harp"])},',
             ' zones: [' + ', '.join(f'{{ x: {num(z["x"])}, y: {num(z["y"])} }}' for z in b['zones']) + '],',
             ' rail: [\n' + ',\n'.join(f'  {js(p)}' for p in b['rail']) + '\n ],',
             f' palm: {js(b["palm"])},', f' ribbon: {js(b["ribbon"])}']
    return 'const MAP_BENT = {\n' + '\n'.join(lines) + '\n};'


def replace(source, name, block):
    updated, n = re.subn(rf'const {name} = \{{.*?\n\}};', lambda _: block, source, count=1, flags=re.S)
    if not n:
        sys.exit(f'{OUT} has no {name} to replace')
    return updated


def main():
    entries = []
    for key, (copper, edge, extra) in PLATES.items():
        p = plate(copper, edge, extra)
        zones = ',\n'.join(f'   {{ x: {num(z["x"])}, y: {num(z["y"])}, d: {json.dumps(z["d"])} }}' for z in p['zones'])
        head = ', '.join(f'{k}: {json.dumps(v)}' for k, v in p.items() if k not in ('outline', 'zones'))
        entries.append(f' {key}: {{ {head},\n  outline: {json.dumps(p["outline"])},\n  zones: [\n{zones}\n  ] }}')
    block = 'const MAP_PLATES = {\n' + ',\n'.join(entries) + '\n};'
    bent = bent_block()
    updated = replace(replace(open(OUT).read(), 'MAP_PLATES', block), 'MAP_BENT', bent)
    open(OUT, 'w').write(updated)
    print(f'{OUT}: MAP_PLATES, {len(block)} characters, plates {", ".join(map(str, PLATES))}; MAP_BENT, {len(bent)} characters')


if __name__ == '__main__':
    main()
