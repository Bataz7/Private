/* أدوات مشتركة | Shared helpers — النصوص تأتي من الباكند (/assets/i18n.js) والصفحات يبنيها السيرفر (TSX).
   هنا فقط: ترجمة الرسائل الديناميكية، API، التنبيهات، الثيمات، تبديل اللغة. */
(function () {
  const LS = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }
  };
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cookie = (k, v) => { document.cookie = `${k}=${v};path=/;max-age=31536000;samesite=lax`; };
  const lang = document.documentElement.lang === 'en' ? 'en' : 'ar';
  const ic = (name, cls = '') => `<svg class="i${cls ? ' ' + cls : ''}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

  function lookup(path, l) {
    let o = window.I18N[l];
    for (const k of path.split('.')) { if (o == null || typeof o !== 'object') return undefined; o = o[k]; }
    return o;
  }
  function t(path, vars) {
    let v = lookup(path, lang);
    if (v === undefined) v = lookup(path, 'ar');
    if (v === undefined) return path;
    if (typeof v === 'string' && vars) v = v.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
    return v;
  }
  const has = p => t(p) !== p;

  /* تبديل اللغة: الباكند يعيد بناء الصفحة باللغة الجديدة */
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-lang-toggle],[data-setlang]');
    if (!b) return;
    const l = b.dataset.setlang || b.dataset.langToggle;
    if (l !== 'ar' && l !== 'en' || l === lang) return;
    if (window.Revive && Revive.beforeLang && Revive.beforeLang() === false) return;
    cookie('lang', l); LS.set('revive_lang', l); location.reload();
  });

  async function api(u, o = {}) {
    const csrf = document.querySelector('meta[name=csrf-token]');
    o.headers = { ...(o.headers || {}), 'X-Lang': lang };
    if (csrf && o.method && o.method !== 'GET') o.headers['X-CSRF-Token'] = csrf.content;
    let r;
    try { r = await fetch(u, o); } catch { throw new Error(t('c.netError')); }
    if (r.status === 401 && !o.quiet) {
      if (location.pathname.startsWith('/dashboard')) location.href = '/login';
      throw new Error(t('c.sessionExpired'));
    }
    if (!r.ok) {
      let m = t('c.genericError');
      try { const d = (await r.json()).detail; if (typeof d === 'string') m = d; } catch { /* not json */ }
      throw new Error(m);
    }
    return r.json();
  }
  const post = (u, body) => api(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  async function html(u) {
    let r;
    try { r = await fetch(u, { headers: { 'X-Lang': lang } }); } catch { throw new Error(t('c.netError')); }
    if (r.status === 401) { location.href = '/login'; throw new Error(t('c.sessionExpired')); }
    if (!r.ok) { let m = t('c.genericError'); try { const d = (await r.json()).detail; if (typeof d === 'string') m = d; } catch { /* ignore */ } throw new Error(m); }
    return r.text();
  }

  let tt;
  function toast(msg, ok = true) {
    const el = $('#t'); if (!el) return;
    el.innerHTML = `${ic(ok ? 'check-circle' : 'alert-circle')}<span>${esc(msg)}</span>`;
    el.className = 'show ' + (ok ? 'ok' : 'er');
    el.setAttribute('role', ok ? 'status' : 'alert');
    clearTimeout(tt); tt = setTimeout(() => { el.className = ''; }, 3600);
  }

  /* ---------- الثيمات ---------- */
  const THEMES = [['royal', ['#0b1d3f', '#21478a', '#4f7fe0']], ['midnight', ['#070d1f', '#1d3a8a', '#6ea2ff']], ['aurora', ['#04121a', '#0f766e', '#2dd4bf']],
    ['emerald', ['#052e26', '#14805f', '#2fd0a0']], ['violet', ['#1e0b45', '#6d3fd1', '#a78bfa']], ['crimson', ['#3b0a1c', '#b3254f', '#ff5c8a']], ['sunset', ['#3b1a05', '#d9731a', '#ffa94d']]];
  const reduceMotion = matchMedia('(prefers-reduced-motion:reduce)').matches;
  let theme = document.documentElement.getAttribute('data-theme') || 'royal';
  function setTheme(id, ev) {
    if (!THEMES.some(x => x[0] === id) || id === theme) return;
    const apply = () => {
      theme = id; document.documentElement.setAttribute('data-theme', id); LS.set('revive_theme', id); cookie('theme', id);
      const m = $('meta[name=theme-color]'); if (m) m.content = THEMES.find(x => x[0] === id)[1][0];
      document.dispatchEvent(new Event('revive:theme'));
    };
    if (!document.startViewTransition || reduceMotion) return apply();
    const x = ev && ev.clientX != null ? ev.clientX : innerWidth / 2, y = ev && ev.clientY != null ? ev.clientY : innerHeight / 2;
    const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    const tr = document.startViewTransition(apply);
    tr.ready.then(() => document.documentElement.animate({ clipPath: [`circle(0 at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] }, { duration: 800, easing: 'cubic-bezier(.2,.8,.2,1)', pseudoElement: '::view-transition-new(root)' })).catch(() => {});
  }
  let pop = null;
  const closePop = () => { if (pop) { pop.remove(); pop = null; } };
  function openPop(btn) {
    if (pop) return closePop();
    pop = document.createElement('div'); pop.className = 'theme-pop';
    const draw = () => { pop.innerHTML = `<h4>${esc(t('theme.title'))}</h4>` + THEMES.map(([id, cs]) =>
      `<button type="button" data-id="${id}" class="${id === theme ? 'on' : ''}"><span class="sw-dots">${cs.map(c => `<i style="background:${c}"></i>`).join('')}</span>${esc(t('theme.names.' + id))}</button>`).join(''); };
    draw();
    pop.addEventListener('click', e => { const b = e.target.closest('button'); if (b) { setTheme(b.dataset.id, e); setTimeout(draw, 50); } });
    document.body.appendChild(pop);
    const r = btn.getBoundingClientRect(), w = 240;
    pop.style.top = (r.top > innerHeight / 2 ? Math.max(8, r.top - pop.offsetHeight - 8) : Math.max(8, Math.min(r.bottom + 8, innerHeight - pop.offsetHeight - 8))) + 'px';
    pop.style.left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 8)) + 'px';
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-theme-btn]');
    if (b) { e.stopPropagation(); openPop(b); } else if (pop && !pop.contains(e.target)) closePop();
  });
  addEventListener('keydown', e => { if (e.key === 'Escape') closePop(); });

  window.ic = ic;
  window.Revive = {
    THEMES, setTheme, get theme() { return theme; }, lang, cookie, ic,
    $, $$, esc, t, has, api, post, html, toast, LS,
    numberFmt: n => Number(n || 0).toLocaleString(lang === 'ar' ? 'ar-SA-u-nu-latn' : 'en-US'),
    countUp(el, to) {
      if (reduceMotion) { el.textContent = Revive.numberFmt(to); return; }
      let t0 = null; const step = ts => { if (!t0) t0 = ts; const p = Math.min((ts - t0) / 1300, 1); el.textContent = Revive.numberFmt(Math.round(to * (1 - Math.pow(1 - p, 4)))); if (p < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    }
  };
})();
