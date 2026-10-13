import { $, api, toast } from './js/ui.js';
import * as overview from './js/pages/overview.js';
import * as staffPage from './js/pages/staff.js';
import * as shiftsPage from './js/pages/shifts.js';
import * as requestsPage from './js/pages/requests.js';
import * as statusPage from './js/pages/status.js';
import * as setupPage from './js/pages/setup.js';
import * as commandsPage from './js/pages/commands.js';
import * as pointsPage from './js/pages/points.js';
import * as reportsPage from './js/pages/reports.js';
import * as notificationsPage from './js/pages/notifications.js';

const route = location.pathname.match(/^\/dashboard\/?([^/]*)/i)?.[1]?.toLowerCase();
const state = { data: null, me: null, notifications: { notifications: [], unread: 0 }, managementUsers: [], view: route && ['overview','staff','points','reports','commands','complaints','resignations','leaves','status','settings','notifications'].includes(route) ? route : 'overview', selected: null, lang: 'en' };
const titles = { overview: 'Overview', staff: 'Staff', points: 'Points', reports: 'Reports', commands: 'Commands', complaints: 'Complaints', resignations: 'Resignations', leaves: 'Leaves', status: 'Bot status', settings: 'Server settings', notifications: 'Notifications' };
let setupCacheKey = '';
let setupHtmlPromise = null;

function mountSetup(settings) {
  const mount = $('#setupMount');
  if (!mount) return;
  const cacheKey = JSON.stringify(settings || {});
  if (!setupHtmlPromise || cacheKey !== setupCacheKey) {
    setupCacheKey = cacheKey;
    setupHtmlPromise = setupPage.render(settings || {}).catch(error => { setupHtmlPromise = null; throw error; });
  }
  setupHtmlPromise.then(html => {
    if ($('#setupMount') !== mount) return;
    mount.innerHTML = html.replaceAll('OWNER ONLY', 'ADMINISTRATOR').replaceAll('Owner-only', 'Administrator-only');
    setupPage.bind();
    const ratingChannel = document.querySelector('#ratingChannelId');
    if (ratingChannel) ratingChannel.value = settings?.ratingChannelId || '';
  }).catch(error => {
    if ($('#setupMount') === mount) mount.innerHTML = `<section class="panel setup-error"><h2>Setup access required</h2><p>${error.message}</p><button class="primary" onclick="location.reload()">Retry</button></section>`;
  });
}

