"""أعضاء الفريق | Team members — عدّل هذا الملف فقط لإضافة/تغيير الأعضاء.
role: owner | dev | support | design | mod  ·  avatar: رابط صورة (اختياري)  ·  discord: اسم المستخدم (اختياري)
sample=True تعني بطاقة تجريبية؛ احذفها أو بدّلها بعضو حقيقي."""

TEAM = [
    dict(id="founder", name=".a.506.", role="owner", since=2024, discord=".a.506.",
         title={"ar": "المؤسس والمطوّر الرئيسي", "en": "Founder & Lead Developer"},
         bio={"ar": "صاحب فكرة ريفايف ومطوّر البوت ولوحة التحكم. يهتم بالجودة والأداء وتجربة الإدارة.",
              "en": "The mind behind Revive — builds the bot and the dashboard, obsessed with quality, speed and a great admin experience."}),
    dict(id="m1", name="Your Name", role="dev", sample=True, since=2025, title={"ar": "مطوّر", "en": "Developer"},
         bio={"ar": "بطاقة تجريبية — بدّلها باسمك وصورتك من ملف dashboard_ui/team.py.", "en": "Sample card — replace it with a real member in dashboard_ui/team.py."}),
    dict(id="m2", name="Your Name", role="support", sample=True, since=2025, title={"ar": "الدعم الفني", "en": "Support Agent"},
         bio={"ar": "بطاقة تجريبية — بدّلها بعضو حقيقي من الدعم.", "en": "Sample card — replace it with a real support member."}),
    dict(id="m3", name="Your Name", role="design", sample=True, since=2025, title={"ar": "مصمم", "en": "Designer"},
         bio={"ar": "بطاقة تجريبية — بدّلها بمصمم الفريق.", "en": "Sample card — replace it with your designer."}),
    dict(id="m4", name="Your Name", role="mod", sample=True, since=2025, title={"ar": "مشرف", "en": "Moderator"},
         bio={"ar": "بطاقة تجريبية — بدّلها بمشرف حقيقي.", "en": "Sample card — replace it with a real moderator."}),
]
ROLE_ICON = {"owner": "crown", "dev": "code", "support": "support", "design": "palette", "mod": "shield"}
