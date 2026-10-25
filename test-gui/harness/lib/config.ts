import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { repoPath } from "./paths";

export const DEFAULT_LOCAL_API_PORT = 23119;
export const FALLBACK_LOCAL_API_PORT = 23124;

export function parseDotEnv(text: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    if (line.startsWith("export ")) {
      line = line.slice("export ".length).trim();
    }
    const equals = line.indexOf("=");
    if (equals <= 0) {
      continue;
    }
    const key = line.slice(0, equals).trim();
    let value = line.slice(equals + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) {
      values.set(key, value);
    }
  }
  return values;
}

function repoDotEnv(): Map<string, string> {
  const path = repoPath(".env");
  if (!existsSync(path)) {
    return new Map();
  }
  try {
    return parseDotEnv(readFileSync(path, "utf8"));
  } catch {
    return new Map();
  }
}

export function resolveProfilePath(): string | null {
  const fromEnv =
    process.env.ZOTERO_PLUGIN_PROFILE_PATH?.trim() ||
    repoDotEnv().get("ZOTERO_PLUGIN_PROFILE_PATH")?.trim();
  return fromEnv || null;
}

export function readHttpServerPort(profilePath: string): number | null {
  const prefsPath = join(profilePath, "prefs.js");
  if (!existsSync(prefsPath)) {
    return null;
  }
  try {
    const prefs = readFileSync(prefsPath, "utf8");
    const match = prefs.match(
      /user_pref\("extensions\.zotero\.httpServer\.port",\s*(\d+)\)/,
    );
    if (!match) {
      return null;
    }
    const port = Number(match[1]);
    return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
  } catch {
    return null;
  }
}

export interface LocalApiBase {
  baseUrl: string;
  source: "explicit" | "profile" | "default" | "fallback";
  port: number;
}

export function resolveLocalApiBases(): LocalApiBase[] {
  const explicit =
    process.env.ZOTERO_LOCAL_API_URL?.trim() ||
    repoDotEnv().get("ZOTERO_LOCAL_API_URL")?.trim();
  if (explicit) {
    const baseUrl = explicit.endsWith("/") ? explicit : `${explicit}/`;
    return [
      {
        baseUrl,
        source: "explicit",
        port: Number(new URL(baseUrl).port || 80),
      },
    ];
  }

  const profile = resolveProfilePath();
  const profilePort = profile ? readHttpServerPort(profile) : null;
  const candidates: LocalApiBase[] = [];
  if (profilePort) {
    candidates.push({
      baseUrl: `http://127.0.0.1:${profilePort}/api/`,
      source: "profile",
      port: profilePort,
    });
  }
  for (const port of [DEFAULT_LOCAL_API_PORT, FALLBACK_LOCAL_API_PORT]) {
    if (!candidates.some((candidate) => candidate.port === port)) {
      candidates.push({
        baseUrl: `http://127.0.0.1:${port}/api/`,
        source: "fallback",
        port,
      });
    }
  }
  return candidates;
}

export function resolveLocalApiBase(): LocalApiBase {
  return resolveLocalApiBases()[0];
}
