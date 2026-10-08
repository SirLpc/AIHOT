// Narrow official release-page adapter. Never execute page JavaScript or read globalRelease.
import { collapseWhitespace, stripTags } from '../lib/text.ts';
import { sanitizeBody } from '../content/sanitize.ts';
import type { ExtractedBody } from '../content/extract.ts';
import { FetchError, type Candidate } from './types.ts';

export function tuanjieReleases(items: unknown[]): Candidate[] {
  return items.map((item) => {
    if (!item || typeof item !== 'object') throw new FetchError('Invalid Tuanjie release record');
    const r = item as Record<string, unknown>;
    if (typeof r.title !== 'string' || !/团结引擎|tuanjie/i.test(r.title) || typeof r.releaseNoteUrl !== 'string'
      || !/^\/editor[\w-]+\/release-note$/.test(r.releaseNoteUrl) || typeof r.publishTime !== 'number' || !Number.isFinite(r.publishTime)
      || typeof r.id !== 'string') throw new FetchError('Invalid Tuanjie release fields');
    const publishedAt = new Date(r.publishTime);
    if (!Number.isFinite(+publishedAt)) throw new FetchError('Invalid Tuanjie publication time');
    return {
      url: new URL(r.releaseNoteUrl, 'https://unity.cn').href, title: collapseWhitespace(stripTags(r.title)), publishedAt,
      excerpt: [r.title, r.releaseTags, typeof r.hubDeepLink === 'string' ? `Hub 内部标识 ${r.hubDeepLink}` : ''].filter(Boolean).join('；'),
      bodyStatus: 'pending' as const,
      raw: { externalId: r.id, displayVersion: [r.major,r.minor,r.maintenance].join('.'), hubDeepLink: r.hubDeepLink ?? null, releaseTags: r.releaseTags ?? null },
    };
  });
}

export function tuanjieReleaseBody(content: unknown, url: string): ExtractedBody {
  const parts: string[] = [];
  const walk = (value: unknown, depth = 0) => {
    if (depth > 12 || !value || typeof value !== 'object') return;
    const row = value as Record<string, unknown>;
    if (row.moduleName === 'RichText' && typeof row.richText === 'string') parts.push(row.richText);
    for (const [key, child] of Object.entries(row)) if (key !== 'richText') walk(child, depth + 1);
  };
  walk(content);
  if (!parts.length) throw new FetchError('Tuanjie CMS release body not found');
  const html = sanitizeBody(parts.join('\n'), url);
  const text = stripTags(html);
  if (!text.trim()) throw new FetchError('Tuanjie CMS release body is empty');
  return { html, text, images: [], via: 'readability' };
}
