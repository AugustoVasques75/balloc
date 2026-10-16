# Balloc.js

`Balloc` هو مخصص ذاكرة يعتمد على تخصيص النتوء (**bump allocation**)، مع ناقلين مستقلين:

* `dataBus` — تخزين بيانات الكتل.


* `controlBus` — تخزين الرؤوس (headers) والبيانات الوصفية (metadata).



يتم تحديد الكتل خارجيًا بواسطة **معالج منطقي (logical handler) بطول 43 بت**، يتكون من جيل بطول 11 بت وعنوان الرأس الخاص به بطول 32 بت. السعة الفيزيائية للكتل تكون دائمًا قوة للعدد اثنين في عدد العناصر.

## أنطولوجيا واجهة برمجة التطبيقات (API Ontology)

```text
Balloc
├── Instanciamento
│   └── constructor()
│
├── Ciclo de vida dos blocos
│   ├── alloc()
│   ├── realloc()
│   ├── free()
│   └── gc()
│
├── Estruturas lineares
│   ├── Stack
│   │   ├── push()
│   │   ├── pop()
│   │   └── peek()
│   │
│   └── Queue
│       ├── nudge()
│       ├── pull()
│       └── head()
│
├── Acesso ao conteúdo
│   ├── has()
│   ├── get()
│   ├── set()
│   ├── clear()
│   ├── fill()
│   ├── fillAll()
│   ├── put()
│   └── pick()
│
├── Capacidade e ocupação
│   ├── byteSize()
│   ├── occupied()
│   └── length()
│
├── Operações entre blocos
│   ├── copy()
│   ├── copyWithin()
│   ├── append()
│   └── clone()
│   └── swap()
│
├── Serialização
│   ├── dump()
│   └── load()
│
├── Diagnóstico e utilização
│   ├── recycleCount()
│   ├── recycleBytes
│   ├── allocatedBytes
│   ├── unallocatedBytes
│   └── fragmentationRatio
│
└── Uso interno
    ├── Reciclagem
    │   ├── recyclePush()
    │   └── recyclePop()
    │
    ├── Escalonamento
    │   ├── grow()
    │   └── headerGrow()
    │
    └── Utilitários
        ├── extractMetadata()
        └── bakeCookie()

```

---

## دلالات السعة (Capacity Semantics)

تعتمد وحدة السعة المنطقية على `bucketSize`.

```text
bucketSize = "8i"  ou bucketSize = "8u"                         → 1 byte  por elemento
bucketSize = "16i" ou bucketSize = "16u" ou bucketSize = "16f"  → 2 bytes por elemento
bucketSize = "32i" ou bucketSize = "32u" ou bucketSize = "32f"  → 4 bytes por elemento
bucketSize = "64i" ou bucketSize = "64u" ou bucketSize = "64f"  → 8 bytes por elemento

```

يحسب المخصص السعة بـ **العناصر (elements)** كقوة للعدد اثنين ويحول لاحقًا هذه السعة إلى بايتات.

على سبيل المثال، مع `bucketSize = "32u"`:

```text
capacity = 8 elementos
wordSize = 4 bytes

byteCapacity = 8 × 4 = 32 bytes

```

السعة الفيزيائية والإشغال مفاهيم متميزة:

```text
length(handler)    → slots físicos
occupied(handler)  → slots ocupados
byteSize(handler)  → bytes físicos reservados

```

---

# 1. التهيئة (Instantiation)

## `new Balloc(size, bucketSize, metadataSize)`

ينشئ مخصص ذاكرة جديد.

ينقسم التخزين بين `dataBus` المخصص لبيانات الكتل، و `controlBus` المخصص للرؤوس. يتم تقريب السعة الأولية لكليهما وفقًا لستراتيجية النمو الداخلية.

### المعاملات (Parameters)

| المعامل | النوع | القوائم (Default) | الوصف |
| --- | --- | --- | --- |
| `size` | `number` | `65535` | السعة الأولية لـ `dataBus` بالبايت.

 |
