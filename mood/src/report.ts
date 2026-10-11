/**
 * تقرير HTML احترافي — ملف واحد يفتح بأي متصفح (بدون إنترنت).
 * رسوم SVG/HTML خفيفة + تلميحات (tooltips) عند المرور/التركيز + وضع ليلي + جدول كامل.
 * الألوان: سلم متباعد (أحمر ← رمادي ← أزرق) مفحوص لعمى الألوان، والوجوه تعطي معنى إضافي.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ACHIEVEMENTS } from "./achievements.ts";
import { MOODS, mood, tagById } from "./moods.ts";
import { describeCorr, type PeriodStats } from "./stats.ts";
import { addDays, arabicDate, diffDays, weekdayOf, WEEKDAYS_AR } from "./time.ts";
import type { ReportInsight } from "./ai.ts";

const EMOJI_DIR = fileURLToPath(new URL("../assets/emojis/", import.meta.url));
const SMALL_DIR = fileURLToPath(new URL("../assets/emojis-small/", import.meta.url));
const emojiCache = new Map<string, string>();

/** الصورة كـ data URI (الصغيرة 48px للتقارير عشان الحجم، والكبيرة للهيدر). */
export function emojiDataUri(name: string, big = false): string {
  const key = `${name}:${big}`;
  let v = emojiCache.get(key);
  if (v === undefined) {
    const p = [big ? EMOJI_DIR : SMALL_DIR, EMOJI_DIR].map((d) => `${d}${name}.png`).find((f) => existsSync(f));
    v = p ? `data:image/png;base64,${readFileSync(p).toString("base64")}` : "";
    emojiCache.set(key, v);
  }
  return v;
}

/** الإيموجي كـ class في CSS (الصورة تنكتب مرة وحدة بس بدل كل صف). */
function emo(name: string, label = "", cls = ""): string {
  return `<i class="emo e-${name}${cls ? ` ${cls}` : ""}"${label ? ` role="img" aria-label="${label}"` : ` aria-hidden="true"`}></i>`;
}

function emojiCSS(): string {
  return MOODS.map((m) => `.e-${m.key}{background-image:url(${emojiDataUri(m.key)})}`).join("");
}

export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const fmt1 = (n: number) => n.toFixed(1);
/** نعزل الأرقام بإشارة (LRI…PDI) عشان ما تنقلب الإشارة داخل النص العربي. */
const iso = (s: string) => `\u2066${s}\u2069`;
const signed = (n: number, d = 1, suffix = "") => iso(`${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(d)}${suffix}`);
const tip = (...lines: string[]) => `data-tip="${esc(lines.join("|"))}" tabindex="0"`;

export interface ReportInput {
  name: string;
  stats: PeriodStats;
  insight: ReportInsight & { source?: string };
  unlocked: string[];
  generatedAt: string;
  title?: string;
}

// ─────────── الرسوم ───────────

