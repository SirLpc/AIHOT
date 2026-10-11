import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { after, before, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, expect, type Browser, type Page } from "@playwright/test";
import type { AdminSourceImportPreview, SourceDefinitionsDocument } from "@aihot/contracts/admin";
import { startWebServer, type WebServer } from "./web-server.ts";

const document: SourceDefinitionsDocument = { format: "source-definitions", version: 1, sources: [{ id: "unity-news", name: "Unity 新闻", kind: "rss",
  config: { feedUrl: "https://example.org/feed.xml" }, tags: [], owner_entity_id: null, signal_group_id: null,
  tier: "T2", participation_mode: "editorial", interval_minutes: 30, site_fulltext: false, syndicate_fulltext: false }] };
const preview: AdminSourceImportPreview = { rows: [{ index: 0, id: "unity-news", name: "Unity 新闻", status: "new", messages: [] }],
  counts: { new: 1, duplicate: 0, conflict: 0, invalid: 0 }, canApply: true, previewHash: "fixture-hash" };
const requests: Array<{ path: string; body: unknown; csrf: string | undefined }> = [];
let web: WebServer;
let browser: Browser;
let previewResult = preview;
let previewStatus = 200;
let applyStatus = 200;
let exportStatus = 200;
let exportDocument = document;
let releasePreview: (() => void) | undefined;
let releaseApply: (() => void) | undefined;
let delayPreview = false;
let delayApply = false;
const api = createServer(async (req, res) => {
  const url = new URL(req.url!, "http://local");
  res.setHeader("content-type", "application/json");
  if (url.pathname === "/api/admin/me") return res.end(JSON.stringify({ name: "Fixture admin", csrf: "fixture-csrf", dev: true }));
  if (url.pathname === "/api/admin/nav-counts" || url.pathname === "/api/site/meta") return res.end("{}");
  if (url.pathname === "/api/admin/sources") return res.end(JSON.stringify({ rows: [], totals: { total: 0, enabled: 0, failing: 0, degraded: 0 }, page: 1 }));
  let raw = "";
  for await (const chunk of req) raw += chunk;
  requests.push({ path: req.url!, body: raw ? JSON.parse(raw) : null, csrf: req.headers["x-csrf-token"] as string | undefined });
  if (url.pathname === "/api/admin/sources/export") {
    res.statusCode = exportStatus;
    return res.end(JSON.stringify(exportStatus === 200 ? exportDocument : { detail: "导出失败，请重试" }));
  }
  if (url.pathname === "/api/admin/sources/import/preview") {
    const result = structuredClone(previewResult);
    if (delayPreview) await new Promise<void>((resolve) => { releasePreview = resolve; });
    res.statusCode = previewStatus;
    return res.end(JSON.stringify(previewStatus === 200 ? result : { detail: "校验失败，请重试" }));
  }
  if (url.pathname === "/api/admin/sources/import") {
    if (delayApply) await new Promise<void>((resolve) => { releaseApply = resolve; });
    res.statusCode = applyStatus;
    return res.end(JSON.stringify(applyStatus === 200 ? { created: ["unity-news"], skipped: 0 } : { detail: "信源已变化，请重新校验" }));
  }
  if (url.pathname === "/api/auth/login") return res.end("{}");
  res.statusCode = 404;
  res.end("{}");
});

before(async () => { web = await startWebServer(api); });
async function newPage() {
  browser ??= await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : { channel: "chromium" });
  const page = await browser.newPage();
  // Tests use only the local web/mock API; accidental external requests fail immediately.
  await page.route("**/*", (route) => new URL(route.request().url()).origin === web.origin ? route.continue() : route.abort());
  return page;
}
after(async () => { releasePreview?.(); releaseApply?.(); await browser?.close(); await web?.stop(); });
beforeEach(() => {
  requests.length = 0;
  previewResult = structuredClone(preview);
  exportDocument = document;
  previewStatus = applyStatus = exportStatus = 200;
  delayPreview = delayApply = false;
  releasePreview = releaseApply = undefined;
});

