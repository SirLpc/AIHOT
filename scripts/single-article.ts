// No worker entry point is imported. --execute changes the model valve only inside this process.
import { parseTrialArgs, TRIAL_USAGE } from './single-article-options.ts';

if (process.argv.slice(2).includes('--help')) {
  console.log(`${TRIAL_USAGE}\nDefault: read-only preflight. --execute: paid trial. --resume: explicit continuation after reviewing stored progress.\nStop API/Web/worker first; keep DB running. All sources paused; target must be the only article.\nCost is not enforced in yuan. A ¥1 target must be checked in the provider dashboard.`);
} else {
  try {
    const options = parseTrialArgs(process.argv.slice(2));
    const { runSingleArticle } = await import('@aihot/backend/jobs/single-article');
    const { stopBoss } = await import('@aihot/backend/jobs/queue');
    const { closeDb } = await import('@aihot/backend/db');
    try {
      const result = await runSingleArticle(options);
      console.log(JSON.stringify(result, null, 2));
      if (result.status === 'stopped') process.exitCode = 1;
    } finally { await stopBoss(); await closeDb(); }
  } catch (error) {
    // Configuration/preflight errors contain names and actions, never credential values or provider bodies.
    console.error(error instanceof Error ? error.message : 'Trial stopped. Review stored article/job/receipt state.');
    process.exitCode = 1;
  }
}
