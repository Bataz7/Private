/**
 * الذكاء الاصطناعي — اختياري، ويدعم:
 *  - OpenRouter (أي موديل: openai/gpt-4o، anthropic/…، google/…) — الافتراضي لو فيه OPENROUTER_API_KEY
 *  - OpenAI أو أي API متوافق مع OpenAI (AI_BASE_URL)
 *  - Anthropic Claude
 * كله بـ fetch المدمج (بدون مكتبات) مع إعادة محاولة، ولو صار خطأ نرجع لردود وتحليل محلي.
 */
import type { AIProvider } from "./config.ts";
import { L, type Lang } from "./i18n.ts";
import { silentLogger, type Logger } from "./log.ts";
import { mood, tagById } from "./moods.ts";
import { questionById, questionText } from "./questions.ts";
import { commonThemes, describeCorr, type PeriodStats } from "./stats.ts";
import type { ChatTurn, Entry } from "./store/types.ts";
import { WEEKDAYS } from "./time.ts";

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface AIOptions {
  provider: AIProvider;
  apiKey: string;
  model: string;
  baseUrl?: string;
  appUrl?: string;
  appName?: string;
  fetch?: FetchLike;
  logger?: Logger;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface ReportInsight {
  summary: string;
  good_things: string[];
  bad_things: string[];
  tips: string[];
}

export interface CompletionRequest {
  system: string;
  messages: ChatTurn[];
  maxTokens: number;
  effort: "low" | "medium" | "high";
  schema?: { name: string; schema: object };
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

/** موديلات Claude اللي تقبل fallbacks: "default" */
const CLAUDE_FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

export class AIError extends Error {
  readonly status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = "AIError";
    this.status = status;
  }
}

function system(lang: Lang): string {
  if (lang === "en") {
    return `You are "Mood", a warm companion inside a Discord bot that checks in on someone's day and tracks their mood.
- Write in friendly, natural, concise English. No lecturing, no exaggeration.
- You are not a doctor: never diagnose or suggest medication.
- Ground what you say in the person's actual data (mood, sleep, activities, what they wrote) rather than generic advice.
- If anything suggests self-harm or danger, be calm and supportive and encourage them to reach someone they trust or local emergency services / a helpline.`;
  }
  return `أنت "مود"، رفيق لطيف داخل بوت ديسكورد يسأل شخصاً كل يوم عن يومه ويتابع مزاجه.
- تكلّم بلهجة سعودية بيضاء، ودود، مختصر، بدون وعظ وبدون مبالغة.
- لست طبيباً: لا تشخّص ولا تعطي أدوية.
- اربط كلامك ببيانات الشخص الفعلية (مزاجه، نومه، أنشطته، اللي كتبه) بدل النصائح العامة.
- إذا ظهر أي شيء عن إيذاء النفس أو خطر، كن هادئاً وداعماً وشجّعه يكلم شخص يثق فيه أو يتصل بالطوارئ 911 أو مركز وزارة الصحة 937.`;
}

export function formatEntry(e: Entry, lang: Lang = "ar"): string {
  const en = lang === "en";
  const parts = [`${e.day}: ${mood(e.mood).label[lang]} (${e.mood}/5)`];
  if (e.energy !== null) parts.push(en ? `energy ${e.energy}/10` : `طاقة ${e.energy}/10`);
  if (e.sleep !== null) parts.push(en ? `slept ${e.sleep}h` : `نوم ${e.sleep}س`);
  if (e.tags.length) parts.push(`${en ? "activities" : "أنشطة"}: ${e.tags.map((t) => tagById(t)?.label[lang] ?? t).join(", ")}`);
  if (e.highlight) parts.push(`${en ? "highlight" : "أبرز شي"}: ${e.highlight}`);
  if (e.problems) parts.push(`${en ? "problems" : "مشاكل"}: ${e.problems}`);
  if (e.gratitude) parts.push(`${en ? "grateful for" : "ممتن لـ"}: ${e.gratitude}`);
  const q = e.question ? questionById(e.question) : undefined;
  if (q && e.answer) parts.push(`${en ? "Q" : "سؤال"} "${questionText(q, lang)}": ${e.answer}`);
  return `- ${parts.join(" | ")}`;
}

const FALLBACK_REPLY: Record<Lang, Record<number, string[]>> = {
  ar: {
    5: ["يا سلام! يوم حلو يستاهل ينحفظ 🌟 كمّل على نفس الطاقة.", "ما شاء الله! هذا اليوم اللي نبيه يتكرر ✨"],
    4: ["حلو إن يومك كان كويس 😊 الأشياء الصغيرة الحلوة تفرق.", "يوم كويس = مكسب 👌 وش اللي تقدر تعيده بكرة؟"],
    3: ["يوم عادي وهذا طبيعي جداً 🙂 بكرة فرصة جديدة.", "مو كل يوم لازم يكون مميز، الهدوء نعمة بعد 🍃"],
    2: ["الله يعينك، الأيام الصعبة تعدّي 💛 خذ لك راحة الليلة.", "يوم ثقيل… جرّب تسوي شي صغير يريحك قبل النوم 🫖"],
    1: ["آسف إن يومك كان ثقيل 🫂 لا تشيل الحمل لحالك، كلّم أحد تثق فيه.", "أنا معك 💛 خذ نفس عميق، وبكرة بإذن الله أخف."],
  },
  en: {
    5: ["Love that! A great day worth remembering 🌟 keep that energy.", "Amazing! That's the kind of day we want more of ✨"],
    4: ["Glad your day was good 😊 the small good things add up.", "A good day is a win 👌 what could you repeat tomorrow?"],
    3: ["An okay day is totally normal 🙂 tomorrow is a fresh start.", "Not every day has to be special — calm is good too 🍃"],
    2: ["Sorry it was rough 💛 hard days pass. Be gentle with yourself tonight.", "A heavy day… try one small thing that relaxes you before bed 🫖"],
    1: ["I'm sorry today was so hard 🫂 you don't have to carry it alone — talk to someone you trust.", "I'm here with you 💛 take a deep breath. Tomorrow can be lighter."],
  },
};

export class AI {
  readonly enabled: boolean;
  readonly provider: AIProvider;
  readonly model: string;
  private readonly key: string;
  private readonly baseUrl: string;
  private readonly appUrl: string;
  private readonly appName: string;
  private readonly fetchImpl: FetchLike;
  private readonly log: Logger;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(o: AIOptions) {
    this.provider = o.apiKey ? o.provider : "none";
    this.enabled = this.provider !== "none";
    this.key = o.apiKey;
    this.model = o.model;
    this.baseUrl = (o.baseUrl ?? (o.provider === "anthropic" ? "https://api.anthropic.com/v1" : o.provider === "openai" ? "https://api.openai.com/v1" : "https://openrouter.ai/api/v1")).replace(/\/+$/, "");
    this.appUrl = o.appUrl ?? "https://github.com/bataz7/private";
    this.appName = o.appName ?? "Mood Bot";
    this.fetchImpl = o.fetch ?? ((i, init) => fetch(i, init));
    this.log = o.logger ?? silentLogger;
    this.maxRetries = o.maxRetries ?? 3;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  get label(): string {
    return this.enabled ? `${this.provider}/${this.model}` : "off";
  }

  // ─────────── الطلب الخام لكل مزوّد ───────────

  private buildRequest(r: CompletionRequest): { url: string; headers: Record<string, string>; body: Record<string, unknown> } {
    if (this.provider === "anthropic") {
      const outputConfig: Record<string, unknown> = { effort: r.effort };
      if (r.schema) outputConfig.format = { type: "json_schema", schema: r.schema.schema };
      const body: Record<string, unknown> = { model: this.model, max_tokens: r.maxTokens, system: r.system, messages: r.messages, output_config: outputConfig };
      const headers: Record<string, string> = { "x-api-key": this.key, "anthropic-version": "2023-06-01", "content-type": "application/json" };
      if (CLAUDE_FALLBACK_MODELS.has(this.model)) {
        body.fallbacks = "default";
        headers["anthropic-beta"] = "server-side-fallback-2026-07-01";
      }
      return { url: `${this.baseUrl}/messages`, headers, body };
    }
    // OpenRouter / OpenAI: صيغة chat/completions
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: r.maxTokens,
      messages: [{ role: "system", content: r.system }, ...r.messages],
    };
    if (r.schema) body.response_format = { type: "json_schema", json_schema: { name: r.schema.name, strict: true, schema: r.schema.schema } };
    const headers: Record<string, string> = { authorization: `Bearer ${this.key}`, "content-type": "application/json" };
    if (this.provider === "openrouter") {
      headers["HTTP-Referer"] = this.appUrl;
      headers["X-Title"] = this.appName;
    }
    return { url: `${this.baseUrl}/chat/completions`, headers, body };
  }

  private extract(data: Record<string, unknown>): string {
    if (this.provider === "anthropic") {
      if (data.stop_reason === "refusal") throw new AIError("refused");
      const content = (data.content ?? []) as { type: string; text?: string }[];
      return content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();
    }
    const choice = ((data.choices ?? []) as { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[])[0];
    if (choice?.message?.refusal) throw new AIError("refused");
    return (choice?.message?.content ?? "").trim();
  }

  /** طلب واحد مع إعادة المحاولة (429/5xx/529/أخطاء الشبكة) — يحترم retry-after. */
  async complete(r: CompletionRequest): Promise<string> {
    if (!this.enabled) throw new AIError("AI disabled");
    const { url, headers, body } = this.buildRequest(r);
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
      } catch (err) {
        if (attempt >= this.maxRetries) throw new AIError(`network: ${(err as Error).message}`);
        await this.sleep(1000 * 2 ** attempt);
        continue;
      }
      const retryable = res.status === 429 || res.status === 529 || res.status >= 500;
      if (retryable && attempt < this.maxRetries) {
        const ra = Number(res.headers.get("retry-after"));
        const wait = Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 30_000) : 1000 * 2 ** attempt;
        this.log.warn(`${this.provider} ${res.status}, retry in ${wait}ms`);
        await res.body?.cancel().catch(() => undefined);
        await this.sleep(wait);
        continue;
      }
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string; code?: number } };
      // OpenRouter أحياناً يرجع 200 مع error داخل الجسم
      if (!res.ok || data.error) {
        const status = res.ok ? Number(data.error?.code ?? 0) : res.status;
        if ((status === 429 || status >= 500) && attempt < this.maxRetries) {
          await this.sleep(1000 * 2 ** attempt);
          continue;
        }
        throw new AIError(`${this.provider} ${status}: ${data.error?.message ?? "unknown error"}`, status);
      }
      const text = this.extract(data);
      if (!text) throw new AIError("empty response");
      return text;
    }
  }

  // ─────────── رد على تسجيل اليوم ───────────

  async replyToEntry(entry: Entry, recent: Entry[], extra: { streak: number; newBadges: string[]; lang: Lang }): Promise<string> {
    const { lang } = extra;
    const pick = FALLBACK_REPLY[lang][entry.mood] ?? FALLBACK_REPLY[lang][3]!;
    const fallback = pick[entry.day.charCodeAt(9) % pick.length]!;
    if (!this.enabled) return fallback;
    const en = lang === "en";
    const prompt = en
      ? `Today's entry:\n${formatEntry(entry, lang)}\n\nRecent days (oldest first):\n${recent.slice(-10).map((e) => formatEntry(e, lang)).join("\n") || "none"}\n\n` +
        `Logging streak: ${extra.streak} days.` + (extra.newBadges.length ? ` New achievement unlocked: ${extra.newBadges.join(", ")}.` : "") +
        `\n\nWrite a reply of 2 to 4 short sentences:\n1) React to exactly what they wrote (not generic).\n2) If the day was bad: suggest one small practical thing for tonight. If good: help them notice what made the difference.\n3) If there's a clear pattern from previous days (sleep, an activity, a weekday), mention it gently.\nIf they answered today's question, respond to their answer warmly.\nNo headings or formatting, one or two emojis only.`
      : `تسجيل اليوم:\n${formatEntry(entry, lang)}\n\nآخر الأيام (من الأقدم):\n${recent.slice(-10).map((e) => formatEntry(e, lang)).join("\n") || "لا يوجد"}\n\n` +
        `سلسلة التسجيل: ${extra.streak} يوم.` + (extra.newBadges.length ? ` فتح إنجاز جديد: ${extra.newBadges.join("، ")}.` : "") +
        `\n\nاكتب رد من 2 إلى 4 جمل قصيرة:\n1) تفاعل مع اللي كتبه بالضبط (مو كلام عام).\n2) لو يومه سيء: اقترح شي صغير عملي يسويه الليلة. لو حلو: ساعده يلاحظ وش اللي سوّى الفرق.\n3) لو فيه نمط واضح من الأيام اللي قبل (نوم، نشاط، يوم معين) اذكره بلطف.\nلو جاوب على سؤال اليوم، تفاعل مع جوابه بلطف.\nبدون عناوين أو تنسيق، وإيموجي واحد أو اثنين بس.`;
    try {
      return await this.complete({ system: system(lang), messages: [{ role: "user", content: prompt }], maxTokens: 1500, effort: "low" });
    } catch (e) {
      this.log.warn("replyToEntry failed:", (e as Error).message);
      return fallback;
    }
  }

  // ─────────── تحليل التقرير ───────────

  async analyze(st: PeriodStats, lang: Lang = "ar"): Promise<ReportInsight & { source: "ai" | "local" }> {
    const t = L(lang);
    if (!st.count) return { summary: t.noEntriesPeriod, good_things: [], bad_things: [], tips: [t.logDailyTip], source: "local" };
    if (this.enabled) {
      const en = lang === "en";
      const wd = WEEKDAYS[lang];
      const facts = [
        `${st.start} → ${st.end} (${st.days} ${en ? "days" : "يوم"}, ${en ? "logged" : "مسجّل"} ${st.count})`,
        `${en ? "average" : "المتوسط"}: ${st.avg.toFixed(2)}/5` + (st.prevAvg !== null ? ` | ${en ? "previous period" : "الفترة السابقة"}: ${st.prevAvg.toFixed(2)}/5` : ""),
        `${en ? "good days" : "أيام حلوة"}: ${st.goodPct}% | ${en ? "bad days" : "أيام سيئة"}: ${st.badPct}%`,
        st.trend !== null ? `${en ? "trend" : "الاتجاه"}: ${st.trend >= 0 ? "+" : ""}${st.trend.toFixed(2)}/${en ? "week" : "أسبوع"}` : "",
        st.bestWeekday !== null ? `${en ? "best weekday" : "أفضل يوم"}: ${wd[st.bestWeekday]} | ${en ? "worst" : "أسوأ"}: ${wd[st.worstWeekday!]}` : "",
        st.sleepAvg !== null ? `${en ? "avg sleep" : "متوسط النوم"} ${st.sleepAvg.toFixed(1)}h` + (st.sleepGood !== null ? ` | ${en ? "good days" : "الأيام الحلوة"} ${st.sleepGood.toFixed(1)}h` : "") + (st.sleepBad !== null ? ` | ${en ? "bad days" : "الأيام السيئة"} ${st.sleepBad.toFixed(1)}h` : "") : "",
        st.tags.length ? `${en ? "activity impact" : "أثر الأنشطة"}: ${st.tags.map((x) => `${x.label[lang]} ${x.delta >= 0 ? "+" : ""}${x.delta.toFixed(1)} (${x.count})`).join(", ")}` : "",
      ].filter(Boolean).join("\n");
      const prompt = en
        ? `Daily mood entries (scale 1-5):\n${st.entries.map((e) => formatEntry(e, lang)).join("\n")}\n\nComputed stats:\n${facts}\n\n` +
          `Write the analysis for a professional report, based only on this person's data, in English:\n- summary: 3-4 sentences on how the period went, the mood trend (improved/declined with numbers) and the clearest pattern.\n- good_things: 3-5 short points: what lifts their mood most.\n- bad_things: 3-5 short points: what ruins their days most.\n- tips: 3 specific, practical tips for next week based on the patterns (not generic advice).`
        : `بيانات مزاج يومية لشخص (المقياس 1 إلى 5):\n${st.entries.map((e) => formatEntry(e, lang)).join("\n")}\n\nإحصائيات محسوبة:\n${facts}\n\n` +
          `اكتب تحليل لتقرير احترافي بالعربي، كل شي مبني على بياناته هو:\n- summary: فقرة 3-4 جمل: كيف كانت الفترة واتجاه المزاج (تحسن/تراجع بالأرقام) وأوضح نمط.\n- good_things: 3-5 نقاط قصيرة: أكثر الأشياء اللي تحسّن مزاجه.\n- bad_things: 3-5 نقاط قصيرة: أكثر الأشياء اللي تخرّب يومه.\n- tips: 3 نصائح عملية ومحددة للأسبوع الجاي مبنية على الأنماط (مو نصائح عامة).`;
      try {
        const raw = await this.complete({ system: system(lang), messages: [{ role: "user", content: prompt }], maxTokens: 4000, effort: "medium", schema: { name: "mood_report", schema: INSIGHT_SCHEMA } });
        const j = parseInsight(raw);
        if (j) return { ...j, source: "ai" };
        this.log.warn("analyze: could not parse JSON, using local insights");
      } catch (e) {
        this.log.warn("analyze failed, using local insights:", (e as Error).message);
      }
    }
    return { ...localInsight(st, lang), source: "local" };
  }

  // ─────────── دردشة ───────────

  async chat(history: ChatTurn[], message: string, recent: Entry[], name: string, lang: Lang = "ar"): Promise<string> {
    if (!this.enabled) throw new AIError("AI disabled");
    const en = lang === "en";
    const context = en
      ? `Person's name: ${name}\nTheir recent mood entries:\n${recent.slice(-14).map((e) => formatEntry(e, lang)).join("\n") || "none yet"}\n\nThis is a free chat in DMs. Reply briefly (1-5 sentences) and naturally, like a friend. Use their mood data when relevant but don't repeat it every time. If they ask about something unrelated, help briefly. Reply in the language they write in.`
      : `اسم الشخص: ${name}\nآخر تسجيلات مزاجه:\n${recent.slice(-14).map((e) => formatEntry(e, lang)).join("\n") || "لا يوجد بعد"}\n\nهذي دردشة حرة في الخاص. رد باختصار (1-5 جمل) وبشكل طبيعي كصديق. استخدم بيانات مزاجه لو لها علاقة بس لا تكررها كل مرة. لو طلب شي خارج موضوع المزاج ساعده باختصار. رد بنفس اللغة اللي يكتب فيها.`;
    const turns = normalizeTurns([...history, { role: "user", content: message }]);
    return this.complete({ system: `${system(lang)}\n\n${context}`, messages: turns, maxTokens: 1500, effort: "low" });
  }
}

