import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

import { resolveLocalApiBases } from "./config";
import { stateDir } from "./paths";

const STATE_FILE = join(stateDir, "local-api.local.json");

interface LocalApiState {
  serverID: string;
  key: string | null;
  remember: boolean;
}

interface LocalApiResponse {
  body: string;
  headers: Headers;
  status: number;
}

export class LocalApiError extends Error {
  status: number;
  body: string;

  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "LocalApiError";
    this.status = status;
    this.body = body;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

async function readState(): Promise<LocalApiState | null> {
  try {
    const raw = JSON.parse(await readFile(STATE_FILE, "utf8"));
    return isRecord(raw) ? (raw as unknown as LocalApiState) : null;
  } catch {
    return null;
  }
}

async function writeState(state: LocalApiState): Promise<void> {
  await mkdir(stateDir, { recursive: true });
  await writeFile(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export class LocalApiClient {
  state: LocalApiState | null = null;
  private readonly baseUrls: string[];
  private activeBaseUrl: string;

  constructor(
    baseUrlOrUrls: string | string[] = resolveLocalApiBases().map(
      (candidate) => candidate.baseUrl,
    ),
  ) {
    this.baseUrls = Array.isArray(baseUrlOrUrls)
      ? baseUrlOrUrls
      : [baseUrlOrUrls];
    this.activeBaseUrl = this.baseUrls[0];
  }

  async getServerInfo(): Promise<{ serverID: string; version: string | null }> {
    const response = await this.request("", { method: "GET" }, { auth: false });
    const serverID = response.headers.get("zotero-server-id");
    if (!serverID) {
      throw new Error(
        "当前 Zotero 没有提供 Zotero-Server-ID；请使用支持 Local API 写请求的 beta，并确认本地 API 已启用。",
      );
    }
    const previous = await readState();
    this.state = {
      serverID,
      key: previous?.key ?? null,
      remember: previous?.remember ?? false,
    };
    await writeState(this.state);
    return {
      serverID,
      version: response.headers.get("zotero-api-version"),
    };
  }

  async authorize(): Promise<string> {
    const serverID = await this.requireServerID();
    const response = await this.request(
      "local/authorize",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appName: "Banyan Manual Tests" }),
      },
      { auth: false, serverID },
    );
    let parsed: unknown;
    try {
      parsed = JSON.parse(response.body);
    } catch {
      throw new LocalApiError(
        "Local API 授权响应不是 JSON",
        response.status,
        response.body,
      );
    }
    if (!isRecord(parsed) || typeof parsed.key !== "string") {
      throw new LocalApiError(
        "Local API 授权没有返回 key；是否在 Zotero 弹窗中拒绝了授权？",
        response.status,
        response.body,
      );
    }
    this.state = {
      serverID,
      key: parsed.key,
      remember: parsed.remember === true,
    };
    await writeState(this.state);
    return parsed.key;
  }

  private async requireServerID(): Promise<string> {
    if (!this.state?.serverID) {
      await this.getServerInfo();
    }
    if (!this.state?.serverID) {
      throw new Error("无法获取 Zotero-Server-ID");
    }
    return this.state.serverID;
  }

  private async ensureKey(): Promise<string> {
    const state = (await readState()) ?? this.state;
    if (state?.key) {
      this.state = state;
      return state.key;
    }
    return this.authorize();
  }

  async request(
    path: string,
    init: RequestInit = {},
    options: { auth?: boolean; serverID?: string } = {},
  ): Promise<LocalApiResponse> {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if (options.serverID) {
      headers.set("Zotero-Server-ID", options.serverID);
    } else if (this.state?.serverID) {
      headers.set("Zotero-Server-ID", this.state.serverID);
    }
    if (options.auth) {
      const key = await this.ensureKey();
      headers.set("Zotero-API-Key", key);
    }

    let response: Response | null = null;
    let lastNetworkError: unknown = null;
    let lastUrl = this.activeBaseUrl;
    const ordered = [
      this.activeBaseUrl,
      ...this.baseUrls.filter((baseUrl) => baseUrl !== this.activeBaseUrl),
    ];
    for (const baseUrl of ordered) {
      const url = new URL(path, baseUrl);
      lastUrl = url.toString();
      try {
        response = await fetch(url, { ...init, headers });
        this.activeBaseUrl = baseUrl;
        break;
      } catch (error) {
        lastNetworkError = error;
      }
    }
    if (!response) {
      throw new LocalApiError(
        `无法连接 ${lastUrl}（尝试过 ${this.baseUrls.join(", ")}）。请先启动 Zotero beta，并在设置 → 高级中启用“允许其他应用与本机 Zotero 通信”。`,
        0,
        String(lastNetworkError),
      );
    }
    const body = await response.text();
    if (!response.ok) {
      throw new LocalApiError(
        `Local API ${init.method ?? "GET"} ${path} failed (${response.status}): ${body}`,
        response.status,
        body,
      );
    }
    return { body, headers: response.headers, status: response.status };
  }

  async getJson<T>(path: string, auth = false): Promise<T> {
    const response = await this.request(path, { method: "GET" }, { auth });
    return JSON.parse(response.body) as T;
  }

  async writeBatch<T extends Record<string, unknown>>(
    kind: "items" | "collections",
    entries: T[],
  ): Promise<Record<string, T>> {
    if (entries.length === 0) {
      return {};
    }
    if (entries.length > 50) {
      throw new Error(`Local API 单次最多写 50 个对象，收到 ${entries.length}`);
    }
    const perform = async (): Promise<LocalApiResponse> =>
      this.request(
        `users/0/${kind}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(entries),
        },
        { auth: true },
      );

    let response: LocalApiResponse;
    try {
      response = await perform();
    } catch (error) {
      if (!(error instanceof LocalApiError) || error.status !== 401) {
        throw error;
      }
      if (this.state) {
        this.state = { ...this.state, key: null };
        await writeState(this.state);
      }
      response = await perform();
    }

    const parsed = JSON.parse(response.body) as {
      successful?: Record<string, T>;
      failed?: Record<string, unknown>;
    };
    if (parsed.failed && Object.keys(parsed.failed).length > 0) {
      throw new LocalApiError(
        `Local API 写入 ${kind} 失败：${JSON.stringify(parsed.failed)}`,
        200,
        response.body,
      );
    }
    return parsed.successful ?? {};
  }

  async getCollections(): Promise<Array<Record<string, unknown>>> {
    return this.getJson<Array<Record<string, unknown>>>(
      "users/0/collections?format=json",
    );
  }

  async getCollectionItems(
    collectionKey: string,
  ): Promise<Array<Record<string, unknown>>> {
    return this.getJson<Array<Record<string, unknown>>>(
      `users/0/collections/${encodeURIComponent(collectionKey)}/items?format=json`,
    );
  }

  async getItem(key: string): Promise<Record<string, unknown>> {
    return this.getJson<Record<string, unknown>>(
      `users/0/items/${encodeURIComponent(key)}?format=json`,
    );
  }
}
