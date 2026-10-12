import { assert } from "chai";
import { refreshItemMenu } from "../src/modules/menu";
import { loadStyles } from "../src/modules/styles";
import { config } from "../package.json";

type MenuManager = typeof Zotero.MenuManager;

describe("item context menu registration", function () {
  const globals = globalThis as Record<string, unknown>;
  let previousAddon: unknown;
  let originalRegister: MenuManager["registerMenu"];
  let originalUnregister: MenuManager["unregisterMenu"];
  let registeredKey: string | null;
  let registrations: string[];
  let rejectedDuplicates: string[];
  let unregisterResults: boolean[];

  beforeEach(function () {
    const manager = Zotero.MenuManager;
    // The test page does not define the plugin's `addon` global, which
    // `menu.ts` reads for the style preset index and the plugin id.
    previousAddon = globals.addon;
    globals.addon = (Zotero as Record<string, unknown>)[config.addonInstance];

    originalRegister = manager.registerMenu;
    originalUnregister = manager.unregisterMenu;
    registeredKey = null;
    registrations = [];
    rejectedDuplicates = [];
    unregisterResults = [];
    // Stand-in for `Zotero.MenuManager`, which rejects a second registration
    // with the same `menuID` instead of replacing the first one (see
    // `pluginAPIBase._validate()`); the real registry is left untouched.
    manager.registerMenu = ((options: { menuID: string }) => {
      if (registeredKey) {
        rejectedDuplicates.push(options.menuID);
        return false;
      }
      registeredKey = `test-key:${options.menuID}`;
      registrations.push(registeredKey);
      return registeredKey;
    }) as MenuManager["registerMenu"];
    manager.unregisterMenu = ((key: string) => {
      const removed = registeredKey === key;
      if (removed) {
        registeredKey = null;
      }
      unregisterResults.push(removed);
      return removed;
    }) as MenuManager["unregisterMenu"];
  });

  afterEach(function () {
    const manager = Zotero.MenuManager;
    manager.registerMenu = originalRegister;
    manager.unregisterMenu = originalUnregister;
    globals.addon = previousAddon;
  });

  // The menu is rebuilt whenever the style index changes, which happens right
  // after startup (`loadStyles()`), so a rebuild that forgets to unregister
  // first fails silently: the stale menu stays cached and the marks never show.
  it("drops the previous registration before re-registering", function () {
    refreshItemMenu();
    refreshItemMenu();

    assert.isEmpty(
      rejectedDuplicates,
      "every rebuild must be accepted by Zotero.MenuManager",
    );
    assert.lengthOf(registrations, 2);
    assert.isTrue(
      unregisterResults.every((removed) => removed),
      "each rebuild must unregister the previous menu",
    );
  });

  // Reading the styles directory indexes one style per file. Announcing each of
  // them rebuilt this menu (unregister + build every contribution + register)
  // once per file, which is paid at startup and on every style-editor save.
  it("announces one index change per load, not one per style", async function () {
    await loadStyles(true);

    assert.isAtMost(
      registrations.length,
      2,
      "a reset load announces the cleared index, then the loaded one",
    );
  });
});
