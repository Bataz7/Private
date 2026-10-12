/** أجزاء اللوحة (تُحمَّل داخل #main عبر /ui/view/<قسم>): نماذج الأقسام، البانلات، الرئيسية… */
import { raw, type Html } from "#jsx/jsx-runtime";
import type { GuildMeta } from "../lib/discord.ts";
import type { Data } from "../lib/store.ts";
import { icon } from "../ui/icons.ts";
import { PRESETS } from "../ui/presets.ts";
import {
  CUSTOM, INTERVALS, LOG_TYPES, NAV_GROUPS, OPTIONS, PUNISHMENTS, SC_ICONS, SEC_FEATS, SECTIONS, WIDE_TYPES, sectionIcon, type Field,
} from "../ui/schema.ts";
import { ORDER as THEME_ORDER } from "../ui/themes.ts";
import { H, sectionName, T, type PageCtx } from "./layout.tsx";

const isSel = (value: unknown, current: unknown) => String(value) === String(current ?? "");
const val = (v: unknown) => (v == null ? "" : String(v));

const Header = ({ name, title, sub }: { name: string; title: string; sub: string }) => (
  <div class="ph"><span class="pi">{icon(name)}</span><div><h1>{title}</h1><small>{sub}</small></div></div>
);

const Options = ({ items, current, prefix = "" }: { items: { id: string; name: string }[]; current?: unknown; prefix?: string }) => (
  <>{items.map((o) => <option value={o.id} selected={isSel(o.id, current)}>{prefix}{o.name}</option>)}</>
);

/* ---------- صفوف متكررة (لها قوالب <template> أيضاً) ---------- */
const ReplyRow = ({ c, r }: { c: PageCtx; r: Data }) => (
  <div class="ar-row"><input class="k" placeholder={T(c, "sec.replies.kw")} value={val(r.keyword)} />
    <select class="m"><option value="contains" selected={isSel("contains", r.match_type || "contains")}>{T(c, "sec.replies.contains")}</option><option value="exact" selected={isSel("exact", r.match_type)}>{T(c, "sec.replies.exact")}</option></select>
    <textarea class="r" rows="2" placeholder={T(c, "sec.replies.resp")}>{val(r.response)}</textarea>
    <div class="mn"><span>{T(c, "sec.replies.mention")}</span><label class="sw"><input type="checkbox" class="c" checked={!!r.mention} /><i></i></label></div>
    <button type="button" class="btn danger sm" data-act="delReply">{icon("trash")}<span>{T(c, "c.del")}</span></button></div>
);
const BwChip = ({ c, w }: { c: PageCtx; w: string }) => (
  <span class="cw" data-w={w}>{w}<button type="button" data-act="bwDel" aria-label={T(c, "c.del")}>{icon("x")}</button></span>
);
const ScChip = ({ c, name, enabled = true }: { c: PageCtx; name: string; enabled?: boolean }) => (
  <span class="sc-chip" data-name={name} data-enabled={enabled ? "1" : "0"}>{name}<button type="button" class="sc-x" aria-label={T(c, "sec.shortcuts.remove")}>{icon("x")}</button></span>
);

function scGroups(items: Data[]): [string, Data[]][] {
  const m = new Map<string, Data[]>();
  for (const x of items ?? []) {
    const k = String(x.target ?? "").trim().replace(/^\/+/, "");
    if (!k) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(x);
  }
  const known = Object.keys(SC_ICONS);
  return [...known, ...[...m.keys()].filter((k) => !known.includes(k))].map((k) => [k, m.get(k) ?? []]);
}

const ScGroup = ({ c, target, items }: { c: PageCtx; target: string; items: Data[] }) => (
  <div class="sc-group" data-target={target}><div class="sc-head"><div class="sc-head-main"><div class="sc-head-icon">{icon(SC_ICONS[target] ?? "bolt")}</div>
    <div><b>{target}/</b><small>{H(c, "sec.shortcuts.actions." + target) ? T(c, "sec.shortcuts.actions." + target) : target}</small></div></div>
    <button type="button" class="sc-edit" data-act="scEdit" title={T(c, "sec.shortcuts.edit")} aria-label={T(c, "sec.shortcuts.edit")}>{icon("pencil")}</button></div>
    {items.length
      ? <div class="sc-chips">{items.map((x) => <ScChip c={c} name={String(x.name)} enabled={x.enabled !== false} />)}</div>
      : <div class="sc-empty">{T(c, "sec.shortcuts.empty")}</div>}</div>
);

