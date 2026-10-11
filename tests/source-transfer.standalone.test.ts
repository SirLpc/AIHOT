import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { exportSourceDefinitions, planSourceImport } from "../packages/backend/src/admin/source-definitions.ts";

const source = (id = "unity-rss", extra = {}) => ({
  id, name: "Unity 国际版", kind: "rss", config: { feedUrl: `https://example.com/${id}.xml` },
  tags: ["engine:unity_global"], tier: "T1", owner_entity_id: "unity-technologies", signal_group_id: null,
  participation_mode: "editorial", interval_minutes: 360, site_fulltext: false, syndicate_fulltext: false, ...extra,
});
const document = (sources: unknown[]) => ({ format: "source-definitions", version: 1, sources });

test("portable export retains product/provenance configuration without runtime fields", () => {
  const input = source("unity-rss", { enabled: true, cursor: { token: "runtime-secret" }, last_error: "runtime-secret", first_party: false, config: {
    feedUrl: "https://example.com/feed.xml", publisherRole: "organization", publisherUrlPrefixes: ["https://example.com/"],
    publishedAfter: "2026-10-01T00:00:00Z", _aihot: { initialBackfillLimit: 6 },
  } });
  const out = exportSourceDefinitions([input]);
  assert.equal(out.format, "source-definitions");
  assert.equal(out.version, 1);
  assert.equal(out.sources[0].owner_entity_id, "unity-technologies");
  assert.deepEqual(out.sources[0].tags, ["engine:unity_global"]);
  assert.deepEqual(out.sources[0].config, input.config);
  assert.doesNotMatch(JSON.stringify(out), /runtime-secret|enabled|cursor|last_error|first_party/);
  assert.equal(planSourceImport(out, []).preview.counts.new, 1);
});

test("every seeded source round-trips except explicitly redacted request headers", () => {
  const seeded = JSON.parse(readFileSync(new URL("../industry/sources.json", import.meta.url), "utf8")).sources;
  const out = exportSourceDefinitions(seeded);
  assert.equal(out.sources.length, 7);
  for (const row of out.sources) {
    const original = seeded.find((s: { id: string }) => s.id === row.id);
    assert.deepEqual(row.tags, original.tags);
    assert.equal(row.owner_entity_id, original.owner_entity_id);
    const result = planSourceImport(document([row]), []).preview;
    assert.equal(result.counts.invalid, original.config.headers ? 1 : 0);
  }
});

test("export allowlist omits credentials in headers, bodies, URLs, nested and unknown fields", () => {
  const out = exportSourceDefinitions([source("private-json", { kind: "json_list", config: {
    url: "https://user:secret-pass@example.com/api?api_key=secret-query", headers: { Authorization: "Bearer secret-header" },
    bodyJson: { nested: { token: "secret-body" } }, token: "secret-unknown", titlePaths: ["title"],
    detail: { adapter: "tuanjie_release", secret: "secret-nested" }, urlTemplate: "https://example.com/{id}?token=secret-template",
  } })]);
  assert.doesNotMatch(JSON.stringify(out), /secret-pass|secret-query|secret-header|secret-body|secret-unknown|secret-nested|secret-template/);
  assert.deepEqual(out.sources[0].config, { titlePaths: ["title"] });
  assert.ok(out.sources[0].redacted_fields!.includes("config.headers"));
  assert.equal(planSourceImport(out, []).preview.canApply, false);
});

test("export treats prototype property names as unsupported data", () => {
  const config = JSON.parse('{"feedUrl":"https://example.com/feed","constructor":"private-secret","__proto__":{"token":"private-secret"}}');
  const out = exportSourceDefinitions([source("prototype-rss", { config })]);
  assert.deepEqual(out.sources[0].config, { feedUrl: "https://example.com/feed" });
  assert.doesNotMatch(JSON.stringify(out), /private-secret/);
  assert.ok(out.sources[0].redacted_fields?.length);
});