/** يقرأ JSON التحليل حتى لو الموديل لفّه بـ ```json أو كتب كلام قبله. */
export function parseInsight(raw: string): ReportInsight | null {
  const candidates = [raw, raw.replace(/^```(?:json)?\s*|\s*```$/g, ""), raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)];
  for (const c of candidates) {
    try {
      const j = JSON.parse(c) as Partial<ReportInsight>;
      if (typeof j.summary === "string") {
        const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
        return { summary: j.summary, good_things: arr(j.good_things), bad_things: arr(j.bad_things), tips: arr(j.tips) };
      }
    } catch {
      /* next */
    }
  }
  return null;
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

/** تحليل محلي بدون AI: أرقام + أنشطة + أكثر الأشياء تكراراً. */
export function localInsight(st: PeriodStats, lang: Lang = "ar"): ReportInsight {
  const t = L(lang);
  const wd = WEEKDAYS[lang];
  const parts = [t.localSummary(st.count, st.days, st.avg.toFixed(1))];
  if (st.delta !== null) parts.push(st.delta > 0.1 ? t.localBetter(st.delta.toFixed(1)) : st.delta < -0.1 ? t.localWorse(Math.abs(st.delta).toFixed(1)) : t.localSame);
  if (st.bestWeekday !== null) parts.push(t.localBestDay(wd[st.bestWeekday]!));

  const good = [
    ...st.tags.filter((x) => x.delta >= 0.3).slice(0, 3).map((x) => `${x.emoji} ${x.label[lang]} (+${x.delta.toFixed(1)})`),
    ...commonThemes(st.entries.filter((e) => e.mood >= 4).map((e) => e.highlight), lang),
  ].slice(0, 5);
  const bad = [
    ...st.tags.filter((x) => x.delta <= -0.3).reverse().slice(0, 3).map((x) => `${x.emoji} ${x.label[lang]} (${x.delta.toFixed(1)})`),
    ...commonThemes(st.entries.map((e) => e.problems), lang),
  ].slice(0, 5);

  const tips: string[] = [];
  const topGood = st.tags.find((x) => x.delta >= 0.3);
  if (topGood) tips.push(t.tipTag(topGood.emoji, topGood.label[lang]));
  if (st.sleepGood !== null && st.sleepBad !== null && st.sleepGood - st.sleepBad >= 0.75) tips.push(t.tipSleep(st.sleepGood.toFixed(1), st.sleepBad.toFixed(1)));
  const corr = describeCorr(st.energyCorr, lang);
  if (corr && st.energyCorr! > 0) tips.push(t.tipEnergy(corr));
  if (st.worstWeekday !== null) tips.push(t.tipWeekday(wd[st.worstWeekday]!));
  if (!tips.length) tips.push(t.tipDefault);

  return { summary: parts.join(" "), good_things: good, bad_things: bad, tips: tips.slice(0, 3) };
}