function lineChart(st: PeriodStats): string {
  if (st.count < 2) return `<p class="muted">نحتاج يومين على الأقل للرسم.</p>`;
  const W = 760, H = 250, L = 34, R = 16, T = 14, B = 30;
  const span = Math.max(st.days - 1, 1);
  const x = (day: string) => L + ((W - L - R) * diffDays(day, st.start)) / span;
  const y = (v: number) => T + ((H - T - B) * (5 - v)) / 4;

  const grid = MOODS.map((m) =>
    `<line x1="${L}" x2="${W - R}" y1="${y(m.value)}" y2="${y(m.value)}" class="grid"/>` +
    `<use href="#ei${m.value}" x="4" y="${y(m.value) - 10}"><title>${m.label}</title></use>`).join("");
  const defs = `<defs>${MOODS.map((m) => `<image id="ei${m.value}" href="${emojiDataUri(m.key)}" width="20" height="20"/>`).join("")}</defs>`;

  const pts = st.entries.map((e) => ({ x: x(e.day), y: y(e.mood), e }));
  // فترة قصيرة: نوصل النقاط ببعض. فترة طويلة: النقاط لحالها + خط المتوسط المتحرك (7 أيام) عشان يبان الاتجاه.
  const longRange = st.days > 21 && st.count >= 7;
  const series = longRange ? st.movingAvg.map((p) => ({ x: x(p.day), y: y(p.value), day: p.day })) : pts.map((p) => ({ x: p.x, y: p.y, day: p.e.day }));
  // نقطع الخط لو فيه فجوة أكثر من يومين بدون تسجيل
  const segs: string[] = [];
  let cur: string[] = [];
  series.forEach((p, i) => {
    if (i > 0 && diffDays(p.day, series[i - 1]!.day) > 2) { segs.push(cur.join(" ")); cur = []; }
    cur.push(`${p.x.toFixed(1)},${p.y.toFixed(1)}`);
  });
  segs.push(cur.join(" "));
  const lines = segs.filter((s) => s.includes(" ")).map((s) => `<polyline points="${s}" class="series-line"/>`).join("");
  const dots = pts.map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${longRange ? 4 : 5}" class="dot m${p.e.mood}"/>`).join("");

  const tickEvery = Math.max(1, Math.ceil(st.days / 8));
  const ticks: string[] = [];
  for (let i = 0; i < st.days; i += tickEvery) {
    const d = addDays(st.start, i);
    ticks.push(`<text x="${x(d).toFixed(1)}" y="${H - 8}" class="tick">${d.slice(5).replace("-", "/")}</text>`);
  }
  const last = series[series.length - 1]!;
  const lastVal = longRange ? st.movingAvg[st.movingAvg.length - 1]!.value : pts[pts.length - 1]!.e.mood;
  const endText = longRange ? `متوسط ${fmt1(lastVal)}` : mood(lastVal).label;
  const endLabel = `<text x="${Math.min(last.x + 8, W - R - 2).toFixed(1)}" y="${(last.y - 10).toFixed(1)}" class="end-label" text-anchor="${last.x > W - 80 ? "end" : "start"}">${endText}</text>`;

  const ma = new Map(st.movingAvg.map((p) => [p.day, p.value]));
  const data = JSON.stringify(pts.map((p) => ({
    x: +p.x.toFixed(1), y: +p.y.toFixed(1), d: arabicDate(p.e.day), m: mood(p.e.mood).label, v: p.e.mood,
    a: longRange ? `متوسط 7 أيام: ${fmt1(ma.get(p.e.day) ?? p.e.mood)}` : "",
  })))
    .replace(/</g, "\\u003c");

  return `<div class="chart-wrap" dir="ltr">
<svg viewBox="0 0 ${W} ${H}" class="chart" id="line" role="img" aria-label="المزاج يوم بيوم">
<line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" class="axis"/>
${defs}${grid}${lines}${dots}${ticks.join("")}${endLabel}
<line id="xhair" x1="0" x2="0" y1="${T}" y2="${H - B}" class="xhair" visibility="hidden"/>
<rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent" id="line-hit"/>
</svg></div>
${longRange ? `<div class="legend"><span class="key"><i class="sw dotkey"></i>كل يوم (اللون = المزاج)</span><span class="key"><i class="linekey"></i>المتوسط المتحرك لـ 7 أيام</span></div>` : ""}
<script type="application/json" id="line-data">${data}</script>`;
}

