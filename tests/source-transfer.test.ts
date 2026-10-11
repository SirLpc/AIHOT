import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { config } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { buildApp } from "../apps/api/src/app.ts";

const app = await buildApp();
const T = tag();
const source = (id: string, extra = {}) => ({ id: `${id}-${T}`, name: `Source ${id}`, kind: "rss",
  config: { feedUrl: `https://example.com/${id}-${T}.xml`, publishedAfter: "2026-10-01T00:00:00Z" },
  tier: "T1", owner_entity_id: "unity-technologies", signal_group_id: "unity", tags: ["engine:unity_global"],
  participation_mode: "editorial", interval_minutes: 360, site_fulltext: false, syndicate_fulltext: false, ...extra });
const document = (sources: unknown[]) => ({ format: "source-definitions", version: 1, sources });
const headers = { "x-csrf-token": "dev" };
const post = (url: string, payload: Record<string, unknown>) => app.inject({ method: "POST", url: `/api/admin/sources/${url}`, headers, payload });
const preview = (input: unknown) => post("import/preview", { document: input });
const apply = (input: unknown, previewHash: string) => post("import", { document: input, previewHash });
beforeEach(() => { config.devAdmin = { displayName: "Transfer test" }; });
after(async () => { await app.close(); await stopBoss(); await closeDb(); });

test("source transfer endpoints require admin authentication and CSRF", async () => {
  config.devAdmin = null;
  for (const [method, url] of [["GET", "export"], ["POST", "import/preview"], ["POST", "import"]] as const) {
    const response = await app.inject({ method, url: `/api/admin/sources/${url}`, ...(method === "POST" ? { payload: {} } : {}) });
    assert.equal(response.statusCode, 401);
    assert.equal(response.headers["cache-control"], "no-store");
  }
  config.devAdmin = { displayName: "Transfer test" };
  for (const url of ["import/preview", "import"]) {
    const response = await app.inject({ method: "POST", url: `/api/admin/sources/${url}`, payload: {} });
    assert.equal(response.statusCode, 403);
  }
});

test("preview writes nothing; explicit import creates paused rows and audit atomically", async () => {
  const s = source("first");
  const input = document([s]);
  const p = await preview(input);
  assert.equal(p.statusCode, 200, p.body);
  assert.equal(p.json().counts.new, 1);
  assert.equal((await sql`SELECT 1 FROM sources WHERE id = ${s.id}`).length, 0);
  const r = await apply(input, p.json().previewHash);
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual(r.json(), { created: [s.id], skipped: 0 });
  const [row] = await sql`SELECT * FROM sources WHERE id = ${s.id}`;
  assert.equal(row.enabled, false); assert.equal(row.health, "paused");
  assert.equal(row.next_fetch_at, null); assert.equal(row.cursor, null); assert.equal(row.first_party, true);
  assert.equal(row.owner_entity_id, s.owner_entity_id); assert.equal(row.signal_group_id, s.signal_group_id);
  assert.deepEqual(row.tags, s.tags); assert.deepEqual(row.config, s.config);
  assert.equal((await sql`SELECT 1 FROM fetch_runs WHERE source_id = ${s.id}`).length, 0);
  const audits = await sql`SELECT action, after FROM audit_log WHERE subject = ${`source:${s.id}`}`;
  assert.equal(audits.length, 1); assert.equal(audits[0].action, "source.import");
  assert.equal(audits[0].after.enabled, false);
  const repeated = await apply(input, p.json().previewHash);
  assert.equal(repeated.statusCode, 409);
  assert.equal((await sql`SELECT 1 FROM audit_log WHERE subject = ${`source:${s.id}`}`).length, 1);
});

