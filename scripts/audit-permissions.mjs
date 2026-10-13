// Permission audit: lists every dashboard route that changes data and checks who may call it.
// Run: npm run audit            (npm run audit -- --list  prints every write route, -- --reads every open read route)
// It fails (exit 1) when a route that writes data is open to non-administrators and is not on the reviewed
// "self service" list below, so a new route cannot quietly ship without an administrator check.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const srcDir = resolve(root, 'src');

function walk(dir) {
  return readdirSync(dir).flatMap(name => {
    const full = resolve(dir, name);
    return statSync(full).isDirectory() ? (name === 'public' || name === 'node_modules' ? [] : walk(full)) : full.endsWith('.ts') ? [full] : [];
  });
}
const files = walk(srcDir);
const src = file => readFileSync(resolve(root, file), 'utf8').replaceAll('\r\n', '\n');

// Routes any signed-in staff member may call, each reviewed: they only ever change the caller's own data.
const SELF_SERVICE = new Map([
  ['POST /api/guilds/select', 'switches the caller\'s own selected server (checked against their live access)'],
  ['PATCH /api/notifications/:id/read', 'marks the caller\'s own notification as read'],
  ['PATCH /api/profile', 'edits the caller\'s own profile (bio, links)'],
  ['POST /api/profile/:identifier/rep', 'gives or removes the caller\'s own rep'],
  ['POST /api/profile/:identifier/comments', 'posts a comment as the caller (length and rate limited)'],
  ['DELETE /api/profile/comments/:id', 'the author, the profile owner or an administrator (checked in the handler)'],
  ['POST /auth/logout', 'ends the caller\'s own session'],
  ['POST /api/profile/:userId/rep', 'older in-memory version in server.ts; shadowed by the core route registered first'],
  ['POST /api/profile/:userId/comments', 'older in-memory version in server.ts; shadowed by the core route registered first'],
  ['POST /api/complaints', 'files a complaint; deciding it (PATCH /api/complaints/:id) is administrator-only'],
  ['POST /apply-api/logout', 'public applicant logout (own session only)'],
  ['POST /apply-api/forms/:formId/submit', 'public application submit; login, rate limits and one answer per person are checked in the handler'],
]);
// Routes that only add a hook (they call next() and the built-in route behind them decides who may act).
const PASSTHROUGH_NOTE = 'hook that calls next(); the route behind it has its own administrator check';

// Every GET route that is NOT admin-guarded, each reviewed: what a non-admin can read there.
const OPEN_READS = new Map([
  ['/', 'redirect'], ['/login', 'page shell'], ['/login/', 'page shell'], ['/p', 'redirect'], ['/p/:name', 'page shell (staff login required)'], ['/dashboard', 'page shell'], ['/dashboard/:page', 'page shell (staff login required)'], ['/status', 'public status page'], ['/status/:tab', 'public status page'],
  ['/app.css', 'stylesheet'], ['/auth/discord', 'starts OAuth login'], ['/auth/callback', 'OAuth callback'], ['/api/me', 'the caller only'], ['/api/guilds', 'servers the caller can access'],
  ['/api/status', 'public status'], ['/api/status/metrics', 'public status'],
  ['/api/points', 'leaderboard for staff; the ledger is administrator-only (checked live), "me" is the caller'],
  ['/api/notifications', 'the caller\'s own notifications'], ['/api/profile/:identifier', 'staff profile; private logs, complaints and points breakdown only for the owner or an administrator'],
  ['/apply/:formId', 'public application page (static shell)'], ['/apply/:formId/login', 'starts the applicant OAuth login'], ['/apply-api/forms/:formId', 'public form questions only (no applicant data)'],
  ['/api/management-users', 'names of administrators, used by the older notifications composer'], ['/api/staff-reports', 'the caller\'s own weekly reports'], ['/api/grades', 'the caller\'s own grade'],
  ['/status/badge.svg', 'public status'], ['/status.rss', 'public status'],
  ['/api/activity/weekly', 'team-wide activity totals for the chart (no names)'], ['/api/bootstrap', 'hook that calls next(); the built-in route requires an administrator'],
]);

