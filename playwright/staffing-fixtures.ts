import { expect, test as base, request, type APIRequestContext, type APIResponse } from '@playwright/test';
import { MongoClient } from 'mongodb';
import { createCourse, uniqueId, type DemoRole } from './helpers';

export async function ok(pending: Promise<APIResponse>) {
  const result = await pending;
  expect(result.status(), `${result.url()}: ${await result.text()}`).toBe(200);
  return result;
}
export async function json(pending: Promise<APIResponse>): Promise<any> { return (await ok(pending)).json(); }
export async function activateCycle(admin: Actor, term: any, overrides: Record<string, any> = {}) {
  const { cycle } = await json(admin.api.get('/api/staffing/cycle'));
  return (await json(admin.api.put('/api/staffing/cycle', { data: {
    termId: term.id, expectedVersion: cycle.version, enabled: true,
    opensAt: new Date(Date.now() - 86400000).toISOString(),
    closesAt: new Date(Date.now() + 3600000).toISOString(), ...overrides,
  } }))).cycle;
}
export async function database() {
  const uri = process.env.TEST_MONGODB_URI;
  const name = process.env.TEST_MONGODB_DB;
  if (!uri || !name || !/^campusworks_/.test(name) || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(uri).hostname)) {
    throw new Error('Database checks require the isolated loopback environment from npm run verify:local.');
  }
  const client = new MongoClient(uri);
  await client.connect();
  return { client, db: client.db(name) };
}
export type Actor = { api: APIRequestContext; email: string; role: DemoRole; user: any };
export type StaffingSpace = {
  code: string; suffix: string; admin: Actor; instructor: Actor; student: Actor; term: any;
  actor: (label: string, role?: DemoRole) => Promise<Actor>;
  opportunity: (overrides?: Record<string, any>, owner?: Actor) => Promise<any>;
  application: (opportunity: any, candidate?: Actor, overrides?: Record<string, any>) => Promise<any>;
  select: (application: any, reviewer?: Actor, key?: string) => Promise<any>;
  secondary: (actor: Actor) => Promise<APIRequestContext>;
};

