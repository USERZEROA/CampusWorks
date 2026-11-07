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
    const page = query.page === undefined ? undefined : Number(query.page)
    const pageSize = query.pageSize === undefined ? undefined : Number(query.pageSize)
    if ((page !== undefined && (!Number.isInteger(page) || page < 1 || page > 10000)) || (pageSize !== undefined && (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50))) fail(400, 'AI comparison page or size is invalid')
    return listAiTasks(db, user, text(query.targetId, 'AI target', 64), text(query.kind, 'AI kind', 40), text(query.termId, 'Review term', 64), page, pageSize)
  }
  if (event.method === 'POST' && path === 'tasks') {
    const body = await readBody(event)
    return body?.kind === 'candidate_fit' ? requestCandidateRefresh(db, user, body) : createAiTask(db, user, body)
  }
  return fail(404, 'AI endpoint not found')
})
