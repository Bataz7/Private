/** الهيكل العام للصفحات + الشريط العلوي. */
import { Html, raw, type Child } from "#jsx/jsx-runtime";
import type { SessionUser } from "../lib/session.ts";
import { has as hasT, t as tr, type Lang } from "../ui/i18n.ts";
import { icon, sprite } from "../ui/icons.ts";
import { SECTIONS } from "../ui/schema.ts";

/** سياق الرسم: اللغة والمستخدم والثيم. */
export interface PageCtx {
  lang: Lang;
  user?: SessionUser;
  theme: string;
  fxOff: boolean;
  supportUrl: string;
  csrf?: string;
}

export const T = (c: PageCtx, path: string, vars?: Record<string, string | number>) => tr(c.lang, path, vars);
export const H = (c: PageCtx, path: string) => hasT(c.lang, path);
export const otherLang = (c: PageCtx) => (c.lang === "ar" ? "en" : "ar");

export function sectionName(c: PageCtx, key: string): string {
  if (key in SECTIONS) return T(c, `sec.${key}.n`);
  const m: Record<string, string> = { home: "ui.home", language: "ui.language", themes: "ui.themes", emojis: "ui.emojis", stats: "ui.stats", rate: "rate.title" };
  return m[key] ? T(c, m[key]) : key;
}

export function Base(p: { c: PageCtx; title: string; meta?: Child; css?: string; bodyClass?: string; script?: string; children?: Child }): Html {
  const { c } = p;
  const page = (
    <html lang={c.lang} dir={c.lang === "ar" ? "rtl" : "ltr"} data-theme={c.theme || "royal"} class={c.fxOff ? "fx-off" : undefined}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>{p.title}</title>
        <meta name="description" content={T(c, "meta.desc")} />
        <meta name="theme-color" content="#0b1d3f" />
        {c.csrf && <meta name="csrf-token" content={c.csrf} />}
        {p.meta}
        <link rel="icon" type="image/png" href="/assets/img/favicon.png" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
        <link href="https://fonts.googleapis.com/css2?family=Readex+Pro:wght@300;400;600;700&family=Lalezar&family=IBM+Plex+Sans+Arabic:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
        <script src="/assets/js/theme-init.js"></script>
        <link rel="stylesheet" href="/assets/css/themes.css" />
        <link rel="stylesheet" href="/assets/css/base.css" />
        {p.css && <link rel="stylesheet" href={p.css} />}
        <link rel="stylesheet" href="/assets/css/fx.css" />
      </head>
      <body class={p.bodyClass ?? ""}>
        {sprite()}
        {p.children}
        <div id="t"></div>
        <script src="/assets/i18n.js"></script>
        <script src="/assets/js/common.js"></script>
        <script src="/assets/js/fx.js"></script>
        {p.script && <script src={p.script}></script>}
      </body>
    </html>
  );
  return raw("<!DOCTYPE html>\n" + page.value);
}

export function Topbar({ c, active }: { c: PageCtx; active: string }): Html {
  return (
    <header class="topbar">
      <a class="tb-brand" href="/"><img src="/logo.png" alt="" onerror="this.onerror=null;this.src='/assets/img/favicon.png'" /><span>{T(c, "brand")}</span></a>
      <nav class="tb-links">
        {active !== "home" && <a class="tb-link" href="/">{icon("home")}<span>{T(c, "team.back")}</span></a>}
        <a class="tb-link" href="/invite" target="_blank" rel="noopener">{icon("bot")}<span>{T(c, "land.invite")}</span></a>
        <a class="tb-link" href={c.supportUrl} target="_blank" rel="noopener">{icon("support")}<span>{T(c, "land.support")}</span></a>
        {active !== "team" && <a class="tb-link" href="/team">{icon("users")}<span>{T(c, "land.team")}</span></a>}
      </nav>
      <div class="tb-end">
        <button class="theme-btn" data-theme-btn type="button" aria-label={T(c, "theme.title")} title={T(c, "theme.title")}>{icon("palette")}</button>
        <button class="lang-btn" data-lang-toggle={otherLang(c)} type="button">{icon("globe")}<span>{T(c, "langToggle")}</span></button>
        {c.user
          ? <a class="btn sm avatar" href="/dashboard"><img src={c.user.avatar} alt="" /><span>{T(c, "land.dashboard")}</span></a>
          : <a class="btn sm" href="/dashboard">{icon("log-in")}<span>{T(c, "land.login")}</span></a>}
      </div>
    </header>
  );
}

/** فقاعات الخلفية المتحركة. */
export const Blobs = ({ second = "30%" }: { second?: string }) => (
  <>
    <i class="b" style="width:420px;height:380px;top:-90px;inset-inline-start:-60px"></i>
    <i class="b" style={`width:340px;height:420px;top:${second};inset-inline-end:-100px;animation-delay:-6s`}></i>
  </>
);
