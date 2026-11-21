// The reads this site shares with other agent sites, through its action bridge.
// bridge/agent-manifest.json loads this module in a hidden frame on this origin, which has
// no page: the reads use the site's published data and the XRPL testnet, never the page.
// Each read has the name and input of the page's own action (site-actions.js).
// Every fact here is public (law article versions and public ledger anchors), so the
// reads are shared with every site ("*").
import { App } from "../script.js";
import { registerActions as registerPageActions } from "../site-actions.js";

class BridgeActions {
  static CALLERS = ["*"];

  static registerActions(actions) {
    registerPageActions({
      register(definition) {
        actions.register({ ...definition, availability: "bridge", callerOrigins: BridgeActions.CALLERS });
      },
    });
  }
}

// Keep App imported so the shared page object (data and ledger readers) is created here.
void App;
export const registerActions = BridgeActions.registerActions;