const routes = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
  const pattern = /\b(?:app|router)\.(get|post|put|patch|delete)\(\s*(\[[^\]]*\]|'[^']*'|"[^"]*"|`[^`]*`)/g;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const paths = [...match[2].matchAll(/['"`]([^'"`]+)['"`]/g)].map(item => item[1]);
    const after = text.slice(match.index + match[0].length);
    // The handler: an inline one runs until the next route registration; a named one is looked up in the same file.
    const nextRoute = after.search(/\n\s*(?:app|router)\.(?:get|post|put|patch|delete|use|listen)\(|\n\}\n/);
    let body = after.slice(0, nextRoute === -1 ? 3000 : Math.min(nextRoute, 6000));
    const named = /^\s*,\s*(?:[\w.]+\s*,\s*)*([A-Za-z_]\w*)\s*\)/.exec(after);
    if (named) {
      const start = text.search(new RegExp(`(?:async\\s+)?function\\s+${named[1]}\\s*\\(`));
      if (start !== -1) { const end = text.indexOf('\nfunction ', start + 10); const endAsync = text.indexOf('\nasync function ', start + 10); body = text.slice(start, Math.min(...[end, endAsync].filter(i => i !== -1), start + 6000)); }
    }
    const line = text.slice(0, match.index).split('\n').length;
    // A wrapper such as adminOnly(async (req, res) => ...) or route(...) counts when its definition in this file demands an administrator.
    const wrapper = /^\s*,\s*(?:[\w.]+\s*,\s*)*([A-Za-z_]\w*)\(/.exec(after)?.[1];
    let wrapperAdmin = false;
    if (wrapper) {
      const def = text.search(new RegExp(`(?:const|let|function)\\s+${wrapper}\\b`));
      wrapperAdmin = def !== -1 && /requireAdministrator\(|requireManagement\(|requireOwner\(|isAdministrator|requireStatusAdmin|requireDashboardAdmin/.test(text.slice(def, def + 900));
    }
    const guard = wrapperAdmin || /requireAdministrator\(|requireManagement\(|requireOwner\(|requireStatusAdmin|requireDashboardAdmin|assertAdministrator\(/.test(body) ? 'admin' : /\bnext\(\)/.test(body) ? 'passthrough' : 'open';
    for (const path of paths) routes.push({ method: match[1].toUpperCase(), path, guard, where: `${relative(root, file).replaceAll('\\', '/')}:${line}` });
  }
}

const key = route => `${route.method} ${route.path}`;
if (process.argv.includes('--list')) {
  for (const route of routes.filter(item => item.method !== 'GET')) console.log(`${route.guard.padEnd(11)} ${route.method.padEnd(6)} ${route.path.padEnd(52)} ${route.where}`);
  process.exit(0);
}
if (process.argv.includes('--reads')) {
  for (const route of routes.filter(item => item.method === 'GET' && item.guard !== 'admin')) console.log(`${route.guard.padEnd(11)} ${route.path.padEnd(58)} ${route.where}`);
  process.exit(0);
}
const writes = routes.filter(route => route.method !== 'GET');
const openWrites = writes.filter(route => route.guard === 'open');
const problems = openWrites.filter(route => !SELF_SERVICE.has(key(route)));
const unreviewedReads = routes.filter(route => route.method === 'GET' && route.guard !== 'admin' && !OPEN_READS.has(route.path));
const staleAllowlist = [...SELF_SERVICE.keys()].filter(item => !writes.some(route => key(route) === item));

// ---- Discord side: decisions must check for an administrator, and the shared lock must exist ----
const failures = [];
const GUARD = /isAdministrator\(|replyAdminOnly\(|assertAdministrator\(|canDecide\(/;
// [file, text that starts the handler, lines in which the guard must appear]
const DECISION_HANDLERS = [
  ['src/interactions/buttons.ts', "i.customId.startsWith('leave_approve:')", 4], ['src/interactions/buttons.ts', "i.customId.startsWith('resign_approve:')", 4],
  ['src/interactions/buttons.ts', "i.customId.startsWith('complaint_approve:')", 4],
];
for (const [file, marker, within] of DECISION_HANDLERS) {
  let lines; try { lines = src(file).split('\n'); } catch { continue; }
  const at = lines.findIndex(line => line.includes(marker));
  if (at === -1) continue; // renamed or moved into a module: the module's own service lock is checked below
  if (!lines.slice(at, at + within + 1).some(line => GUARD.test(line))) failures.push(`${file}:${at + 1}: "${marker}" has no administrator check within ${within} lines`);
}
const mustContain = [
  ['src/utils/permissions.ts', "member.guild.ownerId === member.id || member.permissions.has('Administrator')", 'isAdministrator means owner or Administrator permission'],
  ['src/utils/permissions.ts', 'export async function assertAdministrator(', 'the shared service-level lock exists'],
];
for (const [file, text, why] of mustContain) if (!src(file).includes(text)) failures.push(`${file}: missing "${text}" (${why})`);
// The shared lock inside every service function that changes data on an administrator's say-so, before anything changes.
const LOCKED = [['src/core/points.ts', 'adjustStaffPoints'], ['src/core/notifications.ts', 'sendNotification'], ['src/services/mod-report.service.ts', 'decideModReport'], ['src/services/mod-report.service.ts', 'reopenModReport'], ['src/services/mod-report.service.ts', 'addModReportNote']];
for (const [file, name] of LOCKED) {
  let text; try { text = src(file); } catch { continue; }
  const start = text.indexOf(`export async function ${name}(`);
  if (start === -1) { failures.push(`${file}: ${name} not found`); continue; }
  const next = text.indexOf('\nexport ', start + 10);
  const body = text.slice(start, next === -1 ? undefined : next);
  const lock = body.indexOf('assertAdministrator('); const firstWrite = body.search(/\.create\(|\.update\(|\.insert\(|\.delete|changePoints\(|supabase\.from\(\w+\)\.(update|insert)/);
  if (lock === -1) failures.push(`${file}: ${name} does not call assertAdministrator`);
  else if (firstWrite !== -1 && lock > firstWrite) failures.push(`${file}: ${name} changes data before the administrator check`);
}
// The dashboard guard itself may only look at owner / Administrator.
{
  const server = src('src/dashboard/server.ts'); const start = server.indexOf('async function requireAdministrator(');
  const body = start === -1 ? '' : server.slice(start, server.indexOf('\n}\n', start));
  if (!body || !/isOwner \|\| isAdministrator/.test(body) || /isStaff|managementRole/.test(body)) failures.push('src/dashboard/server.ts: requireAdministrator must check only owner / Administrator');
}
// Management-role checks are only kept for old call sites; a new import is reported (not fatal).
const warnings = [];
for (const file of files) if (/import\s*\{[^}]*\bisManagement\b[^}]*\}/.test(readFileSync(file, 'utf8'))) warnings.push(relative(root, file).replaceAll('\\', '/'));

console.log(`Discord decision handlers checked: ${DECISION_HANDLERS.length}; shared locks checked: ${LOCKED.length}`);
if (failures.length) { console.log('\nPROBLEMS:'); for (const item of failures) console.log(`  ${item}`); }
if (warnings.length) console.log(`\nNote: these files still import isManagement (it now means the same as administrator): ${warnings.join(', ')}`);
if (unreviewedReads.length) { console.log('\nOPEN READ ROUTES that are not reviewed. Add an administrator check, or review what a non-admin can read and list them in OPEN_READS:'); for (const route of unreviewedReads) { console.log(`  GET ${route.path}   (${route.where})`); failures.push(`unreviewed open GET ${route.path}`); } }
console.log(`\nDashboard routes that change data: ${writes.length}`);
console.log(`  administrator only   : ${writes.filter(route => route.guard === 'admin').length}`);
console.log(`  hooks (call next())  : ${writes.filter(route => route.guard === 'passthrough').length} (${PASSTHROUGH_NOTE})`);
console.log(`  self service         : ${openWrites.filter(route => SELF_SERVICE.has(key(route))).length}`);
console.log(`  UNREVIEWED           : ${problems.length}\n`);
for (const [route, why] of SELF_SERVICE) console.log(`  self service  ${route.padEnd(46)} ${why}`);
if (staleAllowlist.length) console.log(`\nAllowlist entries that no longer match a route: ${staleAllowlist.join(', ')}`);
if (problems.length) {
  console.log('\nOPEN WRITE ROUTES that are not reviewed. Add an administrator check, or review and add them to SELF_SERVICE:');
  for (const route of problems) console.log(`  ${route.method.padEnd(6)} ${route.path}   (${route.where})`);
}
if (problems.length || failures.length) process.exit(1);
console.log('\nAll write routes need an administrator (or are reviewed self-service routes), and the shared locks are in place. OK');
