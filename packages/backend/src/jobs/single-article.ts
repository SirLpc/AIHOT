// Deliberately narrow first-article trial. No worker registration, schedules or recovery sweep.
import type { PgBoss } from 'pg-boss';
import { config, credential } from '../config.ts';
import { sql, type Db } from '../db.ts';
import { extractArticleBody } from '../content/extract.ts';
import { isHistorical } from '../content/materials.ts';
import { groupArticle } from '../events/group.ts';
import { invalidateModelCache, modelFor } from '../editorial/models.ts';
import { withPaidRequestGuard, BudgetExceededError } from '../providers/receipts.ts';
import { processArticle, queueProcessing } from './content.ts';
import { acquireQueueLease } from './queue-lease.ts';
import { enqueue, ensureQueue, getBoss, QUEUES, shutdownSignal } from './queue.ts';
import { validateTrialEnvironment, TRIAL_FORBIDDEN_KEYS, type TrialOptions } from '../../../../scripts/single-article-options.ts';

const CORE = [QUEUES.extractBody, QUEUES.analyze, QUEUES.group];
const OPTIONAL = [QUEUES.notifySelected, QUEUES.prepareMedia];
const PURPOSES = ['prefilter_article', 'score_article', 'structure_article', 'understand_article', 'summarize_article'];
const MAX_REQUESTS = 20;
const TRIAL_MS = 10 * 60_000;
const COST_WARNING = 'LLM receipts do not record a monetary cost. Request limits cannot guarantee a ¥1 cap; check the provider billing dashboard. ¥1 is only a monitoring target.';
const queueDb = (db: Db) => ({ executeSql: async (text: string, values?: unknown[]) => ({ rows: await db.unsafe(text, (values ?? []) as never[]) }) });

async function environmentCheck(db: Db = sql, resolveModels = true) {
  const env = { ...process.env };
  for (const key of ['LLM_BASE_URL', 'LLM_API_KEY', ...TRIAL_FORBIDDEN_KEYS]) env[key] = credential(key === 'JINA_API_KEY' || key === 'SOCIALDATA_API_KEY' ? 'collectors' : 'models', key) ?? undefined;
  validateTrialEnvironment(env);
  const overrides = await db`SELECT key FROM settings WHERE key LIKE 'models.%' AND value->>'model' IS DISTINCT FROM 'default'`;
  if (overrides.length) throw new Error('Remove non-default admin model overrides before the trial.');
  if (!resolveModels) return;
  invalidateModelCache();
  for (const step of ['prefilter', 'score', 'structure', 'understand', 'summarize', 'group', 'groupReview']) {
    if (await modelFor(step) !== 'default') throw new Error('Every trial capability must use the default model route.');
  }
}

