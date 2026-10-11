/**
 * الذكاء الاصطناعي (Claude) — اختياري.
 *
 * نكلم Claude API بطلب HTTP مباشر عبر fetch المدمج بدل مكتبة @anthropic-ai/sdk،
 * لأن المكتبة حجمها ~23 ميقا والبوت كله لازم يبقى تحت 20 ميقا.
 * - إعادة محاولة تلقائية مع 429/5xx/529 وأخطاء الشبكة (تحترم retry-after)
 * - fallbacks: "default" لو الموديل رفض الطلب يكمّله موديل ثاني تلقائياً
 * - لو ما فيه مفتاح أو صار خطأ: ردود وتحليل محلي بدون AI
 */
import type { ChatTurn, Entry } from "./db.ts";
import { mood, tagById } from "./moods.ts";
import { commonThemes, describeCorr, type PeriodStats } from "./stats.ts";
import { WEEKDAYS_AR } from "./time.ts";
import { silentLogger, type Logger } from "./log.ts";

const API_URL = "https://api.anthropic.com/v1/messages";
/** الموديلات اللي تقبل fallbacks: "default" */
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

const SYSTEM = `أنت "مود"، رفيق لطيف داخل بوت ديسكورد يسأل شخصاً كل يوم عن يومه ويتابع مزاجه.
- تكلّم بلهجة سعودية بيضاء، ودود، مختصر، بدون وعظ وبدون مبالغة.
- لست طبيباً: لا تشخّص ولا تعطي أدوية.
- اربط كلامك ببيانات الشخص الفعلية (مزاجه، نومه، أنشطته، اللي كتبه) بدل النصائح العامة.
- إذا ظهر أي شيء عن إيذاء النفس أو خطر، كن هادئاً وداعماً وشجّعه يكلم شخص يثق فيه أو يتصل بالطوارئ 911 أو مركز وزارة الصحة 937.`;

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface AIOptions {
  apiKey: string;
  model: string;
  fetch?: FetchLike;
  logger?: Logger;
  url?: string;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface ReportInsight {
  summary: string;
  good_things: string[];
  bad_things: string[];
  tips: string[];
}

const INSIGHT_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    good_things: { type: "array", items: { type: "string" } },
    bad_things: { type: "array", items: { type: "string" } },
    tips: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "good_things", "bad_things", "tips"],
  additionalProperties: false,
} as const;

export class AIError extends Error {
  readonly status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = "AIError";
    this.status = status;
  }
}

export function formatEntry(e: Entry): string {
  const parts = [`${e.day}: ${mood(e.mood).label} (${e.mood}/5)`];
  if (e.energy !== null) parts.push(`طاقة ${e.energy}/10`);
  if (e.sleep !== null) parts.push(`نوم ${e.sleep}س`);
  if (e.tags.length) parts.push(`أنشطة: ${e.tags.map((t) => tagById(t)?.label ?? t).join("، ")}`);
  if (e.highlight) parts.push(`أبرز شي: ${e.highlight}`);
  if (e.problems) parts.push(`مشاكل: ${e.problems}`);
  if (e.gratitude) parts.push(`ممتن لـ: ${e.gratitude}`);
  return `- ${parts.join(" | ")}`;
}

const FALLBACK_REPLY: Record<number, string[]> = {
  5: ["يا سلام! يوم حلو يستاهل ينحفظ 🌟 كمّل على نفس الطاقة.", "ما شاء الله! هذا اليوم اللي نبيه يتكرر ✨"],
  4: ["حلو إن يومك كان كويس 😊 الأشياء الصغيرة الحلوة تفرق.", "يوم كويس = مكسب 👌 وش اللي تقدر تعيده بكرة؟"],
  3: ["يوم عادي وهذا طبيعي جداً 🙂 بكرة فرصة جديدة.", "مو كل يوم لازم يكون مميز، الهدوء نعمة بعد 🍃"],
  2: ["الله يعينك، الأيام الصعبة تعدّي 💛 خذ لك راحة الليلة.", "يوم ثقيل… جرّب تسوي شي صغير يريحك قبل النوم 🫖"],
  1: ["آسف إن يومك كان ثقيل 🫂 لا تشيل الحمل لحالك، كلّم أحد تثق فيه.", "أنا معك 💛 خذ نفس عميق، وبكرة بإذن الله أخف."],
};

