import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import type { AdminRuns, BeforeJson } from "@aihot/contracts/admin";
import { startWebServer, type WebServer } from "./web-server.ts";

const at = "2026-10-10T00:00:00Z";
const runs: BeforeJson<AdminRuns> = {
  checkedAt: at, queueStatus: "uninitialized", processes: [], jobs: [], timeline: [], queues: [], failedJobs: [],
  grouping: { waiting: 1, needsAttention: 1, items: [{ articleId: "waiting", title: "Waiting article", since: at,
    failed: false, recovery: "unavailable", receiptId: null, error: null }] },
  lagging: [], receipts: { counts: { unknown: 1 }, issues: [{ id: 1, service: "fixture", model: null, purpose: "test",
    subject: null, status: "unknown", attempts: 1, error: null, created_at: at, updated_at: at }] },
  deliveries: [], errors: [{ error: "fixture failure", n: 1, last: at, example: "waiting" }],
  retrying: { count: 0, next: null }, ingest: [], modules: {},
};
const api = createServer((req, res) => {
  const path = new URL(req.url!, "http://local").pathname;
  res.setHeader("content-type", "application/json");
  if (path === "/api/admin/runs") return res.end(JSON.stringify(runs));
  if (path === "/api/admin/me") return res.end(JSON.stringify({ name: "Fixture admin", csrf: "fixture", dev: true }));
  if (path === "/api/admin/nav-counts" || path === "/api/site/meta") return res.end("{}");
  res.statusCode = 404;
  res.end("{}");
});
let web: WebServer;
before(async () => { web = await startWebServer(api); });
after(async () => { await web?.stop(); });

for (const state of ["uninitialized", "incomplete"] as const) {
  test(`SSR explains ${state} queues, preserves statistics and disables queue-dependent recovery`, async () => {
    runs.queueStatus = state;
    const response = await fetch(`${web.origin}/admin/runs`);
    assert.equal(response.status, 200);
    const html = (await response.text()).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
    assert.match(html, new RegExp(state === "uninitialized" ? "队列尚未初始化" : "队列初始化不完整"));
    assert.match(html, /仅启动 API.*Web/);
    assert.match(html, /Waiting article/);
    assert.match(html, /队列不可用，等待确认/);
    assert.doesNotMatch(html, /队列是空的|自动处理中/);
    for (const label of ["全部重新处理", "重新处理", "核对"]) {
      assert.match(html, new RegExp(`<button[^>]*disabled=""[^>]*>${label}</button>`));
    }
  });
}

test("SSR ready queue retains empty-state wording and enabled recovery controls", async () => {
  runs.queueStatus = "ready";
  runs.grouping.items[0]!.recovery = "automatic";
  const html = (await (await fetch(`${web.origin}/admin/runs`)).text()).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
  assert.match(html, /队列是空的/);
  assert.match(html, /自动处理中/);
  assert.doesNotMatch(html, /队列尚未初始化|队列初始化不完整/);
  assert.match(html, /<button(?![^>]*\sdisabled=)[^>]*>全部重新处理<\/button>/);
  assert.match(html, /<button(?![^>]*\sdisabled=)[^>]*>核对<\/button>/);
});

test("SSR distinguishes skipped report windows from generated issues and preserves mixed failures", async () => {
  for (const status of ["ok", "failed"] as const) {
    const outcome = { generated: [], skipped: [{ report: "monthly:2026-09", reason: "no_content" as const }],
      failed: status === "failed" ? ["daily:2026-10-11"] : [] };
    runs.jobs = [{ job: "reports.compose", started_at: at, finished_at: at, status, error: status === "failed" ? "real report failure" : null,
      failed_24h: status === "failed" ? 1 : 0, runs_24h: 1, report_outcome: outcome }];
    runs.timeline = [{ id: 1, ...runs.jobs[0]! }];
    const html = (await (await fetch(`${web.origin}/admin/runs`)).text()).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
    assert.match(html, /monthly:2026-09/);
    assert.match(html, /无内容跳过/);
    if (status === "ok") assert.match(html, /skipped: no content/);
    else {
      assert.match(html, />failed</);
      assert.match(html, /daily:2026-10-11/);
      assert.doesNotMatch(html, />skipped: no content</);
    }
  }
});
