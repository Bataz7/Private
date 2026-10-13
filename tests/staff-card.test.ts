Object.assign(process.env, { DISCORD_TOKEN: process.env.DISCORD_TOKEN || 'x.y.z', CLIENT_ID: process.env.CLIENT_ID || '1', SUPABASE_URL: process.env.SUPABASE_URL || 'http://127.0.0.1:1', SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY || 'k' });
import { describe, expect, test } from 'bun:test';
const { STAFF_TIERS, buildStaffCard, cardBadges, countComponents, stars, staffTier, trendArrow, warningDot } = await import('../src/utils/staff-card.ts');

const base = {
  userId: '123456789012345678', name: 'سعود', avatar: 'https://cdn.discordapp.com/avatars/1/a.png', points: 420, complaints: 0, shiftHours: 130.4, voiceHours: 140,
  messages: 2400, helped: 30, ratingAverage: 4.7, ratingCount: 12, rank: 2, totalStaff: 24, topPoints: 900, weekPoints: 85, lastWeekPoints: 60, weekRank: 2,
  streak: 9, warnings: 1, warnLimit: 3, onShiftSince: new Date(Date.now() - 3_600_000), roleName: 'مشرف', dashboardUrl: 'https://rift.example.com', updatedAt: new Date(),
};

function walk(components: any[], visit: (c: any) => void) {
  for (const c of components) { visit(c); if (c.components) walk(c.components, visit); if (c.accessory) visit(c.accessory); }
}
function validate(card: ReturnType<typeof buildStaffCard>) {
  expect(card.flags & (1 << 15)).toBeTruthy();
  expect(card.components).toHaveLength(1);
  expect(card.components[0].type).toBe(17);
  expect(countComponents(card.components)).toBeLessThanOrEqual(40);
  let chars = 0;
  walk(card.components, c => {
    expect(typeof c.type).toBe('number');
    if (c.type === 10) { expect(c.content.length).toBeGreaterThan(0); chars += c.content.length; }
    if (c.type === 9) { expect(c.components.length).toBeGreaterThanOrEqual(1); expect(c.components.length).toBeLessThanOrEqual(3); expect(c.accessory.type).toBe(11); }
    if (c.type === 1) { expect(c.components.length).toBeLessThanOrEqual(5); for (const b of c.components) { expect(b.type).toBe(2); expect(b.label.length).toBeGreaterThan(0); expect(b.custom_id ?? b.url).toBeTruthy(); } }
    if (c.type === 12) { expect(c.items.length).toBeGreaterThanOrEqual(1); expect(c.items[0].media.url).toMatch(/^https:/); }
  });
  expect(chars).toBeLessThanOrEqual(4000);
  return card;
}
const types = (card: any) => card.components[0].components.map((c: any) => c.type);
const allText = (card: any) => { let s = ''; walk(card.components, c => { if (c.type === 10) s += `${c.content}\n`; }); return s; };

describe('staffTier', () => {
  test('thresholds match the dashboard (0/100/300/600/1000/2000)', () => {
    expect(STAFF_TIERS.map(t => [t.name, t.min])).toEqual([['برونزي', 0], ['فضي', 100], ['ذهبي', 300], ['بلاتيني', 600], ['ماسي', 1000], ['أسطوري', 2000]]);
  });
  test('boundaries', () => {
    expect(staffTier(0).name).toBe('برونزي');
    expect(staffTier(99).name).toBe('برونزي');
    expect(staffTier(100).name).toBe('فضي');
    expect(staffTier(299).nextAt).toBe(300);
    expect(staffTier(300).name).toBe('ذهبي');
    expect(staffTier(999).name).toBe('بلاتيني');
    expect(staffTier(1000).name).toBe('ماسي');
    expect(staffTier(2000).name).toBe('أسطوري');
    expect(staffTier(5000).next).toBeNull();
    expect(staffTier(5000).progress).toBe(1);
    expect(staffTier(-5).name).toBe('برونزي');
  });
  test('remaining and progress', () => {
    const t = staffTier(420);
    expect(t.remaining).toBe(180);
    expect(t.progress).toBeCloseTo(0.4);
    expect(typeof t.color).toBe('number');
  });
});

describe('helpers', () => {
  test('stars', () => { expect(stars(4.4)).toBe('★★★★☆'); expect(stars(0)).toBe('☆☆☆☆☆'); expect(stars(5)).toBe('★★★★★'); });
  test('warning dot', () => { expect(warningDot(0, 3)).toBe('🟢'); expect(warningDot(1, 3)).toBe('🟡'); expect(warningDot(2, 3)).toBe('🔴'); });
  test('trend', () => { expect(trendArrow(5, 3)).toBe('▲'); expect(trendArrow(1, 3)).toBe('▼'); expect(trendArrow(3, 3)).toBe('▬'); expect(trendArrow(3)).toBe(''); });
  test('badges', () => {
    const b = cardBadges(base);
    expect(b.some(x => x.includes('🔥'))).toBe(true);
    expect(b.some(x => x.includes('🏆'))).toBe(true);
    expect(b.some(x => x.includes('⭐'))).toBe(true);
    expect(b.some(x => x.includes('🎧'))).toBe(true);
    expect(cardBadges({ ...base, streak: 2, weekRank: null, ratingAverage: 3, voiceHours: 5 }).some(x => x.includes('🔥') || x.includes('🎧'))).toBe(false);
  });
});

describe('buildStaffCard', () => {
  test('normal member with banner', () => {
    const card = validate(buildStaffCard({ ...base, banner: 'https://cdn.discordapp.com/banners/1/b.png?size=1024' }));
    expect(types(card)[0]).toBe(12);
    expect(card.components[0].accent_color).toBe(staffTier(420).color);
    const txt = allText(card);
    expect(txt).toContain('باقي');
    expect(txt).toContain('Rift Staff');
    expect(txt).toContain('▲');
    const rowEl = card.components[0].components.at(-1);
    expect(rowEl.type).toBe(1);
    expect(rowEl.components.map((b: any) => b.label)).toEqual(['سجل الشفتات', 'النقاط', 'فتح في الداشبورد']);
    expect(rowEl.components[2].url).toBe('https://rift.example.com/dashboard/staff?user=123456789012345678');
  });
  test('without a banner and without a dashboard url', () => {
    const card = validate(buildStaffCard({ ...base, banner: null, dashboardUrl: null }, true));
    expect(types(card)[0]).toBe(9);
    expect(card.flags & 64).toBe(64);
    expect(card.components[0].components.at(-1).components).toHaveLength(2);
  });
  test('dismissed member', () => {
    const card = validate(buildStaffCard({ ...base, dismissed: true, dismissReason: 'غياب متكرر', rank: null, banner: 'https://cdn.discordapp.com/banners/1/b.png' }));
    expect(card.components[0].accent_color).toBe(0xe5484d);
    const txt = allText(card);
    expect(txt).toContain('مفصول');
    expect(txt).toContain('غياب متكرر');
    expect(txt).not.toContain('الإنجازات');
  });
  test('minimal data and very long names stay valid', () => {
    validate(buildStaffCard({ name: 'x'.repeat(500), avatar: 'https://a/b.png', points: 0, complaints: 0, shiftHours: 0, voiceHours: 0, messages: 0 }));
  });
});