/* ---------- حقل نموذج ---------- */
function FieldView({ c, sec, f, data, meta }: { c: PageCtx; sec: string; f: Field; data: Data; meta: GuildMeta }): Html {
  const [k, ty, x] = f;
  const v = data[k];
  let body: Html;
  if (ty === "tx") {
    const url = k.includes("url") || k.includes("image");
    body = <input data-k={k} data-mirror={k} value={val(v)} dir={url ? "ltr" : undefined} placeholder={url ? "https://" : undefined} />;
  } else if (ty === "ta") {
    body = <textarea data-k={k} data-mirror={k} rows="4">{val(v)}</textarea>;
  } else if (ty === "bo") {
    const on = v != null ? !!v : !!x;
    body = <label class="sw"><input type="checkbox" data-k={k} checked={on} /><i></i></label>;
  } else if (ty === "qs") {
    const qs = [...(Array.isArray(v) ? v : []), "", "", "", "", ""].slice(0, 5);
    body = <>{qs.map((q) => <input class="q" maxlength="45" placeholder={T(c, `sec.${sec}.qph`)} value={val(q)} />)}</>;
  } else if (ty === "ar") {
    const items: Data[] = Array.isArray(v) ? v : [];
    body = data.legacy
      ? <p class="nt">{T(c, "sec.replies.legacy")}</p>
      : <>
          <div class="ar">{items.map((r) => <ReplyRow c={c} r={r} />)}</div>
          <div class="empty" id="ar-empty" hidden={items.length > 0}>{T(c, "sec.replies.empty")}</div>
          <button type="button" class="btn sm" data-act="addReply">{icon("plus")}<span>{T(c, "sec.replies.add")}</span></button>
        </>;
  } else if (ty === "sc") {
    body = <div class="sc">{scGroups(Array.isArray(v) ? v : []).map(([target, items]) => <ScGroup c={c} target={target} items={items} />)}</div>;
  } else if (ty === "lg") {
    body = <>
      <div class="lgtop"><select id="lgall"><option value="">{T(c, "sec.logs.pick")}</option><Options items={meta.channels} prefix="# " /></select>
        <button type="button" class="btn sm" data-act="lgApply">{icon("check")}<span>{T(c, "sec.logs.apply")}</span></button>
        <button type="button" class="btn danger sm" data-act="lgClear">{icon("trash")}<span>{T(c, "sec.logs.clear")}</span></button></div>
      {Object.entries(LOG_TYPES).map(([lt, ic]) => (
        <div class="lg-row"><div class="rowname"><span class="ri">{icon(ic)}</span>{T(c, "sec.logs.types." + lt)}</div>
          <select data-k={lt}><option value="">{T(c, "sec.logs.off")}</option><Options items={meta.channels} current={data[lt]} prefix="# " /></select>
          <button type="button" class="btn danger sm icon" data-act="lgDel" aria-label={T(c, "c.del")}>{icon("trash")}</button></div>
      ))}
    </>;
  } else if (ty === "sec") {
    body = <>{Object.entries(SEC_FEATS).map(([fe, ic]) => {
      const info: string[] = T(c, "sec.security.feats." + fe);
      return (
        <div class="sec-row"><div><div class="rowname"><span class="ri">{icon(ic)}</span><span>{info[0]}{info.length > 2 && <span class="dev">{info[2]}</span>}</span></div><small>{info[1]}</small></div>
          <label class="sw"><input type="checkbox" data-k={fe + "__on"} checked={!!data[fe + "__on"]} /><i></i></label>
          <select data-k={fe + "__p"}>{PUNISHMENTS.map((p) => <option value={p} selected={isSel(p, data[fe + "__p"] || "timeout")}>{T(c, "pun." + p)}</option>)}</select></div>
      );
    })}</>;
  } else if (ty === "bw") {
    body = <>
      <div class="bw-add"><input id="bwin" placeholder={T(c, "sec.badwords.ph")} maxlength="100" /><button type="button" class="btn sm" data-act="bwAdd">{icon("plus")}<span>{T(c, "sec.badwords.add")}</span></button></div>
      <div class="bw">{(Array.isArray(v) ? v : []).map((w: string) => <BwChip c={c} w={w} />)}</div>
    </>;
  } else if (ty === "pn") {
    body = <select data-k={k}>{PUNISHMENTS.map((p) => <option value={p} selected={isSel(p, v || "timeout")}>{T(c, "pun." + p)}</option>)}</select>;
  } else if (ty === "interval") {
    body = <select data-k={k}>{INTERVALS.map((n) => <option value={n} selected={isSel(n, v || 15)}>{T(c, n <= 10 ? "opt.minutesFew" : "opt.minutes", { n })}</option>)}</select>;
  } else if (ty === "num") {
    body = <input type="number" min="1" max="5" data-k={k} value={v != null ? val(v) : "1"} />;
  } else if (ty === "preset") {
    body = <select data-k={k}><option value="">{T(c, "c.none")}</option>
      {Object.entries(PRESETS).map(([key, p]) => <option value={key} selected={isSel(key, v)}>{p[c.lang]}</option>)}</select>;
  } else if (ty === "sel") {
    const labels: string[] = T(c, "opt." + x);
    body = <select data-k={k}>{(OPTIONS[String(x)] ?? []).map((o, i) => <option value={o} selected={isSel(o, v)}>{labels[i]}</option>)}</select>;
  } else {
    const src = ty === "ch" ? meta.channels : ty === "rl" ? meta.roles : meta.categories;
    body = <select data-k={k}><option value="">{T(c, "c.none")}</option><Options items={src} current={v} prefix={ty === "ch" ? "# " : ""} /></select>;
  }
  return (
    <div class={"f" + (WIDE_TYPES.has(ty) ? " w" : "") + (ty === "bo" ? " bo" : "")}>
      <label>{T(c, `sec.${sec}.f.${k}`)}</label>
      {body}
    </div>
  );
}

