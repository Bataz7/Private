/** أخطاء HTTP برسائل عربية + ترجمتها للإنجليزي حسب لغة الواجهة. */

export class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly headers?: Record<string, string>) {
    super(message);
  }
}

/** يرمي خطأ HTTP (للاختصار داخل الدوال). */
export function fail(status: number, message: string): never {
  throw new HttpError(status, message);
}

const ERR_EN: Record<string, string> = {
  "سجّل دخولك أول": "Please sign in first",
  "ما عندك صلاحية على هذا السيرفر": "You don't have permission on this server",
  "البوت مو موجود في هذا السيرفر": "The bot is not in this server",
  "فشل تسجيل الدخول": "Login failed",
  "روم أو رتبة ما تتبع هذا السيرفر": "That channel or role doesn't belong to this server",
  "رقم غير صالح": "Invalid number",
  "السؤال لازم يكون 45 حرف أو أقل": "Each question must be 45 characters or less",
  "نوع غير صالح": "Invalid type",
  "قيمة غير صالحة": "Invalid value",
  "بيانات غير صالحة": "Invalid data",
  "عقوبة غير صالحة": "Invalid punishment",
  "قاعدة بيانات الترحيب غير جاهزة": "The welcome database isn't ready",
  "قاعدة البيانات غير جاهزة": "The database isn't ready",
  "قاعدة بيانات العقارات غير جاهزة": "The real estate database isn't ready",
  "المدة غير صالحة": "Invalid interval",
  "اختر مدة من 5 أو 10 أو 15 أو 30 أو 45 دقيقة": "Pick an interval of 5, 10, 15, 30 or 45 minutes",
  "روم الأذكار ما يتبع هذا السيرفر": "The Azkar channel doesn't belong to this server",
  "حدد روم الأذكار عند تفعيل النظام": "Select the Azkar channel when enabling the system",
  "قاعدة بيانات الأذكار غير جاهزة": "The Azkar database isn't ready",
  "حدد روم نصي صالح للمستويات": "Select a valid text channel for levels",
  "اكتب رسالة المستويات": "Write the level-up message",
  "رسالة المستويات 2000 حرف كحد أقصى": "The level message is limited to 2000 characters",
  "قاعدة بيانات المستويات غير جاهزة": "The levels database isn't ready",
  "حدّث ملف الردود reply.py بالنسخة الجديدة أول": "Update reply.py to the new version first",
  "كل رد لازم له كلمة مفتاحية ونص": "Every reply needs a keyword and a response",
  "الكلمة 100 حرف والرد 2000 حرف كحد أقصى": "Keyword max 100 characters, response max 2000",
  "قاعدة بيانات البنك غير جاهزة": "The bank database isn't ready",
  "حدد روم إرسال بانل حالة الرول": "Select the channel for the role status panel",
  "حدد روم إرسال بانل الهوية": "Select the channel for the identity panel",
  "حدد روم إرسال بانل الأسلحة": "Select the channel for the weapons panel",
  "حدد روم بانل العساكر أو روم بانل المواطنين": "Select the police panel channel or the citizens panel channel",
  "هذي الرتبة ما تنفع كرتبة تلقائية": "This role can't be used as an auto role",
  "الرتبة أعلى من رتبة البوت أو تساويها، ارفع رتبة البوت فوقها أول": "The role is higher than or equal to the bot's role — move the bot's role above it first",
  "قاعدة بيانات الرتبة التلقائية غير جاهزة": "The auto role database isn't ready",
  "إرسال الايمبد للأدمن فقط": "Only admins can send embeds",
  "العنوان 256 حرف والوصف 4000 حرف كحد أقصى": "Title max 256 characters, description max 4000",
  "رابط الصورة لازم يبدأ بـ http أو https": "The image URL must start with http or https",
  "النص الخارجي 2000 حرف كحد أقصى": "The outside text is limited to 2000 characters",
  "تعذر الإرسال، تأكد من صلاحيات البوت في الروم": "Couldn't send — check the bot's permissions in the channel",
  "كل اختصار لازم له اسم ونوع أمر": "Every shortcut needs a name and a command type",
  "نوع الأمر غير مدعوم": "Unsupported command type",
  "الاختصار 50 حرف والأمر 100 حرف كحد أقصى": "Shortcut max 50 characters, command max 100",
  "قاعدة بيانات الاختصارات غير جاهزة": "The shortcuts database isn't ready",
  "اللوق لازم يكون في روم نصي من هذا السيرفر": "Logs must go to a text channel of this server",
  "قاعدة بيانات اللوقات غير جاهزة": "The logs database isn't ready",
  "قاعدة بيانات الحماية غير جاهزة": "The protection database isn't ready",
  "تعديل هذا القسم للأدمن فقط": "Only admins can edit this section",
  "الكلمة أطول من 100 حرف": "The word is longer than 100 characters",
  "الحد الأقصى 500 كلمة": "Maximum 500 words",
  "قاعدة بيانات الكلمات المحظورة غير جاهزة": "The blocked words database isn't ready",
  "حدد روم نصي صالح": "Select a valid text channel",
  "اكتب عنوان ووصف البانل": "Write the panel title and description",
  "اختر عنصر واحد على الأقل": "Select at least one item",
  "تعذر إرسال البانل، تأكد من صلاحيات البوت في الروم": "Couldn't send the panel — check the bot's permissions in the channel",
  "اختر من 1 إلى 5 نجوم": "Choose 1 to 5 stars",
  "طلب مرفوض (CSRF)": "Request rejected (CSRF)",
  "غير موجود": "Not found",
  "تعذر الاتصال بديسكورد، حاول بعد شوي": "Couldn't reach Discord, try again shortly",
  "البوت ما رد — تأكد إنه شغال": "The bot didn't respond — make sure it's running",
  "صار خطأ في السيرفر": "Internal server error",
};
const ERR_PREFIX_EN: [string, string][] = [
  ["متغير غير معروف: ", "Unknown variable: "],
  ["الاختصار لازم يكون كلمة وحدة بدون مسافات: ", "A shortcut must be a single word without spaces: "],
  ["الاختصار مكرر: ", "Duplicate shortcut: "],
  ["الكلمة لازم تكون حرفين على الأقل: ", "A word must be at least 2 characters: "],
];

export function translateError(msg: string, lang: string): string {
  if (lang !== "en" || msg.startsWith("REQ:")) return msg;
  const exact = ERR_EN[msg];
  if (exact) return exact;
  for (const [ar, en] of ERR_PREFIX_EN) if (msg.startsWith(ar)) return en + msg.slice(ar.length);
  return msg;
}
