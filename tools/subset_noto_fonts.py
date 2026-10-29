#!/usr/bin/env python3
"""Regenerate the Noto Sans SC / Noto Serif SC UI subsets.

The shipped subsets keep the full variable ``wght`` axis and all OpenType
layout features, and cover:

* every codepoint already in the current subset (so text that is only
  supplied at runtime keeps its glyphs), plus
* every Han character found in ``frontend/src`` and ``frontend/index.html``
  (the same scope ``frontend/scripts/check-font-subset.mjs`` enforces).

Source fonts are the variable TTFs recorded as ``subsetSource`` in
``_src/ui/assets/fonts/manifest.json`` (google/fonts ``ofl/notosanssc`` and
``ofl/notoserifsc``). Download them first and pass the directory::

    pip install fonttools brotli
    python tools/subset_noto_fonts.py --source-dir /path/to/ttf

The script rewrites both ``.woff2`` files, the two Noto ``unicode-range``
lines in ``frontend/src/styles/fonts.css`` and the ``bytes`` / ``sha256`` /
``uiChineseCharacters`` fields of the manifest. Run
``npm --prefix frontend run check:fonts`` afterwards.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FONT_DIR = ROOT / "_src" / "ui" / "assets" / "fonts"
MANIFEST = FONT_DIR / "manifest.json"
FONTS_CSS = ROOT / "frontend" / "src" / "styles" / "fonts.css"
TARGETS = (
    ("Noto Serif SC", "noto-serif-sc-ui.woff2", "NotoSerifSC[wght].ttf"),
    ("Noto Sans SC", "noto-sans-sc-ui.woff2", "NotoSansSC[wght].ttf"),
)
PYFTSUBSET_OPTIONS = ["--flavor=woff2", "--layout-features=*", "--no-hinting", "--drop-tables+=BASE"]


def is_han(code: int) -> bool:
    return 0x3400 <= code <= 0x9FFF or 0xF900 <= code <= 0xFAFF or 0x20000 <= code <= 0x2FA1F


def source_han() -> set[int]:
    chars: set[int] = set()
    files = [p for p in (ROOT / "frontend" / "src").rglob("*") if p.is_file()]
    files.append(ROOT / "frontend" / "index.html")
    for path in files:
        chars.update(ord(ch) for ch in path.read_text(encoding="utf-8") if is_han(ord(ch)))
    return chars


def format_range(codes: set[int]) -> str:
    ordered = sorted(codes)
    parts: list[str] = []
    i = 0
    while i < len(ordered):
        j = i
        while j + 1 < len(ordered) and ordered[j + 1] == ordered[j] + 1:
            j += 1
        parts.append(f"U+{ordered[i]:x}" if i == j else f"U+{ordered[i]:x}-{ordered[j]:x}")
        i = j + 1
    return ", ".join(parts)


def find_source(source_dir: Path, name: str) -> Path:
    for candidate in (name, name.replace("[", "%5B").replace("]", "%5D")):
        if (source_dir / candidate).is_file():
            return source_dir / candidate
    raise SystemExit(f"Missing source font {name} in {source_dir}")


def main() -> int:
    from fontTools.ttLib import TTFont  # noqa: PLC0415 - optional dependency

    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source-dir", type=Path, required=True)
    args = parser.parse_args()

    wanted_han = source_han()
    css = FONTS_CSS.read_text(encoding="utf-8")
    manifest_raw = MANIFEST.read_bytes().decode("utf-8")
    newline = "\r\n" if "\r\n" in manifest_raw else "\n"
    manifest = json.loads(manifest_raw)
    han_counts: set[int] = set()
    for family, output, source_name in TARGETS:
        target = FONT_DIR / output
        codes = set(TTFont(target).getBestCmap()) | wanted_han
        source = find_source(args.source_dir, source_name)
        unicodes = ",".join(f"{code:04X}" for code in sorted(codes))
        subprocess.run(
            [sys.executable, "-m", "fontTools.subset", str(source), f"--unicodes={unicodes}",
             f"--output-file={target}", *PYFTSUBSET_OPTIONS],
            check=True,
        )
        covered = set(TTFont(target).getBestCmap())
        missing = codes - covered
        if missing:
            raise SystemExit(f"{family}: source font lacks {len(missing)} codepoint(s)")
        han_counts |= {code for code in covered if is_han(code)}
        pattern = re.compile(
            r"(font-family:\s*'" + re.escape(family) + r"'[\s\S]*?unicode-range:\s*)([^;]+)(;)"
        )
        css, replaced = pattern.subn(lambda m: m.group(1) + format_range(covered) + m.group(3), css, count=1)
        if replaced != 1:
            raise SystemExit(f"{family}: unicode-range not found in fonts.css")
        data = target.read_bytes()
        for entry in manifest["files"]:
            if entry["file"] == output:
                entry["bytes"] = len(data)
                entry["sha256"] = hashlib.sha256(data).hexdigest()
    manifest["uiChineseCharacters"] = len(han_counts)
    manifest["subsetCommand"] = "python tools/subset_noto_fonts.py --source-dir <dir with subsetSource TTFs>"
    manifest["subsetAt"] = datetime.now(timezone(timedelta(hours=8))).strftime("%a %Y-%m-%d %I:%M %p CST (UTC+08:00)")
    FONTS_CSS.write_text(css, encoding="utf-8")
    # _src/ui/** is -text in .gitattributes: keep the file's existing line endings.
    text = json.dumps(manifest, ensure_ascii=False, indent=2).replace("\n", newline) + newline
    MANIFEST.write_bytes(text.encode("utf-8"))
    print(f"Subsets regenerated: {len(han_counts)} Han characters.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
