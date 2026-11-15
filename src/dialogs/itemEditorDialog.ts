import { useL10n } from "../utils/locale";
import { unwrapDialogIO } from "../utils/window";
import {
  hasBlockingFieldChecks,
  formatFieldCheckDetail,
} from "../utils/itemFieldCheckText";
import { type ItemFieldCheckRun } from "../modules/itemFieldValidators";
import "../ui/itemEditor";
import type { ItemEditor } from "../ui/itemEditor";
import type { FieldValidationIssue } from "../ui/itemFieldEditor";
import type { ItemEditorDialogIO } from "../../typings/itemEditorDialog";
import { createLogger } from "../utils/logger";

const log = createLogger("item-editor-dialog");
const t = useL10n(["itemEditorDialog.ftl"]);

let io: ItemEditorDialogIO | null = null;
let item: Zotero.Item | null = null;
let editor: ItemEditor | null = null;
let resolved = false;
let closing = false;
let closePromptOpen = false;
let busy = false;
/** Signature of the last blocked check run, so a second Save can override. */
let pendingValidationSignature: string | null = null;

function onCreatorLayoutChanged(): void {
  window.setTimeout(applyFixedMinimumWidth, 0);
}

/**
 * Recompute the content minimum after rendering or a creator edit. The OS owns
 * the frame: we never hook `resize` (that caused the flicker loop), and only
 * widen once when the current window is smaller than the measured content.
 */
function applyFixedMinimumWidth(): void {
  if (!editor) return;
  const minimum = Math.ceil(editor.contentMinWidth);
  const root = document.documentElement as HTMLElement | null;
  if (root) {
    root.style.minWidth = `${minimum}px`;
  }
  const chromeWidth = Math.max(0, window.outerWidth - window.innerWidth);
  if (window.outerWidth < minimum + chromeWidth) {
    window.resizeTo(minimum + chromeWidth, window.outerHeight);
  }
}

function byId<T extends Element>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}

function setStatus(message: string, isError = false): void {
  const status = byId<HTMLElement>("editor-status");
  status.textContent = message;
  status.hidden = !message;
  status.classList.toggle("error", isError);
}

function setBusy(value: boolean, message = ""): void {
  busy = value;
  if (editor) editor.editable = !value;
  byId<HTMLButtonElement>("save-button").disabled = value;
  byId<HTMLButtonElement>("cancel-button").disabled = value;
  if (message) setStatus(message);
  else if (!value) setStatus("");
}

function closeOnce(): void {
  if (resolved) return;
  resolved = true;
  io?.deferred?.resolve();
}

function confirmDiscard(): boolean {
  if (!editor?.dirty) return true;
  return (
    Zotero.Prompt.confirm({
      window,
      title: t("item-editor-close-confirm-title"),
      text: t("item-editor-close-confirm"),
      // Destructive action on button0; the safe action on button1, which Esc
      // and the window close button also choose.
      button0: t("item-editor-close-discard"),
      button1: t("item-editor-close-keep"),
      defaultButton: 1,
    }) === 0
  );
}

async function load(): Promise<void> {
  if (document.body) {
    Zotero.UIProperties.registerRoot(document.body);
  }
  const raw = window.arguments?.[0];
  io = unwrapDialogIO<ItemEditorDialogIO>(raw);
  if (!io) {
    setStatus(t("item-editor-item-unavailable"), true);
    return;
  }
  const loaded = await Zotero.Items.getAsync(io.itemID);
  if (!loaded || loaded.deleted || !loaded.isRegularItem()) {
    setStatus(t("item-editor-item-unavailable"), true);
    return;
  }
  item = loaded;
  editor = byId<ItemEditor>("item-editor");
  editor.configure(item, item.isEditable());
  if (io.initialField) editor.focusField(io.initialField);
  if (io.initialCreatorIndex !== undefined) {
    editor.focusCreator(io.initialCreatorIndex);
  }
  if (!item.isEditable()) setStatus(t("item-editor-read-only"), true);
  byId<HTMLButtonElement>("save-button").disabled = !item.isEditable();
  document.addEventListener("creator-layout-changed", onCreatorLayoutChanged);
  setTimeout(applyFixedMinimumWidth, 50);
}

function reportError(
  error: unknown,
  fallbackKey: "item-editor-save-failed",
): void {
  log.error("Item editor operation failed", error);
  showAlert(
    t("item-editor-save-failed-title"),
    t(fallbackKey, {
      args: {
        message: error instanceof Error ? error.message : String(error),
      },
    }),
  );
}

/** Alert-style prompt. Use the alert icon, not confirmEx's question icon. */
function showAlert(title: string, text: string): void {
  Services.prompt.alert(window as unknown as mozIDOMWindowProxy, title, text);
}