| `bucketSize` | `BucketType` | حجم كل عنصر.

 | حجم كل عنصر.

 |
| `metadataSize` | `number` | `1024` | السعة الأولية لـ `controlBus` بالبايت.

 |

يجب أن يكون `size` عددًا صحيحًا آمنًا في النطاق `[2, 0x80000000]`.

يقبل `bucketSize` قيمة من نوع `BucketType` وهي سلسلة نصية بالصيغة `[الحجم بالبايت][نوع البيانات]` تقبل فقط ما هو موجود في الجدول:

| Signed Integer | Unigned Integer | Float |
| --- | --- | --- |
| `8i` | `8u` |  |
| `16i` | `16u` | `16f` |
| `32i` | `32u` | `32f` |
| `64i` | `64u` | `64f` |

يجب أن يكون `metadataSize` عددًا صحيحًا آمنًا في النطاق `[16, 0x80000000]`.

### الاستثناءات (Exceptions)

* `RangeError` — `size` خارج النطاق.


* `RangeError` — `bucketSize` يختلف عن المعرفات بواسطة `BucketType`.


* `RangeError` — `metadataSize` خارج النطاق المسموح به.



### مثال (Example)

```js
const { Balloc } = require("Balloc");

const memory = new Balloc();

```

استخدام عناصر عدد صحيح غير موجبة (unsigned) بطول 32 بت:

```js
const memory = new Balloc(65535, "32u");

```

يقوم المنشئ داخليًا بإنشاء مثيل `TypedArray` المقابل لـ `bucketSize`، بالإضافة إلى `DataView` المستخدمة للقراءة والكتابة.

---

# 2. دورة حياة الكتل (Block Lifecycle)

الدورة الأساسية للكتلة هي:

```text
alloc()
   │
   ├── operações sobre o bloco
   │
   ├── realloc()
   │
   └── free()
          │
          └── reciclagem

```

تتيح إعادة التدوير (recycling) إعادة استخدام المناطق المفرغة بسعة تتطابق تمامًا مع التخصيص الجديد.

## `alloc(size = 16)`

يخصص كتلة جديدة ويرجع المعالج الخاص بها.

يتم تقريب السعة إلى أصغر قوة للعدد اثنين تحتوي على `size` من العناصر. يتم البحث عن الكتلة أولاً في قائمة المناطق القابلة لإعادة التدوير؛ وإذا لم توجد منطقة متوافقة، يتم الحصول على المساحة من قمة `dataBus`.

### المعاملات

| المعامل | النوع | الافتراضي | الوصف |
| --- | --- | --- | --- |
| `size` | `number` | `16` | الحد الأدنى لعدد العناصر المطلوبة.

 |

يجب أن يكون `size` في النطاق `[2, 0x80000000]`.

### القيمة المرجعة (Returns)

```text
number

```

معالج الكتلة (Block handler).

يأخذ المعالج الشكل المنطقي:

```text
[ 11 bits de geração ][ 32 bits de endereço do header ]

```

### مثال

```js
const handler = memory.alloc(100);

memory.push(handler, 42);

```

طلب 100 عنصر لا يحجز 100 فتحة بالضبط: ستكون السعة هي القوة التالية للعدد اثنين.

---

## `realloc(handler)`

يزيد سعة الكتلة إلى القوة التالية للعدد اثنين.

إذا كانت الكتلة موجودة في القمة الحالية لـ `dataBus`، يحدث التوسيع **في المكان (in-place)**. خلاف ذلك، يتم الحصول على منطقة جديدة من نظام إعادة التدوير أو من قمة كومة الذاكرة (heap)، وتنسخ العناصر المشغولة ويتم إعادة تدوير المنطقة السابقة.

لا يتغيّر المعالج نظرًا للحفاظ على الرأس الخاص به.

### المعاملات