export const test = base.extend<{ space: StaffingSpace }>({
  space: async ({ baseURL }, use) => {
    if (!baseURL || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseURL).hostname)) throw new Error('Use an isolated loopback demo.');
    const suffix = uniqueId();
    const clients: APIRequestContext[] = [];
    const courseIds: string[] = [];
    const opportunityIds: string[] = [];
    let term: any;
    const actor = async (label: string, role: DemoRole = 'student'): Promise<Actor> => {
      const api = await request.newContext({ baseURL });
      clients.push(api);
      const email = `${label}-${suffix}@example.com`;
      const response = await json(api.post('/api/auth/mock', { data: { as: role, email } }));
      return { api, email, role, user: response.user };
    };
    const admin = await actor('staffing-admin', 'admin');
    const instructor = await actor('faculty', 'instructor');
    const student = await actor('applicant');
    const code = `staff-${suffix}`;
    try {
      await createCourse(admin.api, code, [{ email: instructor.email, role: 'instructor' }]);
      courseIds.push(code);
      term = (await json(admin.api.post('/api/staffing/terms', { data: {
        name: `Synthetic term ${suffix}`, requiresApproval: false, startDate: new Date(Date.now() - 7 * 86400000).toISOString(), endDate: new Date(Date.now() + 60 * 86400000).toISOString(),
      } }))).term;
      await activateCycle(admin, term);
      const opportunity = async (overrides: Record<string, any> = {}, owner = instructor) => {
        const input = {
          type: 'ta', title: `Teaching assistant ${suffix}`, courseId: code, department: 'Computer Science',
          description: 'Synthetic opportunity for local verification.', positions: 1, weeklyHours: 10,
          appointmentStart: new Date(Date.now() - 3600000).toISOString(), appointmentEnd: new Date(Date.now() + 14 * 86400000).toISOString(),
          requiresAttendance: true, hasLab: true, hasDiscussion: true, requiresGrading: true, holdsOfficeHours: true,
          duties: [{ kind: 'office_hours', sessionsPerWeek: 2, minutesPerSession: 60 }, { kind: 'grading', sessionsPerWeek: 1, minutesPerSession: 120 }],
          requiredSkills: 'Algorithms and clear explanations', preferredSkills: 'Teaching experience', questions: [{ id: 'motivation', prompt: 'Why this course?', required: true }],
          cvRequired: true, approvalRequired: false, hourlyRate: 20, budget: 1200, ...overrides,
        };
        const result = (await json(owner.api.post('/api/staffing/opportunities', { data: input }))).opportunity;
        opportunityIds.push(result.id);
        return (await json(owner.api.post(`/api/staffing/opportunities/${result.id}/publish`, { data: { expectedVersion: result.version } }))).opportunity;
      };
      const application = async (posting: any, candidate = student, overrides: Record<string, any> = {}) => {
        let application = (await json(candidate.api.post(`/api/staffing/opportunities/${posting.id}/applications`, { data: {} }))).application;
        application = (await json(candidate.api.patch(`/api/staffing/applications/${application.id}`, { data: {
          expectedVersion: application.version,
          profile: { firstName: 'Synthetic', lastName: 'Applicant', preferredEmail: candidate.email, undergraduateMajors: 'Computer Science', department: 'Computer Science', positionPreference: 'either', priorTaExperience: false, priorCourses: '', multipleCourses: true, graduationTerm: term.name, availability: 'Weekday afternoons', availableHours: 20, skills: 'Algorithms', experience: 'Peer tutoring' },
          answers: { motivation: 'I enjoy explaining algorithms clearly.' }, qualificationText: 'Relevant algorithms coursework and peer tutoring.', ...overrides,
        } }))).application;
        application = (await json(candidate.api.post(`/api/staffing/applications/${application.id}/cv`, { multipart: { expectedVersion: String(application.version), file: { name: 'synthetic-cv.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic CV\nAlgorithms coursework\nPeer tutoring\n') } } }))).application;
        return (await json(candidate.api.post(`/api/staffing/applications/${application.id}/submit`, { data: {} }))).application;
      };
      const select = (application: any, reviewer = instructor, key = `select-${uniqueId()}`) => json(reviewer.api.post(`/api/staffing/applications/${application.id}/select`, { data: { expectedVersion: application.version, idempotencyKey: key } }));
      const secondary = async (actor: Actor) => {
        const origin = process.env.SECONDARY_BASE_URL;
        if (!origin || !['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw new Error('A second isolated application instance is required.');
        const api = await request.newContext({ baseURL: origin, storageState: await actor.api.storageState() });
        clients.push(api);
        return api;
      };
      await use({ code, suffix, admin, instructor, student, term, actor, opportunity, application, select, secondary });
    } finally {
      // Clean only identifiers created by this fixture, including failing runs.
      // The local runner also destroys the entire isolated database container.
      if (opportunityIds.length) {
        const { client, db } = await database();
        try {
          const applications = await db.collection('staffingApplications').find({ opportunityId: { $in: opportunityIds } }).toArray();
          const applicationIds = applications.map(record => record.id);
          for (const collection of ['staffingApplications', 'staffingDocuments', 'staffingOffers', 'staffingAppointments', 'staffingAllocations', 'staffingAiTasks', 'staffingAiSubscriptions', 'staffingAiRefreshJobs', 'staffingAiResultCache']) await db.collection(collection).deleteMany({ opportunityId: { $in: opportunityIds } });
          await db.collection('staffingOpportunities').deleteMany({ id: { $in: opportunityIds } });
          await db.collection('staffingCommands').deleteMany({ applicationId: { $in: applicationIds } });
        } finally { await client.close(); }
      }
      for (const course of courseIds) await admin.api.delete(`/api/courses/${course}`).catch(() => {});
      if (term) {
        const { client, db } = await database();
        try { await db.collection('staffingTerms').deleteOne({ id: term.id }); } finally { await client.close(); }
      }
      for (const api of clients) await api.dispose();
    }
  },
});
export { expect };
