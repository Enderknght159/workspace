# مواصفة هوية الأقراص

## ملف البصمة

`<Root>\.workspace-office\volume.json`

```json
{
  "schema": 1,
  "volume_id": "vol_01J...",
  "label": "Media Archive",
  "kind": "hot",
  "created_at": "2026-11-04T09:00:00.000Z",
  "offices": ["off_01J..."]
}
```

يُخفى بـ`attrib +h +s` على Windows. لا يُعتمد عليه وحده للهوية.

## الإشارات

| إشارة | المصدر | الاستخدام |
|---|---|---|
| `volume_id` | ملف البصمة | المفتاح الأساسي |
| `volume_guid` | `Get-Volume.UniqueId` | مطابقة فيزيائية |
| `serial` | `Get-Volume.SerialNumber` | احتياطي |
| `fs_type` | `Get-Volume.FileSystem` | تحقق |
| `size_bytes` | `Get-Volume.Size` | تحقق |

## المطابقة

| البصمة | GUID | النتيجة |
|---|---|---|
| موجودة | مطابق | `connected` |
| موجودة | مختلف | `cloned` — قراءة فقط + تنبيه |
| مفقودة | مطابق | `fingerprint_missing` — اقترح إعادة تسجيل |
| موجودة | غير معروف للمكتب | `foreign` — لا تلمسه |
| لا شيء | — | `unregistered` |

**لا اختيار بالحرف ولا fallback صامت.** الحرف قد يتغير بين جلسة وأخرى.

## التسجيل
1. تحقق أن الجذر موجود وليس داخل مكتب آخر (`.workspace-office/volume.json` آخر).
2. اقرأ الهوية الفيزيائية، وإن فشلت: سجّل `unknown` مع تحذير (لا تفشل العملية كلها على قرص شبكة).
3. اكتب البصمة ذرّيًا.
4. أدخل `volumes` بـ`status=connected`.

## الأرشفة
- الهدف يجب أن يكون `kind=cold` و`connected`.
- نسخ → تحقق (عدد/حجم/هاش) → كتالوج → ثم نقل المصدر إلى `90_trash`.
- لا يُحذف شيء نهائيًا تلقائيًا.
