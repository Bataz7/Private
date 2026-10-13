// أسماء أحداث السجل بالعربي وأيقوناتها.
const ACTION_LABEL: Record<string, string> = {
  SHIFT_STARTED: 'بدأ شفت', SHIFT_STARTED_AUTOMATICALLY: 'بدأ شفت تلقائيًا', SHIFT_ENDED: 'أنهى شفت', SHIFT_AUTO_ENDED: 'انتهى شفته تلقائيًا', BREAK_STARTED: 'أخذ بريك', BREAK_RESUMED: 'رجع من البريك',
  LEAVE_REQUESTED: 'طلب إجازة', LEAVE_APPROVED: 'انقبلت إجازته', RETURNED_FROM_LEAVE: 'رجع من الإجازة', RESIGNATION_REQUESTED: 'قدّم استقالة', COMPLAINT_REVIEWED: 'انراجعت شكوى عليه',
  POINTS_ADJUSTED: 'تعديل نقاط', STAFF_DISMISSED: 'فصل', STAFF_REINSTATED: 'الغاء فصل', STAFF_SYNCED: 'مزامنة الستاف', STAFF_WIPED: 'مسح وإعادة تسجيل الستاف', SHIFT_PRESENCE_TIMEOUT: 'انتهى الشفت لعدم الرد على «هل انت موجود؟»', ASSISTANCE_RECORDED: 'ساعد عضو',
  MOD_REPORT_SUBMITTED: 'قدّم تقرير مود', REPORTS_SENT: 'أرسل التقارير', STAFF_NOTE_ADDED: 'ملاحظة جديدة', PRESENCE_CHECK_FAILED: 'ما رد على التحقق من التواجد', WARNING_ISSUED: 'أخذ إنذار',
};
export const actionText = (action: string) => ACTION_LABEL[action] ?? String(action || '').toLowerCase().replace(/_/g, ' ');
const ACTION_ICON: Record<string, string> = { SHIFT: 'alarm', BREAK: 'timer-pause', LEAVE: 'briefcase', RETURNED: 'briefcase', RESIGNATION: 'logout-01', REPORT: 'document-text', REPORTS: 'chart-2', MOD: 'shield-tick', COMPLAINT: 'danger', ASSISTANCE: 'people', POINTS: 'medal-star', STAFF: 'people', WARNING: 'warning-2', PRESENCE: 'radar' };
export const actionIcon = (action: string) => ACTION_ICON[String(action).split('_')[0]!] ?? 'activity';

