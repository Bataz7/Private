import { api, date, esc, toast } from '../ui.js';
import { ic } from '../icon.js';
import { confirmAction } from '../confirm.js';

// Leave and resignation pages. Everyone on staff sees their own requests and can file one; administrators see every request,
// decide with an optional note, choose where the panel and the requests go, resend waiting requests and clear old ones.
const KIND = {
  leaves: {
    label: 'leave', plural: 'Leaves', api: '/api/leaves', panel: '/api/leaves/panel', slug: 'leaves', createId: 'leaveCreate', formId: 'leaveForm', badge: 'leaveCount', optionsKey: 'leave',
    intro: 'Staff send a leave request from the panel, with /leave, or here. Administrators approve or reject it, and the member is told in DMs.',
    running: 'Running', closed: 'rejected or returned',
  },
  resignations: {
    label: 'resignation', plural: 'Resignations', api: '/api/resignations', panel: '/api/resignations/panel', slug: 'resignations', createId: 'resignationCreate', formId: 'resignationForm', badge: 'resignationCount', optionsKey: 'resignation',
    intro: 'Staff send a resignation from the panel, with /resign, or here. Administrators approve or reject it; on the last working day the member confirms it in DMs.',
    running: 'Approved', closed: 'rejected or completed',
  },
};
const DAY = 86_400_000;
const loaded = {};
const group = status => (status === 'pending' ? 'pending' : status === 'approved' ? 'approved' : 'closed');
const person = (data, id) => data.people?.[id];
const nameOf = (data, id) => person(data, id)?.displayName || person(data, id)?.username || `User ${String(id).slice(-4)}`;
const day = value => date(value, 'en');
const isoDay = value => new Date(value).toISOString().slice(0, 10);

function statusText(view, row) {
  if (view === 'leaves') {
    if (row.status === 'approved') return new Date(row.startDate).getTime() > Date.now() ? 'Approved · starts soon' : 'Approved · on leave';
    return { pending: 'Waiting for a decision', rejected: 'Rejected', returned: 'Returned' }[row.status] || row.status;
  }
  return { pending: 'Waiting for a decision', approved: 'Approved · waiting for the last day', accepted: 'Completed', rejected: 'Rejected' }[row.status] || row.status;
}

function meta(view, row) {
  const items = [];
  if (view === 'leaves') {
    const days = Math.max(1, Math.round((new Date(row.endDate) - new Date(row.startDate)) / DAY) + 1);
    items.push(`<span>${ic('calendar', { size: 14 })}${esc(day(row.startDate))} to ${esc(day(row.endDate))}</span>`, `<span>${days} day${days === 1 ? '' : 's'}</span>`);
    if (row.status === 'approved') {
      const left = Math.ceil((new Date(row.endDate).getTime() + DAY - Date.now()) / DAY);
      if (left > 0) items.push(`<span class="lw-good">${left} day${left === 1 ? '' : 's'} left</span>`);
      else items.push('<span class="lw-warn">Leave period ended</span>');
    }
    if (row.extensionEndDate) items.push(`<span class="lw-warn">Extension asked: ${esc(day(row.extensionEndDate))}</span>`);
  } else {
    const left = Math.ceil((new Date(row.lastWorkingDay).getTime() - Date.now()) / DAY);
    items.push(`<span>${ic('calendar', { size: 14 })}Last day ${esc(day(row.lastWorkingDay))}</span>`);
    if (row.status === 'approved' || row.status === 'pending') items.push(`<span class="${left <= 3 ? 'lw-warn' : ''}">${left > 0 ? `${left} day${left === 1 ? '' : 's'} to go` : left === 0 ? 'Today' : 'Date passed'}</span>`);
  }
  return items.join('');
}

// Running leave: the member's request for more time (approve or reject) and a direct extension by an administrator.
function extensionControls(row) {
  const id = esc(row.id);
  const ask = row.extensionEndDate ? `<div class="lw-ext"><div><b>The member asked for more time</b><small>New end date asked: ${esc(day(row.extensionEndDate))}. Nothing changes until you decide.</small></div><div class="lw-actions"><button class="primary" data-extension="${id}" data-decision="approved">Approve extension</button><button class="danger" data-extension="${id}" data-decision="rejected">Reject</button></div></div>` : '';
  const min = isoDay(new Date(row.endDate).getTime() + DAY);
  return `${ask}<div class="lw-actions"><button class="secondary" data-extend-open="${id}">Extend this leave</button><button class="secondary" data-close-leave="${id}">Mark as returned</button></div>
    <div class="lw-decide hidden" data-extend-box="${id}"><label class="setup-field"><span>New end date</span><input type="date" data-extend-date value="${row.extensionEndDate ? esc(isoDay(row.extensionEndDate)) : ''}" min="${esc(min)}"></label><textarea maxlength="500" placeholder="Note for the member (optional)"></textarea><div class="lw-actions"><button class="primary" data-extend-confirm="${id}">Extend and tell the member</button><button class="secondary" data-extend-cancel="${id}">Cancel</button></div></div>`;
}