async function isolationCheck(articleId: string, db: Db = sql, allowOptional = false) {
  const [a] = await db`SELECT a.*, s.kind, s.participation_mode FROM articles a JOIN sources s ON s.id=a.source_id WHERE a.id=${articleId}`;
  if (!a) throw new Error('Exact article ID not found.');
  if ((await db`SELECT id FROM articles WHERE id<>${articleId} LIMIT 1`).length) throw new Error('The target must be the only article in this first-trial database.');
  if (a.participation_mode !== 'editorial' || !['rss', 'web_list', 'json_list', 'external'].includes(a.kind) || a.x_post) throw new Error('Only ordinary editorial web articles are supported.');
  if ((await db`SELECT id FROM sources WHERE enabled LIMIT 1`).length) throw new Error('All sources must be paused before the trial.');
  if ((await db`SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND application_name='aihot-jobs' LIMIT 1`).length) throw new Error('A normal queue process is connected; stop API and worker first.');
  const [beat] = await db`SELECT value FROM settings WHERE key='heartbeat.worker'`;
  if (beat && (!Number.isFinite(Date.parse(beat.value?.at)) || Date.parse(beat.value.at) > Date.now()-3*60_000)) throw new Error('Worker heartbeat is recent or invalid; stop the worker and wait three minutes.');
  if ((await db`SELECT 1 FROM fetch_runs WHERE status='running' LIMIT 1`).length || (await db`SELECT 1 FROM job_runs WHERE status='running' AND job<>${`trial.article:${articleId}`} LIMIT 1`).length) throw new Error('Other work is running.');
  if ((await db`SELECT 1 FROM stories st WHERE NOT EXISTS (SELECT 1 FROM facts f JOIN fact_articles fa ON fa.fact_id=f.id WHERE f.story_id=st.id AND fa.article_id=${articleId}) LIMIT 1`).length || (await db`SELECT 1 FROM facts f WHERE NOT EXISTS (SELECT 1 FROM fact_articles fa WHERE fa.fact_id=f.id AND fa.article_id=${articleId}) LIMIT 1`).length) throw new Error('Existing unrelated events are not supported by this first-article trial.');
  if ((await db`SELECT 1 FROM receipts WHERE status IN ('pending','unknown') LIMIT 1`).length) throw new Error('A pending or unknown receipt needs manual audit; this command will not release or retry it.');
  const jobs = await db<{ id: string; name: string; state: string; data: Record<string, unknown>; start_after: Date }[]>`
    SELECT id,name,state,data,start_after FROM pgboss.job WHERE state IN ('created','retry','active') ORDER BY created_on,id`;
  if (jobs.some(j => j.state === 'active')) throw new Error('An active job exists; audit its owner and receipts before proceeding.');
  if (jobs.some(j => j.data?.articleId !== articleId || ![...CORE, ...(allowOptional ? OPTIONAL : [])].includes(j.name as never))) throw new Error('Other or foreign pending work exists; no jobs were consumed.');
  if (jobs.some(j => j.data.attemptTag || j.data.signalOnly)) throw new Error('Manual re-evaluation or signal jobs are outside this trial.');
  return { article: a, jobs };
}

export async function preflightArticle(options: TrialOptions) {
  await environmentCheck();
  const [schema] = await sql`SELECT to_regclass('pgboss.job') IS NOT NULL AND to_regclass('pgboss.queue') IS NOT NULL AND to_regclass('pgboss.schedule') IS NOT NULL AS ready`;
  if (!schema.ready) throw new Error('Queue schema is not initialized. Preflight never initializes it; finish the existing one-article import first.');
  const { article, jobs } = await isolationCheck(options.articleId);
  if ((await sql`SELECT 1 FROM pgboss.schedule LIMIT 1`).length) throw new Error('Existing schedules are outside this first-trial setup.');
  const [budget] = await sql`SELECT per_minute,per_hour,per_day FROM budgets WHERE service='llm'`;
  if (!budget || budget.per_minute<=0 || budget.per_minute>5 || budget.per_hour<=0 || budget.per_hour>20 || budget.per_day<=0 || budget.per_day>20) throw new Error('llm rolling request limits must be positive and no greater than 5/minute, 20/hour, 20/day.');
  const [progress] = await sql`SELECT (SELECT count(*) FROM receipt_attempts) AS requests, (SELECT count(*) FROM job_runs WHERE job=${`trial.article:${options.articleId}`}) AS trials`;
  if (!options.resume && (progress.requests || progress.trials || article.processing_state !== 'new' || article.processing_attempts)) throw new Error('Progress already exists. Review it, then explicitly use --resume if appropriate.');
  if (progress.requests >= MAX_REQUESTS) throw new Error('The first-article lifetime limit of 20 requests is exhausted.');
  if (jobs.filter(j => CORE.includes(j.name as never)).length > 1) throw new Error('Multiple pending processing jobs need review before this trial.');
  return { articleId: options.articleId, state: article.processing_state, historical: isHistorical(article as never), queuedJobs: jobs.length,
    remainingRequests: MAX_REQUESTS-Number(progress.requests), costWarning: COST_WARNING };
}

