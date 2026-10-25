/**
 * Markup <-> `RichText` for rich-text controls and editors.
 *
 * A rich parameter value is restricted markup; the editor works in structured
 * `RichText`, so this module is the boundary between the two. It uses the same
 * parser/serializer the core uses for style output, so the preview and the
 * generated citation cannot disagree.
 */
import type { RichText } from "@banyan/core/types/unit";
import { richTextFromHtml } from "@banyan/core/richText/markup";
import { renderRichTextToHtml } from "@banyan/core/richText/render";
import { parseHtml } from "../modules/sandbox/capabilities";

export function richTextFromMarkup(value: string): RichText {
  return richTextFromHtml(value, parseHtml);
}

/**
 * Serialize edited `RichText` to the restricted markup a rich parameter stores.
 *
 * The core renderer already escapes text, whitelists tags and filters link
 * protocols; newlines become `<br>` because a raw newline would be collapsed
 * by the HTML preview.
 */
export function markupFromRichText(richText: RichText): string {
  return renderRichTextToHtml(richText).replace(/\n/g, "<br>");
}
