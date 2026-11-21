/**
 * Apply Zotero's global UI preferences to one of our own dialog windows.
 *
 * Zotero's shared components read the user's font size and UI density from
 * attributes that `Zotero.UIProperties` writes onto a registered root
 * (`zoteroFontSize`, `zoteroUIDensity`). Zotero does this for its own windows
 * (the main window and the integration citation dialog), so a plugin window
 * that hosts those components has to do the same. Without it, density-scoped
 * rules silently fall back to the compact metrics: a virtualized table header
 * becomes shorter than the native one while its rows keep the preferred
 * density, and the window also ignores the user's font size preference.
 */
export function applyZoteroUIProperties(root?: Element): void {
  const target = root ?? document.body;
  if (!target) return;
  Zotero.UIProperties.registerRoot(target);
}
