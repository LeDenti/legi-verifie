#!/usr/bin/env python3
"""Reads every new LEGI archive of legi-ancrage in streaming mode and writes, for each
article version, LEGIARTI, start date and article number (NUM), which the leaf files
do not carry. Output: build/numeros.tsv. Uses legi-ancrage's own parser."""
import os, sys, tarfile, time
SRC = os.path.expanduser("~/Desktop/code-bonobo/legi-ancrage")
sys.path.insert(0, SRC)
from empreintes import lire_article  # noqa: E402

BUILD = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "build")
FAITES = os.path.join(BUILD, "numeros.archives")
# Incremental: archives already read are listed in build/numeros.archives.
faites = set(open(FAITES).read().split()) if os.path.exists(FAITES) else set()
out = open(os.path.join(BUILD, "numeros.tsv"), "a")
archives = sorted(f for f in os.listdir(os.path.join(SRC, "donnees")) if f.endswith(".tar.gz") and f not in faites)
t0 = time.time(); n = 0
for a in archives:
    with tarfile.open(os.path.join(SRC, "donnees", a), mode="r|gz") as tar:
        for m in tar:
            if not m.isfile() or "/article/" not in m.name or not m.name.endswith(".xml"):
                continue
            art = lire_article(tar.extractfile(m).read())
            if not art:
                continue
            num = (art.get("num") or "").replace("\t", " ").replace("\n", " ").strip()
            out.write(f"{art['id']}\t{art['debut']}\t{num}\n")
            n += 1
    out.flush()
    with open(FAITES, "a") as f:
        f.write(a + "\n")
    print(f"{a}: {n} versions, {time.time()-t0:.0f} s", flush=True)
out.close()