| المعامل | النوع | الوصف |
| --- | --- | --- |
| `handler` | `number` | معالج الكتلة.

 |

### القيمة المرجعة

```text
void

```

### الاستثناءات

* `Error` — معالج غير صالح أو تالف.


* `AggregateError` — وصلت السعة إلى الحد الأقصى.



### مثال

```js
const handler = memory.alloc(8);

memory.realloc(handler);

```

تضاعف العملية السعة الفيزيائية، منتقلة إلى القوة التالية للعدد اثنين.

---

## `free(handler)`

يحرر الكتلة.

يتم إبطال الرأس عبر تصفير الكوكيز الخاص به. منطقة البيانات:

* تُعاد إلى إعادة التدوير عندما لا تكون في قمة `dataBus`.


* تُحذف مباشرة من القمة عندما تكون المنطقة الأحدث في الكومة.



### المعاملات

| المعامل | النوع | الوصف |
| --- | --- | --- |
| `handler` | `number` | معالج الكتلة.

 |

### القيمة المرجعة

```text
void

```

### الاستثناءات

`Error` عندما يكون المعالج غير صالح أو تالف.

```js
memory.free(handler);

```

يفقد المعالج المحرر صلاحيته.

---

## `gc()`

يقوم بضغط `dataBus` عبر خوارزمية **ReBump**.

تمر العملية عبر الرؤوس الموجودة في `controlBus`، وتنسخ الكتل الصالحة فقط إلى `dataBus` جديد وتحدث عناوينها في الرؤوس. يتم القضاء على المساحات الفارغة بين الكتل.

### التأثيرات (Effects)

* تقضي على جميع المناطق الموجودة في `recycle`;


* تضغط الكتل الحية;


* تحافظ على ترتيب الرؤوس;


* تحافظ على السعة الفيزيائية للكتل;


* تحافظ على الإشغال;


* تحديث عناوين الكتل;


* تعيد وضع `dataPointer` بعد آخر كتلة حية.



### القيمة المرجعة

```text
void

```

### التعقيد (Complexity)

اجتياز الرؤوس هو `O(n)`، حيث `n` هو عدد الرؤوس المفحوصة. تعتمد التكلفة الإجمالية أيضًا على حجم البيانات المنقولة.

```js
memory.gc();

```

لا يغير `gc()` المعاملات، حيث تظل الرؤوس في نفس العناوين؛ فقط مناطق البيانات هي التي يتم ضغطها.

---

# 3. الهياكل الخطية (Linear Structures)

يمكن استخدام الكتل كهياكل خطية يتم الوصول إليها من الأطراف.

## 3.1 المكدس (Stack)

### `push(handler, value)`

يضيف `value` إلى نهاية التسلسل المشغول.

إذا لم تتوفر مساحة، فلن يتم إدراج أي عنصر وتُرجع الدالة `false`.

```js
memory.push(handler, 10);
memory.push(handler, 20);
memory.push(handler, 30);

```

الإرجاع:

```text
boolean

```

* `true` — تم إدراج العنصر.


* `false` — الكتلة ممتلئة.



---

### `pop(handler)`

يزيل ويرجع العنصر المشغول الأخير.

يتم إنقاص الإشغال قبل قراءة العنصر. البايتات القديمة لا تُمسح.

الإرجاع:

```text
number | undefined

```

يشير `undefined` إلى كتلة فارغة.

```js
const value = memory.pop(handler);

```

---

### `peek(handler)`

يرجع العنصر المشغول الأخير دون إزالته.

الإرجاع:

```text
number | undefined

```

---

## 3.2 طابور الانتظار (Queue)

### `nudge(handler, value)`

يدرج عنصرًا في بداية التسلسل المشغول.

يتم إزاحة العناصر الموجودة بمقدار موضع واحد للأمام. العملية تتناسب طرديًا مع عدد العناصر المشغولة.

الإرجاع:

```text
boolean

```

* `true` — تم إدراج العنصر.


