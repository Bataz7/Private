import { api, avatar, average, esc, stars, toast } from '../ui.js';
import { ic } from '../icon.js';
import { confirmAction } from '../confirm.js';

const ago = value => {
  const s = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
const clip = (text, max) => { const value = String(text || '').trim(); return value.length > max ? `${value.slice(0, max - 1)}...` : value; };

function staffRow(staff) {
  return `<div class="staff-row" role="link" tabindex="0" data-profile="${esc(staff.userId)}">${avatar(staff.avatar, staff.displayName)}<div class="meta"><b>${esc(staff.displayName)}</b><small>${staff.ratingCount ? `${stars(staff.averageRating)} ${staff.averageRating.toFixed(1)} (${staff.ratingCount})` : 'No ratings yet'}</small></div><strong>${staff.points} <small>pts</small></strong></div>`;
}

// One list of everything waiting on a decision, so it can be handled without visiting three pages.
function queueItems(data) {
  const names = new Map(data.staff.map(staff => [staff.userId, staff.displayName]));
  const who = id => names.get(id) || `User ${String(id).slice(-4)}`;
  const items = [
    ...data.complaints.filter(row => row.status === 'pending').map(row => ({ kind: 'complaint', icon: 'danger', id: row.id, title: `Complaint against ${who(row.staffUserId)}`, detail: row.reason, at: row.createdAt, yes: 'approved', no: 'rejected', yesLabel: 'Uphold' })),
    ...data.leaves.filter(row => row.status === 'pending').map(row => ({ kind: 'leave', icon: 'briefcase', id: row.id, title: `Leave request from ${who(row.userId)}`, detail: row.reason, at: row.createdAt, yes: 'approved', no: 'rejected', yesLabel: 'Approve' })),
    ...data.resignations.filter(row => row.status === 'pending').map(row => ({ kind: 'resignation', icon: 'logout-01', id: row.id, title: `Resignation from ${who(row.userId)}`, detail: row.reason, at: row.createdAt, yes: 'accepted', no: 'rejected', yesLabel: 'Accept' })),
  ];
  return items.sort((a, b) => new Date(a.at) - new Date(b.at));
}

function queue(data, admin) {
  const items = queueItems(data);
  if (!items.length) return `<div class="empty ov-empty">${ic('tick-circle', { size: 26 })}<div><b>Nothing waiting</b><span>Complaints, leave and resignation requests appear here.</span></div></div>`;
  return `<div class="ov-queue">${items.slice(0, 8).map(item => `<div class="ov-item"><span class="ov-ico">${ic(item.icon, { size: 20 })}</span><div class="ov-text"><b>${esc(item.title)}</b><p>${esc(clip(item.detail, 110))}</p><time>${ago(item.at)}</time></div>${admin ? `<div class="ov-actions"><button class="primary" data-queue="${item.kind}" data-id="${esc(item.id)}" data-status="${item.yes}">${item.yesLabel}</button><button class="secondary" data-queue="${item.kind}" data-id="${esc(item.id)}" data-status="${item.no}">Reject</button></div>` : ''}</div>`).join('')}${items.length > 8 ? `<p class="ov-more">${items.length - 8} more waiting in Complaints, Leaves and Resignations.</p>` : ''}</div>`;
}

function liveShifts(data) {
  const names = new Map(data.staff.map(staff => [staff.userId, staff]));
  const live = data.shifts.filter(shift => shift.status === 'active');
  if (!live.length) return `<div class="empty ov-empty">${ic('alarm', { size: 26 })}<div><b>No one on shift</b><span>Active shifts show up here live.</span></div></div>`;
  return `<div class="ov-live">${live.map(shift => {
    const staff = names.get(shift.userId);
    const onBreak = Array.isArray(shift.breaks) && shift.breaks.length && !shift.breaks.at(-1)?.endedAt;
    const minutes = Math.max(0, Math.floor((Date.now() - new Date(shift.startedAt).getTime()) / 60000));
    return `<div class="staff-row" role="link" tabindex="0" data-profile="${esc(shift.userId)}">${avatar(staff?.avatar, staff?.displayName || shift.userId)}<div class="meta"><b>${esc(staff?.displayName || `User ${String(shift.userId).slice(-4)}`)}</b><small><i class="status-dot ${onBreak ? 'is-break' : ''}"></i>${onBreak ? 'On break' : 'Working'}</small></div><small class="ov-elapsed">${minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`}</small></div>`;
  }).join('')}</div>`;
}

export function render(data) {
  const viewer = data.user || {};
  const admin = Boolean(viewer.isOwner || viewer.isAdministrator);
  const active = data.staff.length;
  const shifts = data.shifts.filter(shift => shift.status === 'active').length;
  const pendingComplaints = data.complaints.filter(item => item.status === 'pending').length;
  const waiting = queueItems(data).length;
  const viewerStaff = data.staff.find(item => item.userId === viewer.id);
  const greeting = viewer.username ? `Welcome back, ${esc(viewer.username)}.` : 'Welcome back.';
  return `<div class="hero"><div><h1>${greeting}</h1><p>${waiting ? `${waiting} request${waiting === 1 ? '' : 's'} waiting for a decision.` : 'Everything is up to date.'}</p></div><div class="hero-side"><div class="viewer-summary" ${viewerStaff ? `role="link" tabindex="0" data-profile="${esc(viewer.id)}"` : ''}>${avatar(viewer.avatar, viewer.username || 'M')}<span><b>${esc(viewerStaff?.displayName || viewer.username || 'Rift user')}</b><small>${viewerStaff?.rank ? esc(viewerStaff.rank) : (viewer.isAdministrator ? 'Administrator' : 'Staff workspace')}</small></span></div><div class="actions"><button class="secondary" data-action="refresh">${ic('refresh-arrow-01', { size: 18 })} Refresh</button>${admin ? `<button class="primary" data-action="staff-add">${ic('user-add', { size: 18 })} Add Staff</button>` : ''}</div></div></div>
  <div class="stats-grid"><div class="stat"><span class="stat-icon">${ic('people', { size: 24 })}</span><strong>${active}</strong><span>Total Staff</span><small>${active} active</small></div><div class="stat"><span class="stat-icon">${ic('alarm', { size: 24 })}</span><strong>${shifts}</strong><span>Active Shifts</span><small>${shifts ? 'Live now' : 'Nobody on shift'}</small></div><div class="stat"><span class="stat-icon"><img src="/logo-mark.svg" class="rift-rating-mark on" alt=""></span><strong>${average(data.staff.map(staff => staff.averageRating)).toFixed(1)}</strong><span>Average Rating</span><small>${data.ratings.length} ratings</small></div><div class="stat"><span class="stat-icon">${ic('danger', { size: 24 })}</span><strong>${pendingComplaints}</strong><span>Pending Complaints</span><small>${pendingComplaints ? 'Needs review' : 'All clear'}</small></div></div>
  <div class="grid-2"><section class="panel"><div class="panel-head"><div><h3>Needs attention</h3><p>${waiting ? `${waiting} waiting, oldest first` : 'No open requests'}</p></div></div><div class="panel-body">${queue(data, admin)}</div></section>
  <section class="panel"><div class="panel-head"><div><h3>On shift now</h3><p>${shifts} active</p></div><button class="secondary" data-view="shifts">Open shifts</button></div><div class="panel-body">${liveShifts(data)}</div></section></div>
  <div class="grid-2"><section class="panel"><div class="panel-head"><div><h3>Top performance</h3><p>Ranked by member ratings</p></div><button class="secondary" data-view="staff">View all</button></div><div class="panel-body"><div class="staff-list">${data.staff.slice().sort((a, b) => b.averageRating - a.averageRating || b.points - a.points).slice(0, 5).map(staffRow).join('') || '<div class="empty">No staff yet.</div>'}</div></div></section>
  <section class="panel"><div class="panel-head"><div><h3>Team activity</h3><p>Last 14 days</p></div><div class="ov-toggle" role="tablist"><button type="button" role="tab" aria-selected="true" data-metric="shiftHours">Shift hours</button><button type="button" role="tab" aria-selected="false" data-metric="minutes">Active min</button><button type="button" role="tab" aria-selected="false" data-metric="messages">Messages</button></div></div><div class="panel-body" id="ovChart"><div class="page-loading"><span class="skeleton" style="height:96px"></span></div></div></section></div>`;
}

function drawChart(days, metric) {
  const values = days.map(day => day[metric] || 0);
  const max = Math.max(1, ...values);
  const total = values.reduce((sum, value) => sum + value, 0);
  const unit = { shiftHours: 'h', minutes: ' min', messages: '' }[metric];
  return `<div class="hl-bars ov-bars" role="img" aria-label="${metric} for the last 14 days">${values.map((value, index) => `<i style="height:${Math.max(3, Math.round((value / max) * 100))}%" title="${esc(days[index].date)}: ${value}${unit}"></i>`).join('')}</div><div class="hl-scale"><span>${esc(days[0].date.slice(5))} to ${esc(days.at(-1).date.slice(5))}</span><span>total ${Math.round(total * 10) / 10}${unit}</span></div>`;
}

export function bind(data, reload) {
  const view = document.getElementById('view');
  view.querySelectorAll('[data-profile][role="link"]').forEach(row => row.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); row.click(); } }));

  view.querySelectorAll('[data-queue]').forEach(button => button.addEventListener('click', async () => {
    const { queue: kind, id, status } = button.dataset;
    if (kind === 'complaint' && status === 'approved' && !(await confirmAction({ title: 'Uphold this complaint?', message: 'Upholding a complaint deducts penalty points from the staff member and cannot be undone here.', confirmText: 'Uphold complaint' }))) return;
    if (kind === 'resignation' && status === 'accepted' && !(await confirmAction({ title: 'Accept this resignation?', message: 'The staff role is removed from the member in Discord.', confirmText: 'Accept resignation' }))) return;
    const path = { complaint: 'complaints', leave: 'leaves', resignation: 'resignations' }[kind];
    button.disabled = true;
    try { await api(`/api/${path}/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }); toast('Decision saved'); await reload(); }
    catch (error) { toast(error.message || 'Could not save the decision.'); button.disabled = false; }
  }));

  const chart = document.getElementById('ovChart');
  api('/api/activity/weekly').then(result => {
    if (!document.getElementById('ovChart')) return;
    let metric = 'shiftHours';
    const paint = () => { chart.innerHTML = drawChart(result.days, metric); };
    paint();
    view.querySelector('.ov-toggle')?.addEventListener('click', event => {
      const tab = event.target.closest('[data-metric]'); if (!tab) return;
      metric = tab.dataset.metric;
      view.querySelectorAll('[data-metric]').forEach(item => item.setAttribute('aria-selected', String(item === tab)));
      paint();
    });
  }).catch(() => { chart.innerHTML = '<div class="empty">Activity data is unavailable right now.</div>'; });
}