async function openPage() {
  const page = await newPage();
  await page.goto(`${web.origin}/admin/sources/transfer`);
  await expect(page.getByRole("heading", { name: "信源导入 / 导出", exact: true })).toBeVisible();
  return page;
}
async function validate(page: Page) {
  await page.getByLabel("导入 JSON").fill(JSON.stringify(document));
  await page.getByRole("button", { name: "校验导入", exact: true }).click();
  await expect(page.getByRole("button", { name: "确认导入 1 个新信源", exact: true })).toBeEnabled();
}
const hits = (path: string) => requests.filter((request) => request.path.startsWith(path));

test("SSR source transfer is linked and starts with safe, disabled controls", async () => {
  const sources = await (await fetch(`${web.origin}/admin/sources`)).text();
  assert.match(sources, /href="\/admin\/sources\/transfer"[^>]*>导入 \/ 导出/);
  const response = await fetch(`${web.origin}/admin/sources/transfer`);
  assert.equal(response.status, 200);
  const html = (await response.text()).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
  assert.match(html, /信源导入 \/ 导出/);
  assert.match(html, /新信源始终以暂停状态创建/);
  assert.match(html, /不会采集文章/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>确认导入[^<]*<\/button>/);
  assert.equal(requests.length, 0);
});

test("source list links to a validation-only transfer page with apply disabled", async () => {
  const page = await newPage();
  try {
    await page.goto(`${web.origin}/admin/sources?health=paused`);
    await page.getByRole("link", { name: "导入 / 导出", exact: true }).click();
    await expect(page).toHaveURL(`${web.origin}/admin/sources/transfer`);
    await expect(page.getByRole("button", { name: /确认导入/ })).toBeDisabled();
    await expect(page.getByText(/新信源始终以暂停状态创建/)).toBeVisible();
    await expect(page.getByText(/不会采集文章/)).toBeVisible();
    assert.equal(requests.length, 0);
  } finally { await page.close(); }
});

test("exports all or explicit IDs as JSON, independent of the list filter", async () => {
  const page = await openPage();
  try {
    const all = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出全部信源", exact: true }).click();
    const download = await all;
    assert.match(download.suggestedFilename(), /\.json$/);
    const downloaded = await readFile((await download.path())!, "utf8");
    assert.deepEqual(JSON.parse(downloaded), document);
    assert.equal(downloaded, JSON.stringify(document), "export bytes must stay within the same compact JSON limit as import");
    await page.getByLabel("导出的信源 ID").fill("unity-news, unity-lts\nunity-news");
    const selected = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出指定信源", exact: true }).click();
    await selected;
    assert.deepEqual(hits("/api/admin/sources/export").map((request) => request.path), [
      "/api/admin/sources/export", "/api/admin/sources/export?ids=unity-news%2Cunity-lts",
    ]);
    assert.equal(hits("/api/admin/sources/import").length, 0);
  } finally { await page.close(); }
});

test("preview never applies; explicit apply sends the validated document and hash once", async () => {
  const page = await openPage();
  try {
    await validate(page);
    assert.equal(requests.length, 1);
    assert.equal(requests[0]!.csrf, "fixture-csrf");
    assert.deepEqual(requests[0]!.body, { document });
    delayApply = true;
    const apply = page.getByRole("button", { name: "确认导入 1 个新信源", exact: true });
    await apply.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
    await expect.poll(() => hits("/api/admin/sources/import").length).toBe(2);
    await expect(apply).toBeDisabled();
    await expect(page.getByLabel("导入 JSON")).toBeDisabled();
    releaseApply!();
    await expect(page.getByRole("status").filter({ hasText: "已导入" })).toContainText("已导入 1 个新信源");
    await expect(page.getByRole("status").filter({ hasText: "已导入" })).toContainText("暂停");
    await expect(page.getByRole("button", { name: /确认导入/ })).toBeDisabled();
    assert.deepEqual(requests[1]!.body, { document, previewHash: "fixture-hash" });
  } finally { releaseApply?.(); await page.close(); }
});

