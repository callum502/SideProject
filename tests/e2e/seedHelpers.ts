/*
 * Seed helper quick reference
 * Create accounts, sessions and data through APIs so tests can start from a known state quickly.
 * UI helpers are in testHelpers.ts; API reads, assertions and cleanup are in apiTestHelpers.ts.
 *
 * createApiAccount          Create an account (by default confirmed, with a completed profile); optionally make it an admin.
 * testUser                  Give a spec file its own signed-in account, with its data and account cleaned up afterwards.
 * signIn                    Open a browser context signed in as an account (one login request).
 * openPage                  Open a location, boulder or problem page in a new tab and wait for its heading.
 * editGuide                 Change the guide as a user, sending only the changed records like the app.
 * uploadImage               Upload a sample image as a user; return its media URL.
 * uploadVideo               Upload a sample video as a user; return its media URL.
 * seedLocation              Create a location with a boulder, problem, annotated photo, video, parking photo and link.
 * logProblem                Add a problem to (or remove it from) a user's logbook.
 * befriend                  Make two users friends: one invites, the other accepts.
 * runSql                    Run SQL as the database owner in the local Supabase container (for state no API can set).
 *
 * Internal helpers
 * makeAdmin                 Grant the admin role in the local database container.
 */

import type { APIRequestContext, Browser, BrowserContext } from '@playwright/test';
import { test, expect, blockMapTiles } from './fixtures';
import { mediaFile, MIME, type MediaType } from './media';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { guideChanges } from '../../guide-changes.mjs';
import { adminRequest, deleteLocationsWithPrefix, deleteAccountsWithPrefix } from './apiTestHelpers';
import { accountDetails, locationName } from './testHelpers';

export type TestAccount = { id: string, email: string, password: string, name: string };

export type User = Awaited<ReturnType<typeof signIn>> & { account: TestAccount };

/**
 * Create a confirmed account with a completed profile through the local Supabase admin API.
 * Uses no app login requests, so it does not count towards the app's 20-per-10-minute login limit.
 * @param prefix - Stable test-specific prefix for the email and display name, used by cleanupAccounts.
 * @param options - `admin` grants the admin role; `confirmed: false` leaves the email unconfirmed;
 *   `profile: false` leaves the profile incomplete (no height), as after Google sign-in; `name` sets the display name.
 * @returns The account's ID, email, password and display name.
 */
export async function createApiAccount(prefix: string, options: { admin?: boolean, confirmed?: boolean, profile?: boolean, name?: string } = {}): Promise<TestAccount> {
  const details = { ...accountDetails(prefix), ...(options.name ? { name: options.name } : {}) };
  // The sign-up trigger completes the profile from this metadata, as it does for the sign-up form.
  const response = await adminRequest('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({
    email: details.email, password: details.password, email_confirm: options.confirmed !== false,
    user_metadata: options.profile === false ? { display_name: details.name } : { display_name: details.name, height_cm: 178, ape_index_inches: 2 },
  }) });
  const { id } = await response.json();
  if (options.admin) makeAdmin(id);
  return { id, email: details.email, password: details.password, name: details.name };
}

/**
 * Grant the admin role. The role lives in a private table the APIs cannot write, so this runs SQL
 * in the local Supabase database container, just as supabase/set-admin.sql does in the SQL Editor.
 * @param userId - Account ID to promote.
 * @throws If the ID is not a UUID, Supabase is not local or the database container cannot be found.
 */
function makeAdmin(userId: string) {
  const output = runSql(`UPDATE private.user_roles SET role = 'admin' WHERE user_id = '${uuid(userId)}'`);
  if (!output.includes('UPDATE 1')) throw new Error('Granting admin did not update the account: ' + output.trim());
}

/** Return the value if it is a UUID, for safe use in SQL; otherwise throw. */
export function uuid(value: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) throw new Error('Invalid ID: ' + value);
  return value;
}

/**
 * Run SQL as the database owner in the local Supabase database container, for state no API can set
 * (roles, storage usage). Only interpolate trusted values; use uuid() for IDs.
 * @param sql - Statement to run.
 * @returns psql's output.
 * @throws If Supabase is not local or the database container cannot be found.
 */
