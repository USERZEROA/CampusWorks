import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { loginAs, open, uniqueId } from '../helpers';

/**
 * The full office-hours loop, driven through the UI with four identities
 * in separate browser contexts:
 * site admin creates a course and adds a TA → TA opens the queue and goes on
 * duty → student enrolls and joins → TA picks the student up and completes →
 * student leaves feedback → instructor reviews sessions and feedback →
 * TA closes the queue → site admin deletes the course.
 */
test.describe.serial('office-hours queue: full loop with four identities', () => {
  const id = uniqueId();
  const code = `flow-${id}`;
  const taEmail = `ta-${id}@example.com`;
  const studentEmail = `stu-${id}@example.com`;
  const student2Email = `stu2-${id}@example.com`;
  const instructorEmail = `ins-${id}@example.com`;

  let admin: Page;
  let ta: Page;
  let student: Page;
  const contexts: BrowserContext[] = [];

  async function newPage(browser: Browser) {
    const context = await browser.newContext();
    contexts.push(context);
    const page = await context.newPage();
    page.on('dialog', (dialog) => dialog.accept());
    return page;
  }

  test.beforeAll(async ({ browser }) => {
    admin = await newPage(browser);
    ta = await newPage(browser);
    student = await newPage(browser);
  });

  test.afterAll(async () => {
    for (const context of contexts) await context.close();
  });

  test('site admin creates the course and adds a TA', async () => {
    await open(admin, '/login');
    await admin.getByTestId('login-admin').click();
    await expect(admin).toHaveURL(/\/admin\/courses$/);

    await admin.getByTestId('admin-new-code').fill(code);
    await admin.getByTestId('admin-new-title').fill('E2E Office Hours');
    await admin.getByTestId('admin-create-btn').click();
    await expect(admin.getByTestId(`admin-course-row-${code}`)).toBeVisible();

    await admin.getByTestId(`admin-course-go-${code}`).click();
    await expect(admin).toHaveURL(new RegExp(`/courses/${code}/admin$`));
    await expect(admin.getByTestId('queue-state')).toHaveText('Closed');

    await admin.getByTestId('add-ta-email').fill(taEmail);
    await admin.getByTestId('add-ta-btn').click();
    await expect(admin.getByTestId(`enrollment-row-${taEmail}`)).toBeVisible();

    // Instructor is added through the same role API the role dropdown uses.
    const res = await admin.request.patch(`/api/courses/${code}/enrollments/role`, {
      data: { email: instructorEmail, role: 'instructor' },
    });
    expect(res.status()).toBe(200);
  });

  test('TA opens the queue and goes on duty', async () => {
    await open(ta, '/login');
    await ta.getByTestId('mock-email').fill(taEmail);
    await ta.getByTestId('login-ta').click();
    await expect(ta).toHaveURL(/\/courses$/);

    await ta.getByTestId(`my-course-go-${code}`).click();
    await expect(ta).toHaveURL(new RegExp(`/courses/${code}/ta$`));

    await ta.getByTestId('open-queue-btn').click();
    await expect(ta.getByTestId('queue-state')).toHaveText('Open');

    await ta.getByTestId('on-duty-btn').click();
    await expect(ta.getByTestId('on-duty-btn')).toHaveText('End Duty');
    await expect(ta.locator('.ta-name')).toContainText(taEmail.split('@')[0]!);
  });

  test('student must enroll before joining, then joins the queue', async () => {
    await open(student, '/login');
    await student.getByTestId('mock-email').fill(studentEmail);
    await student.getByTestId('login-student').click();
    await expect(student).toHaveURL(/\/courses$/);

    // Not enrolled yet: the course page asks to enroll first.
    await student.getByTestId(`course-go-${code}`).click();
    await expect(student).toHaveURL(new RegExp(`/courses/${code}/student$`));
    await expect(student.getByTestId('enter-queue-btn')).toHaveCount(0);
    await student.getByTestId('course-enroll-btn').click();

    await student.getByTestId('enter-queue-btn').click();
    await student.getByTestId('join-location').fill('Room 101, table 3');
    await student.getByTestId('join-question').fill('Why does my recursion never stop?');
    await student.getByTestId('join-confirm').click();

    await expect(student.getByTestId('queue-position')).toContainText('You are #1 in the queue.');
    await expect(student.getByTestId('queue-row-mine')).toContainText('Room 101, table 3');
  });

  test('TA picks the student up and completes the session', async () => {
    const row = ta.getByTestId(`ta-row-${studentEmail}`);
    await expect(row).toBeVisible();
    await expect(row).toContainText('Why does my recursion never stop?');

    await row.getByTestId('ta-select-btn').click();
    await expect(row.getByTestId('ta-select-btn')).toHaveText('Complete');

    // The student sees who is helping them.
    await expect(student.getByTestId('queue-position')).toContainText('is helping you now', {
      timeout: 15_000,
    });

    // Analytics ignore sessions shorter than ~6s (accidental clicks), so
    // keep this one a little longer before completing it.
    await ta.waitForTimeout(7_000);
    await row.getByTestId('ta-select-btn').click();
    await expect(ta.getByTestId(`ta-row-${studentEmail}`)).toHaveCount(0);

    await expect(student.getByTestId('queue-position')).toHaveCount(0, { timeout: 15_000 });
    await expect(student.getByTestId('enter-queue-btn')).toBeVisible();
  });

  test('student leaves feedback for the course', async () => {
    await student.getByTestId('feedback-open-btn').click();
    await student.getByTestId('fb-category').selectOption('ta');
    await student.getByTestId('fb-rating').selectOption('4');
    await student.getByTestId('fb-positive').fill('The TA explained base cases clearly.');
    await student.getByTestId('fb-negative').fill('Queue was long before the deadline.');
    await student.getByTestId('fb-submit').click();
    await expect(student.getByTestId('fb-submit')).toHaveCount(0);
  });

  test('a second student who leaves on their own is also recorded', async ({ browser }) => {
    const other = await newPage(browser);
    await loginAs(other, 'student', student2Email);
    const enroll = await other.request.post('/api/courses/enroll', {
      data: { courseId: code, enroll: true },
    });
    expect(enroll.status()).toBe(200);

    await open(other, `/courses/${code}/student`);
    await other.getByTestId('enter-queue-btn').click();
    await other.getByTestId('join-location').fill('Zoom');
    await other.getByTestId('join-confirm').click();
    await expect(other.getByTestId('queue-position')).toContainText('#1');
    await other.getByTestId('leave-queue-btn').click();
    await expect(other.getByTestId('enter-queue-btn')).toBeVisible();
  });

  test('instructor sees the sessions, outcomes and feedback', async ({ browser }) => {
    const instructor = await newPage(browser);
    await open(instructor, '/login');
    await instructor.getByTestId('mock-email').fill(instructorEmail);
    await instructor.getByTestId('login-instructor').click();
    await expect(instructor).toHaveURL(/\/courses$/);

    await instructor.getByTestId(`my-course-go-${code}`).click();
    await expect(instructor).toHaveURL(new RegExp(`/courses/${code}/admin$`));
    await expect(instructor.getByTestId('current-user-email')).toHaveText(instructorEmail);

    const sessions = instructor.getByTestId('session-row');
    await expect(sessions).toHaveCount(2);
    await expect(sessions.filter({ hasText: studentEmail })).toContainText('Helped');
    await expect(sessions.filter({ hasText: student2Email })).toContainText('Left queue');
    await expect(instructor.getByTestId('sessions-in-range')).toHaveText('1');

    await expect(instructor.getByTestId('feedback-row')).toContainText(
      'The TA explained base cases clearly.'
    );

    // Instructors cannot grant the course admin role.
    const res = await instructor.request.patch(`/api/courses/${code}/enrollments/role`, {
      data: { email: studentEmail, role: 'admin' },
    });
    expect(res.status()).toBe(403);

    await instructor.getByTestId('live-queue-link').click();
    await expect(instructor).toHaveURL(new RegExp(`/courses/${code}/ta$`));
  });

  test('closing the queue archives waiting students and clears duty', async () => {
    await student.getByTestId('enter-queue-btn').click();
    await student.getByTestId('join-location').fill('Room 101');
    await student.getByTestId('join-confirm').click();
    await expect(ta.getByTestId(`ta-row-${studentEmail}`)).toBeVisible({ timeout: 15_000 });

    await ta.getByTestId('close-queue-btn').click();
    await expect(ta.getByTestId('queue-state')).toHaveText('Closed');
    await expect(ta.getByTestId(`ta-row-${studentEmail}`)).toHaveCount(0);

    await expect(student.getByTestId('queue-state')).toHaveText('Closed', { timeout: 15_000 });
    await expect(student.getByTestId('queue-position')).toHaveCount(0);

    const analytics = await admin.request.get(`/api/courses/${code}/admin`);
    const body = await analytics.json();
    expect(body.helpSessions.map((s: any) => s.endReason).sort()).toEqual(
      ['completed', 'left', 'queue-closed'].sort()
    );

    const course = await (await ta.request.get(`/api/courses/${code}`)).json();
    expect(course.onDutyTAs).toEqual([]);
  });

  test('site admin deletes the course and all of its data', async () => {
    await open(admin, '/admin/courses');
    await admin.getByTestId(`admin-course-delete-${code}`).click();
    await expect(admin.getByTestId(`admin-course-row-${code}`)).toHaveCount(0);

    expect((await admin.request.get(`/api/courses/${code}`)).status()).toBe(404);
  });
});
