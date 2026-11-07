import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test, expect, json, database } from '../staffing-fixtures';

test('interactive staffing setup is repeatable and prepares real submitted candidates for all four roles', async ({ baseURL, request }) => {
  const { prepareStaffingDemo, staffingWindows } = await import(pathToFileURL(resolve('scripts/demo-staffing.mjs')).href);
  const first = await prepareStaffingDemo(baseURL, 'cs101');
  try {
    const second = await prepareStaffingDemo(baseURL, 'cs101');
    expect(second).toEqual(first);
    const windows = staffingWindows('cs101');
    expect(windows).toHaveLength(6);
    expect([...new Set(windows.map((window: any) => window.as))].sort()).toEqual(['admin', 'instructor', 'student', 'ta']);
    await json(request.post('/api/auth/mock', { data: { as: 'admin', email: 'admin@example.com' } }));
    const posting = await json(request.get(`/api/staffing/opportunities/${first.opportunityIds[0]}`));
    expect(posting.opportunity.status).toBe('published');
    expect(posting.applications).toHaveLength(2);
    expect(posting.applications.every((item: any) => item.status === 'submitted' && item.submittedSnapshot.cvDocumentId)).toBe(true);
    expect(posting.offers).toHaveLength(0);
    const research = await json(request.get(`/api/staffing/opportunities/${first.opportunityIds[1]}`));
    expect(research.opportunity).toMatchObject({ type: 'ra', status: 'published' });
  } finally {
    const { client, db } = await database();
    try {
      for (const collection of ['staffingApplications', 'staffingDocuments', 'staffingOffers', 'staffingAppointments', 'staffingAllocations', 'staffingAiTasks', 'staffingAiSubscriptions', 'staffingAiRefreshJobs', 'staffingAiResultCache']) await db.collection(collection).deleteMany({ opportunityId: { $in: first.opportunityIds } });
      await db.collection('staffingOpportunities').deleteMany({ id: { $in: first.opportunityIds } });
      await db.collection('staffingTerms').deleteOne({ id: first.termId });
    } finally { await client.close(); }
  }
});
