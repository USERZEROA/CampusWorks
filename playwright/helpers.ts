import { expect, request as playwrightRequest, type APIRequestContext, type Page } from '@playwright/test';

export type DemoRole = 'student' | 'ta' | 'instructor' | 'admin';

export const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

/**
 * Navigate and wait until the Nuxt app has hydrated, so clicks are not lost
 * on server-rendered HTML (noticeable with the slower dev server).
 */
export async function open(page: Page, url: string) {
  await page.goto(url);
  await waitForApp(page);
}

export async function waitForApp(page: Page) {
  await page.waitForFunction(() => !!(document.querySelector('#__nuxt') as any)?.__vue_app__);
}

/** Unique suffix so test runs never collide with each other or with demo data. */
export const uniqueId = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * Sign in through the demo (mock) login API. When `target` is a page or a
 * browser context, the session cookie is shared with that browser context.
 */
export async function loginAs(
  target: { request: APIRequestContext },
  as: DemoRole,
  email?: string
) {
  const res = await target.request.post('/api/auth/mock', {
    data: email ? { as, email } : { as },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).user as { email: string; name: string; isGlobalAdmin: boolean };
}

/** A standalone API client signed in as the given identity. */
export async function apiAs(as: DemoRole, email?: string) {
  const api = await playwrightRequest.newContext({ baseURL: BASE_URL });
  await loginAs({ request: api }, as, email);
  return api;
}

/** Create a course as a site admin and enroll the given users. */
export async function createCourse(
  admin: APIRequestContext,
  code: string,
  members: Array<{ email: string; role: 'student' | 'ta' | 'instructor' | 'admin' }> = []
) {
  const created = await admin.post('/api/courses', { data: { code, title: `E2E ${code}` } });
  expect(created.status(), await created.text()).toBe(200);
  for (const m of members) {
    const res = await admin.patch(`/api/courses/${code}/enrollments/role`, { data: m });
    expect(res.status(), await res.text()).toBe(200);
  }
}