function calendar(st: PeriodStats): string {
  if (st.days < 14) return "";
  const byDay = new Map(st.entries.map((e) => [e.day, e]));
  const startPad = weekdayOf(st.start); // الأسبوع يبدأ الأحد
  const first = addDays(st.start, -startPad);
  const weeks = Math.ceil((diffDays(st.end, first) + 1) / 7);
  const C = weeks <= 6 ? 22 : weeks <= 10 ? 18 : 15, G = 3;
  const cells: string[] = [];
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const day = addDays(first, w * 7 + d);
      if (day < st.start || day > st.end) continue;
      const e = byDay.get(day);
      const cls = e ? `m${e.mood}` : "empty";
      const t = e ? tip(mood(e.mood).label, arabicDate(day)) : tip("بدون تسجيل", arabicDate(day));
      cells.push(`<rect x="${w * (C + G)}" y="${d * (C + G)}" width="${C}" height="${C}" rx="3" class="cell ${cls}" ${t}/>`);
    }
  }
  const W = weeks * (C + G), H = 7 * (C + G);
  const rows = [0, 2, 4, 6].map((d) => `<span style="top:${d * (C + G)}px;line-height:${C}px">${WEEKDAYS_AR[d]}</span>`).join("");
  const legend = [...MOODS].reverse().map((m) => `<span class="key"><i class="sw m${m.value}"></i>${m.label}</span>`).join("") +
    `<span class="key"><i class="sw empty"></i>بدون تسجيل</span>`;
  return `<section class="card"><h2>🗓️ خريطة الأيام</h2>
<div class="cal"><div class="cal-days" style="height:${H}px">${rows}</div><div class="cal-grid" dir="ltr"><svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="خريطة أيام المزاج">${cells.join("")}</svg></div></div>
<div class="legend">${legend}</div></section>`;
}

function distribution(st: PeriodStats): string {
  const max = Math.max(1, ...Object.values(st.dist));
  return MOODS.map((m) => {
    const n = st.dist[m.value];
    const pct = st.count ? Math.round((n / st.count) * 100) : 0;
    return `<div class="hbar" ${tip(`${n} يوم (${pct}%)`, m.label)}>
${emo(m.key)}<span class="hbar-label">${m.label}</span>
<div class="hbar-track">${n ? `<div class="hbar-fill m${m.value}" style="width:${(n / max) * 100}%"></div>` : ""}<span class="hbar-val">${n}</span></div></div>`;
  }).join("");
}

function weekdays(st: PeriodStats): string {
  const cols = st.weekdayAvg.map((v, i) => {
    const h = v === null ? 0 : (v / 5) * 100;
    const label = v === null ? "—" : fmt1(v);
    return `<div class="col" ${tip(v === null ? "بدون بيانات" : `${label} / 5`, WEEKDAYS_AR[i]!)}>
<div class="col-plot"><span class="col-val">${label}</span><div class="col-bar${i === st.bestWeekday ? " best" : ""}" style="height:${h}%"></div></div>
<span class="col-label">${WEEKDAYS_AR[i]}</span></div>`;
  }).join("");
  return `<div class="cols">${cols}</div>`;
}

function tagImpact(st: PeriodStats): string {
  if (!st.tags.length) return `<p class="muted">حدد أنشطة يومك بعد كل تسجيل 🏷️ عشان نعرف وش يأثر على مزاجك.</p>`;
  const max = Math.max(0.5, ...st.tags.map((t) => Math.abs(t.delta)));
  return `<div class="div-chart" dir="ltr">${st.tags.slice(0, 12).map((t) => {
    const w = (Math.abs(t.delta) / max) * 100;
    const pos = t.delta >= 0;
    const bar = `<div class="div-bar ${pos ? "pos" : "neg"}" style="width:${w}%"></div><span class="div-val">${signed(t.delta)}</span>`;
    return `<div class="div-row" ${tip(`${signed(t.delta)} عن متوسطك`, `${t.label} · ${t.count} مرات · متوسط ${fmt1(t.avg)}`)}>
<div class="div-half neg-side">${pos ? "" : bar}</div><div class="div-half pos-side">${pos ? bar : ""}</div>
<div class="div-label" dir="rtl">${t.emoji} ${esc(t.label)}</div></div>`;
  }).join("")}</div>
<div class="legend"><span class="key"><i class="sw pos"></i>يرفع المزاج</span><span class="key"><i class="sw neg"></i>ينزّل المزاج</span></div>`;
}

