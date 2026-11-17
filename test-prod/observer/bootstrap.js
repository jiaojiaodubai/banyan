var stopped = false;

function install() {}

function startup() {
  stopped = false;
  void observe();
}

function shutdown() {
  stopped = true;
}

function uninstall() {
  stopped = true;
}

async function observe() {
  let result;
  try {
    const { addonID, addonRef, addonInstance } = JSON.parse(
      Services.prefs.getStringPref("banyan.testObserver.config"),
    );
    await Zotero.initializationPromise;
    await Zotero.uiReadyPromise;
    const deadline = Date.now() + 120000;
    while (
      !Zotero[addonInstance]?.data.initialized &&
      Date.now() < deadline &&
      !stopped
    ) {
      await Zotero.Promise.delay(250);
    }
    if (stopped) return;
    const banyan = Zotero[addonInstance];
    if (!banyan?.data.initialized)
      throw new Error(`${addonID} did not initialize`);
    if (banyan.data.startupFailures.length) {
      throw new Error(
        `Startup failures: ${banyan.data.startupFailures.join(", ")}`,
      );
    }
    const registry = Components.classes[
      "@mozilla.org/chrome/chrome-registry;1"
    ].getService(Components.interfaces.nsIChromeRegistry);
    const resource = registry.convertChromeURL(
      Services.io.newURI(`chrome://${addonRef}/content/scripts/${addonRef}.js`),
    ).spec;
    if (!resource.startsWith("jar:")) {
      throw new Error(`Banyan is not running from an XPI: ${resource}`);
    }
    if (banyan.data.env !== "production") {
      throw new Error(`Unexpected build environment: ${banyan.data.env}`);
    }
    const fixture = banyan.data.styles.files.get("manual-gui-disposable");
    if (!fixture) {
      throw new Error("Fixture style is absent from the index");
    }
    const output = await banyan.api.generate(
      { id: fixture.id, title: fixture.title },
      [
        {
          id: "production-test",
          page: 1,
          cites: [
            {
              item: {
                id: "1",
                itemType: "book",
                title: "Test",
                creators: [],
                extra: {},
              },
              params: {},
            },
          ],
          params: {},
        },
      ],
    );
    if (
      output.citations.length !== 1 ||
      output.citations[0].id !== "production-test" ||
      !output.citations[0].content?.text
    ) {
      throw new Error("Fixture style did not generate a citation");
    }
    const win = Zotero.getMainWindow();
    const [message] = await win.document.l10n.formatMessages([
      { id: `${addonRef}-menuitem-style-editor` },
    ]);
    const label = message?.attributes?.find(
      (attr) => attr.name === "label",
    )?.value;
    if (!label) throw new Error("Style editor menu label did not resolve");
    result = { ok: true, resource, label };
  } catch (error) {
    result = { ok: false, error: `${String(error)}\n${error?.stack || ""}` };
  }
  try {
    await IOUtils.writeUTF8(
      PathUtils.join(Zotero.DataDirectory.dir, "banyan-prod-result.json"),
      JSON.stringify(result),
    );
  } finally {
    Services.startup.quit(Services.startup.eAttemptQuit);
  }
}
