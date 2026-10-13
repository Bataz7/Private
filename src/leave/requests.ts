import { LeaveRequest, type LeaveRequestDoc } from '../models/LeaveRequest.js';
import { ResignationRequest, type ResignationRequestDoc } from '../models/ResignationRequest.js';
import { toId } from './db.js';

// Finding and creating requests. Conditional updates live in db.ts (claim).
const byAge = (a: { createdAt: Date; id: number }, b: { createdAt: Date; id: number }) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.id - b.id;

// ---- leave -----------------------------------------------------------------------------------------
export async function findLeave(id: unknown): Promise<LeaveRequestDoc | null> {
  const numeric = toId(id);
  return numeric ? (await LeaveRequest.findOne({ id: numeric })) as LeaveRequestDoc | null : null;
}

/** An open leave (waiting or running) blocks a new one. */
export async function findBlockingLeave(guildId: string, userId: string): Promise<LeaveRequestDoc | null> {
  const rows = await LeaveRequest.find({ guildId, userId }).sort({ createdAt: -1 }).limit(20);
  return rows.find(row => row.status === 'pending' || row.status === 'approved') || null;
}

export async function createLeave(data: { guildId: string; userId: string; startDate: Date; endDate: Date; reason: string }): Promise<LeaveRequestDoc> {
  const created = await LeaveRequest.create({ ...data, reason: String(data.reason || '').slice(0, 1000) });
  // Two requests sent at the same moment both pass the "no open request" check. After creating, the oldest open one wins
  // and the other is removed, so a member never has two open leaves.
  const rows = await LeaveRequest.find({ guildId: data.guildId, userId: data.userId }).sort({ createdAt: 1 }).limit(20);
  const first = rows.filter(row => row.status === 'pending' || row.status === 'approved').sort(byAge)[0];
  if (first && first.id !== created.id) { await LeaveRequest.deleteMany({ id: created.id }); throw new Error('You already have an active leave request.'); }
  return created;
}

export async function leaveHistory(guildId: string, userId: string, limit = 5): Promise<LeaveRequestDoc[]> {
  return LeaveRequest.find({ guildId, userId }).sort({ createdAt: -1 }).limit(limit);
}

// ---- resignation -----------------------------------------------------------------------------------
export async function findResignation(id: unknown): Promise<ResignationRequestDoc | null> {
  const numeric = toId(id);
  return numeric ? (await ResignationRequest.findOne({ id: numeric })) as ResignationRequestDoc | null : null;
}

/** Only open requests block a new one; a completed resignation must not stop someone who is rehired later. */
export async function findBlockingResignation(guildId: string, userId: string): Promise<ResignationRequestDoc | null> {
  const rows = await ResignationRequest.find({ guildId, userId }).sort({ createdAt: -1 }).limit(20);
  return rows.find(row => row.status === 'pending' || row.status === 'approved') || null;
}

export async function createResignation(data: { guildId: string; userId: string; lastWorkingDay: Date; reason: string; notes?: string }): Promise<ResignationRequestDoc> {
  const created = await ResignationRequest.create({ ...data, reason: String(data.reason || '').slice(0, 1000), notes: String(data.notes ?? '').slice(0, 1000) });
  const rows = await ResignationRequest.find({ guildId: data.guildId, userId: data.userId }).sort({ createdAt: 1 }).limit(20);
  const first = rows.filter(row => row.status === 'pending' || row.status === 'approved').sort(byAge)[0];
  if (first && first.id !== created.id) { await ResignationRequest.deleteMany({ id: created.id }); throw new Error('You already have an active resignation request.'); }
  return created;
}

export async function resignationHistory(guildId: string, userId: string, limit = 3): Promise<ResignationRequestDoc[]> {
  return ResignationRequest.find({ guildId, userId }).sort({ createdAt: -1 }).limit(limit);
}
