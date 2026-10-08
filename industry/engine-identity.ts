/** Product identity is independent of publisher, language, domain and compatibility. */
export const ENGINE_PRODUCTS = ['unity_global', 'tuanjie', 'both', 'unknown'] as const;
export type EngineProduct = (typeof ENGINE_PRODUCTS)[number];
export const ENGINE_LABELS: Record<EngineProduct, string> = {
  unity_global: 'Unity 国际版', tuanjie: '团结引擎', both: 'Unity 国际版 + 团结引擎', unknown: '产品待确认',
};
export interface EngineEvidence { title: string; sourceTitle?: string; summary?: string | null; identityText?: string | null; tags?: readonly string[] }
const VERSION = String.raw`v?(\d+(?:\.\d+)+(?:[a-z]\d+)*(?:[-.](?:preview|pre|beta|alpha|rc)[-.]?\d*)?)`;
/** These references identify an upstream/base or Hub build, not a second released product. */
function subjectText(text: string): string {
  return text.replace(/https?:\/\/\S+/g, '')
    .replace(/\S+@[\w.-]+|\b(?:[a-z0-9-]+\.)+(?:com|cn|org|net|io)\b/gi, '')
    .replace(new RegExp(String.raw`(?:基于|底层(?:版本)?|上游|based\s+on|upstream(?:\s+version)?|base(?:\s+version)?)\s*[:：]?\s*(?:Unity(?:\s+Editor)?\s*)?` + VERSION, 'gi'), '')
    .replace(new RegExp(String.raw`(?:Hub\s*内部(?:标识|版本)?|内部(?:构建|版本))\s*` + VERSION, 'gi'), '');
}
const explicit = (text: string): EngineProduct => {
  text = subjectText(text);
  const tuanjie = /团结(?:引擎)?|\btuanjie\b/i.test(text);
  const unity = /\bunity\b(?![-\s]*(?:Technologies|中国|China|公司))/i.test(text);
  return tuanjie && unity ? 'both' : tuanjie ? 'tuanjie' : unity ? 'unity_global' : 'unknown';
};
export function engineProduct(r: EngineEvidence): EngineProduct {
  const tagged = ENGINE_PRODUCTS.filter(p => r.tags?.includes(`engine:${p}`));
  if (tagged.includes('both') || tagged.includes('unity_global') && tagged.includes('tuanjie')) return 'both';
  if (tagged.length) return tagged[0]!;
  // URLs and publisher names alone are not product evidence.
  return explicit((r.sourceTitle ?? r.title).replace(/https?:\/\/\S+/g, ''));
}
/** Source text wins over model tags. A source product tag is only configured for a product-specific feed. */
export function groundedEngineTags(tags: readonly string[], title: string, body: string, sourceTags: readonly string[] = []): string[] {
  const textProduct = explicit(`${title}\n${body}`);
  const product = textProduct !== 'unknown' ? textProduct : engineProduct({ title: '', tags: sourceTags });
  return [...tags.filter(t => !t.startsWith('engine:')).slice(0, 5), `engine:${product}`];
}
/** Keep channel/build suffixes verbatim: f1, t16, f1c1, beta/preview suffixes are not interchangeable. */
export function engineVersions(r: EngineEvidence): string[] {
  const text = subjectText([r.sourceTitle ?? r.title, r.summary, r.identityText].filter(Boolean).join('\n'));
  const versions = [...text.matchAll(new RegExp(String.raw`(?<![\w.])` + VERSION + String.raw`(?![\w.])`, 'gi'))].map(m => m[1]!.toLowerCase());
  if (versions.length) return [...new Set(versions)].sort();
  return [...new Set([...text.matchAll(/\bUnity\s+v?(\d+)\b/gi)].map(m => m[1]!))].sort();
}
/** Hard veto before any automatic fact/story/signal attachment; models cannot override it. */
export function engineReportsCompatible(a: EngineEvidence, b: EngineEvidence): boolean {
  const ap = engineProduct(a), bp = engineProduct(b);
  if (ap !== bp) return false;
  const av = engineVersions(a), bv = engineVersions(b);
  return av.length === bv.length && av.every((v, i) => v === bv[i]);
}
