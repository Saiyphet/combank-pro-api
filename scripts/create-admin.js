#!/usr/bin/env node
// สร้าง / เปลี่ยนรหัส admin
// ใช้: npm run create-admin -- <username> <password> [SUPER|STAFF]
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');

async function main() {
  const [username, password, role = 'SUPER'] = process.argv.slice(2);
  if (!username || !password) {
    console.error('usage: npm run create-admin -- <username> <password> [SUPER|STAFF]');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('password ต้องยาวอย่างน้อย 8 ตัว');
    process.exit(1);
  }
  if (!['SUPER', 'STAFF'].includes(role)) {
    console.error('role ต้องเป็น SUPER หรือ STAFF');
    process.exit(1);
  }

  const url = (process.env.SUPABASE_URL || '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/rest\/v1$/, '');
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url) || !key) {
    console.error(`ตรวจ .env: SUPABASE_URL="${url}" ต้องเป็น https://<ref>.supabase.co และต้องมี SUPABASE_SERVICE_ROLE_KEY`);
    process.exit(1);
  }

  const db = createClient(url, key, { auth: { persistSession: false } });

  const { error } = await db
    .from('ld_admins')
    .upsert(
      { username, password_hash: await bcrypt.hash(password, 10), role },
      { onConflict: 'username' },
    );
  if (error) {
    console.error(error.message);
    process.exit(1);
  }
  console.log(`admin "${username}" (${role}) ພ້ອມໄຊ້ງານ`);
}

main();