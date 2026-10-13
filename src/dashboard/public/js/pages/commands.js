export function render() {
  const actions = [
    ['people', 'Staff Center', 'Manage staff profiles, notes, points, and shift hours.', 'staff', 'Open Staff'],
    ['medal-star', 'Rift Points', 'Shift activity, chat, voice interaction, and the private points card.', 'points', 'Open Points'],
    ['chart-2', 'Reports', 'Performance reports, weekly summaries, and staff cards.', 'reports', 'Open Reports'],
    ['danger', 'Complaints', 'Review complaints, deduct points, and record decisions.', 'complaints', 'Open Complaints'],
    ['briefcase', 'Leave Requests', 'Approve, reject, or track staff leave requests.', 'leaves', 'Open Leaves'],
    ['logout-01', 'Resignations', 'Create, review, and approve resignation requests.', 'resignations', 'Open Resignations'],
    ['radar', 'Bot Status', 'Set the bot presence and rotating custom status.', 'status', 'Open Status'],
    ['setting-2', 'Server Settings', 'Set up the roles, channels, and behavior of Rift.', 'settings', 'Open Settings']
  ];
  return `<div class="section-head"><div><span class="eyebrow">RIFT / QUICK ACTIONS</span><h1>Commands & Shortcuts</h1><p>Run your most important management operations from one place instead of moving between many commands.</p></div></div><div class="command-grid">${actions.map(([icon, title, description, view, label]) => `<button class="command-card" data-view="${view}"><span class="command-icon"><mx-i name="${icon}" size="22"></mx-i></span><span class="command-copy"><b>${title}</b><small>${description}</small></span><span class="command-arrow"><mx-i name="arrow-right-01" size="16"></mx-i></span><em>${label}</em></button>`).join('')}</div><section class="command-note panel"><div class="panel-head"><div><h3>Discord slash commands</h3><p>Staff use <code>/shift</code>, <code>/rating</code>, <code>/complaint</code>, <code>/leave</code>, and <code>/resignation</code> directly in Discord. Private results (points, reports, ratings) stay visible only to the staff member who requested them.</p></div><span class="tag approved">RIFT CONTROL</span></div></section>`;
}
