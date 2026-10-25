import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

import { LocalApiClient, LocalApiError } from "./localApi";
import { stateDir, fixturesPath } from "./paths";
import type { FixtureCollection, FixtureItem, FixturesFile } from "./types";

const FIXTURE_TAG = "banyan-manual-fixture";
export const FIXTURE_STATE_FILE = join(stateDir, "fixtures.local.json");

function fixtureDefinitionSha(fixtures: FixturesFile): string {
  return createHash("sha256").update(JSON.stringify(fixtures)).digest("hex");
}

export interface FixtureState {
  serverID: string;
  fixtureSha: string;
  collectionKeys: string[];
  itemKeys: Record<string, string>;
  syncedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asArray(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }
  if (isRecord(value) && Array.isArray(value.data)) {
    return value.data.filter(isRecord);
  }
  return [];
}

function objectData(record: Record<string, unknown>): Record<string, unknown> {
  return isRecord(record.data) ? record.data : record;
}

function objectKey(record: Record<string, unknown>): string | null {
  if (typeof record.key === "string") {
    return record.key;
  }
  const data = objectData(record);
  return typeof data.key === "string" ? data.key : null;
}

function objectVersion(record: Record<string, unknown>): number {
  if (typeof record.version === "number") {
    return record.version;
  }
  const data = objectData(record);
  return typeof data.version === "number" ? data.version : 0;
}

function validateKey(key: string, label: string): void {
  if (!/^[23456789ABCDEFGHIJKLMNPQRSTUVWXYZ]{8}$/.test(key)) {
    throw new Error(
      `${label} key must use Zotero's 8-character object key alphabet: ${key}`,
    );
  }
}

export function validateFixturesFile(raw: unknown): FixturesFile {
  if (!isRecord(raw)) {
    throw new Error("fixtures.json must be a JSON object");
  }
  if (raw.version !== 1) {
    throw new Error("fixtures.version must be 1");
  }
  if (!isRecord(raw.collection)) {
    throw new Error("fixtures.collection must be an object");
  }
  const collection = raw.collection as unknown as FixtureCollection;
  if (
    typeof collection.key !== "string" ||
    typeof collection.name !== "string"
  ) {
    throw new Error("fixtures.collection needs key and name");
  }
  validateKey(collection.key, "collection");
  if (collection.parent) {
    throw new Error("fixtures.collection must be a top-level collection");
  }

  const subcollections = Array.isArray(raw.subcollections)
    ? (raw.subcollections as FixtureCollection[])
    : [];
  const collectionKeys = new Set([collection.key]);
  for (const subcollection of subcollections) {
    if (
      typeof subcollection.key !== "string" ||
      typeof subcollection.name !== "string"
    ) {
      throw new Error("each subcollection needs key and name");
    }
    validateKey(subcollection.key, "subcollection");
    if (subcollection.parent !== collection.key) {
      throw new Error(
        `subcollection ${subcollection.key} must have parent ${collection.key}`,
      );
    }
    if (collectionKeys.has(subcollection.key)) {
      throw new Error(`duplicate collection key: ${subcollection.key}`);
    }
    collectionKeys.add(subcollection.key);
  }

  if (!Array.isArray(raw.items) || raw.items.length === 0) {
    throw new Error("fixtures.items must be a non-empty array");
  }
  const citationKeys = new Set<string>();
  const items: FixtureItem[] = [];
  for (const [index, value] of raw.items.entries()) {
    if (!isRecord(value)) {
      throw new Error(`fixtures.items[${index}] must be an object`);
    }
    const item = value as unknown as FixtureItem;
    if (
      typeof item.citationKey !== "string" ||
      item.citationKey.trim() === ""
    ) {
      throw new Error(`fixtures.items[${index}].citationKey is required`);
    }
    if (citationKeys.has(item.citationKey)) {
      throw new Error(`duplicate citationKey: ${item.citationKey}`);
    }
    citationKeys.add(item.citationKey);
    if (typeof item.itemType !== "string" || item.itemType === "") {
      throw new Error(`fixtures.items[${index}].itemType is required`);
    }
    if (typeof item.title !== "string" || item.title === "") {
      throw new Error(`fixtures.items[${index}].title is required`);
    }
    if (!Array.isArray(item.collections) || item.collections.length === 0) {
      throw new Error(`fixtures.items[${index}].collections is required`);
    }
    for (const collectionKey of item.collections) {
      if (!collectionKeys.has(collectionKey)) {
        throw new Error(
          `fixtures.items[${index}] references unknown collection ${collectionKey}`,
        );
      }
    }
    items.push(item);
  }

  for (const item of items) {
    for (const [predicate, targets] of Object.entries(item.relations ?? {})) {
      if (!Array.isArray(targets)) {
        throw new Error(
          `relations for ${item.citationKey}/${predicate} must be an array`,
        );
      }
      for (const target of targets) {
        if (!citationKeys.has(target)) {
          throw new Error(
            `relation target ${target} for ${item.citationKey} is not a fixture item`,
          );
        }
      }
    }
  }

  return { version: 1, collection, subcollections, items };
}

