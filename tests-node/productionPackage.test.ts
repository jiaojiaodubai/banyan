import { assert } from "chai";
import AdmZip from "adm-zip";
import { validateProductionArchive } from "../scripts/checkProductionPackage.mjs";

describe("production package contract", function () {
  const config = {
    addonID: "test@example.org",
    addonRef: "test",
    version: "1.0",
  };
  const assets = { defaultCode: "defaultStyle.js" };
  const locales = ["en-US/test-mainWindow.ftl"];

  function makeArchive(): AdmZip {
    const zip = new AdmZip();
    const add = (name: string, value: string): void => {
      zip.addFile(name, Buffer.from(value));
    };
    add(
      "manifest.json",
      JSON.stringify({
        version: config.version,
        applications: { zotero: { id: config.addonID } },
      }),
    );
    add("bootstrap.js", "bootstrap");
    add("content/scripts/test.js", "bundle");
    add("content/icons/favicon.svg", "icon");
    add("content/integration/Word/Banyan.dotm", "word");
    add("content/styleEditor/defaultStyle.js", "style");
    add("locale/en-US/test-mainWindow.ftl", "message");
    add(
      "content/styleEditor/presets/presets-manifest.json",
      JSON.stringify(["preset.js"]),
    );
    add("content/styleEditor/presets/preset.js", "preset");
    add(
      "content/integration/WPS/addin-manifest.json",
      JSON.stringify({
        resourceRoot: "integration/WPS/Banyan_1",
        files: ["index.html"],
      }),
    );
    add("content/integration/WPS/Banyan_1/index.html", "wps");
    return zip;
  }

  it("accepts a complete package", function () {
    validateProductionArchive(makeArchive(), config, assets, locales);
  });

  it("rejects a missing required editor resource", function () {
    const zip = makeArchive();
    zip.deleteFile("content/styleEditor/defaultStyle.js");
    assert.throws(
      () => validateProductionArchive(zip, config, assets, locales),
      /Missing XPI resource.*defaultStyle/,
    );
  });

  it("rejects a missing WPS manifest entry", function () {
    const zip = makeArchive();
    zip.deleteFile("content/integration/WPS/Banyan_1/index.html");
    assert.throws(
      () => validateProductionArchive(zip, config, assets, locales),
      /Missing XPI resource.*index.html/,
    );
  });

  it("rejects an empty required text resource", function () {
    const zip = makeArchive();
    zip.updateFile("content/styleEditor/defaultStyle.js", Buffer.from(" \n"));
    assert.throws(
      () => validateProductionArchive(zip, config, assets, locales),
      /Empty XPI resource.*defaultStyle/,
    );
  });

  it("rejects an incorrect add-on version", function () {
    assert.throws(
      () =>
        validateProductionArchive(
          makeArchive(),
          { ...config, version: "2.0" },
          assets,
          locales,
        ),
      /manifest ID or version/,
    );
  });
});