function sleepEnergy(st: PeriodStats): string {
  if (st.sleepAvg === null && st.energyAvg === null) return "";
  const tiles: string[] = [];
  if (st.sleepAvg !== null) tiles.push(tile("متوسط النوم", `${fmt1(st.sleepAvg)} س`, describeCorr(st.sleepCorr) ? `مع المزاج: ${describeCorr(st.sleepCorr)}` : ""));
  if (st.sleepGood !== null) tiles.push(tile("النوم في الأيام الحلوة", `${fmt1(st.sleepGood)} س`, ""));
  if (st.sleepBad !== null) tiles.push(tile("النوم في الأيام السيئة", `${fmt1(st.sleepBad)} س`, ""));
  if (st.energyAvg !== null) tiles.push(tile("متوسط الطاقة", `${fmt1(st.energyAvg)} / 10`, describeCorr(st.energyCorr) ? `مع المزاج: ${describeCorr(st.energyCorr)}` : ""));
  return `<section class="card"><h2>😴 النوم والطاقة</h2><div class="tiles">${tiles.join("")}</div></section>`;
}

function tile(label: string, value: string, sub: string, cls = ""): string {
  return `<div class="tile"><div class="tile-label">${label}</div><div class="tile-value ${cls}">${value}</div>${sub ? `<div class="tile-sub">${sub}</div>` : ""}</div>`;
}

function deltaTile(st: PeriodStats): string {
  if (st.delta === null) return tile("مقارنة بالفترة السابقة", "—", "ما فيه بيانات قبلها");
  const up = st.delta >= 0.05, down = st.delta <= -0.05;
  const cls = up ? "good" : down ? "bad" : "";
  const icon = up ? "▲" : down ? "▼" : "●";
  const word = up ? "تحسّن" : down ? "تراجع" : "ثابت";
  const pct = st.changePct !== null ? ` (${signed(st.changePct, 0, "%")})` : "";
  return tile("مقارنة بالفترة السابقة", `<span aria-hidden="true">${icon}</span> ${signed(st.delta)}`, `${word}${pct} · قبل: ${fmt1(st.prevAvg!)}`, cls);
}

function list(items: string[], empty = "—"): string {
  return items.length ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : `<p class="muted">${empty}</p>`;
}

function badges(unlocked: string[]): string {
  const set = new Set(unlocked);
  return `<div class="badges">${ACHIEVEMENTS.map((a) => `<div class="badge${set.has(a.code) ? "" : " locked"}" ${tip(set.has(a.code) ? "مفتوح ✓" : "لسا 🔒", a.description)}>
<span class="badge-emoji">${a.emoji}</span><span class="badge-title">${esc(a.title)}</span></div>`).join("")}</div>`;
}

function table(st: PeriodStats): string {
  const rows = [...st.entries].reverse().map((e) => `<tr>
<td class="nw">${esc(e.day)}</td>
<td class="nw">${emo(mood(e.mood).key, "", "mini")} ${mood(e.mood).label}</td>
<td class="num">${e.energy ?? "—"}</td><td class="num">${e.sleep ?? "—"}</td>
<td>${e.tags.map((t) => tagById(t)).filter(Boolean).map((t) => `<span class="chip">${t!.emoji} ${esc(t!.label)}</span>`).join(" ") || "—"}</td>
<td>${esc(e.highlight) || "—"}</td><td>${esc(e.problems) || "—"}</td><td>${esc(e.gratitude) || "—"}</td></tr>`).join("");
  return `<div class="tbl"><table><thead><tr><th>اليوم</th><th>المزاج</th><th>الطاقة</th><th>النوم</th><th>الأنشطة</th><th>أبرز شي</th><th>المشاكل</th><th>ممتن لـ</th></tr></thead><tbody>${rows || `<tr><td colspan="8" class="muted">ما فيه تسجيلات</td></tr>`}</tbody></table></div>`;
}

