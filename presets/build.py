#!/usr/bin/env python3
"""Builds a preset set (gen2/presets.py, gen3/presets.py) into what minicontrol loads:

    <set>/<set>.backup.json   all twelve, for "reorder and bulk edit" > "restore from a backup"
    <set>/README.md           each preset: what it shows, its controls, and its preset code

    python3 presets/build.py gen2
    python3 presets/build.py gen3

Every value in presets.py is checked against parameters.json: one out of range, or a knob, hover,
phone follower or double tap given a setting it can't move, stops the build rather than being clamped.

The backup leaves the instrument's own setup alone: restoring it keeps each bank's MIDI routing,
tuning reference, LED brightness, harp plate and thresholds and USB audio as the minichord has them
(those addresses are null in the file, which minicontrol skips). A preset code holds everything, as
any code does.
"""
import base64, importlib.util, json, os, subprocess, sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

FIRMWARE = 69          # stamped at address 7: firmware newer than a preset resets the settings that came
                       # after it, so this must cover every setting the presets use (hammer-on time, tabla
                       # laya, the drum and drone reverb and the speed ramp are 69)
PARAMETER_SIZE = 512
RESERVED = {0, 1, 382, 383, 510, 511}
# the instrument's, not the preset's: a restore keeps what each bank has
KEEP_ON_RESTORE = {8, 32, 106, 107, 108, 109, 110, 238, 241, 242, 243, 244}
# controls that take a setting to move, and the address of the value they move it to (if any)
KNOB_TARGETS = {10: None, 12: None, 14: None, 16: None, 249: 250, 325: 326, 303: 304, 307: 308,
                # the bent board's touch areas (firmware 111): the rail's five points, the palm pad, the thumb ribbon
                472: 473, 474: 475, 476: 477, 478: 479, 480: 481, 482: 483, 484: 485}
BENT_AREAS = {472, 474, 476, 478, 480, 482, 484}
# the bends' depths: a bent board area pressed on one is a depth of its own beside the setting, the deepest
# counting, so it doesn't fight the knob, hover or double tap that also moves it
BEND_DEPTHS = {430, 433, 434, 436, 438}
TAP_TARGETS = {200: 201, 209: 210, 211: 212}
# the preset's name (firmware 50): two ASCII letters to each of the twelve settings from 290, the first
# in the low seven bits; on older firmware it is kept but not shown
NAME_FIRST, NAME_SLOTS = 290, 12
LOOPER, CHORD_MEMORY, RHYTHM_FILL, PHONE_DECK, REVERT = 256, 287, 315, 332, 323
ACTIONS = {LOOPER, CHORD_MEMORY, RHYTHM_FILL, PHONE_DECK, REVERT}   # the double tap takes a step of these


def load_parameters():
    with open(os.path.join(ROOT, "parameters.json")) as f:
        d = json.load(f)
    return {p["sysex_adress"]: dict(p, section=s) for s, ps in d.items() for p in ps}


def multiplier(p):
    if p.get("float_multiplier"):
        return float(p["float_multiplier"])
    return 100 if p["data_type"] == "float" else 1


def stored(p, value):
    return int(round(float(value) * multiplier(p)))


def human(p, v):
    return round(v / multiplier(p), 2) if multiplier(p) != 1 else int(v)


def label(p):
    return f'{p["name"].strip()} ({p["sysex_adress"]})'


def defaults(params):
    values = [0] * PARAMETER_SIZE
    for a, p in params.items():
        values[a] = stored(p, p["default_value"])
    values[2] = values[3] = 50                  # the section volumes, where the knobs' middle puts them
    values[4] = values[5] = values[6] = 512     # the alternate knobs' memories, at their middle
    values[7] = FIRMWARE
    return values


