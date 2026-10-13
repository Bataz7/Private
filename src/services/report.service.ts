import { Report } from '../models/Report.js';

export async function createReport(data: {
  guildId: string;
  userId: string;
  title: string;
  content: string;
  type: 'shift_summary' | 'incident' | 'general';
  shiftId?: string | null;
}) {
  return Report.create({
    guildId: data.guildId,
    userId: data.userId,
    title: data.title,
    content: data.content,
    type: data.type,
    shiftId: data.shiftId ?? null,
    status: 'submitted'
  });
}

export async function getReportsByUser(guildId: string, userId: string, limit = 20) {
  return Report.find({ guildId, userId }).sort({ createdAt: -1 }).limit(limit);
}

export async function getPendingReports(guildId: string, limit = 20) {
  return Report.find({ guildId, status: 'submitted' }).sort({ createdAt: 1 }).limit(limit);
}

export async function markReportReviewed(reportId: string, reviewedBy: string) {
  return Report.findByIdAndUpdate(
    reportId,
    { status: 'reviewed', reviewedBy, reviewedAt: new Date() },
    { new: true }
  );
}
