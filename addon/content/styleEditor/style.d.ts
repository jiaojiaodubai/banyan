/// <reference path="./item.d.ts" />
/// <reference path="./unit.d.ts" />

type CitationType = "intext-citation" | "note-citation";
type MaybePromise<T> = T | Promise<T>;

type ScriptSafeObject<T extends object> = {
  readonly [
    K in keyof T as ScriptSafe<T[K]> extends never ? never : K
  ]-?: ScriptSafe<T[K]>;
};

type ScriptSafe<T> = T extends undefined
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
interface Style<T extends CitationType = CitationType> {
  INFO: StyleInfo<T>;
  UI?: StyleUI;
  generate: (contexts: CitationContext[]) => MaybePromise<StyleResult<T>>;
}

/**
 * User-authored script contract executed inside the sandbox.
 * `generate()` reads the readonly global `contexts` instead of accepting args.
 */
interface StyleScript<T extends CitationType = CitationType> {
  INFO: StyleInfo<T>;
  UI?: StyleUI;
  generate: () => MaybePromise<ScriptResult<T>>;
}

type StyleInfo<T extends CitationType = CitationType> = {
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

type StyleFile = StyleSummary & {
  filename: string;
};

type ComponentBase = {
  id: string;
  label: string;
};

type CitationComponentBase = ComponentBase;

type CiteComponentBase = ComponentBase & {
  /** Evaluate in the style sandbox once when the cite popup opens. */
  visible?: CiteVisibilityPredicate;
  /** Evaluate in the style sandbox whenever cite params change. */
  disabled?: CiteDisabledPredicate;
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

type CitationStyleComponent =
  | (CitationComponentBase & CheckboxComponent)
  | (CitationComponentBase & SelectComponent)
  | (CitationComponentBase & InputComponent);

type CiteStyleComponent =
  | (CiteComponentBase & CheckboxComponent)
  | (CiteComponentBase & SelectComponent)
  | (CiteComponentBase & InputComponent);

type StyleComponent = CitationStyleComponent | CiteStyleComponent;

type StyleUI = {
  cite: CiteStyleComponent[];
  citation: CitationStyleComponent[];
};

type CitationContext = CitationSource & {
  id: string;
  page: number;
};

type CitationSource = {
  cites: Cite[];
  params: CitationParams;
};

type CitationParams = Record<string, string | boolean>;

type Cite = {
  item: Item;
  params?: { [key: string]: string | boolean };
};

type CiteVisibilityPredicate = (item: Readonly<Item>) => boolean;

type CiteDisabledPredicate = (cite: Readonly<Cite>) => boolean;

/**
 * Script items keep strongly typed known fields, but allow arbitrary string
 * indexing so style authors can probe schema/extra-derived fields without
 * fighting JSDoc narrowing on every access.
 */
type ScriptItem = ScriptSafe<Item> & {
  readonly [field: string]: any;
};

type ScriptCreator<T extends CreatorType = CreatorType> = ScriptSafe<
  Creator<T>
>;

/** Safe readonly view exposed to style scripts via the global `contexts`. */
type ScriptCitationParams = ScriptSafe<CitationParams>;

type ScriptCite = ScriptSafe<Cite>;

type ScriptCitationSource = ScriptSafe<CitationSource>;

type ScriptContext = ScriptSafe<CitationContext>;

type ScriptContexts = readonly ScriptContext[];

type ScriptResult<T extends CitationType = CitationType> = {
  citations: ScriptCitationsMap[T];
  bibliography: ScriptBibliographyLine[];
};

type StyleResult<T extends CitationType = CitationType> = {
  citations: CitationsMap[T];
  bibliography: BibliographyLine[];
};

type CitationsMap = {
  "intext-citation": IntextCitation[];
  "note-citation": NoteCitation[];
};

type ScriptCitationsMap = {
  "intext-citation": ScriptIntextCitation[];
  "note-citation": ScriptNoteCitation[];
};

type Citation<T extends CitationType = CitationType> = {
  id: string;
  type: T;
  source: CitationSource;
  content: RichText;
};

type IntextCitation = Citation<"intext-citation">;

// For note citations, inherited content is rendered in the footnote area,
// while reference is the inline marker inserted into the document body.
type NoteCitation = Citation<"note-citation"> & {
  reference: RichText;
};

type BibliographyTitle = {
  type: "bibliography-title";
  content: RichText;
};

type BibliographyEntry = {
  id: string;
  type: "bibliography-entry";
  content: RichText;
};

type BibliographyLine = BibliographyTitle | BibliographyEntry;

type ScriptCitation = {
  id: string;
  // Script authors provide one declarative Unit; the host normalizes it to
  // RichText for rendering.
  content: Unit;
};

type ScriptIntextCitation = ScriptCitation;

// For note citations, inherited content is rendered in the footnote area,
// while reference is the inline marker inserted into the document body.
type ScriptNoteCitation = ScriptCitation & {
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

/**
 * `contexts` is injected as a readonly global by the sandbox before
 * `generate()` is called. Missing object properties fall back to empty
 * strings at runtime, while array semantics stay unchanged.
 */
declare const contexts: ScriptContexts;
