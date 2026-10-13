import { describe, expect, test } from 'bun:test';
// قاعدة بيانات وهمية (scripts/mock-supabase.ts) على منفذ محلي، والخدمات تقرأ env عند الاستيراد.
const PORT = 38070 + Math.floor(Math.random() * 20);
Object.assign(process.env, { DISCORD_TOKEN: 'x.y.z', CLIENT_ID: '1', SUPABASE_URL: `http://127.0.0.1:${PORT}`, SUPABASE_SECRET_KEY: 'k' });
const { db, handleSupabase } = await import('../scripts/mock-supabase.ts');
Bun.serve({ port: PORT, hostname: '127.0.0.1', async fetch(req) { return (await handleSupabase(req, new URL(req.url))) ?? new Response('no', { status: 404 }); } });
const { dismissStaff, reinstateStaff, isDismissed } = await import('../src/services/dismissal.service.ts');
const { ensureStaff, DismissedError } = await import('../src/services/shift.service.ts');
const { createWarning } = await import('../src/core/warnings.ts');
const { resetDismissedColumnCheck } = await import('../src/discipline/dismissed.ts');

const G = 'g1';
db.seed('guild_settings', [{ guild_id: G, staff_role_id: 'rStaff', on_shift_role_id: 'rShift', leave_role_id: '', logs_channel_id: '' }]);
function fakeGuild(userRoles: Record<string, string[]>) {
  const dms: string[] = [];
  const client: any = { user: { id: 'bot' }, channels: { fetch: async () => null }, users: { fetch: async (id: string) => ({ id, send: async () => { dms.push(id); return {}; } }) } };
  const guild: any = {
    id: G, name: 'سيرفر', ownerId: 'owner', client,
    roles: { cache: new Map([['rStaff', { name: 'Staff', editable: true }], ['rShift', { name: 'Shift', editable: true }]]) },
    members: {
      me: null, fetchMe: async () => null,
      fetch: async (q: any) => {
        const id = typeof q === 'string' ? q : q.user;
        const roles = userRoles[id];
        if (!roles) throw new Error('unknown member');
        return { id, user: { id, send: async () => { dms.push(id); return {}; } }, roles: { cache: { has: (r: string) => roles.includes(r) }, remove: async (r: string) => { roles.splice(roles.indexOf(r), 1); }, add: async (r: string) => { roles.push(r); } } };
      },
    },
  };
  return { guild, dms };
}

describe('dismissal', () => {
  for (const missing of [false, true]) test(missing ? 'without migration 036' : 'with migration 036', async () => {
    process.env.MOCK_MISSING_COLUMNS = missing ? 'dismissed_at,dismissed_by,dismiss_reason,warn_limit' : '';
    resetDismissedColumnCheck();
    const user = missing ? 'u2' : 'u1';
    const roles: Record<string, string[]> = { [user]: ['rStaff', 'rShift'] };
    const { guild, dms } = fakeGuild(roles);
    db.seed('staff', [{ id: missing ? 2 : 1, guild_id: G, user_id: user, active: true, points: 7 }]);
    db.seed('shifts', [{ id: missing ? 12 : 11, guild_id: G, user_id: user, status: 'active', started_at: new Date(Date.now() - 3_600_000).toISOString(), breaks: [] }]);
    const r = await dismissStaff(guild, user, { by: 'admin', reason: 'سبب', resetPoints: true });
    expect(r.rolesRemoved.sort()).toEqual(['rShift', 'rStaff']);
    expect(r.shiftEnded).toBe(true);
    expect(r.dmSent).toBe(true);
    expect(dms).toEqual([user]);
    expect(await isDismissed(G, user)).toBe(true);
    expect(db.table('staff').find(s => s.user_id === user)?.points).toBe(0);
    await expect(ensureStaff(G, user)).rejects.toBeInstanceOf(DismissedError);
    await expect(dismissStaff(guild, user, { by: 'admin', reason: 'x' })).rejects.toThrow('مفصول من قبل');
    const back = await reinstateStaff(guild, user, { by: 'admin' });
    expect(back.roleRestored).toBe(true);
    expect(await isDismissed(G, user)).toBe(false);
    expect((await ensureStaff(G, user)).active).toBe(true);
  });

  test('warn limit dismisses at 3', async () => {
    process.env.MOCK_MISSING_COLUMNS = '';
    resetDismissedColumnCheck();
    const { guild } = fakeGuild({ u3: ['rStaff'] });
    db.seed('staff', [{ id: 3, guild_id: G, user_id: 'u3', active: true, points: 1 }]);
    for (let n = 1; n <= 2; n++) expect((await createWarning({ guildId: G, staffUserId: 'u3', reason: 'r', issuedBy: 'admin' }, { guild })).limit?.dismissed).toBe(false);
    const third = await createWarning({ guildId: G, staffUserId: 'u3', reason: 'r', issuedBy: 'admin' }, { guild });
    expect(third.limit).toMatchObject({ count: 3, limit: 3, dismissed: true });
    expect(await isDismissed(G, 'u3')).toBe(true);
  });
});
