import { api, date, esc, toast } from '../ui.js';
import { ic } from '../icon.js';

// Inbox for everyone; the composer (dashboard inbox and/or Discord DM from the bot) is for owners and administrators only.
const LEVELS = [['info', 'Message', 'message-text', '#8175f5', 'Message from management'], ['warning', 'Notice', 'warning-2', '#e0b04f', 'Notice from management'], ['important', 'Important', 'danger', '#e9697b', 'Important notice']];

function card(item, userId) {
  const unread = !(item.readBy || []).some(read => read.userId === userId);
  const level = LEVELS.find(entry => entry[0] === item.level) || LEVELS[0];
  const sender = item.senderAvatar ? `<img src="${esc(item.senderAvatar)}" alt="" loading="lazy">` : `<span>${esc((item.senderName || 'M')[0])}</span>`;
  return `<article class="notification-card nt-card lv-${esc(item.level || 'info')} ${unread ? 'is-unread' : ''}" data-notification-id="${esc(item.id)}"><div class="notification-card-head"><div class="notification-sender">${sender}<span><b>${esc(item.senderName || item.senderUserId)}</b><small>${date(item.createdAt, 'en')} · ${level[1]}</small></span></div>${unread ? '<span class="notification-dot"></span>' : '<small class="notification-seen">Read</small>'}</div>${item.title ? `<h4 dir="auto">${esc(item.title)}</h4>` : ''}<p dir="auto">${esc(item.message)}</p>${unread ? '<button class="secondary notification-read" type="button">Mark as read</button>' : ''}</article>`;
}

export function render(data) {
  const notifications = data.notifications?.notifications || [];
  const list = notifications.length ? notifications.map(item => card(item, data.user?.id)).join('') : '<div class="empty">Your inbox is clear.</div>';
  const canSend = Boolean(data.user?.isOwner || data.user?.isAdministrator);
  const composer = canSend ? `<section class="panel notification-compose nt-compose"><div class="panel-head"><div><h3>Send a notification</h3><p>To one member, all staff, or everyone with a role. Arrives in the dashboard inbox, as a DM from the bot, or both.</p></div></div>
    <form id="adminNoteForm" class="nt-form">
      <div class="ap-seg nt-target"><button type="button" data-target="user" aria-pressed="true">${ic('user', { size: 14 })} One member</button><button type="button" data-target="staff" aria-pressed="false">${ic('people', { size: 14 })} All staff</button><button type="button" data-target="role" aria-pressed="false">${ic('shield-tick', { size: 14 })} A role</button></div>
      <label class="ap-field" data-for="user"><span>Member</span><select name="recipientUserId"><option value="">Loading staff…</option></select></label>
      <label class="ap-field" data-for="role" hidden><span>Role</span><select name="roleId"><option value="">Loading roles…</option></select><small>Only staff and administrators with this role receive it.</small></label>
      <div class="ap-modes nt-levels">${LEVELS.map(([key, label, icon], index) => `<label class="ap-mode"><input type="radio" name="level" value="${key}" ${index === 0 ? 'checked' : ''}><span>${ic(icon, { size: 16 })}<b>${label}</b></span></label>`).join('')}</div>
      <label class="ap-field"><span>Title <em>optional</em></span><input name="title" maxlength="120" dir="auto" placeholder="e.g. Staff meeting on Friday"></label>
      <label class="ap-field"><span>Message</span><textarea name="message" rows="5" maxlength="2000" required dir="auto" placeholder="Write the notification…"></textarea></label>
      <label class="ap-field"><span>Delivery</span><select name="delivery"><option value="both">Dashboard + Discord DM</option><option value="discord">Discord DM only</option><option value="dashboard">Dashboard only</option></select></label>
      <div class="nt-preview"><span>DM preview</span><div data-preview></div></div>
      <button class="primary wide" type="submit">${ic('send-2', { size: 15 })} Send notification</button>
    </form></section>` : '';
  return `<div class="section-head"><div><span class="eyebrow">INBOX / PRIVATE</span><h1>Notifications</h1><p>${canSend ? 'Send notes and announcements to your team, and read your own inbox.' : 'Your private notes and staff updates.'}</p></div></div><div class="notification-layout ${canSend ? '' : 'inbox-only'}">${composer}<section class="panel notification-inbox"><div class="panel-head"><div><h3>Your inbox</h3><p>${data.notifications?.unread || 0} unread</p></div><button class="secondary" type="button" data-notifications-refresh>${ic('refresh-arrow-01', { size: 15 })} Refresh</button></div><div class="notification-list">${list}</div></section></div>`;
}

export async function bind(data, refresh) {
  const form = document.querySelector('#adminNoteForm');
  document.querySelector('[data-notifications-refresh]')?.addEventListener('click', refresh);
  document.querySelectorAll('.notification-card.is-unread').forEach(element => element.querySelector('.notification-read')?.addEventListener('click', async () => {
    try { await api(`/api/notifications/${element.dataset.notificationId}/read`, { method: 'PATCH' }); await refresh(); } catch (error) { toast(error.message); }
  }));
  if (!form) return;
  let target = 'user';
  const options = await api('/api/notifications/options').catch(() => ({ staff: [], roles: [] }));
  form.elements.recipientUserId.innerHTML = `<option value="">Choose a member…</option>${options.staff.map(member => `<option value="${esc(member.userId)}">${esc(member.displayName)}${member.username ? ` (@${esc(member.username)})` : ''}</option>`).join('')}`;
  form.elements.roleId.innerHTML = `<option value="">Choose a role…</option>${options.roles.map(role => `<option value="${esc(role.id)}">@${esc(role.name)}</option>`).join('')}`;
  const preview = () => {
    const values = Object.fromEntries(new FormData(form));
    const level = LEVELS.find(entry => entry[0] === values.level) || LEVELS[0];
    const box = form.querySelector('[data-preview]');
    box.innerHTML = `<div class="nt-dm" style="--lv:${level[3]}"><small>${esc(level[4])}</small><b dir="auto">${esc(values.title || level[4])}</b><p dir="auto">${esc(values.message || 'Your message appears here.')}</p><em>From ${esc(window.me?.user?.username || 'you')} · Rift</em></div>`;
  };
  form.querySelectorAll('[data-target]').forEach(button => button.addEventListener('click', () => {
    target = button.dataset.target;
    form.querySelectorAll('[data-target]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    form.querySelectorAll('[data-for]').forEach(field => { field.hidden = field.dataset.for !== target; });
  }));
  form.addEventListener('input', preview);
  form.addEventListener('change', preview);
  preview();
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    if (target === 'user' && !values.recipientUserId) return toast('Choose a member first.');
    if (target === 'role' && !values.roleId) return toast('Choose a role first.');
    const button = form.querySelector('button[type="submit"]'); button.disabled = true;
    try {
      const result = await api('/api/notifications/admin-note', { method: 'POST', body: JSON.stringify({ ...values, target }) });
      const dm = result.delivery === 'dashboard' ? '' : ` · ${result.sent}/${result.recipients} DMs delivered${result.failed.length ? ` (closed: ${result.failed.slice(0, 3).join(', ')}${result.failed.length > 3 ? '…' : ''})` : ''}`;
      toast(`Sent to ${result.recipients} ${result.recipients === 1 ? 'person' : 'people'}${dm}`);
      form.elements.message.value = ''; form.elements.title.value = ''; preview();
      await refresh();
    } catch (error) { toast(error.message); } finally { button.disabled = false; }
  });
}
