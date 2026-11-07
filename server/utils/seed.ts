// server/utils/seed.ts
import type { Db } from 'mongodb'

/**
 * Demo accounts offered by the mock login (see server/api/auth/mock.post.ts).
 * All addresses use the reserved example.com domain. Three students and two
 * TAs make it possible to demo the queue from several windows at once.
 */
export const DEMO_ACCOUNTS = [
  { email: 'student@example.com', name: 'Student User', role: 'student' },
  { email: 'student2@example.com', name: 'Student Two', role: 'student' },
  { email: 'student3@example.com', name: 'Student Three', role: 'student' },
  { email: 'ta@example.com', name: 'TA User', role: 'ta' },
  { email: 'ta2@example.com', name: 'TA Two', role: 'ta' },
  { email: 'instructor@example.com', name: 'Instructor User', role: 'instructor' },
  { email: 'admin@example.com', name: 'Admin User', role: 'admin' }
] as const

type DemoRole = (typeof DEMO_ACCOUNTS)[number]['role']
const accountsWithRole = (role: DemoRole) => DEMO_ACCOUNTS.filter((a) => a.role === role)

/** The default (first) demo account for each role. */
export const DEMO_USERS = {
  student: accountsWithRole('student')[0]!,
  ta: accountsWithRole('ta')[0]!,
  instructor: accountsWithRole('instructor')[0]!,
  admin: accountsWithRole('admin')[0]!
}

export const findDemoAccount = (email: string) =>
  DEMO_ACCOUNTS.find((a) => a.email === email)

const MINUTE = 60 * 1000
const DAY = 24 * 60 * MINUTE

/**
 * Seed a small, self-explanatory demo dataset when SEED_DEMO_DATA=true
 * and the database has no courses yet. Never touches a non-empty database.
 */
export async function seedDemoDataIfEmpty(db: Db) {
  const courses = db.collection('courses')
  if ((await courses.countDocuments({}, { limit: 1 })) > 0) return

  const now = Date.now()
  const students = accountsWithRole('student')
  const tas = accountsWithRole('ta')
  const { ta, instructor, admin } = DEMO_USERS

  await courses.insertMany([
    { id: 'cs101', code: 'cs101', title: 'Intro to Programming', state: 'open', onDutyTAs: [] },
    { id: 'cs201', code: 'cs201', title: 'Data Structures', state: 'closed', onDutyTAs: [] },
    { id: 'math221', code: 'math221', title: 'Linear Algebra', state: 'closed', onDutyTAs: [] }
  ])

  await db.collection('enrollments').insertMany([
    { courseId: 'cs101', userEmail: admin.email, role: 'admin' },
    { courseId: 'cs201', userEmail: admin.email, role: 'admin' },
    { courseId: 'math221', userEmail: admin.email, role: 'admin' },
    { courseId: 'cs101', userEmail: instructor.email, role: 'instructor' },
    { courseId: 'cs201', userEmail: instructor.email, role: 'instructor' },
    { courseId: 'cs201', userEmail: ta.email, role: 'ta' },
    ...tas.map((a) => ({ courseId: 'cs101', userEmail: a.email, role: 'ta' })),
    ...students.map((a) => ({ courseId: 'cs101', userEmail: a.email, role: 'student' }))
  ])

  await db.collection('announcements').insertOne({
    courseId: 'cs101',
    message:
      'Welcome! Join the queue with your location and a short question; a TA will pick you up.',
    by: instructor.name,
    createdAt: new Date(now - 2 * DAY)
  })

  // A few past help sessions so the analytics page has something to show.
  // Past students are student4..student9, distinct from the live demo accounts.
  const sessions = Array.from({ length: 16 }, (_, i) => {
    const helper = tas[i % tas.length]!
    const n = (i % 6) + 4
    const joinedAt = new Date(now - ((i % 8) + 1) * DAY - (i % 3) * 45 * MINUTE)
    const helpStartAt = new Date(joinedAt.getTime() + (3 + ((i * 7) % 15)) * MINUTE)
    const closedAt = new Date(helpStartAt.getTime() + (4 + ((i * 5) % 11)) * MINUTE)
    return {
      courseId: 'cs101',
      studentEmail: `student${n}@example.com`,
      studentName: `Student ${n}`,
      taEmail: helper.email,
      taName: helper.name,
      location: i % 2 ? 'Zoom' : 'Room 101, table 3',
      question: 'Demo question',
      joinedAt,
      helpStartAt,
      closedAt,
      leftQueueAt: closedAt,
      wasHelped: true,
      endReason: 'completed',
      removedBy: helper.email
    }
  })
  await db.collection('helpSessions').insertMany(sessions)

  await db.collection('feedback').insertOne({
    courseId: 'cs101',
    courseCode: 'cs101',
    studentEmail: 'student4@example.com',
    studentName: 'Student 4',
    category: 'wait',
    rating: 4,
    positive: 'Seeing my position in the queue was helpful.',
    negative: 'Wait times were long right before the deadline.',
    allowContact: false,
    createdAt: new Date(now - DAY)
  })

  console.log('[campusworks] Seeded demo data (SEED_DEMO_DATA=true).')
}
