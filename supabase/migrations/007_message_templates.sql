alter table guild_settings add column points_message_title text not null default '💜 Rift • نقاطك الخاصة';
alter table guild_settings add column points_message_description text not null default 'هذا التقرير خاص بك ولا يظهر لباقي الأعضاء.';
alter table guild_settings add column points_message_footer text not null default 'Rift Staff Operations';
