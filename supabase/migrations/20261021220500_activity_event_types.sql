begin;
alter type public.notification_type add value if not exists 'billing_updated';
alter type public.notification_type add value if not exists 'lesson_updated';
alter type public.notification_type add value if not exists 'support_updated';
commit;