def build(preset, params, firmware=FIRMWARE):
    values = defaults(params)
    values[7] = firmware
    settings = preset["settings"]
    problems = []
    # the settings naming a target first, so the values that follow them are read in its units
    order = sorted(settings, key=lambda a: 0 if a in KNOB_TARGETS or a in TAP_TARGETS else 1)
    for a in order:
        v = settings[a]
        if a in RESERVED or a not in params:
            problems.append(f"address {a} isn't a setting")
            continue
        p = params[a]
        if round(float(p.get("introduction_version") or 0) * 100) > firmware:
            problems.append(f"{label(p)} came in firmware {p['introduction_version']}, after the stamp ({firmware}): "
                            f"a minichord loading the preset would reset it")
        if (a in KNOB_TARGETS or a in TAP_TARGETS) and v:
            t = params.get(v)
            if a in KNOB_TARGETS:
                ok = t is not None and v not in ACTIONS and (t.get("controls") or "all") == "all"
            else:
                ok = v in ACTIONS or (t is not None and (t.get("controls") or "all") in ("all", "tap"))
            if not ok:
                problems.append(f"{label(p)}: {v} isn't a setting that control can move")
        source = p
        if p.get("follows_target") is not None:
            target = values[p["follows_target"]]
            source = params.get(target, p)
        s = stored(source, v)
        lo, hi = stored(source, source["min_value"]), stored(source, source["max_value"])
        if not lo <= s <= hi and not (p.get("follows_target") is not None and values[p["follows_target"]] == 0):
            problems.append(f"{label(p)}: {v} is outside {source['min_value']}..{source['max_value']}")
        values[a] = s
    # two controls on one setting fight: hover moves it from the stored value, a knob sets it outright
    # and the double tap stores over it, so each setting gets one control at most. Hover and the
    # alternate hover are one hand on two layers, so they may share one. A bent board area moves its
    # setting from the stored value as hover does, so it fights a knob or hover on the same setting, but
    # not the double tap (it starts from what the tap stores) or another area (the deepest moves it); on
    # a bend's depth it is a depth of its own (bend_touch) and fights nothing.
    owners = {}
    for a in sorted(set(KNOB_TARGETS) | set(TAP_TARGETS)):
        if a in BENT_AREAS and values[a] in BEND_DEPTHS:
            continue
        if values[a] and values[a] not in ACTIONS:
            kind = "area" if a in BENT_AREAS else "tap" if a in TAP_TARGETS else "hover" if a in (249, 325) else "knob"
            owners.setdefault(values[a], set()).add((kind, "hover" if a in (249, 325) else label(params[a])))
    for target, who in owners.items():
        controls = {name for kind, name in who if kind != "area"}
        live = {name for kind, name in who if kind in ("knob", "hover")}
        if len(controls) > 1 or (live and len(controls) < len(who)):
            problems.append(f"{label(params[target])} is moved by more than one control: "
                            f"{', '.join(sorted(name for _, name in who))}")
    name = preset["name"]
    if len(name) > 2 * NAME_SLOTS or not all(32 <= ord(c) < 127 for c in name):
        problems.append(f"the name {name!r} isn't up to {2 * NAME_SLOTS} plain ASCII letters")
    if problems:
        raise SystemExit(f"{preset['name']}:\n  " + "\n  ".join(problems))
    for k in range(NAME_SLOTS):
        first = ord(name[2 * k]) if 2 * k < len(name) else 0
        second = ord(name[2 * k + 1]) if 2 * k + 1 < len(name) else 0
        values[NAME_FIRST + k] = first + 128 * second if first else 0
    return values


def code(values):
    """as minicontrol's export writes one: every value, both pages"""
    return base64.b64encode(";".join(str(v) for v in values).encode("ascii")).decode("ascii")


def load_set(name):
    path = os.path.join(HERE, name, "presets.py")
    spec = importlib.util.spec_from_file_location(f"{name}_presets", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def demo_file(folder, i, preset, kind=""):
    """a demo recorded for a preset, if there is one: demos/NN-name.mp3, or NN-name-rhythm.mp3 for its
    rhythm style"""
    name = preset["name"].lower().replace(" & ", "-").replace(" ", "-")
    path = f"demos/{i + 1:02d}-{name}{kind}.mp3"
    tracked = subprocess.run(["git", "ls-files", "--error-unmatch", path], cwd=folder,
                             capture_output=True).returncode == 0   # only what the repository carries
    return path if tracked else None


def control_lines(preset):
    return [f"- **{k}**: {v}" for k, v in preset["controls"].items()]


def main(name):
    folder = os.path.join(HERE, name)
    module = load_set(name)
    params = load_parameters()
    firmware = getattr(module, "FIRMWARE", FIRMWARE)
    built = [build(p, params, firmware) for p in module.PRESETS]
    assert len(built) == 12, "a set is twelve banks"

    names = {}
    for a, p in sorted(params.items()):
        names[a] = f'{p["section"]} · {p["group"]} · {p["name"].strip()}'
    backup = {
        "minichord_backup": 1,
        "created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "firmware_version": firmware,
        "parameter_size": PARAMETER_SIZE,
        "address_names": names,
        "banks": [{"bank": i, "name": p["name"],
                   "values": [None if a in KEEP_ON_RESTORE else v for a, v in enumerate(values)]}
                  for i, (p, values) in enumerate(zip(module.PRESETS, built))],
    }
    backup_name = f"{name}.backup.json"
    with open(os.path.join(folder, backup_name), "w") as f:
        json.dump(backup, f, indent=1)

    lines = [f"# {module.TITLE}", "", *module.INTRO(backup_name), "",
             "| Bank | Preset | Demo | Rhythm | Shows |", "|---|---|---|---|---|"]
    for i, p in enumerate(module.PRESETS):
        demo, rhythm = demo_file(folder, i, p), demo_file(folder, i, p, "-rhythm")
        lines.append(f"| {i + 1} | {p['name']} | {f'[listen]({demo})' if demo else ''} | "
                     f"{f'[listen]({rhythm})' if rhythm else ''} | {', '.join(p['shows'])} |")
    for i, (p, values) in enumerate(zip(module.PRESETS, built)):
        lines += ["", f"## {i + 1}. {p['name']}", ""]
        if p.get("from"):
            lines += [f"*From {p['from'].split(':')[0]}, as it is there" + (f" ({p['changed']})" if p.get("changed") else "") + ".*", ""]
        lines += [p["blurb"], "", *control_lines(p), ""]
        if p.get("play"):
            lines += ["**Play it:**", "", *[f"{k + 1}. {s}" for k, s in enumerate(p["play"])], ""]
        lines += ["<details><summary>Preset code</summary>", "", "```", code(values), "```", "", "</details>"]
    with open(os.path.join(folder, "README.md"), "w") as f:
        f.write("\n".join(lines) + "\n")
    print(f"Built {len(built)} presets: {name}/{backup_name}, {name}/README.md")
    return built


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "gen2")
