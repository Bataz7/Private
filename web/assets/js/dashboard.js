/* لوحة التحكم | Dashboard — السيرفر (TSX) يبني كل قسم كـ HTML (/ui/view/<قسم>) وهذا الملف يتولى التفاعل فقط:
   التنقل، تتبع التغييرات، الحفظ، صفوف الردود/الكلمات/الاختصارات، المعاينة، الثيمات. */
(function () {
  'use strict';
  const { $, $$, esc, t, has, api, post, html, toast, LS, cookie, countUp } = Revive;
  const app = $('#app'), main = $('#main');
  let gid = app.dataset.gid, cur = '', dirty = false, token = 0, suppress = false;

  const keys = $$('#nav a').map(a => a.dataset.s);
  const hashKey = () => { const h = decodeURIComponent(location.hash.slice(1)); return keys.includes(h) ? h : 'home'; };
  const skeleton = () => '<div class="skel h1"></div><div class="skel h2"></div><div class="skel h3"></div>';
  const stagger = () => { [...main.children].forEach((c, i) => c.style.setProperty('--i', i)); $$('#form .f', main).forEach((c, i) => c.style.setProperty('--i', i)); };

  /* ---------- التغييرات غير المحفوظة ---------- */
  function setDirty(v) { dirty = v; const b = $('.savebar', main); if (b) b.classList.toggle('dirty-on', v); }
  const markDirty = () => { if (!dirty) setDirty(true); };
  function guard() { if (!dirty) return true; if (confirm(t('c.unsaved'))) { setDirty(false); return true; } return false; }
  Revive.beforeLang = guard;
  addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
  addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { const b = $('#sv', main); if (b) { e.preventDefault(); b.click(); } }
    if (e.key === 'Escape') closeModal();
  });

  /* ---------- القائمة ---------- */
  function filterNav() {
    const q = $('#ns').value.trim().toLowerCase(); let any = false; const kids = [...$('#nav').children];
    kids.forEach(el => { if (el.tagName === 'A') { const show = !q || el.textContent.toLowerCase().includes(q); el.classList.toggle('hide', !show); if (show) any = true; } });
    kids.forEach((el, i) => {
      if (!el.classList.contains('ng')) return; let vis = false;
      for (let j = i + 1; j < kids.length && !kids[j].classList.contains('ng'); j++) if (kids[j].tagName === 'A' && !kids[j].classList.contains('hide')) vis = true;
      el.classList.toggle('hide', !vis);
    });
    $('#nav .nav-empty').hidden = any;
  }
  const markNav = k => $$('#nav a').forEach(a => a.classList.toggle('on', a.dataset.s === k));
  const closeMenu = () => document.body.classList.remove('open');

  /* ---------- التحميل ---------- */
  function route() {
    if (suppress) { suppress = false; return; }
    const k = hashKey();
    if (k === cur && main.children.length) return;
    if (!guard()) { suppress = true; location.hash = '#' + cur; return; }
    load(k);
  }

  async function load(key, opts = {}) {
    const tk = ++token;
    cur = key; markNav(key); closeMenu(); setDirty(false);
    main.innerHTML = skeleton(); stagger();
    const q = new URLSearchParams({ gid: gid || '' });
    if (opts.slot) q.set('slot', opts.slot);
    if (opts.mode) q.set('mode', opts.mode);
    let h;
    try { h = await html(`/ui/view/${key}?${q}`); }
    catch (e) {
      if (tk !== token) return;
      toast(e.message, false);
      main.innerHTML = `<div class="card block empty-state">${ic('alert-circle')}<p>${esc(e.message)}</p><button class="btn" type="button" data-act="retry">${ic('activity')}<span>${esc(t('c.retry'))}</span></button></div>`;
      return stagger();
    }
    if (tk !== token) return;
    main.innerHTML = h; stagger(); after();
  }
  const view = () => $('#view', main);

  function after() {
    const v = view(); if (!v) return;
    const kind = v.dataset.kind;
    $$('[data-countup]', main).forEach(el => countUp(el, +el.dataset.countup));
    if (kind === 'form') { wireForm(); syncRows(); syncMirrors(); }
    else if (kind === 'panel') wirePanel();
    else if (kind === 'themes') wireThemes();
    else if (kind === 'rate') wireRate();
    else if (kind === 'emojis') wireEmojis();
    $$('.tabs button[data-mode]', main).forEach(b => b.onclick = () => { if (b.dataset.mode !== v.dataset.mode && guard()) load(cur, { mode: b.dataset.mode }); });
    $$('.tabs button[data-slot]', main).forEach(b => b.onclick = () => { if (b.dataset.slot !== v.dataset.slot && guard()) load(cur, { slot: b.dataset.slot }); });
  }

  /* ---------- النموذج ---------- */
  function syncRows() {
    $$('#form .lg-row').forEach(r => r.classList.toggle('on', !!r.querySelector('select').value));
    $$('#form .sec-row').forEach(r => r.classList.toggle('on', r.querySelector('input').checked));
  }
  function syncMirrors() {
    const v = view(); if (!v) return;
    const vars = { '{server}': ($('#g').selectedOptions[0] || {}).text || '', '{user}': '@' + (($('.userchip span') || {}).textContent || 'member'), '{count}': Revive.numberFmt(1234) };
    $$('[data-mirror-to]', v).forEach(el => {
      const src = $(`#form [data-mirror="${el.dataset.mirrorTo}"]`);
      let val = src ? src.value : '';
      if (el.dataset.vars) Object.entries(vars).forEach(([k, x]) => { val = val.split(k).join(x); });
      el.textContent = val.trim() || el.dataset.empty || '';
      if (el.dataset.vars) el.hidden = !val.trim() && !el.dataset.empty;
    });
  }
  const tpl = id => ($(`#${id}`, main) || {}).innerHTML || '';
  const arEmpty = () => { const e = $('#ar-empty'); if (e) e.hidden = $$('#form .ar-row:not(.leaving)').length > 0; };
  const ACTIONS = {
    addReply() { $('#form .ar').insertAdjacentHTML('beforeend', tpl('tpl-reply')); arEmpty(); markDirty(); $('#form .ar-row:last-child .k').focus(); },
    delReply(b) { const r = b.closest('.ar-row'); r.classList.add('leaving'); setTimeout(() => { r.remove(); arEmpty(); }, 280); markDirty(); },
    lgApply() { const v = $('#lgall').value; if (!v) return toast(t('sec.logs.pickFirst'), false); $$('#form .lg-row select').forEach(s => { s.value = v; }); syncRows(); markDirty(); },
    lgClear() { $$('#form .lg-row select').forEach(s => { s.value = ''; }); syncRows(); markDirty(); },
    lgDel(b) { b.closest('.lg-row').querySelector('select').value = ''; syncRows(); markDirty(); },
    bwAdd() {
      const i = $('#bwin'), w = i.value.trim().toLowerCase(); if (!w) return;
      if (w.length < 2) return toast(t('sec.badwords.min'), false);
      if (!$$('#form .cw').some(x => x.dataset.w === w)) { $('#form .bw').insertAdjacentHTML('beforeend', tpl('tpl-bw').replace(/__w__/g, esc(w))); markDirty(); }
      i.value = ''; i.focus();
    },
    bwDel(b) { b.closest('.cw').remove(); markDirty(); },
    scEdit(b) { openModal(b.closest('.sc-group')); },
    retry() { load(cur); }
  };
  main.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (b && ACTIONS[b.dataset.act]) { e.preventDefault(); ACTIONS[b.dataset.act](b); return; }
    const x = e.target.closest('#form .sc-x'); if (x) { x.closest('.sc-chip').remove(); markDirty(); }
  });
  function wireForm() {
    const form = $('#form'); if (!form) return;
    form.addEventListener('input', e => { markDirty(); syncMirrors(); const f = e.target.closest('.f.err'); if (f) f.classList.remove('err'); });
    form.addEventListener('change', () => { syncRows(); markDirty(); });
    const bw = $('#bwin'); if (bw) bw.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ACTIONS.bwAdd(); } });
    $('#sv').onclick = save;
  }

  /* ---------- نافذة الاختصارات ---------- */
  let modal = null;
  function openModal(group) {
    closeModal(); const target = group.dataset.target;
    const wrap = document.createElement('div'); wrap.innerHTML = tpl('tpl-modal'); modal = wrap.firstElementChild;
    $('.cmdbox', modal).textContent = target + '/';
    document.body.appendChild(modal);
    const box = $('.alias-editor', modal), input = $('.mal-in', modal);
    $$('.sc-chip', group).forEach(ch => input.insertAdjacentHTML('beforebegin', tpl('tpl-chip').replace(/__n__/g, esc(ch.dataset.name))));
    input.onkeydown = e => {
      if (e.key !== 'Enter') return; e.preventDefault();
      const n = input.value.trim().toLowerCase().replace(/^[!/.#]+/, ''); input.value = '';
      if (!n || /\s/.test(n) || $$('.sc-chip', box).some(x => x.dataset.name === n)) return;
      input.insertAdjacentHTML('beforebegin', tpl('tpl-chip').replace(/__n__/g, esc(n)));
    };
    box.addEventListener('click', e => { const x = e.target.closest('.sc-x'); if (x) x.closest('.sc-chip').remove(); });
    modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
    $('.mal-close', modal).onclick = closeModal;
    $('.mal-save', modal).onclick = async () => {
      const chips = $$('.sc-chip', box).map(x => x.outerHTML);
      group.querySelector('.sc-chips')?.remove(); group.querySelector('.sc-empty')?.remove();
      group.insertAdjacentHTML('beforeend', chips.length ? `<div class="sc-chips">${chips.join('')}</div>` : `<div class="sc-empty">${esc(t('sec.shortcuts.empty'))}</div>`);
      markDirty(); closeModal(); await save();
    };
    setTimeout(() => input.focus(), 40);
  }
  function closeModal() { if (modal) { modal.remove(); modal = null; } }

  /* ---------- الحفظ ---------- */
  function collect() {
    const o = {};
    $$('#form [data-k]').forEach(e => { o[e.dataset.k] = e.type === 'checkbox' ? e.checked : e.value; });
    if ($('#form .q')) o.questions = $$('#form .q').map(e => e.value);
    if ($('#form .bw')) o.words = $$('#form .cw').map(x => x.dataset.w);
    if ($('#form .sc')) o.items = $$('#form .sc .sc-group').flatMap(g => $$('.sc-chip', g).map(ch => ({ name: ch.dataset.name, target: g.dataset.target, enabled: ch.dataset.enabled !== '0' })));
    if ($('#form .ar')) o.items = $$('#form .ar-row:not(.leaving)').map(r => ({ keyword: r.querySelector('.k').value, response: r.querySelector('.r').value, match_type: r.querySelector('.m').value, mention: r.querySelector('.c').checked }));
    return o;
  }
  function busy(b, on, label) {
    b.classList.toggle('loading', on); b.disabled = on;
    b.querySelector('svg').outerHTML = on ? ic('spinner', 'spin') : b.dataset.icon;
    b.querySelector('span').textContent = label;
  }
  async function save() {
    const b = $('#sv', main), v = view(); if (!b || b.disabled) return;
    const idle = b.querySelector('span').textContent; b.dataset.icon = b.querySelector('svg').outerHTML;
    busy(b, true, t('c.saving'));
    try {
      const r = await post(`/api/guilds/${gid}/settings/${cur}?slot=${v.dataset.slot || ''}`, collect()), p = r.panel;
      if (!p || p === 'none') toast(t('c.saved'));
      else if (p === 'sent') toast(cur === 'embed' ? t('sec.embed.ok') : t('c.savedPanel'));
      else if (p === 'unsupported') toast(t('c.panelUnsupported'), false);
      else toast(t('c.panelFail', { e: String(p).slice(6) }), false);
      setDirty(false);
      if (!p || p === 'none' || p === 'sent') Revive.fx && Revive.fx.burst();
    } catch (e) {
      let m = e.message;
      if (m.startsWith('REQ:')) {
        const k = m.slice(4), lp = `sec.${cur}.f.${k}`; m = t('c.reqField', { f: has(lp) ? t(lp) : k });
        const el = $(`#form [data-k="${k}"]`) || (k === 'questions' ? $('#form .q') : null), f = el && el.closest('.f');
        if (f) { f.classList.remove('err'); void f.offsetWidth; f.classList.add('err'); el.focus(); }
      }
      toast(m, false);
    }
    busy(b, false, idle);
  }

  /* ---------- بانل التذاكر والتقديمات ---------- */
  function wirePanel() {
    const v = view(), w = v.dataset.w;
    $('#tpm').onclick = e => { const b = e.target.closest('.pk'); if (b) $$('#tpm .pk').forEach(x => x.classList.toggle('on', x === b)); };
    if ($('#tpn')) $('#tpn').onclick = e => { const b = e.target.closest('.pk'); if (b) b.classList.toggle('on'); };
    $('#sv').onclick = async () => {
      const nums = $$('#tpn .pk.on').map(x => x.dataset.v);
      if (!$('#tpt').value.trim()) return toast(t('panel.errTitle'), false);
      if (!$('#tpd').value.trim()) return toast(t('panel.errDesc'), false);
      if (!$('#tpc').value) return toast(t('panel.errChannel'), false);
      if (!nums.length) return toast(t('panel.errItems', { w }), false);
      const b = $('#sv'); b.classList.add('loading'); b.disabled = true;
      const send = cur === 'tickets' ? 'ticket-panel' : 'apply-panel';
      try { await post(`/api/guilds/${gid}/send/${send}`, { title: $('#tpt').value, desc: $('#tpd').value, image: $('#tpi').value, channel_id: $('#tpc').value, display: $('#tpm .on').dataset.v, nums }); toast(t('panel.ok', { w })); Revive.fx && Revive.fx.burst(); }
      catch (e) { toast(e.message, false); }
      b.classList.remove('loading'); b.disabled = false;
    };
  }

  /* ---------- الثيمات ---------- */
  function wireThemes() {
    const mark = () => $$('.theme-card', main).forEach(x => x.classList.toggle('on', x.dataset.id === Revive.theme)); mark();
    $$('.theme-card', main).forEach(b => b.onclick = e => { Revive.setTheme(b.dataset.id, e); mark(); });
    const sw = $('#fxsw'); sw.checked = !document.documentElement.classList.contains('fx-off');
    sw.onchange = () => Revive.fx.toggle(sw.checked);
  }

  /* ---------- التقييم ---------- */
  function wireRate() {
    let st = +view().dataset.stars || 0;
    const paint = () => $$('#stars button').forEach(b => b.classList.toggle('on', +b.dataset.n <= st)); paint();
    $('#stars').onclick = e => { const b = e.target.closest('button'); if (b) { st = +b.dataset.n; paint(); } };
    $('#sv').onclick = async () => {
      if (!st) return toast(t('rate.pick'), false);
      try { await post('/api/rating', { stars: st, comment: $('#rc').value }); toast(t('rate.thanks')); Revive.fx && Revive.fx.burst(); load('rate'); } catch (e) { toast(e.message, false); }
    };
  }

  /* ---------- الإيموجيات ---------- */
  function wireEmojis() {
    let cat = 'all';
    const apply = () => {
      const q = $('#emo-q').value.trim().toLowerCase(); let n = 0;
      $$('.emo', main).forEach(el => { const ok = (cat === 'all' || el.dataset.cat === cat) && (!q || el.dataset.name.includes(q)); el.hidden = !ok; if (ok) n++; });
      $('.emo-count', main).textContent = t('emo.count', { n });
    };
    $('#emo-q').oninput = apply;
    $$('.emo-cats button', main).forEach(b => b.onclick = () => { cat = b.dataset.cat; $$('.emo-cats button', main).forEach(x => x.classList.toggle('on', x === b)); apply(); });
    $('.emo-grid', main).onclick = e => {
      const el = e.target.closest('.emo'); if (!el) return;
      (navigator.clipboard ? navigator.clipboard.writeText(el.dataset.code) : Promise.reject())
        .then(() => { toast(t('emo.copied') + ' · ' + el.dataset.code); el.classList.remove('copied'); void el.offsetWidth; el.classList.add('copied'); })
        .catch(() => toast(el.dataset.code));
    };
  }

  /* ---------- البدء ---------- */
  $('#mb').onclick = () => document.body.classList.toggle('open');
  $('#ov').onclick = closeMenu;
  $('#ns').addEventListener('input', filterNav);
  $('#nav').addEventListener('click', e => { if (e.target.closest('a')) closeMenu(); });
  $('#g').onchange = () => { const sel = $('#g'); if (!guard()) { sel.value = gid; return; } gid = sel.value; cookie('gid', gid); load(cur || hashKey()); };
  addEventListener('hashchange', route);
  if (gid) cookie('gid', gid);
  load(hashKey());
})();
