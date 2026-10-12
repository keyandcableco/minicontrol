#!/usr/bin/env python3
"""Builds the Gen 2 presets: the same as `python3 presets/build.py gen2` (see ../build.py)."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import build  # noqa: E402

if __name__ == "__main__":
    build.main("gen2")
