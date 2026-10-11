import './setup.ts';
import assert from 'node:assert/strict';
import { before, beforeEach, after, test, mock } from 'node:test';
import { PgBoss } from 'pg-boss';
import { config } from '@aihot/backend/config';
import { sql, closeDb } from '@aihot/backend/db';
import { upsertMaterial } from '@aihot/backend/content/materials';
import { CAPABILITIES, invalidateModelCache } from '@aihot/backend/editorial/models';
import { stopBoss, getBoss, QUEUES } from '@aihot/backend/jobs/queue';
import { preflightArticle, runSingleArticle, claimArticleJob } from '@aihot/backend/jobs/single-article';
import { acquireQueueLease } from '@aihot/backend/jobs/queue-lease';
import { TRIAL_FORBIDDEN_KEYS } from '../scripts/single-article-options.ts';
import { analysisStep, SELECTING_SCORE } from './analysis-steps.ts';

let articleId = '';
let calls = 0;
let responseMode = 'ok';
const fakeFetch = mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
  assert.equal(String(url), 'https://api.deepseek.com/v1/chat/completions', 'no other external call is allowed');
  calls++;
  if (responseMode === 'unknown') throw new Error('transport stopped after sending');
  if (responseMode === 'refused') return new Response('temporary refusal', { status: 503 });
  const body = String(init?.body);
  const input = JSON.parse(body);
  assert.equal(input.model, 'deepseek-flash');
  assert.deepEqual(input.thinking, { type: 'disabled' });
  const step = analysisStep(body);
  if (responseMode === 'signal-final' && step === 'understand') { process.emit('SIGINT'); await new Promise(resolve=>setTimeout(resolve,30)); }
  const content = step === 'prefilter' ? { label: responseMode === 'block' ? 'BLOCK' : 'PASS', reason: 'Unity developer news' }
    : step === 'score' ? { attentionScore: SELECTING_SCORE }
    : step === 'structure' ? { scope: 'single', category: 'engine', tags: [], subjects: [], fact: { title: 'Unity 发布新版本', subject: 'Unity', action: '发布', object: 'Unity 6.3', evidence: 'Unity 6.3 is now available.' } }
    : step === 'understand' ? { itemType: 'product_launch', authorRole: 'principal', tags: [], editorialJudgment: '开发者版本更新', titleZh: 'Unity 6.3 正式发布', summaryZh: 'Unity 发布了 6.3 版本。开发者可查看原文的版本说明。' }
    : 'title_zh: Unity 6.3 发布\nsummary_zh: Unity 发布新版本。';
  return Response.json({ id: `mock-${calls}`, choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }], usage: { prompt_tokens: 10, completion_tokens: 20 } });
});

before(async () => {
  const bootstrap = new PgBoss({ connectionString: config.databaseUrl, schedule: false, supervise: false });
  bootstrap.on('error', () => {});
  await bootstrap.start();
  await bootstrap.stop();
});
beforeEach(async () => {
  await sql`TRUNCATE articles, sources, receipts, job_runs, stories CASCADE`;
  await sql`DELETE FROM settings`;
  await sql`DELETE FROM pgboss.job`;
  await sql`DELETE FROM pgboss.schedule`;
  await sql`UPDATE budgets SET per_minute=5, per_hour=20, per_day=20 WHERE service='llm'`;
  for (const c of Object.values(CAPABILITIES)) delete process.env[c.env];
  for (const key of TRIAL_FORBIDDEN_KEYS) delete process.env[key];
  Object.assign(process.env, { COLLECT_ENABLED: 'false', MODEL_CALLS_ENABLED: 'false', LLM_BASE_URL: 'https://api.deepseek.com/v1', LLM_API_KEY: 'fake-local-test', LLM_MODEL: 'deepseek-flash', LLM_EXTRA_JSON: '{"thinking":{"type":"disabled"}}' });
  config.modelCallsEnabled = false;
  invalidateModelCache();
  calls = 0; responseMode = 'ok';
  await sql`INSERT INTO sources(id,name,kind,tier,enabled,site_fulltext,participation_mode) VALUES('trial-source','Trial','rss','T1',false,false,'editorial')`;
  articleId = (await upsertMaterial({ sourceId: 'trial-source', url: 'https://example.com/unity-6-3', title: 'Unity 6.3 is now available', bodyText: 'Unity 6.3 is now available. Developers can download the new release and review its package compatibility and features. '.repeat(6), bodyStatus: 'ok', publishedAt: new Date(), via: 'fetch' })).articleId;
});
after(async () => { fakeFetch.mock.restore(); await stopBoss(); await closeDb(); });
const options = (resume = false) => ({ articleId, execute: true, resume });

test('preflight reads only: no receipts, queue jobs, or model calls', async () => {
  const result = await preflightArticle(options());
  assert.equal(result.articleId, articleId);
  assert.match(result.costWarning, /cannot guarantee/i);
  assert.equal(calls, 0);
  assert.equal((await sql`SELECT * FROM pgboss.job`).length, 0);
  assert.equal((await sql`SELECT * FROM receipts`).length, 0);
});

