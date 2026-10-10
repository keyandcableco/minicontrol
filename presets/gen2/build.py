#!/usr/bin/env python3
"""Builds the second generation presets (presets.py) into what minicontrol loads:

    gen2.backup.json   all twelve, for "reorder and bulk edit" > "restore from a backup"
    README.md          each preset: what it shows, its controls, and its preset code

    python3 presets/gen2/build.py

Every value in presets.py is checked against parameters.json: one out of range, or a knob, hover or
double tap given a setting it can't move, stops the build rather than being clamped.

The backup leaves the instrument's own setup alone: restoring it keeps each bank's MIDI routing,
tuning reference, LED brightness, harp plate and thresholds and USB audio as the minichord has them
(those addresses are null in the file, which minicontrol skips). A preset code holds everything, as
any code does.
"""
import base64, json, os, sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
import presets  # noqa: E402

FIRMWARE = 41          # the firmware these were made and measured on, stamped at address 7: firmware
                       # newer than a preset resets the settings that came after it, so this must cover
                       # every setting the presets use (the chord notes' own instruments are 41)
PARAMETER_SIZE = 512
RESERVED = {0, 1, 382, 383, 510, 511}
# the instrument's, not the preset's: a restore keeps what each bank has
KEEP_ON_RESTORE = {8, 32, 106, 107, 108, 109, 110, 238, 241, 242, 243, 244}
KNOB_TARGETS = {10, 12, 14, 16, 249}
TAP_TARGETS = {200, 209, 211}
LOOPER = 256


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


def build(preset, params):
    values = defaults(params)
    settings = preset["settings"]
    problems = []
    # the settings naming a target first, so the values that follow them are read in its units
    order = sorted(settings, key=lambda a: 0 if a in KNOB_TARGETS | TAP_TARGETS else 1)
    for a in order:
        v = settings[a]
        if a in RESERVED or a not in params:
            problems.append(f"address {a} isn't a setting")
            continue
        p = params[a]
        if round(float(p.get("introduction_version") or 0) * 100) > FIRMWARE:
            problems.append(f"{label(p)} came in firmware {p['introduction_version']}, after the stamp ({FIRMWARE}): "
                            f"a minichord loading the preset would reset it")
        if a in KNOB_TARGETS | TAP_TARGETS and v:
            t = params.get(v)
            if a in KNOB_TARGETS:
                ok = t is not None and v != LOOPER and (t.get("controls") or "all") == "all"
            else:
                ok = v == LOOPER or (t is not None and (t.get("controls") or "all") in ("all", "tap"))
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
    # and the double tap stores over it, so each setting gets one control at most
    owners = {}
    for a in sorted(KNOB_TARGETS | TAP_TARGETS):
        if values[a] and values[a] != LOOPER:
            owners.setdefault(values[a], []).append(label(params[a]))
    for target, who in owners.items():
        if len(who) > 1:
            problems.append(f"{label(params[target])} is moved by more than one control: {', '.join(who)}")
    if problems:
        raise SystemExit(f"{preset['name']}:\n  " + "\n  ".join(problems))
    return values


def code(values):
    """as minicontrol's export writes one: every value, both pages"""
    return base64.b64encode(";".join(str(v) for v in values).encode("ascii")).decode("ascii")


def demo_file(i, preset):
    """the demo recorded for a preset, if there is one: demos/NN-name.mp3"""
    name = preset["name"].lower().replace(" & ", "-").replace(" ", "-")
    path = f"demos/{i + 1:02d}-{name}.mp3"
    return path if os.path.exists(os.path.join(HERE, path)) else None


def control_lines(preset):
    return [f"- **{k}**: {v}" for k, v in preset["controls"].items()]


def main():
    params = load_parameters()
    built = [build(p, params) for p in presets.PRESETS]
    assert len(built) == 12, "a set is twelve banks"

    names = {}
    for a, p in sorted(params.items()):
        names[a] = f'{p["section"]} · {p["group"]} · {p["name"].strip()}'
    backup = {
        "minichord_backup": 1,
        "created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "firmware_version": FIRMWARE,
        "parameter_size": PARAMETER_SIZE,
        "address_names": names,
        "banks": [{"bank": i, "name": p["name"],
                   "values": [None if a in KEEP_ON_RESTORE else v for a, v in enumerate(values)]}
                  for i, (p, values) in enumerate(zip(presets.PRESETS, built))],
    }
    with open(os.path.join(HERE, "gen2.backup.json"), "w") as f:
        json.dump(backup, f, indent=1)

    lines = [
        "# Gen 2 presets",
        "",
        "Twelve presets, one for each bank, each built around something the minichord learnt after its "
        "first twelve presets were made. Generated by `build.py` from `presets.py`; edit those, not this.",
        "",
        "A draft: the set is still being tuned by ear, and may change before it is final.",
        "",
        "They need firmware 41 or later, from the test-allFeatures branch.",
        "",
        "**All twelve at once:** in minicontrol, \"reorder and bulk edit\", then \"restore from a backup\" with "
        "`gen2.backup.json`. That replaces every bank (back up first). It keeps each bank's MIDI routing, "
        "tuning reference, LED brightness, harp plate and thresholds, and USB audio as they are.",
        "",
        "**One at a time:** \"load preset code\" with the code below, then save it to a bank.",
        "",
        "Banks 4, 5 and 11 are in 31-tone equal temperament, where a sharp and the flat above it are "
        "different notes (A sharp is a third of a semitone below B flat). The sharp button plays sharps, so "
        "in a flat key set the chord key signature, or turn the sharp button into a flat one (sharp function).",
        "",
        "Hover is a hand held over the harp plate, full about 2 cm above it. The mod knob's main function "
        "takes effect from where the knob sits when the preset loads; the stored value is the middle of its "
        "sweep.",
        "",
        "The presets and demos were made by Claude (Anthropic's AI), on a minichord, with a player steering. "
        "The demos were recorded from the minichord's USB audio: the notes went in over MIDI, and the hand "
        "and knobs were played by writing their settings as it recorded. So they leave out what needs a "
        "hand on the instrument: the buttons' own voicings, the harp's touch, and the harp ribbon, which "
        "makes Midnight Raga something else entirely (the Ribbon Lead demo fakes its slides with quick runs). "
        "Play those two before judging them.",
        "",
        "| Bank | Preset | Demo | Shows |",
        "|---|---|---|---|",
    ]
    for i, p in enumerate(presets.PRESETS):
        demo = demo_file(i, p)
        lines.append(f"| {i + 1} | {p['name']} | {f'[listen]({demo})' if demo else ''} | {', '.join(p['shows'])} |")
    for i, (p, values) in enumerate(zip(presets.PRESETS, built)):
        lines += ["", f"## {i + 1}. {p['name']}", "", p["blurb"], "", *control_lines(p), "",
                  "<details><summary>Preset code</summary>", "", "```", code(values), "```", "", "</details>"]
    with open(os.path.join(HERE, "README.md"), "w") as f:
        f.write("\n".join(lines) + "\n")
    print(f"Built {len(built)} presets: gen2.backup.json, README.md")


if __name__ == "__main__":
    main()
