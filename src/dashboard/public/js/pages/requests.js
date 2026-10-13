import { date, esc } from '../ui.js';

const STATUS_LABELS = { pending: 'Under Review', approved: 'Approved - waiting for date', accepted: 'Completed', denied: 'Denied', rejected: 'Rejected', returned: 'Returned' };

export function complaint(c, data) {
  const staff = data.staff.find(item => item.userId === c.staffUserId);
  const reporter = data.staff.find(item => item.userId === c.reporterUserId);
  const status = c.status === 'pending' ? 'Under Review' : c.status === 'approved' ? 'Approved' : 'Rejected';
  return `<div class="request-card complaint-card"><div class="avatar"><mx-i name="danger" size="18"></mx-i></div><div class="request-content"><b>Complaint against ${esc(staff?.displayName || c.staffUserId)}</b><p>${esc(c.reason)}</p><small style="color:var(--muted)">Reported by: ${esc(reporter?.displayName || c.reporterUserId)} · ${date(c.createdAt)}${c.penaltyPoints ? ` · ${c.penaltyPoints} point(s) deducted` : ''}</small></div><span class="tag ${c.status}">${status}</span>${c.status === 'pending' ? `<div class="request-actions"><button class="primary" data-complaint="${c.id}" data-status="approved">Approve</button><button class="danger" data-complaint="${c.id}" data-status="rejected">Reject</button></div>` : ''}</div>`;
}

export function complaints(data) { return `<div class="section-head"><div><span class="eyebrow">REPORTS / DECISIONS</span><h1>Complaints Center</h1><p>Review reports and make a decision from one place, without any duplicates.</p></div><button class="secondary" data-action="refresh"><mx-i name="refresh-arrow-01" size="16"></mx-i> Refresh</button></div><section class="panel"><div class="panel-head"><div><h3>Complaints Log</h3><p>${data.complaints.length} total complaint(s)</p></div><span class="tag pending">${data.complaints.filter(item => item.status === 'pending').length} under review</span></div><div class="panel-body"><div class="request-list">${data.complaints.length ? data.complaints.map(item => complaint(item, data)).join('') : '<div class="empty">No complaints yet</div>'}</div></div></section>`; }

export function requests(title, eyebrow, rows, field, dateField, endField) { return `<div class="section-head"><div><span class="eyebrow">${eyebrow}</span><h1>${title}</h1><p>${title} all in one place, review them here.</p></div><button class="secondary" data-action="refresh"><mx-i name="refresh-arrow-01" size="16"></mx-i> Refresh</button></div><section class="panel"><div class="panel-head"><div><h3>${title}</h3><p>${rows.length} total</p></div></div><div class="panel-body"><div class="request-list">${rows.length ? rows.map(row => { const status = STATUS_LABELS[row.status] || row.status; return `<div class="request-card"><div class="avatar"><mx-i name="document-text" size="18"></mx-i></div><div class="request-content"><b>${esc(row[field] || 'No details')}</b><p>${esc(row.reason || '')}</p><small style="color:var(--muted)">${date(row[dateField])}${endField ? ' to ' + date(row[endField]) : ''}</small></div><span class="tag ${row.status}">${status}</span></div>`; }).join('') : '<div class="empty">Nothing here yet</div>'}</div></div></section>`; }

// The leave and resignation pages live in requests-workflow.js.
export { leaves, resignations, bindRequestsPage } from './requests-workflow.js';
