// Portable source definitions: authenticated read-only export/preview and atomic create-only import.
import { z } from "zod";
import type { AdminSourceImportPreview, AdminSourceImportResult, SourceDefinitionsDocument } from "@aihot/contracts/admin";
import { audit, Conflict } from "../audit.ts";
import { sql, type Db } from "../db.ts";
import { exportSourceDefinitions, planSourceImport, SOURCE_DOCUMENT_MAX_ROWS, SourceDocumentError } from "./source-definitions.ts";

async function definitions(db: Db = sql) {
  return db`SELECT id, name, kind, config, tags, owner_entity_id, signal_group_id, tier, participation_mode,
                   interval_minutes, site_fulltext, syndicate_fulltext FROM sources ORDER BY id`;
}

export async function exportSources(ids?: unknown): Promise<SourceDefinitionsDocument> {
  if (ids !== undefined && typeof ids !== "string") throw new SourceDocumentError("ids 必须是一个逗号分隔的 ID 字符串");
  const selected = ids === undefined ? null : [...new Set(ids.split(",").map((id) => id.trim()))];
  if (selected && (!selected.length || selected.length > SOURCE_DOCUMENT_MAX_ROWS || selected.some((id) => !/^[a-z0-9][a-z0-9-]{2,79}$/.test(id)))) {
    throw new SourceDocumentError("请输入 1 至 500 个有效信源 ID，以逗号分隔");
  }
  const rows = await sql`SELECT id, name, kind, config, tags, owner_entity_id, signal_group_id, tier, participation_mode,
                               interval_minutes, site_fulltext, syndicate_fulltext FROM sources
                        WHERE (${selected === null} OR id = ANY(${selected ?? []}::text[])) ORDER BY id LIMIT ${SOURCE_DOCUMENT_MAX_ROWS + 1}`;
  if (selected && selected.length !== rows.length) throw new SourceDocumentError("部分信源 ID 不存在，请检查后重新导出");
  return exportSourceDefinitions(rows);
}

export async function previewSourceImport(document: unknown): Promise<AdminSourceImportPreview> {
  return planSourceImport(document, await definitions()).preview;
}

const applySchema = z.object({ document: z.unknown(), previewHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export async function importSources(input: unknown, actor: string): Promise<AdminSourceImportResult> {
  const { document, previewHash } = applySchema.parse(input);
  return sql.begin(async (tx) => {
    // Same lock as ordinary source creation/address edits; recheck the complete reviewed plan inside it.
    await tx`SELECT pg_advisory_xact_lock(hashtext('admin-source-identity'))`;
    const plan = planSourceImport(document, await definitions(tx));
    if (plan.preview.counts.invalid) throw new SourceDocumentError("文件含有无效信源，请修复后重新预览");
    if (plan.preview.previewHash !== previewHash) throw new Conflict("文件或信源列表已变化，请重新预览后再导入");
    if (!plan.preview.canApply) throw new SourceDocumentError("没有可新建的信源");
    for (const s of plan.sources) {
      const [row] = await tx`INSERT INTO sources
        (id, name, kind, config, tags, owner_entity_id, signal_group_id, tier, participation_mode, interval_minutes,
         first_party, site_fulltext, syndicate_fulltext, enabled, health, next_fetch_at)
        VALUES (${s.id}, ${s.name}, ${s.kind}, ${tx.json(s.config as never)}, ${s.tags}, ${s.owner_entity_id}, ${s.signal_group_id},
                ${s.tier}, ${s.participation_mode}, ${s.interval_minutes}, ${s.tier === "T1"}, ${s.site_fulltext}, ${s.syndicate_fulltext},
                false, 'paused', NULL)
        ON CONFLICT (id) DO NOTHING RETURNING id`;
      if (!row) throw new Conflict("信源 ID 已被其他操作创建，请重新预览");
      await audit(actor, "source.import", `source:${s.id}`, "导入信源定义（暂停）", null, { ...s, enabled: false }, { db: tx });
    }
    return { created: plan.sources.map((s) => s.id), skipped: plan.preview.counts.duplicate + plan.preview.counts.conflict };
  });
}
