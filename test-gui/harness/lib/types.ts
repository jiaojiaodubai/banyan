export interface FixtureCollection {
  key: string;
  name: string;
  parent?: string;
}

export interface FixtureItem {
  citationKey: string;
  itemType: string;
  collections: string[];
  title: string;
  creators?: Array<Record<string, unknown>>;
  tags?: string[];
  relations?: Record<string, string[]>;
  [field: string]: unknown;
}

export interface FixturesFile {
  version: 1;
  collection: FixtureCollection;
  subcollections: FixtureCollection[];
  items: FixtureItem[];
}
