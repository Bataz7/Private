// البيئة الوهمية: الخدمات تقرأ env عند الاستيراد.
Object.assign(process.env, { DISCORD_TOKEN: process.env.DISCORD_TOKEN || 'x.y.z', CLIENT_ID: process.env.CLIENT_ID || '1', SUPABASE_URL: process.env.SUPABASE_URL || 'http://127.0.0.1:1', SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY || 'k' });
import { describe, expect, test } from 'bun:test';
const { presenceConfig, presenceStep } = await import('../src/services/presence-check.service.ts');
const { activeMsWithin, weekStartOf } = await import('../src/services/leaderboard.service.ts');

const M = 60_000;
describe('weekStartOf (Saturday 00:00 UTC+3)', () => {
  test('mid-week', () => {
    // Tue 2026-10-13 12:00 UTC → Sat 2026-10-10 00:00 KSA = Fri 2026-10-09 21:00 UTC
    expect(weekStartOf(Date.parse('2026-10-13T12:00:00Z')).toISOString()).toBe('2026-10-09T21:00:00.000Z');
  });
  test('boundaries', () => {
    expect(weekStartOf(Date.parse('2026-10-09T21:00:00Z')).toISOString()).toBe('2026-10-09T21:00:00.000Z');
    expect(weekStartOf(Date.parse('2026-10-09T20:59:59Z')).toISOString()).toBe('2026-10-02T21:00:00.000Z');
    expect(weekStartOf(Date.parse('2026-10-16T20:59:59Z')).toISOString()).toBe('2026-10-09T21:00:00.000Z');
  });
});

describe('presenceStep', () => {
  const cfg = presenceConfig(null);
  const base = { startedAt: 0, inVoice: true, onBreak: false };
  test('defaults 60/30', () => { expect(cfg).toEqual({ enabled: true, afterMs: 60 * M, timeoutMs: 30 * M }); });
  test('sends after 60 min without activity in voice', () => {
    expect(presenceStep({ ...base, now: 59 * M, lastActivityAt: 0 }, cfg)).toBe('none');
    expect(presenceStep({ ...base, now: 60 * M, lastActivityAt: 0 }, cfg)).toBe('send');
    expect(presenceStep({ ...base, now: 90 * M, lastActivityAt: 40 * M }, cfg)).toBe('none');
    expect(presenceStep({ ...base, now: 90 * M, lastActivityAt: 0, voiceJoinedAt: 31 * M }, cfg)).toBe('none');
  });
  test('not in voice / disabled / break', () => {
    expect(presenceStep({ ...base, inVoice: false, now: 500 * M }, cfg)).toBe('none');
    expect(presenceStep({ ...base, onBreak: true, now: 500 * M }, cfg)).toBe('none');
    expect(presenceStep({ ...base, now: 500 * M }, presenceConfig({ presenceCheckEnabled: false }))).toBe('none');
  });
  test('wait then timeout 30 min after the check', () => {
    expect(presenceStep({ ...base, now: 89 * M, checkSentAt: 60 * M }, cfg)).toBe('wait');
    expect(presenceStep({ ...base, now: 90 * M, checkSentAt: 60 * M, inVoice: false }, cfg)).toBe('timeout');
  });
  test('custom minutes', () => {
    const c = presenceConfig({ presenceCheckMinutes: 20, presenceCheckTimeoutMinutes: 10 });
    expect(presenceStep({ ...base, now: 20 * M }, c)).toBe('send');
    expect(presenceStep({ ...base, now: 30 * M, checkSentAt: 20 * M }, c)).toBe('timeout');
  });
});

test('activeMsWithin clips to window and subtracts breaks', () => {
  expect(activeMsWithin({ startedAt: 0, endedAt: 100, breaks: [{ startedAt: 40, endedAt: 60 }] }, 50, 200)).toBe(40);
  expect(activeMsWithin({ startedAt: 0, endedAt: null, breaks: [] }, 10, 30)).toBe(20);
});