// ─────────── الصفحة ───────────

const CSS = `
:root{color-scheme:light;--page:#f9f9f7;--card:#fcfcfb;--ink:#0b0b0b;--ink2:#52514e;--muted:#898781;--grid:#e1e0d9;--axis:#c3c2b7;--border:rgba(11,11,11,.10);
--series:#6250d6;--good:#006300;--bad:#d03b3b;--pos:#2a78d6;--neg:#e34948;
--m1:#c53a3a;--m2:#ec8f86;--m3:#a9a8a0;--m4:#6da7ec;--m5:#1c5cab;--head1:#6c5ce7;--head2:#8f84f0}
@media (prefers-color-scheme:dark){:root:where(:not([data-theme="light"])){color-scheme:dark;--page:#0d0d0d;--card:#1a1a19;--ink:#f0efec;--ink2:#c3c2b7;--grid:#2c2c2a;--axis:#383835;--border:rgba(255,255,255,.10);
--series:#9085e9;--good:#0ca30c;--bad:#e66767;--pos:#3987e5;--neg:#e66767;--m1:#e66767;--m2:#9e2a2a;--m3:#6b6a65;--m4:#3987e5;--m5:#86b6ef;--head1:#4b3fb8;--head2:#6c5ce7}}
:root[data-theme="dark"]{color-scheme:dark;--page:#0d0d0d;--card:#1a1a19;--ink:#f0efec;--ink2:#c3c2b7;--grid:#2c2c2a;--axis:#383835;--border:rgba(255,255,255,.10);
--series:#9085e9;--good:#0ca30c;--bad:#e66767;--pos:#3987e5;--neg:#e66767;--m1:#e66767;--m2:#9e2a2a;--m3:#6b6a65;--m4:#3987e5;--m5:#86b6ef;--head1:#4b3fb8;--head2:#6c5ce7}
*{box-sizing:border-box}html,body{margin:0}
body{background:var(--page);color:var(--ink);font-family:system-ui,-apple-system,"Segoe UI",Tahoma,"Noto Sans Arabic",sans-serif;line-height:1.65}
.wrap{max-width:960px;margin:auto;padding:24px 16px 48px}
header{display:flex;align-items:center;gap:20px;background:linear-gradient(135deg,var(--head1),var(--head2));color:#fff;border-radius:22px;padding:24px 26px;flex-wrap:wrap}
.emo{display:inline-block;width:24px;height:24px;background-size:contain;background-repeat:no-repeat;flex:none;vertical-align:middle}
.emo.big{width:76px;height:76px}.emo.mini{width:18px;height:18px;vertical-align:-4px}
.hero{font-size:52px;font-weight:700;line-height:1}.hero small{font-size:20px;opacity:.85;font-weight:500}
header h1{margin:0 0 2px;font-size:1.45rem}header p{margin:0;opacity:.9}
.head-main{flex:1;min-width:200px}
.theme{background:rgba(255,255,255,.18);border:0;color:#fff;border-radius:99px;padding:6px 12px;font:inherit;cursor:pointer}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.kpis{margin:16px 0}
.tile{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:14px 16px}
.tile-label{color:var(--ink2);font-size:.88rem}.tile-value{font-size:1.65rem;font-weight:600}.tile-sub{color:var(--muted);font-size:.85rem}
.tile-value.good{color:var(--good)}.tile-value.bad{color:var(--bad)}
section.card,.card{background:var(--card);border:1px solid var(--border);border-radius:18px;padding:18px 18px 16px;margin-top:14px}
h2{font-size:1.08rem;margin:0 0 12px}.muted{color:var(--muted)}
.summary{font-size:1.04rem;margin:0}.ai-note{color:var(--muted);font-size:.8rem;margin-top:8px}
.two{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}.two>.card{margin-top:14px}
ul{margin:0;padding-inline-start:20px}li{margin:4px 0}
.chart-wrap{width:100%;overflow-x:auto}.chart{width:100%;min-width:560px;height:auto;display:block}bdi{white-space:nowrap}
.grid{stroke:var(--grid);stroke-width:1}.axis{stroke:var(--axis);stroke-width:1}
.series-line{fill:none;stroke:var(--series);stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
.dot{stroke:var(--card);stroke-width:2}.xhair{stroke:var(--muted);stroke-width:1}
.tick{fill:var(--muted);font-size:11px;text-anchor:middle;font-variant-numeric:tabular-nums}.end-label{fill:var(--ink2);font-size:12px;font-weight:600}
.m1{fill:var(--m1);background:var(--m1)}.m2{fill:var(--m2);background:var(--m2)}.m3{fill:var(--m3);background:var(--m3)}.m4{fill:var(--m4);background:var(--m4)}.m5{fill:var(--m5);background:var(--m5)}
.empty{fill:var(--grid);background:var(--grid)}.pos{background:var(--pos)}.neg{background:var(--neg)}
.cal{display:flex;gap:8px;align-items:flex-start}.cal-days{position:relative;width:56px;flex:none;color:var(--muted);font-size:11px}.cal-days span{position:absolute;inset-inline-start:0}
.cal-grid{overflow-x:auto;padding-bottom:4px}.cell{outline:none}.cell:hover,.cell:focus{stroke:var(--ink);stroke-width:1.5}
.legend{display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:12px;color:var(--ink2);font-size:.85rem}
.key{display:inline-flex;align-items:center;gap:6px}.sw{width:12px;height:12px;border-radius:3px;display:inline-block}.sw.dotkey{border-radius:50%;background:linear-gradient(90deg,var(--m1),var(--m3),var(--m5))}
.linekey{width:16px;height:2px;background:var(--series);display:inline-block;border-radius:2px}
.hbar{display:flex;align-items:center;gap:10px;margin:6px 0;border-radius:8px;outline:none}.hbar:hover,.hbar:focus{background:var(--page)}
.hbar-label{width:68px;color:var(--ink2);font-size:.92rem}
.hbar-track{flex:1;display:flex;align-items:center;gap:8px;height:24px}
.hbar-fill{height:14px;border-start-end-radius:4px;border-end-end-radius:4px;min-width:2px}.hbar-val{font-size:.85rem;color:var(--ink2);font-variant-numeric:tabular-nums}
.cols{display:flex;gap:8px;justify-content:space-between}.col{flex:1;display:flex;flex-direction:column;align-items:center;outline:none;border-radius:8px;padding-top:4px}
.col:hover,.col:focus{background:var(--page)}.col-plot{height:150px;width:100%;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;border-bottom:1px solid var(--axis)}
.col-bar{width:min(24px,70%);background:var(--series);border-radius:4px 4px 0 0;opacity:.75}.col-bar.best{opacity:1}
.col-val{font-size:.8rem;color:var(--ink2);margin-bottom:4px;font-variant-numeric:tabular-nums}.col-label{font-size:.78rem;color:var(--muted);margin-top:6px}
.div-chart{display:flex;flex-direction:column;gap:6px}.div-row{display:grid;grid-template-columns:1fr 1fr 120px;align-items:center;gap:0;border-radius:8px;outline:none;min-height:26px}
.div-row:hover,.div-row:focus{background:var(--page)}
.div-half{display:flex;align-items:center;gap:6px;height:100%}.neg-side{flex-direction:row-reverse;border-right:1px solid var(--axis);padding-right:0}.pos-side{padding-left:0}
.div-bar{height:14px;min-width:2px}.div-bar.pos{border-radius:0 4px 4px 0}.div-bar.neg{border-radius:4px 0 0 4px}
.div-val{font-size:.8rem;color:var(--ink2);font-variant-numeric:tabular-nums}.div-label{padding-inline-start:10px;font-size:.92rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.badges{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:10px}
.badge{display:flex;flex-direction:column;align-items:center;gap:4px;padding:12px 6px;border:1px solid var(--border);border-radius:14px;text-align:center;outline:none}
.badge:hover,.badge:focus{background:var(--page)}.badge-emoji{font-size:28px}.badge-title{font-size:.82rem}.badge.locked{opacity:.38;filter:grayscale(1)}
.tbl{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:.9rem}
th,td{text-align:start;padding:9px 8px;border-bottom:1px solid var(--grid);vertical-align:top}th{color:var(--ink2);font-weight:500;white-space:nowrap}
.num{font-variant-numeric:tabular-nums;text-align:center}.nw{white-space:nowrap}
.chip{display:inline-block;background:var(--page);border:1px solid var(--border);border-radius:99px;padding:0 8px;font-size:.8rem;margin:1px 0;white-space:nowrap}
#tip{position:fixed;pointer-events:none;background:var(--card);color:var(--ink);border:1px solid var(--border);box-shadow:0 6px 24px rgba(0,0,0,.14);border-radius:10px;padding:7px 11px;font-size:.85rem;z-index:9;opacity:0;transition:opacity .08s;max-width:240px}
#tip strong{display:block;font-size:.95rem}#tip span{color:var(--ink2)}
footer{text-align:center;color:var(--muted);font-size:.82rem;margin-top:26px}
@media (max-width:560px){header{padding:18px}.hero{font-size:44px}.div-row{grid-template-columns:1fr 1fr 92px}.cols{gap:2px}.col-label{font-size:.7rem}}
@media print{body{background:#fff}.theme,#tip{display:none}.card,.tile{break-inside:avoid}}
@media (forced-colors:active){.hbar-fill,.col-bar,.div-bar,.sw{forced-color-adjust:none;border:1px solid CanvasText}}
`;

