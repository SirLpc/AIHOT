// Pure import validation and portable export. No database, DNS, fetching or provider calls.
import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";
import type { AdminSourceImportPreview, PortableSourceDefinition, SourceDefinitionsDocument } from "@aihot/contracts/admin";
import { isBlockedAddress } from "../lib/url.ts";
import { unsupportedConfig } from "../sources/config-keys.ts";
import { sourceIdentity } from "../sources/identity.ts";

export const SOURCE_DOCUMENT_MAX_BYTES = 512 * 1024;
export const SOURCE_DOCUMENT_MAX_ROWS = 500;
export class SourceDocumentError extends Error {
  readonly statusCode: number;
  constructor(message: string, statusCode = 400) { super(message); this.statusCode = statusCode; }
}

// Only harmless, bounded pagination/format query values are portable. Opaque query values, all
// request headers and bodies must be configured locally, so exports cannot carry API credentials.
function publicUrl(value: string): boolean {
  try {
    const u = new URL(value);
    const host = u.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
    if (!/^https?:$/.test(u.protocol) || u.username || u.password || u.hash) return false;
    if (host === "localhost" || /\.(localhost|internal|local)$/.test(host) || (!isIP(host) && !host.includes("."))) return false;
    if (isIP(host) && isBlockedAddress(host)) return false;
    for (const [key, val] of u.searchParams) {
      if (/^(page|per_page|limit|pageSize|page_size|offset)$/.test(key) && /^\d{1,6}$/.test(val)) continue;
      if (/^(format|alt)$/.test(key) && /^(json|rss|atom|xml)$/.test(val)) continue;
      return false;
    }
    if (host === "r.jina.ai") return publicUrl(value.replace(/^https?:\/\/r\.jina\.ai\//, ""));
    return true;
  } catch { return false; }
}
const text = z.string().min(1).max(2000);
const regex = text.refine((value) => { try { new RegExp(value, "i"); return true; } catch { return false; } }, "需要有效的正则表达式");
const strings = z.array(text).max(100);
const url = z.string().max(4096).refine(publicUrl, "需要不含凭据的公开 HTTP(S) 地址");
const urls = z.array(url).max(100);
const integer = z.number().int().min(0).max(10000);
const offset = z.string().regex(/^[+-](?:0\d|1[0-4]):[0-5]\d$/);
const template = z.string().max(4096).refine((v) => /^\{raw:[A-Za-z0-9_.]+\}$/.test(v) || publicUrl(v.replace(/\{(?:raw:)?[A-Za-z0-9_.]+\}/g, "item")), "需要公开 HTTP(S) 地址模板");
const configSchema = z.object({
  publisherRole: z.enum(["organization", "person"]), publisherUrlPrefixes: urls,
  _aihot: z.object({ initialBackfillLimit: integer.optional(), initialBackfillMonths: integer.optional() }).strict(),
  allowUrlPrefixes: urls, denyUrlPrefixes: urls,
  ingestNoiseFilter: z.object({ requireMatches: strings.optional(), dropMarkers: strings.optional(), dropMarkersTitleOnly: strings.optional(), keepIfMatches: strings.optional() }).strict(),
  itemUrlPrefixRewrite: z.object({ from: url, to: url }).strict(),
  sortByPublishedAt: z.boolean(), fetchPublicContent: z.boolean(), publishedAfter: text,
  detail: z.object({ adapter: z.literal("tuanjie_release").optional(), maxFetches: integer.optional(),
    publishedAtSelector: text.optional(), publishedAtRegex: regex.optional(), publishedAtUtcOffset: offset.optional(),
    publishedAtAuthoritative: z.boolean().optional(), upgradeDatePrecision: z.boolean().optional(),
    titleSelector: text.optional(), titleRegex: regex.optional(), titleAuthoritative: z.boolean().optional(), summarySelector: text.optional(),
  }).strict(),
  feedUrl: url, summaryIsBody: z.boolean(), preserveUrlFragment: z.boolean(), allowCategories: strings, denyCategories: strings,
  url, baseUrl: url, parseMode: z.enum(["html", "markdown", "docusaurus_changelog", "intercom_changelog"]),
  adapter: z.enum(["mimo_home", "tuanjie_releases"]), cacheToleranceSeconds: integer, linksStartLine: integer,
  itemSelector: text, linkSelector: text, titleSelector: text, publishedAtSelector: text, publishedAtRegex: regex, publishedAtUtcOffset: offset,
  updatedAtPath: text, mode: z.enum(["json_api", "html_json_key", "html_window_var"]), method: z.literal("GET"),
  jsonKey: text, windowVar: z.string().max(200).regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/), itemsPath: z.string().max(2000), itemsObjectValues: z.boolean(),
  titlePaths: strings, summaryPaths: strings, authorPaths: strings, publishedAtPath: text,
  publishedAtUnit: z.enum(["epoch_s", "epoch_ms", "yyyymmdd"]), externalIdPath: text,
  urlTemplate: template, urlTemplateFallback: template, rawDropKeys: strings,
  requireBoolean: z.object({ path: text, equals: z.boolean() }).strict(), minNumeric: z.object({ path: text, min: z.number() }).strict(),
  query: text, searchType: z.enum(["Latest", "Top"]), wxid: text, ghid: text, nickname: text,
}).partial().strict();
const sourceSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{2,79}$/), name: z.string().trim().min(1).max(200),
  kind: z.enum(["rss", "web_list", "json_list", "x_search", "mp_account", "external"]), config: configSchema,
  tags: z.array(z.string().max(60)).max(30).default([]), owner_entity_id: z.string().max(120).nullable().default(null),
  signal_group_id: z.string().max(120).nullable().default(null), tier: z.enum(["T1", "T1_5", "T2", "EXCLUDE_MP"]).default("T2"),
  participation_mode: z.enum(["editorial", "hot_signal", "isolated"]).default("editorial"),
  interval_minutes: z.number().int().min(1).max(1440).default(30), site_fulltext: z.boolean().default(false), syndicate_fulltext: z.boolean().default(false),
  redacted_fields: z.array(z.string().max(160)).max(100).optional(),
}).strict();
const documentSchema = z.object({
  format: z.literal("source-definitions"), version: z.literal(1), exported_at: z.string().max(80).optional(),
  sources: z.array(z.unknown()).max(SOURCE_DOCUMENT_MAX_ROWS),
}).strict();
const FIELDS = ["id", "name", "kind", "tags", "owner_entity_id", "signal_group_id", "tier", "participation_mode", "interval_minutes", "site_fulltext", "syndicate_fulltext"] as const;

