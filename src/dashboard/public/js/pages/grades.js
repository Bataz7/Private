import { api, esc } from '../ui.js';
import { ic } from '../icon.js';

// Grades: how the weekly score and the letter work, where you stand this week, and what it takes to move up.
const PART_ICON = { shift: 'clock', activeDays: 'calendar-tick', voice: 'activity', messages: 'message-text', rating: 'star', clean: 'shield-tick' };
const PARTS = {
  shift: ['Shift time', 'Hours on shift (breaks do not count)', 'hours'],
  activeDays: ['Active days', 'Days with a shift, a message or time in voice', 'days'],
  voice: ['Voice time', 'Hours spent in voice channels while on duty', 'hours'],
  messages: ['Messages', 'Messages you sent in the server', 'messages'],
  rating: ['Member ratings', 'Your average rating from members', ''],
  clean: ['Clean record', 'A bonus for a week without an approved complaint', ''],
};
const TARGET_KEY = { shift: 'shiftHours', activeDays: 'activeDays', voice: 'voiceHours', messages: 'messages' };
const MEANING = {
  S: ['Outstanding', 'You beat the targets in almost everything.'],
  A: ['Excellent', 'Well above what is expected.'],
  B: ['Good', 'A solid week with most targets met.'],
  C: ['Needs work', 'Below the targets. A few more shifts and messages will fix it.'],
  D: ['Low', 'Much less activity than expected this week.'],
};
const num = value => Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 1 });