* `false` — الكتلة ممتلئة.



---

### `pull(handler)`

يزيل ويرجع العنصر الأول.

يتم إزاحة العناصر المتبقية بمقدار موضع واحد نحو البداية.

الإرجاع:

```text
number | undefined

```

---

### `head(handler)`

يرجع العنصر الأول دون إزالته.

الإرجاع:

```text
number | undefined

```

---

# 4. الوصول إلى المحتوى (Content Access)

## `has(handler, value)`

يتحقق مما إذا كان `value` من بين العناصر المشغولة.

يستخدم البحث `TypedArray` المساعد ويعتبر فقط `[0, occupied)`، متجاهلاً السعة الفيزيائية غير المشغولة.

```js
if (memory.has(handler, 42)) {
    // ...
}

```

الإرجاع:

```text
boolean

```

---

## `get(handler, index)`

يحصل على العنصر في الفهرس المحدد.

الفهرس يبدأ من الصفر. الفهارس خارج نطاق `[0, occupied)` ترجع `undefined`.

```js
const value = memory.get(handler, 3);

```

الإرجاع:

```text
number | undefined

```

---

## `set(handler, index, value)`

يستبدل عنصر الفهرس المشغول.

لا يتم تعديل الإشغال.

الفهارس خارج نطاق `[0, occupied)` يتم تجاهلها وتجعل الدالة ترجع `false`.

```js
memory.set(handler, 3, 99);

```

الإرجاع:

```text
boolean

```

* `true` — تم حفظ القيمة.


* `false` — فهرس غير صالح للمنطقة المشغولة.



---

## `clear(handler, value = 0)`

يصفر الإشغال ويملأ **جميع الفتحات الفيزيائية** للكتلة بـ `value`.

يشمل ذلك الفتحات التي لم تكن جزءًا من التسلسل المشغول.

```js
memory.clear(handler);

```

بعد العملية:

```text
occupied = 0

```

تبقى السعة الفيزيائية دون تغيير.

---

## `fill(handler, value, start = 0, end = null)`

يملأ نطاقًا من الفتحات بـ `value`.

يتبع النطاق الاصطلاح:

```text
[start, end)

```

`start` متضمن و `end` مستبعد. عندما يكون `end` هو `null`، يكون الحد هو السعة الفيزيائية الكلية. يصبح الإشغال مساويًا لـ `end`.

```js
memory.fill(handler, 0, 2, 6);

```

يملاء:

```text
2, 3, 4, 5

```

### الاستثناءات

`RangeError` عندما:

* `start < 0`;


* `start > capacity`;


* `end < 0`;


* `end > capacity`;


* `start > end`.



---

## `fillAll(handler, value)`

يملأ جميع الفتحات الفيزيائية بـ `value` ويضع علامة على كامل السعة على أنها مشغولة.

يكافئ ملء السعة بالكامل متبوعًا بتعريف:

```text
occupied = capacity

```

على عكس `clear()`، تنتهي الكتلة مشغولة بالكامل.

```js
memory.fillAll(handler, 0);

```

---

## `put(handler, data)`

ينسخ `Array` أو `TypedArray` إلى بداية الكتلة.

الكمية المنسوخة مقيدة بسعة الكتلة. يصبح الإشغال هو القيمة الكبرى بين الإشغال السابق والكمية المنسوخة فعليًا. لذلك، لا يقلل `put()` الإشغال الموجود عند تلقي تسلسل أصغر.

```js
memory.put(handler, [10, 20, 30, 40]);

```

يقبل أيضًا `TypedArray`:

```js
memory.put(handler, new Uint32Array([10, 20, 30]));

```

### الأنواع المقبولة

```text
Array
TypedArray

```

### الاستثناءات

`TypeError` عندما لا يكون `data` لا `Array` ولا `TypedArray`.

---

## `pick(handler)`

يرجع نسخة من العناصر المشغولة حاليًا.