export async function loadFixtures(path = fixturesPath): Promise<FixturesFile> {
  return validateFixturesFile(JSON.parse(await readFile(path, "utf8")));
}

export async function loadFixtureState(): Promise<FixtureState | null> {
  try {
    const raw = JSON.parse(await readFile(FIXTURE_STATE_FILE, "utf8"));
    return isRecord(raw) ? (raw as unknown as FixtureState) : null;
  } catch {
    return null;
  }
}

async function saveFixtureState(state: FixtureState): Promise<void> {
  await mkdir(stateDir, { recursive: true });
  await writeFile(
    FIXTURE_STATE_FILE,
    `${JSON.stringify(state, null, 2)}\n`,
    "utf8",
  );
}

function stripFixtureFields(
  item: FixtureItem,
  topCollectionKey: string,
): Record<string, unknown> {
  const data: Record<string, unknown> = { ...item };
  delete data.relations;
  // Keep every fixture item directly in the top collection as well, so the
  // Local API collection query sees it without walking child collections.
  data.collections = [...new Set([topCollectionKey, ...item.collections])];
  data.tags = [...new Set([...(item.tags ?? []), FIXTURE_TAG])];
  return data;
}

function relationUri(itemKey: string): string {
  return `http://zotero.org/users/0/items/${itemKey}`;
}

