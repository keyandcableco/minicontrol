# Preset sets

Twelve presets to a set, one per bank, each built from a `presets.py` by `build.py` into a backup for
minicontrol's "reorder and bulk edit" > "restore from a backup", and a README with each preset's controls
and its preset code.

- [gen2](gen2/README.md): the second generation, revised for firmware 68 (Midnight Raga rebuilt around the
  tanpura and the recorded tabla) and 80 (the sampled sitar and upright bass where they were imitated)
- [gen3](gen3/README.md): twelve instruments and ways of playing them, on firmware 46-69, and for firmware 80
  the tonewheel organ, the sampled electric piano and the accordion where they were imitated

Sets of one kind of sound, some presets borrowed from the generations as they are:

- [classical](classical/README.md): medieval organum to a string adagio, each in its period's tuning
- [electric-piano](electric-piano/README.md): Rhodes, Wurlitzer, FM tine, vibes, and the music around them
  (firmware 80: the Wurlitzer is the reed piano model, the jazz basses the sampled upright)
- [world](world/README.md): west to east, Brazil to Japan, three ragas from dawn to midnight (firmware 80)
- [drum-and-bass](drum-and-bass/README.md): liquid to jungle to halftime, at 168-174 bpm (firmware 80)
- [folk](folk/README.md): the front porch, autoharp to campfire song: pluck on lift, the koto press as a
  dulcimer's noter, a pedal steel on the ribbon, a washboard band on the harp's pads (firmware 80)
- [synth](synth/README.md): synthwave to Berlin school: chiptune, acid, a theremin, a trance gate, an 808
  beatbox, a radio DJ whose harp strums along with the song (firmware 73)
- [mallets](mallets/README.md): Mallets & Tines, thumb to mallet: a Shona mbira's interlocking parts, Konono's
  likembes, the marimbula, Earth, Wind & Fire's kalimba, a balafon in seven equal steps, a Zimbabwean marimba
  band, the marimba doble of Guatemala, Reich's pulse, exotica, tropical house (firmware 80)
- [piano](piano/README.md): Acoustic Piano, a concert grand to a piano on tape: a sonata, a nocturne,
  Satie, ragtime turning into stride, boogie-woogie, Barry Harris's sixth-diminished blocks (brothers and
  brothers again), a jazz waltz, gospel, Glass's arpeggios, a felt piano; each bank's hover a different
  third hand (firmware 88)
- [ambient](ambient/README.md): slow instruments for a quiet room: glass, bowls, a tanpura with the jawari
  on the mod knob, generative rain, Orwell's scale, a music box that winds down (firmware 74)

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
