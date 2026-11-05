/**
 * كتالوج الأخطاء — المصدر الوحيد لرسائل الفشل.
 * كل خطأ يحمل: كودًا ثابتًا، رسالة عربية واحدة، وإجراءً واحدًا يفهمه غير التقني.
 */
export interface ErrorDefinition {
  readonly status: number;
  readonly message: string;
  readonly action: string;
}

export const ERROR_CATALOG = {
  'WS-0001': {
    status: 500,
    message: 'حدث خطأ غير متوقع داخل المحرّك.',
    action: 'أعد المحاولة، وإن تكرر أرسل حزمة التشخيص من الإعدادات.',
  },
  'WS-0002': {
    status: 404,
    message: 'العنصر المطلوب غير موجود.',
    action: 'حدّث القائمة ثم اختر العنصر مرة أخرى.',
  },
  'WS-0003': {
    status: 400,
    message: 'البيانات المرسلة غير صالحة.',
    action: 'راجع الحقول المميزة بالأحمر وصحّحها.',
  },
  'WS-0004': {
    status: 401,
    message: 'انتهت جلسة الاتصال بالمحرّك.',
    action: 'أعد تشغيل التطبيق.',
  },
  'WS-0005': {
    status: 403,
    message: 'هذا الإجراء يحتاج صلاحية مرتفعة.',
    action: 'أدخل كلمة مرور المكتب ثم أعد المحاولة.',
  },
  'WS-0006': {
    status: 409,
    message: 'لا يمكن تنفيذ الإجراء في الحالة الحالية.',
    action: 'حدّث الصفحة وتحقق من حالة العنصر.',
  },
  'WS-0007': {
    status: 429,
    message: 'محاولات كثيرة في وقت قصير.',
    action: 'انتظر قليلًا ثم أعد المحاولة.',
  },
  'WS-0008': {
    status: 503,
    message: 'خدمة مساعدة غير متاحة الآن.',
    action: 'افتح فحص البيئة وتأكد من أن كل المتطلبات خضراء.',
  },
  'WS-1001': {
    status: 404,
    message: 'لم يُعثر على مكتب في المسار المحدد.',
    action: 'اختر مجلد المكتب الصحيح أو أنشئ مكتبًا جديدًا.',
  },
  'WS-1002': {
    status: 409,
    message: 'المكتب مفتوح في نسخة أخرى من التطبيق.',
    action: 'أغلق النسخة الأخرى ثم أعد المحاولة.',
  },
  'WS-1003': {
    status: 500,
    message: 'تعذّر تحديث بنية قاعدة البيانات.',
    action: 'استعد أحدث نسخة احتياطية من مجلد backups.',
  },
  'WS-2001': {
    status: 404,
    message: 'القرص غير مسجّل في هذا المكتب.',
    action: 'سجّل القرص من شاشة الأقراص.',
  },
  'WS-2002': {
    status: 409,
    message: 'القرص غير موصول حاليًا.',
    action: 'وصّل القرص ثم اضغط «إعادة فحص».',
  },
  'WS-2003': {
    status: 409,
    message: 'ملف هوية القرص مفقود.',
    action: 'أعد تسجيل القرص بنفس الاسم دون نقل ملفاته.',
  },
  'WS-2004': {
    status: 409,
    message: 'هوية القرص لا تطابق هويته الفيزيائية (نسخة من القرص).',
    action: 'استخدم القرص الأصلي، أو سجّل هذه النسخة كقرص جديد للقراءة فقط.',
  },
  'WS-2005': {
    status: 409,
    message: 'المساحة الحرة لا تكفي لبدء العملية.',
    action: 'أرشف مواد قديمة أو فرّغ سلة المحذوفات ثم أعد المحاولة.',
  },
  'WS-3001': {
    status: 400,
    message: 'تعذّرت قراءة مجلد المصدر.',
    action: 'تأكد أن البطاقة موصولة وأن المجلد غير محمي.',
  },
  'WS-3002': {
    status: 500,
    message: 'فشل نسخ أحد الملفات من البطاقة.',
    action: 'أعد وصل البطاقة ثم أعد المحاولة؛ لن يُحذف أي ملف من المصدر.',
  },
  'WS-3003': {
    status: 500,
    message: 'الملف المنسوخ لا يطابق الأصل (فشل التحقق).',
    action: 'أعد المحاولة بكابل أو قارئ بطاقة آخر. المصدر سليم.',
  },
  'WS-3004': {
    status: 409,
    message: 'كل ملفات المصدر موجودة مسبقًا في المكتب.',
    action: 'افتح الحدث الأصلي أو اختر مصدرًا آخر.',
  },
  'WS-3005': {
    status: 400,
    message: 'لم يُعثر على ملفات وسائط في المصدر.',
    action: 'اختر المجلد الذي يحوي ملفات الفيديو أو الصور.',
  },
  'WS-3006': {
    status: 409,
    message: 'لا يمكن التراجع: يوجد ملف بالاسم نفسه في المصدر.',
    action: 'انقل الملف الموجود أو احذفه أولًا، ثم أعد المحاولة.',
  },
  'WS-3007': {
    status: 409,
    message: 'مصدر النقل غير متاح حاليًا.',
    action: 'وصّل البطاقة أو القرص الأصلي ثم أعد المحاولة.',
  },
  'WS-4001': {
    status: 409,
    message: 'انتقال الحالة المطلوب غير مسموح.',
    action: 'اختر الإجراء المتاح الظاهر في الصفحة.',
  },
  'WS-4002': {
    status: 409,
    message: 'لا يمكن إتمام الإجراء وهناك وظائف مفتوحة.',
    action: 'أوقف الوظائف أو انتظر انتهاءها أولًا.',
  },
  'WS-5001': {
    status: 404,
    message: 'الوظيفة غير موجودة.',
    action: 'حدّث قائمة الوظائف.',
  },
  'WS-5002': {
    status: 409,
    message: 'لا يمكن تغيير حالة الوظيفة الآن.',
    action: 'انتظر انتهاء الحالة الحالية ثم أعد المحاولة.',
  },
  'WS-5003': {
    status: 409,
    message: 'الوظيفة قيد التنفيذ بالفعل.',
    action: 'انتظر انتهاءها أو ألغِها أولًا.',
  },
  'WS-5004': {
    status: 409,
    message: 'أُلغيت الوظيفة.',
    action: 'أنشئ وظيفة جديدة إن كنت ما زلت تحتاج الناتج.',
  },
  'WS-5005': {
    status: 504,
    message: 'تجاوزت الوظيفة المدة القصوى المسموحة.',
    action: 'راجع السجل، ثم أعد المحاولة أو قلّل مدة المخرَج.',
  },
  'WS-5006': {
    status: 500,
    message: 'فشلت الوظيفة.',
    action: 'افتح سجل الوظيفة لمعرفة السبب، ثم أعد المحاولة.',
  },
  'WS-5007': {
    status: 500,
    message: 'ملف نتيجة الوظيفة غير صالح أو مفقود.',
    action: 'أعد تشغيل الوظيفة؛ لا تُعتمد النتائج غير الموثقة.',
  },
  'WS-5008': {
    status: 404,
    message: 'حزمة الأسلوب غير مثبتة.',
    action: 'ثبّت الحزمة من مجلد styles ثم أعد تحميل الأساليب.',
  },
  'WS-5009': {
    status: 409,
    message: 'متطلبات الأسلوب غير مكتملة على هذا الجهاز.',
    action: 'شغّل فحص البيئة وأكمل المتطلبات الناقصة.',
  },
  'WS-5010': {
    status: 503,
    message: 'الوكيل غير متاح.',
    action: 'شغّل OpenCode وسجّل الدخول، أو استخدم الوضع التجريبي.',
  },
  'WS-6001': {
    status: 400,
    message: 'قائمة التحقق غير مكتملة.',
    action: 'راجع كل البنود ثم أعد الاعتماد.',
  },
  'WS-6002': {
    status: 400,
    message: 'سبب الإعادة أو الرفض مطلوب.',
    action: 'اكتب سببًا واضحًا ليُرفق بالوظيفة الجديدة.',
  },
  'WS-6003': {
    status: 409,
    message: 'تمت مراجعة هذه الوظيفة مسبقًا.',
    action: 'حدّث الصفحة لعرض القرار المسجّل.',
  },
  'WS-7001': {
    status: 409,
    message: 'قرص الأرشفة غير موصول.',
    action: 'وصّل القرص البارد ثم أعد الفحص.',
  },
  'WS-7002': {
    status: 500,
    message: 'فشل التحقق من نسخة الأرشيف.',
    action: 'لم يُحذف المصدر. أعد الأرشفة أو استبدل القرص.',
  },
  'WS-8001': {
    status: 403,
    message: 'كلمة مرور المكتب مطلوبة.',
    action: 'أدخل كلمة المرور لفتح الصلاحية عشر دقائق.',
  },
  'WS-8002': {
    status: 401,
    message: 'كلمة مرور المكتب غير صحيحة.',
    action: 'أعد المحاولة بحذر؛ بعد خمس محاولات يتوقف الإدخال مؤقتًا.',
  },
  'WS-8003': {
    status: 429,
    message: 'توقّف إدخال كلمة المرور مؤقتًا.',
    action: 'انتظر المدة المعلنة ثم أعد المحاولة.',
  },
  'WS-9001': {
    status: 500,
    message: 'تعذّر إكمال فحص البيئة.',
    action: 'أعد الفحص، وإن تكرر أرسل حزمة التشخيص.',
  },
} as const satisfies Record<string, ErrorDefinition>;

export type ErrorCode = keyof typeof ERROR_CATALOG;

export interface SerializedError {
  code: ErrorCode;
  message: string;
  action: string;
  details?: unknown;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly action: string;
  readonly details?: unknown;
  override readonly cause?: unknown;

  constructor(code: ErrorCode, details?: unknown, cause?: unknown) {
    const definition = ERROR_CATALOG[code];
    super(definition.message);
    this.name = 'AppError';
    this.code = code;
    this.status = definition.status;
    this.action = definition.action;
    this.details = details;
    this.cause = cause;
  }

  static from(error: unknown): AppError {
    if (error instanceof AppError) return error;
    if (error instanceof Error) return new AppError('WS-0001', { reason: error.message }, error);
    return new AppError('WS-0001', { reason: String(error) });
  }

  toJSON(): SerializedError {
    const base: SerializedError = {
      code: this.code,
      message: this.message,
      action: this.action,
    };
    if (this.details !== undefined) base.details = this.details;
    return base;
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