const ModeTabs = ({ c, sec, mode }: { c: PageCtx; sec: string; mode: string }) => {
  const labels: string[] = T(c, `sec.${sec}.modes`);
  return (
    <div class="tabs modes">{labels.map((l, i) => {
      const m = i ? "panel" : "setup";
      return <button type="button" data-mode={m} class={m === mode ? "on" : ""}>{icon(i ? "send" : "settings")}{l}</button>;
    })}</div>
  );
};

export function SectionView({ c, sec, guildName, meta, data, slot }: { c: PageCtx; sec: string; guildName: string; meta: GuildMeta; data: Data; slot: string }): Html {
  const s = SECTIONS[sec]!;
  const noteTitle = H(c, `sec.${sec}.noteTitle`) ? T(c, `sec.${sec}.noteTitle`) : "";
  const noteText = H(c, `sec.${sec}.note`) ? T(c, `sec.${sec}.note`) : "";
  const slotNames: string[] | null = s.slot_names ? T(c, `sec.${sec}.${s.slot_names}`) : null;
  const varNames: string[] = s.vars ? T(c, `sec.${sec}.vars`) : [];
  return (
    <div id="view" data-kind="form" data-section={sec} data-slot={slot} data-mode="setup">
      <Header name={s.icon} title={T(c, `sec.${sec}.n`)} sub={guildName} />
      {s.modes && <ModeTabs c={c} sec={sec} mode="setup" />}
      {s.slots && (
        <div class="tabs">{s.slots.map((k, i) => (
          <button type="button" data-slot={k} class={k === slot ? "on" : ""}>{slotNames ? slotNames[i] : T(c, "slot", { n: k })}</button>
        ))}</div>
      )}

      <form id="form" autocomplete="off">
        {s.groups.map((g) => (
          <section class={"card grp" + (g.icon ? "" : " plain")}>
            {g.icon && <div class="grp-h"><span class="gi">{icon(g.icon)}</span><b>{T(c, "grp." + g.key)}</b></div>}
            {g.fields.map((f) => <FieldView c={c} sec={sec} f={f} data={data} meta={meta} />)}
          </section>
        ))}
      </form>

      {sec === "tickets" && (
        <div class="pv-wrap"><div class="pv-h">{icon("eye")}<b>{T(c, "tpv.title")}</b><small>{T(c, "tpv.hint")}</small></div>
          <div class="dc-msg"><div class="dc-av">{icon("bot")}</div><div class="dc-body">
            <div class="dc-name">{T(c, "brand")} <span class="dc-tag">BOT</span></div>
            <div class="dc-embed"><div class="dc-et"><span data-mirror-to="name">{data.name || "Support"}</span> · {T(c, "tpv.user")}</div>
              <div class="dc-ed" data-mirror-to="welcome_msg" data-empty={T(c, "tpv.empty")}>{data.welcome_msg || T(c, "tpv.empty")}</div></div>
            <div class="dc-btns"><span class="dc-b red">{icon("lock")}{T(c, "tpv.close")}</span><span class="dc-b">{icon("hand")}{T(c, "tpv.claim")}</span></div></div></div></div>
      )}
      {sec === "welcome" && (
        <div class="pv-wrap"><div class="pv-h">{icon("eye")}<b>{T(c, "wpv.title")}</b><small>{T(c, "wpv.hint")}</small></div>
          <div class="dc-msg"><div class="dc-av">{icon("bot")}</div><div class="dc-body">
            <div class="dc-name">{T(c, "brand")} <span class="dc-tag">BOT</span></div>
            <div class="dc-ed" data-mirror-to="outside_text" data-vars="1" data-empty=""></div>
            <div class="dc-embed"><div class="dc-ed" data-mirror-to="embed_text" data-vars="1" data-empty="…">{data.embed_text || "…"}</div></div></div></div></div>
      )}

      {(noteTitle || noteText) && (
        <div class="note">{icon(s.note_icon || "info")}<div>{noteTitle && <b>{noteTitle}</b>}{noteText && <div>{noteText}</div>}
          {s.vars && <ul>{s.vars.map((code, i) => <li><code>{code}</code> = {varNames[i]}</li>)}</ul>}</div></div>
      )}

      <div class="savebar"><span class="dirty">{T(c, "c.unsavedBadge")}</span>
        <button class="btn" id="sv" type="button">{icon(sec === "embed" ? "send" : "save")}<span>{sec === "embed" ? T(c, "sec.embed.btn") : T(c, "c.save")}</span></button></div>
      <div class="kbd-hint">{T(c, "c.hint")}</div>

      <template id="tpl-reply"><ReplyRow c={c} r={{}} /></template>
      <template id="tpl-bw"><BwChip c={c} w="__w__" /></template>
      <template id="tpl-chip"><ScChip c={c} name="__n__" /></template>
      <template id="tpl-modal"><div class="modal"><div class="modal-box" role="dialog" aria-modal="true">
        <div class="modal-head"><h3>{T(c, "sec.shortcuts.modalTitle")}</h3><p>{T(c, "sec.shortcuts.modalHint")}</p></div>
        <div class="modal-body"><div class="cmdbox"></div><label>{T(c, "sec.shortcuts.label")}</label><div class="alias-editor"><input class="mal-in" placeholder={T(c, "sec.shortcuts.ph")} /></div></div>
        <div class="modal-actions"><button type="button" class="btn sm mal-save">{icon("check")}<span>{T(c, "sec.shortcuts.save")}</span></button><button type="button" class="btn ghost sm mal-close">{T(c, "c.cancel")}</button></div></div></div></template>
    </div>
  );
}

