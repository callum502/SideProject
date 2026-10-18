import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { testUser, seedLocation, logProblem, befriend, friendsAction, editGuide, type User } from './seedHelpers';
import { findRecord as find } from './apiTestHelpers';

// Each test uses its own pair of accounts, so friendships from one test can't affect another.
const ana = testUser('test_friends_ana_', 'test_friends_ana_loc_');
const ben = testUser('test_friends_ben_', 'test_friends_ben_loc_');
const cal = testUser('test_friends_cal_', 'test_friends_cal_loc_');
const dee = testUser('test_friends_dee_', 'test_friends_dee_loc_');
const eve = testUser('test_friends_eve_', 'test_friends_eve_loc_');
const fin = testUser('test_friends_fin_', 'test_friends_fin_loc_');

/** Open the Friends page as the user and wait for the lists to load. */
async function friendsPage(user: User) {
  const page = await user.context.newPage();
  await page.goto('/#friends');
  await expect(page.getByRole('heading', { level: 1, name: 'Friends', exact: true })).toBeVisible();
  await expect(page.getByText('Loading friends...')).toHaveCount(0);
  return page;
}

/** A section of the Friends page, by its heading. */
const section = (page: Page, heading: RegExp) => page.locator('section').filter({ has: page.getByRole('heading', { name: heading }) });

test('an invite found by display name can be accepted, making both users friends', async () => {
  const [a, b] = [ana.current, ben.current];
  const page = await friendsPage(a);
  // Searching shows matching climbers, each with an invite button.
  await page.getByLabel('Display name').fill(b.account.name);
  const suggestions = page.getByLabel('Matching climbers');
  await expect(suggestions.getByRole('link', { name: b.account.name })).toBeVisible();
  // Send the invite from the form.
  await page.getByRole('button', { name: 'Send invite', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Invite sent.' })).toBeVisible();
  await expect(section(page, /^Invites sent/)).toContainText(b.account.name);
  // The invitee sees it and accepts.
  const theirs = await friendsPage(b);
  const received = section(theirs, /^Invites received/);
  await expect(received).toContainText(a.account.name);
  await received.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect(section(theirs, /^Your friends/)).toContainText(a.account.name);
  // The inviter sees the friendship after reloading, and the search now shows the status instead of a button.
  await page.reload();
  await expect(section(page, /^Your friends/)).toContainText(b.account.name);
  await page.getByLabel('Display name').fill(b.account.name);
  await expect(page.getByLabel('Matching climbers').locator('li').filter({ hasText: b.account.name })).toContainText('Friends');
  // API check: both lists show the accepted friendship.
  for (const [user, other] of [[a, b], [b, a]]) {
    const list = await (await friendsAction(user.request, 'list')).json();
    expect(list.find((p: any) => p.id === other.account.id), 'API: friendship accepted').toMatchObject({ status: 'accepted' });
  }
});

test('invites can be cancelled by the sender and declined by the recipient', async () => {
  const [c, d] = [cal.current, dee.current];
  // Cancel: the inviter withdraws, and the recipient no longer sees it.
  expect((await friendsAction(c.request, 'request', { target: d.account.id })).status(), 'Invite sent').toBe(200);
  const sender = await friendsPage(c);
  await section(sender, /^Invites sent/).getByRole('button', { name: 'Cancel invite', exact: true }).click();
  await expect(section(sender, /^Invites sent/)).toContainText('No outstanding invites.');
  await expect(section(await friendsPage(d), /^Invites received/)).toContainText('No pending invites.');
  // Decline: the recipient refuses, and neither is left with an invite or friendship.
  expect((await friendsAction(c.request, 'request', { target: d.account.id })).status(), 'Invite sent again').toBe(200);
  const recipient = await friendsPage(d);
  await section(recipient, /^Invites received/).getByRole('button', { name: 'Decline', exact: true }).click();
  await expect(section(recipient, /^Invites received/)).toContainText('No pending invites.');
  expect(await (await friendsAction(c.request, 'list')).json(), 'API: nothing left for the sender').toEqual([]);
});

test('a friend can be removed after confirming', async () => {
  const [e, f] = [eve.current, fin.current];
  await befriend(e, f);
  const page = await friendsPage(e);
  const friends = section(page, /^Your friends/);
  await expect(friends).toContainText(f.account.name);
  // Removal asks for confirmation first.
  page.once('dialog', dialog => { expect(dialog.message()).toContain('Remove ' + f.account.name + ' as a friend?'); dialog.accept(); });
  await friends.getByRole('button', { name: 'Remove friend', exact: true }).click();
  await expect(friends).not.toContainText(f.account.name);
  // API check: the friendship is gone for both users.
  expect(await (await friendsAction(f.request, 'list')).json(), 'API: removed for the other user too').toEqual([]);
});

test('searching for an unknown name says so', async () => {
  const page = await friendsPage(ana.current);
  const name = 'test_friends_nobody_' + crypto.randomUUID().slice(0, 8);
  await page.getByLabel('Display name').fill(name);
  await expect(page.getByLabel('Matching climbers').getByRole('status')).toHaveText('No user with that name.');
  await page.getByRole('button', { name: 'Send invite', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: /^No user with that name\.$/ }).last()).toBeVisible();
});

test("a friend's logbook shows all their sends, or only those you share", async () => {
  // Ben and Cal aren't friends in any other test.
  const [b, c] = [ben.current, cal.current];
  await befriend(b, c);
  // Ben owns three problems; Ben logs two of them and Cal logs one of those.
  const { boulder, problem } = await seedLocation(b.request, 'test_friends_ben_loc_', { media: false });
  const extra = (name: string) => ({ id: crypto.randomUUID(), name, grade: 'V3 (6A/6A+)', description: 'Another line.', imageIds: [], videoIds: [] });
  const [shared, solo] = [extra('Shared send'), extra('Solo send')];
  expect((await editGuide(b.request, g => find(g, boulder.id).problems.push(shared, solo))).status(), 'Problems added').toBe(200);
  await logProblem(b.request, shared.id);
  await logProblem(b.request, solo.id);
  await logProblem(c.request, shared.id);
  // Cal opens Ben's logbook from the Friends page.
  const page = await friendsPage(c);
  await section(page, /^Your friends/).locator('.problem-row').filter({ hasText: b.account.name }).getByRole('button', { name: 'View logbook', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: `${b.account.name}'s logbook`, exact: true })).toBeVisible();
  await expect(page.getByText('2 problems completed', { exact: true })).toBeVisible();
  const entries = page.locator('.problem-list .problem-row');
  await expect(entries).toHaveCount(2);
  // Mutual sends shows only problems both have logged.
  await page.getByRole('button', { name: 'Mutual sends', exact: true }).click();
  await expect(entries).toHaveCount(1);
  await expect(entries).toContainText('Shared send');
  // An unlogged problem of Ben's is never shown.
  await page.getByRole('button', { name: 'All sends', exact: true }).click();
  await expect(entries.filter({ hasText: problem.name })).toHaveCount(0);
});
