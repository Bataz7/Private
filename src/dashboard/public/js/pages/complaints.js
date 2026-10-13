import { esc, date, avatar } from '../ui.js';

function complaintRow(item) {
  const statusClass = item.status === 'pending' ? 'pending' : item.status === 'approved' ? 'approved' : 'rejected';
  const statusLabel = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected' }[item.status] || item.status;
  const target = item.staffUserId ? avatar(null, item.staffUserId) : '';
  return `<div class="request-card" data-complaint="${item.id}">${target}<div class="request-content"><b>Report against <span class="user-ref"><@${item.staffUserId}></span></b><small>${esc((item.reason || '').slice(0, 80))}</small>${item.evidence ? `<small class="evidence">${esc(item.evidence.slice(0, 65))}</small>` : ''}</div><span class="tag ${statusClass}">${statusLabel}</span></div>`;
}

function complaintDetail(item, data) {
  const staff = data.staff?.find(s => s.userId === item.staffUserId) || {};
  const statusClass = item.status === 'pending' ? 'pending' : item.status === 'approved' ? 'approved' : 'rejected';
  const statusLabel = { pending: 'Pending Review', approved: 'Approved', rejected: 'Rejected' }[item.status] || item.status;
  const actions = item.status === 'pending'
    ? `<button class="danger" data-complaint-action="reject" data-complaint="${item.id}">Reject (${item.penaltyPoints || 0} points)</button>
       <button class="primary" data-complaint-action="approve" data-complaint="${item.id}">Approve (${item.penaltyPoints || 0} points)</button>`
    : '';
  return `<div class="complaint-detail"><section class="panel"><div class="panel-head"><div><h3>Complaint #${item.id}</h3><p>Against: <b><@${item.staffUserId}> ${staff.displayName ? `(${esc(staff.displayName)})` : ''}</b></p></div><span class="tag ${statusClass}">${statusLabel}</span></div><div class="panel-body"><p>${esc(item.reason || '')}</p>${item.evidence ? `<div class="evidence-block"><b>Evidence</b><p>${esc(item.evidence)}</p></div>` : ''}<div class="complaint-meta"><small>Reported by <@${item.reporterUserId}> · ${date(item.createdAt)}</small></div></div><div class="panel-foot">${item.reviewedBy ? `<small>Reviewed by <@${item.reviewedBy}> · ${date(item.reviewedAt)}</small>` : ''}</div></section><div class="complaint-actions">${actions}</div></div>`;
}

export function render(data, selected = null) {
  const pendingCount = data.complaints.filter(c => c.status === 'pending').length;
  const approvedCount = data.complaints.filter(c => c.status === 'approved').length;
  const rejectedCount = data.complaints.filter(c => c.status === 'rejected').length;
  const pending = data.complaints.filter(c => c.status === 'pending');
  const rows = pending.length
    ? pending.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(complaintRow).join('')
    : '<div class="empty"><div><b>No pending complaints</b><span>All caught up.</span></div></div>';
  return `<div class="section-head"><div><span class="eyebrow">REPORTS / COMPLAINTS</span><h1>Complaints</h1><p>Review, approve, or reject staff complaints. Approved reports deduct penalty points.</p></div></div><div class="stats-grid"><div class="stat"><span class="stat-icon"><mx-i name="danger" size="18"></mx-i></span><strong>${pendingCount}</strong><span>Pending</span><small>Awaiting review</small></div><div class="stat"><span class="stat-icon"><mx-i name="tick-circle" size="18"></mx-i></span><strong>${approvedCount}</strong><span>Approved</span><small>${approvedCount} penalized</small></div><div class="stat"><span class="stat-icon"><mx-i name="close-circle" size="18"></mx-i></span><strong>${rejectedCount}</strong><span>Rejected</span><small>All clear</small></div></div><section class="panel"><div class="panel-head"><div><h3>Pending Review</h3><p>${pendingCount} complaints need your attention.</p></div></div><div class="panel-body request-list">${rows}</div></section>`;
}
