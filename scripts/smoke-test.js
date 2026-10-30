#!/usr/bin/env node
// ทดสอบ API ครบ flow กับ Supabase จริง
// ใช้: npm run smoke-test -- <admin_username> <admin_password>
// ตั้ง API_URL ได้ (default http://localhost:3000/api)
//
// หมายเหตุ: สร้างผู้เล่นทดสอบ xpoker_player_id = TEST-xxxx และใช้รางวัลจริง 1 รางวัล
//           ล้างด้วย supabase/reset_test_data.sql หลังทดสอบเสร็จ

const API = (process.env.API_URL || 'http://localhost:3000/api').replace(/\/$/, '');
const [adminUser, adminPass] = process.argv.slice(2);
if (!adminUser || !adminPass) {
  console.error('usage: npm run smoke-test -- <admin_username> <admin_password>');
  process.exit(1);
}

let pass = 0;
let fail = 0;

async function call(method, path, { token, body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

function check(name, res, expectStatus, expectError) {
  const ok =
    res.status === expectStatus && (!expectError || (res.body && res.body.error === expectError));
  if (ok) pass++;
  else fail++;
  const want = expectError ? `${expectStatus} ${expectError}` : `${expectStatus}`;
  const got = `${res.status}${res.body && res.body.error ? ' ' + res.body.error : ''}`;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(45)} want ${want.padEnd(28)} got ${got}`);
  if (!ok) console.log('      ', JSON.stringify(res.body));
  return ok;
}

function show(label, obj) {
  console.log(`      ${label}:`, JSON.stringify(obj));
}

async function main() {
  console.log(`API = ${API}\n`);

  check('health', await call('GET', '/health'), 200);

  // ---------- admin ----------
  const adminLogin = await call('POST', '/admin/auth/login', {
    body: { username: adminUser, password: adminPass },
  });
  if (!check('admin login', adminLogin, 200)) return;
  const A = adminLogin.body.accessToken;

  const xpId = `TEST-${Date.now().toString().slice(-6)}`;
  check(
    'create player: hands < 1666',
    await call('POST', '/admin/players', {
      token: A,
      body: { xpokerPlayerId: xpId, clubName: 'ComBank CLUB', displayName: 'Test low', handsCount: 1665 },
    }),
    400,
    'HANDS_BELOW_REQUIREMENT',
  );

  const created = await call('POST', '/admin/players', {
    token: A,
    body: { xpokerPlayerId: xpId, clubName: 'ComBank CLUB', displayName: 'Smoke Test', handsCount: 1700 },
  });
  if (!check('create player', created, 201)) return;
  show('created', created.body);
  const { id: playerId, username, initialPassword } = created.body;

  check(
    'create player: duplicate xpoker id',
    await call('POST', '/admin/players', {
      token: A,
      body: { xpokerPlayerId: xpId, clubName: 'ComBank CLUB', displayName: 'Dup', handsCount: 1700 },
    }),
    409,
    'PLAYER_ALREADY_EXISTS',
  );

  // ---------- player ----------
  check(
    'player login: wrong password',
    await call('POST', '/auth/login', { body: { username, password: 'wrong-pass' } }),
    401,
    'INVALID_CREDENTIALS',
  );

  const login = await call('POST', '/auth/login', { body: { username, password: initialPassword } });
  if (!check('player login', login, 200)) return;
  const P = login.body.accessToken;

  const me1 = await call('GET', '/me', { token: P });
  check('me (before spin)', me1, 200);
  if (me1.body.spinStatus !== 'NOT_SPUN') {
    fail++;
    console.log('FAIL  spinStatus should be NOT_SPUN');
  }

  const prizes = await call('GET', '/prizes');
  check('prizes', prizes, 200);
  if (prizes.status === 200) {
    console.log('      main wheel:');
    for (const s of prizes.body.mainWheel.segments) {
      console.log(`        ${s.slot}. ${s.code.padEnd(8)} left ${String(s.qtyRemaining).padStart(3)}  ${s.oddsPct}%`);
    }
    console.log('      cash wheel:');
    for (const s of prizes.body.cashWheel.segments) {
      console.log(`        ${s.slot}. ${s.code.padEnd(8)} left ${String(s.qtyRemaining).padStart(3)}  ${s.oddsPct}%`);
    }
  }

  check('spin/cash before spin', await call('POST', '/spin/cash', { token: P }), 400, 'NOT_SPUN');
  check('admin token on player API', await call('POST', '/spin', { token: A }), 401, 'UNAUTHORIZED');

  const spin = await call('POST', '/spin', { token: P });
  if (!check('spin (main wheel)', spin, 200)) return;
  show('spin', spin.body);

  check('spin again', await call('POST', '/spin', { token: P }), 409, 'ALREADY_SPUN');

  const spinId = spin.body.spinId;
  if (spin.body.status === 'CASH_PENDING') {
    console.log('      → ตกช่อง CASH: ทดสอบวงล้อเงินสด');
    check(
      'fulfillment while CASH_PENDING',
      await call('PATCH', `/admin/spins/${spinId}/fulfillment`, {
        token: A,
        body: { status: 'DELIVERED' },
      }),
      400,
      'CASH_NOT_REVEALED',
    );
    const cash = await call('POST', '/spin/cash', { token: P });
    check('spin/cash', cash, 200);
    show('cash', cash.body);
    check('spin/cash again', await call('POST', '/spin/cash', { token: P }), 409, 'CASH_ALREADY_SPUN');
  } else {
    console.log('      → ตกช่องโบนัส');
    check('spin/cash on bonus', await call('POST', '/spin/cash', { token: P }), 400, 'NOT_CASH_SEGMENT');
  }

  const me2 = await call('GET', '/me', { token: P });
  check('me (after spin)', me2, 200);
  show('me', me2.body);

  // ---------- admin after spin ----------
  check('admin get player', await call('GET', `/admin/players/${playerId}`, { token: A }), 200);
  check(
    'admin list DONE',
    await call('GET', `/admin/players?spinStatus=DONE&q=${xpId}`, { token: A }),
    200,
  );

  const ful = await call('PATCH', `/admin/spins/${spinId}/fulfillment`, {
    token: A,
    body: { status: 'DELIVERED', note: 'smoke test' },
  });
  check('fulfillment DELIVERED', ful, 200);

  const summary = await call('GET', '/admin/summary', { token: A });
  check('summary', summary, 200);
  show('summary', summary.body);

  check('admin prizes', await call('GET', '/admin/prizes', { token: A }), 200);
  check('export csv', await call('GET', '/admin/spins/export', { token: A }), 200);
}

main()
  .catch((e) => {
    fail++;
    console.error('ERROR', e.message);
  })
  .finally(() => {
    console.log(`\n${pass} passed, ${fail} failed`);
    console.log('ล้างข้อมูลทดสอบ: รัน supabase/reset_test_data.sql');
    process.exit(fail ? 1 : 0);
  });