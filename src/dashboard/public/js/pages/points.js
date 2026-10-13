import { api, avatar, date, esc, toast } from '../ui.js';
import { ic } from '../icon.js';

// Points: my total and where it came from, the rules, the leaderboard, and (administrators) add or remove points.
const ar = () => { try { return localStorage.getItem('rift-language') === 'ar'; } catch { return false; } };
const T = {
  en: {
    eyebrow: 'RIFT / POINTS', title: 'Points & Leaderboard', sub: 'How many points you have, where they came from, and how to earn more.',
    mine: 'Your points', notStaff: 'You are not on the staff list, so you have no points yet.', from: 'Where they came from',
    rules: 'How to earn points', board: 'Leaderboard', empty: 'No staff yet.', you: 'You',
    adjust: 'Add or remove points', adjustSub: 'The change is saved in the audit log with your reason.', member: 'Staff member', choose: 'Choose…',
    add: 'Add', remove: 'Remove', amount: 'Amount', reason: 'Reason', reasonHint: 'The staff member sees this.', notify: 'Tell them in a DM', save: 'Save',
    recent: 'Recent point changes', none: 'No changes yet.', viewing: 'Viewing', back: 'Show mine', total: 'Total', hint: 'Select a member in the leaderboard to see where their points came from.',
    parts: { shift: 'Shift time', messages: 'Messages on shift', voice: 'Voice on shift', assist: 'Members helped', rating: 'Ratings', modreport: 'Mod reports', complaint: 'Complaints', manual: 'Manual changes & older points' },
    count: { shift: '{n} shifts', assist: '{n} times', rating: '{n} ratings', modreport: '{n} reviewed', complaint: '{n} approved' },
  },
  ar: {
    eyebrow: 'RIFT / النقاط', title: 'النقاط والترتيب', sub: 'كم نقطة عندك، ومن وين جات، وكيف تجمع أكثر.',
    mine: 'نقاطك', notStaff: 'أنت مو في قائمة الستاف، فما عندك نقاط.', from: 'من وين جات',
    rules: 'كيف تجمع نقاط', board: 'الترتيب', empty: 'ما فيه ستاف بعد.', you: 'أنت',
    adjust: 'إضافة أو خصم نقاط', adjustSub: 'التعديل ينحفظ في السجل مع السبب.', member: 'عضو الستاف', choose: 'اختر…',
    add: 'إضافة', remove: 'خصم', amount: 'العدد', reason: 'السبب', reasonHint: 'عضو الستاف يشوف السبب.', notify: 'أرسل له في الخاص', save: 'حفظ',
    recent: 'آخر تغييرات النقاط', none: 'ما فيه تغييرات بعد.', viewing: 'تعرض نقاط', back: 'نقاطي', total: 'المجموع', hint: 'اختر عضو من الترتيب تشوف من وين جت نقاطه.',
    parts: { shift: 'وقت الشفت', messages: 'الرسائل في الشفت', voice: 'الفويس في الشفت', assist: 'مساعدة الأعضاء', rating: 'التقييمات', modreport: 'تقارير المود', complaint: 'الشكاوى', manual: 'تعديلات يدوية ونقاط قديمة' },
    count: { shift: '{n} شفت', assist: '{n} مرة', rating: '{n} تقييم', modreport: '{n} تقرير', complaint: '{n} مقبولة' },
  },
};
const L = (path, vars = {}) => String(path.split('.').reduce((obj, key) => obj?.[key], T[ar() ? 'ar' : 'en']) ?? path.split('.').reduce((obj, key) => obj?.[key], T.en) ?? '').replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? '');
const ICONS = { shift: 'clock', messages: 'message-text', voice: 'activity', assist: 'people', rating: 'star', modreport: 'shield-tick', complaint: 'danger', manual: 'edit-2' };
const signed = n => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');
const partName = key => (T[ar() ? 'ar' : 'en'].parts[key] || T.en.parts[key] || key);

function breakdown(data, who) {
  if (!data) return `<p class="pt-empty">${L('notStaff')}</p>`;
  const parts = data.parts.filter(part => part.points !== 0 || part.count);
  const max = Math.max(1, ...parts.map(part => Math.abs(part.points)));
  return `<div class="pt-total"><b>${data.total}</b><span>${who ? `${L('viewing')} ${esc(who)}` : L('total')}</span></div>
    <h4>${L('from')}</h4>
    <ul class="pt-parts">${parts.length ? parts.map(part => `<li class="${part.points < 0 ? 'neg' : ''}">
      <span class="pt-ic">${ic(ICONS[part.key] || 'star', { size: 16 })}</span>
      <span class="pt-label"><b>${esc(partName(part.key))}</b>${part.count && T.en.count[part.key] ? `<small>${L(`count.${part.key}`, { n: part.count })}</small>` : ''}</span>
      <span class="pt-bar"><i style="width:${Math.round((Math.abs(part.points) / max) * 100)}%"></i></span>
      <em>${signed(part.points)}</em></li>`).join('') : '<li class="pt-empty">—</li>'}</ul>`;
}