/** Stable field order makes previews insensitive to object key order, but binds all input values. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

export function exportSourceDefinitions(rows: readonly Record<string, unknown>[]): SourceDefinitionsDocument {
  if (rows.length > SOURCE_DOCUMENT_MAX_ROWS) throw new SourceDocumentError("一次最多导出 500 个信源，请按 ID 分批导出");
  const sources = rows.map((row) => {
    const redacted: string[] = [];
    const config: Record<string, unknown> = {};
    for (const [key, value] of Object.entries((row.config ?? {}) as Record<string, unknown>)) {
      const field = Object.hasOwn(configSchema.shape, key) ? configSchema.shape[key as keyof typeof configSchema.shape] : undefined;
      if (!field || !field.safeParse(value).success || unsupportedConfig(row.kind as PortableSourceDefinition["kind"], { [key]: value }).length) {
        redacted.push(field || key === "headers" || key === "bodyJson" ? `config.${key}` : "config (unsupported field)");
      } else config[key] = value;
    }
    const out = Object.fromEntries(FIELDS.map((key) => [key, row[key] ?? (key === "tags" ? [] : key === "owner_entity_id" || key === "signal_group_id" ? null : undefined)]));
    return { ...out, config, ...(redacted.length ? { redacted_fields: [...new Set(redacted)] } : {}) } as PortableSourceDefinition;
  });
  const document: SourceDefinitionsDocument = { format: "source-definitions", version: 1, exported_at: new Date().toISOString(), sources };
  if (Buffer.byteLength(JSON.stringify(document)) > SOURCE_DOCUMENT_MAX_BYTES) throw new SourceDocumentError("导出文件超过 512 KiB，请按 ID 分批导出", 413);
  return document;
}

function sourceProblems(source: PortableSourceDefinition): string[] {
  if (source.redacted_fields?.length) return ["含有已省略的字段，请修复配置并移除 redacted_fields 后重新预览"];
  if (unsupportedConfig(source.kind, source.config).length) return ["配置包含此类型不支持的字段或值"];
  const c = source.config;
  if (source.kind === "rss" && !c.feedUrl) return ["rss 需要 config.feedUrl"];
  if ((source.kind === "web_list" || source.kind === "json_list") && !c.url) return ["需要 config.url"];
  if (source.kind === "x_search" && !c.query) return ["x_search 需要 config.query"];
  if (source.kind === "mp_account" && !c.ghid && !c.wxid) return ["mp_account 需要 config.ghid 或 config.wxid"];
  if (source.kind === "json_list" && c.adapter !== "tuanjie_releases" && (!Array.isArray(c.titlePaths) || !c.titlePaths.length || (!c.urlTemplate && !c.urlTemplateFallback))) return ["json_list 需要 titlePaths 和 URL 模板"];
  if (c.mode === "html_window_var" && !c.windowVar) return ["html_window_var 需要 windowVar"];
  if (c.mode === "html_json_key" && !c.jsonKey) return ["html_json_key 需要 jsonKey"];
  return [];
}

function definition(row: Record<string, unknown>) {
  return { ...Object.fromEntries(FIELDS.map((k) => [k, row[k] ?? (k === "tags" ? [] : k === "owner_entity_id" || k === "signal_group_id" ? null : undefined)])), config: row.config };
}

export function planSourceImport(input: unknown, existing: readonly Record<string, unknown>[]): { preview: AdminSourceImportPreview; sources: PortableSourceDefinition[] } {
  let encoded: string;
  try { encoded = JSON.stringify(input); } catch { throw new SourceDocumentError("文件必须是 JSON 对象"); }
  if (!encoded || Buffer.byteLength(encoded) > SOURCE_DOCUMENT_MAX_BYTES) throw new SourceDocumentError("文件超过 512 KiB", 413);
  const parsed = documentSchema.safeParse(input);
  if (!parsed.success) throw new SourceDocumentError("需要 source-definitions 第 1 版 JSON，最多 500 个信源");
  const counts = { new: 0, duplicate: 0, conflict: 0, invalid: 0 };
  const sources: PortableSourceDefinition[] = [];
  const known = [...existing];
  const rows = parsed.data.sources.map((raw, index): AdminSourceImportPreview["rows"][number] => {
    const row = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const label = { index, id: typeof row.id === "string" ? row.id.slice(0, 80) : "", name: typeof row.name === "string" ? row.name.slice(0, 200) : "" };
    const result = sourceSchema.safeParse(raw);
    const invalid = (messages: string[]): AdminSourceImportPreview["rows"][number] => { counts.invalid++; return { ...label, status: "invalid", messages }; };
    if (!result.success) return invalid([...new Set(result.error.issues.map((issue) => `${issue.path.slice(0, 2).join(".") || "信源"}：格式、值或字段不受支持`))].slice(0, 10));
    const source = result.data as PortableSourceDefinition;
    const problems = sourceProblems(source);
    if (problems.length) return invalid(problems);
    delete source.redacted_fields;
    const sameId = known.find((other) => other.id === source.id);
    if (sameId) {
      const status = canonical(definition(sameId)) === canonical(definition(source as unknown as Record<string, unknown>)) ? "duplicate" : "conflict";
      counts[status]++;
      return { ...label, status, messages: [status === "duplicate" ? "ID 与定义已存在，将跳过" : "ID 已存在且定义不同，将跳过，不覆盖"] };
    }
    const identity = sourceIdentity(source.kind, source.config);
    const duplicate = identity && known.find((other) => other.kind === source.kind && sourceIdentity(String(other.kind), other.config as Record<string, unknown>) === identity);
    if (duplicate) { counts.duplicate++; return { ...label, status: "duplicate", messages: [`采集地址或账号已存在（${String(duplicate.id)}），将跳过`] }; }
    known.push(source as unknown as Record<string, unknown>);
    sources.push(source);
    counts.new++;
    return { ...label, status: "new", messages: ["将新建为暂停状态"] };
  });
  const previewHash = createHash("sha256").update(encoded).update("\0").update(JSON.stringify(rows)).digest("hex");
  return { preview: { rows, counts, canApply: counts.invalid === 0 && counts.new > 0, previewHash }, sources };
}
