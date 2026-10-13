const ar = [
  ['Good morning, Rift team', 'صباح الخير، فريق Rift'], ['Public status page', 'صفحة الحالة العامة'], ['System health', 'صحة النظام'], ['Server settings', 'إعدادات السيرفر'], ['Bot status', 'حالة البوت'], ['My profile', 'ملفي الشخصي'], ['Audit log', 'سجل التدقيق'], ['Staff Performance', 'أداء الفريق'], ['Points & Leaderboard', 'النقاط والترتيب'], ['Commands & Shortcuts', 'الأوامر والاختصارات'], ['Staff Reports', 'تقارير الفريق'], ['Active Shifts', 'الشفتات النشطة'], ['Shift hours', 'ساعات الشفت'], ['Voice hours', 'ساعات الفويس'], ['Activity hours', 'ساعات النشاط'], ['Average rating', 'متوسط التقييم'], ['Recent ratings', 'أحدث التقييمات'], ['Rating breakdown', 'تفصيل التقييم'], ['Approved complaints', 'الشكاوى المعتمدة'], ['Pending Complaints', 'الشكاوى المعلقة'], ['Staff leaderboard', 'ترتيب الفريق'], ['Private activity summary and public staff ranking.', 'ملخص نشاطك الخاص وترتيب الفريق العام.'], ['How points are earned', 'طريقة احتساب النقاط'], ['Active shifts show up here live.', 'تظهر هنا الشفتات النشطة مباشرة.'], ['No staff points yet.', 'لا توجد نقاط للفريق بعد.'], ['No ratings yet.', 'لا توجد تقييمات بعد.'], ['No shift history yet.', 'لا يوجد سجل شفتات بعد.'], ['Select a staff member', 'اختر عضو فريق'], ['Search staff', 'ابحث عن عضو'], ['Add Staff', 'إضافة عضو'], ['Reset all staff', 'إعادة ضبط الفريق'], ['Staff workspace', 'مساحة عمل الفريق'], ['Staff', 'الفريق'], ['Shifts', 'الشفتات'], ['Points', 'النقاط'], ['Reports', 'التقارير'], ['Commands', 'الأوامر'], ['Complaints', 'الشكاوى'], ['Resignations', 'الاستقالات'], ['Leaves', 'الإجازات'], ['Overview', 'نظرة عامة'], ['Workspace', 'مساحة العمل'], ['Requests', 'الطلبات'], ['Notifications', 'الإشعارات'], ['Refresh', 'تحديث'], ['Log out', 'تسجيل الخروج'], ['Dashboard', 'لوحة التحكم'], ['Live service status', 'حالة الخدمات المباشرة'], ['Performance metrics', 'مقاييس الأداء'], ['Incidents and planned maintenances', 'الأعطال والصيانة المجدولة'], ['All systems operational', 'كل الأنظمة تعمل بشكل طبيعي'], ['Rift Discord bot', 'بوت Rift في ديسكورد'], ['Supabase database', 'قاعدة بيانات Supabase'], ['Rift dashboard', 'لوحة تحكم Rift'], ['Operational', 'يعمل'], ['Degraded', 'متأثر'], ['Outage', 'متوقف'], ['Maintenance', 'صيانة'], ['Loading', 'جار التحميل'], ['Cancel', 'إلغاء'], ['Save', 'حفظ'], ['Delete', 'حذف'], ['Edit', 'تعديل'], ['Close', 'إغلاق'], ['Submit', 'إرسال'], ['Active', 'نشط'], ['On break', 'في استراحة'], ['Completed', 'مكتمل'], ['Private', 'خاص'], ['English', 'الإنجليزية'], ['Arabic', 'العربية'], ['Rift Purple', 'بنفسجي Rift'], ['Theme', 'الثيم'], ['Language', 'اللغة'], ['Rating', 'التقييم'], ['Ratings', 'التقييمات'], ['Messages', 'الرسائل'], ['Leaderboard', 'الترتيب'], ['Total Staff', 'إجمالي الفريق'], ['Active now', 'نشط الآن'], ['No one on shift', 'لا يوجد أحد في شفت'], ['Open shifts', 'فتح الشفتات'], ['View all', 'عرض الكل'], ['Needs attention', 'بحاجة لمراجعة'], ['Top performance', 'أفضل أداء'], ['Team activity', 'نشاط الفريق'], ['Points Control', 'إدارة النقاط'], ['Status', 'الحالة'], ['Settings', 'الإعدادات'], ['Profile', 'الملف الشخصي'], ['Add private staff note', 'إضافة ملاحظة خاصة'], ['Adjust staff metrics', 'تعديل إحصاءات الموظف'], ['Manage staff', 'إدارة الموظف'], ['Staff member', 'عضو فريق'], ['No data', 'لا توجد بيانات'], ['Loading metrics', 'جار تحميل المقاييس'], ['Subscribe', 'اشتراك'], ['Metrics', 'المقاييس'], ['Incidents & maintenances', 'الأعطال والصيانة'], ['Public API', 'واجهة API عامة']
];

const attributes = ['placeholder', 'title', 'aria-label'];

function translate(value) {
  let result = value;
  for (const [english, arabic] of ar) result = result.replaceAll(english, arabic);
  return result
    .replace(/Welcome back, (.+)\./, 'مرحبا بعودتك، $1.')
    .replace(/(\d+) active shifts?/g, '$1 شفت نشط')
    .replace(/(\d+) staff/g, '$1 عضو فريق');
}

export function localize(root, language) {
  if (!root || language !== 'ar') return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.parentElement && !['SCRIPT', 'STYLE', 'CODE'].includes(node.parentElement.tagName)) nodes.push(node);
  }
  for (const node of nodes) node.nodeValue = translate(node.nodeValue || '');
  root.querySelectorAll?.(attributes.map(attribute => `[${attribute}]`).join(',')).forEach(element => {
    for (const attribute of attributes) {
      const value = element.getAttribute(attribute);
      if (value) element.setAttribute(attribute, translate(value));
    }
  });
}