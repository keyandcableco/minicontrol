#!/usr/bin/env python3
"""Checks a preset set against the describer's table of settings that silence or undo other settings
(CONFLICTS in the minichord repo's firmware/preset_maker/interpret.py): each note it prints is a setting
in a preset that the preset's other settings keep from being heard.

    python3 presets/lint.py gen2 [gen3 ...]
"""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.environ.get("PRESET_MAKER", os.path.expanduser("~/minichord/firmware/preset_maker")))
import build        # noqa: E402
import interpret    # noqa: E402

params = build.load_parameters()
for _p in params.values():
    _p.setdefault("controls", "all")   # as minicontrol reads a setting with none given
_p = None
sel = interpret.selectors()
for name in sys.argv[1:] or ["gen2"]:
    module = build.load_set(name)
    for i, p in enumerate(module.PRESETS):
        values = build.build(p, params, getattr(module, "FIRMWARE", build.FIRMWARE))
        state, start = {}, {}
        for a, v in enumerate(build.defaults(params)):
            if a in params:
                start[a] = build.human(params[a], v)
        for a, v in enumerate(values):
            q = params.get(a)
            if q is None:
                continue
            source = q
            if q.get("follows_target") is not None:
                source = params.get(values[q["follows_target"]], q)
            state[a] = build.human(source, v)
        if getattr(module, "PLATE", None) is not None:
            state[243] = module.PLATE   # the plate the set is made for: the instrument's, which a restore keeps
        notes = interpret.conflict_notes(params, sel, start, state, lambda a: params[a]["name"].strip())
        # the bend at its centre (1.0) is how kit.py leaves the vibrato's bend: nothing to hear
        notes = [n for n in notes if "pitch bend envelope" not in n and "harp's pitch bend" not in n]
        # since firmware 69 a sampled chord voice glides too: the describer's rows saying it doesn't are stale
        notes = [n for n in notes if "glide doesn't reach a sampled chord voice" not in n]
        print(f"{name} {i + 1:2d} {p['name']}: " + ("ok" if not notes else ""))
        for n in notes:
            print("     -", n)