test('first trial completes real target jobs, Chinese analysis, publication and grouping without any optional work', async () => {
  const result = await runSingleArticle(options());
  assert.equal(result.status, 'complete');
  assert.equal(result.requests, 5);
  assert.equal(result.promptTokens, 50);
  assert.equal(calls, 5);
  assert.equal(config.modelCallsEnabled, false);
  const [a] = await sql`SELECT processing_state, grouping_status FROM articles WHERE id=${articleId}`;
  assert.equal(a.processing_state, 'analyzed'); assert.equal(a.grouping_status, 'complete');
  assert.match((await sql`SELECT title FROM publications WHERE article_id=${articleId}`)[0].title, /Unity/);
  const jobs = await sql`SELECT name, state, data, retry_limit FROM pgboss.job`;
  assert.ok(jobs.some(j => j.name === QUEUES.analyze && j.state === 'completed'));
  assert.ok(jobs.some(j => j.name === QUEUES.group && j.state === 'completed'));
  assert.ok(jobs.every(j => j.data.articleId === articleId && ['completed','cancelled'].includes(j.state)));
  assert.equal((await sql`SELECT * FROM pgboss.schedule`).length, 0);
  assert.equal((await sql`SELECT * FROM job_runs WHERE job NOT LIKE 'trial.article:%'`).length, 0);
});

test('foreign pending job is never claimed or mutated, including after preflight', async () => {
  const boss = await getBoss('single-article');
  await boss.createQueue(QUEUES.analyze);
  await preflightArticle(options());
  const foreign = await boss.send(QUEUES.analyze, { articleId: 'foreign' });
  await assert.rejects(() => claimArticleJob(boss, articleId), /other|foreign/i);
  assert.equal((await boss.getJobById(QUEUES.analyze, foreign!))!.state, 'created');
  assert.equal(calls, 0);
});

test('rejects enabled sources, another article, recent worker heartbeat, active job and model override', async () => {
  await sql`UPDATE sources SET enabled=true`;
  await assert.rejects(() => preflightArticle(options()), /paused/i);
  await sql`UPDATE sources SET enabled=false`;
  await sql`INSERT INTO settings(key,value) VALUES('heartbeat.worker', ${sql.json({ at: new Date().toISOString() })})`;
  await assert.rejects(() => preflightArticle(options()), /worker/i);
  await sql`DELETE FROM settings`;
  await sql`INSERT INTO settings(key,value) VALUES('models.score', ${sql.json({ model: 'deepseek-flash' })})`;
  await assert.rejects(() => preflightArticle(options()), /default|override/i);
  await sql`DELETE FROM settings`;
  await upsertMaterial({ sourceId: 'trial-source', url: 'https://example.com/foreign', title: 'Another', bodyText: 'foreign', via: 'fetch' });
  await assert.rejects(() => preflightArticle(options()), /only article/i);
  assert.equal(calls, 0);
});

test('normal queue users and one-shot exclusive lease cannot overlap in either direction', async () => {
  const release = await acquireQueueLease('normal');
  await assert.rejects(() => acquireQueueLease('single-article'), /queue|worker/i);
  await release();
  const end = await acquireQueueLease('single-article');
  await assert.rejects(() => acquireQueueLease('normal'), /trial|queue/i);
  await end();
});

test('extraction failure settles target job without calling models or scheduling a retry', async () => {
  await sql`UPDATE articles SET body_text=NULL, body_status='pending', url='http://127.0.0.1:1/no-body' WHERE id=${articleId}`;
  const result = await runSingleArticle(options());
  assert.equal(result.status, 'stopped'); assert.equal(calls, 0);
  const [a] = await sql`SELECT processing_error FROM articles WHERE id=${articleId}`;
  assert.match(a.processing_error, /extract/i);
  assert.ok((await sql`SELECT state FROM pgboss.job`).every(j => j.state === 'failed'));
});

test('unknown provider outcome is audited, stops, and cannot be resumed automatically', async () => {
  responseMode = 'unknown';
  const result = await runSingleArticle(options());
  assert.equal(result.status, 'stopped'); assert.equal(calls, 1);
  assert.equal((await sql`SELECT status FROM receipts`)[0].status, 'unknown');
  await assert.rejects(() => runSingleArticle(options(true)), /unknown|pending/i);
  assert.equal(calls, 1);
});

test('provider refusal is preserved and requires explicit resume', async () => {
  responseMode = 'refused';
  assert.equal((await runSingleArticle(options())).status, 'stopped');
  await assert.rejects(() => runSingleArticle(options()), /resume/i);
  assert.equal(calls, 1);
  responseMode = 'ok';
  // The configured rolling limit is intentionally not bypassed by resumption.
  assert.equal((await runSingleArticle(options(true))).status, 'stopped');
  assert.equal(calls, 5);
  assert.ok((await sql`SELECT state FROM pgboss.job`).every(j => !['created','active','retry'].includes(j.state)));
});