const JS = `
(function(){
var tipEl=document.getElementById('tip');
function show(lines,x,y){tipEl.textContent='';var s=document.createElement('strong');s.textContent=lines[0]||'';tipEl.appendChild(s);
for(var i=1;i<lines.length;i++){var sp=document.createElement('span');sp.textContent=lines[i];tipEl.appendChild(sp);}
var r=tipEl.getBoundingClientRect();var px=Math.min(Math.max(8,x+14),innerWidth-r.width-8);var py=y-r.height-12;if(py<8)py=y+18;
tipEl.style.left=px+'px';tipEl.style.top=py+'px';tipEl.style.opacity=1;}
function hide(){tipEl.style.opacity=0;}
document.querySelectorAll('[data-tip]').forEach(function(el){
var lines=el.getAttribute('data-tip').split('|');
el.addEventListener('pointermove',function(e){show(lines,e.clientX,e.clientY);});
el.addEventListener('pointerleave',hide);
el.addEventListener('focus',function(){var b=el.getBoundingClientRect();show(lines,b.left+b.width/2,b.top);});
el.addEventListener('blur',hide);});
var svg=document.getElementById('line'),hit=document.getElementById('line-hit'),xh=document.getElementById('xhair'),dataEl=document.getElementById('line-data');
if(svg&&hit&&dataEl){var pts=JSON.parse(dataEl.textContent);
hit.addEventListener('pointermove',function(e){var pt=svg.createSVGPoint();pt.x=e.clientX;pt.y=e.clientY;var p=pt.matrixTransform(svg.getScreenCTM().inverse());
var best=pts[0],bd=1e9;pts.forEach(function(q){var d=Math.abs(q.x-p.x);if(d<bd){bd=d;best=q;}});
xh.setAttribute('x1',best.x);xh.setAttribute('x2',best.x);xh.setAttribute('visibility','visible');var l=[best.m+' ('+best.v+'/5)',best.d];if(best.a)l.push(best.a);show(l,e.clientX,e.clientY);});
hit.addEventListener('pointerleave',function(){xh.setAttribute('visibility','hidden');hide();});}
document.querySelectorAll('.chart-wrap').forEach(function(w){w.scrollLeft=w.scrollWidth;});
var btn=document.getElementById('theme');if(btn){btn.addEventListener('click',function(){var r=document.documentElement;
var dark=r.getAttribute('data-theme')?r.getAttribute('data-theme')==='dark':matchMedia('(prefers-color-scheme: dark)').matches;
r.setAttribute('data-theme',dark?'light':'dark');try{localStorage.setItem('mood-theme',r.getAttribute('data-theme'));}catch(e){}});}
try{var t=localStorage.getItem('mood-theme');if(t)document.documentElement.setAttribute('data-theme',t);}catch(e){}
})();`;

