# بنية Workspace

> **الحالة:** معتمدة — v0.1
> المرجع الاستراتيجي: [`plan/workspace-plan.md`](../plan/workspace-plan.md)

## 1. الطبقات

```
src/
  shared/     عقود ومخططات وأخطاء وآلات حالة — بلا Node وبلا Electron
  engine/     المحرّك: قاعدة البيانات، الخدمات، الطابور، HTTP — بلا Electron
  main/       Electron main: نافذة، Tray، دورة حياة المحرّك، IPC صغير
  preload/    جسر آمن: apiBase + token + أوامر نظام محدودة
  renderer/   React RTL — لا وصول للملفات ولا Node
```

**حدود صارمة:**

| من | يستطيع الاستيراد من | ممنوع |
|---|---|---|
| `shared` | مكتبات JS نقية (`zod`) | `node:*`, `electron` |
| `engine` | `shared`, `node:*` | `electron`, `main`, `renderer` |
| `main` | `shared`, `electron`, `node:*` | `engine` (يشغّله كعملية منفصلة) |
| `renderer` | `shared`, React | `node:*`, `electron`, `engine` |

الحدود مفروضة بـ:
1. مراجعة الكود و`tsconfig` منفصل لكل طبقة.
2. اختبار معماري في `src/engine/architecture.test.ts` يقرأ الملفات ويرفض أي `import` مخالف.

## 2. العملية

```
┌──────────── Electron main ────────────┐
│ Tray / نافذة / تحديث / اختيار مجلد    │
│   spawn(process.execPath, host.js)    │
└───────────────┬───────────────────────┘
                │ stdout handshake: {port, token}
                │ 127.0.0.1 + Bearer token
┌───────────────▼───────────────────────┐
│  engine host (Node)                   │
│  HTTP + SSE · SQLite · Queue · Agent  │
└───────────────┬───────────────────────┘
                │ Markdown job.json + result.json
        OpenCode / mock / future adapters
```

- المحرّك يعمل كعملية منفصلة دائمًا، حتى في التطوير. يمكن تشغيله headless:
  `node dist/node/engine/host.js --office <path>`.
- المنفذ عشوائي، والتوكن يُسلَّم عبر stdout فقط. الواجهة تتلقاه من preload.
- لا يوجد أي وصول مباشر من الواجهة إلى الملفات أو قاعدة البيانات.

## 3. مكتب واحد = مجلد واحد

```
<Office>/
  office.json                  ← إعدادات المكتب (schema, name, id)
  data/workspace.db            ← SQLite (WAL)
  logs/engine-YYYY-MM-DD.jsonl
  backups/workspace-*.db
  styles/                      ← حزم الأساليب (بيانات لا كود)
  locks/gpu.lock
  machine_profile.json
  cache/thumbnails/
```

المسار الافتراضي: `%USERPROFILE%\Documents\WorkspaceOffice`، ويُضبط بـ:
- متغير البيئة `WORKSPACE_OFFICE`
- أو من إعدادات التطبيق لاحقًا.

## 4. قواعد ثابتة

1. **لا مسار مطلق في قاعدة البيانات** — فقط `(volume_id, rel_path)`.
2. كل كتابة ملف ذرّية: `.tmp` ثم `rename`.
3. كل عملية مدمّرة تُسجَّل في `audit_log` وتتطلب صلاحية مناسبة.
4. كل حالة تُغيَّر عبر `transition()` واحدة تتحقق من الجدول المسموح.
5. الواجهة تعرض `error.action` عند كل فشل — لا رسالة خام.
6. المحرّك لا يعرف `mreel1` ولا أي اسم أسلوب: الأسلوب بيانات في `styles/`.

## 5. نقاط التوسعة

| التوسعة | المكان |
|---|---|
| أسلوب مونتاج جديد | حزمة في `<Office>/styles/<id>/` |
| وكيل جديد (OpenCode/غيره) | تنفيذ `AgentAdapter` |
| قرص/مزوّد تخزين | `VolumeProvider` |
| وضع تشغيل جديد (هجين بريمير) | `JobKind` + وصفة |
| شاشة جديدة | `renderer/screens` + مسار في `router` |
| حدث SSE جديد | `shared/contracts.ts` ثم نشره من الخدمة |
