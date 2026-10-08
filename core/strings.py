"""نصوص ثنائية اللغة للأنظمة الجديدة | Bilingual strings: key -> (العربية, English)."""
S: dict[str, tuple[str, str]] = {}


def add(prefix: str, table: dict[str, tuple[str, str]]) -> None:
    from . import i18n
    for k, v in table.items():
        S[f"{prefix}.{k}"] = v
        i18n.register(v[0], v[1])  # يُستخدم أيضاً في ترجمة وصف أوامر السلاش والنصوص المركّبة


add("c", {  # مشترك
    "no_perm": ("❌ ما عندك صلاحية لاستخدام هذا.", "❌ You don't have permission to do that."),
    "guild_only": ("❌ هذا الأمر داخل السيرفرات فقط.", "❌ This command only works inside servers."),
    "yes": ("نعم", "Yes"), "no": ("لا", "No"), "none": ("لا يوجد", "None"), "unknown": ("غير معروف", "Unknown"),
    "by": ("بواسطة", "By"), "reason": ("السبب", "Reason"), "member": ("العضو", "Member"), "channel": ("الروم", "Channel"),
    "role": ("الرتبة", "Role"), "id": ("الآيدي", "ID"), "cancel": ("إلغاء", "Cancel"), "confirm": ("تأكيد", "Confirm"),
    "done": ("تم", "Done"), "error": ("حدث خطأ غير متوقع", "Something went wrong"),
    "enabled": ("مفعّل", "Enabled"), "disabled": ("معطّل", "Disabled"), "on": ("تشغيل", "On"), "off": ("إيقاف", "Off"),
})