export function PanelView({ c, sec, guildName, meta, items }: { c: PageCtx; sec: string; guildName: string; meta: GuildMeta; items: { num: string; name: string }[] }): Html {
  const s = SECTIONS[sec]!;
  const w: string = T(c, `sec.${sec}.w`);
  const modes: string[] = T(c, `sec.${sec}.modes`);
  return (
    <div id="view" data-kind="panel" data-section={sec} data-mode="panel" data-w={w}>
      <Header name={s.icon} title={T(c, `sec.${sec}.n`)} sub={guildName} />
      <ModeTabs c={c} sec={sec} mode="panel" />
      <form id="form" autocomplete="off">
        <section class="card grp"><div class="grp-h"><span class="gi">{icon("layers")}</span><b>{T(c, "panel.title")}</b></div>
          <div class="f w"><label>{T(c, "panel.title")}</label><input id="tpt" maxlength="256" /></div>
          <div class="f w"><label>{T(c, "panel.desc")}</label><textarea id="tpd" rows="4"></textarea></div>
          <div class="f w"><label>{T(c, "panel.image")}</label><input id="tpi" dir="ltr" placeholder="https://" /></div></section>
        <section class="card grp"><div class="grp-h"><span class="gi">{icon("send")}</span><b>{T(c, "panel.channel")}</b></div>
          <div class="f w"><label>{T(c, "panel.channel")}</label><select id="tpc"><option value="">{T(c, "c.chooseChannel")}</option><Options items={meta.channels} prefix="# " /></select></div>
          <div class="f w"><label>{T(c, "panel.display")}</label><div class="pks" id="tpm"><button type="button" class="pk on" data-v="buttons">{icon("pointer")}{T(c, "panel.buttons")}</button><button type="button" class="pk" data-v="dropdown">{icon("list")}{T(c, "panel.dropdown")}</button></div></div>
          <div class="f w"><label>{T(c, "panel.items", { w })}</label>
            {items.length
              ? <div class="pks" id="tpn">{items.map((x) => <button type="button" class="pk on" data-v={x.num}>{x.num} · {x.name}</button>)}</div>
              : <p class="nt">{T(c, "panel.none", { w, tab: modes[0] ?? "" })}</p>}</div></section>
      </form>
      <div class="savebar"><button class="btn" id="sv" type="button">{icon("send")}<span>{T(c, "panel.send")}</span></button></div>
    </div>
  );
}

