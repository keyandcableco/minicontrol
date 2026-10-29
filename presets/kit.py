"""The parts the preset sets (gen2/presets.py, gen3/presets.py) are written with.

Every value is in parameters.json's own units (floats as floats, times in ms, frequencies in Hz).
A preset starts from the parameters.json defaults and sets each of its sections whole: a section's
oscillators, envelope, filter and effects are all written, so nothing is inherited by accident.
Knob, hover, phone and double tap targets are addresses; their values are in the target's units.
"""

# ---- names for the addresses --------------------------------------------------------------------
# Chords
C_OSC = (121, 122, 123, 124, 125, 126, 127, 128, 129, 130)   # amp, wave, mult x3, noise
C_NOTES = (131, 132, 133, 134)
C_ENV = (137, 138, 139, 140, 141)                              # attack, hold, decay, sustain, release
C_FILT = (143, 144, 145)                                       # base, keytrack, resonance
C_FENV = (146, 147, 148, 149, 150, 155)                        # attack, hold, decay, sustain, release, sensitivity
C_LFO = (152, 153, 154)                                        # filter LFO wave, freq, amount
C_TREM = (156, 157, 159)                                       # wave, freq, amount
C_VIB = (160, 161, 163, 164, 165, 166, 167, 168, 170, 175)     # wave, freq, amp, att, hold, dec, sus, rel, bend, intensity
C_DELAY = (176, 177, 178, 179, 180, 181, 182, 183)             # length, filter f, res, lp fb, bp fb, hp fb, dry, mix
C_OUT = (192, 193, 194, 195, 196, 197)                         # freq, res, lp, bp, hp, amp
# Harp
H_ENV = (43, 44, 45, 46, 47)
H_FILT = (49, 50, 51)
H_FENV = (52, 53, 54, 55, 56, 58)
H_TREM = (59, 60, 61)
H_VIB = (62, 63, 64, 65, 66, 67, 68, 69, 71, 76)
H_DELAY = (77, 78, 79, 80, 81, 82, 83, 84)
H_OUT = (88, 89, 90, 91, 92, 97)
H_LFO = (93, 94, 95, 96)
H_TRANS = (100, 101, 102, 103, 104, 105)                       # wave, amount, attack, hold, decay, note level

# waveforms
SINE, SAW, SQUARE, TRI, BL_PULSE, PULSE, RSAW, SH, VTRI, BL_SAW, BL_RSAW, BL_SQUARE = range(12)

# chord types, for the alternate layout (202-208)
MAJ, MIN, DOM7, MAJ7, MIN7, DIM, AUG, MAJ6, MIN6, DIM7, HALFDIM, SUS4, SUS2, SUS4_7, MAJ9, MIN9, ADD9, SIX9 = range(1, 19)
HARMONIC7 = 22

# sampled voices: harp voice (264) and chord voice (265); each chord note's own voice (270-273) is one more
# (NOTE_OWN its own oscillators, note_voice(PIANO) and so on). 6-9 are firmware 73; REED (a Wurlitzer
# model) firmware 78; KALIMBA, MARIMBA and ORGAN (a tonewheel model) 79; UPRIGHT and ACCORDION 80.
PIANO, PIZZ, CHOIR, QUARTET, SONG, VIBES, BASS, SITAR, EPIANO = range(1, 10)
REED, KALIMBA, MARIMBA, ORGAN, UPRIGHT, ACCORDION = range(10, 16)
NOTE_OWN = 1


def note_voice(voice):
    return voice + 1


# temperaments (237)
EQUAL, MEANTONE, JUST, PYTHAGOREAN = 0, 1, 2, 3
EDO19, EDO24, EDO31, OWN = 10, 11, 12, 13

NOTE_NAMES = ("C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B")


def z(addrs, vals):
    assert len(addrs) == len(vals), (addrs, vals)
    return dict(zip(addrs, vals))


def merge(*ds):
    out = {}
    for d in ds:
        out.update(d)
    return out


