import type { Db } from 'mongodb';
import { createHash } from 'node:crypto';

export function aiUsageActorKey(user: { id?: string; email: string; provider?: string }) {
  if (!process.env.AI_USAGE_DATABASE?.trim()) return user.id || user.email;
  return `shared:${createHash('sha256').update(JSON.stringify([user.provider || '', user.email.trim().toLowerCase()])).digest('hex')}`;
}

/** Provider limits may outlive disposable presentation records. */
export function aiUsageCollection(db: Db) {
  const name = process.env.AI_USAGE_DATABASE?.trim();
  if (!name) return db.collection<any>('staffingAiBudgets');
  if (!/^[a-zA-Z][a-zA-Z0-9_]{0,62}$/.test(name) || ['admin', 'config', 'local'].includes(name.toLowerCase())) {
    throw new Error('The AI usage database configuration is invalid.');
  }
  return db.client.db(name).collection<any>('staffingAiBudgets');
}