async function save(): Promise<void> {
  if (busy || !item || !editor || !item.isEditable()) return;
  editor.blurOpenField();
  editor.applyCreatorsTo(item);

  setBusy(true, t("item-editor-checking"));
  let run: ItemFieldCheckRun | null;
  try {
    run = await addon.api.runItemFieldChecks(item);
  } catch (error) {
    setBusy(false);
    showValidationError(error);
    return;
  }
  setBusy(false);

  if (run && hasBlockingFieldChecks(run.checks)) {
    const issues = blockingIssues(run);
    const signature = validationSignature(issues);
    if (pendingValidationSignature === signature) {
      if (!confirmSaveAnyway(issues.length)) return;
      clearValidation();
      setStatus("");
      await finishSave();
      return;
    }
    showValidation(issues, signature);
    return;
  }

  clearValidation();
  setStatus("");
  await finishSave();
}

function blockingIssues(run: ItemFieldCheckRun): FieldValidationIssue[] {
  return run.checks
    .filter((check) => check.status !== "pass")
    .map((check) => ({
      description: check.description,
      detail: formatFieldCheckDetail(check),
      status: check.status === "error" ? ("error" as const) : ("fail" as const),
    }));
}

function validationSignature(issues: readonly FieldValidationIssue[]): string {
  return issues
    .map((issue) => `${issue.description}\u0000${issue.detail}`)
    .join("\u0001");
}

function confirmSaveAnyway(count: number): boolean {
  return (
    Zotero.Prompt.confirm({
      window,
      title: t("item-editor-validation-blocked-title"),
      text: t("item-editor-validation-save-anyway-confirm", {
        args: { count },
      }),
      button0: t("item-editor-validation-keep-editing"),
      button1: t("item-editor-save-anyway"),
      defaultButton: 0,
    }) === 1
  );
}

async function finishSave(): Promise<void> {
  if (!item || !editor) return;
  editor.blurOpenField();
  editor.applyCreatorsTo(item);
  setBusy(true, t("item-editor-saving"));
  try {
    const latest = await Zotero.Items.getAsync(item.id);
    if (!latest || latest.deleted) {
      throw new Error(t("item-editor-item-unavailable"));
    }
    await item.saveTx();
    closing = true;
    closeOnce();
    window.close();
  } catch (error) {
    reportError(error, "item-editor-save-failed");
  } finally {
    if (!closing) setBusy(false);
  }
}

function showValidation(
  issues: readonly FieldValidationIssue[],
  signature: string,
): void {
  const result = editor?.showValidationIssues(issues) ?? {
    matched: 0,
    total: issues.length,
    unmatched: [],
    focusTarget: null,
  };
  pendingValidationSignature = signature;
  const parts = [
    t("item-editor-validation-alert-summary", {
      args: { count: issues.length },
    }),
  ];
  if (result.matched) {
    parts.push(t("item-editor-validation-alert-highlighted"));
  }
  if (result.unmatched.length) {
    parts.push(
      t("item-editor-validation-alert-unmatched", {
        args: { count: result.unmatched.length },
      }),
    );
  }
  const errored = issues.filter((issue) => issue.status === "error").length;
  if (errored) {
    parts.push(
      t("item-editor-validation-alert-errors", {
        args: { count: errored },
      }),
    );
  }
  showAlert(t("item-editor-validation-blocked-title"), parts.join("\n\n"));
  // The alert takes focus while it is open; restore the visual focus after it
  // closes so the marked field is the one the user starts editing.
  result.focusTarget?.focus();
  result.focusTarget?.scrollIntoView({ block: "center", inline: "nearest" });
}

function showValidationError(error: unknown): void {
  pendingValidationSignature = null;
  const message = error instanceof Error ? error.message : String(error);
  showAlert(
    t("item-editor-validation-error-title"),
    t("item-editor-validation-error-detail", { args: { message } }),
  );
}

function clearValidation(): void {
  pendingValidationSignature = null;
  editor?.clearValidationIssues();
}

function cancel(): void {
  if (busy) return;
  if (!confirmDiscard()) return;
  closing = true;
  try {
    item?.reload();
  } catch {
    // Closing the window must not trap the user on a reload failure.
  }
  closeOnce();
  window.close();
}

function localize(): void {
  byId<HTMLButtonElement>("save-button").textContent = t("item-editor-save");
  byId<HTMLButtonElement>("cancel-button").textContent =
    t("item-editor-cancel");
}

window.addEventListener("load", () => {
  localize();
  byId<HTMLButtonElement>("save-button").addEventListener("click", () => {
    void save();
  });
  byId<HTMLButtonElement>("cancel-button").addEventListener("click", cancel);
  void load().catch((error) => reportError(error, "item-editor-save-failed"));
});

window.addEventListener("unload", () => {
  document.removeEventListener(
    "creator-layout-changed",
    onCreatorLayoutChanged,
  );
  closeOnce();
});
/**
 * Ask before discarding from the native close button/Alt+F4. Intercepting
 * `close` rather than `beforeunload` lets us show our own localized prompt;
 * returning from a beforeunload handler would make Gecko show its own
 * unlocalized "Are you sure?" dialog.
 */
window.addEventListener("close", (event) => {
  if (closing || !editor?.dirty) return;
  event.preventDefault();
  if (closePromptOpen) return;
  closePromptOpen = true;
  try {
    if (!confirmDiscard()) return;
    closing = true;
    try {
      item?.reload();
    } catch {
      // Closing the window must not trap the user on a reload failure.
    }
    closeOnce();
    window.close();
  } finally {
    closePromptOpen = false;
  }
});
