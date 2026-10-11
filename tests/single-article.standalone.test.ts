import './standalone.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseTrialArgs, validateTrialEnvironment } from '../scripts/single-article-options.ts';

const safe = () => ({ COLLECT_ENABLED: 'false', MODEL_CALLS_ENABLED: 'false', LLM_BASE_URL: 'https://api.deepseek.com/v1', LLM_API_KEY: 'test-key', LLM_MODEL: 'deepseek-flash', LLM_EXTRA_JSON: '{"thinking":{"type":"disabled"}}' });

test('an exact article ID defaults to preflight; execution and resumption are explicit', () => {
  assert.deepEqual(parseTrialArgs(['article-123']), { articleId: 'article-123', execute: false, resume: false });
  assert.deepEqual(parseTrialArgs(['article-123', '--execute', '--resume']), { articleId: 'article-123', execute: true, resume: true });
  for (const args of [[], ['a','b'], ['a','--all'], ['a','--execute','--execute'], ['*']]) assert.throws(() => parseTrialArgs(args));
});

test('only the exact default DeepSeek Flash route with thinking off is accepted', () => {
  assert.doesNotThrow(() => validateTrialEnvironment(safe()));
  for (const change of [
    { COLLECT_ENABLED: 'true' }, { MODEL_CALLS_ENABLED: 'true' }, { LLM_MODEL: 'deepseek-chat' },
    { LLM_BASE_URL: 'https://api.deepseek.com.attacker.example/v1' }, { LLM_BASE_URL: 'https://api.deepseek.com/v1?key=secret' },
    { LLM_EXTRA_JSON: '{"thinking":{"type":"disabled"},"model":"other"}' }, { LLM_EXTRA_JSON: '{}' },
    { SCORE_MODEL: 'deepseek-flash' }, { LLM_REASONING_TOKENS: '1' }, { LLM_VISION: 'true' },
    { DASHSCOPE_API_KEY: 'secret' }, { EMBEDDING_API_KEY: 'secret' }, { JINA_API_KEY: 'secret' }, { FEISHU_INTERNAL_ENABLED: 'true' },
  ]) assert.throws(() => validateTrialEnvironment({ ...safe(), ...change }));
});

test('the dedicated process lease disables both idle and maximum-lifetime connection retirement', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../packages/backend/src/jobs/queue-lease.ts', import.meta.url), 'utf8');
  assert.match(source, /idle_timeout:\s*0/);
  assert.match(source, /max_lifetime:\s*0/);
});

test('CLI help and invalid arguments exit without database or provider access', async () => {
  const { spawnSync } = await import('node:child_process');
  const cwd = new URL('..', import.meta.url);
  const env = { ...process.env, DATABASE_URL:'postgres://not-reachable@127.0.0.1:1/trial_test', LLM_API_KEY:'never-print-this-key' };
  const help = spawnSync(process.execPath, ['scripts/single-article.ts','--help'], { cwd, env, encoding:'utf8', timeout:5000 });
  assert.equal(help.status,0);
  assert.match(help.stdout,/read-only preflight/);
  assert.doesNotMatch(help.stdout+help.stderr,/never-print-this-key/);
  const invalid = spawnSync(process.execPath, ['scripts/single-article.ts','article-123','--all'], { cwd, env, encoding:'utf8', timeout:5000 });
  assert.equal(invalid.status,1);
  assert.match(invalid.stderr,/ARTICLE_ID/);
  assert.doesNotMatch(invalid.stdout+invalid.stderr,/connect|never-print-this-key/);
});
