const ALLOWED_LINK_PROTOCOLS = new Set(["http:", "https:", "doi:", "banyan:"]);

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function escapeAttribute(value: unknown): string {
  return escapeHtml(value);
}

export function sanitizeLink(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const link = value.trim();
  if (!link) {
    return undefined;
  }

  const protocol = getLinkProtocol(link);
  if (!protocol || !ALLOWED_LINK_PROTOCOLS.has(protocol)) {
    return undefined;
  }

  if (protocol === "banyan:" && !parseBanyanEntryLink(link)) {
    return undefined;
  }

  return link;
}

export function parseBanyanEntryLink(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const match = value.trim().match(/^banyan:\/\/entry\/([^/?#]+)$/i);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function getLinkProtocol(link: string): string | undefined {
  const match = link.match(/^([a-z][a-z0-9+.-]*):/i);
  return match ? `${match[1].toLowerCase()}:` : undefined;
}
