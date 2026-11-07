import { request } from '@playwright/test';

const maps = ['actors', 'courseIds', 'termIds', 'opportunityIds', 'applicationIds', 'offerIds', 'appointmentIds', 'actions'];
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right))) : item);

/** Seed operator-owned synthetic decisions through the same APIs as the UI. */
export async function seedShowcaseApi({ baseURL, catalog, manifest = {}, save = async () => {} }) {
  const address = new URL(baseURL);
  if (!['http:', 'https:'].includes(address.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(address.hostname) || address.username || address.password || address.search || address.hash || !catalog?.synthetic || !catalog.marker) throw new Error('The showcase requires a local synthetic workspace.');
  if (manifest.marker && (manifest.marker !== catalog.marker || manifest.referenceTime !== catalog.referenceTime || manifest.version !== catalog.version)) throw new Error('Resume with the saved demonstration catalog and reference time.');
  manifest.marker = catalog.marker;
  manifest.referenceTime = catalog.referenceTime;
  manifest.version = catalog.version;
  for (const key of maps) manifest[key] ||= {};
  if (manifest.apiComplete) return manifest;
  const contexts = new Map();
  const actors = new Map(catalog.actors.map(actor => [actor.key, actor]));
  const opportunities = new Map(catalog.opportunities.map(opportunity => [opportunity.key, opportunity]));
  const checkpoint = async (key, operation) => {
    if (manifest.actions[key]) return;
    await operation();
    manifest.actions[key] = true;
    await save(manifest);
  };
  const call = async (actorKey, method, path, options = {}) => {
    const context = contexts.get(actorKey);
    if (!context) throw new Error(`The demonstration actor is unavailable: ${actorKey}.`);
    const response = await context[method](path, options);
    if (!response.ok()) throw new Error(`Demonstration API ${method.toUpperCase()} failed (${response.status()}) at ${path.split('?')[0]}.`);
    return response.json();
  };
  const allOverview = async actorKey => {
    const result = { terms: [], managedOpportunities: [] };
    for (let page = 1; page <= 100; page++) {
      const current = await call(actorKey, 'get', `/api/staffing/overview?page=${page}`);
      for (const key of Object.keys(result)) result[key].push(...(current[key] || []));
      if (!current.pagination?.hasMore) return result;
    }
    throw new Error('The demonstration catalog exceeds the supported setup size.');
  };
  const applicationDetail = application => call(application.actorKey, 'get', `/api/staffing/applications/${manifest.applicationIds[application.key]}`);
  const postingDetail = opportunity => call(opportunity.ownerKey, 'get', `/api/staffing/opportunities/${manifest.opportunityIds[opportunity.key]}`);
  const opportunityAction = async (opportunity, action, extra = {}, actorKey = opportunity.ownerKey) => {
    const { opportunity: current } = await postingDetail(opportunity);
    return call(actorKey, 'post', `/api/staffing/opportunities/${current.id}/${action}`, { data: { expectedVersion: current.version, ...extra } });
  };
  try {
    for (const actor of catalog.actors) {
      const api = await request.newContext({ baseURL: address.origin });
      contexts.set(actor.key, api);
      const result = await call(actor.key, 'post', '/api/auth/mock', { data: { as: actor.role, email: actor.email, name: actor.name } });
      manifest.actors[actor.key] = { id: result.user.id, email: actor.email, name: actor.name, role: actor.role };
      await save(manifest);
    }
    await save(manifest);
    for (const course of catalog.courses) {
      await checkpoint(`course:${course.key}`, async () => {
        const existing = await contexts.get('admin').get(`/api/courses/${encodeURIComponent(course.code)}`);
        if (existing.ok()) manifest.courseIds[course.key] = (await existing.json()).id;
        else if (existing.status() === 404) manifest.courseIds[course.key] = (await call('admin', 'post', '/api/courses', { data: { code: course.code, title: course.title } })).id;
        else throw new Error(`The demonstration course could not be inspected (${existing.status()}).`);
      });
      const courseId = manifest.courseIds[course.key];
      for (const [actorKey, role] of [[course.instructorKey, 'instructor'], ...course.taKeys.map(key => [key, 'ta'])]) await checkpoint(`grant:${course.key}:${actorKey}`, () => call('admin', 'patch', `/api/courses/${courseId}/enrollments/role`, { data: { email: actors.get(actorKey).email, role } }));
      for (const actorKey of course.studentKeys) await checkpoint(`enroll:${course.key}:${actorKey}`, () => call(actorKey, 'post', '/api/courses/enroll', { data: { courseId, enroll: true } }));
      for (const [index, message] of course.announcements.entries()) await checkpoint(`announcement:${course.key}:${index}`, async () => {
        const current = await call(course.instructorKey, 'get', `/api/courses/${courseId}`);
        if (!current.announcements.some(announcement => announcement.message === message)) await call(course.instructorKey, 'post', `/api/courses/${courseId}/announcements`, { data: { message } });
      });
      await checkpoint(`queue-state:${course.key}`, async () => {
        const current = await call(course.instructorKey, 'get', `/api/courses/${courseId}`);
        if (current.state !== course.queueState) await call(course.instructorKey, 'patch', `/api/courses/${courseId}/state`, { data: { state: course.queueState } });
      });
    }
    let overview = await allOverview('admin');
    for (const [termKey, input] of Object.entries(catalog.terms)) await checkpoint(`term:${termKey}`, async () => {
      const existing = overview.terms.find(term => term.name === input.name && new Date(term.startDate).toISOString() === input.startDate && new Date(term.endDate).toISOString() === input.endDate);
      manifest.termIds[termKey] = existing?.id || (await call('admin', 'post', '/api/staffing/terms', { data: input })).term.id;
    });
    await checkpoint('recruitment-cycle', async () => {
      const { cycle } = await call('admin', 'get', '/api/staffing/cycle');
      const requested = { termId: manifest.termIds[catalog.cycle.termKey], enabled: catalog.cycle.enabled, opensAt: catalog.cycle.opensAt, closesAt: catalog.cycle.closesAt };
      if (cycle.termId !== requested.termId || cycle.enabled !== requested.enabled || new Date(cycle.opensAt).toISOString() !== requested.opensAt || new Date(cycle.closesAt).toISOString() !== requested.closesAt) await call('admin', 'put', '/api/staffing/cycle', { data: { ...requested, expectedVersion: cycle.version } });
    });
    overview = await allOverview('admin');
    // Prepare every open posting before submitting applications. Closing,
    // filling and archiving happen only after their dependent records exist.
    for (const opportunity of catalog.opportunities) {
      await checkpoint(`opportunity:${opportunity.key}`, async () => {
        const input = { ...opportunity.input, termId: manifest.termIds[opportunity.termKey], courseId: opportunity.courseKey ? manifest.courseIds[opportunity.courseKey] : '' };
        const existing = overview.managedOpportunities.find(item => item.title === input.title && item.termId === input.termId && item.ownerId === manifest.actors[opportunity.ownerKey].id);
        manifest.opportunityIds[opportunity.key] = existing?.id || (await call(opportunity.ownerKey, 'post', '/api/staffing/opportunities', { data: input })).opportunity.id;
      });
      if (opportunity.stage === 'draft') continue;
      await checkpoint(`publish:${opportunity.key}`, async () => {
        const current = (await postingDetail(opportunity)).opportunity;
        if (current.status === 'draft') await opportunityAction(opportunity, 'publish');
      });
      if (opportunity.stage === 'pending_approval') continue;
      await checkpoint(`approve:${opportunity.key}`, async () => {
        const current = (await postingDetail(opportunity)).opportunity;
        if (current.status === 'pending_approval') await opportunityAction(opportunity, 'approve', { approved: true }, 'admin');
      });
    }
    for (const application of catalog.applications) {
      await checkpoint(`application:${application.key}`, async () => {
        const opportunityId = manifest.opportunityIds[application.opportunityKey];
        const existing = await call(application.actorKey, 'get', `/api/staffing/opportunities/${opportunityId}`);
        manifest.applicationIds[application.key] = existing.application?.id || (await call(application.actorKey, 'post', `/api/staffing/opportunities/${opportunityId}/applications`, { data: {} })).application.id;
      });
      const applicationId = manifest.applicationIds[application.key];
      await checkpoint(`save:${application.key}`, async () => {
        const { application: current } = await applicationDetail(application);
        const input = { profile: application.profile, answers: application.answers, qualificationText: application.qualificationText };
        if (canonical({ profile: current.profile, answers: current.answers, qualificationText: current.qualificationText }) !== canonical(input)) await call(application.actorKey, 'patch', `/api/staffing/applications/${applicationId}`, { data: { expectedVersion: current.version, ...input } });
      });
      if (application.seedActions.includes('cv')) await checkpoint(`cv:${application.key}`, async () => {
        const { application: current } = await applicationDetail(application);
        if (!current.cvDocumentId && application.cv) await call(application.actorKey, 'post', `/api/staffing/applications/${applicationId}/cv`, { multipart: { expectedVersion: String(current.version), file: { name: application.cv.name, mimeType: 'text/plain', buffer: Buffer.from(application.cv.text) } } });
      });
      if (application.seedActions.includes('submit')) await checkpoint(`submit:${application.key}`, async () => {
        const { application: current } = await applicationDetail(application);
        if (!current.submittedAt) await call(application.actorKey, 'post', `/api/staffing/applications/${applicationId}/submit`, { data: { expectedVersion: current.version } });
      });
    }
    for (const application of catalog.applications) {
      const opportunity = opportunities.get(application.opportunityKey);
      const applicationId = manifest.applicationIds[application.key];
      for (const action of application.seedActions.filter(action => !['save', 'cv', 'submit'].includes(action))) await checkpoint(`${action}:${application.key}`, async () => {
        let detail = await applicationDetail(application);
        if (['review', 'shortlist', 'reject', 'withdraw'].includes(action)) {
          const expected = { review: 'under_review', shortlist: 'shortlisted', reject: 'not_selected', withdraw: 'withdrawn' }[action];
          if (detail.application.status !== expected) await call(action === 'withdraw' ? application.actorKey : opportunity.ownerKey, 'post', `/api/staffing/applications/${applicationId}/${{ review: 'shortlist', shortlist: 'shortlist', reject: 'reject', withdraw: 'withdraw' }[action]}`, { data: action === 'withdraw' ? {} : { shortlisted: action === 'shortlist', reason: application.reason || 'Synthetic reviewer decision.' } });
          return;
        }
        if (action === 'select') {
          if (!detail.offer || !detail.appointment) detail = { ...detail, ...await call(opportunity.ownerKey, 'post', `/api/staffing/applications/${applicationId}/select`, { data: { expectedVersion: detail.application.version, idempotencyKey: `showcase-select-${application.key}` } }) };
          manifest.offerIds[application.key] = detail.offer.id;
          manifest.appointmentIds[application.key] = detail.appointment.id;
          return;
        }
        const offerId = manifest.offerIds[application.key] || detail.offer?.id;
        const appointmentId = manifest.appointmentIds[application.key] || detail.appointment?.id;
        if (['accept', 'decline', 'rescind'].includes(action)) {
          if (detail.offer?.status === 'issued') await call(action === 'rescind' ? opportunity.ownerKey : application.actorKey, 'post', `/api/staffing/offers/${offerId}/${action}`, { data: { reason: application.reason } });
        } else if (action === 'administrative') {
          if (canonical(detail.application.administrative || {}) !== canonical(application.administrative)) await call('admin', 'post', `/api/staffing/applications/${applicationId}/administrative`, { data: { administrative: application.administrative, expectedAdministrativeVersion: detail.application.administrativeVersion || 0, reason: 'Synthetic demonstration appointment setup.' } });
        } else if (action.startsWith('clearance:')) {
          const status = action.split(':')[1];
          if (detail.appointment?.clearance !== status) await call('admin', 'post', `/api/staffing/appointments/${appointmentId}/clearance`, { data: { status, reason: application.reason || 'Synthetic checklist completed by the demonstration administrator.' } });
        } else if (action === 'workload') {
          for (const observation of catalog.workloads.filter(record => record.applicationKey === application.key)) await checkpoint(`workload-record:${observation.key}`, () => call(opportunity.ownerKey, 'post', '/api/staffing/workload', { data: { appointmentId, date: observation.date, kind: observation.kind, hours: observation.hours, notes: observation.notes, idempotencyKey: `showcase-${observation.key}` } }));
        } else if (action === 'suspend' || action === 'end') {
          if (detail.appointment?.status !== (action === 'suspend' ? 'suspended' : 'ended')) await call(opportunity.ownerKey, 'post', `/api/staffing/appointments/${appointmentId}/${action}`, { data: { reason: application.reason } });
        } else if (action === 'settle') {
          if (detail.appointment?.budgetStatus !== 'settled') await call('admin', 'post', `/api/staffing/appointments/${appointmentId}/settle`, { data: { incurredCost: Math.round(detail.appointment.committedCost * (application.settlementRatio || 0) * 100) / 100 } });
        } else throw new Error(`Unknown synthetic application stage: ${action}.`);
      });
    }
    for (const opportunity of catalog.opportunities) if (['applications_closed', 'archived', 'cancelled'].includes(opportunity.stage)) await checkpoint(`finalize:${opportunity.key}`, async () => {
      const current = (await postingDetail(opportunity)).opportunity;
      if (current.status !== opportunity.stage) await opportunityAction(opportunity, { applications_closed: 'close', archived: 'archive', cancelled: 'cancel' }[opportunity.stage]);
    });
    await checkpoint('notifications', async () => {
      for (let batch = 0; batch < 100; batch++) {
        const progress = await call('admin', 'post', '/api/staffing/reconcile', { data: {} });
        if (!progress.hasMore && !progress.outbox?.hasMore) return;
      }
      throw new Error('Synthetic notification delivery still has pending batches.');
    });
    manifest.apiComplete = true;
    await save(manifest);
    return manifest;
  } finally {
    await Promise.allSettled([...contexts.values()].map(context => context.dispose()));
  }
}
