import { test, expect } from '@playwright/test';
import { BASE_URL, apiAs, createCourse, open, uniqueId, waitForApp } from '../helpers';

test.describe('authentication & sessions', () => {
  test('visitors without a session are sent to /login', async ({ page }) => {
    for (const path of ['/', '/courses', '/courses/anything/student', '/admin/courses']) {
      await open(page, path);
      await expect(page).toHaveURL(/\/login$/);
    }
    await expect(page.getByRole('heading', { name: 'Sign in to CampusWorks' })).toBeVisible();
  });

  test('APIs reject requests without a valid session', async ({ request }) => {
    expect((await request.get('/api/auth/me')).status()).toBe(401);
    expect((await request.get('/api/courses')).status()).toBe(401);
    expect((await request.get('/api/debug/entries')).status()).toBe(404);
  });

  test('forged or tampered cookies are not trusted', async ({ playwright }) => {
    // Old versions trusted a plain JSON cookie; it must not grant anything now.
    const forgedUser = encodeURIComponent(
      JSON.stringify({ email: 'admin@example.com', name: 'Forged', primaryRole: 'admin' })
    );
    const forged = await playwright.request.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: { cookie: `campusworks_user=${forgedUser}` },
    });
    expect((await forged.get('/api/auth/me')).status()).toBe(401);
    expect(
      (await forged.post('/api/courses', { data: { code: 'forged', title: 'x' } })).status()
    ).toBe(401);

    const tampered = await playwright.request.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: { cookie: 'campusworks_session=Fe26.2**not-a-real-seal' },
    });
    expect((await tampered.get('/api/auth/me')).status()).toBe(401);
  });

  test('demo login, server-rendered reload and logout', async ({ page }) => {
    const id = uniqueId();
    const code = `auth-${id}`;
    const email = `stu-${id}@example.com`;

    const admin = await apiAs('admin');
    await createCourse(admin, code, [{ email, role: 'student' }]);

    await open(page, '/login');
    await page.getByTestId('mock-email').fill(email);
    await page.getByTestId('login-student').click();
    await expect(page).toHaveURL(/\/courses$/);
    await expect(page.getByTestId('current-user-email')).toHaveText(email);
    await expect(page.getByTestId(`my-course-${code}`)).toBeVisible();

    // A hard reload is rendered on the server and must keep the session.
    const html = await (await page.request.get('/courses')).text();
    expect(html).toContain(code);
    const coursePage = await page.request.get(`/courses/${code}/student`);
    expect(coursePage.status()).toBe(200);

    await open(page, `/courses/${code}/student`);
    await expect(page.getByTestId('enter-queue-btn')).toBeVisible();
    await page.reload();
    await waitForApp(page);
    await expect(page.getByTestId('current-user-email')).toHaveText(email);

    await page.getByTestId('logout-btn').click();
    await expect(page).toHaveURL(/\/login$/);
    expect((await page.request.get('/api/auth/me')).status()).toBe(401);

    await open(page, '/courses');
    await expect(page).toHaveURL(/\/login$/);

    expect((await admin.delete(`/api/courses/${code}`)).status()).toBe(200);
  });

  test('one-click demo accounts sign in with their own names', async ({ page }) => {
    await open(page, '/login');
    await page.getByTestId('demo-account-ta2@example.com').click();
    await expect(page).toHaveURL(/\/courses$/);
    await expect(page.getByTestId('current-user-email')).toHaveText('ta2@example.com');

    const me = await (await page.request.get('/api/auth/me')).json();
    expect(me.user).toMatchObject({ email: 'ta2@example.com', name: 'TA Two', primaryRole: 'ta' });
  });

  test('only site admins can open the admin console', async ({ page }) => {
    await page.request.post('/api/auth/mock', { data: { as: 'ta' } });
    await open(page, '/admin/courses');
    await expect(page).toHaveURL(/\/courses$/);

    await page.request.post('/api/auth/mock', { data: { as: 'admin' } });
    await open(page, '/admin/courses');
    await expect(page).toHaveURL(/\/admin\/courses$/);
    await expect(page.getByTestId('admin-create-btn')).toBeVisible();
  });
});
