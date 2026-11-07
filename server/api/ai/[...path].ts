import { defineEventHandler, getQuery, getRouterParam, readBody } from 'h3'
import { requireUser } from '../../utils/auth'
import { getDb } from '../../utils/db'
import { aiStatus, createAiTask, listAiTasks } from '../../utils/ai'
import { reconcileDueStaffing } from '../../utils/staffing-appointments'
import { fail, text } from '../../utils/staffing'
import { requestCandidateRefresh } from '../../utils/ai-refresh'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const path = getRouterParam(event, 'path') || ''
  if (event.method === 'GET' && path === 'status') return aiStatus()
  const db = await getDb()
  await reconcileDueStaffing(db)
  if (event.method === 'GET' && path === 'tasks') {
    const query = getQuery(event)
    const positiveInteger = (value: unknown, maximum: number) => {
      if (value === undefined) return undefined
      if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) fail(400, 'AI comparison page or size is invalid')
      const parsed = Number(value)
      if (!Number.isSafeInteger(parsed) || parsed > maximum) fail(400, 'AI comparison page or size is invalid')
      return parsed
    }
    const page = positiveInteger(query.page, 10000)
    const pageSize = positiveInteger(query.pageSize, 50)
    return listAiTasks(db, user, text(query.targetId, 'AI target', 64), text(query.kind, 'AI kind', 40), text(query.termId, 'Review term', 64), page, pageSize)
  }
  if (event.method === 'POST' && path === 'tasks') {
    const body = await readBody(event)
    return body?.kind === 'candidate_fit' ? requestCandidateRefresh(db, user, body) : createAiTask(db, user, body)
  }
  return fail(404, 'AI endpoint not found')
})
