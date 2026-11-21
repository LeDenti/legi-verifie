#!/bin/zsh
# maj_quotidienne.sh — publishes Rule in force's data for every day legi-ancrage has
# anchored since the last publication. Called at the end of each legi-ancrage passage
# (every 30 min and at 21:30); does nothing when the site is up to date.
#
# Steps: read the new archives' article numbers, rebuild site/data (the build stops if
# a rebuilt root differs from the anchored one), run the offline tests, then push.
# Data commits are folded into one "data:" commit (amend + force-with-lease) so the
# public repository does not grow by ~30 MB every night. Render redeploys on push.
set -u
export PATH=/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
D=${0:A:h:h}
J=$D/journal
LOG=$J/maj.log
SRC=$HOME/Desktop/code-bonobo/legi-ancrage
mkdir -p "$J"
log() { print -r -- "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG" }

LOCK=$J/.verrou
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +120 2>/dev/null)" ]; then
    rmdir "$LOCK" 2>/dev/null; mkdir "$LOCK" 2>/dev/null || exit 0
  else
    exit 0
  fi
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT
date '+%Y-%m-%d %H:%M:%S' > "$J/dernier_passage"

# Last anchored day in legi-ancrage, last published day on the site.
ancre=$(/usr/bin/python3 -I -c "import json,sys; print(max(json.loads(l)['jour'] for l in open(sys.argv[1]) if l.strip()))" "$SRC/ancrages.jsonl" 2>/dev/null)
publie=$(/usr/bin/python3 -I -c "import json,sys; print(max(d['jour'] for d in json.load(open(sys.argv[1]))))" "$D/site/data/jours.json" 2>/dev/null)
[ -n "$ancre" ] || { log "ERROR: cannot read $SRC/ancrages.jsonl (Desktop access?)"; exit 1 }
push_pending() {  # a commit that did not reach GitHub last time
  local n=$(git -C "$D" rev-list --count origin/main..HEAD 2>/dev/null || echo 0)
  [ "$n" -gt 0 ] || return 0
  if git -C "$D" log -1 --format=%s | grep -q '^data: '; then
    git -C "$D" push -q --force-with-lease origin main >> "$LOG" 2>&1
  else
    git -C "$D" push -q origin main >> "$LOG" 2>&1
  fi && log "pushed pending commit $(git -C "$D" rev-parse --short HEAD)" || log "ERROR: pending push failed"
}
if ! [[ "$ancre" > "$publie" ]]; then
  push_pending
  exit 0
fi

log "new anchored day(s): published $publie, anchored $ancre"
/usr/bin/python3 -I "$D/outils/extraire_numeros.py" >> "$LOG" 2>&1 || { log "ERROR: extraire_numeros.py"; exit 1 }
/usr/bin/python3 -I "$D/outils/construire_donnees.py" >> "$LOG" 2>&1 || { log "ERROR: construire_donnees.py (root mismatch?), nothing published"; git -C "$D" checkout -- site/data 2>/dev/null; exit 1 }
(cd "$D/site" && node --test "tests/*.test.mjs" >> "$LOG" 2>&1) || { log "ERROR: tests failed, nothing published"; git -C "$D" checkout -- site/data 2>/dev/null; git -C "$D" clean -fdq site/data 2>/dev/null; exit 1 }

cd "$D" || exit 1
git add -A site/data
if git diff --cached --quiet; then
  log "no data change after rebuild"
  exit 0
fi
msg="data: LEGI anchored days through $ancre"
if git log -1 --format=%s | grep -q '^data: '; then
  git -c user.name=matter-x- -c user.email=140921037+LeDenti@users.noreply.github.com commit -q --amend -m "$msg" >> "$LOG" 2>&1
  git push -q --force-with-lease origin main >> "$LOG" 2>&1 || { log "ERROR: push (amend) failed, will retry next passage"; exit 1 }
else
  git -c user.name=matter-x- -c user.email=140921037+LeDenti@users.noreply.github.com commit -q -m "$msg" >> "$LOG" 2>&1
  git push -q origin main >> "$LOG" 2>&1 || { log "ERROR: push failed, will retry next passage"; exit 1 }
fi
git reflog expire --expire=now --all 2>/dev/null; git gc -q --prune=now 2>/dev/null
log "published $msg ($(git rev-parse --short HEAD))"
exit 0
