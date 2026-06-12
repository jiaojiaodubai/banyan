import { config } from "../../package.json";
import { FluentMessageId } from "../../typings/i10n";

/**
 * Get locale string, see https://firefox-source-docs.mozilla.org/l10n/fluent/tutorial.html#fluent-translation-list-ftl
 * @param localString ftl key
 * @param options.branch branch name
 * @param options.args args
 * @example
 * ```ftl
 * # addon.ftl
 * addon-static-example = This is default branch!
 *     .branch-example = This is a branch under addon-static-example!
 * addon-dynamic-example =
    { $count ->
        [one] I have { $count } apple
       *[other] I have { $count } apples
    }
 * ```
 * ```js
 * t("addon-static-example"); // This is default branch!
 * t("addon-static-example", { branch: "branch-example" }); // This is a branch under addon-static-example!
 * t("addon-dynamic-example", { args: { count: 1 } }); // I have 1 apple
 * t("addon-dynamic-example", { args: { count: 2 } }); // I have 2 apples
 * ```
 */
export function useL10n(ftlFiles?: string[]) {
  const t = (
    id: string,
    options?: { branch?: string; args?: Record<string, string | number> },
  ) => {
    const { branch, args } = options || {};
    const prefixedId = `${config.addonRef}-${id}`;
    const message = createLocale(ftlFiles).formatMessagesSync([
      { id: prefixedId, args },
    ])[0];
    if (!message) return prefixedId;
    if (branch && message.attributes) {
      for (const attr of message.attributes) {
        if (attr.name === branch) {
          return attr.value;
        }
      }
    }
    return message.value ?? prefixedId;
  };
  return t;
}

export function createLocale(ftlFiles?: string[]) {
  if (!ftlFiles) {
    ftlFiles = ["addon.ftl"];
  }
  if (ftlFiles.some((file) => !file.endsWith(".ftl"))) {
    throw new Error("files must be an array of .ftl file names");
  }
  const l10n = new (
    typeof Localization === "undefined"
      ? ztoolkit.getGlobal("Localization")
      : Localization
  )(
    ftlFiles.map((file) => `${config.addonRef}-${file}`),
    true,
  );
  return l10n;
}

export function getLocaleID(id: FluentMessageId) {
  return `${config.addonRef}-${id}`;
}