test("preview distinguishes new, existing identities, conflicting IDs and file duplicates without mutation", () => {
  const existing = source("already-exists");
  const input = document([source(), existing, source("already-exists", { name: "Changed" }),
    source("same-feed", { config: existing.config }), source(), source("next-rss")]);
  const before = JSON.stringify(input);
  const plan = planSourceImport(input, [existing]);
  assert.deepEqual(plan.preview.rows.map((r) => r.status), ["new", "duplicate", "conflict", "duplicate", "duplicate", "new"]);
  assert.deepEqual(plan.preview.counts, { new: 2, duplicate: 3, conflict: 1, invalid: 0 });
  assert.deepEqual(plan.sources.map((s) => s.id), ["unity-rss", "next-rss"]);
  assert.equal(plan.preview.canApply, true);
  assert.equal(JSON.stringify(input), before);
});

test("invalid rows block apply, and errors never echo the submitted credential values", () => {
  for (const bad of [null, [], source("BAD ID"), source("bad-rss", { config: {} }),
    source("bad-rss", { enabled: true }), source("bad-rss", { config: { feedUrl: "file:///etc/passwd" } }),
    source("bad-rss", { config: { feedUrl: "https://example.com/?token=private-secret" } }),
    source("bad-rss", { config: { feedUrl: "https://example.com/", detail: { maxFetches: "all" } } }),
    source("bad-rss", { config: { feedUrl: "https://example.com/", _aihot: { initialBackfillLimit: -1 } } }),
    source("bad-rss", { interval_minutes: 0 }), source("bad-rss", { tags: Array(31).fill("tag") }),
    source("bad-rss", { redacted_fields: ["config.headers"] })]) {
    const preview = planSourceImport(document([source(), bad]), []).preview;
    assert.equal(preview.counts.invalid, 1);
    assert.equal(preview.canApply, false);
    assert.doesNotMatch(JSON.stringify(preview), /private-secret/);
  }
});

test("preview validates public HTTP URLs without DNS or requests", () => {
  for (const url of ["http://127.0.0.1/", "http://[::1]/", "http://169.254.169.254/", "http://localhost/", "http://localhost./", "https://example.internal/", "https://user:pass@example.com/"]) {
    assert.equal(planSourceImport(document([source("blocked-rss", { config: { feedUrl: url } })]), []).preview.counts.invalid, 1, url);
  }
  assert.equal(planSourceImport(document([source("good-rss", { config: { feedUrl: "https://does-not-resolve.invalid/feed?per_page=10" } })]), []).preview.counts.new, 1);
  assert.equal(planSourceImport(document([source("ipv6-rss", { config: { feedUrl: "https://[2606:4700:4700::1111]/feed" } })]), []).preview.counts.new, 1);
  assert.equal(planSourceImport(document([source("proxy-rss", { config: { feedUrl: "https://r.jina.ai/http://127.0.0.1/feed" } })]), []).preview.counts.invalid, 1);
});

test("portable config rejects malformed regular expressions", () => {
  const preview = planSourceImport(document([source("regex-rss", { config: { feedUrl: "https://example.com/feed", detail: { publishedAtRegex: "(" } } })]), []).preview;
  assert.equal(preview.counts.invalid, 1);
});

test("HTML window variables must be JavaScript identifiers usable by the collector", () => {
  const config = { url: "https://example.com/releases", mode: "html_window_var", windowVar: "(", titlePaths: ["name"], urlTemplate: "{raw:url}" };
  assert.equal(planSourceImport(document([source("window-json", { kind: "json_list", config })]), []).preview.counts.invalid, 1);
  assert.equal(planSourceImport(document([source("window-json", { kind: "json_list", config: { ...config, windowVar: "__props__" } })]), []).preview.counts.new, 1);
});

test("document schema and limits reject unsupported versions, counts and oversize documents", () => {
  for (const invalid of [[], {}, { ...document([]), version: 2 }, { ...document([]), unknown: true },
    document(Array.from({ length: 501 }, (_, n) => source(`source-${n}`))), document([source("large-rss", { name: "字".repeat(180000) })])]) {
    assert.throws(() => planSourceImport(invalid, []), (e: { statusCode?: number }) => e.statusCode === 400 || e.statusCode === 413);
  }
});

test("preview hash changes with the exact requested definition or changed conflicts", () => {
  const input = document([source()]);
  const a = planSourceImport(input, []).preview.previewHash;
  assert.equal(planSourceImport(input, []).preview.previewHash, a);
  assert.notEqual(planSourceImport(document([source("unity-rss", { name: "Changed" })]), []).preview.previewHash, a);
  assert.notEqual(planSourceImport(input, [source()]).preview.previewHash, a);
});
