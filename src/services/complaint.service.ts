import { createHash } from 'node:crypto';
import { Complaint } from '../models/Complaint.js';

const inFlightComplaints = new Map<string, Promise<{ complaint: Awaited<ReturnType<typeof Complaint.create>>; created: boolean }>>();

export function complaintDedupeKey(input: { guildId: string; staffUserId: string; reporterUserId: string; reason: string; evidence: string }) {
  const minuteBucket = Math.floor(Date.now() / (10 * 60_000));
  return createHash('sha256')
    .update([input.guildId, input.staffUserId, input.reporterUserId, input.reason.trim(), input.evidence.trim(), minuteBucket].join('\u001f'))
    .digest('hex');
}

export async function createComplaintOnce(input: { guildId: string; staffUserId: string; reporterUserId: string; reason: string; evidence?: string }) {
  const evidence = input.evidence ?? '';
  const dedupeKey = complaintDedupeKey({ ...input, evidence });
  const requestKey = [input.guildId, input.staffUserId, input.reporterUserId, input.reason.trim(), evidence.trim()].join('\u001f');
  const pending = inFlightComplaints.get(requestKey);
  if (pending) return pending;
  const operation = createComplaintRecord(input, evidence, dedupeKey);
  inFlightComplaints.set(requestKey, operation);
  try {
    return await operation;
  } finally {
    inFlightComplaints.delete(requestKey);
  }
}

async function createComplaintRecord(input: { guildId: string; staffUserId: string; reporterUserId: string; reason: string; evidence?: string }, evidence: string, dedupeKey: string) {
  const recent = await Complaint.find({ guildId: input.guildId, staffUserId: input.staffUserId, reporterUserId: input.reporterUserId, reason: input.reason, evidence, status: 'pending' }).sort({ createdAt: -1 }).limit(10);
  const existing = recent.find(row => Date.now() - new Date(row.createdAt).getTime() < 10 * 60_000);
  if (existing) return { complaint: existing, created: false };
  try {
    const complaint = await Complaint.create({ ...input, evidence, dedupeKey });
    return { complaint, created: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('dedupe_key') && !message.includes('duplicate key')) {
      const complaint = await Complaint.create({ ...input, evidence });
      return { complaint, created: true };
    }
    if (!message.includes('complaints_dedupe_key') && !message.includes('duplicate key')) throw error;
    const duplicateRows = await Complaint.find({ guildId: input.guildId, staffUserId: input.staffUserId, reporterUserId: input.reporterUserId, reason: input.reason, evidence, status: 'pending' }).sort({ createdAt: -1 }).limit(10);
    const duplicate = duplicateRows.find(row => Date.now() - new Date(row.createdAt).getTime() < 10 * 60_000);
    if (!duplicate) throw error;
    return { complaint: duplicate, created: false };
  }
}
