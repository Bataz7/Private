Object.assign(process.env, { DISCORD_TOKEN: process.env.DISCORD_TOKEN || 'x.y.z', CLIENT_ID: process.env.CLIENT_ID || '1', SUPABASE_URL: process.env.SUPABASE_URL || 'http://127.0.0.1:1', SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY || 'k' });
import { beforeEach, describe, expect, test } from 'bun:test';
const auto = await import('../src/services/auto-shift.service.ts');
const presence = await import('../src/services/presence-check.service.ts');
const { notifyShift } = await import('../src/services/shift.service.ts');
const home = await import('../src/config/home-guild.ts');

const M = 60_000;
beforeEach(() => { auto._resetAutoShiftState(); presence._resetPresenceState(); });

describe('autoShiftConfig', () => {
  test('defaults include a 60 s voice dwell', () => {
    expect(auto.autoShiftConfig(null)).toEqual({ enabled: true, messages: 20, windowMs: 10 * M, idleMs: 30 * M, voiceDwellMs: 60_000 });
  });
  test('optional voice seconds setting is clamped', () => {
    expect(auto.autoShiftConfig({ autoShiftVoiceSeconds: 5 } as any).voiceDwellMs).toBe(5_000);
    expect(auto.autoShiftConfig({ autoShiftVoiceSeconds: 99999 } as any).voiceDwellMs).toBe(600_000);
    expect(auto.autoShiftConfig({ autoShiftVoiceSeconds: 'x' } as any).voiceDwellMs).toBe(60_000);
  });
});

describe('voice rules', () => {
  const cfg = auto.autoShiftConfig(null);
  test('short hops do not start a shift', () => {
    expect(auto.voiceDwellReached(1_000, 30_000, cfg)).toBe(false);
    expect(auto.voiceDwellReached(1_000, 61_000, cfg)).toBe(true);
    expect(auto.voiceDwellReached(null, 61_000, cfg)).toBe(false);
  });
  test('deafened and AFK do not count', () => {
    expect(auto.voiceCountsForShift({ channelId: 'v1', afkChannelId: 'afk' })).toBe(true);
    expect(auto.voiceCountsForShift({ channelId: 'v1', selfDeaf: true })).toBe(false);
    expect(auto.voiceCountsForShift({ channelId: 'v1', serverDeaf: true })).toBe(false);
    expect(auto.voiceCountsForShift({ channelId: 'afk', afkChannelId: 'afk' })).toBe(false);
    expect(auto.voiceCountsForShift({ channelId: null })).toBe(false);
  });
});

describe('leaveActiveAt', () => {
  const now = Date.parse('2026-10-13T12:00:00Z');
  const leave = { status: 'approved', activatedAt: new Date(now - 86_400_000), startDate: '2026-10-12', endDate: '2026-10-13' };
  test('active leave blocks auto start', () => { expect(auto.leaveActiveAt(leave, now)).toBe(true); });
  test('last day counts until its end', () => { expect(auto.leaveActiveAt(leave, Date.parse('2026-10-13T23:59:00Z'))).toBe(true); expect(auto.leaveActiveAt(leave, Date.parse('2026-10-14T00:00:01Z'))).toBe(false); });
  test('not activated / pending / none', () => {
    expect(auto.leaveActiveAt({ ...leave, activatedAt: null }, now)).toBe(false);
    expect(auto.leaveActiveAt({ ...leave, status: 'pending' }, now)).toBe(false);
    expect(auto.leaveActiveAt(null, now)).toBe(false);
  });
});

describe('shift cache', () => {
  const shift = { id: 7, guildId: 'g', userId: 'u', status: 'active', startedAt: new Date(), breaks: [] } as any;
  test('ending a shift anywhere clears the cache', () => {
    auto._primeShiftCache(shift);
    expect(auto._cachedShiftFor('g', 'u')).toBe(shift);
    notifyShift('g', 'u', 'end');
    expect(auto._cachedShiftFor('g', 'u')).toBeNull();
  });
  test('starting a shift elsewhere clears a cached "no shift"', () => {
    auto._primeShiftCache({ ...shift, userId: 'v' });
    notifyShift('g', 'v', 'start');
    expect(auto._cachedShiftFor('g', 'v')).toBeNull();
  });
});

describe('presence check', () => {
  const cfg = presence.presenceConfig(null);
  test('owner rule: ask after 60 min, stop 30 min later', () => {
    const base = { startedAt: 0, inVoice: true, onBreak: false };
    expect(presence.presenceStep({ ...base, now: 60 * M, lastActivityAt: 0 }, cfg)).toBe('send');
    expect(presence.presenceStep({ ...base, now: 89 * M, checkSentAt: 60 * M }, cfg)).toBe('wait');
    expect(presence.presenceStep({ ...base, now: 90 * M, checkSentAt: 60 * M }, cfg)).toBe('timeout');
  });
  test('next check time', () => {
    expect(presence.nextPresenceAt({ startedAt: 0, lastActivityAt: 10 * M, voiceJoinedAt: 20 * M, inVoice: true, onBreak: false }, cfg)).toEqual({ kind: 'check', at: 80 * M });
    expect(presence.nextPresenceAt({ startedAt: 0, checkSentAt: 60 * M, inVoice: false, onBreak: false }, cfg)).toEqual({ kind: 'deadline', at: 90 * M });
    expect(presence.nextPresenceAt({ startedAt: 0, inVoice: false, onBreak: false }, cfg)).toBeNull();
    expect(presence.nextPresenceAt({ startedAt: 0, inVoice: true, onBreak: true }, cfg)).toBeNull();
  });
  test('message is a small CV2 container with the question, the subline and one button', () => {
    const msg = presence.presenceMessage('g', 5, 1_800_000_000_000) as any;
    expect(msg.flags & (1 << 15)).toBeTruthy();
    const box = msg.components[0];
    expect(box.type).toBe(17);
    const texts = box.components.filter((c: any) => c.type === 10).map((c: any) => c.content).join('\n');
    expect(texts).toContain('هل انت موجود؟');
    expect(texts).toContain('اضغط الزر عشان يستمر شفتك');
    expect(texts).toContain('<t:1800000000:R>');
    expect(texts).not.toMatch(/يوقف|ينتهي|بيوقف/);
    const button = box.components.find((c: any) => c.type === 1).components[0];
    expect(button.custom_id).toBe('presence:confirm:g:5');
    expect(button.label).toBe('موجود');
  });
  test('no pending check by default', () => {
    expect(presence.hasPendingCheck('g', 'u')).toBe(false);
  });
  test('voice joined tracking', () => {
    presence.setVoiceJoined('g', 'u', 123);
    expect(presence.voiceJoinedAt('g', 'u')).toBe(123);
    presence.setVoiceJoined('g', 'u', null);
    expect(presence.voiceJoinedAt('g', 'u')).toBeNull();
  });
});

describe('single server', () => {
  test('GUILD_ID missing: first guild is home, others are ignored, DMs allowed', () => {
    const r = home.resolveHomeGuild(['111', '222']);
    expect(r).toEqual({ id: '111', fallback: true });
    expect(home.isHomeGuild('111')).toBe(true);
    expect(home.isHomeGuild('222')).toBe(false);
    expect(home.isHomeGuild(null)).toBe(true);
    expect(home.OTHER_GUILD_REPLY).toBe('هذا البوت خاص بسيرفر واحد');
  });
});
