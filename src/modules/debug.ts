export async function dialogExample(): Promise<void> {
  const dialogData: {
    unloadCallback: () => void;
    unloadLock?: { promise: Promise<void>; resolve: () => void };
    [key: string | number]: unknown;
  } = {
    unloadCallback: () => {
      addon.data.dialog = undefined;
    },
  };

  const dialogHelper = new ztoolkit.Dialog(2, 2)
    .addCell(0, 0, {
      tag: "h1",
      properties: { innerHTML: "Debug Tools" },
    })
    .addButton("Close", "cancel")
    .setDialogData(dialogData)
    .open("Banyan Debug");

  addon.data.dialog = dialogHelper;
  await dialogData.unloadLock?.promise;
}