export function EmptyView({ c, iconName, message, invite = false, title }: { c: PageCtx; iconName: string; message: string; invite?: boolean; title?: string }): Html {
  return (
    <div id="view" data-kind="empty">
      {title && <Header name={iconName} title={title} sub="" />}
      <div class="card block empty-state">{icon(iconName || "server")}<p>{message}</p>
        {invite && <a class="btn" href="/invite" target="_blank" rel="noopener">{icon("bot")}<span>{T(c, "ui.addBot")}</span></a>}</div>
    </div>
  );
}

export function HomeView({ c, tiles }: { c: PageCtx; tiles: [string, string, string | null, number | null][] }): Html {
  const u = c.user!;
  const quick = [...NAV_GROUPS.flatMap(([, ks]) => ks), "themes", "emojis", "language", "stats", "rate"];
  return (
    <div id="view" data-kind="home">
      <div class="hello" data-tilt="3"><img src={u.avatar} alt="" /><div><h1>{T(c, "ui.hello", { name: u.global_name || u.name })}</h1><p>{T(c, "ui.helloSub")}</p></div></div>
      <div class="tiles">
        {tiles.map(([ic, label, v, cnt], i) => (
          <div class="tile" data-tilt="10" style={`--i:${i}`}><span class="ti">{icon(ic)}</span><div><b>{cnt !== null
            ? <span class="cnt" data-countup={cnt}>0</span>
            : <span dir="ltr">{v}</span>}</b><small>{label}</small></div></div>
        ))}
      </div>
      <h2 class="sect-title">{icon("bolt")}{T(c, "ui.quick")}</h2>
      <div class="quick">{quick.map((k, i) => <a href={"#" + k} data-tilt="12" style={`--i:${i}`}><span class="qi">{icon(sectionIcon(k))}</span>{sectionName(c, k)}</a>)}</div>
    </div>
  );
}

export const StatsView = ({ c, total }: { c: PageCtx; total: number }) => (
  <div id="view" data-kind="stats">
    <Header name="chart" title={T(c, "stats.title")} sub={T(c, "stats.sub")} />
    <div><div class="stat-box"><div class="stat-num" data-countup={total}>0</div><div class="stat-label">{T(c, "stats.servers")}</div></div><p class="stat-sub">{T(c, "stats.text")}</p></div>
  </div>
);

