#!/usr/bin/env python3
"""Builds the static data of the Rule in force site from legi-ancrage's leaf files.

For each anchored day:
  site/data/arbre/<day>/b<n>.bin   the day's leaves, 4,096 per block, raw 32-byte hashes
  site/data/arbre/<day>/meta.json  leaf count, block roots, root, anchoring transaction
For lookups:
  site/data/art/<sss>.tsv.gz       every version, sharded by the last 3 digits of LEGIARTI
  site/data/code/<LEGITEXT>.tsv.gz every version of one code, by article number
  site/data/codes.json             the codes (texts whose title starts with "Code")
  site/data/jours.json             the anchored days

Every block root list is checked: the root rebuilt from the blocks must equal the root
recorded in racines.jsonl, or the build stops.
"""
import gzip
import hashlib
import json
import os
import re
import sys
from collections import defaultdict

SRC = os.path.expanduser("~/Desktop/code-bonobo/legi-ancrage")
ICI = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ICI, "..", "site", "data")
NUMS = os.path.join(ICI, "..", "build", "numeros.tsv")
BLOC = 4096
RE_TEXTE = re.compile(r"(LEGITEXT\d{12})")


def niveau_suivant(niveau):
    """One Merkle level up: pairs hashed, odd node promoted (same rule as empreintes.py)."""
    suivant = [hashlib.sha256(niveau[i] + niveau[i + 1]).digest() for i in range(0, len(niveau) - 1, 2)]
    if len(niveau) % 2 == 1:
        suivant.append(niveau[-1])
    return suivant


def racine(feuilles):
    niveau = feuilles
    while len(niveau) > 1:
        niveau = niveau_suivant(niveau)
    return niveau[0]


def lire_jsonl(chemin):
    with open(chemin, encoding="utf-8") as f:
        return [json.loads(l) for l in f if l.strip()]


def main():
    os.makedirs(OUT, exist_ok=True)
    racines = {r["jour"]: r for r in lire_jsonl(os.path.join(SRC, "racines.jsonl"))}
    ancrages = {a["jour"]: a for a in lire_jsonl(os.path.join(SRC, "ancrages.jsonl"))}
    jours = sorted(j for j in racines if j in ancrages)
    print("jours ancrés :", jours, flush=True)

    numeros = {}
    with open(NUMS, encoding="utf-8") as f:
        for ligne in f:
            ident, debut, num = (ligne.rstrip("\n").split("\t") + ["", "", ""])[:3]
            if num:
                numeros[(ident, debut)] = num
    print(f"{len(numeros)} numéros d'articles", flush=True)

    shards = defaultdict(list)
    par_code = defaultdict(list)
    codes = {}
    liste_jours = []
    for jour in jours:
        feuilles = []
        lignes = []
        with open(os.path.join(SRC, "feuilles", f"{jour}.tsv"), encoding="utf-8") as f:
            for ligne in f:
                if ligne.startswith("#"):
                    continue
                c = ligne.rstrip("\n").split("\t")
                feuilles.append(bytes.fromhex(c[0]))
                lignes.append(c)
        assert feuilles == sorted(feuilles), f"{jour}: leaves not sorted"
        dossier = os.path.join(OUT, "arbre", jour)
        os.makedirs(dossier, exist_ok=True)
        racines_blocs = []
        for b in range(0, len(feuilles), BLOC):
            bloc = feuilles[b:b + BLOC]
            with open(os.path.join(dossier, f"b{b // BLOC}.bin"), "wb") as w:
                w.write(b"".join(bloc))
            racines_blocs.append(racine(bloc))
        r = racine(racines_blocs).hex()
        attendu = racines[jour]["racine"]
        if r != attendu or len(feuilles) != racines[jour]["feuilles"]:
            sys.exit(f"{jour}: rebuilt root {r} != recorded {attendu}")
        a = ancrages[jour]
        meta = {
            "jour": jour, "feuilles": len(feuilles), "bloc": BLOC,
            "racinesBlocs": [x.hex() for x in racines_blocs], "racine": r,
            "tx": a["tx"], "ledger": a["ledger_index"], "compte": a["compte"],
            "memoType": a["memo_type"], "clos": a["date_ledger"], "reseau": a["reseau"],
        }
        with open(os.path.join(dossier, "meta.json"), "w") as w:
            json.dump(meta, w, separators=(",", ":"))
        liste_jours.append({k: meta[k] for k in ("jour", "feuilles", "racine", "tx", "ledger", "clos")})
        print(f"{jour}: {len(feuilles)} leaves, {len(racines_blocs)} blocks, root OK", flush=True)

        for i, c in enumerate(lignes):
            _, ident, debut, fin, etat, _, chemin, titre = c[:8]
            m = RE_TEXTE.search(chemin)
            texte = m.group(1) if m else ""
            num = numeros.get((ident, debut), "")
            rang = f"{ident}\t{debut}\t{fin}\t{etat}\t{jour}\t{i}\t{texte}\t{num}"
            shards[ident[-3:]].append(rang)
            if texte and titre.startswith("Code"):
                par_code[texte].append(rang)
                codes.setdefault(texte, {"id": texte, "titre": titre, "versions": 0})
                codes[texte]["versions"] += 1

    os.makedirs(os.path.join(OUT, "art"), exist_ok=True)
    for k, rows in shards.items():
        with gzip.open(os.path.join(OUT, "art", f"{k}.tsv.gz"), "wt", encoding="utf-8", compresslevel=9) as w:
            w.write("\n".join(sorted(rows)) + "\n")
    os.makedirs(os.path.join(OUT, "code"), exist_ok=True)
    for t, rows in par_code.items():
        with gzip.open(os.path.join(OUT, "code", f"{t}.tsv.gz"), "wt", encoding="utf-8", compresslevel=9) as w:
            w.write("\n".join(sorted(rows, key=lambda r: (r.split("\t")[7], r.split("\t")[1]))) + "\n")
    with open(os.path.join(OUT, "codes.json"), "w") as w:
        json.dump(sorted(codes.values(), key=lambda c: c["titre"]), w, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(OUT, "jours.json"), "w") as w:
        json.dump(liste_jours, w, separators=(",", ":"))
    print(f"{sum(len(v) for v in shards.values())} rows, {len(shards)} shards, {len(codes)} codes", flush=True)


if __name__ == "__main__":
    main()
