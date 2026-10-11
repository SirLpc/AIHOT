import { normalizeUrl } from "../lib/url.ts";

/** The address a source collects from, shared by creation, edits and portable imports. */
export function sourceIdentity(kind: string, config: Record<string, unknown>): string | null {
  const raw = (config.feedUrl ?? config.url ?? config.listUrl ?? config.endpoint ?? null) as string | null;
  if (kind === "x_search") {
    const m = /from:([A-Za-z0-9_]{1,15})/.exec(String(config.query ?? ""));
    return m ? `x:${m[1]!.toLowerCase()}` : null;
  }
  if (kind === "mp_account") {
    const id = String(config.ghid ?? config.wxid ?? "").trim().toLowerCase();
    return id ? `mp:${id}` : null;
  }
  if (!raw) return null;
  return normalizeUrl(String(raw).replace(/^https:\/\/r\.jina\.ai\//, "")) ?? String(raw);
}