export class AI {
  readonly enabled: boolean;
  readonly model: string;
  private readonly key: string;
  private readonly fetchImpl: FetchLike;
  private readonly log: Logger;
  private readonly url: string;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: AIOptions) {
    this.key = opts.apiKey;
    this.model = opts.model;
    this.enabled = Boolean(opts.apiKey);
    this.fetchImpl = opts.fetch ?? ((i, init) => fetch(i, init));
    this.log = opts.logger ?? silentLogger;
    this.url = opts.url ?? API_URL;
    this.maxRetries = opts.maxRetries ?? 3;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** طلب واحد للـ Messages API مع إعادة المحاولة. */
  async call(params: {
    messages: ChatTurn[];
    maxTokens: number;
    effort: "low" | "medium" | "high";
    schema?: object;
    system?: string;
  }): Promise<string> {
    if (!this.enabled) throw new AIError("AI disabled");
    const outputConfig: Record<string, unknown> = { effort: params.effort };
    if (params.schema) outputConfig.format = { type: "json_schema", schema: params.schema };
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: params.maxTokens,
      system: params.system ?? SYSTEM,
      messages: params.messages,
      output_config: outputConfig,
    };
    const headers: Record<string, string> = {
      "x-api-key": this.key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    };
    if (FALLBACK_MODELS.has(this.model)) {
      body.fallbacks = "default";
      headers["anthropic-beta"] = "server-side-fallback-2026-07-01";
    }

    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(this.url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(120_000),
        });
      } catch (err) {
        if (attempt >= this.maxRetries) throw new AIError(`network: ${(err as Error).message}`);
        await this.sleep(1000 * 2 ** attempt);
        continue;
      }

      const retryable = res.status === 429 || res.status === 529 || res.status >= 500;
      if (retryable && attempt < this.maxRetries) {
        const ra = Number(res.headers.get("retry-after"));
        const wait = Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 30_000) : 1000 * 2 ** attempt;
        this.log.warn(`Claude ${res.status}, retry in ${wait}ms`);
        await res.body?.cancel().catch(() => undefined);
        await this.sleep(wait);
        continue;
      }

      const data = (await res.json().catch(() => ({}))) as {
        error?: { type?: string; message?: string };
        stop_reason?: string;
        content?: { type: string; text?: string }[];
      };
      if (!res.ok) throw new AIError(`Claude ${res.status}: ${data.error?.message ?? "unknown"}`, res.status);
      if (data.stop_reason === "refusal") throw new AIError("refused");
      const text = (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();
      if (!text) throw new AIError(`empty response (stop_reason=${data.stop_reason})`);
      return text;
    }
  }

  // ─────────── رد على تسجيل اليوم ───────────

  async replyToEntry(entry: Entry, recent: Entry[], extra: { streak: number; newBadges: string[] }): Promise<string> {
    const pick = FALLBACK_REPLY[entry.mood] ?? FALLBACK_REPLY[3]!;
    const fallback = pick[entry.day.charCodeAt(9) % pick.length]!;
    if (!this.enabled) return fallback;
    const prompt =
      `تسجيل اليوم:\n${formatEntry(entry)}\n\n` +
      `آخر الأيام (من الأقدم):\n${recent.slice(-10).map(formatEntry).join("\n") || "لا يوجد"}\n\n` +
      `سلسلة التسجيل: ${extra.streak} يوم.` +
      (extra.newBadges.length ? ` فتح إنجاز جديد: ${extra.newBadges.join("، ")}.` : "") +
      `\n\nاكتب رد من 2 إلى 4 جمل قصيرة:\n` +
      `1) تفاعل مع اللي كتبه بالضبط (مو كلام عام).\n` +
      `2) لو يومه سيء: اقترح شي صغير عملي يسويه الليلة. لو حلو: ساعده يلاحظ وش اللي سوّى الفرق.\n` +
      `3) لو فيه نمط واضح من الأيام اللي قبل (نوم، نشاط، يوم معين) اذكره بلطف.\n` +
      `بدون عناوين أو تنسيق، وإيموجي واحد أو اثنين بس.`;
    try {
      return await this.call({ messages: [{ role: "user", content: prompt }], maxTokens: 2000, effort: "low" });
    } catch (e) {
      this.log.warn("replyToEntry failed:", (e as Error).message);
      return fallback;
    }
  }

  // ─────────── تحليل التقرير ───────────

  async analyze(st: PeriodStats): Promise<ReportInsight & { source: "ai" | "local" }> {
    if (!st.count) {
      return { summary: "ما فيه تسجيلات في هالفترة للحين.", good_things: [], bad_things: [], tips: ["سجّل يومك كل يوم عشان يطلع لك تحليل دقيق 💪"], source: "local" };
    }
    if (this.enabled) {
      const facts = [
        `الفترة: ${st.start} إلى ${st.end} (${st.days} يوم، مسجّل ${st.count})`,
        `المتوسط: ${st.avg.toFixed(2)}/5` + (st.prevAvg !== null ? ` | الفترة السابقة: ${st.prevAvg.toFixed(2)}/5` : ""),
        `أيام حلوة: ${st.goodPct}% | أيام سيئة: ${st.badPct}%`,
        st.trend !== null ? `الاتجاه: ${st.trend >= 0 ? "+" : ""}${st.trend.toFixed(2)} نقطة/أسبوع` : "",
        st.bestWeekday !== null ? `أفضل يوم بالأسبوع: ${WEEKDAYS_AR[st.bestWeekday]} | أسوأ: ${WEEKDAYS_AR[st.worstWeekday!]}` : "",
        st.sleepAvg !== null ? `متوسط النوم ${st.sleepAvg.toFixed(1)}س` + (st.sleepGood !== null ? ` | بالأيام الحلوة ${st.sleepGood.toFixed(1)}س` : "") + (st.sleepBad !== null ? ` | بالأيام السيئة ${st.sleepBad.toFixed(1)}س` : "") : "",
        st.tags.length ? `أثر الأنشطة على المزاج: ${st.tags.map((t) => `${t.label} ${t.delta >= 0 ? "+" : ""}${t.delta.toFixed(1)} (${t.count} مرات)`).join("، ")}` : "",
      ].filter(Boolean).join("\n");
      const prompt =
        `بيانات مزاج يومية لشخص (المقياس 1 إلى 5):\n${st.entries.map(formatEntry).join("\n")}\n\n` +
        `إحصائيات محسوبة:\n${facts}\n\n` +
        `اكتب تحليل لتقرير احترافي، كل شي مبني على بياناته هو:\n` +
        `- summary: فقرة 3-4 جمل: كيف كانت الفترة واتجاه المزاج (تحسن/تراجع بالأرقام) وأوضح نمط.\n` +
        `- good_things: 3-5 نقاط قصيرة: أكثر الأشياء اللي تحسّن مزاجه.\n` +
        `- bad_things: 3-5 نقاط قصيرة: أكثر الأشياء اللي تخرّب يومه.\n` +
        `- tips: 3 نصائح عملية ومحددة للأسبوع الجاي مبنية على الأنماط (مو نصائح عامة).`;
      try {
        const raw = await this.call({ messages: [{ role: "user", content: prompt }], maxTokens: 8000, effort: "medium", schema: INSIGHT_SCHEMA });
        const j = JSON.parse(raw) as ReportInsight;
        return { ...j, source: "ai" };
      } catch (e) {
        this.log.warn("analyze failed, using local insights:", (e as Error).message);
      }
    }
    return { ...localInsight(st), source: "local" };
  }

  // ─────────── دردشة ───────────

  async chat(history: ChatTurn[], message: string, recent: Entry[], name: string): Promise<string> {
    if (!this.enabled) throw new AIError("AI disabled");
    const context =
      `اسم الشخص: ${name}\nآخر تسجيلات مزاجه:\n${recent.slice(-14).map(formatEntry).join("\n") || "لا يوجد بعد"}\n\n` +
      `هذي دردشة حرة في الخاص. رد باختصار (1-5 جمل) وبشكل طبيعي كصديق. ` +
      `استخدم بيانات مزاجه لو لها علاقة بس لا تكررها كل مرة. لو طلب شي خارج موضوع المزاج ساعده باختصار.`;
    const turns = normalizeTurns([...history, { role: "user", content: message }]);
    return this.call({ messages: turns, maxTokens: 2000, effort: "low", system: `${SYSTEM}\n\n${context}` });
  }
}

