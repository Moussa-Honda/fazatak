# إعداد إشعارات Safari PWA

## 1. قاعدة البيانات

نفّذ `tools/supabase_push_schema.sql` مرة واحدة في Supabase SQL Editor.

## 2. مفاتيح VAPID

أنشئ زوج مفاتيح P-256. خزّن المفتاح الخاص في Cloudflare كـ Secret، ولا تضعه في GitHub أو داخل التطبيق.

يحتاج Worker إلى المتغيرات التالية:

- `VAPID_PUBLIC_KEY`: المفتاح العام بصيغة Base64 URL-safe.
- `VAPID_PRIVATE_KEY`: الجزء الخاص `d` من مفتاح P-256 بصيغة Base64 URL-safe.
- `VAPID_SUBJECT`: بريد أو رابط تواصل، مثل `mailto:notifications@example.com`.
- `SUPABASE_URL`: رابط مشروع Supabase، اختياري لأن التطبيق يحتوي على قيمة افتراضية.
- `SUPABASE_ANON_KEY`: مفتاح Supabase العام، اختياري لأن التطبيق يحتوي على قيمة افتراضية.

ضع `VAPID_PUBLIC_KEY` كمتغير عادي، أما `VAPID_PRIVATE_KEY` فضعه كـ Secret.

أضف المتغيرات نفسها إلى بيئة Production في إعدادات Cloudflare Pages، لأن مسارات `/api/push/*` تعمل عبر Pages Functions.

ويجب تعريف المتغيرات نفسها في Worker `fazatak` حتى يعمل Cron المجدول كل 15 دقيقة.

## 3. سلوك Safari

يجب فتح الموقع على iPhone بنظام iOS 16.4 أو أحدث، ثم اختيار «إضافة إلى الشاشة الرئيسية» وفتح التطبيق من الأيقونة. بعد ذلك يمنح المستخدم صلاحية الإشعارات من زر «تنبيهات الجهاز» داخل الإعدادات.

الإشعارات تُرسل من Cloudflare Worker كل 15 دقيقة اعتمادًا على نسخة البيانات السحابية الأخيرة للمستخدم. إذا كان وضع الخصوصية فعالًا، يظهر مبلغ القسط في إشعار الجهاز كـ `***`.
