/** الصفحات الكاملة: الرئيسية، الفريق، لوحة التحكم. */
import { raw, type Html } from "#jsx/jsx-runtime";
import { icon } from "../ui/icons.ts";
import { NAV_BOTTOM, NAV_GROUPS, NAV_TOP, sectionIcon } from "../ui/schema.ts";
import { ROLE_ICON, TEAM, type Member } from "../ui/team.ts";
import { Base, Blobs, otherLang, sectionName, T, Topbar, type PageCtx } from "./layout.tsx";

const OG_IMAGE = "https://cdn.discordapp.com/attachments/1485266933979938996/1557344391398555708/file_0000000049ac824698e55d68d94ffb9a.png?backend=b2&ex=6ac7757c&is=6ac623fc&hm=55825f0b1d1ed06f4ca6e4cce42360c737fdd2f5b134b6ce436ec5e14dd1a3c8&";

export function Landing({ c }: { c: PageCtx }): Html {
  const ics = ["shield", "bolt", "sliders", "smile", "ticket", "logs"];
  const dirs = ["right", "", "left", "right", "", "left"];
  const marquee: string[] = T(c, "land.marquee");
  const cards: [string, string][] = T(c, "land.cards");
  const meta = (
    <>
      <meta property="og:type" content="website" />
      <meta property="og:site_name" content="Revive" />
      <meta property="og:title" content="Revive | ريفايف" />
      <meta property="og:description" content={T(c, "meta.desc")} />
      <meta property="og:image" content={OG_IMAGE} />
      <meta name="twitter:card" content="summary_large_image" />
    </>
  );
  return (
    <Base c={c} title={T(c, "meta.landing")} meta={meta} css="/assets/css/landing.css" script="/assets/js/landing.js">
      <Blobs />
      <i class="b" style="width:460px;height:300px;bottom:6%;inset-inline-start:22%;animation-delay:-11s;opacity:.7"></i>
      <Topbar c={c} active="home" />
      <div class="rl l-js">
        <div class="l-progress"></div>
        <div class="l-bg"><i class="l-swirl s1" data-s=".16" data-r=".01"></i><i class="l-swirl s2" data-s="-.1" data-r="-.015"></i><i class="l-swirl s3" data-s=".07" data-r=".01"></i><div class="l-particles"></div><div class="l-glow"></div></div>

        <section class="l-hero"><div class="l-wrap">
          <div class="l-stage">
            <i class="l-ring r1"></i><i class="l-ring r2"></i><i class="l-halo"></i>
            <div class="l-logo-wrap"><div class="l-logo-text">{T(c, "brand")}</div></div>
            {icon("emblem", "l-emblem")}
            <div class="l-line"><i></i><i></i></div>
          </div>
          {/* نص موثوق من ملف الترجمة (فيه <b>) */}
          <h2>{raw(T(c, "land.heroTitle"))}</h2>
          <p>{T(c, "land.heroSub")}</p>
          <div class="l-cta">
            <a class="l-btn fill" href="/dashboard"><span>{T(c, "land.open")}</span>{icon("arrow", "flip")}</a>
            <a class="l-btn ghost" href="#l-features" id="to-features">{icon("sliders")}<span>{T(c, "land.features")}</span></a>
          </div>
          <div class="l-scroll"><i></i></div>
        </div></section>

        <div class="l-marquee"><div class="l-track">
          {[0, 1].map(() => marquee.map((w) => <span>{w}</span>))}
        </div></div>

        <section class="l-block" id="l-stats"><div class="l-wrap">
          <span class="l-eyebrow l-reveal">{T(c, "land.statsEyebrow")}</span>
          <h2 class="l-title l-reveal">{T(c, "land.statsTitle")}</h2>
          <p class="l-sub l-reveal">{T(c, "land.statsSub")}</p>
          <div class="l-stats">
            <div class="l-stat l-reveal" data-d="zoom" style="--i:0"><b data-count="99.9" data-suffix="%">99.9%</b><span>{T(c, "land.uptime")}</span></div>
            <div class="l-stat l-reveal" data-d="zoom" style="--i:1"><b dir="ltr">24/7</b><span>{T(c, "land.always")}</span></div>
            <div class="l-stat l-reveal" data-d="zoom" style="--i:2"><b dir="ltr">{"<1s"}</b><span>{T(c, "land.response")}</span></div>
            <div class="l-stat l-reveal" data-d="zoom" style="--i:3"><b>∞</b><span>{T(c, "land.custom")}</span></div>
          </div>
        </div></section>

        <section class="l-block" id="l-features"><div class="l-wrap">
          <span class="l-eyebrow l-reveal">{T(c, "land.featEyebrow")}</span>
          <h2 class="l-title l-reveal">{T(c, "land.featTitle")}</h2>
          <p class="l-sub l-reveal">{T(c, "land.featSub")}</p>
          <div class="l-grid">
            {cards.map((card, i) => (
              <article class="l-card l-reveal" data-d={dirs[i] || undefined} style={`--i:${i % 3}`}>
                <div class="l-ico">{icon(ics[i], "l-i")}</div><h3>{card[0]}</h3><p>{card[1]}</p></article>
            ))}
          </div>
        </div></section>

        <section class="l-block" id="l-join"><div class="l-wrap">
          <div class="l-band l-reveal" data-d="zoom"><h2>{T(c, "land.joinTitle")}</h2><p>{T(c, "land.joinSub")}</p>
            <a class="l-btn" href="/dashboard"><span>{T(c, "land.joinBtn")}</span>{icon("arrow", "flip")}</a></div>
        </div></section>

        <footer class="l-foot"><div class="l-brand">{icon("emblem")}<span>{T(c, "brand")}</span></div><span>{T(c, "land.rights")}</span></footer>
      </div>
    </Base>
  );
}

