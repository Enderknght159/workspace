# آلات الحالة

> المصدر التنفيذي: `src/shared/state-machines.ts`. أي تغيير هنا يجب أن يقابله تحديث هناك واختبار.

## الحدث (Event)

| من | إلى | الشرط |
|---|---|---|
| draft | ingested | وصلت أصول وهُشِّرت |
| ingested | todo | جاهز للعمل |
| todo | in_progress | بدأت وظيفة |
| in_progress | edited | اكتملت كل وظائف التحرير |
| in_progress | blocked | شرط ناقص |
| blocked | in_progress | زال المانع |
| edited | in_review | أُرسل للمراجعة |
| in_review | approved | اعتماد بشري |
| in_review | rejected | رفض بسبب |
| rejected | in_progress | وظيفة مراجعة جديدة |
| approved | published | سُجّل نشر |
| published | archived | انتهى الاحتفاظ الساخن |
| archived | cold | تحقق الهارد البارد |
| أي | unknown | فقد المسار أثناء المطابقة |

## الوظيفة (Job)

| من | إلى | الشرط |
|---|---|---|
| queued | running | حصلت على العامل والقفل |
| queued | blocked | متطلبات ناقصة |
| queued | blocked_offline | القرص غير موصول |
| queued | cancelled | إلغاء بشري |
| blocked | queued | زال المانع |
| blocked_offline | queued | وُصل القرص |
| running | succeeded | `result.json` صالح |
| running | failed | خطأ بعد المحاولة |
| running | cancelled | إلغاء |
| running | interrupted | إغلاق/انقطاع |
| interrupted | queued | استئناف |
| succeeded | review_pending | تلقائيًا |
| review_pending | approved | اعتماد |
| review_pending | rejected | إعادة بتعديل |
| approved | published | سجل نشر |
| published | archived | أرشفة |
| failed | queued | إعادة محاولة (≤ max) |

## حرّاس عامة

1. لا `published` دون `reviews.decision = approved` مطابق لنفس الوظيفة.
2. لا `archived` مع وظيفة مفتوحة.
3. لا `cold` دون تحقق هاش وكتالوج على القرص الهدف.
4. كل انتقال يمر بـ`transition()` ويكتب `audit_log` إذا كان بشريًا.
5. `failed` لا يُعيد نفسه تلقائيًا أكثر من `max_attempts` (افتراضي 2).