يتطابق نوع `TypedArray` المرتجع مع `bucketSize` المُكوّن في المخصص. لا يتم تضمين السعة الفيزيائية غير المشغولة.

```js
const values = memory.pick(handler);

```

النتيجة لها تخزين مستقل عن `dataBus`.

لمخصص `bucketSize = "32u"`، على سبيل المثال، سيخزن النوع `Uint32Array` النتيجة.

---

# 5. السعة والإشغال (Capacity and Occupation)

## `byteSize(handler)`

يرجع السعة الفيزيائية للكتلة بالبايت.

لا يمثل كمية البايتات المشغولة حاليًا بواسطة العناصر؛ بل يمثل المساحة المحجوزة لجميع فتحات الكتلة.

```js
const bytes = memory.byteSize(handler);

```

---

## `occupied(handler)`

يرجع عدد العناصر المشغولة حاليًا.

```js
const count = memory.occupied(handler);

```

---

## `length(handler)`

يرجع الكمية الإجمالية للفتحات الفيزيائية المتاحة.

السعة مستقلة عن الإشغال:

```text
length >= occupied

```

```js
const capacity = memory.length(handler);

```

---

# 6. العمليات بين الكتل (Inter-block Operations)

## `copy(source, destiny, slots = UNKNOWN)`

ينسخ العناصر المشغولة من `source` إلى بداية `destiny`.

الكمية المنسوخة مقيدة بـ:

1. إشغال `source`;


2. سعة `destiny`;


3. `slots`.



يزداد إشغال `destiny` عند الضرورة، لكن سعته لا تتغير.

```js
memory.copy(source, destiny);

```

التقييد الصريح:

```js
memory.copy(source, destiny, 8);

```

### القيمة المرجعة

```text
Uint8Array

```

هو `dataBus` نفسه بعد العملية.

---

## `copyWithin(handler, target, start, length)`

ينسخ منطقة داخل الكتلة نفسها.

تتبع الدلالات مفهوم `Array.prototype.copyWithin()`، ولكنها تُطبق على السعة الفيزيائية للكتلة ومقيدة بالإشغال المتوفر في المصدر.

```js
memory.copyWithin(handler, 4, 0, 4);

```

يتم تفسير الفهارس السلبية بالنسبة لنهاية السعة.

العملية:

* تدعم المناطق المتداخلة;


* تقيد الفهارس بالسعة;


* تقيد القراءة بالمنطقة المشغولة;


* تقيد الكتابة بالسعة;


* يمكنها زيادة `occupied`.



الإرجاع:

```text
Uint8Array

```

هو `dataBus`.

---

## `append(target, source)`

يُلحق العناصر المشغولة لـ `source` بنهاية العناصر المشغولة لـ `target`.

الكمية مقيدة بإشغال المصدر والمساحة المتاحة في الوجهة.

```js
const count = memory.append(target, source);

```

### القيمة المرجعة

```text
number

```

عدد العناصر المضافة فعليًا.

تقبل العملية أيضًا:

```js
memory.append(handler, handler);

```

عندما يكون `target` و `source` هما نفس الكتلة.

---

## `clone(handler)`

ينشئ نسخة مستقلة من الكتلة.

تمتلك النسخة:

* نفس السعة الفيزيائية;


* نفس الإشغال;


* نفس بايتات المنطقة المحجوزة بالكامل;


* معالجًا جديدًا.



```js
const copy = memory.clone(handler);

```

المحتوى غير المشغول يُنسخ أيضًا.

---

## `swap(source, target)`

يُبدل مناطق البيانات المرتبطة بمعالجين اثنين.

تبدل العملية في الرؤوس:

* العنوان;


* السعة;


* الإشغال.



لا يُنسخ أي بايت في `dataBus`. تستمر المعالجات في الإشارة إلى رؤوسها الخاصة.

```js
memory.swap(a, b);

```

من الناحية المفاهيمية:

```text
antes:

handler A → região A
handler B → região B

depois:

handler A → região B
handler B → região A

```