function render() {
  const data = state.data;
  if (!data) return;
  if (!data.settings) {
    $('#app').classList.remove('hidden');
    $('#view').innerHTML = '<div id="setupMount"></div>';
    mountSetup(state.data.settings || {});
    return;
  }
  const topActions = document.querySelector('.top-actions');
  if (topActions && !document.querySelector('#notificationButton')) topActions.insertAdjacentHTML('afterbegin', '<button class="icon-btn notification-button" id="notificationButton" title="Notifications" aria-label="Notifications"><iconify-icon icon="solar:bell-linear"></iconify-icon><b id="notificationCount" class="notification-count hidden">0</b></button>');
  $('#staffCount').textContent = data.staff.length;
  $('#complaintCount').textContent = data.complaints.filter(item => item.status === 'pending').length;
  $('#resignationCount') && ($('#resignationCount').textContent = (data.resignations || []).filter(item => item.status === 'pending').length);
  $('#leaveCount') && ($('#leaveCount').textContent = (data.leaves || []).filter(item => item.status === 'pending').length);
  const notificationCount = $('#notificationCount');
  const notificationNavCount = $('#notificationNavCount');
  [notificationCount, notificationNavCount].forEach(element => { if (element) { element.textContent = String(state.notifications?.unread || 0); element.classList.toggle('hidden', !(state.notifications?.unread)); } });
  $('#myRatingBadge') && (() => { const rating = data.viewer?.averageRating ?? 0; $('#myRatingBadge').innerHTML = `★ <b>${Number(rating).toFixed(1)}</b> / 5`; $('#myRatingBadge').classList.toggle('hidden', !data.viewer); })();
  const guild = data.guild || {};
  $('#serverName').textContent = guild.name || data.guildId;
  $('#serverIcon').innerHTML = guild.icon ? `<img src="${guild.icon}" class="user-avatar">` : (guild.name || data.guildId || 'M').slice(0, 1).toUpperCase();
  if (state.me) { $('#userName').textContent = state.me.username; $('#userAvatar').innerHTML = state.me.avatar ? `<img src="https://cdn.discordapp.com/avatars/${state.me.id}/${state.me.avatar}.png" alt="">` : state.me.username[0].toUpperCase(); }
  document.querySelectorAll('.owner-only').forEach(item => item.classList.toggle('hidden', !(state.me?.isOwner || state.me?.isAdministrator)));
  document.querySelectorAll('.admin-only').forEach(item => item.classList.toggle('hidden', !(state.me?.isOwner || state.me?.isAdministrator)));
  document.querySelectorAll('[data-action="staff-add"],[data-action="reset-all-staff"],[data-action="remove-staff"],[data-action="edit-points"]').forEach(item => item.classList.toggle('hidden', !(state.me?.isOwner || state.me?.isAdministrator)));
  $('#pageName').textContent = titles[state.view];
  $('#pageTitle').textContent = state.view === 'overview' ? 'Good morning, Rift team' : titles[state.view];
  const page = state.view === 'overview' ? overview.render(data) : state.view === 'staff' ? staffPage.render(data, state.selected) : state.view === 'shifts' ? shiftsPage.render(data) : state.view === 'points' ? pointsPage.render(data) : state.view === 'reports' ? reportsPage.render(data, state.me) : state.view === 'commands' ? commandsPage.render() : state.view === 'complaints' ? requestsPage.complaints(data) : state.view === 'resignations' ? requestsPage.resignations(data) : state.view === 'leaves' ? requestsPage.leaves(data) : state.view === 'notifications' ? notificationsPage.render(data, state) : state.view === 'settings' ? '<div id="setupMount"></div>' : statusPage.render(data);
  $('#view').innerHTML = page;
  if (state.view === 'resignations') {
    const resignationDate = document.querySelector('#resignationForm input[name="lastWorkingDay"]');
    if (resignationDate) {
      const today = new Date();
      const isoToday = today.toISOString().slice(0, 10);
      today.setFullYear(today.getFullYear() + 1);
      resignationDate.min = isoToday;
      resignationDate.max = today.toISOString().slice(0, 10);
    }
  }
  if (state.view === 'staff' && state.selected) {
    const selectedStaff = data.staff.find(item => item.userId === state.selected);
    document.querySelectorAll('#profile .profile-metric').forEach(metric => {
      const label = metric.querySelector('small');
      const value = metric.querySelector('strong');
      if (!label || !value || !selectedStaff) return;
      if (label.textContent === 'Activity hours') { label.textContent = 'People helped'; value.textContent = String(selectedStaff.claimed || 0); }
      if (label.textContent === 'Voice hours') { label.textContent = 'Approved complaints'; value.textContent = String(selectedStaff.complaintCount || 0); }
    });
    const profileCover = document.querySelector('#profile .profile-cover');
    if (profileCover && (!profileCover.style.backgroundImage || profileCover.style.backgroundImage.includes('url(\"\")') || profileCover.style.backgroundImage.includes("url('')"))) profileCover.style.backgroundImage = "url('/default-banner.svg')";
  }
  if (!document.body.dataset.dashboardEntered) {
    document.body.dataset.dashboardEntered = 'true';
    $('#view').classList.add('page-enter');
    setTimeout(() => $('#view')?.classList.remove('page-enter'), 520);
  }
  document.querySelectorAll('[data-action="staff-add"],[data-action="reset-all-staff"]').forEach(item => item.classList.toggle('hidden', !(state.me?.isOwner || state.me?.isAdministrator)));
  if (state.view === 'shifts') loadShiftPanelOptions();
  if (state.view === 'leaves') loadLeavePanelOptions();
  const langBtn = languages.find(item => item[0] === (data.settings?.botLanguage || state.lang));
  if (langBtn) $('#languageButton span').textContent = langBtn[2];
  if (state.view === 'settings') mountSetup(data.settings || {});
  if (state.view === 'reports') reportsPage.bind();
  if (state.view === 'notifications') notificationsPage.bind(state, loadNotifications);
  bindPageEvents();
}

