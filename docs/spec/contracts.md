# عقود المحرّك

> المصدر التنفيذي: `src/shared/contracts.ts` + `src/shared/errors.ts`.

## المصادقة

كل طلب يحمل `Authorization: Bearer <engineToken>`.
التوكن يُولَّد عند تشغيل المحرّك ويُسلَّم للـmain عبر stdout، ثم للواجهة عبر preload.

الرفع المؤقت (Elevation):
`POST /api/elevate { password }` → `{ token, expiresAt }` صالح 10 دقائق.
الـendpoints الموسومة `requiresElevation` تقبل `x-elevation: <token>`.

## الغلاف

نجاح: `{ "data": ... }`
فشل: `{ "error": { "code": "WS-xxxx", "message": "...", "action": "...", "details": {} } }`

## المسارات

| Method | Path | الوظيفة |
|---|---|---|
| GET | `/health` | حياة + إصدار |
| GET | `/api/info` | إصدار، مسارات المكتب، حالة الطابور |
| GET | `/api/events` | قائمة الأحداث (`state`, `q`, `limit`, `offset`) |
| POST | `/api/events` | إنشاء حدث يدوي |
| GET | `/api/events/:id` | حدث + أصول + وظائف + مراجعات |
| PATCH | `/api/events/:id` | عنوان/نوع/تاريخ |
| POST | `/api/events/:id/transition` | `{ to, reason? }` |
| GET | `/api/jobs` | قائمة (`state`, `eventId`) |
| POST | `/api/jobs` | إنشاء وظيفة من `job.json` |
| GET | `/api/jobs/:id` | وظيفة + سجل |
| POST | `/api/jobs/:id/cancel` | إلغاء |
| POST | `/api/jobs/:id/retry` | إعادة |
| POST | `/api/jobs/:id/review` | `{ decision, checklist, notes? }` |
| POST | `/api/jobs/:id/publish` | `{ platform, url }` |
| GET | `/api/volumes` | الأقراص وحالتها |
| POST | `/api/volumes/register` | `{ root, label, kind }` |
| POST | `/api/volumes/:id/scan` | إعادة مطابقة |
| GET | `/api/styles` | الحزم المكتشفة |
| POST | `/api/styles/reload` | إعادة مسح |
| POST | `/api/ingest/preview` | `{ source, kind, title }` → خطة |
| POST | `/api/ingest/start` | بدء تفريغ |
| GET | `/api/ingest/batches` | الدفعات |
| GET | `/api/review/pending` | وظائف بانتظار مراجعة |
| GET | `/api/edit-tasks` | مهام المونتاج (`eventId`) |
| POST | `/api/edit-tasks` | إنشاء مهمة ومشروع مبدئي |
| GET | `/api/edit-tasks/:id` | تفاصيل المهمة والمسارات |
| PATCH | `/api/edit-tasks/:id` | عنوان/حالة/ملاحظات |
| POST | `/api/edit-tasks/:id/export` | تسجيل ملف التصدير |
| GET | `/api/users` | المستخدمون |
| POST | `/api/users` | إضافة مستخدم |
| PATCH | `/api/users/:id` | تعديل/تعطيل مستخدم |
| GET | `/api/moves` | سجل النقل |
| GET | `/api/assets/:id/move` | آخر نقل للأصل |
| POST | `/api/moves/:id/undo` | إرجاع الملف إلى المصدر |
| POST | `/api/assets/:id/relocate` | نقل/نسخ بين حدثين |
| POST | `/api/events/:id/sources/trash` | حذف الخام مع الإبقاء على الناتج |
| POST | `/api/agent/check` | اختبار اتصال الوكيل |
| GET | `/api/archive/candidates` | مرشحات الأرشفة |
| POST | `/api/archive/run` | `{ targetVolumeId, dryRun, eventIds? }` |
| POST | `/api/archive/purge` | إفراغ سلة أقدم من السياسة |
| GET | `/api/doctor` | آخر فحص |
| POST | `/api/doctor/run` | `{ deep? }` |
| GET | `/api/audit` | سجل التدقيق |
| GET | `/api/settings` | إعدادات المكتب (منقّحة) |
| PATCH | `/api/settings` | تعديل (صلاحية مرتفعة) |
| GET | `/api/security/status` | حالة الصلاحية |
| POST | `/api/security/password` | تعيين/تغيير كلمة المرور |
| POST | `/api/security/recover` | `{ recoveryCode, password }` |
| POST | `/api/elevate` | `{ password }` → توكن 10 دقائق |
| GET | `/api/diagnostics` | حزمة تشخيص JSON |
| POST | `/api/backup` | نسخة احتياطية الآن |
| GET | `/api/backups` | قائمة النسخ |
| GET | `/api/assets/:id/file` | بث أصل (يدعم Range) |
| GET | `/api/jobs/:id/files/:name` | بث مخرَج (يدعم Range) |
| GET | `/api/stream` | SSE |

## أحداث SSE

| النوع | الحمولة |
|---|---|
| `hello` | `{ seq, at, version }` |
| `job.updated` | `{ jobId, state, step?, progress? }` |
| `event.updated` | `{ eventId, state }` |
| `ingest.progress` | `{ batchId, copied, total, bytes, phase }` |
| `queue.stats` | `{ queued, running, failed }` |
| `doctor.updated` | `{ ok, checkedAt }` |
| `log` | `{ level, message, jobId? }` |

## قواعد
- كل جسم طلب يُتحقق بـzod قبل الخدمة.
- كل استجابة تُقيَّد بالحقول المعلنة، لا تسريب صفوف خام.
- لا توجد مسارات مطلقة في الاستجابات العامة؛ المسارات تُشتق عند الحاجة فقط، وتعرض تحت «تفاصيل تقنية».
