"""The second generation of factory presets: twelve sounds, each built around something the
minichord learnt after the first twelve were made.

Every value is in parameters.json's own units (floats as floats, times in ms, frequencies in Hz).
Each preset starts from the parameters.json defaults and sets each of its sections whole: a
section's oscillators, envelope, filter and effects are all written, so nothing is inherited by
accident. Knob, hover and double tap targets are addresses; their values are in the target's units.
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


def z(addrs, vals):
    assert len(addrs) == len(vals), (addrs, vals)
    return dict(zip(addrs, vals))


def chord_osc(a1, w1, m1, a2=0.0, w2=SINE, m2=2.0, a3=0.0, w3=SINE, m3=0.5, noise=0.0):
    return {265: 0, **z(C_OSC, (a1, w1, m1, a2, w2, m2, a3, w3, m3, noise))}


def chord_sample(voice):
    """a sampled chord voice: the oscillators are silenced by the firmware, levels left at defaults"""
    return {265: voice}


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


def reverb_room(size, hi_damp=0.0, lo_damp=0.5, lowpass=0.3, diffusion=0.6):
    return {24: size, 25: hi_damp, 26: lo_damp, 27: lowpass, 28: diffusion}


def knobs(chord_alt=None, harp_alt=None, mod=None, mod_alt=None):
    """each (address, range %); the main chord and harp knobs stay the section volumes"""
    out = {}
    for (ca, ra), pair in ((C_ALT, chord_alt), (H_ALT, harp_alt), (M_MAIN, mod), (M_ALT, mod_alt)):
        if pair:
            out[ca], out[ra] = pair
    return out


C_ALT, H_ALT, M_MAIN, M_ALT = (10, 11), (12, 13), (14, 15), (16, 17)


def hover(target, value, reach=7):
    return {249: target, 250: value, 251: reach}


def double_tap(*pairs):
    out = {200: 0, 201: 1, 209: 0, 210: 1, 211: 0, 212: 1}
    for (ca, va), (c, v) in zip(((200, 201), (209, 210), (211, 212)), pairs):
        out[ca], out[va] = c, v
    return out


def rhythm(steps, bpm=None, length=16, update=4, swing=1.0, note_ms=None):
    steps = (list(steps) * 16)[:16]
    out = {220 + i: s for i, s in enumerate(steps)}
    out.update({188: length, 189: update, 190: swing})
    if bpm:
        out[187] = bpm
    if note_ms:
        out[191] = note_ms
    return out


def merge(*ds):
    out = {}
    for d in ds:
        out.update(d)
    return out


# ---- the presets ---------------------------------------------------------------------------------
# Each: name, hue, a line for the player, what it shows, the controls in words, and the settings.

PRESETS = []


def preset(name, hue, blurb, shows, controls, *parts):
    PRESETS.append(dict(name=name, hue=hue, blurb=blurb, shows=shows, controls=controls,
                        settings=merge({20: hue}, *parts)))


# 1 ------------------------------------------------------------------------------------------------
preset("Open Hand Pad", 210,
       "A warm, chorused analog pad that blooms open, and a glassy harp that ping-pongs across the "
       "stereo field. Hold a hand over the harp plate and the pad's filter opens.",
       ["hover on the chord filter", "chord ensemble", "pentatonic chosen per chord", "string spread (ping-pong)",
        "alternate chord layout on the double tap"],
       {"hover": "opens the chord filter, from dark with no hand to bright with a hand close over the plate",
        "mod knob": "the swell: chords from a quick, keyboard-like start to a slow fade in",
        "modifier + mod knob": "chord release, short to long",
        "modifier + chord knob": "chord ensemble, from dry to a lush Juno chorus",
        "modifier + harp knob": "harp delay mix",
        "double tap": "the suspended and extended chords (sus4, sus2, maj9, min9, add9, 6/9) on the same buttons"},
       chord_osc(0.12, BL_PULSE, 1.0, 0.09, BL_SAW, 1.0, 0.06, TRI, 0.5),
       chord_env(450, 0, 1500, 0.85, 2200),
       chord_filter(420, 0.3, 1.6, fa=900, fd=2200, fs=0.45, fr=2000, sens=1.0, lfo=(SINE, 0.22, 0.12)),
       chord_trem(), chord_vib(),
       chord_delay(),
       chord_out(400, 0.85, 1.0, 0.8, 1.05),
       chord_fx(0.45, ensemble=60),
       {120: 2, 198: 2},
       harp_synth(TRI, 0.15), harp_env(1, 0, 1300, 0.0, 1300),
       harp_filter(1100, 0.6, 0.9),
       harp_trem(), harp_vib(),
       harp_delay(360, 2600, 0.35, 0.22),
       harp_transient(0.08, SINE, 1, 4, 25, 12),
       harp_out(900, 0.8, 1.0, 1.0, 0.85),
       harp_fx(0.5, spread=80, pattern=1),
       {36: 9},
       reverb_room(0.78, 0.25, 0.5, 0.35, 0.7), {29: 0.7},
       hover(143, 3200, 8),
       knobs(chord_alt=(259, 100), harp_alt=(84, 100), mod=(137, 100), mod_alt=(141, 90)),
       double_tap((39, 1)))

# 2 ------------------------------------------------------------------------------------------------
preset("Concert Harp", 55,
       "A plucked string model harp, strings fanned out low left to high right as if sitting at it, "
       "over a soft string section. The strings are tuned to the scale of each chord, so a sweep is a "
       "harpist's glissando. Pluck harder or strum faster to play louder; lay a flat hand across the "
       "plate to damp the strings.",
       ["plucked string model", "scale chosen per chord (glissandi)", "touch velocity", "strum velocity", "palm mute",
        "string spread (by pitch)",
        "string quartet samples", "pluck on lift on the double tap"],
       {"hover": "swells the string section, from soft with no hand to full with a hand close over the plate",
        "mod knob": "the strings: bright and metallic, through gut, to round and soft",
        "modifier + mod knob": "how long the strings ring, from a short, damped pluck to a long ring",
        "modifier + chord knob": "the string section's attack",
        "modifier + harp knob": "harp reverb",
        "double tap": "pluck on lift: rest fingers on strings and they sound as you lift them, like a real harp",
        "palm": "lay five or more fingers flat across the plate to stop the strings (six with pluck on lift)"},
       chord_sample(4), chord_env(380, 0, 1000, 0.85, 1500),
       chord_filter(3500, 0.0, 0.7), chord_trem(), chord_vib(), chord_delay(),
       chord_out(350, 0.7, 1.0, 1.0, 0.35),
       chord_fx(0.55),
       {120: 2, 198: 2, 111: 1, 112: 7},
       harp_synth(SINE, 0.15, model=100), harp_string(4.5, 40),
       harp_env(1, 0, 4000, 0.7, 2500),
       harp_filter(1500, 1.0, 0.7),
       harp_trem(), harp_vib(),
       harp_delay(),
       harp_transient(0.06, SINE, 1, 3, 15, 0),
       harp_out(500, 0.8, 1.0, 1.0, 0.83),
       harp_fx(0.32, spread=60, pattern=0),
       {36: 8, 252: 70, 263: 50, 213: 5, 214: 40, 216: 0},
       reverb_room(0.82, 0.3, 0.45, 0.35, 0.75), {29: 0.65},
       hover(197, 0.9, 8),
       knobs(chord_alt=(137, 100), harp_alt=(85, 100), mod=(219, 100), mod_alt=(218, 90)),
       double_tap((216, 1), (213, 6)))

# 3 ------------------------------------------------------------------------------------------------
preset("Jazz Piano", 0,
       "Sampled piano on both sides. The chords voice-lead like a comping pianist, the harp plays the "
       "scale that fits each chord, with dynamics, and the double tap turns the buttons into ninths and "
       "6/9s. A hand held over the plate is the sustain pedal.",
       ["piano samples", "voice leading", "scale chosen per chord", "touch velocity",
        "alternate chord layout", "hover as a sustain pedal"],
       {"hover": "the sustain pedal: the chords ring on with a hand held over the plate",
        "mod knob": "the piano's brightness, from a felted, lid-down sound to wide open",
        "modifier + mod knob": "how long the harp's notes ring after the finger lifts",
        "modifier + chord knob": "chord reverb",
        "modifier + harp knob": "how much the harp follows touch",
        "double tap": "maj9, min9, add9, 6/9 and sus chords on the same buttons"},
       chord_sample(1), chord_env(1, 0, 4000, 1.0, 450),
       chord_filter(2600, 0.3, 0.7), chord_trem(), chord_vib(), chord_delay(),
       chord_out(300, 0.8, 1.0, 1.0, 0.56),
       chord_fx(0.3),
       {120: 2, 198: 2, 111: 1, 112: 7},
       harp_sample(1), harp_env(1, 0, 4000, 1.0, 650),
       harp_filter(2000, 1.5, 0.7),
       harp_trem(), harp_vib(), harp_delay(),
       harp_transient(0.0),
       harp_out(300, 0.85, 1.0, 1.0, 0.65),
       harp_fx(0.25, spread=40, pattern=0),
       {36: 8, 252: 80, 263: 30},
       reverb_room(0.6, 0.35, 0.5, 0.4, 0.7), {29: 0.8},
       hover(141, 4000, 7),
       knobs(chord_alt=(184, 100), harp_alt=(252, 100), mod=(143, 85), mod_alt=(47, 100)),
       double_tap((39, 1)))

# 4 ------------------------------------------------------------------------------------------------
preset("Cantus Choir", 275,
       "A sampled choir on the chord buttons, in 31-tone equal temperament, whose thirds are within a "
       "cent of pure: the chords ring the way a choir tunes them. The voices move like a choir's, and "
       "the first note of each harp gesture becomes the sopranos' note, passing tones and all, so the "
       "harp leads the top line while the choir follows it. The harp is a concert harp that rings on "
       "under the voices. The mod knob shades the choir's vowel; a hand over the plate is a crescendo. "
       "Double tap for the just chords: the seventh button rings a true harmonic seventh.",
       ["31-EDO", "choir samples", "cantus (the harp sets the soprano)", "voice leading",
        "plucked string model", "scale chosen per chord", "formants", "hover crescendo",
        "just chords (harmonic seventh) on the double tap"],
       {"hover": "a crescendo: the choir swells with a hand close over the plate",
        "mod knob": "the choir's vowel, shaded through a, e, i, o, u",
        "modifier + mod knob": "voice size, from children to basses",
        "modifier + chord knob": "how much the vowel shades the choir",
        "modifier + harp knob": "how long the harp rings",
        "double tap": "the just chords: harmonic seventh on the 7th button, harmonic ninth on all three, "
                      "sus4 on major and minor together (the sharp button rests while they are on)",
        "palm": "lay five fingers flat across the plate to stop the harp ringing"},
       chord_sample(3), chord_env(250, 0, 800, 0.95, 1600),
       {131: 0.45, 132: 0.45, 133: 0.45, 134: 0.6},        # the top voice, the harp's, a little forward
       chord_filter(5000, 0.0, 0.7), chord_trem(), chord_vib(), chord_delay(),
       chord_out(250, 0.8, 1.0, 1.0, 0.6),
       chord_fx(0.55, ensemble=15),
       {118: 50, 119: 45, 239: 50, 240: 50},
       {120: 2, 198: 2, 111: 1, 112: 7, 115: 4, 237: 12,
        202: 1, 203: 2, 204: 22, 205: 4, 206: 5, 207: 12, 208: 26},
       harp_synth(SINE, 0.15, model=100), harp_string(7.0, 30),
       harp_env(1, 0, 5000, 0.8, 4000),
       harp_filter(1400, 1.0, 0.7),
       harp_trem(), harp_vib(), harp_delay(),
       harp_transient(0.05, SINE, 1, 3, 15, 0),
       harp_out(500, 0.8, 1.0, 1.0, 0.7),
       harp_fx(0.45, spread=50, pattern=0),
       {36: 8, 252: 60, 263: 40, 213: 5, 214: 60},
       reverb_room(0.9, 0.3, 0.45, 0.35, 0.8), {29: 0.75},
       hover(197, 1.2, 7),
       knobs(chord_alt=(119, 100), harp_alt=(218, 80), mod=(118, 100), mod_alt=(239, 80)),
       double_tap((39, 1)))

# 5 ------------------------------------------------------------------------------------------------
preset("Chamber Strings", 340,
       "A string quartet that keeps strict four-part voice leading, with no parallel fifths or "
       "octaves, in 31-tone equal temperament so its thirds ring pure, as a quartet tunes them. "
       "Pizzicato on the harp, in the scale of each chord. Hold a hand over the plate and the quartet "
       "goes into tremolo.",
       ["strict voice leading", "31-EDO", "string quartet and pizzicato samples", "hover tremolo",
        "scale chosen per chord",
        "touch velocity", "string spread", "harp voice on the double tap"],
       {"hover": "bowed tremolo, stronger the closer the hand",
        "mod knob": "where the bow is: dark and soft over the fingerboard, to bright and glassy near the bridge",
        "modifier + mod knob": "ensemble width",
        "modifier + chord knob": "bowing: from a soft swell to a sharp attack",
        "modifier + harp knob": "harp reverb",
        "double tap": "the harp bows too: the quartet, cello low to violin high"},
       chord_sample(4), chord_env(260, 0, 900, 0.95, 900),
       chord_filter(2200, 0.0, 0.7),
       chord_trem(11.0, 0.0, SINE), chord_vib(), chord_delay(),
       chord_out(300, 0.75, 1.0, 1.0, 0.45),
       chord_fx(0.5, ensemble=25),
       {120: 2, 198: 2, 111: 2, 112: 12, 237: 12},
       harp_sample(2), harp_env(1, 0, 1500, 1.0, 400),
       harp_filter(2000, 1.2, 0.7), harp_trem(), harp_vib(), harp_delay(),
       harp_transient(0.0),
       harp_out(300, 0.8, 1.0, 1.0, 0.73),
       harp_fx(0.4, spread=55, pattern=0),
       {36: 8, 252: 60},
       reverb_room(0.85, 0.3, 0.4, 0.35, 0.8), {29: 0.7},
       hover(159, 0.7, 8),
       knobs(chord_alt=(137, 100), harp_alt=(85, 100), mod=(143, 80), mod_alt=(259, 100)),
       double_tap((264, 4)))

# 6 ------------------------------------------------------------------------------------------------
preset("Folk Guitar & Bass", 25,
       "The chord buttons play an upright bass, one note, the chord's root; the harp is a nylon-string "
       "guitar an octave lower than usual. Strum fast for a loud strum, lay the palm across the plate to "
       "mute. The double tap works the looper.",
       ["plucked string model as a guitar", "strum velocity", "palm mute", "touch velocity",
        "monophonic chords as a bass", "the looper on the double tap"],
       {"hover": "unassigned",
        "mod knob": "the guitar strings: steel and bright to nylon and warm",
        "modifier + mod knob": "how long the strings ring",
        "modifier + chord knob": "bass tone",
        "modifier + harp knob": "guitar reverb",
        "double tap": "the looper: record, play, stop, then a new recording",
        "palm": "lay four or more fingers across the plate to mute, like a guitarist's palm"},
       chord_osc(0.22, TRI, 1.0, 0.13, SINE, 1.0, 0.0, SINE, 0.5),
       {131: 0.75, 132: 0.0, 133: 0.0, 134: 0.0, 120: 0, 198: 1, 111: 0},
       chord_env(2, 0, 900, 0.35, 220),
       chord_filter(380, 0.6, 1.2, fa=1, fd=220, fs=0.2, fr=150, sens=1.4),
       chord_trem(), chord_vib(), chord_delay(),
       chord_out(120, 0.9, 1.0, 1.0, 2.0),
       chord_fx(0.15),
       harp_synth(SINE, 0.15, model=100), harp_string(2.6, 50),
       harp_env(1, 0, 3500, 0.6, 700),
       harp_filter(900, 0.9, 0.8),
       harp_trem(), harp_vib(), harp_delay(),
       harp_transient(0.1, SINE, 1, 3, 12, 0),
       harp_out(450, 0.75, 1.0, 1.0, 0.85),
       harp_fx(0.22, spread=35, pattern=0),
       {99: 1, 252: 45, 263: 70, 213: 4, 214: 25},
       reverb_room(0.45, 0.4, 0.5, 0.45, 0.6), {29: 0.6},
       hover(0, 0),
       knobs(chord_alt=(143, 80), harp_alt=(85, 100), mod=(219, 100), mod_alt=(218, 80)),
       double_tap((256, 6)))

# 7 ------------------------------------------------------------------------------------------------
preset("Wah Clav & Bass", 300,
       "Funky clavinet chords with a hand-played wah: hold a hand over the plate and move it up and "
       "down to sweep the filter. The harp is a plucked synth bass on the minor pentatonic of each "
       "chord, the funk bass's scale. The double tap works the looper.",
       ["hover as a wah pedal", "the looper on the double tap", "generator scale (minor pentatonic on each chord)",
        "touch velocity", "rhythm mode funk pattern"],
       {"hover": "wah: the chord filter opens as the hand comes down toward the plate",
        "mod knob": "the quack: how far the clav's filter snaps open on each stab, from flat to all bark",
        "modifier + mod knob": "wah resonance",
        "modifier + chord knob": "clav decay",
        "modifier + harp knob": "bass filter",
        "double tap": "the looper: record, play, stop, then a new recording"},
       chord_osc(0.12, BL_PULSE, 1.0, 0.06, BL_SAW, 2.0, 0.0, SINE, 0.5),
       chord_env(1, 10, 450, 0.25, 90),
       chord_filter(450, 0.4, 2.6, fa=1, fd=220, fs=0.15, fr=60, sens=1.8),
       chord_trem(), chord_vib(), chord_delay(),
       chord_out(350, 0.6, 1.0, 1.0, 1.1),
       chord_fx(0.12, crunch=0.12, crunch_type=0),
       {120: 2, 198: 2, 21: 1},
       rhythm([15, 0, 15, 15, 0, 15, 0, 15, 15, 0, 15, 0, 15, 15, 0, 15], bpm=100, note_ms=90),
       harp_synth(BL_SAW, 0.15), harp_env(1, 0, 400, 0.35, 160),
       harp_filter(180, 0.6, 2.2, fa=1, fd=200, fs=0.1, fr=80, sens=2.5),
       harp_trem(), harp_vib(), harp_delay(),
       harp_transient(0.05, SINE, 1, 2, 10, 0),
       harp_out(150, 0.9, 1.0, 1.0, 0.95),
       harp_fx(0.08),
       {99: 0, 36: 13, 267: 7, 268: 5, 269: 3, 252: 60},
       reverb_room(0.35, 0.4, 0.5, 0.45, 0.5), {29: 0.65},
       hover(143, 2800, 8),
       knobs(chord_alt=(139, 90), harp_alt=(49, 90), mod=(155, 100), mod_alt=(145, 70)),
       double_tap((256, 6)))

# 8 ------------------------------------------------------------------------------------------------
preset("Dub Melodica", 120,
       "Reggae: offbeat skank chords (in rhythm mode) and a melodica on the harp that swells as it is "
       "pressed harder. Hold a hand over the plate to throw the chords into the echo.",
       ["hover as a dub delay throw", "touch pressure", "touch velocity", "pentatonic chosen per chord",
        "rhythm mode skank"],
       {"hover": "throws the chords into the echo",
        "mod knob": "the melodica's echo, dry to drenched",
        "modifier + mod knob": "the skank's echo feedback, for how long a throw repeats",
        "modifier + chord knob": "skank tone",
        "modifier + harp knob": "the melodica's echo time, for tape-style pitch bends",
        "double tap": "the dub wash: a huge reverb on the chords"},
       chord_osc(0.12, BL_SQUARE, 1.0, 0.06, SINE, 2.0, 0.0, SINE, 0.5),
       chord_env(1, 0, 170, 0.0, 90),
       chord_filter(1400, 0.4, 1.3),
       chord_trem(), chord_vib(),
       chord_delay(375, 1300, 0.0, 0.0, res=0.7),
       chord_out(650, 0.2, 0.8, 1.0, 1.3),
       chord_fx(0.2),
       {120: 2, 198: 2, 179: 0.55},
       rhythm([0, 15, 0, 15, 0, 15, 0, 15], bpm=140, note_ms=110),
       harp_synth(PULSE, 0.15), harp_env(25, 0, 250, 0.85, 140),
       harp_filter(1400, 0.6, 0.9), harp_trem(),
       harp_vib(5.0, 0.03, 0.3, att=400),
       harp_delay(375, 1800, 0.35, 0.25),
       harp_transient(0.0),
       harp_out(500, 0.85, 1.0, 0.9, 0.31),
       harp_fx(0.25),
       {36: 9, 252: 60, 253: 1},
       reverb_room(0.4, 0.45, 0.5, 0.5, 0.5), {29: 0.7},
       hover(183, 0.65, 8),
       knobs(chord_alt=(192, 70), harp_alt=(77, 50), mod=(84, 100), mod_alt=(179, 55)),
       double_tap((184, 0.9), (24, 1.0)))

# 9 ------------------------------------------------------------------------------------------------
preset("Ribbon Lead", 180,
       "The harp is a ribbon: slide a finger along it and a singing lead glides between the notes of "
       "the pentatonic that fits each chord, so it stays in key. Press harder to swell. A soft pad "
       "underneath glides from chord to chord.",
       ["harp ribbon", "pentatonic chosen per chord", "touch pressure", "glide chords",
        "ribbon snap and glide on the knobs"],
       {"hover": "unassigned",
        "mod knob": "vibrato, from none to a wide singer's wobble",
        "modifier + mod knob": "ribbon snap: fretless to stepped",
        "modifier + chord knob": "pad brightness",
        "modifier + harp knob": "ribbon glide: quick to slurred",
        "double tap": "back to a strummed harp, the same sound"},
       chord_osc(0.08, BL_SAW, 1.0, 0.06, BL_PULSE, 1.0, 0.04, TRI, 0.5),
       chord_env(500, 0, 1500, 0.8, 1800),
       chord_filter(600, 0.25, 1.2, fa=800, fd=1500, fs=0.4, fr=1500, sens=0.8),
       chord_trem(), chord_vib(), chord_delay(),
       chord_out(300, 0.8, 1.0, 1.0, 1.0),
       chord_fx(0.45, ensemble=55),
       {120: 2, 198: 2, 199: 250, 111: 1, 112: 7},
       harp_synth(BL_SAW, 0.15), harp_env(12, 0, 700, 0.85, 450),
       harp_filter(700, 1.2, 1.8, fa=1, fd=600, fs=0.5, fr=400, sens=1.0),
       harp_trem(),
       harp_vib(5.5, 0.06, 0.35, att=450),
       harp_delay(330, 2400, 0.3, 0.22),
       harp_transient(0.0),
       harp_out(400, 0.85, 1.0, 0.9, 0.56),
       harp_fx(0.3),
       {245: 1, 246: 0, 247: 55, 248: 90, 36: 9, 252: 60, 253: 1},
       reverb_room(0.7, 0.3, 0.5, 0.4, 0.7), {29: 0.75},
       hover(0, 0),
       knobs(chord_alt=(143, 80), harp_alt=(248, 100), mod=(64, 100), mod_alt=(247, 100)),
       double_tap((245, 0)))

# 10 -----------------------------------------------------------------------------------------------
preset("Meantone Organ", 90,
       "A pipe organ and a harpsichord in quarter-comma meantone, the tuning of Renaissance and early "
       "Baroque keyboards: pure, beatless major thirds around C, rougher in far keys. Double tap to hear "
       "the same chords in equal temperament. A hand over the plate opens the swell box.",
       ["temperament (quarter-comma meantone)", "equal temperament on the double tap",
        "plucked string model as a harpsichord", "scale chosen per chord", "hover as an organ swell"],
       {"hover": "the swell box: the organ grows louder and brighter with a hand close over the plate",
        "mod knob": "the 4' stop: from the 8' alone to a bright, full principal chorus",
        "modifier + mod knob": "tremulant depth",
        "modifier + chord knob": "the 16' bourdon, from none to a deep floor under the chords",
        "modifier + harp knob": "how long the harpsichord rings, a buff stop at one end",
        "double tap": "equal temperament, to compare"},
       chord_osc(0.12, SINE, 1.0, 0.07, TRI, 2.0, 0.06, SINE, 0.5, noise=0.012),
       chord_env(45, 0, 120, 1.0, 220),
       chord_filter(1300, 0.4, 0.8),
       chord_trem(5.6, 0.12, SINE), chord_vib(), chord_delay(),
       chord_out(250, 0.85, 1.0, 1.0, 1.0),
       chord_fx(0.6),
       {120: 2, 198: 2, 237: 1},
       harp_synth(BL_SAW, 0.15, model=100), harp_string(2.2, 6),
       harp_env(1, 0, 2500, 0.55, 220),
       harp_filter(2000, 1.6, 0.9),
       harp_trem(), harp_vib(), harp_delay(),
       harp_transient(0.15, BL_SAW, 1, 2, 8, 12),
       harp_out(700, 0.5, 1.0, 1.0, 0.9),
       harp_fx(0.35, spread=45, pattern=0),
       {36: 8, 252: 30},
       reverb_room(0.92, 0.35, 0.4, 0.3, 0.85), {29: 0.7},
       hover(143, 4500, 8),
       knobs(chord_alt=(127, 100), harp_alt=(218, 80), mod=(124, 100), mod_alt=(159, 100)),
       double_tap((237, 0)))

# 11 -----------------------------------------------------------------------------------------------
# A raga over a tanpura, in 31-EDO. The chords drone the tanpura's strings: the root, the fifth and
# the octave, the third silenced (voice 2 at 0; on a seventh chord voice 3 is the seventh, the "Ni"
# tuning some ragas use). A resonant filter swept slowly by the LFO, under a light vowel, is the
# jawari's shimmer of moving overtones. In rhythm mode the chords pluck the tanpura's cycle: Pa, Sa',
# Sa', Sa, and a rest. The harp is a ribbon over Malkauns, the midnight raga (1 b3 4 b6 b7), built
# from the meantone fifth (generator 18 in 31, five notes, four below the root) and rooted on the
# chord, so the drone's root is Sa: its thirds and sixth land within a cent or two of 6/5 and 8/5.
preset("Midnight Raga", 240,
       "A tanpura drone and a ribbon sitar in 31-tone equal temperament. Press a chord (or latch it "
       "with continuous mode) and the tanpura drones its root and fifth, overtones slowly swirling; "
       "slide along the harp for meend through raga Malkauns, rooted on the drone. Double tap for koto "
       "plucks; turn on rhythm mode and the tanpura plucks its cycle.",
       ["31-EDO", "generator scale (raga Malkauns) rooted on the chord", "harp ribbon",
        "plucked string model", "a drone from chord voices", "rhythm mode tanpura cycle"],
       {"hover": "the drone brightens with a hand close over the plate",
        "mod knob": "the jawari: the drone from smooth to a bright, buzzing shimmer",
        "modifier + mod knob": "how long the strings ring",
        "modifier + chord knob": "how much the drone's overtones swirl",
        "modifier + harp knob": "ribbon snap: free meend to stepped notes",
        "double tap": "ribbon off: koto-style plucked strings on the same scale",
        "rhythm mode": "the tanpura's cycle, Pa Sa' Sa' Sa, plucked"},
       chord_osc(0.12, BL_SAW, 1.0, 0.05, BL_PULSE, 2.0, 0.05, SINE, 0.5, noise=0.008),
       {131: 0.5, 132: 0.0, 133: 0.45, 134: 0.4, 120: 0, 198: 2, 111: 0},
       chord_env(200, 0, 3000, 0.8, 3500),
       chord_filter(1100, 0.6, 2.4, fa=1, fd=2500, fs=0.5, fr=3000, sens=0.9, lfo=(SINE, 0.13, 0.6)),
       chord_trem(), chord_vib(), chord_delay(),
       chord_out(200, 0.9, 1.0, 1.0, 1.6),
       chord_fx(0.5, ensemble=45),
       {118: 40, 119: 30, 239: 55, 240: 70},
       rhythm([4, 0, 8, 0, 8, 0, 1, 0, 0, 0], bpm=70, length=10, note_ms=1000),
       {237: 12},
       harp_synth(SINE, 0.15, model=100), harp_string(3.2, 15),
       harp_env(1, 0, 3000, 0.6, 600),
       harp_filter(1200, 1.2, 0.9),
       harp_trem(), harp_vib(), harp_delay(),
       harp_transient(0.12, SINE, 1, 2, 10, 0),
       harp_out(500, 0.7, 1.0, 1.0, 0.95),
       harp_fx(0.3, spread=40, pattern=0),
       {36: 13, 267: 18, 268: 5, 269: 4, 252: 50, 245: 1, 246: 0, 247: 35, 248: 70},
       reverb_room(0.7, 0.3, 0.5, 0.4, 0.75), {29: 0.7},
       hover(143, 2600, 8),
       knobs(chord_alt=(154, 100), harp_alt=(247, 100), mod=(145, 100), mod_alt=(218, 80)),
       double_tap((245, 0)))

# 12 -----------------------------------------------------------------------------------------------
preset("Talking Strings", 150,
       "A string machine that talks. With a hand over the plate the strings form vowels, opening "
       "from ah to oo as the hand comes down. Double tap for the vocoder: play speech or singing into "
       "the minichord over USB (minicontrol's \"talk\" loop works) and the chords say it.",
       ["vocoder on the double tap", "formants on hover", "chord ensemble (string machine)", "glide chords",
        "pentatonic chosen per chord"],
       {"hover": "the vowel: ah with no hand, oo with a hand close over the plate",
        "mod knob": "how much the strings talk: from a plain string machine to a strong vowel (turn it down "
                    "while vocoding, for clearer words)",
        "modifier + mod knob": "vocoder consonants: how much of the voice's hiss comes through",
        "modifier + chord knob": "string brightness",
        "modifier + harp knob": "harp echo",
        "double tap": "the vocoder: the chords take the shape of the sound coming in over USB"},
       chord_osc(0.13, BL_SAW, 1.0, 0.08, BL_SAW, 2.0, 0.0, SINE, 0.5),
       chord_env(140, 0, 600, 1.0, 900),
       chord_filter(3200, 0.3, 0.8), chord_trem(), chord_vib(), chord_delay(),
       chord_out(300, 0.75, 1.0, 1.0, 2.0),
       chord_fx(0.35, ensemble=85),
       {118: 0, 119: 60, 239: 50, 240: 55, 260: 0, 261: 0, 262: 40},
       {120: 2, 198: 2, 199: 120, 111: 1, 112: 7},
       harp_synth(BL_SQUARE, 0.15), harp_env(1, 0, 350, 0.2, 350),
       harp_filter(900, 0.8, 1.6, fa=1, fd=250, fs=0.2, fr=200, sens=1.5),
       harp_trem(), harp_vib(),
       harp_delay(280, 2600, 0.35, 0.22),
       harp_transient(0.0),
       harp_out(500, 0.8, 1.0, 1.0, 0.7),
       harp_fx(0.3, spread=70, pattern=1),
       {36: 9},
       reverb_room(0.6, 0.3, 0.5, 0.4, 0.7), {29: 0.75},
       hover(118, 100, 8),
       knobs(chord_alt=(143, 70), harp_alt=(84, 100), mod=(119, 100), mod_alt=(262, 100)),
       double_tap((260, 100), (121, 0.6)))