test("export supports all and selected IDs, omits credentials/runtime and refuses unknown IDs", async () => {
  const id = `export-${T}`;
  await sql`INSERT INTO sources (id, name, kind, config, cursor, last_error) VALUES (${id}, 'Private feed', 'json_list',
    ${sql.json({ url: "https://example.com/api?token=super-private", headers: { Authorization: "super-private" }, bodyJson: { key: "super-private" } })},
    ${sql.json({ cursor: "super-private" })}, 'super-private')`;
  const selected = await app.inject({ url: `/api/admin/sources/export?ids=${id}` });
  assert.equal(selected.statusCode, 200, selected.body);
  assert.match(String(selected.headers["content-disposition"]), /attachment/);
  assert.equal(selected.headers["cache-control"], "no-store");
  assert.deepEqual(selected.json().sources.map((r: { id: string }) => r.id), [id]);
  assert.doesNotMatch(selected.body, /super-private|cursor|last_error|enabled/);
  assert.ok(selected.json().sources[0].redacted_fields.length >= 3);
  const all = await app.inject({ url: "/api/admin/sources/export" });
  assert.equal(all.statusCode, 200);
  assert.ok(all.json().sources.length >= 2);
  assert.equal((await app.inject({ url: `/api/admin/sources/export?ids=missing-${T}` })).statusCode, 400);
  assert.equal((await app.inject({ url: "/api/admin/sources/export?ids=" })).statusCode, 400);
  assert.equal((await app.inject({ url: `/api/admin/sources/export?ids=${id}&ids=${id}` })).statusCode, 400);
});

test("existing rows are unchanged; invalid mixed documents cannot partially apply", async () => {
  const existing = source("first");
  const [before] = await sql`SELECT * FROM sources WHERE id = ${existing.id}`;
  const next = source("second");
  const input = document([{ ...existing, name: "Do not overwrite" }, next]);
  const p = await preview(input);
  assert.equal(p.json().counts.conflict, 1);
  assert.equal((await apply(input, p.json().previewHash)).statusCode, 200);
  const [after] = await sql`SELECT * FROM sources WHERE id = ${existing.id}`;
  assert.deepEqual(after, before);
  const invalid = document([source("invalid-batch-good"), source("bad", { interval_minutes: -1 })]);
  const badPreview = await preview(invalid);
  assert.equal(badPreview.json().canApply, false);
  assert.equal((await apply(invalid, badPreview.json().previewHash)).statusCode, 400);
  assert.equal((await sql`SELECT 1 FROM sources WHERE id = ${source("invalid-batch-good").id}`).length, 0);
});

test("apply requires the exact preview and refuses changed or concurrently claimed identities", async () => {
  const s = source("concurrent");
  const input = document([s]);
  const p = await preview(input);
  assert.equal((await apply(input, "")).statusCode, 400);
  assert.equal((await apply(document([{ ...s, name: "Changed after preview" }]), p.json().previewHash)).statusCode, 409);
  const results = await Promise.all([apply(input, p.json().previewHash), apply(input, p.json().previewHash)]);
  assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 409]);
  assert.equal((await sql`SELECT 1 FROM sources WHERE id = ${s.id}`).length, 1);
  assert.equal((await sql`SELECT 1 FROM audit_log WHERE subject = ${`source:${s.id}`}`).length, 1);
});

test("same-address race with ordinary creation cannot introduce a second source", async () => {
  const incoming = source("identity-race");
  const input = document([incoming]);
  const p = await preview(input);
  const { createSource } = await import("@aihot/backend/admin/sources");
  await createSource({ id: `other-${T}`, name: "Other source", kind: "rss", config: incoming.config }, "test");
  const r = await apply(input, p.json().previewHash);
  assert.equal(r.statusCode, 409);
  assert.equal((await sql`SELECT 1 FROM sources WHERE id = ${incoming.id}`).length, 0);
});

test("oversize import and unsupported document versions are rejected before writes", async () => {
  assert.equal((await preview({ ...document([]), version: 999 })).statusCode, 400);
  const oversized = document([source("oversize", { name: "x".repeat(600000) })]);
  assert.equal((await preview(oversized)).statusCode, 413);
});

test("database failure rolls back the complete batch and its audit trail", async () => {
  const a = source("rollback-first"), b = source("rollback-second", { name: "Force rollback" });
  const input = document([a, b]);
  const p = await preview(input);
  await sql`ALTER TABLE sources ADD CONSTRAINT test_transfer_rollback CHECK (name <> 'Force rollback')`;
  try {
    const { importSources } = await import("@aihot/backend/admin/source-transfer");
    await assert.rejects(importSources({ document: input, previewHash: p.json().previewHash }, "test"), /test_transfer_rollback/);
    assert.equal((await sql`SELECT 1 FROM sources WHERE id IN (${a.id}, ${b.id})`).length, 0);
    assert.equal((await sql`SELECT 1 FROM audit_log WHERE subject IN (${`source:${a.id}`}, ${`source:${b.id}`})`).length, 0);
  } finally { await sql`ALTER TABLE sources DROP CONSTRAINT test_transfer_rollback`; }
});
