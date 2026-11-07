#!/usr/bin/env node
// Walks Halloween and That Luang against a running API on the local test database, with new players each run. See local-dev/README.md.
// Usage: npm run build && npm run smoke-both -- <admin_username> <admin_password>   (API_URL defaults to http://localhost:3002/api)
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');

const API = (process.env.API_URL || 'http://localhost:3002/api').replace(/\/$/, '');
const ROOT = path.join(__dirname, '..');
const [adminUser, adminPass] = process.argv.slice(2);
if (!adminUser || !adminPass) {
  console.error('usage: npm run smoke-both -- <admin_username> <admin_password>');
  process.exit(1);
}

async function call(method, route, { token, body, expect = 200, error, base = API } = {}) {
  const res = await fetch(base + route, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* the CSV export */ }
  assert.equal(res.status, expect, `${method} ${route} gave ${res.status}: ${text.slice(0, 300)}`);
  if (error) assert.equal(json?.error, error, `${method} ${route} gave ${text.slice(0, 300)}`);
  return json ?? text;
}

const step = (name) => console.log(`PASS  ${name}`);
const HALLOWEEN_ME_KEYS = ['club', 'displayName', 'handsCount', 'id', 'spin', 'spinStatus', 'xpokerPlayerId'];

/** Starts a second API with one setting changed, runs fn against it, then stops it. */
async function withApi(port, env, fn) {
  const child = spawn(process.execPath, ['dist/main.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), ...env }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}/api`;
  try {
    for (let i = 0; ; i++) {
      try { if ((await fetch(`${base}/health`)).ok) break; } catch { /* not up yet */ }
      assert.ok(i < 60, 'the second API did not start');
      await new Promise((r) => setTimeout(r, 500));
    }
    await fn(base);
  } finally {
    child.kill();
  }
}

(async () => {
  assert.ok(existsSync(path.join(ROOT, 'dist/main.js')), 'run npm run build first');
  const admin = (await call('POST', '/admin/auth/login', { body: { username: adminUser, password: adminPass } })).accessToken;
  const stamp = Date.now();

  // ---------- Halloween ----------
  const hId = `SMOKEH${stamp}`;
  const h = await call('POST', '/admin/players', { token: admin, expect: 201, body: { xpokerPlayerId: hId, clubName: 'CB', displayName: `Smoke H ${stamp}`, handsCount: 2000 } });
  const login = await call('POST', '/auth/login', { body: { username: h.username, password: h.initialPassword } });
  const player = login.accessToken;
  assert.equal(login.player.spinStatus, 'NOT_SPUN');
  assert.ok(login.player.id && login.player.displayName);
  const me = (token = player) => call('GET', '/me', { token });

  let m = await me();
  assert.deepEqual(Object.keys(m).sort(), [...HALLOWEEN_ME_KEYS, 'tiers', 'updatedAt'].sort());
  assert.equal(m.handsCount, 2000);
  assert.equal(m.spinStatus, 'NOT_SPUN');
  assert.equal(m.spin, null);
  step('Halloween login and /me keep their fields, with tiers and updatedAt added');

  const wheels = await call('GET', '/prizes');
  assert.ok(wheels.mainWheel.segments.length && wheels.cashWheel.segments.length);
  step('Halloween /prizes');

  // /spin/cash must reach Halloween (NOT_SPUN), not That Luang's /spin/:tier (TIER_NOT_FOUND).
  await call('POST', '/spin/cash', { token: player, expect: 400, error: 'NOT_SPUN' });
  step('POST /spin/cash reaches Halloween, not /spin/:tier');

  // Force the cash wheel so the full two-step spin always runs, then put the weights back.
  const before = await call('GET', '/admin/prizes', { token: admin });
  assert.ok(before.mainWheel.length && before.cashWheel.length, 'Halloween /admin/prizes keeps its shape');
  const weights = Object.fromEntries(before.mainWheel.map((p) => [p.code, p.weightPct]));
  await call('PUT', '/admin/prizes/weights', { token: admin, body: { mainWheel: Object.fromEntries(before.mainWheel.map((p) => [p.code, p.code === 'CASH' ? 100 : 0])) } });
  let spun;
  try {
    spun = await call('POST', '/spin', { token: player });
  } finally {
    await call('PUT', '/admin/prizes/weights', { token: admin, body: { mainWheel: weights } });
  }
  assert.equal(spun.status, 'CASH_PENDING');
  assert.equal(spun.nextStep, 'CASH_SPIN');
  assert.equal(spun.prize, null);
  const cash = await call('POST', '/spin/cash', { token: player });
  assert.equal(cash.status, 'DONE');
  assert.equal(cash.prize.group, 'CASH');
  await call('POST', '/spin', { token: player, expect: 409, error: 'ALREADY_SPUN' });
  await call('POST', '/spin/cash', { token: player, expect: 409, error: 'CASH_ALREADY_SPUN' });
  step('Halloween /spin, /spin/cash, and a second spin answers ALREADY_SPUN');

  const after = await call('GET', '/admin/prizes', { token: admin });
  assert.deepEqual(after.mainWheel.map((p) => p.weightPct), before.mainWheel.map((p) => p.weightPct), 'weights restored');
  const history = await call('GET', '/admin/prizes/weights/history', { token: admin });
  assert.ok(history[0].before.mainWheel && history[0].after.mainWheel);
  step('Halloween /admin/prizes, /admin/prizes/weights and its history');

  // ---------- That Luang, same player, who has already spun Halloween ----------
  m = await me();
  const halloweenAfterSpin = Object.fromEntries(HALLOWEEN_ME_KEYS.map((k) => [k, m[k]]));
  assert.deepEqual(Object.keys(m.tiers).sort(), ['bronze', 'gold', 'silver']);
  assert.equal(m.tiers.bronze.status, 'locked');
  await call('POST', '/spin/bronze', { token: player, expect: 403, error: 'NOT_UNLOCKED' });
  await call('POST', '/spin/nonsense', { token: player, expect: 404, error: 'TIER_NOT_FOUND' });
  step('That Luang: locked gives NOT_UNLOCKED, unknown level gives TIER_NOT_FOUND');

  const tiers = await call('GET', '/admin/tl/prizes', { token: admin });
  const target = tiers.find((t) => t.tier === 'bronze').handsTarget;
  assert.ok(target, 'run on the seeded local database: Bronze needs a target');
  const csv = [
    '﻿xpoker_id,stakes,hands',
    `${hId},1/2,${target - 1}`,
    `${hId},2/4,1`,
    `${hId},5/10,5`,
    `${hId},7/14,9`,
    `${hId},1/2,oops`,
    'NO-SUCH-PLAYER,1/2,10',
    '',
  ].join('\r\n');
  const report = await call('POST', '/admin/tl/reports/hands', { token: admin, body: { csv } });
  assert.equal(report.updated, 2);
  assert.deepEqual(report.unknown, ['NO-SUCH-PLAYER']);
  assert.deepEqual(report.skipped, [5, 6]);
  await call('POST', '/admin/tl/reports/hands', { token: admin, expect: 400, body: { csv: 'a,b\n1,2' } });
  m = await me();
  assert.equal(m.tiers.bronze.status, 'ready');
  assert.equal(m.tiers.bronze.hands, target);
  assert.equal(m.tiers.silver.status, 'locked', 'Reaching one level unlocks only that level');
  assert.equal(m.updatedAt, report.importedAt);
  step('That Luang: /admin/tl/prizes and /admin/tl/reports/hands unlock one level');

  // One spin per level: two at once, only one may win.
  const tries = await Promise.all(['a', 'b'].map(async () => {
    const res = await fetch(`${API}/spin/bronze`, { method: 'POST', headers: { authorization: `Bearer ${player}` } });
    return { status: res.status, json: await res.json() };
  }));
  assert.deepEqual(tries.map((t) => t.status).sort(), [200, 409]);
  assert.equal(tries.find((t) => t.status === 409).json.error, 'ALREADY_SPUN');
  const spin = tries.find((t) => t.status === 200).json;
  assert.equal(spin.slot % 2 === 0, spin.kind === 'cash', 'Even slots hold cash, odd slots hold a box');
  assert.ok(spin.receipt && spin.prize.name);
  await call('POST', '/spin/bronze', { token: player, expect: 409, error: 'ALREADY_SPUN' });
  m = await me();
  assert.equal(m.tiers.bronze.status, 'done');
  assert.deepEqual(m.tiers.bronze.result, spin);
  assert.deepEqual(Object.fromEntries(HALLOWEEN_ME_KEYS.map((k) => [k, m[k]])), halloweenAfterSpin, 'A That Luang spin leaves the Halloween fields alone');
  step('That Luang: /spin/bronze works after a Halloween spin, once only, and leaves Halloween alone');

  const board = await call('GET', '/leaderboard/bronze', { token: player });
  assert.deepEqual(board.rows.map((r) => r.hands), [...board.rows.map((r) => r.hands)].sort((a, b) => b - a));
  assert.deepEqual(Object.keys(board.rows[0]).sort(), ['hands', 'name', 'rank']);
  assert.equal(board.me.name, `Smoke H ${stamp}`);
  assert.equal(board.me.hands, target);
  assert.equal(board.rows.length, 50);
  assert.ok(board.me.rank > 50, 'The seeded fillers put this player below the top 50');
  const silverBoard = await call('GET', '/leaderboard/silver', { token: player });
  assert.deepEqual(silverBoard.rows[silverBoard.me.rank - 1], silverBoard.me, 'Inside the top, the own line is that row');
  const goldBoard = await call('GET', '/leaderboard/gold', { token: player });
  assert.deepEqual(goldBoard.me, { rank: null, name: `Smoke H ${stamp}`, hands: 0 });
  await call('GET', '/leaderboard/bronze', { expect: 401 });
  await call('GET', '/leaderboard/nonsense', { token: player, expect: 404, error: 'TIER_NOT_FOUND' });
  step('That Luang: /leaderboard gives rows and the player\'s own line, below the top, inside it, and with no hands');

  // ---------- That Luang admin ----------
  const list = await call('GET', `/admin/tl/players?q=${hId}&spinStatus=DONE&fulfillment=PENDING`, { token: admin });
  assert.equal(list.total, 1);
  const updated = await call('PATCH', `/admin/tl/spins/${list.items[0].spins[0].id}/fulfillment`, { token: admin, body: { status: 'DELIVERED', note: 'smoke' } });
  assert.equal(updated.spins[0].fulfillmentStatus, 'DELIVERED');
  assert.equal(updated.spins[0].deliveredBy, adminUser);
  assert.match(await call('GET', '/admin/tl/spins/export', { token: admin }), new RegExp(`${hId},bronze,${target}`));
  assert.ok((await call('GET', '/admin/tl/summary', { token: admin })).spinsByTier.bronze >= 1);
  assert.ok((await call('GET', '/admin/tl/clubs', { token: admin })).length);
  await call('GET', '/admin/tl/clubs', { expect: 401 });
  await call('GET', '/admin/tl/clubs', { token: player, expect: 401 });
  step('That Luang admin: /admin/tl/players, fulfillment, export, summary, clubs, admin only');

  const bronze = (await call('GET', '/admin/tl/prizes', { token: admin })).find((t) => t.tier === 'bronze');
  const rows = bronze.prizes.map(({ code, group, name, valueLak, qtyTotal, weightPct }) => ({ code, group, name, valueLak, qtyTotal, weightPct }));
  const save = (prizes, expect = 200) => call('PUT', '/admin/tl/tiers/bronze', { token: admin, expect, body: { handsTarget: bronze.handsTarget, prizes } });
  await save(rows.map((r) => ({ ...r, weightPct: 1 })), 400);
  const given = bronze.prizes.find((p) => p.qtyGiven > 0);
  await save(rows.map((r) => (r.code === given.code ? { ...r, qtyTotal: given.qtyGiven - 1 } : r)), 400);
  const saved = (await save(rows)).find((t) => t.tier === 'bronze');
  assert.equal(saved.prizes.find((p) => p.code === given.code).qtyGiven, given.qtyGiven, 'Saving keeps what was given out');
  const historyAfter = await call('GET', '/admin/prizes/weights/history', { token: admin });
  assert.equal(historyAfter[0].id, history[0].id, 'Saving a level does not touch the Halloween weight history');
  step('That Luang admin: /admin/tl/tiers checks odds and totals, and stays out of the Halloween history');

  const halloweenView = await call('GET', `/admin/players/${h.id}`, { token: admin });
  assert.equal(halloweenView.spinStatus, 'DONE');
  assert.equal(halloweenView.handsCount, 2000);
  step('Halloween admin still shows the same player its way');

  // ---------- The other order: a That Luang player spins That Luang first, then Halloween ----------
  const tId = `SMOKET${stamp}`;
  const t = await call('POST', '/admin/tl/players', { token: admin, expect: 201, body: { xpokerPlayerId: tId, clubName: 'CB', displayName: `Smoke T ${stamp}` } });
  const second = (await call('POST', '/auth/login', { body: { username: t.username, password: t.initialPassword } })).accessToken;
  m = await me(second);
  assert.equal(m.handsCount, 1666);
  assert.equal(m.tiers.bronze.status, 'locked');
  assert.equal((await call('GET', `/admin/tl/players/${t.id}`, { token: admin })).username, t.username);
  assert.equal((await call('PATCH', `/admin/tl/players/${t.id}`, { token: admin, body: { displayName: `Smoke T2 ${stamp}` } })).displayName, `Smoke T2 ${stamp}`);
  assert.ok((await call('POST', `/admin/tl/players/${t.id}/reset-password`, { token: admin })).newPassword);
  await call('POST', '/admin/tl/reports/hands', { token: admin, body: { csv: `xpoker_id,stakes,hands\n${tId},5/10,${tiers.find((x) => x.tier === 'silver').handsTarget}\n` } });
  assert.ok((await call('POST', '/spin/silver', { token: second })).prize.name);
  await call('POST', '/spin', { token: second, expect: 403, error: 'CAMPAIGN_CLOSED' });
  m = await me(second);
  assert.equal(m.tiers.silver.status, 'done');
  assert.equal(m.spinStatus, 'NOT_SPUN');
  step('A player made in /admin/tl/players can log in and spin That Luang, but gets no Halloween spin');

  // The other order: a Halloween player spins That Luang first, then Halloween
  const bId = `SMOKEB${stamp}`;
  const b = await call('POST', '/admin/players', { token: admin, expect: 201, body: { xpokerPlayerId: bId, clubName: 'CB', displayName: `Smoke B ${stamp}`, handsCount: 2000 } });
  const third = (await call('POST', '/auth/login', { body: { username: b.username, password: b.initialPassword } })).accessToken;
  await call('POST', '/admin/tl/reports/hands', { token: admin, body: { csv: `xpoker_id,stakes,hands\n${bId},5/10,${tiers.find((x) => x.tier === 'silver').handsTarget}\n` } });
  assert.ok((await call('POST', '/spin/silver', { token: third })).prize.name);
  const hw = await call('POST', '/spin', { token: third });
  assert.ok(['CASH_PENDING', 'DONE'].includes(hw.status));
  if (hw.status === 'CASH_PENDING') await call('POST', '/spin/cash', { token: third });
  else await call('POST', '/spin/cash', { token: third, expect: 400, error: 'NOT_CASH_SEGMENT' });
  m = await me(third);
  assert.equal(m.tiers.silver.status, 'done');
  assert.equal(m.spinStatus, 'DONE');
  step('That Luang then Halloween do not block each other');

  // ---------- Each event opens on its own dates. Both players have spun, so nothing is given out here. ----------
  const past = '2020-01-01T00:00:00Z';
  await withApi(3902, { THATLUANG_END: past }, async (base) => {
    await call('POST', '/spin/bronze', { base, token: player, expect: 403, error: 'CAMPAIGN_CLOSED' });
    await call('POST', '/spin', { base, token: player, expect: 409, error: 'ALREADY_SPUN' });
  });
  step('THATLUANG_END in the past closes /spin/bronze but not /spin');
  await withApi(3902, { CAMPAIGN_END: past }, async (base) => {
    await call('POST', '/spin', { base, token: player, expect: 403, error: 'CAMPAIGN_CLOSED' });
    await call('POST', '/spin/bronze', { base, token: player, expect: 409, error: 'ALREADY_SPUN' });
  });
  step('CAMPAIGN_END in the past closes /spin but not /spin/bronze');

  // ---------- An Admin works inside one club. Test Club B comes from local-dev/sql/50_seed_admin_clubs.sql. ----------
  const staff = (await call('POST', '/admin/auth/login', { body: { username: 'local.staff', password: adminPass } })).accessToken;
  const other = (await call('GET', '/admin/players?club=lt&limit=1', { token: admin })).items[0];
  assert.ok(other, 'Super Admin should see the other club');
  for (const prefix of ['/admin', '/admin/tl']) {
    const clubs = await call('GET', `${prefix}/clubs`, { token: staff });
    assert.deepEqual(clubs.map((c) => c.code), ['CB']);
    const asked = await call('GET', `${prefix}/players?club=lt&limit=50`, { token: staff });
    assert.ok(asked.items.length && asked.items.every((p) => p.club.code === 'CB'), 'an Admin must get only their own club');
    await call('GET', `${prefix}/players/${other.id}`, { token: staff, expect: 404, error: 'PLAYER_NOT_FOUND' });
    await call('POST', `${prefix}/players/${other.id}/reset-password`, { token: staff, expect: 404, error: 'PLAYER_NOT_FOUND' });
    await call('GET', `${prefix}/prizes`, { token: staff, expect: 403, error: 'SUPER_ADMIN_ONLY' });
    const summary = await call('GET', `${prefix}/summary`, { token: staff });
    assert.equal(summary.prizes, undefined);
    assert.equal(summary.players.total, (await call('GET', `${prefix}/players?limit=1`, { token: staff })).total);
    assert.ok(!String(await call('GET', `${prefix}/spins/export`, { token: staff })).includes('Test Club B'));
    await call('POST', `${prefix}/players`, { token: staff, expect: 403, error: 'CLUB_NOT_ALLOWED', body: { xpokerPlayerId: `no${Date.now()}`, clubName: 'lt', displayName: 'Not allowed', ...(prefix === '/admin' ? { handsCount: 2000 } : {}) } });
  }
  await call('POST', '/admin/tl/reports/hands', { token: staff, expect: 403, error: 'SUPER_ADMIN_ONLY', body: { csv: 'xpoker_id,stakes,hands\n1,1/2,1' } });
  await call('GET', '/admin/admins', { token: staff, expect: 403, error: 'SUPER_ADMIN_ONLY' });
  step('an Admin sees only their own club, and no prizes, import or admin accounts');

  const name = `smoke.${Date.now()}`;
  await call('POST', '/admin/admins', { token: admin, expect: 400, error: 'CLUB_REQUIRED', body: { username: name, role: 'STAFF' } });
  const made = await call('POST', '/admin/admins', { token: admin, expect: 201, body: { username: name, role: 'STAFF', clubCode: 'lt' } });
  await call('POST', '/admin/admins', { token: admin, expect: 409, error: 'ADMIN_ALREADY_EXISTS', body: { username: name, role: 'STAFF', clubCode: 'lt' } });
  const madeToken = (await call('POST', '/admin/auth/login', { body: { username: name, password: made.initialPassword } })).accessToken;
  assert.deepEqual((await call('GET', '/admin/clubs', { token: madeToken })).map((c) => c.code), ['LT']);
  await call('PATCH', `/admin/admins/${made.id}`, { token: admin, body: { isActive: false } });
  await call('GET', '/admin/clubs', { token: madeToken, expect: 401 });
  const self = (await call('GET', '/admin/admins', { token: admin })).find((a) => a.username === adminUser);
  await call('PATCH', `/admin/admins/${self.id}`, { token: admin, expect: 400, error: 'ADMIN_CANNOT_CHANGE_SELF', body: { isActive: false } });
  step('a Super Admin adds and switches off Admins, and cannot lock themselves out');

  console.log('\nBoth events passed.');
  process.exit(0);
})().catch((e) => {
  console.error(`\nFAIL  ${e.message}`);
  process.exit(1);
});
