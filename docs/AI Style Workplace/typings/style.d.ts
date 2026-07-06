import type { Creator, CreatorType, Item, ItemType } from "./item";
import type { RichText, Unit } from "./unit";

type CitationType = "intext-citation" | "note-citation";
type MaybePromise<T> = T | Promise<T>;

type ScriptSafeObject<T extends object> = {
  readonly [
    K in keyof T as ScriptSafe<T[K]> extends never ? never : K
  ]-?: ScriptSafe<T[K]>;
};

export type ScriptSafe<T> = T extends undefined
  ? never
  : T extends (...args: unknown[]) => unknown
    ? T
    : T extends string
      ? string
      : T extends number
        ? number
        : T extends boolean
          ? boolean
          : T extends readonly (infer U)[]
            ? readonly ScriptSafe<U>[]
            : T extends (infer U)[]
              ? readonly ScriptSafe<U>[]
              : T extends object
                ? ScriptSafeObject<T>
                : T;

/**
 * Host-side normalized style API.
 * Callers pass contexts here; the sandbox wrapper injects them as global `contexts`.
 */
export interface Style<T extends CitationType = CitationType> {
  INFO: StyleInfo<T>;
  UI?: StyleUI;
  generate: (contexts: CitationContext[]) => MaybePromise<StyleResult<T>>;
}

/**
 * User-authored script contract executed inside the sandbox.
 * `generate()` reads the readonly global `contexts` instead of accepting args.
 */
export interface StyleScript<T extends CitationType = CitationType> {
  INFO: StyleInfo<T>;
  UI?: StyleUI;
  generate: () => MaybePromise<ScriptResult<T>>;
}

export type StyleInfo<T extends CitationType = CitationType> = {
  id: string;
  title: string;
  description: string;
  citationType: T;
  creator: {
    type: string;
    name: string;
    email?: string;
    uri?: string;
  }[];
  tags: string[];
  documentation: string[];
  license: string;
  updated: string;
  [key: string]: unknown;
};

type StyleSummary = Pick<
  StyleInfo,
  "id" | "title" | "citationType" | "description" | "updated"
>;

export type StyleFile = StyleSummary & {
  filename: string;
};

type ComponentBase = {
  id: string;
  label: string;
  disabled?: boolean;
};

type CitationComponentBase = ComponentBase;

type CiteComponentBase = ComponentBase & {
  // If provided, this control is only shown for matched item types.
  itemType?: ItemType[];
};

type CheckboxComponent = {
  type: "checkbox";
  value: boolean;
};

type SelectComponent = {
  type: "select";
  value: string;
  options: Record<string, string>;
};

type InputComponent = {
  type: "input";
  value: string;
};

export type CitationStyleComponent =
  | (CitationComponentBase & CheckboxComponent)
  | (CitationComponentBase & SelectComponent)
  | (CitationComponentBase & InputComponent);

export type CiteStyleComponent =
  | (CiteComponentBase & CheckboxComponent)
  | (CiteComponentBase & SelectComponent)
  | (CiteComponentBase & InputComponent);

export type StyleComponent = CitationStyleComponent | CiteStyleComponent;

export type StyleUI = {
  cite: StyleComponent[];
  citation: StyleComponent[];
};

export type CitationContext = CitationSource & {
  id: string;
  page: number;
};

export type CitationSource = {
  cites: Cite[];
  params: CitationParams;
};

export type CitationParams = Record<string, string | boolean>;

export type Cite = {
  item: Item;
  params?: { [key: string]: string | boolean };
};

/**
 * Script items keep strongly typed known fields, but allow arbitrary string
 * indexing so style authors can probe schema/extra-derived fields without
 * fighting JSDoc narrowing on every access.
 */
export type ScriptItem = ScriptSafe<Item> & {
  readonly [field: string]: any;
};

export type ScriptCreator<T extends CreatorType = CreatorType> = ScriptSafe<
  Creator<T>
>;

/** Safe readonly view exposed to style scripts via the global `contexts`. */
export type ScriptCitationParams = ScriptSafe<CitationParams>;

export type ScriptCite = ScriptSafe<Cite>;

export type ScriptCitationSource = ScriptSafe<CitationSource>;

export type ScriptContext = ScriptSafe<CitationContext>;

export type ScriptContexts = readonly ScriptContext[];

export type ScriptResult<T extends CitationType = CitationType> = {
  citations: ScriptCitationsMap[T];
  bibliography: ScriptBibliographyLine[];
};

export type StyleResult<T extends CitationType = CitationType> = {
  citations: CitationsMap[T];
  bibliography: BibliographyLine[];
};

export type CitationsMap = {
  "intext-citation": IntextCitation[];
  "note-citation": NoteCitation[];
};

export type ScriptCitationsMap = {
  "intext-citation": ScriptIntextCitation[];
  "note-citation": ScriptNoteCitation[];
};

export type Citation<T extends CitationType = CitationType> = {
  id: string;
  type: T;
  source: CitationSource;
  content: RichText;
};

export type IntextCitation = Citation<"intext-citation">;

// For note citations, inherited content is rendered in the footnote area,
// while reference is the inline marker inserted into the document body.
export type NoteCitation = Citation<"note-citation"> & {
  reference: RichText;
};

export type BibliographyTitle = {
  type: "bibliography-title";
  content: RichText;
};

export type BibliographyEntry = {
  id: string;
  type: "bibliography-entry";
  content: RichText;
};

export type BibliographyLine = BibliographyTitle | BibliographyEntry;

export type ScriptCitation = {
  id: string;
  // Script authors provide one declarative Unit; the host normalizes it to
  // RichText for rendering.
  content: Unit;
};

export type ScriptIntextCitation = ScriptCitation;

// For note citations, inherited content is rendered in the footnote area,
// while reference is the inline marker inserted into the document body.
export type ScriptNoteCitation = ScriptCitation & {
  reference: Unit;
};

type ScriptBibliographyTitle = {
  // JS object literal inference widens string properties; keep script-side
  // types permissive and rely on runtime validation for exact tag checking.
  type: "bibliography-title" | string;
  content: Unit;
};

type ScriptBibliographyEntry = {
  id: string;
  type: "bibliography-entry" | string;
  content: Unit;
};

type ScriptBibliographyLine = ScriptBibliographyTitle | ScriptBibliographyEntry;