/** pg-boss cannot fetch by ID. Lock all job partitions and assert the exact row before committing. */
export async function claimArticleJob(boss: PgBoss, articleId: string) {
  return sql.begin(async tx => {
    await tx`SET LOCAL lock_timeout='3s'`;
    await tx`LOCK TABLE pgboss.job IN SHARE ROW EXCLUSIVE MODE NOWAIT`;
    const { jobs } = await isolationCheck(articleId, tx, true);
    const core = jobs.filter(j => CORE.includes(j.name as never));
    if (!core.length) return null;
    if (core.length !== 1) throw new Error('Multiple pending processing jobs need review.');
    const target = core[0];
    if (target.start_after > new Date()) throw new Error('Target job is deferred. Review it and resume only when it is due.');
    const changed = await boss.update(target.name, undefined, { id: target.id, retryLimit: 0, db: queueDb(tx) });
    if (changed.updated !== 1) throw new Error('Target job changed before claim.');
    const [job] = await boss.fetch<{ articleId: string }>(target.name, { batchSize: 1, db: queueDb(tx) });
    if (!job || job.id !== target.id || job.data.articleId !== articleId) throw new Error('Exact target claim failed; transaction rolled back.');
    return { id: job.id, name: target.name };
  });
}

async function cancelPending(boss: PgBoss, articleId: string, queues: string[] = OPTIONAL) {
  const jobs = await sql<{ id: string; name: string }[]>`SELECT id,name FROM pgboss.job WHERE data->>'articleId'=${articleId} AND name IN ${sql(queues)} AND state IN ('created','retry')`;
  for (const job of jobs) {
    const result = await boss.cancel(job.name, job.id);
    if (!('affected' in result) || result.affected !== 1) throw new Error('Target cancellation changed; manual review required.');
  }
  return jobs.length;
}

