#!/usr/bin/env python3
"""Inject duplicate-META-INF excludes into Expo's packagingOptions block.

A sibling packaging { } block is ignored by the generated app/build.gradle.
The needle must land inside the existing packagingOptions block or
mergeDebugJavaResource fails on OSGI-INF/MANIFEST.MF.
"""
from pathlib import Path
import sys

p = Path("android/app/build.gradle")
if not p.exists():
    sys.exit(f"missing {p}")

src = p.read_text()
needle = "META-INF/versions/9/OSGI-INF/MANIFEST.MF"
token = "packagingOptions {"
idx = src.find(token)
if idx < 0:
    sys.exit("no packagingOptions block in build.gradle")

if needle not in src:
    snippet = (
        "\n        pickFirsts += [\n"
        "            \"META-INF/versions/9/OSGI-INF/MANIFEST.MF\",\n"
        "            \"META-INF/DEPENDENCIES\",\n"
        "            \"META-INF/LICENSE\",\n"
        "            \"META-INF/LICENSE.txt\",\n"
        "            \"META-INF/NOTICE\",\n"
        "            \"META-INF/NOTICE.txt\"\n"
        "        ]\n"
        "        excludes += [\"META-INF/versions/9/OSGI-INF/MANIFEST.MF\"]\n"
    )
    src = src[: idx + len(token)] + snippet + src[idx + len(token) :]
    p.write_text(src)
    print("inserted packaging excludes")
else:
    print("packaging already patched")

text = p.read_text()
if needle not in text:
    sys.exit("patch failed: needle missing after write")

print("--- packaging region ---")
for i, line in enumerate(text.splitlines(), 1):
    if any(s in line for s in ("packaging", "MANIFEST.MF", "excludes", "pickFirst")):
        print(f"{i}:{line}")
