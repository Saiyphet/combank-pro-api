// One-time local setup: random secrets for the Docker database (local-dev/.env) and an API .env pointing at it.
// Both files are git-ignored. Re-running never overwrites them.
import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = p => fileURLToPath(new URL(p, import.meta.url));
const rand = n => randomBytes(n).toString('base64url');
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');

const dockerEnv = here('./.env'), apiEnv = here('../.env');
if (existsSync(dockerEnv) || existsSync(apiEnv)) {
  console.log('local-dev/.env or .env already exists; nothing changed. Delete both to start over (and run `docker compose -f local-dev/docker-compose.yml down -v`).');
  process.exit(0);
}

const pgrstSecret = rand(48);
// HS256 token with role service_role: what Supabase's service_role key is
const head = b64({ alg: 'HS256', typ: 'JWT' }), body = b64({ role: 'service_role', iss: 'base-local' });
const serviceKey = `${head}.${body}.${createHmac('sha256', pgrstSecret).update(`${head}.${body}`).digest('base64url')}`;

writeFileSync(dockerEnv, `POSTGRES_PASSWORD=${rand(24)}\nPGRST_JWT_SECRET=${pgrstSecret}\n`);
writeFileSync(apiEnv, [
  '# Local development only: points at the Docker database in local-dev/. Created by local-dev/setup.mjs.',
  'PORT=3002',
  'SUPABASE_URL=http://127.0.0.1:55341',
  `SUPABASE_SERVICE_ROLE_KEY=${serviceKey}`,
  `JWT_SECRET=${rand(48)}`,
  'JWT_EXPIRES_IN=12h',
  'CORS_ORIGINS=',
  'CAMPAIGN_START=',
  'CAMPAIGN_END=',
  'THATLUANG_START=',
  'THATLUANG_END=',
  '',
].join('\n'));
console.log('Wrote local-dev/.env and .env. Next: docker compose -f local-dev/docker-compose.yml up -d');
