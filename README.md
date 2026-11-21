# Rule in force — open agentic website

*Was this French law article in force on that date, and was its text published and
anchored before?*

Rule in force answers from the DILA's LEGI open data, fingerprinted every day by
[legi-ancrage](https://github.com/LeDenti/legi-ancrage) and anchored on the XRP Ledger
testnet. The proof is rebuilt **in the visitor's browser**: the Merkle path from the
article version's fingerprint to the day's root, then the root read live from the
anchoring transaction. Nothing has to be taken on trust from this site.

It follows the [Open Agentic Web MVP specification](https://github.com/cognizant-ai-labs/agentic-web/blob/main/docs/worldwide_agentic_web_mvp_spec.md):
public `agent-manifest.json`, data-only network `rule_in_force.network.json`, browser
runtime, bring-your-own-key inference, and reads shared with other agent sites through
its action bridge.

## How a proof works

1. Each article version's fingerprint:
   `SHA-256("legi-ancrage/v1\n" + LEGIARTI + "\n" + start date + "\n" + normalized text)`.
2. Each day's fingerprints are sorted and reduced to one Merkle root (pairs hashed with
   SHA-256, odd node promoted).
3. The root is written in the memo of a 1-drop testnet payment from
   `rD1WDd7X4dEjaTDJ1UXPyBzUpiSiZbTGrX`, memo type `legi/racine/<day>`.
4. The site publishes the day's fingerprints in blocks of 4,096 (`data/arbre/<day>/b<n>.bin`)
   and the block roots (`meta.json`). The browser downloads one block, rebuilds the whole
   path and compares it with the memo it reads on the ledger.

## Agents and actions

| Agent | Job |
|---|---|
| `clerk` (front) | Finds the article, says which version was in force, verifies the anchor |
| `proof_explainer` | Explains what an anchor proves and does not prove |

| Action | Effect | Shared with other sites |
|---|---|---|
| `get_page` | read | yes (`*`) |
| `look_up {code, number \| legiarti, date}` | read | yes (`*`) |
| `verify_anchor {legiarti, start, day}` | read | yes (`*`) |

Not legal advice. Data from the 8 November 2026 LEGI freeze onwards; versions in the
freeze were anchored on 12 November 2026, so for older versions the proof says
"published no later than" that date. Testnet only.

## Data

`site/data/` is built by `outils/construire_donnees.py` from legi-ancrage's leaf files
(it stops if a rebuilt root differs from the recorded one), plus article numbers read by
`outils/extraire_numeros.py`. Source data: DILA LEGI,
[Licence Ouverte / Open Licence 2.0](https://www.etalab.gouv.fr/licence-ouverte-open-licence/).
Code: MIT.

## Build and test

```shell
python3 -I outils/extraire_numeros.py
python3 -I outils/construire_donnees.py
cd site
node ../../cognizant-agentic-web/spec/skills/agentify-website/scripts/build_network.mjs rule_in_force.hocon --manifest agent-manifest.json --check
node --test "tests/*.test.mjs"          # LIVE=1 also reads the newest anchor on the testnet
```

## Nightly update

`outils/maj_quotidienne.sh` runs at the end of every legi-ancrage passage (every 30 min
and at 21:30, on the anchoring Mac). When a new day is anchored it reads the new
archive's article numbers, rebuilds `site/data` (stopping if a rebuilt root differs from
the anchored one), runs the offline tests and pushes; Render redeploys the static site.
Data updates are folded into one `data:` commit (amend + force-with-lease) so the
repository does not grow every night. Log: `journal/maj.log` (not in git).

Signed matter-x-.
