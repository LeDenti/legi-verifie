// Registers the Rule in force page's reads with the agent runtime. Every rule lives in
// script.js; this file only wraps App.page. All three actions only read.
import { App } from "./script.js";

class SiteActions {
  static registerActions(actions) {
    actions.register({
      name: "get_page",
      description: "Read this page: how anchoring and proofs work (method), what it cannot do, the anchored days with their XRPL testnet transactions, today's date, and what the page shows now. Changes nothing.",
      effect: "read",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute: () => App.page.getState(),
    });
    actions.register({
      name: "look_up",
      description: "Find a French law article in the anchored LEGI data, by code name and article number (for example 'Code civil' and '1240') or by LEGIARTI id. Returns its versions (start, end, state, first anchored day, LEGIARTI) and, when a date is given, the version(s) in force that day. Returns ok false with a reason or with candidate code names. Changes nothing.",
      effect: "read",
      timeoutMs: 60000,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          code: { type: "string", maxLength: 200, description: "Code name as the visitor gave it, e.g. Code civil, Code du travail." },
          number: { type: "string", maxLength: 40, description: "Article number as written in the code, e.g. 1240, L1121-1, R4127-2." },
          legiarti: { type: "string", maxLength: 20, description: "A LEGIARTI id, only if the visitor gave one or a result returned one." },
          date: { type: "string", format: "date", description: "The date to check, YYYY-MM-DD. Work it out from today's date in get_page when the visitor says 'today' or 'last week'." },
        },
      },
      execute: (args) => App.page.lookUp(args),
    });
    actions.register({
      name: "verify_anchor",
      description: "Verify one article version's anchoring in this browser: rebuild its Merkle path from the published fingerprints to the day's root, read the anchoring transaction on the XRPL testnet, and compare. Returns valid true or false with each check, the day, the root and transaction with ready-made short forms (rootShort, transactionShort, leafShort), the transaction link and its close time. Changes nothing.",
      effect: "read",
      timeoutMs: 60000,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["legiarti", "start"],
        properties: {
          legiarti: { type: "string", maxLength: 20, description: "The version's LEGIARTI id, from look_up." },
          start: { type: "string", format: "date", description: "The version's start date, from look_up." },
          day: { type: "string", format: "date", description: "Optional anchored day, from look_up anchors; the first one by default." },
        },
      },
      execute: (args) => App.page.verify(args),
    });
  }
}

export const registerActions = SiteActions.registerActions;
