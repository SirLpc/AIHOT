// First preview starts only the business schema, API and web. Reading its runs page must not
// initialize pg-boss, hide ordinary statistics or confuse an unavailable queue with an empty one.
import "./setup.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { config } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
import { runsOverview } from "@aihot/backend/admin/runs";
import { getBoss, stopBoss } from "@aihot/backend/jobs/queue";
import { installModules } from "@aihot/backend/modules";
import { buildApp } from "../apps/api/src/app.ts";

process.env.COLLECT_ENABLED = "false";
process.env.MODEL_CALLS_ENABLED = "false";
config.modelCallsEnabled = false; // config is imported after setup's test defaults, before these assignments
const app = await buildApp();
const at = new Date(Date.now() - 20 * 60_000);
before(async () => {
  config.devAdmin = { displayName: "Queue test" };
  config.environmentName = "development";
  installModules([{ name: "fixture", admin: { currentJobs: async () => ["external.fixture"] } }]);
  await sql`INSERT INTO sources (id, name, kind, health) VALUES ('queue-test', 'Queue test', 'rss', 'failing')`;
  await sql`INSERT INTO articles (id, source_id, identity_key, url, title, discovered_at, timeline_at, grouping_status)
    VALUES ('queue-article', 'queue-test', 'queue-article', 'https://example.com/queue', 'Waiting article', ${at}, ${at}, 'pending')`;
  await sql`INSERT INTO publications (article_id, source_id, title, summary, eligible, selected, selection_candidate,
    visibility, selected_ready_at, discovered_at, timeline_at, sort_at, url, category, channel)
    VALUES ('queue-article', 'queue-test', 'Waiting article', 'Summary', true, false, true,
    'public', ${at}, ${at}, ${at}, ${at}, 'https://example.com/queue', 'industry', 'news')`;
  await sql`INSERT INTO receipts (logical_key, service, purpose, status) VALUES ('queue-receipt', 'fixture', 'test', 'unknown')`;
  await sql`INSERT INTO job_runs (job, status, finished_at) VALUES ('external.fixture', 'failed', now()), ('scheduled.fixture', 'ok', now())`;
});
after(async () => { await app.close(); await stopBoss(); await closeDb(); });

test("fresh business schema returns the run overview without creating a queue", async () => {
  for (let read = 0; read < 2; read++) {
    const response = await app.inject({ url: "/api/admin/runs" });
    assert.equal(response.statusCode, 200, response.body);
    const runs = response.json();
    assert.equal(runs.queueStatus, "uninitialized");
    assert.deepEqual(runs.queues, []);
    assert.deepEqual(runs.failedJobs, []);
    assert.deepEqual(runs.jobs.map((job: { job: string }) => job.job), ["external.fixture"]);
    assert.equal(runs.timeline.length, 2);
    assert.equal(runs.lagging[0].id, "queue-test");
    assert.equal(runs.receipts.counts.unknown, 1);
    assert.equal(runs.grouping.waiting, 1);
    assert.equal(runs.grouping.needsAttention, 1);
    assert.equal(runs.grouping.items[0].recovery, "unavailable");
    assert.equal(new Date(runs.grouping.items[0].since).getTime(), at.getTime());
    const [queue] = await sql`SELECT to_regnamespace('pgboss') AS schema`;
    assert.equal(queue!.schema, null, "GET must not initialize pg-boss");
  }
});

test("an existing queue schema without its required tables is incomplete", async () => {
  await sql`CREATE SCHEMA pgboss`;
  try {
    const runs = await runsOverview();
    assert.equal(runs.queueStatus, "incomplete");
    assert.equal(runs.grouping.waiting, 1);
    assert.equal(runs.grouping.items[0]!.recovery, "unavailable");
    const [queue] = await sql`SELECT to_regclass('pgboss.job') AS jobs, to_regclass('pgboss.schedule') AS schedules`;
    assert.deepEqual({ ...queue }, { jobs: null, schedules: null });
  } finally {
    await sql`DROP SCHEMA pgboss`;
  }
});

test("initialized and partially initialized queue states retain their meaning", async (t) => {
  const boss = await getBoss();
  await boss.createQueue("cron.scheduled.fixture");
  await boss.schedule("cron.scheduled.fixture", "0 0 1 1 *");
  await boss.createQueue("events.group");
  await boss.send("events.group", { articleId: "queue-article" }, { startAfter: "2099-01-01", singletonKey: "manual:group:fixture" });
  await boss.createQueue("failed.fixture");
  const failedId = await boss.send("failed.fixture", {}, { startAfter: "2099-01-01" });
  await stopBoss(); // no worker or timer runs during the read-only assertions
  await sql`UPDATE pgboss.job SET state = 'failed', completed_on = now(), output = '{"error":"fixture failed"}'::jsonb WHERE id = ${failedId}`;

  await t.test("ready queues preserve scheduled jobs, backlog and grouping recovery", async () => {
    const runs = await runsOverview();
    assert.equal(runs.queueStatus, "ready");
    assert.deepEqual(runs.jobs.map((job) => job.job), ["external.fixture", "scheduled.fixture"]);
    assert.ok(runs.queues.some((queue) => queue.name === "events.group" && queue.n === 1));
    assert.equal(runs.failedJobs.find((job) => job.name === "failed.fixture")?.failed, 1);
    assert.equal(runs.grouping.items[0]!.recovery, "automatic");
    assert.ok(new Date(runs.grouping.items[0]!.since).getTime() > at.getTime(), "manual regroup timestamp remains authoritative");
  });

  for (const missing of ["job", "schedule"]) {
    await t.test(`missing ${missing} reports incomplete instead of querying partial queue state`, async () => {
      await sql`ALTER TABLE ${sql(`pgboss.${missing}`)} RENAME TO ${sql(`${missing}_test_hidden`)}`;
      try {
        const runs = await runsOverview();
        assert.equal(runs.queueStatus, "incomplete");
        assert.deepEqual(runs.queues, []);
        assert.deepEqual(runs.failedJobs, []);
        assert.deepEqual(runs.jobs.map((job) => job.job), ["external.fixture"]);
        assert.equal(runs.grouping.waiting, 1);
        assert.equal(runs.grouping.items[0]!.recovery, "unavailable");
        assert.equal(runs.receipts.counts.unknown, 1);
      } finally {
        await sql`ALTER TABLE ${sql(`pgboss.${missing}_test_hidden`)} RENAME TO ${sql(missing)}`;
      }
    });
  }

  await t.test("real database faults still reject the overview", async () => {
    await sql`ALTER TABLE articles RENAME COLUMN grouping_status TO grouping_status_test_hidden`;
    try {
      await assert.rejects(runsOverview(), { code: "42703" });
      const response = await app.inject({ url: "/api/admin/runs" });
      assert.equal(response.statusCode, 500);
    } finally {
      await sql`ALTER TABLE articles RENAME COLUMN grouping_status_test_hidden TO grouping_status`;
    }
  });
});