function bindPageEvents() {
  document.querySelectorAll('[data-view]').forEach(item => item.addEventListener('click', () => navigate(item.dataset.view)));
  document.querySelectorAll('[data-select]').forEach(item => item.addEventListener('click', () => { state.selected = item.dataset.select; render(); }));
  document.querySelectorAll('[data-action="close-profile"]').forEach(item => item.addEventListener('click', () => { state.selected = null; render(); }));
  document.querySelectorAll('[data-staff-menu]').forEach(item => item.addEventListener('click', event => { event.stopPropagation(); openStaffActions(item.dataset.staffMenu); }));
  document.querySelectorAll('[data-complaint]').forEach(item => item.addEventListener('click', () => reviewComplaint(item.dataset.complaint, item.dataset.status)));
  document.querySelectorAll('[data-resignation]').forEach(item => item.addEventListener('click', () => reviewResignation(item.dataset.resignation, item.dataset.status)));
  document.querySelectorAll('[data-leave]').forEach(item => item.addEventListener('click', () => reviewLeave(item.dataset.leave, item.dataset.status)));
  $('[data-action="refresh"]')?.addEventListener('click', load);
  $('[data-action="staff-add"]')?.addEventListener('click', openStaffModal);
  $('[data-action="reset-all-staff"]')?.addEventListener('click', resetAllStaff);
  $('[data-action="edit-points"]')?.addEventListener('click', editPoints);
  $('[data-action="set-shift-hours"]')?.addEventListener('click', setShiftHours);
  $('[data-action="remove-staff"]')?.addEventListener('click', removeStaff);
  document.querySelectorAll('[data-bot-status]').forEach(item => item.addEventListener('click', () => updateBotStatus(item.dataset.botStatus)));
  $('#customStatusForm')?.addEventListener('submit', updateCustomStatus);
  $('#notificationButton')?.addEventListener('click', () => navigate('notifications'));
  $('#devModeForm')?.addEventListener('submit', updateDevMode);
  $('#staffSearch')?.addEventListener('input', event => document.querySelectorAll('.staff-card').forEach(card => { card.style.display = card.textContent.toLowerCase().includes(event.target.value.toLowerCase()) ? '' : 'none'; }));
  $('[data-action="send-shift-panel"]')?.addEventListener('click', sendShiftPanel);
  $('[data-action="send-leave-panel"]')?.addEventListener('click', sendLeavePanel);
  $('[data-action="create-resignation"]')?.addEventListener('click', () => $('#resignationCreate')?.classList.toggle('hidden'));
  $('[data-action="create-leave"]')?.addEventListener('click', () => $('#leaveCreate')?.classList.toggle('hidden'));
  $('#resignationForm')?.addEventListener('submit', createResignation);
  $('#leaveForm')?.addEventListener('submit', createLeave);
}
function navigate(view) { state.view = view; history.pushState({}, '', `/dashboard/${view}`); document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === view)); render(); }
let managedStaffId = null;
function openStaffModal() { $('#staffModal').classList.remove('hidden'); $('#staffModal').setAttribute('aria-hidden', 'false'); $('#staffForm input[name="userId"]').focus(); }
function openStaffActions(userId) { const staff = state.data.staff.find(item => item.userId === userId); if (!staff) return; managedStaffId = userId; $('#manageStaffName').textContent = staff.displayName; $('#manageStaffModal').classList.remove('hidden'); $('#manageStaffModal').setAttribute('aria-hidden', 'false'); }
function closeManageModal() { $('#manageStaffModal').classList.add('hidden'); $('#manageStaffModal').setAttribute('aria-hidden', 'true'); managedStaffId = null; }
function closeStaffModal() { $('#staffModal').classList.add('hidden'); $('#staffModal').setAttribute('aria-hidden', 'true'); $('#staffForm').reset(); const points = $('#staffForm input[name="points"]'); if (points) points.value = '0'; const claimed = $('#staffForm input[name="claimed"]'); if (claimed) claimed.value = '0'; }
async function addStaff(event) { event?.preventDefault(); const form = $('#staffForm'); if (!form?.reportValidity()) return; try { const body = Object.fromEntries(new FormData(form)); const result = await api('/api/staff', { method: 'POST', body: JSON.stringify(body) }); closeStaffModal(); toast(result.roleAssigned ? 'Staff added and role assigned' : 'Staff added to Rift; move Staff Role above the bot role'); await load(); } catch (error) { toast(error.message); } }
function openActionModal(title, description, fields, submit) { $('#actionModalTitle').textContent=title; $('#actionModalDescription').textContent=description; const form=$('#actionModalForm'); form.innerHTML=fields.map(field=>`<label class="modal-field full"><span>${field.label}</span><input name="${field.name}" type="${field.type||'text'}" value="${field.value??''}" placeholder="${field.placeholder||''}" min="0"></label>`).join('')+'<div class="modal-actions full"><button class="secondary" type="button" id="actionCancel">Cancel</button><button class="primary" type="submit">Apply</button></div>'; $('#actionModal').classList.remove('hidden'); $('#actionModalClose').onclick=closeActionModal; $('#actionCancel').onclick=closeActionModal; form.onsubmit=async event=>{event.preventDefault();try{await submit(Object.fromEntries(new FormData(form)));closeActionModal();await load();}catch(error){toast(error.message)}}; }
function closeActionModal(){ $('#actionModal').classList.add('hidden'); $('#actionModalForm').reset(); }
async function removeStaff(event) { const userId = event.currentTarget.dataset.user; if (!userId) return; openActionModal('Remove from Staff','This will deactivate the staff profile and remove its role.',[],async()=>{await api(`/api/staff/${userId}`,{method:'DELETE'});state.selected=null;toast('Staff member removed');}); }
async function resetAllStaff() { openActionModal('Reset All Staff','This clears points, assists, messages, voice time, shift hours, and active shifts for every Staff member.',[],async()=>{const result=await api('/api/staff/reset-all',{method:'POST'});toast(`Reset ${result.count} staff members`);await load();}); }
async function manageStaffAction(event) { const action=event.currentTarget.dataset.manageAction; const userId=managedStaffId; if(!userId)return; closeManageModal(); const staff=state.data.staff.find(item=>item.userId===userId); if(action==='profile')return openProfileEditModal(userId,staff); if(action==='note')return openNoteModal(userId); if(action==='adjust')return openStatsAdjustModal(userId,staff); if(action==='reset')return openActionModal('Reset Stats','This will set points, helped, messages and voice time to zero.',[],async()=>{await api(`/api/staff/${userId}/reset`,{method:'POST'});toast('Stats reset')}); if(action==='reset-shift-hours')return openActionModal('Reset Shift Hours','This permanently clears the saved shift history for this staff member.',[],async()=>{await api(`/api/staff/${userId}/reset-shift-hours`,{method:'POST'});toast('Shift hours reset')}); if(action==='remove')return removeStaff({currentTarget:{dataset:{user:userId}}}); }
const STAFF_STATUSES = [['active','🟢 Active'],['on_leave','🟡 On Leave'],['retired','🔴 Retired'],['suspended','⚫ Suspended']];
function openProfileEditModal(userId, staff) {
  $('#actionModalTitle').textContent = `Edit profile — ${staff?.displayName || 'Staff member'}`;
  $('#actionModalDescription').textContent = 'Update the rank and status shown on this staff profile.';
  const form = $('#actionModalForm');
  form.innerHTML = `<label class="modal-field full"><span>Rank</span><input name="rank" value="${staff?.rank ? String(staff.rank).replace(/"/g, '&quot;') : ''}" placeholder="e.g. Moderator"></label><label class="modal-field full"><span>Status</span><select name="status">${STAFF_STATUSES.map(([value, label]) => `<option value="${value}" ${staff?.status === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><div class="modal-actions full"><button class="secondary" type="button" id="actionCancel">Cancel</button><button class="primary" type="submit">Save</button></div>`;
  $('#actionModal').classList.remove('hidden');
  $('#actionModal').setAttribute('aria-hidden', 'false');
  $('#actionModalClose').onclick = closeActionModal;
  $('#actionCancel').onclick = closeActionModal;
  form.onsubmit = async event => { event.preventDefault(); const body = Object.fromEntries(new FormData(form)); try { await api(`/api/staff/${userId}`, { method: 'PATCH', body: JSON.stringify(body) }); closeActionModal(); toast('Profile updated'); await load(); } catch (error) { toast(error.message); } };
}
function openNoteModal(userId) {
  $('#actionModalTitle').textContent = 'Add staff note';
  $('#actionModalDescription').textContent = 'This note is private and visible to management only.';
  const form = $('#actionModalForm');
  form.innerHTML = `<label class="modal-field full"><span>Note</span><textarea name="text" rows="4" maxlength="1000" placeholder="Write a note..."></textarea></label><div class="modal-actions full"><button class="secondary" type="button" id="actionCancel">Cancel</button><button class="primary" type="submit">Save note</button></div>`;
  $('#actionModal').classList.remove('hidden');
  $('#actionModal').setAttribute('aria-hidden', 'false');
  $('#actionModalClose').onclick = closeActionModal;
  $('#actionCancel').onclick = closeActionModal;
  form.onsubmit = async event => { event.preventDefault(); const body = Object.fromEntries(new FormData(form)); if (!String(body.text || '').trim()) return toast('Write a note first'); try { await api(`/api/staff/${userId}/notes`, { method: 'POST', body: JSON.stringify(body) }); closeActionModal(); toast('Note added'); await load(); } catch (error) { toast(error.message); } };
}
function openStatsAdjustModal(userId, staff) {
  const current = { points: Number(staff?.points || 0), claimed: Number(staff?.claimed || 0), shiftHours: Number(staff?.shiftHours || 0) };
  $('#actionModalTitle').textContent = `Manage ${staff?.displayName || 'Staff member'}`;
  $('#actionModalDescription').textContent = 'Adjust the performance counters used by your staff team.';
  const form = $('#actionModalForm');
  form.innerHTML = `<div class="adjust-tabs full" role="tablist"><button type="button" class="adjust-tab active" data-mode="add">+ Add</button><button type="button" class="adjust-tab" data-mode="subtract">- Subtract</button><button type="button" class="adjust-tab" data-mode="set">= Set</button></div><p class="adjust-help full">Choose a mode, then update points, assists, or total shift hours.</p>${[['points','Points'],['claimed','Assists'],['shiftHours','Shift hours']].map(([name, label]) => `<label class="modal-field full"><span>${label}<small>now ${name === 'shiftHours' ? current[name].toFixed(1) + 'h' : current[name]}</small></span><input name="${name}" type="number" min="0" step="${name === 'shiftHours' ? '0.1' : '1'}" placeholder="0"></label>`).join('')}<input name="mode" type="hidden" value="add"><div class="modal-actions full"><button class="secondary" type="button" id="actionCancel">Back</button><button class="primary" type="submit">Apply</button></div>`;
  $('#actionModal').classList.remove('hidden');
  $('#actionModal').setAttribute('aria-hidden', 'false');
  $('#actionModalClose').onclick = closeActionModal;
  $('#actionCancel').onclick = closeActionModal;
  form.querySelectorAll('.adjust-tab').forEach(tab => tab.onclick = () => { form.querySelectorAll('.adjust-tab').forEach(item => item.classList.toggle('active', item === tab)); form.elements.mode.value = tab.dataset.mode; });
  form.onsubmit = async event => { event.preventDefault(); const data = Object.fromEntries(new FormData(form)); const mode = data.mode; const value = name => { if (data[name] === '' || data[name] === undefined) return current[name]; const amount = Math.max(0, Number(data[name])); return Math.max(0, mode === 'add' ? current[name] + amount : mode === 'subtract' ? current[name] - amount : amount); }; try { await api(`/api/staff/${userId}`, { method: 'PATCH', body: JSON.stringify({ points: value('points'), claimed: value('claimed'), shiftHours: value('shiftHours') }) }); closeActionModal(); toast('Staff metrics updated'); await load(); } catch (error) { toast(error.message); } };
}
async function editPoints() { const selected=state.data.staff.find(item=>item.userId===state.selected); if(!selected)return; openStatsAdjustModal(selected.userId,selected); }
async function setShiftHours() { const selected=state.data.staff.find(item=>item.userId===state.selected); if(!selected)return; openActionModal('Set Shift Hours','Replace this staff member\'s saved shift total.',[{name:'shiftHours',label:'Shift hours',type:'number',value:selected.shiftHours}],async body=>{await api(`/api/staff/${selected.userId}`,{method:'PATCH',body:JSON.stringify({shiftHours:body.shiftHours})});toast('Shift hours updated')}); }
async function reviewComplaint(id,status) { openActionModal(status==='approved'?'Approve Complaint':'Reject Complaint','Record the decision and optional note.',[{name:'penaltyPoints',label:'Penalty points',type:'number',value:status==='approved'?1:0},{name:'note',label:'Decision note',placeholder:'Optional note'}],async body=>{await api(`/api/complaints/${id}`,{method:'PATCH',body:JSON.stringify({status,...body})});toast('Decision saved')}); }
async function createResignation(event) { event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return; try { const body = Object.fromEntries(new FormData(form)); body.userId = state.me?.id || ''; body.last_day = body.lastWorkingDay; await api('/api/resignations', { method: 'POST', body: JSON.stringify(body) }); toast('Request created and a private notification was sent'); await load(); } catch (error) { toast(error.message); } }
async function reviewResignation(id,status){openActionModal(status==='accepted'?'Approve Resignation':'Reject Resignation','Add an optional decision note.',[{name:'note',label:'Decision note'}],async body=>{await api(`/api/resignations/${id}`,{method:'PATCH',body:JSON.stringify({status,...body})});toast('Decision saved');await load()})}
async function createLeave(event) { event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return; try { const body = Object.fromEntries(new FormData(form)); body.userId = state.me?.id || ''; body.start = body.startDate; body.end = body.endDate; await api('/api/leaves', { method: 'POST', body: JSON.stringify(body) }); toast('Leave request created and sent to the channel'); await load(); } catch (error) { toast(error.message); } }
async function reviewLeave(id,status){openActionModal(status==='approved'?'Approve Leave':'Reject Leave','Add an optional decision note.',[{name:'note',label:'Decision note'}],async body=>{await api(`/api/leaves/${id}`,{method:'PATCH',body:JSON.stringify({status,...body})});toast('Decision saved');await load()})}
async function updateBotStatus(status) { try { await api('/api/bot/status', { method: 'PATCH', body: JSON.stringify({ status }) }); toast('Bot status updated'); await load(); } catch (error) { toast(error.message); } }
async function updateCustomStatus(event) { event.preventDefault(); const form = event.currentTarget; const body = Object.fromEntries(new FormData(form)); body.statuses = String(body.statuses || '').split('\n').map(item => item.trim()).filter(Boolean); try { await api('/api/bot/custom-status', { method: 'PATCH', body: JSON.stringify(body) }); toast('Custom status saved'); await load(); } catch (error) { toast(error.message); } }
async function updateDevMode(event) { event.preventDefault(); const enabled = !Boolean(state.data?.settings?.devMode); try { await api('/api/settings/dev-mode', { method: 'PATCH', body: JSON.stringify({ enabled }) }); toast(enabled ? 'Developer mode enabled' : 'Developer mode disabled'); await load(); } catch (error) { toast(error.message); } }
async function loadShiftPanelOptions() { try { const result = await api('/api/panel/options'); const select = $('#shiftPanelChannel'); if (!select) return; select.innerHTML = '<option value="">Select a shift channel...</option>' + result.channels.map(channel => `<option value="${channel.id}">${channel.name}</option>`).join(''); } catch (error) { toast(error.message); } }
async function sendShiftPanel() { const channelId = $('#shiftPanelChannel')?.value; if (!channelId) return toast('Select a channel first'); try { const result = await api('/api/shifts/panel', { method: 'POST', body: JSON.stringify({ channelId }) }); toast(result.updated ? 'Shift Panel updated' : 'Shift Panel published'); } catch (error) { toast(error.message); } }
async function loadLeavePanelOptions() { try { const result = await api('/api/leave-panel/options'); const select = $('#leavePanelChannel'); if (!select) return; select.innerHTML = '<option value="">Select a channel...</option>' + result.channels.map(channel => `<option value="${channel.id}">${channel.name}</option>`).join(''); } catch (error) { toast(error.message); } }
async function sendLeavePanel() { const channelId = $('#leavePanelChannel')?.value; if (!channelId) return toast('Select a channel first'); try { const result = await api('/api/leaves/panel', { method: 'POST', body: JSON.stringify({ channelId }) }); toast(result.updated ? 'Leave Panel updated' : 'Leave Panel published'); } catch (error) { toast(error.message); } }
async function switchServer() { try { const result = await api('/api/guilds'); const fields = result.guilds.map((guild, index) => ({name:String(index + 1),label:guild.name,placeholder:guild.id})); openActionModal('Switch Server','Choose a server number.',[{name:'server',label:'Server number',type:'number',value:1,placeholder:fields.map(field=>`${field.name}. ${field.label}`).join(' | ')}],async body=>{const guild=result.guilds[Number(body.server)-1];if(!guild)throw Error('Invalid server number');await api('/api/guilds/select',{method:'POST',body:JSON.stringify({guildId:guild.id})});state.selected=null;toast('Server switched')}); } catch (error) { toast(error.message); } }
async function load() {
  try {
    state.me = (await api('/api/me')).user;
    if (!state.me) { window.location.assign('/login'); return; }
    try {
      state.data = await api('/api/bootstrap');
    } catch (bootstrapError) {
      state.data = { settings: null };
    }
    await loadNotifications();
    $('#app').classList.remove('hidden');
    if (!state.data.settings) state.view = 'settings';
    render();
  } catch (error) {
    try {
      const me = await api('/api/me');
      if (me.user) {
        state.me = me.user;
        state.data = { settings: null };
        $('#app').classList.remove('hidden');
        state.view = 'settings';
        render();
        return;
      }
    } catch {}
    window.location.assign('/login');
  }
}

async function loadNotifications() {
  try {
    const notifications = await api('/api/notifications');
    state.notifications = notifications;
    if (state.me?.isOwner || state.me?.isAdministrator) {
      const management = await api('/api/management-users');
      state.managementUsers = management.users || [];
    }
    const count = $('#notificationCount');
    const navCount = $('#notificationNavCount');
    [count, navCount].forEach(element => { if (element) { element.textContent = String(notifications.unread || 0); element.classList.toggle('hidden', !notifications.unread); } });
    if (state.view === 'notifications' && state.data) render();
  } catch (error) {
    console.warn('Notifications unavailable:', error.message);
  }
}

const authErrors = { oauth: 'Discord OAuth could not be completed.', oauth_token: 'This Discord login code expired. Click Continue with Discord again.', oauth_user: 'Discord account lookup failed.', oauth_guilds: 'Discord server lookup failed.', server: 'No server was found where Rift is installed.', member: 'Rift could not read your server membership.', forbidden: 'You need to be the owner, an Administrator, or Staff.', oauth_session: 'Your login session expired. Start Discord login again.' };
const authError = new URLSearchParams(location.search).get('error');
if (authError && authErrors[authError]) toast(authErrors[authError]);

const languages = [['en','🇬🇧','English'],['ar','🇸🇦','العربية']];
const themes = [['rift','○','Rift','Calm dark navy with a soft blue glow'],['void-dark','●','Void Dark Theme','Pure black and white for maximum focus'],['sky','○','Sky','Calm light blue for a clear, airy workspace'],['dark-purple','●','Dark Purple','Discord-native purple on neutral charcoal'],['graphite','●','Graphite','Soft gray surfaces with violet accents'],['slate','◆','Slate','Cool blue-gray for focused work'],['midnight','◐','Midnight','Deep navy with twilight accents'],['light-gray','○','Light Gray','Clean light surfaces with clear contrast'],['ocean','◆','Ocean','Deep sea blue with electric teal'],['forest','●','Forest','Earthy greens for calm operations'],['sunset','●','Sunset','Warm coral with golden accents']];
function activeTheme() { return [...document.body.classList].find(name => name.startsWith('theme-'))?.slice(6) || 'rift'; }
function renderPickers() { const selectedTheme = activeTheme(); $('#themeMenu').innerHTML = themes.map(item => `<button class="picker-option" data-theme="${item[0]}" data-selected="${item[0] === selectedTheme}"><i class="swatch swatch-${item[0]}">${item[1]}</i><span><b>${item[2]}</b><small>${item[3]}</small></span><em>✓</em></button>`).join(''); $('#languageMenu').innerHTML = languages.map(item => `<button class="picker-option" data-language="${item[0]}"><i class="flag">${item[1]}</i><span><b>${item[2]}</b><small>${item[0] === 'en' ? 'English interface' : 'Dashboard language'}</small></span><em>✓</em></button>`).join(''); }
function setTheme(theme) { document.body.className = document.body.className.replace(/theme-[\w-]+/g, '').trim(); document.body.classList.add(`theme-${theme}`); localStorage.setItem('rift-theme', theme); $('#themeButton span').textContent = themes.find(item => item[0] === theme)?.[2] || theme; document.querySelectorAll('[data-theme]').forEach(item => item.dataset.selected = String(item.dataset.theme === theme)); $('#themeMenu').classList.remove('open'); }
function setLanguage(language) { state.lang = language; document.documentElement.lang = language; document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr'; $('#languageButton span').textContent = languages.find(item => item[0] === language)?.[2] || language; $('#languageMenu').classList.remove('open'); render(); }
$('#logout').onclick = async () => { await api('/auth/logout', { method: 'POST' }); location.reload(); };
$('#refresh').onclick = load;
renderPickers(); $('#themeButton').onclick = () => $('#themeMenu').classList.toggle('open'); $('#languageButton').onclick = () => $('#languageMenu').classList.toggle('open'); document.addEventListener('click', event => { if (!event.target.closest('.picker')) document.querySelectorAll('.picker-menu').forEach(menu => menu.classList.remove('open')); }); document.addEventListener('click', event => { const theme = event.target.closest('[data-theme]')?.dataset.theme; const language = event.target.closest('[data-language]')?.dataset.language; if (theme) setTheme(theme); if (language) setLanguage(language); });
$('#serverSelector').onclick = switchServer;
$('#staffModalClose').onclick = closeStaffModal;
$('#staffModalCancel').onclick = closeStaffModal;
$('#staffForm').addEventListener('submit', addStaff);
$('#staffModal').addEventListener('click', event => { if (event.target.id === 'staffModal') closeStaffModal(); });
$('#manageModalClose').onclick = closeManageModal;
$('#manageStaffModal').addEventListener('click', event => { if (event.target.id === 'manageStaffModal') closeManageModal(); });
document.querySelectorAll('[data-manage-action]').forEach(item => item.addEventListener('click', manageStaffAction));
document.querySelectorAll('.nav-item[data-view]').forEach(item => item.addEventListener('click', () => navigate(item.dataset.view)));
const savedTheme = localStorage.getItem('rift-theme') || 'rift'; setTheme(savedTheme); $('#languageButton span').textContent = 'English';
load();
setInterval(loadNotifications, 30000);