export const ThemesView = ({ c }: { c: PageCtx }) => (
  <div id="view" data-kind="themes">
    <Header name="palette" title={T(c, "theme.title")} sub={T(c, "theme.sub")} />
    <h2 class="sect-title">{icon("sparkles")}{T(c, "theme.pick")}</h2>
    <div class="theme-grid">{THEME_ORDER.map((id, i) => (
      <button type="button" class="theme-card" data-theme={id} data-id={id} data-tilt="8" style={`--i:${i}`}>
        <div class="tc-prev"><div class="s"></div><div class="m"><div class="h"></div><div class="c"><i></i><i></i><i></i></div></div></div>
        <div class="tc-name"><span>{T(c, "theme.names." + id)}</span><span class="ok">{icon("check")}</span></div></button>
    ))}</div>
    <div class="card block"><div class="fx-row"><div><b>{T(c, "theme.fx")}</b><p>{T(c, "theme.fxHint")}</p></div><label class="sw"><input type="checkbox" id="fxsw" /><i></i></label></div></div>
  </div>
);

export const LanguageView = ({ c }: { c: PageCtx }) => (
  <div id="view" data-kind="language">
    <Header name="globe" title={T(c, "lang.title")} sub={T(c, "lang.sub")} />
    <div class="card block" style="text-align:center"><h2 style="margin:0 0 18px">{T(c, "lang.heading")}</h2>
      <div class="lang-pick"><button type="button" data-setlang="ar" class={c.lang === "ar" ? "on" : ""}><b>AR</b>{T(c, "lang.ar")}</button><button type="button" data-setlang="en" class={c.lang === "en" ? "on" : ""}><b>EN</b>{T(c, "lang.en")}</button></div></div>
  </div>
);

export function RateView({ c, rating }: { c: PageCtx; rating: { mine: { stars: number; comment: string } | null; avg: number; count: number } }): Html {
  return (
    <div id="view" data-kind="rate" data-stars={rating.mine ? rating.mine.stars : 0}>
      <Header name="star" title={T(c, "rate.title")} sub={T(c, "rate.sub")} />
      <div class="card block" style="text-align:center">
        {/* avg و count أرقام من قاعدة البيانات */}
        <div class="avg">{rating.count ? raw(T(c, "rate.avg", { avg: `<b>${Number(rating.avg)}</b>`, count: Number(rating.count) })) : T(c, "rate.first")}</div>
        <div class="stars" id="stars">{[1, 2, 3, 4, 5].map((n) => <button type="button" data-n={n} aria-label={String(n)}>{icon("star")}</button>)}</div>
        <div class="f" style="text-align:start"><label>{T(c, "rate.comment")}</label><textarea id="rc" rows="4" maxlength="500" placeholder={T(c, "rate.ph")}>{rating.mine ? rating.mine.comment : ""}</textarea></div></div>
      <div class="savebar"><button class="btn" id="sv" type="button">{icon("send")}<span>{rating.mine ? T(c, "rate.update") : T(c, "rate.submit")}</span></button></div>
    </div>
  );
}

export interface Emoji { name: string; file: string; category: string; code: string }
export function EmojisView({ c, emojis, cats, idsReady }: { c: PageCtx; emojis: Emoji[]; cats: string[]; idsReady: boolean }): Html {
  return (
    <div id="view" data-kind="emojis">
      <Header name="emoji" title={T(c, "emo.title")} sub={T(c, "emo.sub")} />
      <div class="emo-bar"><div class="nav-search emo-search">{icon("search")}<input id="emo-q" type="search" placeholder={T(c, "emo.search")} autocomplete="off" /></div>
        <div class="tabs emo-cats"><button type="button" data-cat="all" class="on">{T(c, "emo.all")}</button>{cats.map((k) => <button type="button" data-cat={k}>{T(c, "emo.cats." + k)}</button>)}</div>
        <small class="emo-count">{T(c, "emo.count", { n: emojis.length })}</small></div>
      {!idsReady && <div class="note">{icon("info")}<div>{T(c, "emo.noIds")}</div></div>}
      <div class="emo-grid">{emojis.map((e) => (
        <button type="button" class="emo" data-name={e.name} data-cat={e.category} data-code={e.code} title={e.code}><img src={"/emojis/" + encodeURIComponent(e.file)} alt={e.name} loading="lazy" width="48" height="48" /><span>{e.name}</span></button>
      ))}</div>
    </div>
  );
}

export const CUSTOM_VIEWS = new Set(Object.keys(CUSTOM));