function card(view, row, data, admin) {
  const who = person(data, row.userId);
  const name = nameOf(data, row.userId);
  const avatar = who?.avatar ? `<img src="${esc(who.avatar)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span>${esc(name.slice(0, 1).toUpperCase())}</span>`;
  const ref = String(row.id).slice(-6).toUpperCase();
  const decided = row.status !== 'pending' && row.reviewedBy;
  const search = `${name} ${who?.username || ''} ${row.reason || ''} ${ref}`.toLowerCase();
  return `<article class="lw-card" data-group="${group(row.status)}" data-search="${esc(search)}">
    <header><div class="lw-avatar">${avatar}</div><div class="lw-who"><b data-profile="${esc(row.userId)}">${esc(name)}</b><small>${who?.username ? `@${esc(who.username)} · ` : ''}#${ref} · sent ${esc(day(row.createdAt))}</small></div><span class="tag ${esc(row.status)}">${esc(statusText(view, row))}</span></header>
    <div class="lw-meta">${meta(view, row)}</div>
    <p class="lw-reason">${esc(row.reason || '')}</p>
    ${view === 'resignations' && row.notes ? `<p class="lw-notes"><b>Notes</b> ${esc(row.notes)}</p>` : ''}
    ${decided ? `<div class="lw-decision"><b>${row.status === 'rejected' ? 'Rejected' : 'Approved'} by ${esc(nameOf(data, row.reviewedBy))}</b>${row.reviewedAt ? ` · ${esc(day(row.reviewedAt))}` : ''}${row.decisionNote ? `<p>${esc(row.decisionNote)}</p>` : ''}</div>` : ''}
    ${view === 'leaves' && admin && row.status === 'approved' ? extensionControls(row) : ''}
    ${admin && row.status === 'pending' ? `<div class="lw-actions"><button class="primary" data-decide="${esc(row.id)}" data-status="approved">Approve</button><button class="danger" data-decide="${esc(row.id)}" data-status="rejected">Reject</button></div>
    <div class="lw-decide hidden" data-decide-box="${esc(row.id)}"><textarea maxlength="500" placeholder="Note for the member (optional)"></textarea><div class="lw-actions"><button class="primary" data-confirm="${esc(row.id)}">Confirm</button><button class="secondary" data-cancel="${esc(row.id)}">Cancel</button></div></div>` : ''}
  </article>`;
}

const stat = (icon, label, value) => `<div class="stat"><span class="stat-icon">${ic(icon, { size: 24 })}</span><strong>${value}</strong><span>${label}</span></div>`;

