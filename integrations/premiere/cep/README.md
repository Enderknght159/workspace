# جسر Premiere

هذه لوحة CEP صغيرة تجعل Workspace ينشئ مشروع Premiere تلقائيًا داخل مجلد الحدث.

## التثبيت (مرة واحدة)

من جذر المشروع:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-premiere-bridge.ps1
```

يفعل سكربت التثبيت:
1. ينسخ اللوحة إلى `%APPDATA%\Adobe\CEP\extensions\com.workspace.premierebridge`.
2. يفعّل `PlayerDebugMode` في `HKCU\Software\Adobe\CSXS.9..12` لأن اللوحة غير موقّعة.
3. يطبع تعليمات الفتح.

## الاستخدام

1. افتح Premiere Pro.
2. `Window → Extensions → Workspace Bridge`.
3. أدخل مسار مجلد المكتب مرة واحدة (مثل `C:\Users\...\Documents\WorkspaceOffice`) واضغط **حفظ وبدء**.
4. عند إنشاء مهمة مونتاج من Workspace، ستظهر في الطابور وينشئ المشروع تلقائيًا.

## ماذا ينشئ؟

- `<Event>/edit/<task-id>/project.prproj`
- `<Event>/edit/<task-id>/premiere-job.json`
- يستورد المصادر إلى bin الجذر.
- ينشئ Sequence بالاسم والإعدادات المطلوبة.
- يستورد ملفات SRT/VTT إن وُجدت.
- يكتب `premiere-result.json` ليقرأه Workspace.

## بديل بلا لوحة

كل مهمة تولّد أيضًا `create-project.jsx`. يمكن تشغيله يدويًا:
`File → Scripts → Run Script File` ثم اختر السكربت.

## ملاحظة أمان

`PlayerDebugMode` يسمح بتشغيل إضافات CEP غير موقّعة. فعّله فقط على جهاز المكتب الموثوق. عند التوزيع الرسمي يجب توقيع الإضافة أو إيقاف هذا الوضع.
