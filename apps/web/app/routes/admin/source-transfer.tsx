import { SITE } from "@aihot/site";
import { useEffect, useRef, useState } from "react";
import type { Route } from "./+types/source-transfer";
import type { AdminSourceImportPreview, AdminSourceImportResult, SourceDefinitionsDocument } from "@aihot/contracts/admin";
import { useAdminAction } from "../../features/admin/action";
import { AdminPage, Badge, Button, ButtonLink, Card, DataTable, Empty, Field, Input, Stat, Textarea } from "../../features/admin/ui";

export const meta: Route.MetaFunction = () => [{ title: `信源导入 / 导出 · ${SITE.name} 后台` }];

const MAX_BYTES = 512 * 1024;
const STATUS = { new: "新增", duplicate: "重复，跳过", conflict: "冲突，跳过", invalid: "无效，需修复" } as const;
type Operation = { kind: "file" | "preview" | "apply"; revision: number; controller?: AbortController };
type Validated = { document: unknown; report: AdminSourceImportPreview };

export default function SourceTransfer() {
  const { run } = useAdminAction();
  const [ids, setIds] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [source, setSource] = useState("");
  const [pending, setPending] = useState<Operation["kind"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Validated | null>(null);
  const [result, setResult] = useState<AdminSourceImportResult | null>(null);
  const revision = useRef(0);
  const operation = useRef<Operation | null>(null);
  const exportRequest = useRef<AbortController | null>(null);

  useEffect(() => () => {
    revision.current++;
    // Stop waiting on navigation; a submitted import may still commit on the server.
    operation.current?.controller?.abort();
    operation.current = null;
    exportRequest.current?.abort();
    exportRequest.current = null;
  }, []);

  function invalidate() {
    revision.current++;
    if (operation.current?.kind === "preview") {
      operation.current.controller?.abort();
      operation.current = null;
      setPending(null);
    }
    setPreview(null);
    setResult(null);
    setError(null);
  }

  function finish(current: Operation) {
    if (operation.current !== current) return;
    operation.current = null;
    setPending(null);
  }

  async function readFile(file: File) {
    if (operation.current?.kind === "apply") return;
    invalidate();
    setSource("");
    const current: Operation = { kind: "file", revision: revision.current };
    operation.current = current;
    setPending("file");
    try {
      if (file.size > MAX_BYTES) throw new Error("文件不能超过 512 KiB。");
      const text = await file.text();
      if (revision.current === current.revision) setSource(text);
    } catch (cause) {
      if (revision.current === current.revision) setError(cause instanceof Error ? cause.message : "无法读取文件，请重试。");
    } finally {
      finish(current);
    }
  }

  async function validate() {
    if (operation.current) return;
    invalidate();
    let document: unknown;
    try {
      if (new TextEncoder().encode(source).byteLength > MAX_BYTES) throw new Error("导入 JSON 不能超过 512 KiB。");
      try { document = JSON.parse(source); }
      catch { throw new Error("请输入合法 JSON，或选择信源定义 JSON 文件。"); }
    } catch (cause) {
      setError((cause as Error).message);
      return;
    }
    const current: Operation = { kind: "preview", revision: revision.current, controller: new AbortController() };
    operation.current = current;
    setPending("preview");
    const report = await run<AdminSourceImportPreview>("POST", "/api/admin/sources/import/preview", { document },
      { label: `source-import-preview-${current.revision}`, revalidate: false, signal: current.controller!.signal });
    if (revision.current === current.revision) {
      if (report) setPreview({ document, report });
      else setError("校验未完成，请重试；没有导入任何信源。");
    }
    finish(current);
  }

  async function apply() {
    if (operation.current || !preview?.report.canApply) return;
    const current: Operation = { kind: "apply", revision: revision.current, controller: new AbortController() };
    operation.current = current;
    setPending("apply");
    setError(null);
    const response = await run<AdminSourceImportResult>("POST", "/api/admin/sources/import",
      { document: preview.document, previewHash: preview.report.previewHash },
      { label: `source-import-apply-${preview.report.previewHash}`, revalidate: false, signal: current.controller!.signal });
    if (revision.current === current.revision) {
      setPreview(null);
      if (response) setResult(response);
      else setError("导入未确认成功。请重新校验，确认当前信源状态后再试。");
    }
    finish(current);
  }

  async function download(selected: boolean) {
    if (exportRequest.current) return;
    const selectedIds = [...new Set(ids.split(/[\s,，]+/).filter(Boolean))];
    if (selected && !selectedIds.length) return;
    const controller = new AbortController();
    exportRequest.current = controller;
    setExporting(true);
    setExportError(null);
    setExportNotice(null);
    try {
      const query = selected ? `?${new URLSearchParams({ ids: selectedIds.join(",") })}` : "";
      const response = await fetch(`/api/admin/sources/export${query}`, { credentials: "same-origin", signal: controller.signal });
      if (response.status === 401) {
        window.location.href = `/api/auth/login?return=${encodeURIComponent(window.location.pathname + window.location.search)}`;
        return;
      }
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { detail?: string } | null;
        throw new Error(body?.detail ?? `导出失败（${response.status}），请重试。`);
      }
      const document = await response.json() as SourceDefinitionsDocument;
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(new Blob([JSON.stringify(document)], { type: "application/json" }));
      const link = window.document.createElement("a");
      link.href = url;
      link.download = `source-definitions-${new Date().toISOString().slice(0, 10)}.json`;
      window.document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      const redacted = document.sources.filter((item) => item.redacted_fields?.length).length;
      setExportNotice(redacted
        ? `本次导出有 ${redacted} 个信源包含脱敏字段。导入前请补全配置并移除 redacted_fields 标记。`
        : `已导出 ${document.sources.length} 个信源定义。`);
    } catch (cause) {
      if (!controller.signal.aborted) setExportError(cause instanceof Error ? cause.message : "导出失败，请重试。");
    } finally {
      if (exportRequest.current === controller) {
        exportRequest.current = null;
        setExporting(false);
      }
    }
  }

  const report = preview?.report;
  const applying = pending === "apply";
  return (
    <AdminPage title="信源导入 / 导出" subtitle="迁移信源定义。校验只检查格式、配置与重复项，不会采集文章、调用模型或写入信源。"
      actions={<ButtonLink to="/admin/sources">返回信源</ButtonLink>}>
      <div className="space-y-5">
        <Card title="导出定义">
          <p className="mb-4 text-[13px] leading-relaxed text-ink-3">只包含信源定义，不含文章、任务、健康状态或启用状态。敏感配置会脱敏；带 redacted_fields 的条目必须补全配置并移除该标记后才能导入。导出范围不受信源列表筛选影响。</p>
          <Field label="导出的信源 ID" hint="指定导出时填写 ID，用逗号、空格或换行分隔；“导出全部信源”始终导出全库定义。">
            <Textarea aria-label="导出的信源 ID" rows={2} value={ids} disabled={exporting} onChange={(event) => setIds(event.target.value)} placeholder="unity-lts-releases, unity-supported-releases" />
          </Field>
          {exportError && <p role="alert" className="mt-3 text-[13px] text-hot">{exportError}</p>}
          {exportNotice && <p role="status" className="mt-3 text-[13px] text-ink-2">{exportNotice}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button disabled={exporting} onClick={() => download(false)}>导出全部信源</Button>
            <Button disabled={exporting || !ids.split(/[\s,，]+/).some(Boolean)} onClick={() => download(true)}>导出指定信源</Button>
            {exporting && <span className="self-center text-[13px] text-ink-3">正在导出…</span>}
          </div>
        </Card>
        <Card title="导入定义">
          <p className="mb-4 text-[13px] leading-relaxed text-ink-3">接受 source-definitions v1 JSON，最多 500 个信源、512 KiB。新信源始终以暂停状态创建；重复或冲突项跳过，不会覆盖现有信源。有无效项时整批不能导入。</p>
          <div className="space-y-4">
            <Field label="选择 JSON 文件">
              <Input type="file" accept=".json,application/json" aria-label="选择 JSON 文件" disabled={applying}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void readFile(file);
                }} />
            </Field>
            <Field label="导入 JSON" hint="也可直接粘贴。修改内容或换文件后必须重新校验。">
              <Textarea aria-label="导入 JSON" rows={12} className="font-mono !text-[12px]" spellCheck={false} value={source} disabled={applying}
                onChange={(event) => { invalidate(); setSource(event.target.value); }} />
            </Field>
          </div>
          {error && <p role="alert" className="mt-3 text-[13px] text-hot">{error}</p>}
          {result && <p role="status" className="mt-3 rounded-card bg-ok/10 px-4 py-3 text-[13px] text-ok">已导入 {result.created.length} 个新信源，全部已暂停；跳过 {result.skipped} 项。请在信源详情确认配置后按需启用。</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button busy={pending === "preview" || pending === "file"} disabled={pending !== null || !source.trim()} onClick={validate}>校验导入</Button>
            <Button tone="primary" busy={applying} disabled={pending !== null || !report?.canApply} onClick={apply}>{report ? `确认导入 ${report.counts.new} 个新信源` : "确认导入"}</Button>
            {(report || pending === "preview") && <Button disabled={applying} onClick={invalidate}>关闭预览</Button>}
          </div>
          {applying && <p className="mt-3 text-[12.5px] text-ink-3">正在提交导入。离开页面不会撤销已提交的操作，请等待结果。</p>}
        </Card>
        <Card title="校验预览" pad={false}>
          {!report ? <Empty>选择文件或粘贴 JSON 后点“校验导入”。校验通过后仍需明确确认才会创建信源。</Empty> : <>
            <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-4">
              <Stat label="新增" value={report.counts.new} />
              <Stat label="重复，跳过" value={report.counts.duplicate} />
              <Stat label="冲突，跳过" value={report.counts.conflict} tone={report.counts.conflict ? "warn" : undefined} />
              <Stat label="无效，需修复" value={report.counts.invalid} tone={report.counts.invalid ? "bad" : undefined} />
            </div>
            <DataTable rows={report.rows} rowKey={(row) => row.index} columns={[
              { key: "name", label: "信源", render: (row) => <div><div>{row.name || "未命名"}</div><div className="font-mono text-[12px] text-ink-4">{row.id || `第 ${row.index + 1} 项`}</div></div> },
              { key: "status", label: "结果", render: (row) => <Badge tone={row.status === "new" ? "ok" : row.status === "invalid" ? "bad" : "warn"}>{STATUS[row.status]}</Badge> },
              { key: "messages", label: "说明", render: (row) => row.messages.length ? <ul className="space-y-1">{row.messages.map((message, index) => <li key={index}>{message}</li>)}</ul> : "将以暂停状态创建" },
            ]} />
          </>}
        </Card>
      </div>
    </AdminPage>
  );
}