export function buildReportHTML(input: ReportInput): string {
  const { stats: st, insight, name } = input;
  const avgMood = st.count ? mood(st.avg) : mood(3);
  const title = input.title ?? `تقرير المزاج — ${name}`;
  const trend = st.trend === null ? "—" : `${signed(st.trend, 2)}`;

  return `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${CSS}${emojiCSS()}</style></head>
<body><div class="wrap">
<header>
<img class="emo big" src="${emojiDataUri(avgMood.key, true)}" alt="${avgMood.label}">
<div class="head-main"><h1>${esc(title)}</h1><p>من <bdi>${st.start}</bdi> إلى <bdi>${st.end}</bdi> · ${st.days} يوم</p></div>
<div><div class="hero">${st.count ? fmt1(st.avg) : "—"}<small> / 5</small></div><div>متوسط المزاج · ${avgMood.label}</div></div>
<button class="theme" id="theme" type="button" aria-label="تبديل الوضع الليلي">🌓</button>
</header>

<div class="tiles kpis">
${deltaTile(st)}
${tile("أيام حلوة", `${st.goodPct}%`, `سيئة: ${st.badPct}%`)}
${tile("سلسلة التسجيل 🔥", `${st.streak}`, `أفضل سلسلة: ${st.bestStreak}`)}
${tile("الاتجاه الأسبوعي", trend, "نقطة مزاج لكل أسبوع")}
${tile("أيام مسجّلة", `${st.count}`, `من ${st.days} (${Math.round(st.coverage * 100)}%)`)}
</div>

<section class="card"><h2>📝 الملخص</h2><p class="summary">${esc(insight.summary)}</p>
${insight.source === "ai" ? `<div class="ai-note">✨ التحليل بالذكاء الاصطناعي — مو بديل عن مختص</div>` : ""}</section>

<section class="card"><h2>📈 المزاج يوم بيوم</h2>${lineChart(st)}</section>
${calendar(st)}
<div class="two">
<section class="card"><h2>📊 توزيع المزاج</h2>${distribution(st)}</section>
<section class="card"><h2>📅 المزاج حسب أيام الأسبوع</h2>${weekdays(st)}</section>
</div>
<section class="card"><h2>🏷️ وش يأثر على مزاجك؟</h2>${tagImpact(st)}</section>
${sleepEnergy(st)}
<div class="two">
<section class="card"><h2>🌟 اللي يحسّن مزاجك</h2>${list(insight.good_things)}</section>
<section class="card"><h2>⚡ اللي يضايقك</h2>${list(insight.bad_things)}</section>
</div>
<section class="card"><h2>💡 نصائح لك</h2>${list(insight.tips)}</section>
<section class="card"><h2>🏆 الإنجازات (${input.unlocked.length}/${ACHIEVEMENTS.length})</h2>${badges(input.unlocked)}</section>
<section class="card"><h2>📋 السجل اليومي</h2>${table(st)}</section>
<footer>Mood Bot 🌈 · ${esc(input.generatedAt)}</footer>
</div><div id="tip" role="tooltip"></div>
<script>${JS}</script></body></html>`;
}
