// UnityHot editorial vocabulary. Publisher ownership never determines engine product identity.
export const CATEGORIES = [
  { key: 'engine', label: '引擎版本', section: '引擎与包', guide: 'Unity 国际版与团结引擎的版本、支持周期、兼容性和重要修复；必须分清产品及完整版本。' },
  { key: 'product', label: '包与工具', section: '引擎与包', guide: 'Package、编辑器扩展、开源工具的实质发布与更新；无技术信息的促销不收。' },
  { key: 'industry', label: '行业与政策', section: '行业与政策', guide: '直接影响开发者的授权、收费、平台政策、安全事故和公司决定。游戏广告和泛科技新闻不收。' },
  { key: 'paper', label: '技术研究', section: '技术与实践', guide: '与 Unity 或团结开发直接相关的渲染、物理、网络、工具链等研究与评测，保留测试条件。' },
  { key: 'tip', label: '教程', section: '技术与实践', guide: '可复用的工程实践、性能优化、排错、示例代码和技术讲解。', commentary: true },
  { key: 'opinion', label: '分析', section: '分析与观点', guide: '有具体事实支撑的技术选择、架构权衡及生态分析。', commentary: true },
] as const satisfies ReadonlyArray<{ key: string; label: string; feedLabel?: string; section: string; guide: string; commentary?: true }>;
export const RELEASE: { category: string; tag: string; unit: string } | null = { category: 'engine', tag: '引擎发布', unit: '个引擎版本' };
export const PLAIN_TERMS: readonly string[] = ['unity', 'tuanjie', '团结引擎', 'c#', 'gpu', 'cpu', 'api', 'sdk', 'urp', 'hdrp', 'dots'];
export const ITEM_TYPES = ['engine_release', 'product_launch', 'tool_or_method', 'research_paper', 'industry_event', 'opinion_analysis', 'tutorial_explainer'] as const;
export const CATEGORY_TAGS = ['引擎发布', '产品更新', '论文/研究', '开源/仓库', '教程/实践', '现象/趋势', '技术观点', '评测/基准', '安全/修复', '行业动态', '政策/授权', '其他'] as const;
export const TOPIC_TAGS = ['engine:unity_global', 'engine:tuanjie', 'engine:both', 'engine:unknown', '渲染', '性能优化', '物理', 'UI', '2D', '动画', '网络/多人', '移动平台', 'Web', 'XR', '编辑器', '构建/发布', 'DOTS', '开源生态', 'AI工具'] as const;
export const ENTITY_TAGS = ['Unity Technologies', 'Unity 中国', 'Cysharp', 'UWA', 'Catlike Coding', 'GitHub'] as const;
export const TAG_SYNONYMS: Readonly<Record<string, string>> = {
  '教程/玩法': '教程/实践', '技巧/最佳实践': '教程/实践', 教程: '教程/实践', 指南: '教程/实践', 实践: '教程/实践',
  'open-source': '开源/仓库', 开源: '开源/仓库', 仓库: '开源/仓库', repo: '开源/仓库',
  发布: '引擎发布', 引擎: '引擎发布', 产品: '产品更新', 更新: '产品更新',
  政策: '政策/授权', 授权: '政策/授权', 监管: '政策/授权', 法规: '政策/授权', 安全: '安全/修复', 修复: '安全/修复',
  论文: '论文/研究', 研究: '论文/研究', paper: '论文/研究', papers: '论文/研究',
  观点: '技术观点', 趋势: '现象/趋势', 行业: '行业动态', 合作: '行业动态', 融资: '行业动态', 收购: '行业动态',
  URP: '渲染', HDRP: '渲染', Netcode: '网络/多人', WebGL: 'Web',
};
export const ENTITIES: Record<string, { name: string; displayTag: string | null; aliases: string[]; otherNames?: string[] }> = {
  'unity-technologies': { name: 'Unity Technologies', displayTag: 'Unity Technologies', aliases: ['Unity Technologies', 'Unity'], otherNames: ['Unity-Technologies'] },
  'unity-china': { name: 'Unity 中国', displayTag: 'Unity 中国', aliases: ['Unity 中国', 'Unity China', '优三缔'] },
  cysharp: { name: 'Cysharp', displayTag: 'Cysharp', aliases: ['Cysharp'] },
  uwa: { name: 'UWA', displayTag: 'UWA', aliases: ['UWA', 'UWA Technology', '侑虎科技'] },
  'catlike-coding': { name: 'Catlike Coding', displayTag: 'Catlike Coding', aliases: ['Catlike Coding', 'Jasper Flick'] },
};
export const IDENTITY_LEXICON: ReadonlyArray<{ id: string; name: string; patterns: RegExp[] }> = [
  { id: 'unity-technologies', name: 'Unity Technologies', patterns: [/\bUnity(?:[ -]Technologies)?\b(?!\s*(?:中国|China))/i] },
  { id: 'unity-china', name: 'Unity 中国', patterns: [/Unity\s*(?:中国|China)|优三缔/i] },
  { id: 'cysharp', name: 'Cysharp', patterns: [/\bCysharp\b/i] },
  { id: 'uwa', name: 'UWA', patterns: [/\bUWA\b|侑虎科技/i] },
  { id: 'catlike-coding', name: 'Catlike Coding', patterns: [/Catlike\s+Coding|Jasper\s+Flick/i] },
];
export const PUBLISHER_DOMAINS: ReadonlyArray<{ entityId: string; domains: readonly string[] }> = [
  { entityId: 'unity-technologies', domains: ['unity.com'] },
  { entityId: 'unity-china', domains: ['unity.cn'] },
  { entityId: 'uwa', domains: ['uwa4d.com'] },
  { entityId: 'catlike-coding', domains: ['catlikecoding.com'] },
];
export const IDENTITY_CONTEXT_ALIASES: ReadonlyArray<{ entityId: string; pattern: RegExp }> = [];
