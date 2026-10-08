/* لوحة التحكم | Dashboard app
   - الأقسام معرّفة في SCHEMA، وكل النصوص من i18n.js (عربي/English)
   - التنقل عبر #hash، حفظ آخر سيرفر، تتبع التغييرات غير المحفوظة، Ctrl+S */
(function () {
  'use strict';
  const { $, $$, esc, t, api, post, toast, LS, onLang, numberFmt } = Revive;

  /* القيم المخزّنة يقرأها البوت بالعربي، لذلك نبقيها كما هي ونترجم العرض فقط */
  const CO = ['أزرق', 'أخضر', 'أحمر', 'أصفر', 'بنفسجي', 'برتقالي', 'أبيض', 'أسود'];
  const EM = ['ايمبد عادي', 'ايمبد حديث'];
  const NUM10 = Array.from({ length: 10 }, (_, i) => String(i + 1));
  const INTERVALS = [5, 10, 15, 30, 45];

  /* ---------- تعريف الأقسام: [المفتاح، النوع، إضافي] ---------- */
  const SCHEMA = {
    welcome: { icon: 'user-plus', slots: ['1', '2'], slotNames: 'tabs', vars: ['{server}', '{user}', '{count}'], f: [['channel_id', 'ch'], ['color', 'sel', 'colors'], ['embed_type', 'sel', 'embeds'], ['image_url', 'tx'], ['embed_text', 'ta'], ['outside_text', 'ta'], ['show_avatar', 'bo'], ['ignore_bots', 'bo'], ['disable_mention', 'bo'], ['status', 'bo']] },
    tickets: { icon: 'ticket', slots: NUM10, modes: true, f: [['name', 'tx'], ['category_id', 'cat'], ['support_role_id', 'rl'], ['ticket_mod_role_id', 'rl'], ['log_channel_id', 'ch'], ['rating_channel_id', 'ch'], ['image_url', 'tx'], ['welcome_msg', 'ta']] },
    apply: { icon: 'clipboard', slots: NUM10, modes: true, f: [['name', 'tx'], ['admin_role_id', 'rl'], ['review_channel_id', 'ch'], ['given1', 'rl'], ['given2', 'rl'], ['removed_role_id', 'rl'], ['accept_msg', 'ta'], ['reject_msg', 'ta'], ['questions', 'qs']] },
    rolestatus: { icon: 'activity', f: [['panel_channel_id', 'ch'], ['channel_id', 'ch'], ['ping_role_id', 'rl'], ['manager_role_id', 'rl'], ['start_msg', 'ta'], ['end_msg', 'ta'], ['vote_msg', 'ta']] },
    identity: { icon: 'id-card', f: [['panel_channel_id', 'ch'], ['admins_channel_id', 'ch'], ['add_role_id', 'rl'], ['rem_role_id', 'rl'], ['change_nick', 'bo', true]] },
    weapons: { icon: 'crosshair', f: [['panel_channel', 'ch'], ['log_channel', 'ch']] },
    traffic: { icon: 'traffic', f: [['police_role', 'rl'], ['control_channel', 'ch'], ['citizen_channel', 'ch'], ['log_channel', 'ch']] },
    bank: { icon: 'landmark', f: [['account_panel_channel_id', 'ch'], ['citizens_panel_channel_id', 'ch'], ['staff_panel_channel_id', 'ch'], ['loan_channel_id', 'ch'], ['log_channel_id', 'ch'], ['bank_staff_role_id', 'rl']] },
    realestate: { icon: 'building', f: [['citizen_channel', 'ch'], ['admin_channel', 'ch'], ['requests_channel', 'ch'], ['market_channel', 'ch'], ['logs_channel', 'ch']] },
    activation: { icon: 'check-circle', f: [['panel_channel_id', 'ch'], ['staff_channel_id', 'ch'], ['staff_role_id', 'rl'], ['add_role_id', 'rl'], ['remove_role_id', 'rl']] },
    replies: { icon: 'message', f: [['items', 'ar']] },
    autorole: { icon: 'tag', f: [['role_id', 'rl']] },
    shortcuts: { icon: 'bolt', f: [['items', 'sc']] },
    logs: { icon: 'logs', f: [['logs', 'lg']] },
    security: { icon: 'shield', f: [['sec', 'sec']] },
    badwords: { icon: 'ban', f: [['words', 'bw'], ['punishment', 'pn']] },
    azkar: { icon: 'moon', f: [['channel_id', 'ch'], ['interval', 'interval'], ['status', 'bo']] },
    levels: { icon: 'trending', vars: ['{user}', '{level}', '{next-level}', '{xp}'], f: [['channel_id', 'ch'], ['message', 'ta']] },
    embed: { icon: 'send', f: [['channel_id', 'ch'], ['color', 'sel', 'colors'], ['title', 'tx'], ['description', 'ta'], ['image_url', 'tx'], ['outside_text', 'ta']] }
  };
  const CUSTOM = { home: 'home', language: 'globe', stats: 'chart', rate: 'star' };
  const NAV_GROUPS = [
    ['rp', ['rolestatus', 'identity', 'weapons', 'traffic', 'bank', 'realestate']],
    ['admin', ['tickets', 'apply', 'activation', 'welcome', 'autorole', 'replies', 'shortcuts', 'embed', 'logs', 'azkar', 'levels']],
    ['sec', ['security', 'badwords']]
  ];
  const WIDE = ['ta', 'qs', 'ar', 'sc', 'lg', 'sec', 'bw'];
  const LOG_TYPES = { members_join_remove: 'log-in', member_bans: 'hammer', member_kick: 'user-x', member_timeout: 'clock', member_roles: 'tag', messages: 'message-x', reactions: 'smile', channels_crud: 'folder-plus', channels_update: 'folder-edit', roles_crud: 'tag-plus', roles_update: 'tag', server_updates: 'settings' };
  const SEC_FEATS = { bot_add: 'bot', admin_role: 'crown', mass_ban: 'hammer', mass_kick: 'user-x', channel_delete: 'folder-x', role_delete: 'trash', role_create: 'tag-plus', channel_create: 'folder-plus', links: 'link' };
  const PUN = ['timeout', 'kick', 'ban', 'strip_roles'];
  const SC_ICONS = { ban: 'hammer', kick: 'user-x', toggle_role: 'tag', timeout: 'clock', untimeout: 'timer-off', nickname: 'pencil', clear: 'trash', warn: 'warn', unban: 'unlock' };
  const PANELS = { tickets: { list: 'tickets/list', send: 'ticket-panel' }, apply: { list: 'apply/list', send: 'apply-panel' } };

  /* ---------- الحالة ---------- */
  let gid = '', cur = 'home', slot = '', meta = null, data = {}, me = null, guilds = [];
  let tmode = 'setup', lastS = '', dirty = false, token = 0, suppress = false, panelDraft = null;
  const main = $('#main');

  const has = p => t(p) !== p;
  const guildName = () => ($('#g').selectedOptions[0] || {}).text || '';
  const secName = k => (SCHEMA[k] ? t(`sec.${k}.n`) : k === 'home' ? t('ui.home') : k === 'language' ? t('ui.language') : k === 'stats' ? t('ui.stats') : t('rate.title'));
  const iconOf = k => (SCHEMA[k] ? SCHEMA[k].icon : CUSTOM[k]);
  const opt = (l, v, s) => `<option value="${esc(v)}" ${String(v) === String(s ?? '') ? 'selected' : ''}>${esc(l)}</option>`;
  const header = (icon, title, sub) => `<div class="ph"><span class="pi">${ic(icon)}</span><div><h1>${esc(title)}</h1><small>${esc(sub ?? guildName())}</small></div></div>`;
  const skeleton = () => '<div class="skel h1"></div><div class="skel h2"></div><div class="skel h3"></div>';
  function stagger() {
    [...main.children].forEach((c, i) => c.style.setProperty('--i', i));
    $$('#form > .f', main).forEach((c, i) => c.style.setProperty('--i', i));
  }
  function countUp(el, to) {
    const reduce = matchMedia('(prefers-reduced-motion:reduce)').matches;
    if (reduce) { el.textContent = numberFmt(to); return; }
    let t0 = null;
    const step = ts => { if (!t0) t0 = ts; const p = Math.min((ts - t0) / 1300, 1); el.textContent = numberFmt(Math.round(to * (1 - Math.pow(1 - p, 4)))); if (p < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }

  /* ---------- التغييرات غير المحفوظة ---------- */
  function setDirty(v) { dirty = v; const b = $('.savebar'); if (b) b.classList.toggle('dirty-on', v); }
  const markDirty = () => { if (!dirty) setDirty(true); };
  function guard() {
    if (!dirty) return true;
    if (confirm(t('c.unsaved'))) { setDirty(false); return true; }
    return false;
  }
  addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
  addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { const b = $('#sv'); if (b) { e.preventDefault(); b.click(); } }
    if (e.key === 'Escape') closeModal();
  });

  /* ---------- القائمة الجانبية ---------- */
  function renderNav() {
    const link = k => `<a href="#${k}" data-s="${k}" class="${k === cur ? 'on' : ''}">${ic(iconOf(k))}<span>${esc(secName(k))}</span></a>`;
    $('#nav').innerHTML = link('home') + link('language') + link('stats') +
      NAV_GROUPS.map(([g, ks]) => `<div class="ng">${esc(t('ui.groups.' + g))}</div>` + ks.map(link).join('')).join('') +
      `<div class="ng">${esc(t('ui.groups.reviews'))}</div>` + link('rate') + `<div class="nav-empty" hidden>${esc(t('ui.noResults'))}</div>`;
    filterNav();
  }
  function filterNav() {
    const q = $('#ns').value.trim().toLowerCase(); let any = false;
    const kids = [...$('#nav').children];
    kids.forEach(el => { if (el.tagName === 'A') { const show = !q || el.textContent.toLowerCase().includes(q); el.classList.toggle('hide', !show); if (show) any = true; } });
    kids.forEach((el, i) => {
      if (!el.classList.contains('ng')) return;
      let vis = false;
      for (let j = i + 1; j < kids.length && !kids[j].classList.contains('ng'); j++) if (kids[j].tagName === 'A' && !kids[j].classList.contains('hide')) vis = true;
      el.classList.toggle('hide', !vis);
    });
    const e = $('#nav .nav-empty'); if (e) e.hidden = any;
  }
  const markNav = k => $$('#nav a').forEach(a => a.classList.toggle('on', a.dataset.s === k));
  const closeMenu = () => document.body.classList.remove('open');

  /* ---------- التوجيه ---------- */
  const hashSection = () => { const h = decodeURIComponent(location.hash.slice(1)); return SCHEMA[h] || CUSTOM[h] ? h : 'home'; };
  function route() {
    if (suppress) { suppress = false; return; }
    const s = hashSection();
    if (s === cur && main.children.length) return;
    if (!guard()) { suppress = true; location.hash = '#' + cur; return; }
    pick(s);
  }

  async function pick(s, sl) {
    const tk = ++token;
    if (s !== lastS) { tmode = 'setup'; lastS = s; panelDraft = null; }
    cur = s; markNav(s); closeMenu(); setDirty(false);
    if (s === 'language') return drawLanguage();
    if (s === 'rate') return drawRate();
    if (s === 'stats') return drawStats();
    if (s === 'home') return drawHome();
    if (!gid) return drawNoServers();
    const c = SCHEMA[s];
    slot = sl || (c.slots ? c.slots[0] : '');
    if (c.modes && tmode === 'panel') return drawPanel();
    main.innerHTML = skeleton(); stagger();
    try { data = await api(`/api/guilds/${gid}/settings/${s}?slot=${slot}`); }
    catch (e) { if (tk !== token) return; toast(e.message, false); return drawError(e.message); }
    if (tk !== token) return;
    draw();
  }

  /* ---------- حالات فارغة ---------- */
  function drawNoServers() {
    main.innerHTML = `<div class="card block empty-state">${ic('server')}<p>${esc(t('ui.noServers'))}</p><a class="btn" href="/invite" target="_blank" rel="noopener">${ic('bot')}<span>${esc(t('ui.addBot'))}</span></a></div>`;
    stagger();
  }
  function drawError(msg) {
    main.innerHTML = `${header(iconOf(cur), secName(cur))}<div class="card block empty-state">${ic('alert-circle')}<p>${esc(msg)}</p><button class="btn" id="retry">${ic('activity')}<span>${esc(t('c.retry'))}</span></button></div>`;
    $('#retry').onclick = () => pick(cur, slot); stagger();
  }

  /* ---------- الرئيسية ---------- */
  async function drawHome() {
    const tk = token;
    main.innerHTML = skeleton(); stagger();
    const [st, si] = await Promise.all([api('/api/stats').catch(() => null), api('/api/site-info').catch(() => null)]);
    if (tk !== token) return;
    const tiles = [
      ['server', t('ui.yourServers'), `<span class="cnt" data-to="${guilds.length}">0</span>`],
      ['globe', t('ui.allServers'), `<span class="cnt" data-to="${st ? st.guilds : 0}">0</span>`],
      ['server', t('ui.currentServer'), esc(guildName() || '—')],
      ['code', t('ui.developer'), `<span dir="ltr">${esc(si && si.creator ? si.creator.username : '—')}</span>`],
      ['calendar', t('ui.botCreated'), `<span dir="ltr">${esc((si && si.created_at) || t('c.unknown'))}</span>`]
    ];
    const keys = [...NAV_GROUPS.flatMap(g => g[1]), 'language', 'stats', 'rate'];
    main.innerHTML = `<div class="hello"><img src="${esc(me.avatar)}" alt=""><div><h1>${esc(t('ui.hello', { name: me.global_name || me.name }))}</h1><p>${esc(t('ui.helloSub'))}</p></div></div>
    <div class="tiles">${tiles.map(([i, l, v], n) => `<div class="tile" style="--i:${n}"><span class="ti">${ic(i)}</span><div><b>${v}</b><small>${esc(l)}</small></div></div>`).join('')}</div>
    <h2 class="sect-title">${ic('bolt')}${esc(t('ui.quick'))}</h2>
    <div class="quick">${keys.map((k, n) => `<a href="#${k}" style="--i:${n}"><span class="qi">${ic(iconOf(k))}</span>${esc(secName(k))}</a>`).join('')}</div>`;
    $$('.cnt', main).forEach(el => countUp(el, +el.dataset.to));
    stagger();
  }

  async function drawStats() {
    let d; try { d = await api('/api/stats'); } catch (e) { return toast(e.message, false); }
    main.innerHTML = `${header('chart', t('stats.title'), t('stats.sub'))}<div><div class="stat-box"><div class="stat-num">0</div><div class="stat-label">${esc(t('stats.servers'))}</div></div><p class="stat-sub">${esc(t('stats.text'))}</p></div>`;
    countUp($('.stat-num', main), Number(d.guilds || 0)); stagger();
  }

  function drawLanguage() {
    const L = Revive.lang;
    main.innerHTML = `${header('globe', t('lang.title'), t('lang.sub'))}<div class="card block" style="text-align:center"><h2 style="margin:0 0 18px">${esc(t('lang.heading'))}</h2>
      <div class="lang-pick"><button data-lang="ar" class="${L === 'ar' ? 'on' : ''}"><b>AR</b>${esc(t('lang.ar'))}</button><button data-lang="en" class="${L === 'en' ? 'on' : ''}"><b>EN</b>${esc(t('lang.en'))}</button></div></div>`;
    $$('.lang-pick button', main).forEach(b => b.onclick = () => { Revive.setLang(b.dataset.lang); toast(t('lang.saved')); });
    stagger();
  }

  async function drawRate() {
    let d; try { d = await api('/api/rating'); } catch (e) { return toast(e.message, false); }
    let st = d.mine ? d.mine.stars : 0;
    main.innerHTML = `${header('star', t('rate.title'), t('rate.sub'))}
    <div class="card block" style="text-align:center"><div class="avg">${d.count ? t('rate.avg', { avg: `<b>${d.avg}</b>`, count: d.count }) : esc(t('rate.first'))}</div>
    <div class="stars" id="stars">${[1, 2, 3, 4, 5].map(n => `<button type="button" data-n="${n}" aria-label="${n}">${ic('star')}</button>`).join('')}</div>
    <div class="f" style="text-align:start"><label>${esc(t('rate.comment'))}</label><textarea id="rc" rows="4" maxlength="500" placeholder="${esc(t('rate.ph'))}">${esc(d.mine ? d.mine.comment : '')}</textarea></div></div>
    <div class="savebar"><button class="btn" id="sv">${ic('send')}<span>${esc(d.mine ? t('rate.update') : t('rate.submit'))}</span></button></div>`;
    const paint = () => $$('#stars button').forEach(b => b.classList.toggle('on', +b.dataset.n <= st)); paint();
    $('#stars').onclick = e => { const b = e.target.closest('button'); if (b) { st = +b.dataset.n; paint(); } };
    $('#sv').onclick = async () => {
      if (!st) return toast(t('rate.pick'), false);
      try { await post('/api/rating', { stars: st, comment: $('#rc').value }); toast(t('rate.thanks')); drawRate(); } catch (e) { toast(e.message, false); }
    };
    stagger();
  }

  /* ---------- الحقول ---------- */
  const fieldLabel = k => { const p = `sec.${cur}.f.${k}`; return has(p) ? t(p) : k; };
  const chOpts = (arr, v) => `<option value="">${esc(t('c.none'))}</option>` + arr.map(o => opt(o.name, o.id, v)).join('');

  const arRow = x => `<div class="ar-row"><input class="k" placeholder="${esc(t('sec.replies.kw'))}" value="${esc(x.keyword)}"><select class="m"><option value="contains" ${x.match_type !== 'exact' ? 'selected' : ''}>${esc(t('sec.replies.contains'))}</option><option value="exact" ${x.match_type === 'exact' ? 'selected' : ''}>${esc(t('sec.replies.exact'))}</option></select><textarea class="r" rows="2" placeholder="${esc(t('sec.replies.resp'))}">${esc(x.response)}</textarea><div class="mn"><span>${esc(t('sec.replies.mention'))}</span><label class="sw"><input type="checkbox" class="c" ${x.mention ? 'checked' : ''}><i></i></label></div><button type="button" class="btn danger sm" data-act="delReply">${ic('trash')}<span>${esc(t('c.del'))}</span></button></div>`;
  const bwChip = w => `<span class="cw" data-w="${esc(w)}">${esc(w)}<button type="button" data-act="bwDel" aria-label="${esc(t('c.del'))}">${ic('x')}</button></span>`;
  const scChip = x => `<span class="sc-chip" data-name="${esc(x.name)}" data-enabled="${x.enabled !== false ? '1' : '0'}">${esc(x.name)}<button type="button" class="sc-x" aria-label="${esc(t('sec.shortcuts.remove'))}">${ic('x')}</button></span>`;
  const scLabel = target => (has(`sec.shortcuts.actions.${target}`) ? t(`sec.shortcuts.actions.${target}`) : target || '');
  const scGroup = (target, items = []) => `<div class="sc-group" data-target="${esc(target)}"><div class="sc-head"><div class="sc-head-main"><div class="sc-head-icon">${ic(SC_ICONS[target] || 'bolt')}</div><div><b>${esc(target)}/</b><small>${esc(scLabel(target))}</small></div></div><button type="button" class="sc-edit" data-act="scEdit" title="${esc(t('sec.shortcuts.edit'))}" aria-label="${esc(t('sec.shortcuts.edit'))}">${ic('pencil')}</button></div>${items.length ? `<div class="sc-chips">${items.map(scChip).join('')}</div>` : `<div class="sc-empty">${esc(t('sec.shortcuts.empty'))}</div>`}</div>`;
  function groupedShortcuts(items) {
    const m = new Map();
    (items || []).forEach(x => { const k = (x.target || '').trim().replace(/^\//, ''); if (!k) return; if (!m.has(k)) m.set(k, []); m.get(k).push(x); });
    const known = Object.keys(SC_ICONS);
    return [...known, ...[...m.keys()].filter(k => !known.includes(k))].map(k => scGroup(k, m.get(k) || [])).join('');
  }

  function fld([k, type, x]) {
    const v = data[k]; let h = '';
    if (type === 'tx') h = `<input data-k="${k}" value="${esc(v)}" ${/url|image/.test(k) ? 'dir="ltr"' : ''}>`;
    else if (type === 'ta') h = `<textarea data-k="${k}" rows="4">${esc(v)}</textarea>`;
    else if (type === 'bo') h = `<label class="sw"><input type="checkbox" data-k="${k}" ${(v ?? x ?? 0) ? 'checked' : ''}><i></i></label>`;
    else if (type === 'qs') h = [...(v || []), '', '', '', '', ''].slice(0, 5).map(z => `<input class="q" maxlength="45" placeholder="${esc(t(`sec.${cur}.qph`))}" value="${esc(z)}">`).join('');
    else if (type === 'ar') h = data.legacy ? `<p class="nt">${esc(t('sec.replies.legacy'))}</p>` : `<div class="ar">${(v || []).map(arRow).join('')}</div><div class="empty" ${(v || []).length ? 'hidden' : ''} id="ar-empty">${esc(t('sec.replies.empty'))}</div><button type="button" class="btn sm" data-act="addReply">${ic('plus')}<span>${esc(t('sec.replies.add'))}</span></button>`;
    else if (type === 'sc') h = `<div class="sc">${groupedShortcuts(v || [])}</div>`;
    else if (type === 'lg') h = `<div class="lgtop"><select id="lgall"><option value="">${esc(t('sec.logs.pick'))}</option>${meta.channels.map(o => opt('# ' + o.name, o.id, '')).join('')}</select><button type="button" class="btn sm" data-act="lgApply">${ic('check')}<span>${esc(t('sec.logs.apply'))}</span></button><button type="button" class="btn danger sm" data-act="lgClear">${ic('trash')}<span>${esc(t('sec.logs.clear'))}</span></button></div>` +
      Object.entries(LOG_TYPES).map(([c, i]) => `<div class="lg-row"><div class="rowname"><span class="ri">${ic(i)}</span>${esc(t('sec.logs.types.' + c))}</div><select data-k="${c}"><option value="">${esc(t('sec.logs.off'))}</option>${meta.channels.map(o => opt('# ' + o.name, o.id, data[c])).join('')}</select><button type="button" class="btn danger sm icon" data-act="lgDel" aria-label="${esc(t('c.del'))}">${ic('trash')}</button></div>`).join('');
    else if (type === 'sec') h = Object.entries(SEC_FEATS).map(([f, i]) => { const [n, d, dev] = t(`sec.security.feats.${f}`); return `<div class="sec-row"><div><div class="rowname"><span class="ri">${ic(i)}</span><span>${esc(n)}${dev ? `<span class="dev">${esc(dev)}</span>` : ''}</span></div><small>${esc(d || '')}</small></div><label class="sw"><input type="checkbox" data-k="${f}__on" ${data[f + '__on'] ? 'checked' : ''}><i></i></label><select data-k="${f}__p">${PUN.map(p => opt(t('pun.' + p), p, data[f + '__p'] || 'timeout')).join('')}</select></div>`; }).join('');
    else if (type === 'bw') h = `<div class="bw-add"><input id="bwin" placeholder="${esc(t('sec.badwords.ph'))}" maxlength="100"><button type="button" class="btn sm" data-act="bwAdd">${ic('plus')}<span>${esc(t('sec.badwords.add'))}</span></button></div><div class="bw">${(v || []).map(bwChip).join('')}</div>`;
    else if (type === 'pn') h = `<select data-k="${k}">${PUN.map(p => opt(t('pun.' + p), p, v || 'timeout')).join('')}</select>`;
    else if (type === 'interval') h = `<select data-k="${k}">${INTERVALS.map(n => opt(t(n <= 10 ? 'opt.minutesFew' : 'opt.minutes', { n }), n, v || 15)).join('')}</select>`;
    else if (type === 'sel') { const vals = x === 'colors' ? CO : EM, labels = t('opt.' + x); h = `<select data-k="${k}">${vals.map((val, i) => opt(labels[i], val, v)).join('')}</select>`; }
    else { const L = type === 'ch' ? meta.channels.map(o => ({ id: o.id, name: '# ' + o.name })) : type === 'rl' ? meta.roles : meta.categories; h = `<select data-k="${k}">${chOpts(L, v)}</select>`; }
    return `<div class="f ${WIDE.includes(type) ? 'w' : ''} ${type === 'bo' ? 'bo' : ''}"><label>${esc(fieldLabel(k))}</label>${h}</div>`;
  }

  function noteHtml(c) {
    const title = has(`sec.${cur}.noteTitle`) ? t(`sec.${cur}.noteTitle`) : '', text = has(`sec.${cur}.note`) ? t(`sec.${cur}.note`) : '';
    if (!title && !text) return '';
    const vars = c.vars ? `<ul>${c.vars.map((code, i) => `<li><code>${esc(code)}</code> = ${esc(t(`sec.${cur}.vars`)[i])}</li>`).join('')}</ul>` : '';
    return `<div class="note">${ic(cur === 'security' || cur === 'badwords' ? 'warn' : 'info')}<div>${title ? `<b>${esc(title)}</b>` : ''}${text ? `<div>${esc(text)}</div>` : ''}${vars}</div></div>`;
  }

  const modeBar = c => `<div class="tabs modes">${t(`sec.${cur}.modes`).map((l, i) => { const k = i ? 'panel' : 'setup'; return `<button data-m="${k}" class="${k === tmode ? 'on' : ''}">${ic(i ? 'send' : 'settings')}${esc(l)}</button>`; }).join('')}</div>`;
  const slotName = (c, k, i) => (c.slotNames ? t(`sec.${cur}.${c.slotNames}`)[i] : t('slot', { n: k }));

  function draw() {
    const c = SCHEMA[cur];
    const label = cur === 'embed' ? t('sec.embed.btn') : t('c.save');
    main.innerHTML = `${header(c.icon, t(`sec.${cur}.n`))}
    ${c.modes ? modeBar(c) : ''}
    ${c.slots ? `<div class="tabs">${c.slots.map((k, i) => `<button data-t="${k}" class="${k === slot ? 'on' : ''}">${esc(slotName(c, k, i))}</button>`).join('')}</div>` : ''}
    <div class="card" id="form">${c.f.map(fld).join('')}</div>
    ${noteHtml(c)}
    <div class="savebar"><span class="dirty">${esc(t('c.unsavedBadge'))}</span><button class="btn" id="sv">${ic(cur === 'embed' ? 'send' : 'save')}<span>${esc(label)}</span></button></div>
    <div class="kbd-hint">${esc(t('c.hint'))}</div>`;
    $('#sv').onclick = save;
    $$('.tabs button[data-t]', main).forEach(b => b.onclick = () => { if (b.dataset.t === slot || !guard()) return; pick(cur, b.dataset.t); });
    $$('.modes button', main).forEach(b => b.onclick = () => { if (b.dataset.m === tmode || !guard()) return; tmode = b.dataset.m; pick(cur); });
    wireForm(); syncRows(); stagger();
  }

  /* ---------- أحداث النموذج (تفويض واحد) ---------- */
  function syncRows() {
    $$('#form .lg-row').forEach(r => r.classList.toggle('on', !!r.querySelector('select').value));
    $$('#form .sec-row').forEach(r => r.classList.toggle('on', r.querySelector('input').checked));
  }
  function arEmpty() { const e = $('#ar-empty'); if (e) e.hidden = $$('#form .ar-row:not(.leaving)').length > 0; }
  const ACTIONS = {
    addReply() { $('#form .ar').insertAdjacentHTML('beforeend', arRow({})); arEmpty(); markDirty(); $('#form .ar-row:last-child .k').focus(); },
    delReply(b) { const r = b.closest('.ar-row'); r.classList.add('leaving'); setTimeout(() => { r.remove(); arEmpty(); }, 280); markDirty(); },
    lgApply() { const v = $('#lgall').value; if (!v) return toast(t('sec.logs.pickFirst'), false); $$('#form .lg-row select').forEach(s => { s.value = v; }); syncRows(); markDirty(); },
    lgClear() { $$('#form .lg-row select').forEach(s => { s.value = ''; }); syncRows(); markDirty(); },
    lgDel(b) { b.closest('.lg-row').querySelector('select').value = ''; syncRows(); markDirty(); },
    bwAdd() {
      const i = $('#bwin'), w = i.value.trim().toLowerCase(); if (!w) return;
      if (w.length < 2) return toast(t('sec.badwords.min'), false);
      if (!$$('#form .cw').some(x => x.dataset.w === w)) { $('#form .bw').insertAdjacentHTML('beforeend', bwChip(w)); markDirty(); }
      i.value = ''; i.focus();
    },
    bwDel(b) { b.closest('.cw').remove(); markDirty(); },
    scEdit(b) { openShortcutModal(b.closest('.sc-group')); }
  };
  function wireForm() {
    const form = $('#form'); if (!form) return;
    form.addEventListener('click', e => {
      const b = e.target.closest('[data-act]'); if (b && ACTIONS[b.dataset.act]) { e.preventDefault(); ACTIONS[b.dataset.act](b); return; }
      const x = e.target.closest('.sc-x'); if (x) { x.closest('.sc-chip').remove(); markDirty(); }
    });
    form.addEventListener('input', e => { markDirty(); const f = e.target.closest('.f.err'); if (f) f.classList.remove('err'); });
    form.addEventListener('change', () => { syncRows(); markDirty(); });
    const bwin = $('#bwin'); if (bwin) bwin.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ACTIONS.bwAdd(); } });
  }

  /* ---------- نافذة الاختصارات ---------- */
  let modal = null, modalTarget = '';
  function openShortcutModal(group) {
    closeModal(); modalTarget = group.dataset.target;
    modal = document.createElement('div'); modal.className = 'modal';
    modal.innerHTML = `<div class="modal-box" role="dialog" aria-modal="true"><div class="modal-head"><h3>${esc(t('sec.shortcuts.modalTitle'))}</h3><p>${esc(t('sec.shortcuts.modalHint'))}</p></div>
      <div class="modal-body"><div class="cmdbox">${esc(modalTarget)}/</div><label>${esc(t('sec.shortcuts.label'))}</label><div class="alias-editor" id="mal"><input id="mal-in" placeholder="${esc(t('sec.shortcuts.ph'))}"></div></div>
      <div class="modal-actions"><button type="button" class="btn sm" id="mal-save">${ic('check')}<span>${esc(t('sec.shortcuts.save'))}</span></button><button type="button" class="btn ghost sm" id="mal-close">${esc(t('c.cancel'))}</button></div></div>`;
    document.body.appendChild(modal);
    const box = $('#mal', modal);
    $$('.sc-chip', group).forEach(ch => box.insertAdjacentHTML('afterbegin', scChip({ name: ch.dataset.name, enabled: ch.dataset.enabled !== '0' })));
    $('#mal-in', modal).onkeydown = e => {
      if (e.key !== 'Enter') return; e.preventDefault();
      const n = e.target.value.trim().toLowerCase().replace(/^[!/.#]+/, ''); e.target.value = '';
      if (!n || /\s/.test(n) || $$('.sc-chip', box).some(x => x.dataset.name === n)) return;
      e.target.insertAdjacentHTML('beforebegin', scChip({ name: n, enabled: true }));
    };
    box.addEventListener('click', e => { const x = e.target.closest('.sc-x'); if (x) x.closest('.sc-chip').remove(); });
    modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
    $('#mal-close', modal).onclick = closeModal;
    $('#mal-save', modal).onclick = async () => {
      const g = $$('#form .sc-group').find(x => x.dataset.target === modalTarget);
      const chips = $$('.sc-chip', box).map(x => x.outerHTML);
      if (g) {
        g.querySelector('.sc-chips')?.remove(); g.querySelector('.sc-empty')?.remove();
        g.insertAdjacentHTML('beforeend', chips.length ? `<div class="sc-chips">${chips.join('')}</div>` : `<div class="sc-empty">${esc(t('sec.shortcuts.empty'))}</div>`);
        markDirty();
      }
      closeModal(); await save();
    };
    setTimeout(() => $('#mal-in', modal)?.focus(), 40);
  }
  function closeModal() { if (modal) { modal.remove(); modal = null; modalTarget = ''; } }

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
  function busy(on, label) {
    const b = $('#sv'); if (!b) return;
    b.classList.toggle('loading', on); b.disabled = on;
    b.firstElementChild.outerHTML = on ? ic('spinner', 'spin') : b.dataset.icon || b.firstElementChild.outerHTML;
    if (label) b.querySelector('span').textContent = label;
  }
  async function save() {
    const b = $('#sv'); if (!b || b.disabled) return;
    const idle = b.querySelector('span').textContent, icon = b.firstElementChild.outerHTML;
    b.dataset.icon = icon; busy(true, t('c.saving'));
    try {
      const r = await post(`/api/guilds/${gid}/settings/${cur}?slot=${slot}`, collect());
      const p = r.panel;
      if (!p || p === 'none') toast(t('c.saved'));
      else if (p === 'sent') toast(cur === 'embed' ? t('sec.embed.ok') : t('c.savedPanel'));
      else if (p === 'unsupported') toast(t('c.panelUnsupported'), false);
      else toast(t('c.panelFail', { e: String(p).slice(6) }), false);
      setDirty(false);
    } catch (e) {
      let m = e.message;
      if (m.startsWith('REQ:')) {
        const k = m.slice(4); m = t('c.reqField', { f: fieldLabel(k) });
        const el = $(`#form [data-k="${k}"]`) || (k === 'questions' ? $('#form .q') : null);
        const f = el && el.closest('.f'); if (f) { f.classList.remove('err'); void f.offsetWidth; f.classList.add('err'); el.focus(); }
      }
      toast(m, false);
    }
    busy(false, idle);
  }

  /* ---------- بانل التذاكر والتقديمات ---------- */
  async function drawPanel() {
    const c = SCHEMA[cur], P = PANELS[cur], w = t(`sec.${cur}.w`), tk = token;
    let list = [];
    try { list = await api(`/api/guilds/${gid}/${P.list}`); } catch (e) { if (tk !== token) return; toast(e.message, false); return drawError(e.message); }
    if (tk !== token) return;
    const d = panelDraft || {};
    main.innerHTML = `${header(c.icon, t(`sec.${cur}.n`))}${modeBar(c)}
    <div class="card" id="form"><div class="f w"><label>${esc(t('panel.title'))}</label><input id="tpt" maxlength="256" value="${esc(d.title)}"></div>
    <div class="f w"><label>${esc(t('panel.desc'))}</label><textarea id="tpd" rows="4">${esc(d.desc)}</textarea></div>
    <div class="f w"><label>${esc(t('panel.image'))}</label><input id="tpi" dir="ltr" value="${esc(d.image)}"></div>
    <div class="f w"><label>${esc(t('panel.channel'))}</label><select id="tpc"><option value="">${esc(t('c.chooseChannel'))}</option>${meta.channels.map(o => opt('# ' + o.name, o.id, d.channel)).join('')}</select></div>
    <div class="f w"><label>${esc(t('panel.display'))}</label><div class="pks" id="tpm"><button type="button" class="pk ${d.display === 'dropdown' ? '' : 'on'}" data-v="buttons">${ic('pointer')}${esc(t('panel.buttons'))}</button><button type="button" class="pk ${d.display === 'dropdown' ? 'on' : ''}" data-v="dropdown">${ic('list')}${esc(t('panel.dropdown'))}</button></div></div>
    <div class="f w"><label>${esc(t('panel.items', { w }))}</label>${list.length ? `<div class="pks" id="tpn">${list.map(x => `<button type="button" class="pk ${d.nums && !d.nums.includes(x.num) ? '' : 'on'}" data-v="${esc(x.num)}">${esc(x.num)} · ${esc(x.name)}</button>`).join('')}</div>` : `<p class="nt">${esc(t('panel.none', { w, tab: t(`sec.${cur}.modes`)[0] }))}</p>`}</div></div>
    <div class="savebar"><button class="btn" id="sv">${ic('send')}<span>${esc(t('panel.send'))}</span></button></div>`;
    $$('.modes button', main).forEach(b => b.onclick = () => { if (b.dataset.m === tmode) return; tmode = b.dataset.m; panelDraft = null; pick(cur); });
    $('#tpm').onclick = e => { const b = e.target.closest('.pk'); if (b) $$('#tpm .pk').forEach(x => x.classList.toggle('on', x === b)); };
    if ($('#tpn')) $('#tpn').onclick = e => { const b = e.target.closest('.pk'); if (b) b.classList.toggle('on'); };
    $('#sv').onclick = async () => {
      const nums = $$('#tpn .pk.on').map(x => x.dataset.v);
      if (!$('#tpt').value.trim()) return toast(t('panel.errTitle'), false);
      if (!$('#tpd').value.trim()) return toast(t('panel.errDesc'), false);
      if (!$('#tpc').value) return toast(t('panel.errChannel'), false);
      if (!nums.length) return toast(t('panel.errItems', { w }), false);
      const b = $('#sv'); b.classList.add('loading'); b.disabled = true;
      try { await post(`/api/guilds/${gid}/send/${P.send}`, { title: $('#tpt').value, desc: $('#tpd').value, image: $('#tpi').value, channel_id: $('#tpc').value, display: $('#tpm .on').dataset.v, nums }); toast(t('panel.ok', { w })); }
      catch (e) { toast(e.message, false); }
      b.classList.remove('loading'); b.disabled = false;
    };
    stagger();
  }
  function snapshotPanel() {
    if (!$('#tpt')) return;
    panelDraft = { title: $('#tpt').value, desc: $('#tpd').value, image: $('#tpi').value, channel: $('#tpc').value, display: ($('#tpm .on') || {}).dataset?.v, nums: $('#tpn') ? $$('#tpn .pk.on').map(x => x.dataset.v) : null };
  }

  /* ---------- تغيير السيرفر / اللغة ---------- */
  async function loadMeta() {
    meta = await api(`/api/guilds/${gid}/meta`);
  }
  async function changeGuild() {
    const sel = $('#g');
    if (!guard()) { sel.value = gid; return; }
    gid = sel.value; LS.set('revive_guild', gid);
    try { await loadMeta(); } catch (e) { toast(e.message, false); }
    pick(cur, slot);
  }
  onLang(() => {
    const form = $('#form');
    const keep = form && SCHEMA[cur] && !(SCHEMA[cur].modes && tmode === 'panel');
    if (keep) data = { ...data, ...collect() };
    if (SCHEMA[cur] && SCHEMA[cur].modes && tmode === 'panel') snapshotPanel();
    const wasDirty = dirty;
    renderNav(); $('#nav').scrollTop = 0;
    if (keep) { draw(); setDirty(wasDirty); }
    else if (SCHEMA[cur]) pick(cur, slot);
    else pick(cur);
  });

  /* ---------- البدء ---------- */
  async function start() {
    Revive.init();
    $('#mb').onclick = () => document.body.classList.toggle('open');
    $('#ov').onclick = closeMenu;
    $('#ns').addEventListener('input', filterNav);
    $('#g').onchange = changeGuild;
    $('#nav').addEventListener('click', e => { if (e.target.closest('a')) closeMenu(); });
    addEventListener('hashchange', route);

    try { me = await api('/api/me'); } catch { return; }
    $('#uav').src = me.avatar; $('#unm').textContent = me.global_name || me.name; $('#uc').hidden = false;
    try { guilds = await api('/api/guilds'); } catch (e) { toast(e.message, false); guilds = []; }
    $('#g').innerHTML = guilds.map(x => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('');
    const saved = LS.get('revive_guild');
    gid = guilds.find(x => x.id === saved) ? saved : (guilds[0] ? guilds[0].id : '');
    if (gid) { $('#g').value = gid; try { await loadMeta(); } catch (e) { toast(e.message, false); } }
    renderNav();
    pick(hashSection());
  }
  start();
})();
