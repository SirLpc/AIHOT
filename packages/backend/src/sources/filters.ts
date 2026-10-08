// Source-list admission rules shared by collection and the administrator's preview.
import type { Candidate, SourceRow } from "./types.ts";
import { allowed } from "./web-list.ts";

/**
 * What a source keeps from its listing: links inside its URL prefix rules (matched as listed), then
 * moved by its URL rewrite, without its denied categories and noise, inside its publication window.
 * Collection and the preview both read listings through it, so a preview shows what a run would store.
 */
export function admitListing<C extends Candidate>(candidates: C[], source: SourceRow, now = Date.now()): C[] {
  const kept = candidates.filter((c) => allowed(c.url, source)).map((c) => rewriteUrl(c, source)).filter((c) => !noiseFiltered(c, source));
  return filterPublicationWindow(kept, source.config.publishedAfter, now);
}

export function noiseFiltered(c: Candidate, source: SourceRow): boolean {
  const f = source.config.ingestNoiseFilter;
  const cats: string[] = c.categories ?? [];
  if (source.config.denyCategories?.some((d: string) => cats.includes(d))) return true;
  if (source.config.allowCategories?.length && !source.config.allowCategories.some((a: string) => cats.includes(a))) return true;
  if (!f) return false;
  // Case-insensitive: the exemption "agent" keeps "Agent" (words in the lists are lower case).
  const has = (text: string, words: string[] | undefined) => (words ?? []).some((k) => text.includes(k.toLowerCase()));
  const title = c.title.toLowerCase();
  const hay = `${title}\n${(c.excerpt ?? "").toLowerCase()}`;
  if (f.requireMatches?.length && !has(hay, f.requireMatches)) return true;
  if (has(hay, f.keepIfMatches)) return false;
  return has(title, f.dropMarkersTitleOnly) || has(hay, f.dropMarkers);
}

function rewriteUrl<C extends Candidate>(c: C, source: SourceRow): C {
  const rw = source.config.itemUrlPrefixRewrite;
  if (rw?.from && rw?.to && c.url.startsWith(rw.from)) return { ...c, url: rw.to + c.url.slice(rw.from.length) };
  return c;
}

/** A fixed publication boundary excludes history and dates that cannot prove an item is in range. */
function filterPublicationWindow<C extends Candidate>(candidates: C[], publishedAfter: string | undefined, now: number): C[] {
  const after = publishedAfter ? Date.parse(publishedAfter) : null;
  const latest = now;
  return candidates.filter(c => (!c.publishedAt || c.publishedAt.getTime() <= latest) && (after === null || !!c.publishedAt && c.publishedAt.getTime() > after));
}
