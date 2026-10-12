# Shared bank sets

Sets of twelve minichord presets that players have shared. Every set here is listed in minicontrol under **bank sets**, where anyone can take all twelve or mix them with presets from other sets.

## Sharing yours

1. In minicontrol, open **bank sets**, put the presets you want in **your 12**, and press **save as a set file**. Give it a name, your name and a line on what it's for.
2. Upload that file here: **Add file → Upload files** on this folder. GitHub makes you a copy of the project and opens a pull request with your file in it.
3. Once it's merged, the set appears in minicontrol for everyone.

A set file is a minichord backup (the same file **back up all banks** makes), with three more things at the top: `title`, `author` and `description`, and an optional `blurb` for each bank. A backup made by **back up all banks** can be shared too: add a `title` to it first, or it is listed by its file name.

Settings that belong to one minichord rather than to a sound (MIDI routing, master tuning, LED brightness, the harp plate's thresholds, USB audio) can be left out as `null`, and are then kept as each player's minichord has them.

## For maintainers

`generate_banksets.py`, at the top of the project, lists the sets in `banksets.json`. The deploy runs it, so a merged set appears on the next deploy. A file that isn't a sound backup (wrong format, bank numbers that don't make sense, values out of range) is reported and left out rather than listed.