/** الـ API يبي الرسائل تبدأ بـ user وتتناوب. ندمج المتتالية من نفس الدور. */
export function normalizeTurns(turns: ChatTurn[]): ChatTurn[] {
  const out: ChatTurn[] = [];
  for (const t of turns) {
    if (!t.content.trim()) continue;
    const last = out[out.length - 1];
    if (last && last.role === t.role) last.content += `\n${t.content}`;
    else out.push({ ...t });
  }
  while (out.length && out[0]!.role !== "user") out.shift();
  return out;
}

/** تحليل محلي بدون AI: أرقام + أكثر الأشياء تكراراً. */
export function localInsight(st: PeriodStats): ReportInsight {
  const parts = [`سجّلت ${st.count} يوم من ${st.days}، ومتوسط مزاجك ${st.avg.toFixed(1)} من 5.`];
  if (st.delta !== null) {
    parts.push(st.delta > 0.1 ? `مزاجك أحسن من الفترة اللي قبل بـ ${st.delta.toFixed(1)} نقطة 📈` : st.delta < -0.1 ? `مزاجك أقل من الفترة اللي قبل بـ ${Math.abs(st.delta).toFixed(1)} نقطة 📉` : "مزاجك ثابت تقريباً مقارنة بالفترة اللي قبل.");
  }
  if (st.bestWeekday !== null) parts.push(`أحلى أيامك عادة يوم ${WEEKDAYS_AR[st.bestWeekday]}.`);

  const good = [
    ...st.tags.filter((t) => t.delta >= 0.3).slice(0, 3).map((t) => `${t.emoji} ${t.label} (+${t.delta.toFixed(1)})`),
    ...commonThemes(st.entries.filter((e) => e.mood >= 4).map((e) => e.highlight)),
  ].slice(0, 5);
  const bad = [
    ...st.tags.filter((t) => t.delta <= -0.3).reverse().slice(0, 3).map((t) => `${t.emoji} ${t.label} (${t.delta.toFixed(1)})`),
    ...commonThemes(st.entries.map((e) => e.problems)),
  ].slice(0, 5);

  const tips: string[] = [];
  const topGood = st.tags.find((t) => t.delta >= 0.3);
  if (topGood) tips.push(`${topGood.emoji} "${topGood.label}" يرفع مزاجك بوضوح — حاول تحطه في جدولك مرتين هالأسبوع.`);
  if (st.sleepGood !== null && st.sleepBad !== null && st.sleepGood - st.sleepBad >= 0.75)
    tips.push(`😴 في أيامك الحلوة تنام ${st.sleepGood.toFixed(1)} ساعة مقابل ${st.sleepBad.toFixed(1)} بالأيام السيئة — النوم بدري ممكن يفرق معك.`);
  const corr = describeCorr(st.energyCorr);
  if (corr && st.energyCorr! > 0) tips.push(`⚡ طاقتك ومزاجك بينهم ${corr} — الأشياء اللي ترفع طاقتك (حركة، أكل، شمس) تستاهل.`);
  if (st.worstWeekday !== null) tips.push(`🗓️ يوم ${WEEKDAYS_AR[st.worstWeekday]} عادة أصعب — خطط له شي صغير تحبه.`);
  if (!tips.length) tips.push("استمر بالتسجيل اليومي وحدد أنشطة يومك 🏷️ عشان تطلع لك أنماط أدق.");

  return { summary: parts.join(" "), good_things: good, bad_things: bad, tips: tips.slice(0, 3) };
}
