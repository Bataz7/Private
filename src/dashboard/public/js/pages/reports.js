import { api, esc, toast } from '../ui.js';
import { ic } from '../icon.js';
import { confirmAction } from '../confirm.js';

// Reports: automatic weekly reports (settings), send now for any period, and the history of generated reports.
const DAY = 86_400_000;
const fmt = value => (value ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(value)) : '-');
const isAdmin = () => Boolean(window.me?.user?.isOwner || window.me?.user?.isAdministrator);
const iso = ms => new Date(ms).toISOString().slice(0, 10);
const nameOf = person => person.displayName || person.username || person.userId;

// Report periods in UTC, matching how the weekly report itself is measured (Monday to Sunday).
function periods() {
  const today = Math.floor(Date.now() / DAY) * DAY;
  const monday = today - ((new Date(today).getUTCDay() + 6) % 7) * DAY;
  return {
    lastWeek: { label: 'Last week', from: monday - 7 * DAY, to: monday - DAY },
    thisWeek: { label: 'This week so far', from: monday, to: today },
    last7: { label: 'Last 7 days', from: today - 6 * DAY, to: today },
    last30: { label: 'Last 30 days', from: today - 29 * DAY, to: today },
  };
}

// ---- Staff picker: search, select all, count -------------------------------------------------
function pickerHtml(staff, selected) {
  return `<div class="rx-picker"><div class="rx-picker-bar"><label class="rx-search">${ic('search-normal', { size: 15 })}<input type="search" data-pk-search placeholder="Search staff"></label><button type="button" class="rx-link" data-pk-all>Select all</button><button type="button" class="rx-link" data-pk-none>Clear</button><span class="rx-count" data-pk-count></span></div>
    <div class="rx-picker-list">${staff.map(member => `<label class="rx-pk-item" data-name="${esc(nameOf(member).toLowerCase())}"><input type="checkbox" value="${esc(member.userId)}" ${selected.has(member.userId) ? 'checked' : ''}>${member.avatar ? `<img src="${esc(member.avatar)}" alt="" loading="lazy">` : '<span class="rx-av"></span>'}<span><b>${esc(nameOf(member))}</b><small>@${esc(member.username)}</small></span></label>`).join('') || '<p class="rx-empty">No active staff yet.</p>'}</div></div>`;
}
function bindPicker(root, onChange) {
  const boxes = () => [...root.querySelectorAll('.rx-picker-list input[type=checkbox]')];
  const visible = () => boxes().filter(box => !box.closest('.rx-pk-item').hidden);
  const selected = () => boxes().filter(box => box.checked).map(box => box.value);
  const refresh = () => { root.querySelector('[data-pk-count]').textContent = `${selected().length} selected`; onChange?.(selected()); };
  root.querySelector('[data-pk-search]').addEventListener('input', event => {
    const query = event.target.value.trim().toLowerCase();
    root.querySelectorAll('.rx-pk-item').forEach(item => { item.hidden = Boolean(query) && !item.dataset.name.includes(query); });
  });
  root.querySelector('[data-pk-all]').addEventListener('click', () => { visible().forEach(box => { box.checked = true; }); refresh(); });
  root.querySelector('[data-pk-none]').addEventListener('click', () => { boxes().forEach(box => { box.checked = false; }); refresh(); });
  root.querySelector('.rx-picker-list').addEventListener('change', refresh);
  refresh();
  return { selected };
}

export function render() {
  const admin = isAdmin();
  return `<div class="rx-page"><div class="section-head"><div><h1>Staff reports</h1><p>${admin ? 'Every Monday each staff member gets a report card in their DMs. Choose who receives it, tune the targets, or send one right now.' : 'Your private performance reports.'}</p></div></div>
    ${admin ? `<section class="panel rx-weekly" data-weekly><div class="page-loading"><span class="skeleton"></span></div></section>
    <section class="panel rx-send" data-send><div class="page-loading"><span class="skeleton"></span></div></section>` : ''}
    <section class="panel"><div class="panel-head"><div><h3>${admin ? 'Generated reports' : 'My reports'}</h3><p>Score, grade, voice hours and engagement for each report.</p></div></div><div class="panel-body"><div id="reportList" class="rx-list"><div class="page-loading"><span class="skeleton"></span></div></div></div></section></div>`;
}

