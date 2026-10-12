# Preset sets

Twelve presets to a set, one per bank, each built from a `presets.py` by `build.py` into a backup for
minicontrol's "reorder and bulk edit" > "restore from a backup", and a README with each preset's controls
and its preset code.

- [gen2](gen2/README.md): the second generation, revised for firmware 68 (Midnight Raga rebuilt around the
  tanpura and the recorded tabla)
- [gen3](gen3/README.md): twelve instruments and ways of playing them, on firmware 46-69

Sets of one kind of sound, some presets borrowed from the generations as they are:

- [classical](classical/README.md): medieval organum to a string adagio, each in its period's tuning
- [electric-piano](electric-piano/README.md): Rhodes, Wurlitzer, FM tine, vibes, and the music around them
  (firmware 73)
- [world](world/README.md): west to east, Brazil to Japan, three ragas from dawn to midnight (firmware 73)
- [drum-and-bass](drum-and-bass/README.md): liquid to jungle to halftime, at 168-174 bpm (firmware 73)

```
python3 presets/build.py gen2      # or any set's folder name: the backup and the README
python3 presets/lint.py gen2 gen3 classical  # settings that a preset's other settings keep from being heard
```

`kit.py` holds the parts the sets are written with. `lint.py` reads the describer's conflict table from the
minichord repository (`~/minichord/firmware/preset_maker/interpret.py`).

Levels were measured on the device with `~/minichord-bench/preset_sets.py` and `preset_levels.py`, against
the factory presets measured in the same session: chords at the factory's level, the harp's twelve-string
strum about 3.5 dB above it, single-line leads (melodica, ribbon, chanter) by one held note, the drums
and the drone by their own takes.