export function runSql(sql: string) {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(process.env.E2E_SUPABASE_URL || 'http://invalid').hostname)) throw new Error('Running SQL requires local Supabase.');
  // Local Supabase names its database container supabase_db_<project_id>.
  const projectId = readFileSync('supabase/config.toml', 'utf8').match(/^project_id\s*=\s*"([^"]+)"/m)?.[1];
  const running = execFileSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' }).split(/\r?\n/).filter(name => name.startsWith('supabase_db_'));
  const container = running.find(name => name === 'supabase_db_' + projectId) || (running.length === 1 ? running[0] : undefined);
  if (!container) throw new Error('Could not find the local Supabase database container. Start it with npx supabase start.');
  return execFileSync('docker', ['exec', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' });
}

/**
 * Open a new browser context signed in as the account, using one app login request.
 * Reuse the returned context across tests: each login counts towards the app's limit of 20 per 10 minutes.
 * @param browser - Playwright browser.
 * @param account - Account to sign in as; omit for a signed-out (guest) context.
 * @returns The context, a page in it and the context's API request client (sharing its cookies).
 */
export async function signIn(browser: Browser, account?: TestAccount) {
  // browser.newContext() does not inherit the config's `use` options, so pass the base URL.
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  await blockMapTiles(context);
  if (account) {
    const response = await context.request.post('/api/login', { data: { email: account.email, password: account.password }, timeout: 10000 });
    expect(response.status(), 'Login as ' + account.name + ' succeeded').toBe(200);
  }
  return { context, page: await context.newPage(), request: context.request };
}

/**
 * Change the guide as a user, the same way the app saves: read the latest guide, apply the change
 * to a copy and send only the changed records.
 * @param request - API request client of the acting user.
 * @param change - Mutates a copy of the latest guide.
 * @returns The HTTP response; a 200 response body is the saved guide.
 */
export async function editGuide(request: APIRequestContext, change: (guide: any) => void) {
  const current = await (await request.get('/api/guide', { timeout: 10000 })).json();
  const next = structuredClone(current);
  change(next);
  return request.put('/api/guide', { data: { changes: guideChanges(current, next) }, timeout: 10000 });
}

/**
 * Upload a 320×240 sample image as the user.
 * @param request - API request client of the uploading user.
 * @param type - Image type: png, jpg or webp.
 * @returns The uploaded file's app media URL.
 */
export async function uploadImage(request: APIRequestContext, type: MediaType = 'png') {
  const response = await request.post('/api/images', { headers: { 'Content-Type': MIME[type] }, data: mediaFile(type).buffer, timeout: 30000 });
  expect(response.status(), 'Image upload succeeded').toBe(201);
  return (await response.json()).url as string;
}

/**
 * Upload a one-second sample video as the user.
 * @param request - API request client of the uploading user.
 * @param type - Video type: mp4, webm or mov.
 * @returns The uploaded file's app media URL.
 */
export async function uploadVideo(request: APIRequestContext, type: MediaType = 'mp4') {
  const response = await request.post('/api/videos', { headers: { 'Content-Type': MIME[type] }, data: mediaFile(type).buffer, timeout: 30000 });
  expect(response.status(), 'Video upload succeeded').toBe(201);
  return (await response.json()).url as string;
}

/**
 * Create a location owned by the user with one of everything: a link, a parking photo, a boulder
 * with a photo and a video, and a problem with that photo and video attached and the photo annotated.
 * Uploads count towards the app's limit of 20 per minute per IP, so pass `media: false` when photos and videos are not needed.
 * @param request - API request client of the owning user.
 * @param prefix - Stable test-specific prefix for the location name, used by cleanup.
 * @param options - `media: false` skips the photo, video and parking photo; `name` (starting with the prefix) and coordinates override the defaults.
 * @returns The saved location, boulder and problem records, plus the image, video and parking photo when seeded.
 */
export async function seedLocation(request: APIRequestContext, prefix: string, { media = true, name = locationName(prefix), latitude = '56.8', longitude = '-3.2' } = {}) {
  if (!name.startsWith(prefix)) throw new Error('Seeded location names must start with the cleanup prefix.');
  const ids = { location: randomUUID(), boulder: randomUUID(), problem: randomUUID(), image: randomUUID(), video: randomUUID(), parking: randomUUID() };
  const [imageUrl, videoUrl, parkingUrl] = media ? [await uploadImage(request), await uploadVideo(request), await uploadImage(request)] : [];
  const response = await editGuide(request, guide => guide.locations.push({
    id: ids.location, name, latitude, longitude, approach: 'Follow the seeded path.',
    links: [{ label: 'Seed guidebook', url: 'https://example.com/guide' }],
    photos: media ? [{ id: ids.parking, name: 'Parking', caption: 'Park by the gate.', url: parkingUrl, annotations: [] }] : [],
    boulders: [{
      id: ids.boulder, name: 'Seed Boulder', notes: 'Beside the path.', otherNotes: '',
      images: media ? [{ id: ids.image, name: 'Seed photo', caption: '', url: imageUrl, annotations: [] }] : [],
      videos: media ? [{ id: ids.video, name: 'Seed video', url: videoUrl }] : [],
      problems: [{ id: ids.problem, name: 'Seed Problem', grade: 'V2 (5+)', description: 'Climb the arete.', imageIds: media ? [ids.image] : [], videoIds: media ? [ids.video] : [],
        photoAnnotations: media ? { [ids.image]: [{ type: 'box', color: 'green', x: 100, y: 100, x2: 300, y2: 300 }] } : {} }],
    }],
  }));
  expect(response.status(), 'Seeding location ' + name + ' succeeded').toBe(200);
  const location = (await response.json()).locations.find((item: any) => item.id === ids.location);
  const boulder = location.boulders[0];
  return { location, boulder, problem: boulder.problems[0], image: boulder.images[0], video: boulder.videos[0], parking: location.photos[0] };
}

/**
 * Give the spec file its own account, signed in once per worker. Call at the top level of a spec.
 * Afterwards the account's locations (matching the location prefix) are removed, then the account.
 * @param accountPrefix - Stable prefix for the account's email and display name, such as `test_photos_user_`.
 * @param locationPrefix - Stable prefix the spec uses for location names, such as `test_photos_loc_`.
 * @returns A holder whose `current` is the signed-in user once beforeAll has run.
 */
export function testUser(accountPrefix: string, locationPrefix: string) {
  const holder = {} as { current: User };
  test.beforeAll(async ({ browser }) => {
    const account = await createApiAccount(accountPrefix);
    holder.current = { ...await signIn(browser, account), account };
  });
  test.afterEach(async () => { if (holder.current) await closeTabs(holder.current.context); });
  test.afterAll(async ({}, info) => {
    if (holder.current) await deleteLocationsWithPrefix(holder.current.page, locationPrefix, info);
    await deleteAccountsWithPrefix(accountPrefix, info);
    await holder.current?.context.close();
  });
  return holder;
}

/**
 * Close every tab in the context except its first (blank) page.
 * The dev server's live-reload connection keeps each open app tab holding one of Chromium's
 * 6 connections per host, so a context with 6 open tabs stalls. Call after each test.
 * @param context - Context whose extra tabs to close.
 */
export async function closeTabs(context: BrowserContext) {
  for (const page of context.pages().slice(1)) await page.close();
}

/**
 * Open a location, boulder or problem page in a new tab, so it loads the latest guide.
 * @param context - Browser context (and so session) to use.
 * @param ids - Location ID, plus boulder and problem IDs for deeper pages.
 * @param heading - Expected page heading, confirming the page loaded.
 * @returns The new tab.
 */
export async function openPage(context: BrowserContext, ids: { location: string, boulder?: string, problem?: string }, heading: string) {
  const page = await context.newPage();
  await page.goto('/#' + new URLSearchParams(ids));
  await expect(page.locator('.detail-banner').getByRole('heading', { name: heading, exact: true })).toBeVisible();
  return page;
}

/**
 * Add a problem to, or remove it from, the user's logbook.
 * @param request - API request client of the climber.
 * @param problemId - Problem to log.
 * @param completed - True to log it, false to remove it.
 */
export async function logProblem(request: APIRequestContext, problemId: string, completed = true) {
  const response = await request.post('/api/logbook', { data: { problemId, completed }, timeout: 10000 });
  expect(response.status(), (completed ? 'Logged' : 'Unlogged') + ' a problem').toBe(200);
}

/**
 * Send a Friends API action as the user.
 * @param request - API request client of the acting user.
 * @param action - list, request, accept, decline, remove, search, suggest or logbook.
 * @param values - `target` user ID or search `name`.
 * @returns The HTTP response.
 */
export function friendsAction(request: APIRequestContext, action: string, values: { target?: string, name?: string } = {}) {
  return request.post('/api/friends', { data: { action, ...values }, timeout: 10000 });
}

/**
 * Make two users friends through the API: the first invites, the second accepts.
 */
export async function befriend(inviter: User, invitee: User) {
  expect((await friendsAction(inviter.request, 'request', { target: invitee.account.id })).status(), 'Invite sent').toBe(200);
  expect((await friendsAction(invitee.request, 'accept', { target: inviter.account.id })).status(), 'Invite accepted').toBe(200);
}
