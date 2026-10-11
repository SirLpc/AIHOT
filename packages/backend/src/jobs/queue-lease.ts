// Normal queue processes may coexist; the one-article trial must be alone. A dedicated
// session owns this advisory lock until all in-flight work has settled.
import postgres from 'postgres';
import { config } from '../config.ts';
import { shutdownSignal } from '../lib/shutdown.ts';

export async function acquireQueueLease(mode: 'normal' | 'single-article'): Promise<() => Promise<void>> {
  let closing = false;
  const db = postgres(config.databaseUrl, { max: 1, idle_timeout: 0, max_lifetime: 0, connect_timeout: 10,
    onclose: () => { if (!closing) shutdownSignal.abort(new Error('Queue isolation connection lost')); },
  });
  try {
    const [row] = mode === 'normal'
      ? await db`SELECT pg_try_advisory_lock_shared(714092, 1) AS acquired`
      : await db`SELECT pg_try_advisory_lock(714092, 1) AS acquired`;
    if (!row.acquired) throw new Error('Another queue process or single-article trial is active; stop it first.');
    return async () => { closing = true; await db.end({ timeout: 5 }); };
  } catch (error) {
    closing = true;
    await db.end({ timeout: 5 });
    throw error;
  }
}
