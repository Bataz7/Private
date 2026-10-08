/* أدوات مشتركة بين الصفحة الرئيسية ولوحة التحكم | Shared helpers: i18n, API, toast */
(function () {
  const LS = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }
  };
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- اللغة ---------- */
  const saved = LS.get('revive_lang') || LS.get('refife_lang');
  let lang = saved === 'en' || saved === 'ar' ? saved : ((navigator.language || '').toLowerCase().startsWith('ar') ? 'ar' : 'en');
  if (!saved && !(navigator.language || '')) lang = 'ar';
  const listeners = [];

  function lookup(path, l) {
    let o = window.I18N[l];
    for (const k of path.split('.')) { if (o == null) return undefined; o = o[k]; }
    return o;
  }
  function t(path, vars) {
    let v = lookup(path, lang);
    if (v === undefined) v = lookup(path, 'ar');
    if (v === undefined) return path;
    if (typeof v === 'string' && vars) v = v.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
    return v;
  }
  function applyStatic(root = document) {
    $$('[data-i18n]', root).forEach(el => { el.textContent = t(el.dataset.i18n); });
    $$('[data-i18n-html]', root).forEach(el => { el.innerHTML = t(el.dataset.i18nHtml); });
    $$('[data-i18n-ph]', root).forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
    $$('[data-i18n-label]', root).forEach(el => { el.setAttribute('aria-label', t(el.dataset.i18nLabel)); el.title = t(el.dataset.i18nLabel); });
    $$('[data-lang-toggle] [data-lang-text]').forEach(el => { el.textContent = t('langToggle'); });
  }
  function applyDocument() {
    const h = document.documentElement;
    h.lang = lang; h.dir = lang === 'ar' ? 'rtl' : 'ltr';
    const key = h.dataset.title;
    if (key) document.title = t(key);
    const d = $('meta[name=description]'); if (d) d.content = t('meta.desc');
    applyStatic();
  }
  function setLang(l, silent) {
    if (l !== 'ar' && l !== 'en') return;
    lang = l;
    LS.set('revive_lang', l);
    document.cookie = `lang=${l};path=/;max-age=31536000;samesite=lax`;
    applyDocument();
    if (!silent) listeners.forEach(f => f(l));
  }
  const onLang = f => listeners.push(f);
  document.addEventListener('click', e => {
    if (e.target.closest('[data-lang-toggle]')) setLang(lang === 'ar' ? 'en' : 'ar');
  });

  /* ---------- API ---------- */
  async function api(u, o = {}) {
    o.headers = { ...(o.headers || {}), 'X-Lang': lang };
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

  /* ---------- Toast ---------- */
  let tt;
  function toast(msg, ok = true) {
    let el = $('#t');
    if (!el) { el = document.createElement('div'); el.id = 't'; document.body.appendChild(el); }
    el.innerHTML = `${window.ic(ok ? 'check-circle' : 'alert-circle')}<span>${esc(msg)}</span>`;
    el.className = 'show ' + (ok ? 'ok' : 'er');
    el.setAttribute('role', ok ? 'status' : 'alert');
    clearTimeout(tt); tt = setTimeout(() => { el.className = ''; }, 3600);
  }

  window.Revive = {
    $, $$, esc, t, api, post, toast, LS, onLang, setLang, applyStatic, ic: (...a) => window.ic(...a),
    get lang() { return lang; },
    numberFmt: n => Number(n || 0).toLocaleString(lang === 'ar' ? 'ar-SA-u-nu-latn' : 'en-US'),
    init() { setLang(lang, true); }
  };
})();
