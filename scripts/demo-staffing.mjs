import { request } from '@playwright/test';

export const staffingWindows = course => [
  { label: 'Student Queue', as: 'student', email: 'student@example.com', path: `/courses/${course}/student` },
  { label: 'TA Queue', as: 'ta', email: 'ta@example.com', path: `/courses/${course}/ta` },
  { label: 'Instructor', as: 'instructor', email: 'instructor@example.com', path: `/courses/${course}/admin` },
  { label: 'Administrator', as: 'admin', email: 'admin@example.com', path: '/admin/staffing' },
  { label: 'Student Applications', as: 'student', email: 'student2@example.com', path: '/opportunities' },
  { label: 'Faculty Recruitment', as: 'instructor', email: 'instructor@example.com', path: '/staffing' },
];

/** Prepare synthetic recruitment records through the ordinary authorized APIs. */
export async function prepareStaffingDemo(baseURL, course = 'cs101') {
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseURL).hostname)) throw new Error('Interactive demonstrations require a loopback app with demo login enabled.');
  const contexts = [];
  const call = async pending => {
    const response = await pending;
    if (!response.ok()) throw new Error(`Demonstration request failed: ${response.status()} ${await response.text()}`);
    return response.json();
  };
  const actor = async (as, email) => {
    const api = await request.newContext({ baseURL });
    contexts.push(api);
    await call(api.post('/api/auth/mock', { data: { as, email } }));
    return api;
  };
  const overview = async api => {
    const records = { terms: [], managedOpportunities: [] };
    for (let page = 1; ; page++) {
      const data = await call(api.get(`/api/staffing/overview?page=${page}`));
      for (const key of Object.keys(records)) records[key].push(...(data[key] || []));
      if (!data.pagination?.hasMore) return records;
      if (page >= 100) throw new Error('The demonstration catalog exceeds its supported setup size.');
    }
  };
  try {
    const admin = await actor('admin', 'admin@example.com');
    const instructor = await actor('instructor', 'instructor@example.com');
    const adminView = await overview(admin);
    const view = await overview(instructor);
    const courseView = await call(instructor.get(`/api/courses/${course}`));
    if (!courseView.isManager) throw new Error('The demonstration instructor must manage the selected course.');
    const linkedTermId = view.managedOpportunities.find(item => item.courseId === course)?.termId;
    let term = adminView.terms.find(item => item.id === linkedTermId);
    const name = `Local Demonstration ${new Date().getUTCFullYear()}`;
    term ||= adminView.terms.find(item => item.name === name && new Date(item.endDate).getTime() > Date.now() + 7 * 86400000);
    if (!term) term = (await call(admin.post('/api/staffing/terms', { data: { name, requiresApproval: true, startDate: new Date(Date.now() - 7 * 86400000).toISOString(), endDate: new Date(Date.now() + 90 * 86400000).toISOString() } }))).term;
    const current = (await call(admin.get('/api/staffing/cycle'))).cycle;
    await call(admin.put('/api/staffing/cycle', { data: {
      termId: term.id, expectedVersion: current.version, enabled: true,
      opensAt: new Date(Date.now() - 86400000).toISOString(), closesAt: new Date(Date.now() + 7 * 86400000).toISOString(),
    } }));
    const definitions = [
      { type: 'ta', courseId: course, title: `Teaching Assistant Demonstration (${course})` },
      { type: 'ra', courseId: '', title: 'Research Assistant Demonstration' },
    ];
    const opportunities = [];
    for (const definition of definitions) {
      let opportunity = view.managedOpportunities.find(item => item.title === definition.title && item.termId === term.id);
      if (!opportunity) {
        opportunity = (await call(instructor.post('/api/staffing/opportunities', { data: {
          ...definition, department: 'Computer Science', description: 'Synthetic local position. Use the application, review, offer and appointment controls to explore the complete workflow.',
          positions: 2, weeklyHours: 10, appointmentStart: new Date(Math.max(Date.now() - 86400000, new Date(term.startDate).getTime())).toISOString(), appointmentEnd: new Date(Math.min(Date.now() + 27 * 86400000, new Date(term.endDate).getTime())).toISOString(),
          requiredSkills: definition.type === 'ta' ? 'Programming and clear explanations' : 'Data analysis and research documentation', preferredSkills: 'Collaboration',
          requiresAttendance: definition.type === 'ta', hasLab: definition.type === 'ta', hasDiscussion: false, requiresGrading: definition.type === 'ta', holdsOfficeHours: definition.type === 'ta',
          duties: [{ kind: definition.type === 'ta' ? 'office_hours' : 'research', sessionsPerWeek: 2, minutesPerSession: 60 }],
          questions: [{ id: 'experience', prompt: 'Describe relevant coursework or experience.', required: true }], cvRequired: true, approvalRequired: true, hourlyRate: 20, budget: 6000,
        } }))).opportunity;
      }
      if (opportunity.status === 'draft') opportunity = (await call(instructor.post(`/api/staffing/opportunities/${opportunity.id}/publish`, { data: { expectedVersion: opportunity.version } }))).opportunity;
      if (opportunity.status === 'pending_approval') opportunity = (await call(admin.post(`/api/staffing/opportunities/${opportunity.id}/approve`, { data: { approved: true, expectedVersion: opportunity.version } }))).opportunity;
      opportunities.push(opportunity);
    }
    for (const [index, email] of ['student@example.com', 'student2@example.com'].entries()) {
      const student = await actor('student', email);
      const posting = opportunities[0];
      const existing = await call(student.get(`/api/staffing/opportunities/${posting.id}`));
      if (existing.application) continue;
      let application = (await call(student.post(`/api/staffing/opportunities/${posting.id}/applications`, { data: {} }))).application;
      application = (await call(student.patch(`/api/staffing/applications/${application.id}`, { data: {
        expectedVersion: application.version,
        profile: { firstName: 'Demo', lastName: `Student ${index + 1}`, preferredEmail: email, undergraduateMajors: 'Computer Science', department: 'Computer Science', positionPreference: 'half', priorTaExperience: false, priorCourses: '', multipleCourses: false, graduationTerm: term.name, availability: 'Weekday afternoons', availableHours: 10, skills: index ? 'Programming, data analysis and documentation' : 'Programming, algorithms and tutoring', experience: 'Synthetic coursework and peer collaboration', slots: [] },
        answers: { experience: 'Synthetic application for local exploration. No real student background is represented.' }, qualificationText: 'Synthetic programming coursework, collaboration and explanation practice.',
      } }))).application;
      application = (await call(student.post(`/api/staffing/applications/${application.id}/cv`, { multipart: { expectedVersion: String(application.version), file: { name: 'synthetic-demo-cv.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic demonstration CV\nProgramming coursework and collaboration.\nNo real applicant data.\n') } } }))).application;
      await call(student.post(`/api/staffing/applications/${application.id}/submit`, { data: {} }));
    }
    return { course, termId: term.id, opportunityIds: opportunities.map(item => item.id) };
  } finally { await Promise.allSettled(contexts.map(api => api.dispose())); }
}