export function render(data = {}) {
  const rules = (data.rules || []).map(rule => `<li><em class="${rule.points.startsWith('−') || rule.points === '−' ? 'neg' : rule.points === '±' ? 'mid' : ''}">${esc(rule.points)}</em><span>${esc(ar() ? rule.ar : rule.en)}</span></li>`).join('');
  const me = data.user?.id;
  const board = (data.leaderboard || []).map(row => `<li class="${row.userId === me ? 'is-me' : ''}" ${data.admin ? `data-member="${esc(row.userId)}" tabindex="0" role="button"` : ''}>
      <span class="pt-place p${row.place}">${row.place <= 3 ? ic('medal-star', { size: 20 }) : row.place}</span>${avatar(row.avatar, row.displayName)}
      <span class="pt-name"><b>${esc(row.displayName)}</b>${row.userId === me ? `<small>${L('you')}</small>` : row.rank ? `<small>${esc(row.rank)}</small>` : ''}</span><strong>${row.points}</strong></li>`).join('');
  const adjust = data.admin ? `<section class="panel pt-card"><div class="panel-head"><div><h3>${L('adjust')}</h3><p>${L('adjustSub')}</p></div></div>
      <form class="pt-form" id="pointsForm">
        <label class="ap-field"><span>${L('member')}</span><select name="userId" required><option value="">${L('choose')}</option>${(data.leaderboard || []).filter(row => row.userId !== me).map(row => `<option value="${esc(row.userId)}">${esc(row.displayName)} · ${row.points}</option>`).join('')}</select></label>
        <div class="pt-row"><div class="ap-seg" data-sign><button type="button" data-value="1" aria-pressed="true">${ic('add', { size: 14 })} ${L('add')}</button><button type="button" data-value="-1" aria-pressed="false">${ic('minus-circle', { size: 14 })} ${L('remove')}</button></div>
          <label class="ap-field pt-amount"><span>${L('amount')}</span><input name="amount" type="number" min="1" max="1000" value="1" required></label></div>
        <label class="ap-field"><span>${L('reason')}</span><input name="reason" maxlength="300" minlength="3" required dir="auto" placeholder="${esc(L('reasonHint'))}"></label>
        <label class="pt-check"><input type="checkbox" name="notify" checked> ${L('notify')}</label>
        <button class="primary wide" type="submit">${L('save')}</button>
      </form>
      <h4 class="pt-sub">${L('recent')}</h4>
      <ul class="pt-recent">${(data.recent || []).length ? data.recent.map(item => `<li><em class="${item.delta < 0 ? 'neg' : ''}">${signed(item.delta)}</em><span><b>${esc(item.name)}</b><small dir="auto">${esc(partName(item.source))}${item.reason ? ` · ${esc(item.reason)}` : ''}</small></span><time>${esc(item.by || '')}${item.by ? ' · ' : ''}${date(item.at, 'en')}</time></li>`).join('') : `<li class="pt-empty">${L('none')}</li>`}</ul>
    </section>` : '';
  return `<div class="pt-page">
    <div class="section-head"><div><span class="eyebrow">${L('eyebrow')}</span><h1>${L('title')}</h1><p>${L('sub')}</p></div></div>
    <div class="pt-grid">
      <div class="pt-col">
        <section class="panel pt-card pt-mine"><div class="panel-head"><div><h3>${L('mine')}</h3></div><button type="button" class="secondary" data-back hidden>${L('back')}</button></div><div data-breakdown>${breakdown(data.me)}</div>${data.admin ? `<p class="pt-hint">${L('hint')}</p>` : ''}</section>
        <section class="panel pt-card"><div class="panel-head"><div><h3>${L('rules')}</h3></div></div><ul class="pt-rules">${rules}</ul></section>
      </div>
      <div class="pt-col">
        <section class="panel pt-card"><div class="panel-head"><div><h3>${L('board')}</h3></div><span class="pt-count">${(data.leaderboard || []).length}</span></div><ol class="pt-board">${board || `<li class="pt-empty">${L('empty')}</li>`}</ol></section>
        ${adjust}
      </div>
    </div>
  </div>`;
}

export function bind(data = {}, refresh) {
  const root = document.querySelector('.pt-page');
  if (!root) return;
  const box = root.querySelector('[data-breakdown]');
  const back = root.querySelector('[data-back]');
  const show = async userId => {
    const row = data.leaderboard.find(item => item.userId === userId);
    if (userId === data.user?.id) { box.innerHTML = breakdown(data.me); back.hidden = true; return; }
    try { const result = await api(`/api/points/${encodeURIComponent(userId)}`); box.innerHTML = breakdown(result.breakdown, row?.displayName); back.hidden = false; root.querySelector('.pt-mine').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
    catch (error) { toast(error.message); }
  };
  root.querySelectorAll('[data-member]').forEach(item => {
    item.addEventListener('click', () => show(item.dataset.member));
    item.addEventListener('keydown', event => { if (event.key === 'Enter') show(item.dataset.member); });
  });
  back?.addEventListener('click', () => { box.innerHTML = breakdown(data.me); back.hidden = true; });

  const form = root.querySelector('#pointsForm');
  if (!form) return;
  let sign = 1;
  form.querySelectorAll('[data-sign] button').forEach(button => button.addEventListener('click', () => {
    sign = Number(button.dataset.value);
    form.querySelectorAll('[data-sign] button').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  }));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const result = await api('/api/points/adjust', { method: 'POST', body: JSON.stringify({ userId: values.userId, delta: sign * Math.abs(Number(values.amount) || 0), reason: values.reason, notify: Boolean(values.notify) }) });
      toast(`${result.before} → ${result.after}${values.notify ? (result.dmSent ? ' · DM sent' : ' · DM closed') : ''}`);
      await refresh();
    } catch (error) { toast(error.message); submit.disabled = false; }
  });
}
