"""Reference for minicontrol's flash.js: which 1 KB blocks a Teensy 4.0 hex sends, and what they hold.

    python3 -I plan.py firmware.hex > fixture.json

Parses the Intel HEX on its own (bytes.fromhex, a dict of address to byte), with none of flash.js's
code, and prints JSON: the hex file's sha256, the lowest and one-past-highest data address, the
BootData length at 0x60001024, the planned block offsets (as runs of consecutive blocks) and the
sha256 of every planned 1088-byte HalfKay report laid end to end.

The plan: block 0 first, then every block holding at least one hex byte, ascending. A report is
the block's offset in bytes 0-2 (little-endian), zeros to byte 63, then the block's 1024 bytes
with 0xFF where the hex has none.
"""
import hashlib
import json
import sys

FLASH_BASE = 0x60000000
BLOCK = 1024
HEADER = 64


def read_hex(path):
    raw = open(path, "rb").read()
    mem = {}
    upper = 0
    ended = False
    for number, line in enumerate(raw.decode("ascii").splitlines(), 1):
        if not line:
            continue
        if ended:
            raise SystemExit(f"line {number}: data after the EOF record")
        if not line.startswith(":"):
            raise SystemExit(f"line {number}: no colon")
        record = bytes.fromhex(line[1:])
        count, high, low, kind = record[0], record[1], record[2], record[3]
        if len(record) != count + 5:
            raise SystemExit(f"line {number}: length")
        if sum(record) % 256:
            raise SystemExit(f"line {number}: checksum")
        payload = record[4:4 + count]
        if kind == 0:
            at = upper + (high << 8 | low)
            for i, value in enumerate(payload):
                mem[at + i] = value
        elif kind == 1:
            ended = True
        elif kind == 4:
            upper = int.from_bytes(payload, "big") << 16
        elif kind == 5:
            pass
        else:
            raise SystemExit(f"line {number}: record type {kind}")
    if not ended:
        raise SystemExit("no EOF record")
    return raw, mem


def main(path):
    raw, mem = read_hex(path)
    blocks = sorted({(address - FLASH_BASE) // BLOCK for address in mem} | {0})
    digest = hashlib.sha256()
    for block in blocks:
        offset = block * BLOCK
        report = bytearray(HEADER + BLOCK)
        report[0:3] = offset.to_bytes(3, "little")
        for i in range(BLOCK):
            report[HEADER + i] = mem.get(FLASH_BASE + offset + i, 0xFF)
        digest.update(report)
    runs = []
    for block in blocks:
        if runs and runs[-1][1] == block * BLOCK:
            runs[-1][1] += BLOCK
        else:
            runs.append([block * BLOCK, block * BLOCK + BLOCK])
    boot_length = int.from_bytes(bytes(mem.get(0x60001024 + i, 0xFF) for i in range(4)), "little")
    print(json.dumps({
        "hexSha256": hashlib.sha256(raw).hexdigest(),
        "start": min(mem),
        "end": max(mem) + 1,
        "bytes": len(mem),
        "bootLength": boot_length,
        "blocks": len(blocks),
        "runs": runs,
        "reportsSha256": digest.hexdigest(),
    }, indent=1))


main(sys.argv[1])