---

# 7. التسلسل (Serialization)

طرق مخصصة لدعم تصدير واستيراد حالة الكتل باستخدام تنسيق CBOR.

## `dump(handler)`

يقوم بتسلسل محتوى كتلة ذاكرة مُحددة بواسطة `handler`.

يستخرج التابع البيانات المشغولة للكتلة ويجمعها مع معلومات السعة وننوع الكلمة (word type) في مظروف بيانات ويقوم بترميزها باستخدام تنسيق CBOR.

### القيمة المرجعة

```text
Uint8Array


```

مخزن مؤقت (buffer) يحتوي على البيانات المتسلسلة للكتلة.

### الاستثناءات

`Error` — إذا كان المعالج غير صالح أو تالفًا.

---

## `load(serialized)`

يستعيد كتلة ذاكرة من البيانات المتسلسلة.

يفك ترميز مظروف CBOR المُتمرر في `serialized`، ويتحقق مما إذا كان نوع الكلمة للبيانات المتسلسلة متوافقًا مع المثيل الحالي للمخصص ويخصص كتلة جديدة بالسعة اللازمة لاستيعاب المحتوى. بعد ذلك، يتم استعادة البيانات والإشغال الأصلي في الكتلة الجديدة.

### القيمة المرجعة

```text
number


```

معالج الكتلة المُعاد إنشاؤها حديثًا.

### الاستثناءات

`Error` — إذا كان نوع كلمة البيانات المفككة يختلف عن المُكوّن في المخصص.

---

# 8. التشخيص والاستخدام (Diagnosis and Utilization)

## `recycleCount()`

يرجع كمية المناطق المخزنة حاليًا في نظام إعادة التدوير.

توافق المنطقة مساحة مُحررة لم يمكن ببساطة إزالتها من قمة `dataBus`.

```js
const count = memory.recycleCount();

```

---

## `recycleBytes`

مُسترجع (Getter) يرجع إجمالي البايتات المنتمية للمناطق القابلة لإعادة التدوير حاليًا.

```js
const bytes = memory.recycleBytes;

```

تُحسب القيمة كـ:

```text
Σ(capacity × quantidade_de_regiões)

```

---

## `allocatedBytes`

مُسترجع يرجع البايتات المرتبطة بالمناطق التي ليست حاليًا في قائمة إعادة التدوير.

يُحسب بواسطة:

```text
dataPointer - recycleBytes

```

```js
const bytes = memory.allocatedBytes;

```

---

## `unallocatedBytes`

مُسترجع يرجع المساحة التي لا تزال متاحة في قمة `dataBus`.

هي المنطقة بين `dataPointer` ونهاية السعة المحجوزة:

```text
size - dataPointer

```

```js
const bytes = memory.unallocatedBytes;

```

---

## `fragmentationRatio`

مُسترجع يحسب النسبية بين البايتات القابلة لإعادة التدوير ومنطقة الكومة التي اجتازها بالفعل مؤشر النتوء (bump pointer).

```text
recycleBytes / dataPointer

```

عندما يكون `dataPointer` مساويًا لصفر، تكون النتيجة `0`.

```js
const ratio = memory.fragmentationRatio;

```

تقيس القيمة التجزئة **داخل المنطقة المستخدمة بالفعل من الكومة**، وليس ביחס للسعة الإجمالية لـ `dataBus`.

---

# 9. الاستخدام الداخلي (Internal Usage)

تعتبر الطرق في هذا القسم جزءًا من تنفيذ `Balloc` ولا تشكل واجهة البرمجة المخصصة لرمز المستهلك.

```text
Uso interno
├── Reciclagem
│   ├── recyclePush()
│   └── recyclePop()
│
├── Escalonamento
│   ├── grow()
│   └── headerGrow()
│
└── Validação / metadados
    ├── extractMetadata()
    └── bakeCookie()

```

## 9.1 إعادة التدوير (Recycling)

