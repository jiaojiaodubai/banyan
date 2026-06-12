declare namespace Zotero {
  type PromptButtonTitle = string | number;

  type PromptConfirmOptions = {
    window?: mozIDOMWindowProxy | null;
    title: string;
    text: string;
    button0?: PromptButtonTitle;
    button1?: PromptButtonTitle;
    button2?: PromptButtonTitle;
    checkLabel?: string;
    checkbox?: { value?: boolean };
    defaultButton?: 0 | 1 | 2;
    buttonDelay?: boolean;
    delayButtons?: boolean;
  };

  interface PromptAPI {
    readonly BUTTON_TITLE_OK: number;
    readonly BUTTON_TITLE_CANCEL: number;
    readonly BUTTON_TITLE_YES: number;
    readonly BUTTON_TITLE_NO: number;
    readonly BUTTON_TITLE_SAVE: number;
    readonly BUTTON_TITLE_DONT_SAVE: number;
    readonly BUTTON_TITLE_REVERT: number;

    confirm(options?: PromptConfirmOptions): number;
  }

  const Prompt: PromptAPI;
}
