// The one-article trial deliberately supports one model route and no paid fallbacks.
import { PRESETS } from '@aihot/site/models';

export interface TrialOptions { articleId: string; execute: boolean; resume: boolean }
export const TRIAL_USAGE = 'node scripts/single-article.ts ARTICLE_ID [--execute] [--resume]';
export const TRIAL_CAPABILITIES = ['PREFILTER_MODEL', 'SCORE_MODEL', 'STRUCTURE_MODEL', 'UNDERSTAND_MODEL', 'SUMMARIZE_MODEL', 'GROUP_MODEL', 'GROUP_REVIEW_MODEL'];
export const TRIAL_FORBIDDEN_KEYS = [...new Set(['JINA_API_KEY', 'SOCIALDATA_API_KEY', 'EMBEDDING_API_KEY', 'DASHSCOPE_API_KEY', ...Object.values(PRESETS).map(p => p.apiKeyEnv)])];

export function parseTrialArgs(args: string[]): TrialOptions {
  const [articleId, ...flags] = args;
  if (!articleId || !/^[A-Za-z0-9_-]{1,200}$/.test(articleId) || new Set(flags).size !== flags.length || flags.some(f => !['--execute', '--resume'].includes(f))) throw new Error(TRIAL_USAGE);
  return { articleId, execute: flags.includes('--execute'), resume: flags.includes('--resume') };
}

export function validateTrialEnvironment(env: NodeJS.ProcessEnv): void {
  const require = (ok: boolean, message: string) => { if (!ok) throw new Error(message); };
  require(env.COLLECT_ENABLED === 'false' && env.MODEL_CALLS_ENABLED === 'false', 'Keep COLLECT_ENABLED=false and MODEL_CALLS_ENABLED=false; --execute enables models only in this process.');
  require(!Object.entries(env).some(([key, value]) => (key.startsWith('FEISHU_') && key.endsWith('_ENABLED') || key === 'INDEXNOW_SUBMIT_ENABLED') && value === 'true'), 'Notification and IndexNow valves must be off.');
  let url: URL;
  try { url = new URL(env.LLM_BASE_URL ?? ''); } catch { throw new Error('LLM_BASE_URL must be the official DeepSeek endpoint.'); }
  require(url.protocol === 'https:' && url.hostname === 'api.deepseek.com' && !url.port && !url.username && !url.password && !url.search && !url.hash && ['', '/', '/v1', '/v1/'].includes(url.pathname), 'LLM_BASE_URL must be https://api.deepseek.com or https://api.deepseek.com/v1.');
  require(!!env.LLM_API_KEY?.trim(), 'LLM_API_KEY is missing.');
  require(env.LLM_MODEL === 'deepseek-flash', 'LLM_MODEL must be deepseek-flash.');
  let extra: unknown;
  try { extra = JSON.parse(env.LLM_EXTRA_JSON ?? ''); } catch { throw new Error('LLM_EXTRA_JSON must contain only thinking.type=disabled.'); }
  require(JSON.stringify(extra) === '{"thinking":{"type":"disabled"}}', 'LLM_EXTRA_JSON must contain only thinking.type=disabled.');
  require(!env.LLM_REASONING_TOKENS || env.LLM_REASONING_TOKENS === '0', 'LLM_REASONING_TOKENS must be unset or 0.');
  require(env.LLM_VISION !== 'true' && env.LLM_JSON_MODE !== 'false', 'The trial requires text-only JSON mode.');
  for (const name of TRIAL_CAPABILITIES) require(!env[name] || env[name] === 'default', `${name} must be unset or default.`);
  for (const name of TRIAL_FORBIDDEN_KEYS) require(!env[name]?.trim(), `${name} must be absent for this trial (no paid fallback).`);
}
