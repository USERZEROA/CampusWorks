import { defineEventHandler, getQuery, getRouterParam, readBody } from 'h3'
import { requireUser } from '../../utils/auth'
import { getDb } from '../../utils/db'
import { aiStatus, createAiTask, listAiTasks } from '../../utils/ai'
import { reconcileDueStaffing } from '../../utils/staffing-appointments'
import { fail, text } from '../../utils/staffing'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const path = getRouterParam(event, 'path') || ''
  if (event.method === 'GET' && path === 'status') return aiStatus()
  const db = await getDb()
  await reconcileDueStaffing(db)
  if (event.method === 'GET' && path === 'tasks') return listAiTasks(db, user, text(getQuery(event).targetId, 'AI target', 64))
  if (event.method === 'POST' && path === 'tasks') return createAiTask(db, user, await readBody(event))
  return fail(404, 'AI endpoint not found')
})