function metric(value, label) { return `<span><b>${esc(value)}</b><small>${label}</small></span>`; }

function card(report, admin) {
  const score = typeof report.score === 'number' ? report.score : null;
  const metrics = [
    metric(`${Number(report.shiftHours || 0).toFixed(1)}h`, 'shift'),
    metric(`${Number(report.voiceHours || 0).toFixed(1)}h`, 'voice'),
    metric(`${Math.round(report.engagement || 0)}%`, 'engagement'),
    metric(Number(report.messageCount || 0).toLocaleString('en-US'), 'messages'),
    metric(`${report.activeDays || 0}`, 'active days'),
    metric(report.ratingAverage ? `${Number(report.ratingAverage).toFixed(1)}/5` : '—', 'rating'),
    metric(report.complaints || 0, 'complaints'),
    metric(report.points || 0, 'points'),
  ].join('');
  return `<article class="rx-card">
    <header>${report.avatar ? `<img src="${esc(report.avatar)}" alt="">` : '<span class="rx-av"></span>'}<div><b>${esc(report.displayName || report.staffUserId)}</b><small>${fmt(report.periodStart)} → ${fmt(report.periodEnd)} · ${report.automated ? 'Weekly' : 'Sent by management'}${report.rank ? ` · rank #${report.rank}` : ''}</small></div>
      ${score !== null ? `<span class="rx-grade rx-g-${esc(report.grade || 'D')}"><b>${esc(report.grade || '-')}</b><small>${score}/100</small></span>` : ''}</header>
    ${score !== null ? `<div class="rx-bar"><i class="rx-g-${esc(report.grade || 'D')}" style="width:${Math.max(2, Math.min(100, score))}%"></i></div>` : ''}
    <div class="rx-metrics">${metrics}</div>
    ${report.note ? `<p class="rx-text" dir="auto">${esc(report.note)}</p>` : ''}
    ${admin ? `<footer><button type="button" class="secondary" data-report-edit="${report.id}">${ic('edit-2', { size: 14 })} Note</button><button type="button" class="rx-link danger" data-report-delete="${report.id}">${ic('trash', { size: 14 })} Delete</button></footer>` : ''}
  </article>`;
}

async function refreshList() {
  const list = document.getElementById('reportList'); if (!list) return;
  try {
    const { reports, canCreate } = await api('/api/staff-reports');
    const admin = Boolean(canCreate);
    list.innerHTML = reports.length ? reports.map(report => card(report, admin)).join('') : '<div class="rx-empty">No reports yet. The first weekly report is sent next Monday.</div>';
    list.querySelectorAll('[data-report-delete]').forEach(button => button.addEventListener('click', async () => {
      if (!await confirmAction({ title: 'Delete this report?', message: 'It is removed from the dashboard. The DM already sent is not affected.', confirmText: 'Delete report' })) return;
      try { await api(`/api/staff-reports/${button.dataset.reportDelete}`, { method: 'DELETE' }); refreshList(); } catch (error) { toast(error.message); }
    }));
    list.querySelectorAll('[data-report-edit]').forEach(button => button.addEventListener('click', () => {
      const report = reports.find(item => String(item.id) === button.dataset.reportEdit);
      const root = document.createElement('div');
      root.className = 'modal-backdrop';
      root.innerHTML = `<section class="modal-card rx-dialog" role="dialog" aria-modal="true"><h2>Edit note</h2><textarea rows="5" maxlength="1500" dir="auto" placeholder="Private note shown with this report">${esc(report?.note || '')}</textarea><div class="rx-dialog-actions"><button class="secondary" type="button" data-no>Cancel</button><button class="primary" type="button" data-yes>Save</button></div></section>`;
      document.body.appendChild(root);
      root.addEventListener('mousedown', event => { if (event.target === root) root.remove(); });
      root.querySelector('[data-no]').addEventListener('click', () => root.remove());
      root.querySelector('[data-yes]').addEventListener('click', async () => {
        try { await api(`/api/staff-reports/${report.id}`, { method: 'PATCH', body: JSON.stringify({ note: root.querySelector('textarea').value }) }); root.remove(); refreshList(); } catch (error) { toast(error.message); }
      });
    }));
  } catch (error) { list.innerHTML = `<div class="error-state"><p>${esc(error.message)}</p></div>`; }
}

// ---- Automatic weekly reports ----------------------------------------------------------------
const toggle = (key, title, hint, checked) => `<label class="rx-toggle"><span class="rx-switch"><input type="checkbox" data-w="${key}" ${checked ? 'checked' : ''}><i></i></span><span><b>${title}</b><small>${hint}</small></span></label>`;

async function weeklyPanel() {
  const panel = document.querySelector('[data-weekly]'); if (!panel) return;
  const info = await api('/api/weekly-reports/settings');
  const s = info.settings;
  const staff = info.staff || [];
  let mode = s.recipients === 'selected' ? 'selected' : 'all';
  const target = (key, label, min, max, step = 1) => `<label class="rx-field small"><span>${label}</span><input type="number" min="${min}" max="${max}" step="${step}" data-t="${key}" value="${s.targets[key]}"></label>`;
  panel.innerHTML = `<div class="panel-head"><div><h3>${ic('chart-2', { size: 16 })} Automatic weekly reports</h3><p>Every Monday (UTC) the previous week is measured and sent on its own. Nothing to fill in.</p></div><div class="rx-head-end"><button type="button" class="rx-link" data-view="grades">How grades work</button><span class="rx-chip">${info.lastRun ? `Last sent: week of ${fmt(info.lastRun)}` : 'Not sent yet'} · Next: ${fmt(info.nextRun)}</span></div></div>
    <div class="rx-body">
      ${info.migrated ? '' : `<p class="rx-note warn">${ic('warning-2', { size: 15 })} The new weekly settings are not in the database yet. Run <code>supabase/migrations/034_reports_status.sql</code> in the Supabase SQL editor, then reload this page. Until then the defaults are used.</p>`}
      ${toggle('enabled', 'Send weekly reports automatically', 'Turn off to pause. You can still send one by hand below.', s.enabled)}
      ${toggle('dmStaff', 'DM each staff member', 'Their personal report card.', s.dmStaff)}
      ${toggle('dmSummary', 'Also send the team report', 'Everyone gets the team report in their DMs right after their own card.', s.dmSummary)}
      <div class="rx-field"><span>Who receives the report</span><div class="rx-seg" data-recipients><button type="button" data-value="all" aria-pressed="${mode === 'all'}">${ic('people', { size: 14 })} All active staff</button><button type="button" data-value="selected" aria-pressed="${mode === 'selected'}">${ic('user-add', { size: 14 })} Only the staff I choose</button></div><small class="rx-hint" data-recipients-note></small></div>
      <div data-recipients-picker ${mode === 'selected' ? '' : 'hidden'}>${pickerHtml(staff, new Set(s.staffIds))}</div>
      <div class="rx-inline"><label class="rx-field"><span>Team summary channel</span><select data-w="channelId"><option value="">Do not post a summary</option>${(info.channels || []).map(channel => `<option value="${channel.id}" ${s.channelId === channel.id ? 'selected' : ''}>#${esc(channel.name)}</option>`).join('')}</select></label>
        <label class="rx-field small"><span>Report language</span><select data-w="language"><option value="en" ${s.language === 'en' ? 'selected' : ''}>English</option><option value="ar" ${s.language === 'ar' ? 'selected' : ''}>العربية</option></select></label></div>
      <div class="rx-field"><span>Weekly targets <small class="rx-hint">A member who reaches every target scores close to 100.</small></span><div class="rx-inline">${target('shiftHours', 'Shift hours', 1, 100)}${target('activeDays', 'Active days', 1, 7)}${target('voiceHours', 'Voice hours', 1, 100)}${target('messages', 'Messages', 10, 20000)}</div></div>
      <div class="rx-actions"><button type="button" class="primary" data-w-save>${ic('save-2', { size: 15 })} Save</button><select data-preview-target><option value="">Preview: my own report</option>${staff.map(member => `<option value="${esc(member.userId)}">Preview: ${esc(nameOf(member))}</option>`).join('')}</select><button type="button" class="secondary" data-w-preview>${ic('send-2', { size: 15 })} Send preview to my DMs</button></div>
    </div>`;
  panel.querySelector('[data-view="grades"]')?.addEventListener('click', () => window.dispatchEvent(new CustomEvent('rift:navigate', { detail: 'grades' })));
  const note = panel.querySelector('[data-recipients-note]');
  let picker = null;
  picker = bindPicker(panel.querySelector('[data-recipients-picker]'), () => describe());
  function describe() { note.textContent = mode === 'all' ? `Every active staff member (${staff.length}) gets the report, including people added later.` : `${picker?.selected().length ?? s.staffIds.length} of ${staff.length} staff will get it. New staff are not added automatically.`; }
  panel.querySelector('[data-recipients]').addEventListener('click', event => {
    const button = event.target.closest('[data-value]'); if (!button) return;
    mode = button.dataset.value;
    panel.querySelectorAll('[data-recipients] button').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    panel.querySelector('[data-recipients-picker]').hidden = mode !== 'selected';
    describe();
  });
  describe();
  panel.querySelector('[data-w-save]').addEventListener('click', async event => {
    if (mode === 'selected' && !picker.selected().length) return toast('Choose at least one staff member, or switch to All active staff.');
    const button = event.currentTarget; button.disabled = true;
    const body = { enabled: panel.querySelector('[data-w="enabled"]').checked, dmStaff: panel.querySelector('[data-w="dmStaff"]').checked, dmSummary: panel.querySelector('[data-w="dmSummary"]').checked, recipients: mode, staffIds: mode === 'selected' ? picker.selected() : [], channelId: panel.querySelector('[data-w="channelId"]').value, language: panel.querySelector('[data-w="language"]').value, targets: Object.fromEntries([...panel.querySelectorAll('[data-t]')].map(input => [input.dataset.t, Number(input.value)])) };
    try { await api('/api/weekly-reports/settings', { method: 'PUT', body: JSON.stringify(body) }); toast(mode === 'selected' ? `Saved. Weekly reports go to ${body.staffIds.length} staff.` : 'Saved. Weekly reports go to all active staff.'); }
    catch (error) { toast(error.message); } finally { button.disabled = false; }
  });
  panel.querySelector('[data-w-preview]').addEventListener('click', async event => {
    const button = event.currentTarget; button.disabled = true;
    try { const { metrics } = await api('/api/weekly-reports/preview', { method: 'POST', body: JSON.stringify({ staffUserId: panel.querySelector('[data-preview-target]').value || undefined }) }); toast(`Preview sent to your DMs · score ${metrics.score} (${metrics.grade}) this week so far`); }
    catch (error) { toast(error.message); } finally { button.disabled = false; }
  });
  return staff;
}

// ---- Send now --------------------------------------------------------------------------------
function sendPanel(staff) {
  const panel = document.querySelector('[data-send]'); if (!panel) return;
  const presets = periods();
  let preset = 'lastWeek';
  panel.innerHTML = `<div class="panel-head"><div><h3>${ic('send-2', { size: 16 })} Send reports now</h3><p>Pick the staff and the period. The numbers are measured for you and each person gets a private report. Nothing to type in.</p></div></div>
    <div class="rx-body">
      <div class="rx-field"><span>Staff</span>${pickerHtml(staff, new Set())}</div>
      <div class="rx-field"><span>Period</span><div class="rx-seg" data-periods>${Object.entries(presets).map(([key, item]) => `<button type="button" data-preset="${key}" aria-pressed="${key === preset}">${item.label}</button>`).join('')}<button type="button" data-preset="custom" aria-pressed="false">Custom</button></div>
        <small class="rx-hint" data-range></small>
        <div class="rx-inline" data-custom hidden><label class="rx-field small"><span>From</span><input type="date" data-from value="${iso(presets.last7.from)}"></label><label class="rx-field small"><span>To</span><input type="date" data-to value="${iso(presets.last7.to)}"></label></div></div>
      <label class="rx-field"><span>Note to include <small class="rx-hint">Optional</small></span><textarea data-note maxlength="1500" dir="auto" rows="2" placeholder="Great support this week. Keep response quality high."></textarea></label>
      <label class="rx-check"><input type="checkbox" data-dm-summary checked> Also DM the team report to each person</label>
      <label class="rx-check"><input type="checkbox" data-summary> Also post the team summary in the summary channel</label>
      <div class="rx-actions"><button type="button" class="primary" data-send-now>${ic('send-2', { size: 15 })} <span>Send reports</span></button></div>
      <div class="rx-result" data-result hidden></div>
    </div>`;
  const picker = bindPicker(panel.querySelector('.rx-picker').parentElement, chosen => {
    panel.querySelector('[data-send-now] span').textContent = chosen.length ? `Send to ${chosen.length} ${chosen.length === 1 ? 'person' : 'people'}` : 'Choose who to send to';
  });
  const range = () => (preset === 'custom' ? { from: panel.querySelector('[data-from]').value, to: panel.querySelector('[data-to]').value } : { from: iso(presets[preset].from), to: iso(presets[preset].to) });
  const paintRange = () => { const r = range(); panel.querySelector('[data-range]').textContent = r.from && r.to ? `${fmt(r.from)} → ${fmt(r.to)}` : ''; };
  panel.querySelector('[data-periods]').addEventListener('click', event => {
    const button = event.target.closest('[data-preset]'); if (!button) return;
    preset = button.dataset.preset;
    panel.querySelectorAll('[data-periods] button').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    panel.querySelector('[data-custom]').hidden = preset !== 'custom';
    paintRange();
  });
  panel.querySelectorAll('[data-from], [data-to]').forEach(input => input.addEventListener('change', paintRange));
  paintRange();
  panel.querySelector('[data-send-now]').addEventListener('click', async event => {
    const button = event.currentTarget;
    const chosen = picker.selected();
    if (!chosen.length) return toast('Choose at least one staff member.');
    const r = range();
    if (!r.from || !r.to) return toast('Choose the period first.');
    if (!await confirmAction({ title: `Send reports to ${chosen.length} ${chosen.length === 1 ? 'person' : 'people'}?`, message: `Each one gets a private report for ${fmt(r.from)} → ${fmt(r.to)} in their DMs. This cannot be undone.`, confirmText: 'Send reports', danger: false })) return;
    button.disabled = true;
    const result = panel.querySelector('[data-result]');
    try {
      const answer = await api('/api/staff-reports/send', { method: 'POST', body: JSON.stringify({ staffUserIds: chosen, periodStart: r.from, periodEnd: r.to, note: panel.querySelector('[data-note]').value, summary: panel.querySelector('[data-summary]').checked, dmSummary: panel.querySelector('[data-dm-summary]').checked }) });
      const missed = answer.unreachable || [];
      result.hidden = false;
      result.className = `rx-result ${missed.length ? 'is-warn' : 'is-good'}`;
      result.innerHTML = `<b>${ic(missed.length ? 'warning-2' : 'tick-circle', { size: 16 })} Sent to ${answer.dms} of ${answer.staff}</b><span>Average score ${answer.average}/100${answer.posted ? ' · team summary posted' : ''}</span>${missed.length ? `<small>Could not reach (DMs closed or left the server): ${esc(missed.slice(0, 8).join(', '))}${missed.length > 8 ? ` and ${missed.length - 8} more` : ''}. Their report is still saved below.</small>` : ''}`;
      toast(`Reports sent: ${answer.dms} of ${answer.staff}`);
      refreshList();
    } catch (error) { toast(error.message); } finally { button.disabled = false; }
  });
}

export async function bind() {
  refreshList();
  if (!isAdmin()) return;
  try { sendPanel(await weeklyPanel()); }
  catch (error) {
    const message = `<div class="error-state"><p>${esc(error.message)}</p></div>`;
    const weekly = document.querySelector('[data-weekly]'); if (weekly) weekly.innerHTML = message;
    const send = document.querySelector('[data-send]'); if (send) send.innerHTML = '';
  }
}