async function page(view) {
  const kind = KIND[view];
  let data;
  try { data = await api(kind.api); } catch (error) { data = { ready: false, message: error.message || 'Could not load the requests.', rows: [], people: {}, admin: false }; }
  loaded[view] = data;
  const rows = [...(data.rows || [])].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const admin = Boolean(data.admin);
  const count = name => rows.filter(row => group(row.status) === name).length;
  const create = view === 'leaves'
    ? `<label class="setup-field"><span>Start date</span><input name="startDate" type="date" required></label><label class="setup-field"><span>End date</span><input name="endDate" type="date" required></label><label class="setup-field lw-wide"><span>Reason</span><textarea name="reason" required maxlength="1000" placeholder="Leave reason"></textarea></label>`
    : `<label class="setup-field"><span>Last working day</span><input name="lastWorkingDay" type="date" required></label><label class="setup-field lw-wide"><span>Reason</span><textarea name="reason" required maxlength="1000" placeholder="Resignation reason"></textarea></label><label class="setup-field lw-wide"><span>Notes</span><textarea name="notes" maxlength="1000" placeholder="Optional notes"></textarea></label>`;
  const banner = data.ready === false ? `<div class="lw-banner">${ic('warning-2', { size: 20 })}<div><b>The database needs an update</b><small>${esc(data.message || 'Run migration 029_leave_resignation_system.sql in the Supabase SQL editor, then restart the bot.')}</small></div></div>` : '';
  return `<div class="section-head"><div><span class="eyebrow">${view === 'leaves' ? 'LEAVE WORKFLOW' : 'RESIGNATION WORKFLOW'}</span><h1>${kind.plural}</h1><p>${kind.intro}</p></div><div class="lw-head-actions"><button class="secondary" data-action="refresh"><mx-i name="refresh-arrow-01" size="16"></mx-i> Refresh</button><button class="primary" data-action="create-request"${data.ready === false ? ' disabled' : ''}><mx-i name="add" size="16"></mx-i> New ${kind.label} request</button></div></div>
  ${banner}
  <div class="stats-grid">${stat('clock', 'Waiting', count('pending'))}${stat('tick-circle', view === 'leaves' ? 'Approved / running' : 'Approved', count('approved'))}${stat('calendar-tick', 'Finished', count('closed'))}${stat('document-text', 'Total', rows.length)}</div>
  <section class="panel hidden" id="${kind.createId}"><div class="panel-head"><div><h3>New ${kind.label} request</h3><p>Sent for your own account. Administrators are notified in the requests channel.</p></div></div><form id="${kind.formId}" class="setup-form lw-form">${create}<button class="primary" type="submit">Send request</button></form></section>
  <section class="panel"><div class="panel-head"><div><h3>${admin ? `All ${kind.plural.toLowerCase()}` : `My ${kind.plural.toLowerCase()}`}</h3><p>${rows.length} request${rows.length === 1 ? '' : 's'}</p></div>
    <div class="lw-toolbar"><div class="lw-filters" role="tablist"><button class="active" data-filter="all">All</button><button data-filter="pending">Waiting</button><button data-filter="approved">${kind.running}</button><button data-filter="closed">Finished</button></div><input class="lw-search" type="search" placeholder="Search name, reason or #id"></div></div>
    <div class="panel-body"><div class="lw-list">${rows.length ? rows.map(row => card(view, row, data, admin)).join('') : '<div class="empty">Nothing here yet</div>'}<div class="empty hidden" id="lwNoMatch">No request matches this filter</div></div></div></section>
  ${admin ? `<section class="panel"><div class="panel-head"><div><h3>Panel and requests channel</h3><p>The <b>panel</b> is where members press the button. The <b>requests channel</b> is where each request arrives for review. They can be two different channels.</p></div></div>
    <div class="panel-body lw-tools">
      <div class="lw-selects"><label class="setup-field"><span>Panel channel</span><select id="lwPanelChannel"><option value="">Select the panel channel...</option></select></label>
      <label class="setup-field"><span>Requests channel (review)</span><select id="lwRequestsChannel"><option value="">Select the requests channel...</option></select></label></div>
      <div class="lw-actions"><button class="primary" data-action="send-panel">Send panel</button><button class="secondary" data-action="save-channel">Save requests channel only</button></div>
      <div class="lw-maint"><div><b>Resend waiting requests</b><small>Posts every request that is still waiting to the requests channel again as a fresh card and removes the old card.</small></div><button class="secondary" data-action="resend-pending">Resend ${count('pending')} waiting</button></div>
      <div class="lw-maint lw-maint-danger"><div><b>Clear finished requests</b><small>Permanently deletes ${kind.closed} requests. Waiting and running ones are never touched.</small><select id="lwClearAge"><option value="0">All finished requests</option><option value="30">Older than 30 days</option><option value="90">Older than 90 days</option><option value="365">Older than one year</option></select><small id="lwClearCount" class="lw-count"></small></div><button class="danger" data-action="clear-closed">Clear finished</button></div>
    </div></section>` : ''}`;
}

export const leaves = () => page('leaves');
export const resignations = () => page('resignations');

