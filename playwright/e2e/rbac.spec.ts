import { test, expect, type APIRequestContext } from '@playwright/test';
import { apiAs, createCourse, uniqueId } from '../helpers';

/**
 * API-level permission matrix: every role is checked against the endpoints
 * it must NOT be able to use, plus the ones it must be able to use.
 */
test.describe('role-based access control (API)', () => {
  const id = uniqueId();
  const code = `rbac-${id}`;
  const emails = {
    student: `stu-${id}@example.com`,
    other: `stu2-${id}@example.com`,
    outsider: `out-${id}@example.com`,
    ta: `ta-${id}@example.com`,
    instructor: `ins-${id}@example.com`,
  };

  let admin: APIRequestContext;
  let student: APIRequestContext;
  let other: APIRequestContext;
  let outsider: APIRequestContext;
  let ta: APIRequestContext;
  let instructor: APIRequestContext;

  test.beforeAll(async () => {
    admin = await apiAs('admin');
    await createCourse(admin, code, [
      { email: emails.student, role: 'student' },
      { email: emails.other, role: 'student' },
      { email: emails.ta, role: 'ta' },
      { email: emails.instructor, role: 'instructor' },
    ]);
    student = await apiAs('student', emails.student);
    other = await apiAs('student', emails.other);
    outsider = await apiAs('student', emails.outsider);
    ta = await apiAs('ta', emails.ta);
    instructor = await apiAs('instructor', emails.instructor);

    expect((await ta.patch(`/api/courses/${code}/state`, { data: { state: 'open' } })).status()).toBe(200);
    expect((await ta.post(`/api/courses/${code}/ta-duty`, { data: { onDuty: true } })).status()).toBe(200);
  });

  test.afterAll(async () => {
    await admin.delete(`/api/courses/${code}`);
    await Promise.all([admin, student, other, outsider, ta, instructor].map(api => api.dispose()));
  });

  test('students cannot use staff or admin endpoints', async () => {
    const forbidden = [
      student.patch(`/api/courses/${code}/state`, { data: { state: 'closed' } }),
      student.get(`/api/courses/${code}/admin`),
      student.post(`/api/courses/${code}/announcements`, { data: { message: 'hi' } }),
      student.post(`/api/courses/${code}/ta-duty`, { data: { onDuty: true } }),
      student.patch(`/api/courses/${code}/enrollments/role`, { data: { email: emails.student, role: 'ta' } }),
      student.post(`/api/courses/${code}/enrollments/kick`, { data: { email: emails.other } }),
      student.delete(`/api/courses/${code}`),
      student.post('/api/courses', { data: { code: `x-${id}`, title: 'x' } }),
    ];
    for (const res of await Promise.all(forbidden)) {
      expect(res.status(), res.url()).toBe(403);
    }
  });

  test('students only see their own email in the queue and only edit their own entry', async () => {
    expect((await student.post(`/api/courses/${code}/queue/join`, { data: { action: 'join', location: 'A' } })).status()).toBe(200);
    expect((await other.post(`/api/courses/${code}/queue/join`, { data: { action: 'join', location: 'B' } })).status()).toBe(200);

    const view = await (await student.get(`/api/courses/${code}`)).json();
    const mine = view.queue.find((e: any) => e.isMine);
    const theirs = view.queue.find((e: any) => !e.isMine);
    expect(mine.email).toBe(emails.student);
    expect(theirs.email).toBe('');

    const pauseOther = await student.post(`/api/courses/${code}/queue/pause`, {
      data: { entryId: theirs.id, paused: true },
    });
    expect(pauseOther.status()).toBe(403);
    const assign = await student.post(`/api/courses/${code}/queue/assign`, {
      data: { entryId: theirs.id, assign: true },
    });
    expect(assign.status()).toBe(403);

    // Staff see every email.
    const staffView = await (await ta.get(`/api/courses/${code}`)).json();
    expect(staffView.queue.map((e: any) => e.email).sort()).toEqual([emails.other, emails.student].sort());
  });

  test('users who are not enrolled cannot join, give feedback or see the queue', async () => {
    const view = await (await outsider.get(`/api/courses/${code}`)).json();
    expect(view.enrolled).toBe(false);
    expect(view.queue).toEqual([]);
    expect(view.queueLength).toBeGreaterThan(0);

    expect((await outsider.post(`/api/courses/${code}/queue/join`, { data: { action: 'join', location: 'X' } })).status()).toBe(403);
    const feedback = await outsider.post(`/api/courses/${code}/feedback`, {
      data: { category: 'queue', rating: 5, positive: 'a', negative: 'b' },
    });
    expect(feedback.status()).toBe(403);
  });

  test('TAs run the queue but cannot manage the course', async () => {
    expect((await ta.get(`/api/courses/${code}/admin`)).status()).toBe(403);
    expect(
      (await ta.patch(`/api/courses/${code}/enrollments/role`, { data: { email: emails.other, role: 'ta' } })).status()
    ).toBe(403);
    expect((await ta.post(`/api/courses/${code}/announcements`, { data: { message: 'Room moved' } })).status()).toBe(200);

    const view = await (await ta.get(`/api/courses/${code}`)).json();
    const entry = view.queue[0];
    expect((await ta.post(`/api/courses/${code}/queue/assign`, { data: { entryId: entry.id, assign: true } })).status()).toBe(200);
    const after = await (await ta.get(`/api/courses/${code}`)).json();
    expect(after.queue.find((e: any) => e.id === entry.id).assignedToMe).toBe(true);
  });

  test('one active entry per TA: claiming a second entry releases the first', async () => {
    const view = await (await ta.get(`/api/courses/${code}`)).json();
    const [first, second] = view.queue;
    await ta.post(`/api/courses/${code}/queue/assign`, { data: { entryId: first.id, assign: true } });
    await ta.post(`/api/courses/${code}/queue/assign`, { data: { entryId: second.id, assign: true } });
    const after = await (await ta.get(`/api/courses/${code}`)).json();
    const claimed = after.queue.filter((e: any) => e.assignedToMe).map((e: any) => e.id);
    expect(claimed).toEqual([second.id]);
  });

  test('instructors manage people but not the admin role or the course itself', async () => {
    expect((await instructor.get(`/api/courses/${code}/admin`)).status()).toBe(200);
    expect(
      (await instructor.patch(`/api/courses/${code}/enrollments/role`, { data: { email: emails.other, role: 'ta' } })).status()
    ).toBe(200);
    expect(
      (await instructor.patch(`/api/courses/${code}/enrollments/role`, { data: { email: emails.other, role: 'admin' } })).status()
    ).toBe(403);
    expect(
      (await instructor.patch(`/api/courses/${code}/enrollments/role`, { data: { email: emails.instructor, role: 'student' } })).status()
    ).toBe(400);
    expect(
      (await instructor.post(`/api/courses/${code}/enrollments/kick`, { data: { email: 'admin@example.com' } })).status()
    ).toBe(403);
    expect((await instructor.delete(`/api/courses/${code}`)).status()).toBe(403);
  });

  test('input validation rejects malformed requests', async () => {
    expect((await ta.post(`/api/courses/${code}/queue/move`, { data: { entryId: 'nope', direction: 'up' } })).status()).toBe(400);
    expect((await ta.patch(`/api/courses/${code}/state`, { data: { state: 'party' } })).status()).toBe(400);
    expect((await student.post(`/api/courses/${code}/queue/join`, { data: { action: 'join', location: '' } })).status()).toBe(400);
    expect(
      (await student.post(`/api/courses/${code}/feedback`, { data: { category: 'queue', rating: 9, positive: 'a', negative: 'b' } })).status()
    ).toBe(400);
    expect((await admin.post('/api/courses', { data: { code: 'bad code!', title: 'x' } })).status()).toBe(400);
    expect((await admin.post('/api/courses', { data: { code, title: 'dup' } })).status()).toBe(409);
    expect((await student.get('/api/courses/does-not-exist')).status()).toBe(404);
  });
});