test("duplicate, conflict and invalid rows explain why unsafe/redacted imports cannot apply", async () => {
  previewResult = { ...preview, rows: [
    { index: 0, id: "unity-news", name: "Unity 新闻", status: "duplicate", messages: ["已存在，跳过"] },
    { index: 1, id: "conflict", name: "冲突源", status: "conflict", messages: ["ID 冲突，跳过"] },
    { index: 2, id: "redacted", name: "脱敏源", status: "invalid", messages: ["存在脱敏字段，请补全后移除 redacted_fields"] },
  ], counts: { new: 0, duplicate: 1, conflict: 1, invalid: 1 }, canApply: false };
  const page = await openPage();
  try {
    await page.getByLabel("导入 JSON").fill(JSON.stringify(document));
    await page.getByRole("button", { name: "校验导入", exact: true }).click();
    await expect(page.getByText("存在脱敏字段，请补全后移除 redacted_fields", { exact: true })).toBeVisible();
    await expect(page.getByText("ID 冲突，跳过", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /确认导入/ })).toBeDisabled();
    assert.equal(requests.length, 1);
  } finally { await page.close(); }
});

test("invalid JSON and over-limit files or pasted bytes fail before any API request", async () => {
  const page = await openPage();
  try {
    await page.getByLabel("导入 JSON").fill("{broken");
    await page.getByRole("button", { name: "校验导入", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("合法 JSON");
    await page.getByLabel("选择 JSON 文件").setInputFiles({ name: "large.json", mimeType: "application/json", buffer: Buffer.alloc(512 * 1024 + 1) });
    await expect(page.getByRole("alert")).toContainText("512 KiB");
    await page.getByLabel("导入 JSON").fill("中".repeat(180_000));
    await page.getByRole("button", { name: "校验导入", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("512 KiB");
    assert.equal(requests.length, 0);
  } finally { await page.close(); }
});

test("editing, choosing a new file and closing the preview invalidate approval", async () => {
  const page = await openPage();
  try {
    await validate(page);
    await page.getByLabel("导入 JSON").fill(JSON.stringify({ ...document, exported_at: "2026-10-11" }));
    await expect(page.getByRole("button", { name: /确认导入/ })).toBeDisabled();
    await validate(page);
    await page.getByLabel("选择 JSON 文件").setInputFiles({ name: "sources.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(document)) });
    await expect(page.getByRole("button", { name: /确认导入/ })).toBeDisabled();
    await expect(page.getByLabel("导入 JSON")).toHaveValue(JSON.stringify(document));
    await page.getByRole("button", { name: "校验导入", exact: true }).click();
    await expect(page.getByRole("button", { name: /确认导入/ })).toBeEnabled();
    await page.getByRole("button", { name: "关闭预览", exact: true }).click();
    await expect(page.getByRole("button", { name: /确认导入/ })).toBeDisabled();
    assert.equal(hits("/api/admin/sources/import").filter((request) => request.path.endsWith("/import")).length, 0);
  } finally { await page.close(); }
});

test("late preview responses cannot restore edited or dismissed approval; repeated clicks are ignored", async () => {
  const page = await openPage();
  try {
    delayPreview = true;
    await page.getByLabel("导入 JSON").fill(JSON.stringify(document));
    await page.getByRole("button", { name: "校验导入", exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
    await expect.poll(() => requests.length).toBe(1);
    await page.getByLabel("导入 JSON").fill("{}");
    releasePreview!();
    await expect(page.getByRole("button", { name: "校验导入", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: /确认导入/ })).toBeDisabled();
    await expect(page.getByText("Unity 新闻", { exact: true })).toHaveCount(0);
    delayPreview = false;
    await validate(page);
    await page.getByRole("link", { name: "返回信源", exact: true }).click();
    await page.goBack();
    await expect(page.getByRole("button", { name: /确认导入/ })).toBeDisabled();
    await expect(page.getByLabel("导入 JSON")).toHaveValue("");
  } finally { releasePreview?.(); await page.close(); }
});

test("a changed-server rejection requires a new preview before another apply", async () => {
  const page = await openPage();
  try {
    await validate(page);
    applyStatus = 409;
    await page.getByRole("button", { name: /确认导入/ }).click();
    await expect(page.getByRole("alert")).toContainText("重新校验");
    await expect(page.getByRole("button", { name: /确认导入/ })).toBeDisabled();
    applyStatus = 200;
    await page.getByRole("button", { name: "校验导入", exact: true }).click();
    await expect(page.getByRole("button", { name: /确认导入/ })).toBeEnabled();
  } finally { await page.close(); }
});

test("export failures remain on the page and expired sessions return through login", async () => {
  const page = await openPage();
  try {
    exportStatus = 503;
    await page.getByRole("button", { name: "导出全部信源", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("导出失败，请重试");
    exportStatus = 401;
    await page.getByRole("button", { name: "导出全部信源", exact: true }).click();
    await expect(page).toHaveURL(`${web.origin}/api/auth/login?return=%2Fadmin%2Fsources%2Ftransfer`);
  } finally { await page.close(); }
});

test("closing an in-flight preview prevents a late response from enabling import", async () => {
  const page = await openPage();
  try {
    delayPreview = true;
    await page.getByLabel("导入 JSON").fill(JSON.stringify(document));
    await page.getByRole("button", { name: "校验导入", exact: true }).click();
    await expect.poll(() => requests.length).toBe(1);
    await page.getByRole("button", { name: "关闭预览", exact: true }).click();
    releasePreview!();
    await expect(page.getByRole("button", { name: "校验导入", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: /确认导入/ })).toBeDisabled();
    await expect(page.getByText("Unity 新闻", { exact: true })).toHaveCount(0);
    assert.equal(requests.length, 1);
  } finally { releasePreview?.(); await page.close(); }
});

test("a late file read cannot replace newer pasted content", async () => {
  const page = await openPage();
  try {
    await page.evaluate(() => {
      File.prototype.text = () => new Promise<string>((resolve) => {
        Object.assign(window, { releaseSourceFile: resolve });
      });
    });
    await page.getByLabel("选择 JSON 文件").setInputFiles({ name: "slow.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(document)) });
    await expect(page.getByRole("button", { name: "校验导入", exact: true })).toBeDisabled();
    await page.getByLabel("导入 JSON").fill("{\"newer\":true}");
    await page.evaluate((text) => (window as unknown as Window & { releaseSourceFile: (value: string) => void }).releaseSourceFile(text), JSON.stringify(document));
    await expect(page.getByRole("button", { name: "校验导入", exact: true })).toBeEnabled();
    await expect(page.getByLabel("导入 JSON")).toHaveValue("{\"newer\":true}");
    await expect(page.getByRole("button", { name: /确认导入/ })).toBeDisabled();
    assert.equal(requests.length, 0);
  } finally { await page.close(); }
});

test("a rejected preview leaves apply disabled and session expiry goes to login", async () => {
  const page = await openPage();
  try {
    previewStatus = 400;
    await page.getByLabel("导入 JSON").fill(JSON.stringify(document));
    await page.getByRole("button", { name: "校验导入", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("校验未完成");
    await expect(page.getByRole("button", { name: /确认导入/ })).toBeDisabled();
    previewStatus = 401;
    await page.getByRole("button", { name: "校验导入", exact: true }).click();
    await expect(page).toHaveURL(`${web.origin}/api/auth/login?return=%2Fadmin%2Fsources%2Ftransfer`);
    assert.equal(requests.filter((request) => request.path === "/api/admin/sources/import").length, 0);
  } finally { await page.close(); }
});

test("a dismissed preview cannot redirect a newer page when its old session response arrives", async () => {
  const page = await openPage();
  try {
    delayPreview = true;
    previewStatus = 401;
    await page.getByLabel("导入 JSON").fill(JSON.stringify(document));
    await page.getByRole("button", { name: "校验导入", exact: true }).click();
    await expect.poll(() => requests.length).toBe(1);
    const canceled = page.waitForEvent("requestfailed", (request) => request.url().endsWith("/api/admin/sources/import/preview"));
    await page.getByRole("link", { name: "返回信源", exact: true }).click();
    await canceled;
    releasePreview!();
    await expect(page).toHaveURL(`${web.origin}/admin/sources`);
    await page.goBack();
    await expect(page.getByRole("button", { name: /确认导入/ })).toBeDisabled();
    assert.equal(requests.filter((request) => request.path.startsWith("/api/auth/login")).length, 0);
  } finally { releasePreview?.(); await page.close(); }
});

// Exercise the actual shared command hook without a browser too: intentionally aborting a preview
// must cancel its fetch and must not redirect the newer page when the old request gets a 401.
test("aborted admin preview cannot redirect after its session response arrives", async () => {
  const { createServer: createViteServer } = await import("vite");
  const { createElement } = await import("react");
  const { renderToString } = await import("react-dom/server");
  const { createMemoryRouter, RouterProvider } = await import("react-router");
  const vite = await createViteServer({ configFile: false, root: fileURLToPath(new URL("../", import.meta.url)),
    server: { middlewareMode: true }, appType: "custom" });
  const originalFetch = globalThis.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const location = { pathname: "/admin/sources/transfer", search: "", href: "/admin/sources/transfer" };
  let dispose: (() => void) | undefined;
  const responses: Response[] = [];
  try {
    const { useAdminAction } = await vite.ssrLoadModule("/app/features/admin/action.ts");
    let command: ReturnType<typeof useAdminAction>;
    const Harness = () => { command = useAdminAction(); return null; };
    const router = createMemoryRouter([{ id: "admin-layout", path: "*", element: createElement(Harness) }], {
      hydrationData: { loaderData: { "admin-layout": { me: { name: "Fixture", csrf: "fixture-csrf", dev: true } } } },
    });
    dispose = () => router.dispose();
    renderToString(createElement(RouterProvider, { router }));
    Object.defineProperty(globalThis, "window", { configurable: true, value: { location } });
    globalThis.fetch = async (input, init) => {
      const response = await originalFetch(new URL(String(input), web.origin), init);
      responses.push(response);
      return response;
    };
    delayPreview = true;
    previewStatus = 401;
    const controller = new AbortController();
    const running = command!.run("POST", "/api/admin/sources/import/preview", { document }, { signal: controller.signal, revalidate: false });
    await expect.poll(() => requests.length).toBe(1);
    controller.abort();
    releasePreview!();
    assert.equal(await running, null);
    assert.equal(location.href, "/admin/sources/transfer", "an aborted response must not navigate away from the current page");
    delayPreview = false;
    await command!.run("POST", "/api/admin/sources/import/preview", { document }, { revalidate: false });
    assert.equal(location.href, "/api/auth/login?return=%2Fadmin%2Fsources%2Ftransfer", "ordinary expired sessions must still redirect");
  } finally {
    releasePreview?.();
    globalThis.fetch = originalFetch;
    await Promise.all(responses.map((response) => response.body?.cancel().catch(() => {})));
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
    dispose?.();
    await vite.close();
  }
});


test("a redacted export names the affected count after the download", async () => {
  exportDocument = { ...document, sources: [{ ...document.sources[0]!, config: {}, redacted_fields: ["config.feedUrl"] }] };
  const page = await openPage();
  try {
    const downloaded = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出全部信源", exact: true }).click();
    const file = await downloaded;
    assert.deepEqual(JSON.parse(await readFile((await file.path())!, "utf8")), exportDocument);
    await expect(page.getByRole("status").filter({ hasText: "本次导出有 1 个信源包含脱敏字段" })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "本次导出" })).toContainText("补全");
  } finally { await page.close(); }
});