export async function syncFixtures(
  client: LocalApiClient,
  fixtures: FixturesFile,
): Promise<FixtureState> {
  const server = await client.getServerInfo();
  const collections = asArray(await client.getCollections());
  const byKey = new Map<string, Record<string, unknown>>();
  for (const collection of collections) {
    const key = objectKey(collection);
    if (key) {
      byKey.set(key, collection);
    }
  }

  const definitions: FixtureCollection[] = [
    fixtures.collection,
    ...fixtures.subcollections,
  ];
  for (const definition of definitions) {
    const existing = byKey.get(definition.key);
    if (existing) {
      const data = objectData(existing);
      if (data.name !== definition.name) {
        throw new Error(
          `collection ${definition.key} exists with name "${String(data.name)}", expected "${definition.name}"; refusing to overwrite`,
        );
      }
      const expectedParent = definition.parent ?? false;
      if ((data.parentCollection ?? false) !== expectedParent) {
        throw new Error(
          `collection ${definition.key} has parent ${String(data.parentCollection)}, expected ${String(expectedParent)}`,
        );
      }
      continue;
    }
    const entry: Record<string, unknown> = {
      key: definition.key,
      version: 0,
      name: definition.name,
      parentCollection: definition.parent ?? false,
    };
    try {
      await client.writeBatch("collections", [entry]);
    } catch (error) {
      const message = (error as Error).message;
      throw new Error(
        `创建 collection ${definition.key} 失败：${message}\n` +
          "需要支持 Local API 写请求的 Zotero beta，并在设置中启用本地 API。",
        { cause: error },
      );
    }
  }

  const topItems = asArray(
    await client.getCollectionItems(fixtures.collection.key),
  );
  const existingByCitationKey = new Map<string, Record<string, unknown>>();
  for (const record of topItems) {
    const data = objectData(record);
    if (typeof data.citationKey === "string") {
      existingByCitationKey.set(data.citationKey, record);
    }
  }

  const itemKeys: Record<string, string> = {};
  for (const item of fixtures.items) {
    const existing = existingByCitationKey.get(item.citationKey);
    const base = stripFixtureFields(item, fixtures.collection.key);
    if (existing) {
      const key = objectKey(existing);
      if (!key) {
        throw new Error(
          `cannot find key for existing item ${item.citationKey}`,
        );
      }
      const entry = {
        ...base,
        key,
        version: objectVersion(existing),
      };
      await client.writeBatch("items", [entry]);
      itemKeys[item.citationKey] = key;
    } else {
      const written = await client.writeBatch("items", [base]);
      const record = written["0"];
      const key = record ? objectKey(record) : null;
      if (!key) {
        throw new Error(
          `creating item ${item.citationKey} returned no key; response ${JSON.stringify(written)}`,
        );
      }
      itemKeys[item.citationKey] = key;
    }
  }

  // Refresh versions after the first write pass, then set relations.
  const refreshed = asArray(
    await client.getCollectionItems(fixtures.collection.key),
  );
  const refreshedByCitationKey = new Map<string, Record<string, unknown>>();
  for (const record of refreshed) {
    const data = objectData(record);
    if (typeof data.citationKey === "string") {
      refreshedByCitationKey.set(data.citationKey, record);
    }
  }

  for (const item of fixtures.items) {
    const relations = item.relations ?? {};
    const record = refreshedByCitationKey.get(item.citationKey);
    if (!record) {
      throw new Error(
        `fixture item disappeared after write: ${item.citationKey}`,
      );
    }
    const key = objectKey(record);
    if (!key) {
      throw new Error(`missing key for ${item.citationKey}`);
    }
    const resolved: Record<string, string[]> = {};
    for (const [predicate, targets] of Object.entries(relations)) {
      resolved[predicate] = targets.map((target) => {
        const targetKey = itemKeys[target];
        if (!targetKey) {
          throw new Error(`missing item key for relation target ${target}`);
        }
        return relationUri(targetKey);
      });
    }
    await client.writeBatch("items", [
      {
        key,
        version: objectVersion(record),
        relations: resolved,
      },
    ]);
  }

  const finalItems = asArray(
    await client.getCollectionItems(fixtures.collection.key),
  );
  const finalByCitationKey = new Map<string, Record<string, unknown>>();
  for (const record of finalItems) {
    const data = objectData(record);
    if (typeof data.citationKey === "string") {
      finalByCitationKey.set(data.citationKey, record);
    }
  }
  for (const item of fixtures.items) {
    const record = finalByCitationKey.get(item.citationKey);
    if (!record) {
      throw new Error(
        `fixture verification failed: missing ${item.citationKey}`,
      );
    }
    const data = objectData(record);
    const collections = Array.isArray(data.collections)
      ? (data.collections as string[])
      : [];
    for (const collectionKey of [
      fixtures.collection.key,
      ...item.collections,
    ]) {
      if (!collections.includes(collectionKey)) {
        throw new Error(
          `fixture verification failed: ${item.citationKey} is not in ${collectionKey}`,
        );
      }
    }
    const expectedRelations: Record<string, string[]> = {};
    for (const [predicate, targets] of Object.entries(item.relations ?? {})) {
      expectedRelations[predicate] = targets.map((target) => {
        const targetKey = itemKeys[target];
        if (!targetKey) {
          throw new Error(`fixture verification: missing target ${target}`);
        }
        return relationUri(targetKey);
      });
    }
    const actualRelations = isRecord(data.relations)
      ? (data.relations as Record<string, unknown>)
      : {};
    const predicates = new Set([
      ...Object.keys(expectedRelations),
      ...Object.keys(actualRelations),
    ]);
    for (const predicate of predicates) {
      const expected = [...(expectedRelations[predicate] ?? [])].sort();
      const actual = Array.isArray(actualRelations[predicate])
        ? [...(actualRelations[predicate] as string[])].sort()
        : [];
      if (JSON.stringify(expected) !== JSON.stringify(actual)) {
        throw new Error(
          `fixture verification failed: ${item.citationKey}/${predicate} relations differ`,
        );
      }
    }
  }

  const state: FixtureState = {
    serverID: server.serverID,
    fixtureSha: fixtureDefinitionSha(fixtures),
    collectionKeys: definitions.map((definition) => definition.key),
    itemKeys,
    syncedAt: new Date().toISOString(),
  };
  await saveFixtureState(state);
  return state;
}

export async function verifyFixtureState(
  client: LocalApiClient,
  fixtures: FixturesFile,
): Promise<{ ok: boolean; reason: string; serverID: string | null }> {
  const state = await loadFixtureState();
  if (!state) {
    return {
      ok: false,
      reason: "没有夹具状态，请运行 test:manual:fixtures",
      serverID: null,
    };
  }
  let serverID: string;
  try {
    serverID = (await client.getServerInfo()).serverID;
  } catch (error) {
    return { ok: false, reason: (error as Error).message, serverID: null };
  }
  if (state.serverID !== serverID) {
    return {
      ok: false,
      reason: "Zotero-Server-ID 已变化，请运行 test:manual:fixtures",
      serverID,
    };
  }
  if (state.fixtureSha !== fixtureDefinitionSha(fixtures)) {
    return {
      ok: false,
      reason: "fixtures.json 已变化，请运行 test:manual:fixtures",
      serverID,
    };
  }
  return { ok: true, reason: "ok", serverID };
}

export function explainLocalApiError(error: unknown): string {
  if (error instanceof LocalApiError) {
    if (error.status === 403) {
      return `${error.message}\n若刚拒绝了授权，请重试并选择 Always Allow；否则请在 Zotero 设置 → 高级中启用本地 API。`;
    }
    if (error.status === 401) {
      return `${error.message}\n请重新授权：删除 test-gui/.state/local-api.local.json 后重试。`;
    }
    return error.message;
  }
  return (error as Error).message;
}