export async function runSingleArticle(options: TrialOptions) {
  const release = await acquireQueueLease('single-article');
  let timer: NodeJS.Timeout | undefined;
  const wasEnabled = config.modelCallsEnabled;
  let stopped = false;
  const stop = () => { stopped = true; shutdownSignal.abort(new Error('Single-article trial stopped; in-flight calls are settling')); };
  try {
    const preflight = await preflightArticle(options);
    if (!options.execute) return { ...preflight, status: 'preflight' as const, requests: 0, promptTokens: 0, completionTokens: 0 };
    const boss = await getBoss('single-article');
    for (const queue of CORE) await ensureQueue(queue);
    const [run] = await sql`INSERT INTO job_runs(job) VALUES(${`trial.article:${options.articleId}`}) RETURNING id`;
    const baseline = Number((await sql`SELECT coalesce(max(id),0) AS id FROM receipt_attempts`)[0].id);
    const outcome: { status: 'complete' | 'stopped' } = { status: 'stopped' };
    let skippedJobs = 0;
    timer = setTimeout(stop, TRIAL_MS);
    process.once('SIGTERM', stop); process.once('SIGINT', stop);
    config.modelCallsEnabled = true;
    try {
      await withPaidRequestGuard(async (req, db) => {
        shutdownSignal.signal.throwIfAborted();
        await environmentCheck(db, false);
        if (req.service !== 'llm' || req.model !== 'deepseek-flash' || !PURPOSES.includes(req.purpose) || !req.subject?.startsWith(`article:${options.articleId}@`)) throw new Error('Paid route outside the one-article trial.');
        if ((await db`SELECT 1 FROM receipts WHERE status='unknown' LIMIT 1`).length) throw new Error('Unknown paid outcome; no further requests.');
        if (Number((await db`SELECT count(*) AS n FROM receipt_attempts`)[0].n) >= MAX_REQUESTS) throw new BudgetExceededError('llm','trial total',86400);
      }, async () => {
        const [a] = await sql`SELECT * FROM articles WHERE id=${options.articleId}`;
        const pending = await sql`SELECT 1 FROM pgboss.job WHERE state IN ('created','retry') AND data->>'articleId'=${options.articleId} AND name IN ${sql(CORE)}`;
        if (!pending.length) {
          if (!['analyzed','blocked'].includes(a.processing_state)) await queueProcessing(options.articleId);
          else if (a.grouping_status !== 'complete' && (await sql`SELECT 1 FROM analyses WHERE article_id=${options.articleId} AND input_revision=${a.revision} AND relevance='pass'`).length) await enqueue(QUEUES.group, { articleId: options.articleId }, { singletonKey: options.articleId, retryLimit: 0 });
        }
        let failed = false;
        for (let step = 0; step < 4 && !stopped; step++) {
          const job = await claimArticleJob(boss, options.articleId);
          if (!job) break;
          let output: Record<string, unknown>;
          let ok = true;
          try {
            if (job.name === QUEUES.extractBody) {
              const state = await extractArticleBody(options.articleId);
              if (state !== 'ok' && state !== 'skipped') throw new Error('Body extraction was not confirmed');
              await sql`UPDATE articles SET processing_retry_at=NULL, processing_queued_at=NULL WHERE id=${options.articleId}`;
              await queueProcessing(options.articleId);
              output = { state };
            } else if (job.name === QUEUES.analyze) {
              output = await processArticle(options.articleId);
              ok = ['pass','block','unknown','fetching-body'].includes(String(output.state));
            } else output = { ...await groupArticle(options.articleId) };
          } catch {
            ok = false; output = { state: 'stopped', message: 'Review article and receipts before explicitly resuming.' };
            if (job.name === QUEUES.extractBody) await sql`UPDATE articles SET processing_error='extract: trial stopped before confirmed body', processing_queued_at=NULL WHERE id=${options.articleId}`;
          }
          const settled = ok ? await boss.complete(job.name, job.id, output) : await boss.fail(job.name, job.id, output);
          if (!('affected' in settled) || settled.affected !== 1) throw new Error('Target settlement failed; audit active job and receipts.');
          skippedJobs += await cancelPending(boss, options.articleId);
          if (!ok || stopped) { failed = true; break; }
        }
        if (!failed && !stopped) {
          const { article, jobs } = await isolationCheck(options.articleId);
          const [analysis] = await sql`SELECT relevance FROM analyses WHERE article_id=${options.articleId} AND input_revision=${article.revision} ORDER BY id DESC LIMIT 1`;
          if (!jobs.length && analysis && ((article.processing_state === 'blocked' && analysis.relevance === 'block') || (article.processing_state === 'analyzed' && (analysis.relevance !== 'pass' || article.grouping_status === 'complete')))) outcome.status = 'complete';
        }
      });
    } catch {
      outcome.status = 'stopped';
    } finally {
      // Never force-exit: processArticle waits for parallel model responses and receipts first.
      skippedJobs += await cancelPending(boss, options.articleId, outcome.status === 'complete' ? OPTIONAL : [...OPTIONAL, ...CORE]);
      const [usage] = await sql`SELECT count(*) AS requests, coalesce(sum((usage->>'prompt_tokens')::bigint),0) AS prompt_tokens,
        coalesce(sum((usage->>'completion_tokens')::bigint),0) AS completion_tokens FROM receipt_attempts WHERE id>${baseline}`;
      await sql`UPDATE job_runs SET status=${outcome.status === 'complete' ? 'ok' : 'failed'}, finished_at=now(),
        detail=${sql.json({ articleId: options.articleId, outcome: outcome.status, requests: Number(usage.requests), skippedJobs })},
        error=${outcome.status === 'complete' ? null : 'Trial stopped. Inspect article, jobs and receipt audit; no automatic retry.'} WHERE id=${run.id}`;
    }
    const [usage] = await sql`SELECT count(*) AS requests, coalesce(sum((usage->>'prompt_tokens')::bigint),0) AS prompt_tokens,
      coalesce(sum((usage->>'completion_tokens')::bigint),0) AS completion_tokens FROM receipt_attempts WHERE id>${baseline}`;
    return { ...preflight, status: outcome.status, requests: Number(usage.requests), promptTokens: Number(usage.prompt_tokens), completionTokens: Number(usage.completion_tokens), skippedJobs };
  } finally {
    if (timer) clearTimeout(timer);
    process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop);
    config.modelCallsEnabled = wasEnabled;
    await release();
  }
}