test('old articles retain their historical publication time and do not create a current event', async () => {
  await sql`UPDATE articles SET published_at=now()-interval '5 days', timeline_at=now()-interval '5 days', backfill=true WHERE id=${articleId}`;
  assert.equal((await runSingleArticle(options())).status, 'complete');
  assert.equal((await sql`SELECT * FROM stories`).length, 0);
  const [p] = await sql`SELECT published_at,sort_at,backfill FROM publications WHERE article_id=${articleId}`;
  assert.equal(p.backfill, true);
  assert.ok(p.sort_at.getTime() < Date.now()-4*86400_000);
  assert.ok(p.published_at.getTime() < Date.now()-4*86400_000);
});

test('active target jobs and installed schedules fail closed without changing them', async () => {
  const boss = await getBoss('single-article');
  await boss.createQueue(QUEUES.analyze);
  const id = await boss.send(QUEUES.analyze, { articleId });
  await boss.fetch(QUEUES.analyze);
  await assert.rejects(() => preflightArticle(options()), /active job/i);
  assert.equal((await boss.getJobById(QUEUES.analyze,id!))!.state, 'active');
  await boss.complete(QUEUES.analyze,id!);
  await boss.schedule(QUEUES.analyze, '* * * * *', { articleId });
  await assert.rejects(() => preflightArticle(options()), /schedules/i);
  assert.equal(calls, 0);
});

test('the total request guard stops at twenty across explicit resumptions', async () => {
  const [r] = await sql`INSERT INTO receipts(logical_key,service,model,purpose,subject,status) VALUES('trial-old','llm','deepseek-flash','prefilter_article',${`article:${articleId}@1`},'completed') RETURNING id`;
  for (let i=1;i<=19;i++) await sql`INSERT INTO receipt_attempts(receipt_id,attempt,service,status,started_at) VALUES(${r.id},${i},'llm','received',now()-interval '2 days')`;
  assert.equal((await runSingleArticle(options(true))).status, 'stopped');
  assert.equal(calls, 1);
  assert.equal(Number((await sql`SELECT count(*) AS n FROM receipt_attempts`)[0].n),20);
  await assert.rejects(() => runSingleArticle(options(true)), /20 requests/i);
});

test('a confirmed extracted body continues through only the target analysis and grouping jobs', async t => {
  const { createServer } = await import('node:http');
  const body = 'Unity 6.3 is now available. Developers can download the new release and read detailed compatibility notes. '.repeat(10);
  const server = createServer((_req,res) => { res.setHeader('content-type','text/html'); res.end(`<html><head><title>Unity 6.3 is now available</title></head><body><article><h1>Unity 6.3 is now available</h1><p>${body}</p></article></body></html>`); });
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(async () => { config.allowPrivateNetworkFetch=false; await new Promise<void>(resolve => server.close(()=>resolve())); });
  config.allowPrivateNetworkFetch=true;
  const port=(server.address() as {port:number}).port;
  await sql`UPDATE articles SET body_text=NULL, body_status='pending', url=${`http://127.0.0.1:${port}/article`} WHERE id=${articleId}`;
  const boss=await getBoss('single-article');
  await boss.send(QUEUES.analyze, { articleId }); // analysis discovers the missing body first
  assert.equal((await runSingleArticle(options())).status,'complete');
  assert.equal(calls,5);
  assert.equal((await sql`SELECT body_status FROM articles WHERE id=${articleId}`)[0].body_status,'ok');
  const jobs=await sql`SELECT name,state FROM pgboss.job`;
  assert.ok(jobs.some(j=>j.name===QUEUES.extractBody && j.state==='completed'));
  assert.ok(jobs.every(j=>['completed','cancelled'].includes(j.state)));
});

test('a normal editorial BLOCK is a completed one-call trial and explicit resume does not requeue it', async () => {
  responseMode='block';
  assert.equal((await runSingleArticle(options())).status,'complete');
  assert.equal(calls,1);
  assert.equal((await sql`SELECT processing_state FROM articles WHERE id=${articleId}`)[0].processing_state,'blocked');
  assert.equal((await runSingleArticle(options(true))).status,'complete');
  assert.equal(calls,1);
  assert.equal((await sql`SELECT * FROM pgboss.job`).length,1);
});

test('SIGINT during final writing audits the response and leaves no automatically runnable follow-on job', async () => {
  responseMode='signal-final';
  const result = await runSingleArticle(options());
  assert.equal(result.status,'stopped'); assert.equal(calls,5);
  assert.ok((await sql`SELECT status FROM receipts`).every(r => ['received','completed'].includes(r.status)));
  assert.ok((await sql`SELECT status FROM receipt_attempts`).every(r => r.status==='received'));
  assert.equal((await sql`SELECT 1 FROM pgboss.job WHERE state IN ('created','active','retry')`).length,0);
  assert.ok((await sql`SELECT name,state FROM pgboss.job`).some(j=>j.name===QUEUES.group && j.state==='cancelled'));
});
