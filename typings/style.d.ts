import type { Item, ItemType } from "./item";
import type { TextUnit, Unit } from "./unit";

type CitationType = "intext-citation" | "note-citation";
type MaybePromise<T> = T | Promise<T>;

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
  data: Record<string, string>;
};

type TextComponent = {
  type: "text";
  value: string;
  data?: {
    placeholder?: string;
  };
};

export type CitationStyleComponent =
  | (CitationComponentBase & CheckboxComponent)
  | (CitationComponentBase & SelectComponent)
  | (CitationComponentBase & TextComponent);

export type CiteStyleComponent =
  | (CiteComponentBase & CheckboxComponent)
  | (CiteComponentBase & SelectComponent)
  | (CiteComponentBase & TextComponent);

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

/** Readonly view exposed to style scripts via the global `contexts`. */
export type ScriptContext = DeepReadonly<CitationContext>;

export type ScriptContexts = readonly ScriptContext[];

type DeepReadonly<T> = T extends (...args: unknown[]) => unknown
  ? T
  : T extends readonly (infer U)[]
    ? readonly DeepReadonly<U>[]
    : T extends (infer U)[]
      ? readonly DeepReadonly<U>[]
      : T extends object
        ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
        : T;

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
  units: TextUnit[];
};

export type IntextCitation = Citation<"intext-citation">;

// For note citations, inherited units are rendered in the footnote area,
// while reference is the inline marker inserted into the document body.
export type NoteCitation = Citation<"note-citation"> & {
  reference: TextUnit[];
};

export type BibliographyTitle = {
  type: "bibliography-title";
  units: TextUnit[];
};

export type BibliographyEntry = {
  id: string;
  type: "bibliography-entry";
  units: TextUnit[];
};

export type BibliographyLine = BibliographyTitle | BibliographyEntry;

export type ScriptCitation = {
  id: string;
  units: Unit;
};

export type ScriptIntextCitation = ScriptCitation;

// For note citations, inherited units are rendered in the footnote area,
// while reference is the inline marker inserted into the document body.
export type ScriptNoteCitation = ScriptCitation & {
  reference: Unit;
};

type ScriptBibliographyTitle = {
  // JS object literal inference widens string properties; keep script-side
  // types permissive and rely on runtime validation for exact tag checking.
  type: "bibliography-title" | string;
  units: Unit;
};

type ScriptBibliographyEntry = {
  id: string;
  type: "bibliography-entry" | string;
  units: Unit;
};

type ScriptBibliographyLine = ScriptBibliographyTitle | ScriptBibliographyEntry;
