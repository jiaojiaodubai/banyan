/** Short-lived toast in the corner of the main window. */
export function showSimpleMessage(message: string): void {
  new ztoolkit.ProgressWindow(addon.data.config.addonName, {
    closeOnClick: true,
    closeTime: 4500,
  })
    .createLine({
      text: message,
      type: "default",
    })
    .show();
}
