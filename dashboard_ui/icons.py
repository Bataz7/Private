"""مكتبة الأيقونات | Icon set (24×24, duotone).
كل أيقونة = (طبقة تعبئة خفيفة, خطوط). الطبقة الأولى تعطي عمقاً بدون ألوان إضافية.
Each icon is (soft fill layer, stroke layer); the fill uses currentColor at low opacity.
"""
from markupsafe import Markup

# name: (fill, stroke)
ICONS: dict[str, tuple[str, str]] = {
    "home": ('<path d="M5 10.2 12 4l7 6.2V20H5z"/>', '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v10h13V10"/><path d="M10 20v-5.5h4V20"/>'),
    "grid": ('<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/>', '<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/>'),
    "globe": ('<circle cx="12" cy="12" r="9"/>', '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.6 2.5 3.9 5.5 3.9 9s-1.3 6.5-3.9 9c-2.6-2.5-3.9-5.5-3.9-9S9.4 5.5 12 3z"/>'),
    "chart": ('<rect x="4" y="11" width="4" height="9" rx="1"/><rect x="10" y="5" width="4" height="15" rx="1"/><rect x="16" y="9" width="4" height="11" rx="1"/>', '<rect x="4" y="11" width="4" height="9" rx="1"/><rect x="10" y="5" width="4" height="15" rx="1"/><rect x="16" y="9" width="4" height="11" rx="1"/>'),
    "trending": ('<path d="M3 18l6-7 4 4 8-9v12z"/>', '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>'),
    "user-plus": ('<circle cx="9" cy="8" r="4"/>', '<circle cx="9" cy="8" r="4"/><path d="M2.5 20.5c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M19 8v6M16 11h6"/>'),
    "user": ('<circle cx="12" cy="8" r="4"/>', '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>'),
    "users": ('<circle cx="9" cy="8" r="3.5"/>', '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.6a3.5 3.5 0 010 6.8M18 14.3c2.3.7 3.5 2.6 3.5 5.7"/>'),
    "user-x": ('<circle cx="9" cy="8" r="4"/>', '<circle cx="9" cy="8" r="4"/><path d="M2 21c0-3.9 3.1-7 7-7s7 3.1 7 7"/><path d="M17 9l5 5M22 9l-5 5"/>'),
    "ticket": ('<path d="M4 7h16v3a2 2 0 000 4v3H4v-3a2 2 0 000-4z"/>', '<path d="M4 7h16v3a2 2 0 000 4v3H4v-3a2 2 0 000-4z"/><path d="M14 7v2M14 11v2M14 15v2"/>'),
    "clipboard": ('<rect x="6" y="4" width="12" height="17" rx="2"/>', '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1M9.5 11h5M9.5 15h5"/>'),
    "activity": ('<path d="M3 12h4l3-8 4 16 3-8h4v8H3z"/>', '<path d="M3 12h4l3-8 4 16 3-8h4"/>'),
    "id-card": ('<rect x="3" y="5" width="18" height="14" rx="2.5"/>', '<rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="9" cy="11" r="2"/><path d="M6 16c.5-1.5 1.7-2 3-2s2.5.5 3 2M14 10h4M14 14h4"/>'),
    "crosshair": ('<circle cx="12" cy="12" r="8"/>', '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="1.5"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>'),
    "traffic": ('<rect x="7.5" y="2" width="9" height="20" rx="3.5"/>', '<rect x="7.5" y="2" width="9" height="20" rx="3.5"/><circle cx="12" cy="7" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="17" r="1.4"/>'),
    "landmark": ('<path d="M3 10l9-6 9 6z"/>', '<path d="M3 10l9-6 9 6z"/><path d="M5.5 10v8M9.8 10v8M14.2 10v8M18.5 10v8M3 21h18M4.5 18h15"/>'),
    "building": ('<rect x="5" y="3" width="14" height="18" rx="1.5"/>', '<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M10 21v-3h4v3"/>'),
    "check-circle": ('<circle cx="12" cy="12" r="9"/>', '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>'),
    "alert-circle": ('<circle cx="12" cy="12" r="9"/>', '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5M12 16h.01"/>'),
    "message": ('<path d="M4 5.5A1.5 1.5 0 015.5 4h13A1.5 1.5 0 0120 5.5v9a1.5 1.5 0 01-1.5 1.5H9l-5 4z"/>', '<path d="M4 5.5A1.5 1.5 0 015.5 4h13A1.5 1.5 0 0120 5.5v9a1.5 1.5 0 01-1.5 1.5H9l-5 4z"/><path d="M8 9h8M8 12h5"/>'),
    "message-x": ('<path d="M4 5.5A1.5 1.5 0 015.5 4h13A1.5 1.5 0 0120 5.5v9a1.5 1.5 0 01-1.5 1.5H9l-5 4z"/>', '<path d="M4 5.5A1.5 1.5 0 015.5 4h13A1.5 1.5 0 0120 5.5v9a1.5 1.5 0 01-1.5 1.5H9l-5 4z"/><path d="M10 7.5l4 4M14 7.5l-4 4"/>'),
    "tag": ('<path d="M3 12V4h8l10 10-8 8z"/>', '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.3"/>'),
    "tag-plus": ('<path d="M3 12V4h8l10 10-8 8z"/>', '<path d="M3 12V4h8l10 10-8 8z"/><path d="M9 7v5M6.5 9.5h5"/>'),
    "bolt": ('<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>', '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>'),
    "shield": ('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>', '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-4.5"/>'),
    "ban": ('<circle cx="12" cy="12" r="9"/>', '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>'),
    "star": ('<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>', '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>'),
    "moon": ('<path d="M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z"/>', '<path d="M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z"/>'),
    "send": ('<path d="M21 3L3 10.5l7 2.5 2.5 7z"/>', '<path d="M21 3L3 10.5l7 2.5 2.5 7z"/><path d="M10 13l5-5"/>'),
    "logs": ('<path d="M7 3h8l4 4v14H7z"/>', '<path d="M7 3h8l4 4v14H7z"/><path d="M15 3v4h4M10 12h6M10 16h6"/>'),
    "smile": ('<circle cx="12" cy="12" r="9"/>', '<circle cx="12" cy="12" r="9"/><path d="M8 14c1 1.5 2.4 2.2 4 2.2s3-.7 4-2.2M9 9.5h.01M15 9.5h.01"/>'),
    "sliders": ('<circle cx="16" cy="7" r="2.5"/><circle cx="8" cy="17" r="2.5"/>', '<path d="M4 7h9.5M18.5 7H20M4 17h1.5M10.5 17H20"/><circle cx="16" cy="7" r="2.5"/><circle cx="8" cy="17" r="2.5"/>'),
    "log-in": ('<path d="M15 4h4v16h-4z"/>', '<path d="M15 4h4v16h-4M8 8l4 4-4 4M12 12H3"/>'),
    "logout": ('<path d="M4 4h5v16H4z"/>', '<path d="M9 4H4v16h5M16 8l4 4-4 4M20 12H9"/>'),
    "menu": ("", '<path d="M4 6h16M4 12h16M4 18h16"/>'),
    "server": ('<rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/>', '<rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/><path d="M7 7h.01M7 17h.01"/>'),
    "save": ('<path d="M5 3h11l4 4v14H5z"/>', '<path d="M5 3h11l4 4v14H5z"/><path d="M8 3v5h7V3M8 21v-7h8v7"/>'),
    "plus": ("", '<path d="M12 5v14M5 12h14"/>'),
    "trash": ('<path d="M6 7l1 13h10l1-13z"/>', '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
    "pencil": ('<path d="M4 20l1-5L16.5 3.5a2.1 2.1 0 013 3L8 18z"/>', '<path d="M15 5l4 4M4 20l1-5L16.5 3.5a2.1 2.1 0 013 3L8 18z"/>'),
    "check": ("", '<path d="M5 12.5l4.5 4.5L19 7"/>'),
    "x": ("", '<path d="M6 6l12 12M18 6L6 18"/>'),
    "bot": ('<rect x="4" y="8" width="16" height="12" rx="3.5"/>', '<rect x="4" y="8" width="16" height="12" rx="3.5"/><path d="M12 4v4M9 13.5h.01M15 13.5h.01M9.5 17h5"/><circle cx="12" cy="3.5" r="1"/>'),
    "support": ('<circle cx="12" cy="12" r="9"/>', '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/><path d="M5.6 5.6l3.9 3.9M14.5 14.5l3.9 3.9M18.4 5.6l-3.9 3.9M9.5 14.5l-3.9 3.9"/>'),
    "arrow": ("", '<path d="M5 12h14M13 6l6 6-6 6"/>'),
    "chevron": ("", '<path d="M6 9l6 6 6-6"/>'),
    "search": ('<circle cx="11" cy="11" r="7"/>', '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>'),
    "hammer": ('<path d="M9.5 7.5l4-4 7 7-4 4z"/>', '<path d="M13 6l5 5M3 21l8-8M9.5 7.5l4-4 7 7-4 4z"/>'),
    "clock": ('<circle cx="12" cy="12" r="9"/>', '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    "timer-off": ('<circle cx="12" cy="13" r="8"/>', '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6M3 3l18 18"/>'),
    "folder": ('<path d="M3 6.5A1.5 1.5 0 014.5 5H9l2 2h8.5A1.5 1.5 0 0121 8.5v9a1.5 1.5 0 01-1.5 1.5h-15A1.5 1.5 0 013 17.5z"/>', '<path d="M3 6.5A1.5 1.5 0 014.5 5H9l2 2h8.5A1.5 1.5 0 0121 8.5v9a1.5 1.5 0 01-1.5 1.5h-15A1.5 1.5 0 013 17.5z"/>'),
    "folder-plus": ('<path d="M3 6.5A1.5 1.5 0 014.5 5H9l2 2h8.5A1.5 1.5 0 0121 8.5v9a1.5 1.5 0 01-1.5 1.5h-15A1.5 1.5 0 013 17.5z"/>', '<path d="M3 6.5A1.5 1.5 0 014.5 5H9l2 2h8.5A1.5 1.5 0 0121 8.5v9a1.5 1.5 0 01-1.5 1.5h-15A1.5 1.5 0 013 17.5z"/><path d="M12 10.5v6M9 13.5h6"/>'),
    "folder-x": ('<path d="M3 6.5A1.5 1.5 0 014.5 5H9l2 2h8.5A1.5 1.5 0 0121 8.5v9a1.5 1.5 0 01-1.5 1.5h-15A1.5 1.5 0 013 17.5z"/>', '<path d="M3 6.5A1.5 1.5 0 014.5 5H9l2 2h8.5A1.5 1.5 0 0121 8.5v9a1.5 1.5 0 01-1.5 1.5h-15A1.5 1.5 0 013 17.5z"/><path d="M10 11.5l4 4M14 11.5l-4 4"/>'),
    "folder-edit": ('<path d="M3 6.5A1.5 1.5 0 014.5 5H9l2 2h8.5A1.5 1.5 0 0121 8.5v9a1.5 1.5 0 01-1.5 1.5h-15A1.5 1.5 0 013 17.5z"/>', '<path d="M3 6.5A1.5 1.5 0 014.5 5H9l2 2h8.5A1.5 1.5 0 0121 8.5v9a1.5 1.5 0 01-1.5 1.5h-15A1.5 1.5 0 013 17.5z"/><path d="M8 15.5h8M8 12.5h5"/>'),
    "settings": ('<circle cx="12" cy="12" r="4"/>', '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>'),
    "crown": ('<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"/>', '<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"/><path d="M5 19h14"/>'),
    "link": ("", '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3A4 4 0 0011 18.7l1-1"/>'),
    "warn": ('<path d="M12 3L2 20h20z"/>', '<path d="M12 3L2 20h20z"/><path d="M12 9.5v4.5M12 17h.01"/>'),
    "unlock": ('<rect x="5" y="11" width="14" height="10" rx="2.5"/>', '<rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V7a4 4 0 017.5-2"/>'),
    "lock": ('<rect x="5" y="11" width="14" height="10" rx="2.5"/>', '<rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V7a4 4 0 018 0v4M12 15v2"/>'),
    "pointer": ('<path d="M5 3l14 7-6 2-2 6z"/>', '<path d="M5 3l14 7-6 2-2 6z"/>'),
    "list": ("", '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'),
    "info": ('<circle cx="12" cy="12" r="9"/>', '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
    "calendar": ('<rect x="4" y="5" width="16" height="16" rx="2.5"/>', '<rect x="4" y="5" width="16" height="16" rx="2.5"/><path d="M4 10h16M9 3v4M15 3v4"/>'),
    "spinner": ("", '<path d="M12 3a9 9 0 019 9"/>'),
    "code": ("", '<path d="M9 8l-5 4 5 4M15 8l5 4-5 4"/>'),
    "palette": ('<path d="M12 3a9 9 0 100 18c1.2 0 2-.8 2-1.8 0-.6-.3-1-.6-1.4-.3-.4-.5-.8-.5-1.3 0-1 .8-1.8 1.8-1.8H17a4 4 0 004-4c0-4.4-4-7.7-9-7.7z"/>', '<path d="M12 3a9 9 0 100 18c1.2 0 2-.8 2-1.8 0-.6-.3-1-.6-1.4-.3-.4-.5-.8-.5-1.3 0-1 .8-1.8 1.8-1.8H17a4 4 0 004-4c0-4.4-4-7.7-9-7.7z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r=".9"/><circle cx="14.5" cy="7" r=".9"/>'),
    "sparkles": ('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>', '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>'),
    "heart": ('<path d="M12 20s-7-4.4-9-9.2C1.8 7.6 3.8 4 7.2 4c2 0 3.4 1.1 4.8 3 1.4-1.9 2.8-3 4.8-3 3.4 0 5.4 3.6 4.2 6.8C19 15.6 12 20 12 20z"/>', '<path d="M12 20s-7-4.4-9-9.2C1.8 7.6 3.8 4 7.2 4c2 0 3.4 1.1 4.8 3 1.4-1.9 2.8-3 4.8-3 3.4 0 5.4 3.6 4.2 6.8C19 15.6 12 20 12 20z"/>'),
    "discord": ('<path d="M7 7c3-1.3 7-1.3 10 0 2 3 3 6 3 9-1.3 1-2.7 1.6-4 2l-1-2c.6-.2 1.1-.5 1.6-.8-2.8 1.3-6.4 1.3-9.2 0 .5.3 1 .6 1.6.8l-1 2c-1.3-.4-2.7-1-4-2 0-3 1-6 3-9z"/>', '<path d="M7 7c3-1.3 7-1.3 10 0 2 3 3 6 3 9-1.3 1-2.7 1.6-4 2l-1-2c.6-.2 1.1-.5 1.6-.8-2.8 1.3-6.4 1.3-9.2 0 .5.3 1 .6 1.6.8l-1 2c-1.3-.4-2.7-1-4-2 0-3 1-6 3-9z"/><circle cx="9.5" cy="12.5" r="1"/><circle cx="14.5" cy="12.5" r="1"/>'),
    # --- جديد: التذاكر | tickets ---
    "inbox": ('<path d="M3 13l2.5-8h13L21 13v6H3z"/>', '<path d="M3 13l2.5-8h13L21 13v6H3z"/><path d="M3 13h5l1 3h6l1-3h5"/>'),
    "file-check": ('<path d="M7 3h8l4 4v14H7z"/>', '<path d="M7 3h8l4 4v14H7z"/><path d="M15 3v4h4M9.5 14.5l2 2 3.5-4"/>'),
    "flag": ('<path d="M5 4h12l-2 4 2 4H5z"/>', '<path d="M5 21V4M5 4h12l-2 4 2 4H5"/>'),
    "hand": ('<path d="M7 11V6a1.5 1.5 0 013 0v5V4.5a1.5 1.5 0 013 0V11V6a1.5 1.5 0 013 0v7a6 6 0 01-6 6h-1a5 5 0 01-4-2l-3-4a1.5 1.5 0 012.3-1.9z"/>', '<path d="M7 11V6a1.5 1.5 0 013 0v5V4.5a1.5 1.5 0 013 0V11V6a1.5 1.5 0 013 0v7a6 6 0 01-6 6h-1a5 5 0 01-4-2l-3-4a1.5 1.5 0 012.3-1.9z"/>'),
    "coins": ('<ellipse cx="9" cy="8" rx="6" ry="3"/>', '<ellipse cx="9" cy="8" rx="6" ry="3"/><path d="M3 8v4c0 1.7 2.7 3 6 3s6-1.3 6-3V8M15 11.5c3 0 6 1 6 2.5v4c0 1.7-2.7 3-6 3-1.6 0-3-.3-4-.8"/>'),
    "key": ('<circle cx="8" cy="15" r="5"/>', '<circle cx="8" cy="15" r="4.5"/><path d="M11.5 11.5L20 3M16 7l3 3M14 9l2 2"/>'),
    "eye": ('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/>', '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
    "download": ("", '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>'),
    "layers": ('<path d="M12 3l9 5-9 5-9-5z"/>', '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 12.5l9 5 9-5M3 16.5l9 5 9-5"/>'),
    "image": ('<rect x="3" y="4" width="18" height="16" rx="2.5"/>', '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 16l-5-5-8 8"/>'),
    "copy": ('<rect x="8" y="8" width="12" height="12" rx="2.5"/>', '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"/>'),
    "tag-off": ('<path d="M3 12V4h8l10 10-8 8z"/>', '<path d="M3 12V4h8l10 10-8 8z"/><path d="M4 20L20 4"/>'),
    "mic": ('<rect x="9" y="3" width="6" height="12" rx="3"/>', '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3M8.5 21h7"/>'),
    "card": ('<rect x="2.5" y="5" width="19" height="14" rx="2.5"/>', '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19M6 15h4"/>'),
    "bell": ('<path d="M6 16V11a6 6 0 0112 0v5l2 2H4z"/>', '<path d="M6 16V11a6 6 0 0112 0v5l2 2H4z"/><path d="M10 21a2 2 0 004 0"/>'),
    "pin": ('<path d="M12 21s-6-5.6-6-10a6 6 0 0112 0c0 4.4-6 10-6 10z"/>', '<path d="M12 21s-6-5.6-6-10a6 6 0 0112 0c0 4.4-6 10-6 10z"/><circle cx="12" cy="11" r="2.2"/>'),
    "trophy": ('<path d="M7 4h10v5a5 5 0 01-10 0z"/>', '<path d="M7 4h10v5a5 5 0 01-10 0zM7 6H4v2a3 3 0 003 3M17 6h3v2a3 3 0 01-3 3M12 14v4M8 21h8M9.5 18h5"/>'),
    "refresh": ("", '<path d="M20 11a8 8 0 00-14-4L4 9M4 4v5h5M4 13a8 8 0 0014 4l2-2M20 20v-5h-5"/>'),
    "emoji": ('<circle cx="12" cy="12" r="9"/>', '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5c1 1.2 2.1 1.7 3.5 1.7s2.5-.5 3.5-1.7M9 9.5l.8.8M15 9.5l-.8.8"/>'),
}

EMBLEM = ('<g fill="currentColor"><path d="M58 52h5l1 34h-7z"/><path d="M60 50c-6-14-20-18-32-13 10 0 18 4 24 12-10-6-22-4-28 4 10-4 18-2 26 4-8 0-14 4-17 10 8-5 15-5 22-1l5-16zM60 50c6-14 20-18 32-13-10 0-18 4-24 12 10-6 22-4 28 4-10-4-18-2-26 4 8 0 14 4 17 10-8-5-15-5-22-1l-5-16zM60 48c-3-8-2-16 0-22 2 6 3 14 0 22z"/></g>'
          '<g fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"><path d="M14 78c24 4 50 12 78 30"/><path d="M106 78c-24 4-50 12-78 30"/></g>'
          '<circle cx="94" cy="106" r="3.5" fill="currentColor"/><circle cx="26" cy="106" r="3.5" fill="currentColor"/>')


def sprite() -> Markup:
    """SVG sprite يوضع مرة واحدة في بداية <body>."""
    syms = "".join(
        f'<symbol id="i-{k}" viewBox="0 0 24 24">' + (f'<g fill="currentColor" fill-opacity=".18" stroke="none">{f}</g>' if f else "") + f"{s}</symbol>"
        for k, (f, s) in ICONS.items()
    )
    return Markup(f'<svg id="icon-sprite" width="0" height="0" style="position:absolute" aria-hidden="true"><defs>{syms}<symbol id="i-emblem" viewBox="0 0 120 110">{EMBLEM}</symbol></defs></svg>')


def icon(name: str, cls: str = "") -> Markup:
    if name not in ICONS and name != "emblem":
        name = "info"
    return Markup(f'<svg class="i{(" " + cls) if cls else ""}" aria-hidden="true"><use href="#i-{name}"/></svg>')
