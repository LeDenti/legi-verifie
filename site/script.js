// Rule in force: the page script. It finds a French law article version in the LEGI
// data anchored by legi-ancrage, says whether it was in force on a date, and verifies
// its anchoring in the browser: Merkle path from the leaf to the day's root, then the
// root read live from the XRPL testnet anchoring transaction.
// The page's own form and the assistant (site-actions.js) call the same App.page methods.

export const NODE = "wss://s.altnet.rippletest.net:51233";
export const EXPLORER = "https://testnet.xrpl.org/transactions/";
export const ANCHOR_ACCOUNT = "rD1WDd7X4dEjaTDJ1UXPyBzUpiSiZbTGrX";
const OPEN_END = "2999-01-01";

export const METHOD = {
  leaf: "Each article version is fingerprinted: SHA-256 of 'legi-ancrage/v1', its LEGIARTI id, its start date and its normalized text (DILA LEGI open data).",
  tree: "Each day's fingerprints are sorted and reduced to one Merkle root (pairs hashed with SHA-256, odd node promoted).",
  anchor: "Each root is written once on the XRPL testnet, in the memo of a 1-drop payment from the anchoring account rD1WDd7X4dEjaTDJ1UXPyBzUpiSiZbTGrX.",
  proof: "Verifying a version means rebuilding the path from its fingerprint to the day's root in this browser, then reading the anchoring transaction live and comparing the memo with that root.",
  meaning: "A valid proof shows this exact text was delivered by the DILA and anchored no later than the transaction's close time. Article 8 of the bonobo code: a rule not anchored before an act does not apply to that act.",
};

export const NOT_SUPPORTED = [
  "It is not legal advice and does not interpret the law.",
  "It covers DILA LEGI data delivered from the 8 November 2026 freeze onwards; versions in the freeze were anchored on 12 November 2026, so their proof only says 'published no later than' that date.",
  "It does not show the full article text; the official text is on legifrance.gouv.fr.",
  "Anchors are on the XRPL testnet only.",
  "It cannot say which version a court will apply.",
];

/**
 * Hex helpers and SHA-256 through Web Crypto (browser and Node).
 */
export const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
export const unhex = (h) => Uint8Array.from(h.match(/../g).map((x) => parseInt(x, 16)));
export async function sha256(bytes) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}
async function pair(a, b) {
  const c = new Uint8Array(64);
  c.set(a, 0);
  c.set(b, 32);
  return sha256(c);
}

/**
 * The Merkle path of nodes[index], with the same rule as legi-ancrage (pairs hashed,
 * odd node promoted). Each step is {side: "L"|"R", hash} for the sibling, or null when
 * the node was promoted.
 *
 * :return: {root, path}.
 */
export async function merklePath(nodes, index) {
  const path = [];
  let level = nodes;
  let k = index;
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i + 1 < level.length; i += 2) {
      next.push(await pair(level[i], level[i + 1]));
    }
    if (level.length % 2 === 1) next.push(level[level.length - 1]);
    if (k % 2 === 1) path.push({ side: "L", hash: hex(level[k - 1]) });
    else if (k + 1 < level.length) path.push({ side: "R", hash: hex(level[k + 1]) });
    else path.push(null);
    level = next;
    k = Math.floor(k / 2);
  }
  return { root: level[0], path };
}

/**
 * Fold a path from a leaf: the root it leads to.
 */
export async function foldPath(leaf, path) {
  let h = leaf;
  for (const step of path) {
    if (!step) continue;
    h = step.side === "L" ? await pair(unhex(step.hash), h) : await pair(h, unhex(step.hash));
  }
  return h;
}

/**
 * The fingerprint of a version from its text, with legi-ancrage's normalization
 * (NFC, runs of whitespace to one space, trimmed). Pasted text has no tags.
 */
export async function leafOf(legiarti, start, text) {
  const norm = text.normalize("NFC").replace(/\s+/g, " ").trim();
  return sha256(new TextEncoder().encode(`legi-ancrage/v1\n${legiarti}\n${start}\n${norm}`));
}

/**
 * Normalize a code name for matching: lower case, no accents, single spaces.
 */