export function bindRequestsPage(view, root, reload) {
  if (!root) return;
  const kind = KIND[view];
  const data = loaded[view] || {};
  // Sidebar badge: how many are waiting (administrators see every request).
  if (data.admin) { const badge = document.getElementById(kind.badge); if (badge) badge.textContent = String((data.rows || []).filter(row => row.status === 'pending').length); }

  // ---- create ----
  root.querySelector('[data-action="create-request"]')?.addEventListener('click', () => root.querySelector(`#${kind.createId}`)?.classList.toggle('hidden'));
  const form = root.querySelector(`#${kind.formId}`);
  form?.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]'); button.disabled = true;
    try {
      const result = await api(kind.api, { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      toast(result.sentToManagement === false ? `${kind.label[0].toUpperCase()}${kind.label.slice(1)} request saved, but no requests channel is set` : `${kind.label[0].toUpperCase()}${kind.label.slice(1)} request sent to management`);
      await reload();
    } catch (error) { toast(error.message || 'Could not send the request.'); button.disabled = false; }
  });

  // ---- filter and search ----
  let filter = 'all'; let query = '';
  const apply = () => {
    let shown = 0;
    root.querySelectorAll('.lw-card').forEach(item => { const ok = (filter === 'all' || item.dataset.group === filter) && (!query || item.dataset.search.includes(query)); item.classList.toggle('hidden', !ok); if (ok) shown++; });
    root.querySelector('#lwNoMatch')?.classList.toggle('hidden', shown > 0 || !root.querySelector('.lw-card'));
  };
  root.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => { filter = button.dataset.filter; root.querySelectorAll('[data-filter]').forEach(item => item.classList.toggle('active', item === button)); apply(); }));
  root.querySelector('.lw-search')?.addEventListener('input', event => { query = event.target.value.trim().toLowerCase(); apply(); });

  // ---- decisions (administrators; the server checks again) ----
  root.querySelectorAll('[data-decide]').forEach(button => button.addEventListener('click', () => {
    const box = root.querySelector(`[data-decide-box="${button.dataset.decide}"]`); if (!box) return;
    box.dataset.status = button.dataset.status; box.classList.remove('hidden');
    box.querySelector('[data-confirm]').textContent = button.dataset.status === 'approved' ? 'Confirm approval' : 'Confirm rejection';
    box.querySelector('textarea').focus();
  }));
  root.querySelectorAll('[data-cancel]').forEach(button => button.addEventListener('click', () => root.querySelector(`[data-decide-box="${button.dataset.cancel}"]`)?.classList.add('hidden')));
  root.querySelectorAll('[data-confirm]').forEach(button => button.addEventListener('click', async () => {
    const id = button.dataset.confirm; const box = root.querySelector(`[data-decide-box="${id}"]`);
    button.disabled = true;
    try {
      const result = await api(`${kind.api}/${id}`, { method: 'PATCH', body: JSON.stringify({ status: box.dataset.status, note: box.querySelector('textarea').value.trim() }) });
      toast(result.dmSent === false ? 'Decision saved, but the member has DMs closed. Tell them yourself.' : 'Decision saved and the member was notified');
      await reload();
    } catch (error) { toast(error.message || 'Could not save the decision.'); button.disabled = false; }
  }));

  // ---- extensions (running leaves) ----
  root.querySelectorAll('[data-extend-open]').forEach(button => button.addEventListener('click', () => root.querySelector(`[data-extend-box="${button.dataset.extendOpen}"]`)?.classList.toggle('hidden')));
  root.querySelectorAll('[data-extend-cancel]').forEach(button => button.addEventListener('click', () => root.querySelector(`[data-extend-box="${button.dataset.extendCancel}"]`)?.classList.add('hidden')));
  root.querySelectorAll('[data-extend-confirm]').forEach(button => button.addEventListener('click', async () => {
    const id = button.dataset.extendConfirm; const box = root.querySelector(`[data-extend-box="${id}"]`);
    const endDate = box.querySelector('[data-extend-date]').value;
    if (!endDate) return toast('Choose the new end date first.');
    button.disabled = true;
    try {
      const result = await api(`${kind.api}/${id}/extend`, { method: 'POST', body: JSON.stringify({ endDate, note: box.querySelector('textarea').value.trim() }) });
      toast(result.dmSent ? 'Leave extended and the member was told' : 'Leave extended, but the member has DMs closed. Tell them yourself.');
      await reload();
    } catch (error) { toast(error.message || 'Could not extend the leave.'); button.disabled = false; }
  }));
  root.querySelectorAll('[data-close-leave]').forEach(button => button.addEventListener('click', async () => {
    if (!await confirmAction({ title: 'Mark this leave as returned?', message: 'The leave closes now and the member gets their roles back. Use it when they cannot press the button themselves.', confirmText: 'Mark as returned', danger: false })) return;
    button.disabled = true;
    try {
      const result = await api(`${kind.api}/${button.dataset.closeLeave}/close`, { method: 'POST', body: '{}' });
      toast(result.rolesOk === false ? 'Leave closed, but some roles could not be changed. Check the role order.' : 'Leave closed and the roles were restored');
      await reload();
    } catch (error) { toast(error.message || 'Could not close the leave.'); button.disabled = false; }
  }));
  root.querySelectorAll('[data-extension]').forEach(button => button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const result = await api(`${kind.api}/${button.dataset.extension}/extension`, { method: 'POST', body: JSON.stringify({ decision: button.dataset.decision }) });
      toast(button.dataset.decision === 'approved' ? 'Extension approved' : 'Extension rejected'); if (result.dmSent === false) toast('The member has DMs closed. Tell them yourself.');
      await reload();
    } catch (error) { toast(error.message || 'Could not save the decision.'); button.disabled = false; }
  }));

  // ---- admin tools ----
  const panelSelect = root.querySelector('#lwPanelChannel'); const requestsSelect = root.querySelector('#lwRequestsChannel');
  if (panelSelect && requestsSelect) {
    api('/api/requests-workflow/options').then(result => {
      const options = (result.channels || []).map(channel => `<option value="${esc(channel.id)}">#${esc(channel.name)}</option>`).join('');
      panelSelect.insertAdjacentHTML('beforeend', options); requestsSelect.insertAdjacentHTML('beforeend', options);
      panelSelect.value = result[kind.optionsKey]?.panelChannelId || ''; requestsSelect.value = result[kind.optionsKey]?.requestsChannelId || '';
    }).catch(() => { panelSelect.innerHTML = '<option value="">Could not load channels</option>'; });
    const busy = async (button, task) => { const label = button.textContent; button.disabled = true; try { await task(); } catch (error) { toast(error.message || 'Something went wrong.'); } finally { button.disabled = false; button.textContent = label; } };
    root.querySelector('[data-action="send-panel"]').addEventListener('click', event => busy(event.currentTarget, async () => {
      if (!panelSelect.value) return toast('Choose the panel channel first.');
      if (!requestsSelect.value) return toast('Choose the requests channel first, so requests have somewhere to arrive.');
      const result = await api(kind.panel, { method: 'POST', body: JSON.stringify({ channelId: panelSelect.value, requestsChannelId: requestsSelect.value }) });
      toast(`Panel ${result.updated ? 'updated' : 'sent'}; requests will arrive in the requests channel`);
    }));
    root.querySelector('[data-action="save-channel"]').addEventListener('click', event => busy(event.currentTarget, async () => {
      if (!requestsSelect.value) return toast('Choose the requests channel first.');
      await api(`/api/requests/${kind.slug}/channel`, { method: 'POST', body: JSON.stringify({ channelId: requestsSelect.value }) });
      toast('Requests channel saved');
    }));
    root.querySelector('[data-action="resend-pending"]').addEventListener('click', event => busy(event.currentTarget, async () => {
      const result = await api(`/api/requests/${kind.slug}/resend-pending`, { method: 'POST', body: '{}' });
      toast(result.pending ? `Resent ${result.sent} of ${result.pending} waiting request(s)${result.failed ? `, ${result.failed} failed` : ''}` : 'No requests are waiting');
      await reload();
    }));
    const age = root.querySelector('#lwClearAge'); const count = root.querySelector('#lwClearCount');
    const refreshCount = () => api(`/api/requests/${kind.slug}/closed-count?olderThanDays=${encodeURIComponent(age.value)}`).then(result => { count.textContent = `${result.closed} finished request(s) would be deleted.`; }).catch(() => { count.textContent = ''; });
    age.addEventListener('change', refreshCount); refreshCount();
    root.querySelector('[data-action="clear-closed"]').addEventListener('click', event => busy(event.currentTarget, async () => {
      const preview = await api(`/api/requests/${kind.slug}/closed-count?olderThanDays=${encodeURIComponent(age.value)}`);
      if (!preview.closed) return toast('There are no finished requests to clear.');
      if (!await confirmAction({ title: `Delete ${preview.closed} finished request(s)?`, message: 'They are removed for good and cannot be brought back.', confirmText: 'Delete finished requests', details: ['Waiting and running requests are not touched.', 'Approved leaves that are still running are kept.'] })) return;
      const result = await api(`/api/requests/${kind.slug}/clear-closed`, { method: 'POST', body: JSON.stringify({ confirm: true, olderThanDays: Number(age.value) }) });
      toast(`Deleted ${result.removed} finished request(s)`);
      await reload();
    }));
  }
  apply();
}