function MemberCard({ c, m, i, big = false }: { c: PageCtx; m: Member; i: number; big?: boolean }): Html {
  const initials = m.name.replaceAll(".", "").replaceAll(" ", "").slice(0, 2).toUpperCase() || "?";
  return (
    <article class={"tm-card" + (big ? " founder" : "")} data-role={m.role} data-tilt={big ? 3 : 9} style={`--i:${i}`}>
      {m.sample && <span class="tm-tag">{T(c, "team.sample")}</span>}
      <div class="tm-av">{m.avatar ? <img src={m.avatar} alt="" /> : initials}</div>
      <div>
        <h3 class="tm-name">{m.name}</h3>
        <span class="tm-role">{icon(ROLE_ICON[m.role])}{m.title[c.lang] || m.title.ar}</span>
        <p class="tm-bio">{m.bio[c.lang] || m.bio.ar}</p>
        <div class="tm-foot">
          {m.since && <span>{icon("calendar")} {T(c, "team.since", { y: m.since })}</span>}
          {m.discord && <button type="button" class="tm-chip" data-copy={m.discord}>{icon("discord")}{m.discord}</button>}
        </div>
      </div>
    </article>
  );
}

export function Team({ c }: { c: PageCtx }): Html {
  const founder = TEAM.find((m) => m.role === "owner");
  const rest = TEAM.filter((m) => m.role !== "owner");
  const roles = [...new Set(rest.map((m) => m.role))];
  return (
    <Base c={c} title={T(c, "meta.team")} css="/assets/css/team.css" script="/assets/js/team.js">
      <Blobs second="40%" />
      <Topbar c={c} active="team" />
      <main class="tm-page">
        <section class="tm-hero">
          <div class="tm-orbit"><i></i><i></i><i></i></div>
          <span class="tm-eyebrow">{T(c, "team.eyebrow")}</span>
          <h1 class="tm-title">{T(c, "team.title")}</h1>
          <p class="tm-sub">{T(c, "team.sub")}</p>
          <div class="tm-stats">
            <div class="tm-stat" style="--i:0"><b data-n={TEAM.length}>0</b><span>{T(c, "team.members")}</span></div>
            <div class="tm-stat" style="--i:1"><b data-n={new Set(TEAM.map((m) => m.role)).size}>0</b><span>{T(c, "team.roles")}</span></div>
            <div class="tm-stat" style="--i:2"><b dir="ltr">24/7</b><span>{T(c, "land.always")}</span></div>
          </div>
        </section>
        {founder && <section><MemberCard c={c} m={founder} i={0} big /></section>}
        <div class="tm-filters" id="tm-filters">
          <button type="button" data-f="all" class="on">{T(c, "team.all")}</button>
          {roles.map((r) => <button type="button" data-f={r}>{T(c, "team.roleNames." + r)}</button>)}
        </div>
        <section class="tm-grid" id="tm-grid">{rest.map((m, i) => <MemberCard c={c} m={m} i={i + 1} />)}</section>
        <section class="tm-join"><h2>{T(c, "team.join")}</h2><p>{T(c, "team.joinSub")}</p>
          <a class="btn" href={c.supportUrl} target="_blank" rel="noopener">{icon("discord")}<span>{T(c, "team.joinBtn")}</span></a></section>
      </main>
    </Base>
  );
}

