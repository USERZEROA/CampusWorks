import type { IndexDescription } from 'mongodb'

export const aiAutomationIndexes: Array<[string, IndexDescription[]]> = [
  ['staffingAiAutomationJobs', [
    { key: { kind: 1, targetId: 1, termId: 1, page: 1, pageSize: 1 }, unique: true },
    { key: { status: 1, nextAttemptAt: 1, priority: -1 } },
    { key: { targetId: 1, kind: 1 } },
    { key: { kind: 1, nextObserveAt: 1, _id: 1 } },
  ]],
  ['staffingAiAutomationCache', [{ key: { scopeId: 1, inputHash: 1 }, unique: true }]],
  ['staffingAiAutomationHints', [
    { key: { nextAttemptAt: 1, priority: -1, createdAt: 1 } },
    { key: { kind: 1, nextAttemptAt: 1, createdAt: 1, _id: 1 } },
  ]],
]
