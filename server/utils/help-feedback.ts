import { createError } from 'h3';

export type FeedbackHelper = { email: string; name: string; durationMs: number };

export function ownsHelpRecord(record: any, user: { id: string; email: string }) {
  return record.studentId
    ? record.studentId === user.id
    : String(record.studentEmail || '').trim().toLowerCase() === user.email.toLowerCase();
}

/** A rating can name only a helper with recorded contact in this ended request. */
export function feedbackHelpers(record: any, now = Date.now()): FeedbackHelper[] {
  const endedAt = new Date(record.leftQueueAt || record.closedAt || record.helpEndAt || '').getTime();
  if (record.wasHelped !== true || !Number.isFinite(endedAt) || endedAt > now) return [];
  const helpers = new Map<string, FeedbackHelper>();
  for (const segment of Array.isArray(record.helpSegments) ? record.helpSegments : []) {
    const email = typeof segment.taEmail === 'string' ? segment.taEmail.trim().toLowerCase() : '';
    const start = new Date(segment.startAt || '').getTime();
    const end = new Date(segment.endAt || '').getTime();
    if (!email || !Number.isFinite(start) || !Number.isFinite(end) || end <= start || end > endedAt) continue;
    const elapsed = end - start;
    const durationMs = typeof segment.durationMs === 'number' && Number.isFinite(segment.durationMs)
      ? Math.min(elapsed, Math.max(0, segment.durationMs)) : elapsed;
    const current = helpers.get(email) || { email, name: String(segment.taName || email), durationMs: 0 };
    current.durationMs += durationMs;
    helpers.set(email, current);
  }
  return [...helpers.values()].filter(helper => helper.durationMs >= 6000);
}

export function requireFeedbackHelper(record: any, user: { id: string; email: string }, email: string) {
  if (!ownsHelpRecord(record, user)) throw createError({ statusCode: 404, statusMessage: 'Help session not found' });
  const helper = feedbackHelpers(record).find(item => item.email === email);
  if (!helper || helper.email === user.email.toLowerCase()) throw createError({ statusCode: 400, statusMessage: 'Choose a recorded helper from your completed help session' });
  return helper;
}
