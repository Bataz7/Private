import { HttpError } from './http.js';

// رسائل الأخطاء للمستخدم بالعربي. الأخطاء المتوقعة (رسائل الخدمات) تنترجم؛ أي شي ثاني (قاعدة بيانات، شبكة، كود)
// يتسجل في اللوق ويوصل للمستخدم كرسالة عامة — ما يطلع أي تفاصيل داخلية أو stack trace.

const ARABIC = /[؀-ۿ]/;

const TRANSLATIONS: Record<string, string> = {
  'A link is too long.': 'الرابط طويل مرة.',
  'Accent must be a hex colour like #8175f5.': 'اللون لازم يكون بصيغة hex مثل ‎#8175f5.',
  'Add at least one question.': 'أضف سؤال واحد على الأقل.',
  'Administrator permission is required.': 'تحتاج صلاحية أدمن.',
  'Application not found.': 'التقديم مو موجود.',
  'Choose 1 to 5 stars.': 'اختر من 1 إلى 5 نجوم.',
  'Choose a role.': 'اختر رتبة.',
  'Choose a staff member or administrator of this server.': 'اختر ستاف أو أدمن من هذا السيرفر.',
  'Choose a text channel in this server.': 'اختر روم كتابي في هذا السيرفر.',
  'Choose a valid date.': 'اختر تاريخ صحيح.',
  'Choose a valid delivery method.': 'اختر طريقة إرسال صحيحة.',
  'Could not save because the application was changed at the same time. Try again.': 'ما انحفظ لأن التقديم تعدّل بنفس اللحظة. حاول مرة ثانية.',
  'Discord member not found.': 'العضو مو موجود في ديسكورد.',
  'Give the form a title.': 'اكتب عنوان للنموذج.',
  'Leave request not found.': 'طلب الإجازة مو موجود.',
  'Links must start with http:// or https://': 'الروابط لازم تبدأ بـ http:// أو https://',
  'Nobody matches that choice.': 'ما فيه أحد يطابق اختيارك.',
  'None of the chosen people are active staff.': 'ولا واحد من المختارين ستاف نشط.',
  'On Leave role is not configured.': 'رتبة الإجازة مو محددة في الإعدادات.',
  'Only a running (approved) leave can be extended.': 'تقدر تمدد الإجازة الشغالة (المقبولة) بس.',
  'Only a running leave can be closed.': 'تقدر تنهي الإجازة الشغالة بس.',
  'Only the server owner and Administrators can accept or reject applications.': 'قبول ورفض التقديمات لمالك السيرفر والأدمن بس.',
  'Points changed at the same moment too many times. Try again.': 'النقاط تغيّرت بنفس اللحظة أكثر من مرة. حاول مرة ثانية.',
  'Report not found.': 'التقرير مو موجود.',
  'Resignation request not found.': 'طلب الاستقالة مو موجود.',
  'Server not found.': 'السيرفر مو موجود.',
  'That date is too far away. Choose a date within one year.': 'التاريخ بعيد مرة. اختر تاريخ خلال سنة.',
  'That member is not an active staff member.': 'هذا العضو مو ستاف نشط.',
  'The banner link has characters that are not allowed (quotes, brackets or spaces).': 'رابط البنر فيه رموز مو مسموحة (علامات تنصيص أو أقواس أو مسافات).',
  'The message cannot exceed 2000 characters.': 'الرسالة ما تتعدى 2000 حرف.',
  'The new end date is already in the past.': 'تاريخ النهاية الجديد صار في الماضي.',
  'The new end date must be after the current end date.': 'تاريخ النهاية الجديد لازم يكون بعد الحالي.',
  'The report is being edited, try again.': 'التقرير ينعدّل الحين، حاول مرة ثانية.',
  'There is no extension waiting for a decision.': 'ما فيه طلب تمديد ينتظر قرار.',
  'This application was already reviewed.': 'هذا التقديم انراجع من قبل.',
  'This card is out of date: the member asked for a different date. Use their newest request.': 'هذي البطاقة قديمة: العضو طلب تاريخ ثاني. استخدم آخر طلب له.',
  'This leave is not active.': 'هذي الإجازة مو شغالة.',
  'This report changed, refresh and try again.': 'التقرير تغيّر، حدّث الصفحة وحاول مرة ثانية.',
  'This report is already pending.': 'التقرير بالفعل بانتظار المراجعة.',
  'This report was already reviewed.': 'هذا التقرير انراجع من قبل.',
  'This request is no longer pending.': 'هذا الطلب ما عاد معلّق.',
  'This request was already decided.': 'هذا الطلب انحسم من قبل.',
  'This resignation is no longer awaiting confirmation.': 'هذي الاستقالة ما عادت تنتظر تأكيد.',
  'Voting is closed for this application.': 'التصويت مقفل لهذا التقديم.',
  'Write a message first.': 'اكتب رسالة أول.',
  'Write a note first.': 'اكتب ملاحظة أول.',
  'You already have an active leave request.': 'عندك طلب إجازة شغال.',
  'You already have an active resignation request.': 'عندك طلب استقالة شغال.',
  'You cannot change your own staff points.': 'ما تقدر تعدّل نقاطك بنفسك.',
  'You cannot review your own request.': 'ما تقدر تراجع طلبك بنفسك.',
  'Only administrators can do this.': 'هذا للأدمن فقط.',
};

const PATTERNS: Array<[RegExp, (m: RegExpExecArray) => string]> = [
  [/^Question (\d+) needs a title\.$/, m => `السؤال ${m[1]} يحتاج عنوان.`],
  [/^"(.+)" needs at least two options\.$/, m => `"${m[1]}" يحتاج خيارين على الأقل.`],
  [/^Could not attach (.+?): /, m => `ما قدرنا نرفق ${m[1]}.`],
  [/^@(.+) has moderator or admin permissions/, m => `@${m[1]} فيها صلاحيات إشراف أو أدمن، فما تقدر الأزرار والقوائم تعطيها.`],
  [/^@(.+) is at or above your highest role/, m => `@${m[1]} أعلى من (أو تساوي) أعلى رتبة عندك، فما تقدر تعطيها.`],
];

/** نص الخطأ اللي يوصل للمستخدم (عربي دايماً). */
export function publicMessage(error: unknown, fallback = 'صار خطأ غير متوقع. حاول مرة ثانية.'): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (!message) return fallback;
  if (ARABIC.test(message) && message.length <= 500) return message;
  const direct = TRANSLATIONS[message];
  if (direct) return direct;
  for (const [pattern, build] of PATTERNS) {
    const match = pattern.exec(message);
    if (match) return build(match);
  }
  return fallback;
}

/** كود HTTP مناسب حسب نوع الرسالة (مو موجود 404، تعارض 409، غيره 400). */
export function statusFor(error: unknown) {
  if (error instanceof HttpError) return error.status;
  const message = error instanceof Error ? error.message : '';
  if (/not found|مو موجود/i.test(message)) return 404;
  if (/already|no longer|out of date|changed|at the same|انراجع|انحسم|شغال/i.test(message)) return 409;
  return 400;
}

/** هل الرسالة متوقعة (مكتوبة للمستخدم)؟ غيرها يتسجل في اللوق. */
export const isExpected = (error: unknown) => error instanceof HttpError || publicMessage(error, '') !== '';