export function fold(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function parseRows(text) {
  return text.split("\n").filter(Boolean).map((l) => {
    const [legiarti, start, end, state, day, index, textId, number] = l.split("\t");
    return { legiarti, start, end: end || OPEN_END, state, day, index: Number(index), textId, number };
  });
}

/**
 * One version's in-force test on a date (start inclusive, end exclusive).
 */
export function inForceOn(v, date) {
  return v.start <= date && date < v.end;
}

/**
 * The page: its form, its result panel, and the reads the form and the assistant share.
 */
export class Page {
  /**
   * :param doc: The document, or null outside a browser.
   * :param fetcher: fetch(url) -> Response, relative to the site.
   * :param ledger: {tx(hash)} reading an XRPL transaction.
   */
  constructor(doc, fetcher, ledger) {
    this.doc = doc;
    this.fetcher = fetcher;
    this.ledger = ledger;
    this.cache = new Map();
    this.shown = null;
    this.version = 0;
  }

  async json(path) {
    if (!this.cache.has(path)) {
      this.cache.set(path, (async () => {
        const r = await this.fetcher(path);
        if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
        return r.json();
      })());
    }
    return this.cache.get(path);
  }

  async gzRows(path) {
    if (!this.cache.has(path)) {
      this.cache.set(path, (async () => {
        const r = await this.fetcher(path);
        if (r.status === 404) return [];
        if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
        const stream = r.body.pipeThrough(new DecompressionStream("gzip"));
        return parseRows(await new Response(stream).text());
      })());
    }
    return this.cache.get(path);
  }

  async bytes(path) {
    const r = await this.fetcher(path);
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  }

  /**
   * Find the code whose name matches, or the candidates.
   *
   * :return: {code} or {candidates}.
   */
  async findCode(name) {
    const codes = await this.json("data/codes.json");
    const q = fold(name);
    const exact = codes.filter((c) => fold(c.titre) === q || c.id === name.trim());
    if (exact.length === 1) return { code: exact[0] };
    const words = q.split(" ").filter((w) => w.length > 2 && w !== "code");
    const loose = codes.filter((c) => words.every((w) => fold(c.titre).includes(w)));
    if (loose.length === 1) return { code: loose[0] };
    return { candidates: (exact.length ? exact : loose).slice(0, 12).map((c) => c.titre) };
  }

  /**
   * Look up an article: by code name and article number, or by LEGIARTI id. With a date,
   * also say which version was in force that day.
   *
   * :return: {ok, code, number, versions, inForce} or {ok: false, reason, candidates}.
   */
  async lookUp({ code, number, legiarti, date } = {}) {
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return { ok: false, field: "date", reason: "The date must be written YYYY-MM-DD." };
    }
    let versions;
    let codeInfo = null;
    if (legiarti) {
      if (!/^LEGIARTI\d{12}$/.test(legiarti)) {
        return { ok: false, field: "legiarti", reason: "A LEGIARTI id is LEGIARTI followed by 12 digits." };
      }
      versions = (await this.gzRows(`data/art/${legiarti.slice(-3)}.tsv.gz`)).filter((v) => v.legiarti === legiarti);
    } else {
      if (!code || !number) {
        return { ok: false, reason: "Give a code name and an article number, or a LEGIARTI id." };
      }
      const found = await this.findCode(code);
      if (!found.code) {
        return { ok: false, field: "code", reason: found.candidates.length ? "Several codes match; name one exactly." : "No code with that name in the data.", candidates: found.candidates };
      }
      codeInfo = found.code;
      const n = fold(String(number)).replace(/ /g, "-");
      versions = (await this.gzRows(`data/code/${codeInfo.id}.tsv.gz`)).filter((v) => fold(v.number).replace(/ /g, "-") === n);
    }
    if (!versions.length) {
      return { ok: false, reason: "No version of that article in the anchored data." };
    }
    // One row per (version, day): a version re-delivered later appears once per day.
    const byVersion = new Map();
    for (const v of versions) {
      const key = `${v.legiarti}|${v.start}`;
      if (!byVersion.has(key)) byVersion.set(key, { ...v, anchors: [] });
      byVersion.get(key).anchors.push({ day: v.day, index: v.index });
    }
    const list = [...byVersion.values()].sort((a, b) => a.start.localeCompare(b.start)).map((v) => {
      v.anchors.sort((a, b) => a.day.localeCompare(b.day));
      return { legiarti: v.legiarti, number: v.number, textId: v.textId, start: v.start, end: v.end === OPEN_END ? null : v.end, state: v.state, firstAnchoredDay: v.anchors[0].day, anchors: v.anchors };
    });
    const inForce = date ? list.filter((v) => inForceOn({ ...v, end: v.end || OPEN_END }, date)) : null;
    return {
      ok: true,
      code: codeInfo ? codeInfo.titre : null,
      number: list[0].number || null,
      versions: list.slice(-12),
      versionCount: list.length,
      date: date || null,
      inForce,
      legifrance: `https://www.legifrance.gouv.fr/codes/article_lc/${list[list.length - 1].legiarti}`,
    };
  }

  /**
   * Verify one version's anchoring: Merkle path in this browser, root read on XRPL.
   *
   * :return: {ok, valid, steps, ...} or {ok: false, reason}.
   */
  async verify({ legiarti, start, day }) {
    const found = await this.lookUp({ legiarti });
    if (!found.ok) return found;
    const all = (await this.gzRows(`data/art/${legiarti.slice(-3)}.tsv.gz`)).filter((v) => v.legiarti === legiarti && v.start === start);
    if (!all.length) return { ok: false, reason: `No version of ${legiarti} starting ${start}.` };
    const row = day ? all.find((v) => v.day === day) : all.sort((a, b) => a.day.localeCompare(b.day))[0];
    if (!row) return { ok: false, reason: `That version was not delivered on ${day}.` };
    const meta = await this.json(`data/arbre/${row.day}/meta.json`);
    const b = Math.floor(row.index / meta.bloc);
    const block = await this.bytes(`data/arbre/${row.day}/b${b}.bin`);
    const leaves = [];
    for (let i = 0; i < block.length; i += 32) leaves.push(block.slice(i, i + 32));
    const leaf = leaves[row.index % meta.bloc];
    const inner = await merklePath(leaves, row.index % meta.bloc);
    if (hex(inner.root) !== meta.racinesBlocs[b]) {
      return { ok: true, valid: false, reason: "The block does not match its published block root." };
    }
    const outer = await merklePath(meta.racinesBlocs.map(unhex), b);
    const path = [...inner.path, ...outer.path];
    const rebuilt = hex(await foldPath(leaf, path));
    let onLedger;
    try {
      onLedger = await this.ledger.tx(meta.tx);
    } catch (error) {
      return { ok: false, reason: `Could not read the anchoring transaction: ${error.message}` };
    }
    const checks = {
      pathLeadsToRoot: rebuilt === meta.racine,
      transactionValidated: onLedger.validated === true && onLedger.result === "tesSUCCESS",
      sentByAnchorAccount: onLedger.account === ANCHOR_ACCOUNT,
      memoTypeMatchesDay: onLedger.memoType === `legi/racine/${row.day}`,
      memoDataEqualsRoot: (onLedger.memoData || "").toLowerCase() === rebuilt,
    };
    const valid = Object.values(checks).every(Boolean);
    return {
      ok: true,
      valid,
      legiarti,
      start,
      day: row.day,
      leaf: hex(leaf),
      leafIndex: row.index,
      leavesThatDay: meta.feuilles,
      pathLength: path.filter(Boolean).length,
      root: rebuilt,
      transaction: meta.tx,
      ledger: onLedger.ledger,
      closeTime: onLedger.closeTime,
      link: EXPLORER + meta.tx,
      checks,
    };
  }

  /**
   * Check pasted text against a version's fingerprint.
   */
  async checkText({ legiarti, start, text }) {
    const v = await this.verify({ legiarti, start });
    if (!v.ok) return v;
    const leaf = hex(await leafOf(legiarti, start, text));
    return { ok: true, matches: leaf === v.leaf, computed: leaf, anchored: v.leaf, note: "Text copied from a web page can differ from the DILA XML (spacing, footnotes): a mismatch is not proof of tampering." };
  }

  el(id) {
    return this.doc.getElementById(id);
  }

  /**
   * What the page states and shows, as plain JSON.
   */
  async getState() {
    const days = await this.json("data/jours.json");
    const codes = await this.json("data/codes.json");
    const now = new Date();
    return {
      page: "Rule in force",
      purpose: "Was this French law article in force on that date, and was its text published and anchored before?",
      today: { date: now.toISOString().slice(0, 10) },
      method: { ...METHOD },
      notSupported: [...NOT_SUPPORTED],
      anchoredDays: days.map((d) => ({ day: d.day ?? d.jour, leaves: d.feuilles, transaction: d.tx, closed: d.clos })),
      codeCount: codes.length,
      exampleQueries: ["Code civil, article 1240, on 2026-11-15", "Code du travail, article L1121-1"],
      shown: this.shown,
      version: this.version,
    };
  }

  /**
   * The page's own form: look up, then verify the version in force (or the latest).
   */
  async show({ code, number, date }) {
    const st = this.el("st");
    st.className = "status";
    st.textContent = "Looking up…";
    this.el("go").disabled = true;
    try {
      const found = await this.lookUp({ code, number, date: date || undefined });
      if (!found.ok) {
        st.className = "status err";
        st.textContent = found.reason + (found.candidates?.length ? " " + found.candidates.join(" · ") : "");
        this.shown = null;
        this.version++;
        this.el("res").hidden = true;
        return found;
      }
      const target = (found.inForce && found.inForce[0]) || found.versions[found.versions.length - 1];
      st.textContent = "Verifying the anchor on the XRPL testnet…";
      const proof = await this.verify({ legiarti: target.legiarti, start: target.start });
      this.shown = { found, proof };
      this.version++;
      this.render(found, target, proof);
      st.textContent = "";
      return { ...found, proof };
    } catch (error) {
      st.className = "status err";
      st.textContent = error.message;
      return { ok: false, reason: error.message };
    } finally {
      this.el("go").disabled = false;
    }
  }

  render(found, target, proof) {
    const d = this.doc;
    this.el("res").hidden = false;
    this.el("who").textContent = `${found.code || ""} — article ${found.number || target.legiarti}`;
    const verdict = this.el("verdict");
    if (found.date) {
      verdict.textContent = found.inForce.length ? `In force on ${found.date}` : `Not in force on ${found.date}`;
      verdict.className = "verdict " + (found.inForce.length ? "ok" : "bad");
    } else {
      verdict.textContent = "Latest anchored version";
      verdict.className = "verdict";
    }
    const body = this.el("versions");
    body.replaceChildren();
    for (const v of found.versions) {
      const tr = d.createElement("tr");
      for (const t of [v.start, v.end || "open", v.state || "—", v.firstAnchoredDay, v.legiarti]) {
        const td = d.createElement("td");
        td.textContent = t;
        tr.appendChild(td);
      }
      if (v.legiarti === target.legiarti && v.start === target.start) tr.className = "target";
      body.appendChild(tr);
    }
    const p = this.el("proof");
    if (!proof.ok) {
      p.textContent = proof.reason;
      p.className = "proof bad";
      return;
    }
    p.className = "proof " + (proof.valid ? "ok" : "bad");
    p.replaceChildren();
    const h = d.createElement("b");
    h.textContent = proof.valid ? "Anchor verified in your browser" : "Anchor NOT verified";
    const s = d.createElement("p");
    s.textContent = `Version ${proof.legiarti} (start ${proof.start}) is leaf ${proof.leafIndex + 1} of ${proof.leavesThatDay} on ${proof.day}; ${proof.pathLength} hashes lead to root ${proof.root.slice(0, 16)}…, which the testnet transaction memo states (ledger ${proof.ledger}, closed ${proof.closeTime}).`;
    const a = d.createElement("a");
    a.href = proof.link;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = "Open the anchoring transaction";
    p.append(h, s, a);
  }
}

