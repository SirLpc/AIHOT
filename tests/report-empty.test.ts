// Empty/pre-start periods are retryable skips, never empty publications or paid requests.
// Missing inputs caused by unfinished analysis or unhealthy collection remain failures.
import { editionAt, stub, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { getBoss, recordRun, stopBoss } from "@aihot/backend/jobs/queue";
import { composeDaily, composeDueReports, composeMonthly, composeWeekly } from "@aihot/backend/reports/compose";
import { collectFindings } from "@aihot/backend/operations/alerts";
import { runsOverview } from "@aihot/backend/admin/runs";
import { installModules } from "@aihot/backend/modules";

const SOURCE = `empty-report-${tag()}`;
const END = editionAt("daily", "2026-10-11");
const provider = await stub(() => ({ choices: [{ message: { content: '{"overview":"本期更新。","sections":{}}' } }] }));
process.env.DEEPSEEK_BASE_URL = `${provider.url}/v1`;
process.env.DEEPSEEK_API_KEY = "test-key";
process.env.FEISHU_INTERNAL_ENABLED = "false";
before(async () => {
  await getBoss(); // Initialize test queue tables; no business worker is started.
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode) VALUES (${SOURCE}, 'Empty reports', 'rss', 'T1', 'editorial')`;
  installModules([{ name: "fixture", admin: { currentJobs: async () => ["reports.compose"] } }]);
});
beforeEach(async () => {
  await sql`DELETE FROM reports`;
  await sql`DELETE FROM articles WHERE source_id = ${SOURCE}`;
  await sql`DELETE FROM job_runs`;
  await sql`UPDATE sources SET created_at = ${END}, config = '{}', health = 'ok', fail_count = 0,
    last_ok_at = ${END}, last_error = NULL WHERE id = ${SOURCE}`;
});
after(async () => { await provider.close(); await stopBoss(); await closeDb(); });

async function item(date: string, state = "analyzed", selected = true) {
  const id = `empty-item-${tag()}`;
  const at = editionAt("daily", date, -3600);
  await sql`INSERT INTO articles (id, source_id, identity_key, url, title, discovered_at, timeline_at, processing_state)
    VALUES (${id}, ${SOURCE}, ${id}, 'https://example.com/report', ${id}, ${at}, ${at}, ${state})`;
  if (state === "analyzed") await sql`INSERT INTO publications
    (article_id, source_id, title, url, channel, discovered_at, timeline_at, sort_at, visible_after, visibility, eligible, selected, score)
    VALUES (${id}, ${SOURCE}, ${id}, 'https://example.com/report', 'news', ${at}, ${at}, ${at}, ${at}, 'public', true, ${selected}, 90)`;
  return id;
}

test("fresh-install daily, weekly and monthly periods skip without publication or provider calls", async () => {
  const calls = provider.hits();
  const [before] = await sql`SELECT count(*)::int AS n FROM receipts`;
  for (const [compose, key] of [[composeDaily, "2026-10-11"], [composeWeekly, "2026-W40"], [composeMonthly, "2026-09"]] as const) {
    const result = await compose(key);
    assert.equal(result.status, "skipped");
    assert.equal(result.reason, "no_content");
  }
  assert.equal((await sql`SELECT 1 FROM reports`).length, 0);
  assert.equal((await sql`SELECT count(*)::int AS n FROM receipts`)[0]!.n, before!.n);
  assert.equal(provider.hits(), calls);
});

test("publishedAfter equal to the window end is pre-start, even if the source was created earlier", async () => {
  await sql`UPDATE sources SET created_at = '2026-10-01', config = ${sql.json({ publishedAfter: END.toISOString() })},
    health = 'unknown', last_ok_at = NULL WHERE id = ${SOURCE}`;
  assert.equal((await composeDaily("2026-10-11")).status, "skipped");
});

test("a healthy collection window with no arrivals skips, but a judged quiet day still publishes", async () => {
  await sql`UPDATE sources SET created_at = '2026-10-01' WHERE id = ${SOURCE}`;
  assert.equal((await composeDaily("2026-10-11")).status, "skipped");
  await item("2026-10-11", "analyzed", false);
  assert.equal((await composeDaily("2026-10-11")).status, "generated");
  assert.equal((await sql`SELECT content->'metrics'->>'totalEvents' AS n FROM reports`)[0]!.n, "0");
});

test("unfinished or failed analysis is not mislabeled as no content", async () => {
  for (const state of ["new", "failed"]) {
    await sql`DELETE FROM articles WHERE source_id = ${SOURCE}`;
    await item("2026-10-11", state);
    await assert.rejects(composeDaily("2026-10-11"), /upstream.*article/);
  }
  assert.equal((await sql`SELECT 1 FROM reports`).length, 0);
});

test("a failed analysis with an unpublished projection remains a failure", async () => {
  const id = await item("2026-10-11");
  await sql`UPDATE articles SET processing_state = 'failed' WHERE id = ${id}`;
  await sql`UPDATE publications SET selected = false, eligible = false, score = NULL WHERE article_id = ${id}`;
  await assert.rejects(composeDaily("2026-10-11"), /upstream.*article/);
});

test("historical backfill and terminal editorial rejection do not create an empty report or a failure", async () => {
  const historical = await item("2026-10-11", "failed");
  await sql`UPDATE articles SET backfill = true WHERE id = ${historical}`;
  await item("2026-10-11", "blocked");
  assert.equal((await composeDaily("2026-10-11")).status, "skipped");
  assert.equal((await sql`SELECT 1 FROM reports`).length, 0);
});

test("failed or unconfirmed collection remains a real report failure", async () => {
  await sql`UPDATE sources SET created_at = '2026-10-01', health = 'failing', fail_count = 2 WHERE id = ${SOURCE}`;
  await assert.rejects(composeDaily("2026-10-11"), /upstream.*collection/);
  await sql`UPDATE sources SET health = 'unknown', fail_count = 0, last_ok_at = NULL WHERE id = ${SOURCE}`;
  await assert.rejects(composeDaily("2026-10-11"), /upstream.*collection/);
});

test("a success near the window start cannot hide collection stalled through the cutoff", async () => {
  await sql`UPDATE sources SET created_at = '2026-10-01', interval_minutes = 30,
    last_ok_at = ${editionAt("daily", "2026-10-10", 60)} WHERE id = ${SOURCE}`;
  await assert.rejects(composeDaily("2026-10-11"), /upstream.*collection/);
  await sql`UPDATE sources SET last_ok_at = ${editionAt("daily", "2026-10-11", -15 * 60)} WHERE id = ${SOURCE}`;
  assert.equal((await composeDaily("2026-10-11")).status, "skipped", "recent successful collection is enough");
});

test("a scored candidate with failed grouping cannot be published as a quiet issue", async () => {
  const id = await item("2026-10-11", "analyzed", false);
  await sql`UPDATE publications SET selection_candidate = true WHERE article_id = ${id}`;
  await sql`UPDATE articles SET grouping_status = 'failed' WHERE id = ${id}`;
  await assert.rejects(composeDaily("2026-10-11"), /upstream.*article/);
  assert.equal((await sql`SELECT 1 FROM reports`).length, 0);
});

test("an editorially withdrawn grouping candidate does not block an empty public edition", async () => {
  const id = await item("2026-10-11", "analyzed", false);
  await sql`UPDATE publications SET selection_candidate = true, visibility = 'withdrawn' WHERE article_id = ${id}`;
  await sql`UPDATE articles SET grouping_status = 'failed' WHERE id = ${id}`;
  assert.equal((await composeDaily("2026-10-11")).status, "skipped");
});

test("imported historical dailies do not open new paid weekly or monthly catch-up", async () => {
  const id = await item("2026-09-01");
  await composeDaily("2026-09-01");
  await sql`UPDATE articles SET backfill = true WHERE id = ${id}`;
  await sql`UPDATE publications SET backfill = true WHERE article_id = ${id}`;
  await sql`UPDATE reports SET origin = 'imported' WHERE kind = 'daily'`;
  await sql`UPDATE sources SET last_ok_at = ${editionAt("daily", "2026-11-01")} WHERE id = ${SOURCE}`;
  const calls = provider.hits();
  const result = await composeDueReports(editionAt("monthly", "2026-11-01", 3600));
  assert.equal(provider.hits(), calls);
  assert.ok(!result.generated.some((key) => key.startsWith("weekly:") || key.startsWith("monthly:")));
});

test("an empty weekly with missing eligible daily content still fails before any model call", async () => {
  await item("2026-10-01");
  const calls = provider.hits();
  await assert.rejects(composeWeekly("2026-W40"), /daily 2026-10-01.*missing/);
  assert.equal(provider.hits(), calls);
});

test("a skipped period can publish when eligible content arrives, including after its due key advances", async () => {
  const first = await composeDueReports(new Date(END.getTime() + 3600_000));
  assert.equal(first.skipped.length, 3);
  assert.deepEqual(first.generated, []);
  await item("2026-10-11");
  await sql`UPDATE sources SET last_ok_at = ${editionAt("daily", "2026-10-12")} WHERE id = ${SOURCE}`;
  const later = await composeDueReports(editionAt("weekly", "2026-10-12", 3600));
  assert.ok(later.generated.includes("daily:2026-10-11"));
  assert.ok(later.generated.includes("weekly:2026-W41"));
  assert.equal((await sql`SELECT count(*)::int AS n FROM reports WHERE kind = 'daily' AND key = '2026-10-11'`)[0]!.n, 1);
});

test("a skipped monthly remains eligible after a missing daily is later composed", async () => {
  assert.equal((await composeMonthly("2026-09")).status, "skipped");
  await item("2026-09-30");
  await composeDaily("2026-09-30");
  await sql`UPDATE sources SET last_ok_at = ${editionAt("daily", "2026-11-01")} WHERE id = ${SOURCE}`;
  const result = await composeDueReports(editionAt("monthly", "2026-11-01", 3600));
  assert.ok(result.generated.includes("monthly:2026-09"));
});

test("skips are recorded and readable without becoming generated reports", async () => {
  const result = await recordRun("reports.compose", () => composeDueReports(new Date(END.getTime() + 3600_000)));
  assert.deepEqual(result.failed, []);
  assert.deepEqual(result.generated, []);
  assert.equal(result.skipped.length, 3);
  const runs = await runsOverview();
  assert.equal(runs.jobs[0]!.status, "ok");
  assert.deepEqual(runs.jobs[0]!.report_outcome, result);
  assert.deepEqual(runs.timeline[0]!.report_outcome, result);
});

test("mixed skipped and real failures remain failed with both outcomes recorded", async () => {
  await item("2026-10-11", "failed");
  await assert.rejects(recordRun("reports.compose", () => composeDueReports(new Date(END.getTime() + 3600_000))), /daily:2026-10-11/);
  const [run] = await sql`SELECT status, detail FROM job_runs WHERE job = 'reports.compose'`;
  assert.equal(run!.status, "failed");
  assert.deepEqual(run!.detail.failed, ["daily:2026-10-11"]);
  assert.deepEqual(run!.detail.skipped.map((entry: { report: string }) => entry.report), ["weekly:2026-W40", "monthly:2026-09"]);
});

test("missing-daily alerts exclude expected empty periods and return when content or upstream trouble appears", async () => {
  const now = new Date(END.getTime() + 3 * 3600_000).getTime();
  const daily = async () => (await collectFindings(now)).filter((finding) => finding.key === "report.daily");
  assert.equal((await daily()).length, 0);
  await item("2026-10-11");
  assert.equal((await daily()).length, 1, "eligible content without a daily must still alert");
  await sql`DELETE FROM articles WHERE source_id = ${SOURCE}`;
  await sql`UPDATE sources SET created_at = '2026-10-01', health = 'failing', fail_count = 3 WHERE id = ${SOURCE}`;
  const findings = await collectFindings(now);
  assert.ok(findings.some((finding) => finding.key === "report.daily"));
  assert.ok(findings.some((finding) => finding.key === "sources.failing.editorial"), "source alerts are not suppressed");
});