function mineCard(data) {
  const me = data.me;
  if (!me) return `<section class="panel gr-mine"><div class="panel-head"><div><h3>Your week so far</h3><p>Only active staff members get a personal score.</p></div></div></section>`;
  const ticks = data.grades.map(step => step.min).filter(min => min > 0).sort((a, b) => a - b).map(min => `<i style="inset-inline-start:${min}%"><em>${min}</em></i>`).join('');
  const gap = me.parts.filter(part => !['rating', 'clean'].includes(part.key)).map(part => ({ part, left: part.max - part.earned })).sort((a, b) => b.left - a.left)[0];
  const lines = [
    me.next ? `<b>You need ${me.next.need} more ${me.next.need === 1 ? 'point' : 'points'} to reach ${esc(me.next.letter)} (${me.next.min}).</b>` : '<b>You are at the top grade. Keep it up.</b>',
    me.next && gap && gap.left >= 1 ? `The quickest way up: <b>${esc(PARTS[gap.part.key][0])}</b>, worth up to ${num(gap.left)} more points.` : '',
    me.ratingIsDefault ? `You have no ratings yet, so this part counts as ${data.noRatingDefault} stars until members rate you.` : '',
    me.penalty ? `Approved complaints took ${me.penalty} points off this week.` : '',
  ].filter(Boolean).map(line => `<p>${line}</p>`).join('');
  return `<section class="panel gr-mine"><div class="panel-head"><div><h3>Your week so far</h3><p>Weeks run Monday to Sunday (UTC). Every week starts from zero.</p></div>${me.last ? `<span class="rx-chip">Last week: <b class="rx-g-${esc(me.last.grade)}" style="color:var(--g)">${esc(me.last.grade)}</b> · ${me.last.score}</span>` : ''}</div>
    <div class="gr-mine-body"><div class="gr-badge rx-g-${esc(me.grade)}"><b>${esc(me.grade)}</b><span>${me.score}</span><small>out of 100</small></div>
      <div class="gr-mine-text"><div class="gr-meter" dir="ltr"><i class="rx-g-${esc(me.grade)}" style="width:${Math.max(2, me.score)}%"></i>${ticks}</div>${lines}${me.of > 1 ? `<p class="gr-rank">Rank <b>#${me.rank}</b> of ${me.of} this week</p>` : ''}</div></div>
    <ul class="gr-parts">${me.parts.map(part => {
      const progress = part.key === 'rating' ? `${num(part.value)} / 5` : part.key === 'clean' ? (part.value ? `${part.value} complaint(s)` : 'None') : `${num(part.value)} of ${num(part.target)}`;
      return `<li><span class="gr-ic">${ic(PART_ICON[part.key], { size: 16 })}</span><span class="gr-name"><b>${esc(PARTS[part.key][0])}</b><small>${esc(progress)}</small></span><span class="gr-bar" dir="ltr"><i style="width:${Math.round((part.earned / part.max) * 100)}%"></i></span><em>${num(part.earned)} of ${part.max}</em></li>`;
    }).join('')}${me.penalty ? `<li class="neg"><span class="gr-ic">${ic('danger', { size: 16 })}</span><span class="gr-name"><b>Complaint penalty</b></span><span class="gr-bar"></span><em>−${me.penalty}</em></li>` : ''}</ul></section>`;
}

function ladder(data) {
  const mine = data.me?.grade;
  const steps = data.grades;
  return `<section class="panel gr-card"><div class="panel-head"><div><h3>The grades</h3><p>The letter comes from the score out of 100.</p></div></div>
    <ul class="gr-ladder">${steps.map((step, index) => {
      const [name, text] = MEANING[step.letter];
      const range = step.min === 0 ? `Below ${steps[index - 1].min}` : `${step.min} and above`;
      return `<li class="rx-g-${esc(step.letter)} ${mine === step.letter ? 'is-me' : ''}"><span class="gr-letter">${esc(step.letter)}</span><span class="gr-what"><b>${name}</b><small>${text}</small></span><span class="gr-range">${range}</span>${mine === step.letter ? '<span class="gr-you">You</span>' : ''}</li>`;
    }).join('')}</ul></section>`;
}

function build(data) {
  const w = data.weights;
  const order = ['shift', 'activeDays', 'voice', 'messages', 'rating', 'clean'];
  return `<section class="panel gr-card"><div class="panel-head"><div><h3>How the 100 points are made</h3><p>A part grows step by step as you get closer to its target, and stops growing once you reach it. Doing more than the target adds nothing extra.</p></div></div>
    <ul class="gr-build">${order.map(key => {
      const [title, what, unit] = PARTS[key];
      const target = TARGET_KEY[key] ? data.targets[TARGET_KEY[key]] : null;
      const line = key === 'rating' ? 'Your average star rating out of 5' : key === 'clean' ? 'No approved complaint in the week' : `Target: ${num(target)} ${unit} a week`;
      const example = target ? `<small class="gr-ex">Example: ${num(target / 2)} of ${num(target)} ${unit} gives ${num(w[key] / 2)} of ${w[key]} points.</small>` : '';
      return `<li><span class="gr-ic">${ic(PART_ICON[key], { size: 18 })}</span><span class="gr-name"><b>${title}</b><small>${what}</small><small class="gr-target">${line}</small>${example}</span><em>${w[key]} points</em></li>`;
    }).join('')}</ul>
    <p class="gr-note">${ic('warning-2', { size: 15 })} Each approved complaint takes ${data.penalty.each} points off (up to ${data.penalty.max}) and you lose the ${w.clean} bonus points for that week. Targets are set by administrators in Reports.</p></section>`;
}

function team(data) {
  if (!data.team) return '';
  const rows = data.team.map(item => `<tr data-profile="${esc(item.userId)}"><td class="gr-rk">${item.rank}</td><td class="gr-who">${item.avatar ? `<img src="${esc(item.avatar)}" alt="" loading="lazy">` : '<span class="rx-av"></span>'}<b>${esc(item.displayName)}</b></td><td><span class="gr-pill rx-g-${esc(item.grade)}">${esc(item.grade)}</span> <b>${item.score}</b></td><td>${item.next ? `${item.next.need} to ${esc(item.next.letter)}` : 'Top grade'}</td><td>${num(item.shiftHours)}h</td><td>${num(item.voiceHours)}h</td><td>${num(item.messages)}</td><td>${item.activeDays}</td></tr>`).join('');
  return `<section class="panel gr-card gr-team"><div class="panel-head"><div><h3>Team this week</h3><p>Score so far this week for every active staff member, measured with the same engine as the weekly report.</p></div><span class="rx-chip">${data.team.length} staff</span></div>
    <div class="gr-table-wrap"><table class="gr-table"><thead><tr><th>#</th><th>Staff</th><th>Score</th><th>Next grade</th><th>Shift</th><th>Voice</th><th>Messages</th><th>Active days</th></tr></thead><tbody>${rows || '<tr><td colspan="8" class="rx-empty">No active staff yet.</td></tr>'}</tbody></table></div></section>`;
}

export async function render() {
  try {
    const data = await api('/api/grades');
    return `<div class="gr-page"><div class="section-head"><div><h1>Grades</h1><p>How your weekly score works, what each grade means, and what it takes to move up.</p></div></div>
      <section class="panel gr-intro"><h3>How it works</h3><p>Every Monday Rift measures your previous week (Monday to Sunday, UTC) and gives you a score out of 100. The score decides your grade. Each part of your work has its own share of the 100 points, and you get the full share when you reach the target for it.</p></section>
      ${mineCard(data)}
      <div class="gr-cols">${ladder(data)}${build(data)}</div>
      ${team(data)}</div>`;
  } catch (error) {
    return `<div class="section-head"><div><h1>Grades</h1></div></div><div class="error-state"><h3>Could not load grades</h3><p>${esc(error.message)}</p></div>`;
  }
}