### `recyclePush(capacity, address)`

**خاص (Private).**

يُدرج منطقة حرة في قائمة إعادة التدوير المرتبطة بسعتها بالبايت.

تتمثل كل سعة في صفحة يمثلها `Uint32Array`:

```text
[count, address1, address2, ...]

```

يعمل الهيكل كمكدس LIFO. عندما تمتلئ الصفحة، يتم توسيع المخزن المؤقت الخاص بها إلى الضعف.

---

### `recyclePop(capacity)`

**خاص.**

يزيل ويرجع منطقة قابلة لإعادة التدوير ذات سعة دقيقة.

تتم الإزالة من نهاية الصفحة، ممثلة سلوك LIFO.

الإرجاع:

```text
address

```

أو:

```js
UNKNOWN // 0xFFFFFFFF

```

عندما لا توجد منطقة متاحة لتلك السعة.

---

## 9.2 التحجيم أو الجدولة (Scaling)

### `grow()`
يمكنك أيضاً الحصول على هذا التوثيق مترجم إلى لغات أخرى:
| اللغة | الرابط |
|---|---|
| العربية | [API — balloc.ar.md](./docs/API%20—%20balloc.ar.md) |
| الصينية | [API — balloc.zh.md](./docs/API%20—%20balloc.zh.md) |
| الإسبانية | [API — balloc.es.md](./docs/API%20—%20balloc.es.md) |
| الإنجليزية | [API — balloc.en.md](./docs/API%20—%20balloc.en.md) |
| اليابانية | [API — balloc.jp.md](./docs/API%20—%20balloc.jp.md) |
| البرتغالية | [API — balloc.pt.md](./docs/API%20—%20balloc.pt.md) |

**خاص. لا تستخدم مباشرة.**

يضاعف سعة `dataBus`.

يتم نقل `ArrayBuffer` الأساسي إلى مخزن مؤقت أكبر ويتم إعادة إنشاء العروض المرتبطة.

يتم تشغيله تلقائيًا عندما لا تتسع منطقة جديدة في المساحة المتبقية من `dataBus`.

---

### `headerGrow()`

**خاص. لا تستخدم مباشرة.**

يضاعف سعة `controlBus`.

يتم الحفاظ على الرؤوس الموجودة أثناء نقل `ArrayBuffer`، ويتم إعادة إنشاء `controlAdapter` فوق التخزين الجديد.

يتم تشغيله تلقائيًا عندما لا توجد مساحة لرأس جديد.

---

## 9.3 التحقق والبيانات الوصفية (Validation and Metadata)

### `extractMetadata(handler, out)`

**خاص.**

يقوم بفك تشفير والتحقق من صحة المعالج.

يستخرج التابع:

```text
generation
headerAddress
dataAddress
capacityExponent
byteCapacity
occupied

```

يتم التحقق من صلاحية المعالج عن طريق إعادة حساب الكوكيز المخزن في الرأس. الكائن `out` قابل لإعادة الاستخدام، مما يسمح بتجنب تخصيصات جديدة.

التوقيع (Signature):

```js
extractMetadata(handler, out)

```

الإرجاع:

```text
Metadata

```

القيمة المرجعة هي نفس المرجع المُقدم في `out`.

---

### `bakeCookie(addr, gen)`

**خاص.**

يحسب كوكيز التحقق المستخدم للتحقق من صحة المعالجات.

يجمع الكوكيز بين:

* عنوان الرأس;


* بتات الجيل الـ 11 السفلية.



يتم تقليص النتيجة إلى 8 بتات. القيمة `0` محجوزة للإشارة إلى رأس غير صالح، لذلك يستبدل التابع `0` بـ `1`.

الكوكيز ليس تشفيريًا. وتظيفته هي اكتشاف المعالجات غير الصالحة، القديمة (`stale`) أو التالفة ضمن نموذج إدارة المخصص.

---

# 10. نموذج التخزين (Storage Model)