# ---- presets from another set -------------------------------------------------------------------
def borrow(set_name, preset_name, **changes):
    """a preset from another set (presets/<set_name>/presets.py), as it is there, with the settings in
    changes (address=value as a dict under settings, or name/blurb/hue/... replaced) applied over it"""
    import copy, importlib.util, os
    here = os.path.dirname(os.path.abspath(__file__))
    spec = importlib.util.spec_from_file_location(f"_{set_name}", os.path.join(here, set_name, "presets.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    p = copy.deepcopy(next(q for q in module.PRESETS if q["name"] == preset_name))
    settings = changes.pop("settings", {})
    p["settings"].update(settings)
    p.update(changes)
    p["from"] = f"{set_name}: {preset_name}"
    return p


# ---- the chords ---------------------------------------------------------------------------------
def chord_osc(a1, w1, m1, a2=0.0, w2=SINE, m2=2.0, a3=0.0, w3=SINE, m3=0.5, noise=0.0):
    return {265: 0, **z(C_OSC, (a1, w1, m1, a2, w2, m2, a3, w3, m3, noise))}


def chord_sample(voice):
    """a sampled chord voice (265: PIANO, PIZZ, CHOIR, QUARTET ... ACCORDION above): the oscillators are
    silenced by the firmware, levels left at defaults"""
    return {265: voice}


def organ(drawbars, percussion=0):
    """the tonewheel organ's registration (388: 0 888000000 jazz, 1 rock, 2 ballad, 3 flute, 4 688600000
    gospel, 5 hollow, 6 reedy, 7 full) and percussion (389: 0 none, 1 4' fast, 2 2 2/3' fast, 3 slow),
    shared by the harp and the chords when either plays ORGAN (firmware 79)"""
    return {388: drawbars, 389: percussion}


def reed_bark(chord=60, harp=60):
    """how hard the reed piano is struck (387 the chords, 386 the harp at full touch), 60 the usual bark"""
    return {387: chord, 386: harp}


def chord_notes(first, second, third, fourth):
    """the four chord notes' levels, bass first"""
    return z(C_NOTES, (first, second, third, fourth))


def chord_env(a, h, d, s, r, retrig=1):
    return {**z(C_ENV, (a, h, d, s, r)), 142: retrig}


def chord_filter(base, key, res, fa=1, fh=0, fd=1, fs=1.0, fr=1, sens=0.0, lfo=(SINE, 0.0, 0.0)):
    return {**z(C_FILT, (base, key, res)), **z(C_FENV, (fa, fh, fd, fs, fr, sens)), 151: 1, **z(C_LFO, lfo)}


def chord_trem(freq=4.0, amt=0.0, wave=SINE):
    return z(C_TREM, (wave, freq, amt))


def chord_vib(freq=0.0, amp=0.0, intensity=0.0, att=1, sus=1.0, wave=SINE):
    # bend at its centre (1.0) so the intensity only scales the vibrato; bend envelope left short
    return z(C_VIB, (wave, freq, amp, att, 1, 1, sus, 1, 1.0, intensity))


def chord_delay(ms=0, filt=0, fb=0.0, mix=0.0, res=0.7, bp=0.0, hp=0.0, dry=1.0):
    return z(C_DELAY, (ms, filt, res, fb, bp, hp, dry, mix))


def tilt(freq, lp, bp, hp, amp, res=1.0):
    """the output filter as a tilt: at resonance 1 equal lp, bp and hp are flat; less lp thins the
    lows below freq, less hp softens the highs above it"""
    return (freq, res, lp, bp, hp, amp)


def chord_out(*a, **k):
    return z(C_OUT, tilt(*a, **k))


def chord_fx(reverb, crunch=0.0, crunch_type=0, ensemble=0):
    return {184: reverb, 185: crunch, 186: crunch_type, 259: ensemble}


def alt_layout(maj=0, mn=0, seventh=0, maj7=0, min7=0, majmin=0, all3=0):
    """the alternate layout's chord on each button combination (0 the slot's own)"""
    return z((202, 203, 204, 205, 206, 207, 208), (maj, mn, seventh, maj7, min7, majmin, all3))


# ---- the harp -----------------------------------------------------------------------------------
def harp_synth(wave, amp=0.15, model=0):
    return {264: 0, 42: wave, 41: amp, 217: model}


def harp_sample(voice):
    return {264: voice, 217: 0}


def harp_string(decay, damping):
    return {218: decay, 219: damping}


def harp_env(a, h, d, s, r, retrig=1):
    return {**z(H_ENV, (a, h, d, s, r)), 48: retrig}


def harp_filter(base, key, res, fa=1, fh=0, fd=1, fs=1.0, fr=1, sens=0.0):
    return {**z(H_FILT, (base, key, res)), **z(H_FENV, (fa, fh, fd, fs, fr, sens)), 57: 1}


def harp_trem(freq=0.0, amt=0.0, wave=SINE):
    return z(H_TREM, (wave, freq, amt))


def harp_vib(freq=0.0, amp=0.0, intensity=0.0, att=1, sus=1.0, wave=SINE):
    return z(H_VIB, (wave, freq, amp, att, 1, 1, sus, 1, 1.0, intensity))


def harp_delay(ms=0, filt=0, fb=0.0, mix=0.0, res=0.7, bp=0.0, hp=0.0, dry=1.0):
    return z(H_DELAY, (ms, filt, res, fb, bp, hp, dry, mix))


def harp_out(*a, **k):
    return {**z(H_OUT, tilt(*a, **k)), **z(H_LFO, (SINE, 0.0, 0.0, 0.0))}


def harp_transient(amt, wave=SINE, a=1, h=5, d=30, level=0):
    return z(H_TRANS, (wave, amt, a, h, d, level))


def harp_fx(reverb, crunch=0.0, crunch_type=0, spread=0, pattern=0):
    return {85: reverb, 86: crunch, 87: crunch_type, 257: spread, 258: pattern}


def ribbon(snap, glide, span=0, step_snap=0):
    return {245: 1, 246: span, 247: snap, 248: glide, 350: step_snap}


def scale_bits(*degrees):
    """a custom scale (236, 352) from its degrees in semitones above the root"""
    return sum(1 << d for d in set(degrees))


def custom_scale(up, down=None, on_chord=False):
    """scalar harp mode 10 (on the key) or 11 (on the chord's root) with this scale; a down form turns
    melodic direction on"""
    out = {36: 11 if on_chord else 10, 236: scale_bits(*up), 351: 0, 352: 0}
    if down is not None:
        out.update({351: 1, 352: scale_bits(*down)})
    return out


def maqam(n, on_chord=False, direction=1, upper=0):
    """scalar harp mode 14 (on the key) or 15 (on the chord) playing maqam n (356): 0 Rast, 1 Bayati,
    2 Saba, 3 Hijaz, 4 Sikah, 5 Nahawand, 6 Kurd, 7 Ajam"""
    return {36: 15 if on_chord else 14, 356: n, 357: upper, 351: direction}


# ---- the instrument as a whole ------------------------------------------------------------------
def reverb_room(size, hi_damp=0.0, lo_damp=0.5, lowpass=0.3, diffusion=0.6):
    return {24: size, 25: hi_damp, 26: lo_damp, 27: lowpass, 28: diffusion}


def tuning(temperament=EQUAL, purity=0, key=0, transpose=0):
    return {237: temperament, 358: purity, 35: key, 30: transpose}


def own_temperament(**cents):
    """temperament 13: each note's offset from equal temperament, in cents (C=0, Eb=-6.0 ...), stored as
    tenths of a cent from 1000; notes not named stay where equal temperament has them"""
    out = {237: OWN}
    for i, name in enumerate(NOTE_NAMES):
        c = cents.get(name.replace("#", "s"), 0.0)
        assert -100 <= c <= 100, (name, c)
        out[359 + i] = round(1000 + c * 10)
    return out


def pythagorean(lowest="C#"):
    """temperament 13 as a chain of eleven pure fifths up from lowest, the wolf fifth just below it.
    The stock Pythagorean (temperament 3) runs Eb to G#, so its A flat is a sharp G# (816 cents) and
    Ab-Eb is the wolf; from C# (Db) the chain runs to F#, so Db, Ab, Eb and Bb are the low, flat ones
    (Ab 792 cents, Eb 294) and every fifth but F#-Db is pure"""
    from math import log2
    fifth = 1200 * log2(1.5)
    start = NOTE_NAMES.index(lowest)
    below = next(k for k in range(12) if (-7 * k) % 12 == start)   # fifths below C: Db is 5
    cents = {}
    for k in range(-below, 12 - below):
        pc = (7 * k) % 12
        offset = (k * fifth - pc * 100 + 600) % 1200 - 600
        cents[NOTE_NAMES[pc].replace("#", "s")] = round(offset, 2)
    return own_temperament(**cents)


def drone(mode, level=50, pace=12, register=1, reverb=0):
    """the drone (372-375) on the key's Sa: 1 a tanpura Pa Sa Sa Sa, 2 with Ma for Pa, 3 with Ni, 4 all Sa,
    5 a shruti box; register 0 low (E2-E3), 1 middle (A2-A3), 2 high (D3-D4); reverb, its send into the
    room the harp and chords share (379, firmware 69)"""
    return {372: mode, 373: level, 374: pace, 375: register, 379: reverb}


# ---- controls -----------------------------------------------------------------------------------
C_ALT, H_ALT, M_MAIN, M_ALT = (10, 11), (12, 13), (14, 15), (16, 17)


def knobs(chord_alt=None, harp_alt=None, mod=None, mod_alt=None):
    """each (address, range %); the main chord and harp knobs stay the section volumes"""
    out = {}
    for (ca, ra), pair in ((C_ALT, chord_alt), (H_ALT, harp_alt), (M_MAIN, mod), (M_ALT, mod_alt)):
        if pair:
            out[ca], out[ra] = pair
    return out


def hover(target, value, reach=7):
    return {249: target, 250: value, 251: reach}


def hover_alt(target, value):
    """what a hand over the plate moves while the modifier is held (325-326, firmware 58)"""
    return {325: target, 326: value}


def double_tap(*pairs, hold=0):
    """up to three (address, value) pairs the double tap toggles together; hold 1: tap, then press and
    hold the modifier, and they flip only while it is held (321, firmware 55)"""
    out = {200: 0, 201: 1, 209: 0, 210: 1, 211: 0, 212: 1, 321: hold}
    for (ca, va), (c, v) in zip(((200, 201), (209, 210), (211, 212)), pairs):
        out[ca], out[va] = c, v
    return out


def phone_follow(slot, target, value, band=0, release=200):
    """the music coming in over USB moves a setting, as hover does (303-310, firmware 52): band 0 whole,
    1 bass (kick), 2 treble (hats)"""
    base = 303 if slot == 1 else 307
    return {base: target, base + 1: value, base + 2: band, base + 3: release}


def bent_board(rail=(100, 100, 100, 100, 100), palm=(442, 100), ribbon=(434, 100), options=0,
               rail_targets=(430, 433, 434, 436, 438)):
    """the bent board's touch areas (472-486, firmware 121; harp plate 5): each (target, value), the setting
    it moves from the preset's own toward value as it is pressed firmly (the ribbon by where the thumb is
    along it). rail: the five points' values, left to right, on rail_targets (the bends by default); on a bend
    the value is how deep a firm press goes. options: bent board options (486), its switches added up: 1 the
    ribbon by how firmly, 2 catch, 4 the harp strikes, 8 the second knob, 16 rolls, 32 the plug, 64 the palm
    hold, 128 the chain"""
    out = {}
    for k, (t, v) in enumerate(zip(rail_targets, rail)):
        out[472 + 2 * k], out[473 + 2 * k] = t, v
    out[482], out[483] = palm
    out[484], out[485] = ribbon
    out[486] = options
    return out


def performance(revert=1):
    """the modifier with up and down: down reverts the preset as saved, up is the panic (322, firmware 56)"""
    return {322: revert}


# ---- rhythm mode --------------------------------------------------------------------------------
def rhythm(steps, bpm=None, length=16, update=4, swing=1.0, note_ms=None):
    steps = (list(steps) * 16)[:16]
    out = {220 + i: s for i, s in enumerate(steps)}
    out.update({188: length, 189: update, 190: swing})
    if bpm:
        out[187] = bpm
    if note_ms:
        out[191] = note_ms
    return out


STYLES = {1: "Alberti bass", 2: "waltz", 3: "boom-chick", 4: "walking bass", 5: "boogie", 6: "Travis picking",
          7: "strummed guitar", 8: "bossa nova", 9: "arpeggio up", 10: "arpeggio up and down", 11: "ballad",
          12: "reggae", 13: "6/8 arpeggio", 14: "habanera"}
HOLD, REST = 1, 2


def style(n, bpm, bass=0, chords=0, follows=0, change=0, articulation=100, accents=100, swing=1.0):
    """what rhythm mode plays (274-280, firmware 42), a written part that follows the held chord.
    bass and chords: 0 play the style's part, 1 hold the chord, 2 rest. follows: 0 plays on, 1 only
    while a chord is held, 2 the same with the bar starting from the press. change: a new chord on its
    next note, beat or bar"""
    return {274: n, 275: bass, 276: chords, 277: follows, 278: change, 279: articulation, 280: accents,
            187: bpm, 190: swing}


def sections(b=0, groove_b=0, intro=0, ending=0, fill=0, palm_break=0, count_in=0):
    """rhythm mode's sections (firmware 53, 60): style B after each fill (and its groove), a bar of fill
    as an intro, the long press on hold playing an ending, a fill on modifier + hold, a palm mute
    stopping the band to the bar line, a bar of sticks before it starts"""
    return {314: b, 336: groove_b, 317: intro, 318: ending, 316: fill, 319: palm_break, 341: count_in}


GROOVES = {1: "rock", 2: "pop eighths", 3: "pop sixteenths", 4: "ballad", 5: "funk", 6: "disco", 7: "motown",
           8: "shuffle", 9: "jazz swing", 10: "waltz", 11: "march", 12: "second line", 13: "country two-beat",
           14: "folk", 15: "six eight", 16: "habanera", 17: "house", 18: "trap", 19: "amen-style break",
           20: "funky drummer-style", 21: "think-style break", 22: "boom bap", 23: "drum and bass", 24: "lo-fi",
           25: "son clave", 26: "rumba clave", 27: "bossa nova", 28: "samba", 29: "cumbia", 30: "baiao",
           31: "salsa", 32: "one drop", 33: "dembow", 34: "soca", 35: "afrobeat", 36: "12/8 bell", 37: "highlife",
           38: "maqsum", 39: "baladi", 40: "saidi", 41: "kehrwa", 42: "dadra", 43: "teental"}
KITS = {1: "808", 2: "909", 3: "CR-78", 4: "studio", 5: "brushes", 6: "boom bap", 7: "world percussion",
        8: "tabla and doumbek", 9: "trap", 10: "house", 11: "glitch"}


def drums(groove, kit=0, level=70, humanize=0, groove_b=0, only=0, harp=0, reverb=0, laya=0):
    """rhythm mode's drum machine (334-343, firmware 60): groove 0 plays the rhythm style's own drum part,
    else one of GROOVES; kit 0 the groove's own, else one of KITS; level beside the chords and harp;
    humanize 0 on the grid to 100 loose; harp 1 makes the strings the kit's pads. Firmware 69: reverb, the
    drums' send into the room (378); laya, the tabla's thekas against the tempo (377): 0 a bol a step, as
    written, 1 a bol a beat (the tempo counts matras), 2 two a beat, 3 four"""
    return {334: 1, 335: groove, 336: groove_b, 337: kit, 338: level, 339: humanize, 342: only, 343: harp,
            378: reverb, 377: laya}


def hammer_on(ms=180):
    """hammer-on (302, firmware 51): a finger landing beside a held, ringing string takes it over; ms, how
    long it must have rung first (376, firmware 69): 180 lets a slow strum pluck every string, 40-60 lets
    a grace note or a trill follow at once"""
    return {302: 1, 376: ms}


def speed_ramp(tenths):
    """how long tremolo and vibrato take to reach a new rate (380, firmware 69), as a rotating speaker's
    rotors spin up and coast down"""
    return {380: tenths}


def looper(quantize=0, count_in=0, click=0, click_level=50, length=0):
    """the looper in time (283-286, 288, firmware 46-48): quantize 0 off, 1 quarters, 2 eighths, 3
    sixteenths, 4 triplets; count-in bars; click 0 off, 1 count-in, 2 and recording, 3 and playing"""
    return {283: quantize, 284: count_in, 285: click, 286: click_level, 288: length}


LOOPER, CHORD_MEMORY, RHYTHM_FILL, PHONE_DECK = 256, 287, 315, 332   # the double tap takes a step of these


# ---- borrowing one section of another preset ----------------------------------------------------
CHORD_SIDE = (set(C_OSC) | set(C_NOTES) | set(C_ENV) | set(C_FILT) | set(C_FENV) | set(C_LFO) | set(C_TREM)
              | set(C_VIB) | set(C_DELAY) | set(C_OUT)
              | {39, 111, 112, 120, 142, 151, 184, 185, 186, 198, 199, 259, 265, 270, 271, 272, 273, 320, 387}
              | set(range(202, 209)))
ROOM = {24, 25, 26, 27, 28}


FORMANTS = {118, 119, 239, 240}


def chords_from(set_name, preset_name, room=True, formants=False):
    """the chord buttons' sound from a preset of another set (and its room, the reverb the sections share):
    its oscillators or samples, notes, envelope, filter, effects, layout, voice leading and glide, and with
    formants its formant filter, nothing of its harp, controls or rhythm"""
    settings = borrow(set_name, preset_name)["settings"]
    keep = CHORD_SIDE | (ROOM if room else set()) | (FORMANTS if formants else set())
    return {a: v for a, v in settings.items() if a in keep}