const NavLink = ({ c, k }: { c: PageCtx; k: string }) => (
  <a href={"#" + k} data-s={k}>{icon(sectionIcon(k))}<span>{sectionName(c, k)}</span></a>
);

export function Dashboard({ c, guilds, gid }: { c: PageCtx; guilds: { id: string; name: string }[]; gid: string }): Html {
  const u = c.user!;
  return (
    <Base c={c} title={T(c, "meta.dashboard")} meta={<meta name="robots" content="noindex" />} css="/assets/css/dashboard.css" script="/assets/js/dashboard.js">
      <div id="splash"><div class="sp-in">{icon("emblem")}<b>{T(c, "brand")}</b><div class="sp-bar"><i></i></div></div></div>
      <Blobs />
      <i class="b" style="width:460px;height:300px;bottom:6%;inset-inline-start:22%;animation-delay:-11s;opacity:.7"></i>
      <svg class="wv" viewBox="0 0 800 60" preserveAspectRatio="none"><path d="M0 30Q100 0 200 30T400 30T600 30T800 30V60H0Z" /></svg>
      <svg class="wv s" viewBox="0 0 800 60" preserveAspectRatio="none"><path d="M0 34Q100 6 200 34T400 34T600 34T800 34V60H0Z" /></svg>

      <div id="app" data-gid={gid} data-start="">
        <button id="mb" type="button" aria-label={T(c, "ui.menu")}>{icon("menu")}</button>
        <div id="ov"></div>
        <aside>
          <a class="brand" href="/"><img src="/logo.png" alt="" onerror="this.onerror=null;this.src='/assets/img/favicon.png'" /><div><b>{T(c, "brand")}</b><small>{T(c, "ui.brandSub")}</small></div></a>
          <div class="sel-wrap">{icon("server")}<select id="g" aria-label={T(c, "ui.server")}>
            {guilds.map((g) => <option value={g.id} selected={g.id === gid}>{g.name}</option>)}</select></div>
          <div class="nav-search">{icon("search")}<input id="ns" type="search" autocomplete="off" placeholder={T(c, "ui.search")} /></div>
          <nav id="nav">
            {NAV_TOP.map((k) => <NavLink c={c} k={k} />)}
            {NAV_GROUPS.map(([g, ks]) => <><div class="ng">{T(c, "ui.groups." + g)}</div>{ks.map((k) => <NavLink c={c} k={k} />)}</>)}
            <div class="ng">{T(c, "ui.groups.reviews")}</div>{NAV_BOTTOM.map((k) => <NavLink c={c} k={k} />)}
            <div class="nav-empty" hidden>{T(c, "ui.noResults")}</div>
          </nav>
          <div class="side-foot">
            <div class="userchip"><img src={u.avatar} alt="" /><span>{u.global_name || u.name}</span></div>
            <div class="side-row">
              <button class="lang-btn" data-lang-toggle={otherLang(c)} type="button">{icon("globe")}<span>{T(c, "langToggle")}</span></button>
              <button class="theme-btn" data-theme-btn type="button" aria-label={T(c, "theme.title")}>{icon("palette")}</button>
            </div>
            <a class="out" href="/logout">{icon("logout")}<span>{T(c, "ui.logout")}</span></a>
          </div>
        </aside>
        <main id="main" aria-live="polite"></main>
      </div>
    </Base>
  );
}