تحتوي كل كتلة على رأس ثابت بطول **16 بايت**:

```text
offset  tamanho  campo
──────  ───────  ─────────────
0       4 bytes  address
4       4 bytes  occupied
8       1 byte   capacity
9       1 byte   cookie
10      6 bytes  reserved

```

الحتوي الحقول ذات الصلة على:

### `address`

العنوان الأولي لمنطقة البيانات داخل `dataBus`.

### `occupied`

عدد العناصر المشغولة حاليًا.

### `capacity`

أس قوة العدد اثنين الذي يمثل السعة الفيزيائية:

```text
capacityElements = 2 ** capacity

```

السعة بالبايت هي:

```text
capacityBytes = 2 ** capacity × wordSize

```

### `cookie`

قيمة التحقق المرتبطة بعنوان الرأس وجيل المعالج.

---

# 11. المعالجات (Handlers)

المعالج هو المعرف الخارجي المستخدم من قبل جميع عمليات الكتل تقريبا.

تركيبه المنطقي هو:

```text
┌───────────────────────┬───────────────────────────────┐
│ geração — 11 bits     │ endereço do header — 32 bits  │
└───────────────────────┴───────────────────────────────┘

```

الجزء السفلي يتوافق مباشرة مع عنوان الرأس؛ الجزء العلوي يمثل الجيل.

يشارك الجيل في التحقق عبر الكوكيز. ونتيجة لذلك، فإن المعالج غير الصالح أو الذي تم إبطال رأسه يسبب خطأ في العمليات التي تستخدمه.

---

# 12. ملخص واجهة برمجة التطبيقات العامة (Public API Summary)

| الفئة (Category) | الطريقة / الخاصية | القيمة المرجعة |
| --- | --- | --- |
| التهيئة | `constructor()` | `Balloc`|
| دورة الحياة | `alloc()` | `number`|
| دورة الحياة | `realloc()` | `void`|
| دورة الحياة | `free()` | `void`|
| دورة الحياة | `gc()` | `void`|
| المكدس | `push()` | `boolean`|
| المكدس | `pop()` | `number |
| المكدس | `peek()` | `number |
| الطابور | `nudge()` | `boolean`|
| الطابور | `pull()` | `number |
| الطابور | `head()` | `number |
| الوصول | `has()` | `boolean`|
| الوصول | `get()` | `number |
| الوصول | `set()` | `boolean`|
| الوصول | `clear()` | `void`|
| الوصول | `fill()` | `void`|
| الوصول | `fillAll()` | `void`|
| الوصول | `put()` | `void`|
| الوصول | `pick()` | `TypedArray`|
| السعة | `byteSize()` | `number`|
| السعة | `occupied()` | `number`|
| السعة | `length()` | `number`|
| الكتل | `copy()` | `Uint8Array`|
| الكتل | `copyWithin()` | `Uint8Array`|
| الكتل | `append()` | `number`|
| الكتل | `clone()` | `number`|
| الكتل | `swap()` | `void`|
| التسلسل | `dump()` | `Uint8Array`|
| التسلسل | `load()` | `number`|
| التشخيص | `recycleCount()` | `number`|
| التشخيص | `recycleBytes` | `number`|
| التشخيص | `allocatedBytes` | `number`|
| التشخيص | `unallocatedBytes` | `number`|
| التشخيص | `fragmentationRatio` | `number`|

## الطرق الداخلية (Internal Methods)

| المجموعة | الطريقة | الرؤية (Visibility) |
| --- | --- | --- |
| إعادة التدوير | `recyclePush()` | خاص (privada) |
| إعادة التدوير | `recyclePop()` | خاص (privada) |
| التحجيم | `grow()` | خاص (privada) |
| التحجيم | `headerGrow()` | خاص (privada) |
| البيانات الوصفية | `extractMetadata()` | خاص (privada) |
| التحقق | `bakeCookie()` | خاص (privada) |