/**
 * Reads XRPL testnet transactions over WebSocket.
 */
export class Ledger {
  constructor(url = NODE) {
    this.url = url;
  }

  async tx(hash) {
    const socket = new WebSocket(this.url);
    try {
      await new Promise((ok, ko) => { socket.onopen = ok; socket.onerror = () => ko(new Error("XRPL node did not answer")); setTimeout(() => ko(new Error("XRPL node timeout")), 20000); });
      const reply = await new Promise((ok, ko) => {
        socket.onmessage = (e) => ok(JSON.parse(e.data));
        socket.send(JSON.stringify({ id: 1, command: "tx", transaction: hash }));
        setTimeout(() => ko(new Error("XRPL node timeout")), 20000);
      });
      if (reply.status !== "success") throw new Error(reply.error_message || reply.error || "tx not found");
      const r = reply.result;
      const tx = r.tx_json || r;
      const memo = (tx.Memos || [])[0]?.Memo || {};
      const fromHex = (h) => (h ? new TextDecoder().decode(unhex(h)) : "");
      return {
        validated: r.validated,
        result: (r.meta || {}).TransactionResult,
        account: tx.Account,
        memoType: fromHex(memo.MemoType),
        // The memo carries the 32-byte root itself: compare its hex form.
        memoData: (memo.MemoData || "").toLowerCase(),
        ledger: r.ledger_index,
        closeTime: r.close_time_iso || (typeof (tx.date ?? r.date) === "number" ? new Date(((tx.date ?? r.date) + 946684800) * 1000).toISOString().replace(".000Z", "Z") : null),
      };
    } finally {
      try { socket.close(); } catch (e) { /* closed */ }
    }
  }
}

/**
 * Holds the one page object the form, site.js and site-actions.js share.
 */
export class App {
  static page = new Page(globalThis.document || null, (path) => fetch(new URL(path, import.meta.url)), new Ledger());

  static wire() {
    const page = App.page;
    page.el("f").addEventListener("submit", (event) => {
      event.preventDefault();
      void page.show({ code: page.el("code").value, number: page.el("num").value, date: page.el("date").value });
    });
    page.el("ex").addEventListener("click", (event) => {
      event.preventDefault();
      page.el("code").value = "Code civil";
      page.el("num").value = "1240";
      page.el("date").value = new Date().toISOString().slice(0, 10);
      void page.show({ code: "Code civil", number: "1240", date: page.el("date").value });
    });
    page.json("data/codes.json").then((codes) => {
      const list = page.el("codes");
      for (const c of codes) {
        const o = page.doc.createElement("option");
        o.value = c.titre;
        list.appendChild(o);
      }
    }).catch(() => {});
  }
}

// Wire the form only on the page itself: the action bridge frame loads this module too.
if (typeof window !== "undefined" && globalThis.document?.getElementById("f")) {
  App.wire();
}
