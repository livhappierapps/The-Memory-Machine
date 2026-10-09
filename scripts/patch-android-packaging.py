#!/usr/bin/env python3
"""Inject duplicate-META-INF excludes and debug-sign the release build.

A sibling packaging { } block is ignored by the generated app/build.gradle.
The needle must land inside the existing packagingOptions block or
mergeReleaseJavaResource fails on OSGI-INF/MANIFEST.MF.

Release must use the debug keystore. There is no upload keystore in CI,
and an unsigned release APK will not install over the sideloaded debug one.
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
    print("inserted packaging excludes")
else:
    print("packaging already patched")

marker = "release {"
rel = src.find(marker)
if rel < 0:
    sys.exit("no release block in build.gradle")
window_end = src.find("\n    }", rel)
window = src[rel:window_end if window_end > rel else rel + 600]
if "signingConfigs.debug" in window:
    print("release already debug-signed")
else:
    src = src[:rel] + "release {\n            signingConfig signingConfigs.debug" + src[rel + len(marker):]
    print("forced release signingConfig debug")

p.write_text(src)
text = p.read_text()
if needle not in text:
    sys.exit("patch failed: needle missing after write")
if "signingConfig signingConfigs.debug" not in text:
    sys.exit("patch failed: debug signing missing after write")

print("--- packaging and signing region ---")
for i, line in enumerate(text.splitlines(), 1):
    if any(s in line for s in ("packaging", "MANIFEST.MF", "excludes", "pickFirst", "signingConfig", "release {")):
        print(f"{i}:{line}")
