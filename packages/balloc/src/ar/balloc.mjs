import { encode, decode } from 'cbor-x';

/**
 * علامة تشير إلى قيمة غير صالحة أو غير معروفة.
 */
const UNKNOWN = 0xFFFFFFFF >>> 0;

/**
 * أحجام وأنواع الحاويات (Buckets) الصالحة.
 * يتم دعم الأحجام 8، 16، 32، و64 بتاً فقط للأنواع الصحيحة، و
 * يتم دعم الأحجام 16، 32، و64 بتاً فقط للأنواع العائمة (Floats).
 * أنواع البيانات المدعومة:
 * u = صحيح بدون إشارة (Unsigned integer)
 * i = صحيح بإشارة (Signed integer)
 * f = عدد عائم (Float)
 * 
 * بناء جملة معرف الحاويات:
 * 
 * [الحجم بالبت][نوع البيانات]
 * 
 * أمثلة:
 * حاوية أعداد صحيحة بدون إشارة سعة 32 بتاً: 32u
 * حاوية أعداد صحيحة بإشارة سعة 64 بتاً: 64i
 * 
 */
const BUCKET_MAPPING = Object.freeze({
    "8u": { type: "Uint8", bits: 8 },
    "16u": { type: "Uint16", bits: 16 },
    "32u": { type: "Uint32", bits: 32 },
    "64u": { type: "BigUint64", bits: 64 },
    "8i": { type: "Int8", bits: 8 },
    "16i": { type: "Int16", bits: 16 },
    "32i": { type: "Int32", bits: 32 },
    "64i": { type: "BigInt64", bits: 64 },
    "16f": { type: "Float16", bits: 16 },
    "32f": { type: "Float32", bits: 32 },
    "64f": { type: "Float64", bits: 64 }
});

/**
 * أنواع الحاويات المدعومة بواسطة المخصص (Allocator):
 * - الأعداد الصحيحة بدون إشارة: '8u', '16u', '32u', '64u'
 * - الأعداد الصحيحة بإشارة: '8i', '16i', '32i', '64i'
 * - الفاصلة العائمة: '16f', '32f', '64f'
 *
 * @typedef {'8u'|'16u'|'32u'|'64u'|'8i'|'16i'|'32i'|'64i'|'16f'|'32f'|'64f'} BucketType
 */

/**
 * علامة ترتيب البايتات (Endianness) للنظام.
 *
 * تكتشف ما إذا كان النظام يعمل بنظام الترتيب الصغير (Little Endian)، مما يؤثر
 * على ترتيب البايتات في عمليات DataView.
 */
const IS_LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;


/**
 * تنسيق البيانات الوصفية (Metadata).
 *
 * [32bits address][32bits occupied][8bits capacity][8bits cookie][8bits flags][40bits reserved]
 *
 *
 * الإجمالي: 16 بايت
 */
const HEADER_SIZE = 16 >>> 0;
const ADDRESS_OFFSET = 0 >>> 0;
const OCCUPIED_OFFSET = 4 >>> 0;
const CAPACITY_OFFSET = 8 >>> 0;
const COOKIE_OFFSET = 9 >>> 0;
const FLAGS_OFFSET = 10 >>> 0;

/**
 * الأعلام (Flags):
 * bit 0: VIEW_LOCK
 */
const VIEW_LOCK = 1 >>> 0;


const ROTATE_32BITS = 4294967296;
const CLAMP_11BITS = 0x7FF >>> 0;

/**
 * الهيكل الذي يحتوي على البيانات الوصفية المشفرة في المقبض (Handle).
 * 
 * @typedef {Object} Metadata
 * @property {number} byteCapacity - سعة كتلة الذاكرة بالبايت.
 * @property {number} capacityExponent - سعة كتلة الذاكرة معبر عنها كأُس للأساس اثنين.
 * @property {number} dataAddress - عنوان كتلة الذاكرة داخل dataBus.
 * @property {number} generation - الجيل الذي ينتمي إليه المقبض.
 * @property {number} headerAddress - عنوان الترويسة (Header) داخل controlBus.
 * @property {number} occupied - عدد العناصر المشغولة في الكتلة.
 * @property {number} borrowed - علامة تشير إلى ما إذا كانت الكتلة قد أُعيرت بواسطة withView().
 */

/**
 * يتحقق مما إذا كانت القيمة مثيلاً لـ TypedArray.
 * 
 * @param {any} val - القيمة المراد اختبارها.
 * @returns {boolean} `true` إذا كانت القيمة TypedArray، وإلا `false`.
 */
const isTypedArray = (val) => ArrayBuffer.isView(val) && !(val instanceof DataView);

/**
 * مخصص الذاكرة المتقاطع ذو الحافتين مع مكدس صدى وإدارة النفايات ReBump.
 */
/**
 * عقد محوّل متزامن لإدخال البيانات.
 *
 * يتلقى المحوّل نسخة Balloc ويستخدم واجهتها العامة لتخزين البيانات، ثم يعيد المعالج الذي يحدد الكتلة الرئيسية.
 *
 * @typedef {Object} FormatAdapter
 * @property {(allocator: Balloc) => number} load - يحمّل البيانات إلى المخصّص ويعيد المعالج المقابل.
 */

export default class Balloc {

    /**
     * ينشئ مثيلاً من مخصص الذاكرة `Balloc`.
     *
     * يحافظ المخصص على مخزنين مؤقتين مستقلين:
     * - `dataBus`: يخزن بيانات الكتل المخصصة؛
     * - `controlBus`: يخزن التويسات (Headers) وبيانات التحكم الوصفية الأخرى.
     *
     * تمتلك كل كتلة ترويسة ذات حجم ثابت (`HEADER_SIZE`) ويتم
     * تعريفها خارجيًا بواسطة مقبض منطقي بـ 43 بتاً، يتكون
     * من جيل بـ 11 بتاً وعنوان الترويسة الخاص بها بـ 32 بتاً.
     *
     * يتم تقريب سعة كل كتلة إلى أقرب قوة للعدد
     * اثنين في العناصر، مع احترام عرض الحوية (Bucket) المُكوّنة.
     *
     * @param {number} [size=65535] - السعة الأولية لـ `dataBus`، بالبايت.
     * يجب أن يكون عدداً صحيحاً آمناً في النطاق [2, 0x80000000].
     * @param {BucketType} [bucketSize="32u"] - معرف نوع وحجم الحاوية
     * (مثل: '32u' لـ Uint32، '64f' لـ Float64، '8i' لـ Int8).
     * @param {number} [metadataSize=1024] - السعة الأولية لـ `controlBus`،
     * بالبايت. يجب أن يكون عدداً صحيحاً آمناً في النطاق
     * [HEADER_SIZE, 0x80000000].
     *
     * @throws {RangeError} إذا كان `size` خارج النطاق المسموح به.
     * @throws {RangeError} إذا لم يكن `bucketSize` معرف حاوية صالحاً.
     * @throws {RangeError} إذا كان `metadataSize` خارج النطاق المسموح به.
     */
    constructor(size = 65535, bucketSize = "32u", metadataSize = 1024) {

        if (!Number.isSafeInteger(size) || size < 2 || size > 0x80000000) throw new RangeError(`Parameter size must be in range [2, 0x80000000] but size is ${size}`);


        if (!BUCKET_MAPPING[bucketSize]) {
            throw new RangeError(`bucketSize must be in ([ 8 || 16 || 32 || 64][ u || i ]) || ([ 16 || 32 || 64][ f ]) but I found ${bucketSize}`);
        }

        if (!Number.isSafeInteger(metadataSize) || metadataSize < HEADER_SIZE || metadataSize > 0x80000000) throw new RangeError(`Parameter metadataSize must be in range [HEADER_SIZE, 0x80000000] but metadataSize is ${metadataSize}`);

        this.wordType = bucketSize;
        this.bucketType = BUCKET_MAPPING[bucketSize].type;
        this.bucketSize = BUCKET_MAPPING[bucketSize].bits >>> 0;
        this.bucketArray = globalThis[`${this.bucketType}Array`];
        this.wordSize = this.bucketSize >>> 3;
        this.wordShift = this.bucketSize >>> 4;
        this.size = Math.max(1 << (32 - Math.clz32(size - 1)) >>> 0, this.wordSize);
        this.headerSize = 1 << (32 - Math.clz32(metadataSize - 1)) >>> 0;
        this.dataPointer = 0 >>> 0;
        this.controlPointer = 0 >>> 0;
        this.echoPointer = 0 >>> 0;
        this.generation = 0 >>> 0;
        this.dataBus = new Uint8Array(this.size);
        this.controlBus = new Uint8Array(this.headerSize);
        this.dataAdapter = new DataView(this.dataBus.buffer);
        this.controlAdapter = new DataView(this.controlBus.buffer);
        this.auxiliary = new globalThis[`${this.bucketType}Array`](this.dataBus.buffer);
        this.writer = this.dataAdapter[`set${this.bucketType}`].bind(this.dataAdapter);
        this.reader = this.dataAdapter[`get${this.bucketType}`].bind(this.dataAdapter);
        this.recycle = new Map();

        /** @type {Metadata} */
        this.metadata = {
            generation: 0 >>> 0,
            headerAddress: 0 >>> 0,
            dataAddress: 0 >>> 0,
            capacityExponent: 0 >>> 0,
            byteCapacity: 0 >>> 0,
            occupied: 0 >>> 0,
        };

    }

    // ========== التخصيص (ALLOCATION) ==========

    /**
     * يخصص كتلة ذاكرة جديدة.
     *
     * يتم تحويل السعة المطلوبة إلى أصغر قوة للعدد اثنين يمكنها
     * استيعاب العناصر المحددة في `size`. يتم الحصول على الكتلة تفضيلياً من قائمة
     * المناطق القابلة لإعادة التدوير ذات السعة المقابلة؛ وإذا لم تكن هناك
     * منطقة متوافقة، يتم حجز الكتلة في قمة `dataBus`.
     *
     * بعد ذلك، يتم الحصول على ترويسة من مساحة التحكم. يمكن إعادة استخدام الترويسات التي تم تحريرها مسبقاً
     * عبر مكدس إعادة التدوير الداخلي؛
     * وإلا، يتم توسيع `controlBus` عند الضرورة.
     *
     * تتلقى الترويسة العنوان، السعة، الإشغال الأولي (صفر)، وملف تعريف الارتباط (Cookie) للتحقق.
     * القيمة المُعطاة تشفر جيل التخصيص وعنوان الترويسة:
     *
     *     [11 بتاً للجيل][32 بتاً لعنوان الترويسة]
     *
     * @param {number} [size=16] - الحد الأدنى لعدد العناصر التي يجب أن تستوعبها الكتلة.
     * يجب أن يكون عدداً صحيحاً آمناً في النطاق [2, 0x80000000].
     * @returns {number} المقبض الذي يحدد الكتلة المخصصة.
     * @throws {RangeError} إذا كان `size` خارج النطاق المسموح به.
     * @throws {Error} إذا كان من الضروري توسيع `dataBus` بينما توجد
     * أي كتلة معارة بواسطة withView().
     */
    alloc(size = 16) {
        if (!Number.isSafeInteger(size) || size < 2 || size > 0x80000000) throw new RangeError(`Parameter size must be in range [2, 0x80000000] but size is ${size}`);

        const capacity = (32 - Math.clz32(size - 1));
        const blockSize = (1 << capacity >>> 0) * this.wordSize;

        let dataAddress = this.recyclePop(blockSize);

        if (dataAddress === UNKNOWN) {
            while (this.dataPointer + blockSize > this.size) this.grow();
            dataAddress = this.dataPointer;
            this.dataPointer += blockSize;
        }

        let headerAddress = 0 >>> 0;
        if (this.echoPointer > this.controlPointer) {
            this.echoPointer -= 4;
            headerAddress = this.controlAdapter.getUint32(this.echoPointer, IS_LITTLE_ENDIAN);
        } else {
            if (this.controlPointer + HEADER_SIZE > this.controlAdapter.byteLength) this.headerGrow();
            headerAddress = this.controlPointer;
            this.controlPointer += HEADER_SIZE;
            this.echoPointer += HEADER_SIZE;
        }

        this.controlAdapter.setUint32(headerAddress + ADDRESS_OFFSET, dataAddress, IS_LITTLE_ENDIAN);
        this.controlAdapter.setUint32(headerAddress + OCCUPIED_OFFSET, 0, IS_LITTLE_ENDIAN);
        this.controlAdapter.setUint8(headerAddress + CAPACITY_OFFSET, capacity);
        this.controlAdapter.setUint8(headerAddress + COOKIE_OFFSET, this.bakeCookie(headerAddress, ++this.generation));
        this.controlBus[headerAddress + FLAGS_OFFSET] = 0;

        return (this.generation & CLAMP_11BITS) * ROTATE_32BITS + headerAddress;
    }

    /**
     * يوسع سعة الكتلة إلى القوة التالية للعدد اثنين.
     *
     * عندما تقع الكتلة في القمة الحالية لـ `dataBus`، يحدث التوسيع
     * في الموقع (In-place): يتم تحديث سعتها ومؤشر `dataPointer` فقط.
     *
     * إذا كانت هناك منطقة أخرى بعد الكتلة، يتم الحصول على منطقة جديدة بسعة مضاعفة
     * من المساحة القابلة لإعادة التدوير أو تخصيصها في قمة `dataBus`.
     * يتم بعد ذلك نسخ العناصر المشغولة حالياً إلى المنطقة الجديدة،
     * وإعادة المنطقة السابقة إلى قائمة إعادة التدوير.
     *
     * يظل المقبض صالحاً، حيث يتم الاحتفاظ بترويسته وتحديث
     * العنوان والسعة المسجلين فيه فقط.
     *
     * @param {number} handler - مقبض الكتلة المراد توسيعها.
     * @returns {void}
     * @throws {Error} إذا كان المقبض غير صالح، أو تالفاً، أو إذا كانت الكتلة
     * معارة بواسطة withView(). يحدث أيضاً إذا تطلب التوسيع إعادة تعيين بيانات `dataBus`
     * بينما توجد كتلة أخرى معارة.
     * @throws {AggregateError} إذا وصلت السعة إلى الحد الأقصى المدعوم.
     */
    realloc(handler) {

        const generation = (handler / ROTATE_32BITS) & CLAMP_11BITS;
        const headerAddress = handler >>> 0;
        const dataAddress = this.controlAdapter.getUint32(headerAddress + ADDRESS_OFFSET, IS_LITTLE_ENDIAN);
        const occupied = this.controlAdapter.getUint32(headerAddress + OCCUPIED_OFFSET, IS_LITTLE_ENDIAN);
        const capacity = this.controlAdapter.getUint8(headerAddress + CAPACITY_OFFSET);
        const cookie = this.controlAdapter.getUint8(headerAddress + COOKIE_OFFSET);
        const borrowed = this.controlAdapter.getUint8(headerAddress + FLAGS_OFFSET) & VIEW_LOCK;

        if (cookie !== this.bakeCookie(headerAddress, generation)) {
            throw new Error("Invalid or corrupted handle");
        }

        if (borrowed) {
            throw new Error("Block is borrowed");
        }

        if (capacity >= 31) throw new AggregateError([new Error("Can´t reallocate handler."), new RangeError("Capacity has reached its limit.")], "Internal Error.");

        const newCapacity = capacity + 1;
        const newBlockSize = (1 << newCapacity >>> 0) * this.wordSize;
        const oldBlockSize = (1 << capacity >>> 0) * this.wordSize;

        if (dataAddress + oldBlockSize === this.dataPointer) {
            while (dataAddress + newBlockSize > this.size) this.grow();

            this.controlAdapter.setUint8(headerAddress + CAPACITY_OFFSET, newCapacity);
            this.dataPointer = dataAddress + newBlockSize;
            return;
        }

        let newAddress = this.recyclePop(newBlockSize);

        if (newAddress === UNKNOWN) {
            while (this.dataPointer + newBlockSize > this.size) this.grow();

            newAddress = this.dataPointer;
            this.dataPointer += newBlockSize;
        }

        this.dataBus.copyWithin(newAddress, dataAddress, dataAddress + occupied * this.wordSize);

        this.controlAdapter.setUint32(headerAddress + ADDRESS_OFFSET, newAddress, IS_LITTLE_ENDIAN);
        this.controlAdapter.setUint8(headerAddress + CAPACITY_OFFSET, newCapacity);

        this.recyclePush(oldBlockSize, dataAddress);
    }

    /**
     * يقلّص الكتلة إلى أصغر سعة تمثل قوة للعدد اثنين وتكفي لاحتواء
     * العناصر المشغولة فيها، مع الحفاظ على عنوانها ومعرّفها (handler).
     *
     * إذا كانت الكتلة في أعلى dataBus، يُرجع dataPointer إلى الخلف.
     * وإلا، يُقسّم الجزء الطرفي المُحرر إلى مناطق ذات أحجام تمثل قوى للعدد
     * اثنين، ثم تُعاد كل منطقة إلى قائمة إعادة التدوير.
     *
     * @param {number} handler - معرّف الكتلة المراد تقليصها.
     * @returns {void}
     * @throws {Error} إذا كان المعرّف غير صالح أو تالفاً أو مستعاراً عبر withView().
     */
    shrink(handler) {
        const meta = this.extractMetadata(handler, this.metadata);
        if (meta.borrowed) throw new Error("Block is borrowed");

        const newCapacity = Math.max(1, 32 - Math.clz32(Math.max(2, meta.occupied) - 1));
        if (newCapacity >= meta.capacityExponent) return;

        const oldBlockSize = meta.byteCapacity;
        const newBlockSize = (2 ** newCapacity) * this.wordSize;
        const oldEnd = meta.dataAddress + oldBlockSize;

        this.controlAdapter.setUint8(meta.headerAddress + CAPACITY_OFFSET, newCapacity);

        if (oldEnd === this.dataPointer) {
            this.dataPointer = meta.dataAddress + newBlockSize;
            return;
        }

        let address = meta.dataAddress + newBlockSize;
        for (let exponent = newCapacity; exponent < meta.capacityExponent; exponent++) {
            const segmentSize = (2 ** exponent) * this.wordSize;
            this.recyclePush(segmentSize, address);
            address += segmentSize;
        }
    }

    free(handler) {

        const generation = (handler / ROTATE_32BITS) & CLAMP_11BITS;
        const headerAddress = handler >>> 0;
        const dataAddress = this.controlAdapter.getUint32(headerAddress + ADDRESS_OFFSET, IS_LITTLE_ENDIAN);
        const capacity = this.controlAdapter.getUint8(headerAddress + CAPACITY_OFFSET);
        const cookie = this.controlAdapter.getUint8(headerAddress + COOKIE_OFFSET);
        const borrowed = this.controlAdapter.getUint8(headerAddress + FLAGS_OFFSET) & VIEW_LOCK;

        if (cookie !== this.bakeCookie(headerAddress, generation)) {
            throw new Error("Invalid or corrupted handle");
        }

        if (borrowed) {
            throw new Error("Block is borrowed");
        }

        const blockSize = (1 << capacity >>> 0) * this.wordSize;
        this.controlAdapter.setUint8(headerAddress + COOKIE_OFFSET, 0);

        if (this.echoPointer + 4 <= this.controlBus.byteLength) {
            this.controlAdapter.setUint32(this.echoPointer, headerAddress, IS_LITTLE_ENDIAN);
            this.echoPointer += 4;
        }

        if (dataAddress + blockSize === this.dataPointer) {
            this.dataPointer = dataAddress;
        } else {
            this.recyclePush(blockSize, dataAddress);
        }
    }
    // ========== إعادة التدوير (RECYCLING) ==========

    /**
     * [استخدام داخلي]
     * يدخل منطقة حرة في قائمة إعادة التدوير.
     *
     * يتم تنظيم القائمة حسب السعة بالبايت. لكل سعة، القيمة
     * المخزنة هي `Uint32Array` يحتوي موضعها الصفر على كمية
     * العناوين المسجلة وتليها المواضع التي تحتوي على عناوين المناطق الحرة:
     *
     *     [count, address1, address2, ...]
     *
     * عندما تمتلئ الصفحة، يتم توسيع المخزن المؤقت الخاص بها إلى ضعف السعة الحالية.
     *
     * @param {number} capacity - سعة المنطقة الحرة، بالبايت.
     * @param {number} address - العنوان الأولي للمطقة في `dataBus`.
     * @returns {void}
     * @private
     */
    recyclePush(capacity, address) {
        if (this.recycle.has(capacity)) {
            let page = this.recycle.get(capacity);
            const count = page[0];

            if (count === page.length - 1) {
                const newBuffer = page.buffer.transfer(page.buffer.byteLength * 2);
                page = new Uint32Array(newBuffer);
                this.recycle.set(capacity, page);
            }

            page[count + 1] = address;
            page[0] = count + 1;
        } else {
            this.recycle.set(capacity, new Uint32Array([1, address]));
        }
    }

    /**
     * [استخدام داخلي]
     * يزيل منطقة حرة من قائمة إعادة التدوير.
     *
     * يتم البحث بالسعة المطلوبة بدقة. عندما توجد صفحة
     * مطابقة، يتم إزالة العنوان المسجل الأخير من الصفحة وإرجاعه،
     * مما ينفذ إعادة التدوير كمكدس LIFO.
     *
     * @param {number} capacity - السعة المطلوبة، بالبايت.
     * @returns {number} العنوان الأولي لمنطقة قابلة لإعادة التدوير أو `UNKNOWN`
     * عندما لا توجد منطقة بالسعة المطلوبة.
     * @private
     */
    recyclePop(capacity) {
        if (!this.recycle.has(capacity)) return UNKNOWN;

        const page = this.recycle.get(capacity);
        const count = page[0];

        if (count === 0) return UNKNOWN;

        const address = page[count];
        page[0] = count - 1;

        return address;
    }

    // ========== جمع النفايات (GARBAGE COLLECTION) ==========

    /**
     * يضغط `dataBus` باستخدام خوارزمية ReBump.
     *
     * يمر تسلسلياً عبر الترويسات المسجلة في `controlBus` ونسخ
     * المناطق التي لا تزال صالحة إلى `dataBus` جديد، مما يلغي المساحات الحرة
     * الموجودة بينها. يتم تحديث عنوان كل كتلة باقية في الترويسة الخاصة بها.
     *
     * يتم الحفاظ على ترتيب الكتل في `controlBus`. كما يتم الاحتفاظ بالبيانات الداخلية
     * لكل كتلة بالكامل، بما في ذلك سعتها المحجوزة وإشغالها الحالي.
     *
     * عند الانتهاء من الضغط:
     * - يتم القضاء على جميع المناطق القابلة لإعادة التدوير؛
     * - يتحول `dataPointer` للإشارة إلى أول بايت بعد آخر كتلة حية؛
     * - يصبح `dataBus` ممثلاً لكومة (Heap) متجاورة للكتل النشطة.
     *
     * تعقيد التحكم هو O(n)، حيث `n` هو عدد الترويسات التي تم
     * المرور عبرها. تكلفة نقل الذاكرة الفعلية تعتمد أيضاً على حجم البايتات التابعة للكتل الحية.
     *
     * @returns {void}
     * @throws {Error} إذا كانت هناك أي كتلة معارة بواسطة withView().
     */
    gc() {
        this.assertNoActiveViews();

        const newDataBus = new Uint8Array(this.dataBus.buffer.byteLength);
        this.recycle.clear();
        this.dataPointer = 0 >>> 0;

        for (let i = 0; i < this.controlPointer; i += HEADER_SIZE) {
            if (this.controlBus[i + COOKIE_OFFSET] === 0) continue;

            const start = this.controlAdapter.getUint32(i + ADDRESS_OFFSET, IS_LITTLE_ENDIAN);
            const size = (1 << this.controlBus[i + CAPACITY_OFFSET] >>> 0) * this.wordSize;
            const end = start + size;

            newDataBus.set(this.dataBus.subarray(start, end), this.dataPointer);
            this.controlAdapter.setUint32(i + ADDRESS_OFFSET, this.dataPointer, IS_LITTLE_ENDIAN);
            this.dataPointer += size;
        }

        this.dataBus = newDataBus;
        this.dataAdapter = new DataView(this.dataBus.buffer);
        this.auxiliary = new globalThis[`${this.bucketType}Array`](this.dataBus.buffer);
        this.writer = this.dataAdapter[`set${this.bucketType}`].bind(this.dataAdapter);
        this.reader = this.dataAdapter[`get${this.bucketType}`].bind(this.dataAdapter);
    }

    // ========== التحجيم (SCALING) ==========

    /**
     * [!!! استخدام داخلي، لا تستخدمه في كودك !!!]
     * يوسع `dataBus` إلى ضعف سعته الحالية.
     *
     * يتم نقل المخزن المؤقت الأساسي إلى `ArrayBuffer` أكبر، مع الحفاظ
     * على البيانات الموجودة. يتم إعادة إنشاء جميع العروض (Views) المرتبطة بالمخزن المؤقت
     * للإشارة إلى التخزين الجديد.
     *
     * @returns {void}
     * @throws {Error} إذا كانت هناك أي كتلة معارة بواسطة withView().
     * @throws {RangeError} إذا تجاوزت سعة `dataBus` الحد الأقصى المدعوم.
     * @private
     */
    grow() {
        this.assertNoActiveViews();

        if (this.size > 0x80000000) throw new RangeError("Data bus capacity exceeded");

        const newSize = (this.size * 2) >>> 0;
        const newBuffer = this.dataBus.buffer.transfer(newSize);

        this.size = newSize;
        this.dataBus = new Uint8Array(newBuffer);
        this.dataAdapter = new DataView(newBuffer);
        this.writer = this.dataAdapter[`set${this.bucketType}`].bind(this.dataAdapter);
        this.reader = this.dataAdapter[`get${this.bucketType}`].bind(this.dataAdapter);
        this.auxiliary = new this.bucketArray(newBuffer);
    }

    /**
     * [!!! استخدام داخلي، لا تستخدمه في كودك !!!]
     * يوسع `controlBus` إلى ضعف سعته الحالية.
     *
     * يتم نقل المخزن المؤقت الأساسي إلى `ArrayBuffer` أكبر، مع الحفاظ
     * على الترويسات الموجودة. يتم إعادة إنشاء `controlAdapter` للإشارة
     * إلى التخزين الجديد.
     *
     * @returns {void}
     * @throws {RangeError} إذا تجاوزت السعة الحالية لـ `controlBus`
     * الحد الأقصى المدعوم.
     * @private
     */
    headerGrow() {
        if (this.controlBus.byteLength > 0x80000000) throw new RangeError("Control bus capacity exceeded");
        const newSize = (this.controlBus.byteLength * 2) >>> 0;
        const newBuffer = this.controlBus.buffer.transfer(newSize);

        this.controlBus = new Uint8Array(newBuffer);
        this.controlAdapter = new DataView(newBuffer);
    }

    // ========== عمليات المكدس (STACK OPERATIONS) ==========

    /**
     * يضيف عنصراً إلى نهاية التسلسل المشغول بواسطة الكتلة.
     *
     * يتم كتابة العنصر في أول موضع حر بعد آخر عنصر
     * مشغول. يتم زيادة إشغال الكتلة فقط عندما تكون هناك مساحة
     * متاحة ضمن سعتها.
     *
     * @param {number} value - القيمة المراد إدراجها.
     * @returns {boolean} `true` إذا تم إدراج القيمة؛ `false` إذا كانت الكتلة
     * بلا مساحة متاحة.
     * @throws {Error} إذا كان المقبض غير صالح، أو تالفاً، أو كانت الكتلة معارة بواسطة withView().
     * 
     */
    push(handler, value) {
        const meta = this.extractMetadata(handler, this.metadata);
        if (meta.borrowed) throw new Error("Block is borrowed");

        if ((meta.occupied + 1) * this.wordSize > meta.byteCapacity) return false;

        this.writer(meta.dataAddress + meta.occupied * this.wordSize, value, IS_LITTLE_ENDIAN);
        this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, meta.occupied + 1, IS_LITTLE_ENDIAN);

        return true;
    }

    /**
     * يزيل آخر عنصر مشغول من الكتلة ويرجعه.
     *
     * يتم إنقاص الإشغال قبل قراءة العنصر المُزال. البايتات
     * المقابلة لا يتم مسحها وتظل في المنطقة المخصصة، ولكنها تتوقف عن كونها
     * جزءاً من التسلسل المشغول.
     *
     * @param {number} handler - مقبض الكتلة.
     * @returns {number|undefined} القيمة المُزالة أو `undefined` إذا كانت الكتلة
     * فارغة.
     * @throws {Error} إذا كان المقبض غير صالح، أو تالفاً، أو كانت الكتلة معارة بواسطة withView().
     */
    pop(handler) {
        const meta = this.extractMetadata(handler, this.metadata);
        if (meta.borrowed) throw new Error("Block is borrowed");

        if (meta.occupied === 0) return undefined;

        this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, meta.occupied - 1, IS_LITTLE_ENDIAN);
        return this.reader(meta.dataAddress + (meta.occupied - 1) * this.wordSize, IS_LITTLE_ENDIAN);
    }

    /**
     * يرجع آخر عنصر مشغول دون إزالته.
     *
     * @param {number} handler - مقبض الكتلة.
     * @returns {number|undefined} آخر قيمة مشغولة أو `undefined` إذا كانت
     * الكتلة فارغة.
     * @throws {Error} إذا كان المقبض غير صالح أو تالفاً.
     */
    peek(handler) {
        const meta = this.extractMetadata(handler, this.metadata);

        if (meta.occupied === 0) return undefined;

        return this.reader(meta.dataAddress + (meta.occupied - 1) * this.wordSize, IS_LITTLE_ENDIAN);
    }

    // ========== عمليات طابور الانتظار (QUEUE OPERATIONS) ==========

    /**
     * يدخل عنصراً في بداية التسلسل المشغول.
     *
     * يتم إزاحة العناصر المشغولة حالياً بمقدار موضع واحد إلى
     * الأمام وكتابة `value` في الموضع الأول. تتطلب العملية موقعاً
     * حراً في سعة الكتلة.
     *
     * تكلفة العملية تتناسب طردياً مع عدد العناصر المشغولة،
     * لأن البيانات تحتاج إلى إزاحة.
     *
     * @param {number} handler - مقبض الكتلة.
     * @param {number} value - القيمة المراد إدراجها.
     * @returns {boolean} `true` إذا تم إدراج القيمة؛ `false` إذا كانت الكتلة
     * ممتلئة.
     * @throws {Error} إذا كان المقبض غير صالح، أو تالفاً، أو كانت الكتلة معارة بواسطة withView().
     */
    nudge(handler, value) {
        const meta = this.extractMetadata(handler, this.metadata);
        if (meta.borrowed) throw new Error("Block is borrowed");

        if ((meta.occupied + 1) * this.wordSize > meta.byteCapacity) return false;

        this.dataBus.copyWithin(meta.dataAddress + this.wordSize, meta.dataAddress, meta.dataAddress + meta.occupied * this.wordSize);
        this.writer(meta.dataAddress, value, IS_LITTLE_ENDIAN);
        this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, meta.occupied + 1, IS_LITTLE_ENDIAN);

        return true;
    }

    /**
     * يزيل أول عنصر مشغول من الكتلة ويرجعه.
     *
     * يتم إزاحة العناصر المتبقية بمقدار موضع واحد نحو بداية
     * المنطقة المشغولة. تبقى السعة الفيزيائية للكتلة دون تغيير.
     *
     * تكلفة العملية تتناسب طردياً مع عدد العناصر المُزاحة.
     *
     * @param {number} handler - مقبض الكتلة.
     * @returns {number|undefined} أول قيمة مُزالة أو `undefined` إذا كانت
     * الكتلة فارغة.
     * @throws {Error} إذا كان المقبض غير صالح، أو تالفاً، أو كانت الكتلة معارة بواسطة withView().
     */
    pull(handler) {
        const meta = this.extractMetadata(handler, this.metadata);
        if (meta.borrowed) throw new Error("Block is borrowed");

        if (meta.occupied === 0) return undefined;

        const result = this.reader(meta.dataAddress, IS_LITTLE_ENDIAN);
        this.dataBus.copyWithin(meta.dataAddress, meta.dataAddress + this.wordSize, meta.dataAddress + meta.occupied * this.wordSize);
        this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, meta.occupied - 1, IS_LITTLE_ENDIAN);

        return result;
    }

    /**
     * يرجع أول عنصر مشغول دون إزالته.
     *
     * @param {number} handler - مقبض الكتلة.
     * @returns {number|undefined} أول قيمة مشغولة أو `undefined` إذا كانت
     * الكتلة فارغة.
     * @throws {Error} إذا كان المقبض غير صالح أو تالفاً.
     */
    head(handler) {
        const meta = this.extractMetadata(handler, this.metadata);

        if (meta.occupied === 0) return undefined;

        return this.reader(meta.dataAddress, IS_LITTLE_ENDIAN);
    }

    // ========== الوصول العشوائي (RANDOM ACCESS) ==========

    /**
     * يتحقق مما إذا كانت القيمة موجودة بين العناصر المشغولة للكتلة.
     *
     * يتم البحث مباشرة على `TypedArray` المساعد ويأخذ في الاعتبار
     * النطاق المشغول حالياً فقط، وليس كامل السعة الفيزيائية المحجوزة.
     *
     * @param {number} handler - مقبض الكتلة.
     * @param {number} value - القيمة المراد البحث عنها.
     * @returns {boolean} `true` إذا كانت `value` موجودة بين العناصر
     * المشغولة؛ وإلا `false`.
     * @throws {Error} إذا كان المقبض غير صالح أو تالفاً.
     */
    has(handler, value) {
        const meta = this.extractMetadata(handler, this.metadata);

        if (meta.occupied === 0) return false;

        const rawAddres = meta.dataAddress >>> this.wordShift;

        return this.auxiliary.subarray(rawAddres, rawAddres + meta.occupied).includes(value);
    }

    /**
     * يحدد موقع الظهور الأول لعنصر في التسلسل المشغول للكتلة.
     *
     * يتم إجراء البحث بترتيب تصاعدي للفهارس، باستخدام عملية `indexOf`
     * الخاصة بـ TypedArray الأساسي. يأخذ البحث في الاعتبار حصرياً
     * العناصر المشغولة، متجاهلاً السعة غير المستخدمة للكتلة.
     *
     * يمكن تحديد موضع البدء للبحث بواسطة `fromIndex`،
     * مع اتباع قواعد الفهرسة الخاصة بـ TypedArray.
     *
     * @param {number} handler - مقبض الكتلة.
     * @param {number|bigint} searchElement - العنصر المراد تحديد موقعه.
     * @param {number} [fromIndex=0] - الفهرس الذي يبدأ منه البحث.
     * @returns {number} فهرس الظهور الأول أو `-1` إذا لم يتم العثور على
     * العنصر أو إذا كانت الكتلة فارغة.
     * @throws {Error} إذا كان المقبض غير صالح أو تالفاً.
     */
    indexOf(handler, searchElement, fromIndex = 0) {
        const meta = this.extractMetadata(handler, this.metadata);

        if (meta.occupied === 0) return -1;

        const rawAddres = meta.dataAddress >>> this.wordShift;

        return this.auxiliary.subarray(rawAddres, rawAddres + meta.occupied).indexOf(searchElement, fromIndex);
    }

    /**
     * يحدد موقع الظهور الأخير لعنصر في التسلسل المشغول للكتلة.
     *
     * يتم إجراء البحث بترتيب تنازلي للفهارس، باستخدام عملية `lastIndexOf`
     * الخاصة بـ TypedArray الأساسي. يأخذ البحث في الاعتبار حصرياً
     * العناصر المشغولة، متجاهلاً السعة غير المستخدمة للكتلة.
     *
     * يمكن تحديد موضع البدء للبحث بواسطة `fromIndex`،
     * مع اتباع قواعد الفهرسة الخاصة بـ TypedArray. افتراضياً، يبدأ البحث
     * عند آخر عنصر مشغول.
     *
     * @param {number} handler - مقبض الكتلة.
     * @param {number|bigint} searchElement - العنصر المراد تحديد موقعه.
     * @param {number} [fromIndex=-1] - الفهرس الذي يبدأ منه البحث.
     * @returns {number} فهرس الظهور الأخير أو `-1` إذا لم يتم العثور على
     * العنصر أو إذا كانت الكتلة فارغة.
     * @throws {Error} إذا كان المقبض غير صالح أو تالفاً.
     */
    lastIndexOf(handler, searchElement, fromIndex = -1) {
        const meta = this.extractMetadata(handler, this.metadata);

        if (meta.occupied === 0) return -1;

        const rawAddres = meta.dataAddress >>> this.wordShift;

        return this.auxiliary.subarray(rawAddres, rawAddres + meta.occupied).lastIndexOf(searchElement, fromIndex);
    }


    /**
    * يرجع العنصر المشغول عند فهرس مبني على أساس الصفر.
    *
    * الفهارس خارج النطاق `[0, occupied)` لا تعتبر خطأ و
    * تنتج `undefined`.
    *
    * @param {number} handler - مقبض الكتلة.
    * @param {number} index - الفهرس المبني على أساس الصفر للعنصر.
    * @returns {number|undefined} القيمة المخزنة في الفهرس أو `undefined` إذا كان
    * الفهرس خارج المنطقة المشغولة.
    * @throws {Error} إذا كان المقبض غير صالح أو تالفاً.
    */
    get(handler, index) {

        const meta = this.extractMetadata(handler, this.metadata);

        if (index < 0 || index >= meta.occupied) return undefined;

        return this.reader(meta.dataAddress + index * this.wordSize, IS_LITTLE_ENDIAN);
    }

    /**
     * يستبدل القيمة المخزنة في فهرس مشغول.
     *
     * لا تغير العملية إشغال الكتلة. الفهارس خارج النطاق
     * `[0, occupied)` يتم تجاهلها وتنتج `false`.
     *
     * @param {number} handler - مقبض الكتلة.
     * @param {number} index - الفهرس المبني على أساس الصفر للعنصر.
     * @param {number} value - القيمة الجديدة.
     * @returns {boolean} `true` إذا تم كتابة القيمة؛ `false` إذا كان الفهرس
     * خارج المنطقة المشغولة.
     * @throws {Error} إذا كان المقبض غير صالح، أو تالفاً، أو كانت الكتلة معارة بواسطة withView().
     */
    set(handler, index, value) {
        const meta = this.extractMetadata(handler, this.metadata);
        if (meta.borrowed) throw new Error("Block is borrowed");

        if (index < 0 || index >= meta.occupied) return false;

        this.writer(meta.dataAddress + index * this.wordSize, value, IS_LITTLE_ENDIAN);
        return true;
    }

    // ============= متفرقات (MISCELLANEOUS) ==============

    /**
     * يصفر إشغال الكتلة ويملأ كامل سعتها الفيزيائية بـ
     * نفس القيمة.
     *
     * يغطي الملء جميع الفتحات المتاحة، وليس فقط
     * العناصر المشغولة حالياً. بعد العملية، تعتبر الكتلة
     * فارغة بغض النظر عن القيمة المستخدمة في الملء.
     *
     * @param {number} handler - مقبض الكتلة.
     * @param {number} [value=0] - القيمة المستخدمة لملء جميع الفتحات.
     * @returns {void}
     * @throws {Error} إذا كان المقبض غير صالح، أو تالفاً، أو كانت الكتلة معارة بواسطة withView().
     */
    clear(handler, value = 0) {
        const meta = this.extractMetadata(handler, this.metadata);
        if (meta.borrowed) throw new Error("Block is borrowed");

        const slots = meta.byteCapacity / this.wordSize;
        const rawAddress = meta.dataAddress >>> this.wordShift;

        this.auxiliary.fill(value, rawAddress, rawAddress + slots);
        this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, 0, IS_LITTLE_ENDIAN);
    }


    /**
     * يملأ نطاقاً من فتحات الكتلة بقيمة.
     *
     * يستخدم النطاق فهارس مبنية على أساس الصفر ويتبع اصطلاح
     * `[start, end)`، لذلك `start` مشمول و `end` غير مشمول.
     * عندما لا يتم توفير `end`، يمتد الملء حتى نهاية
     * السعة الفيزيائية للكتلة.
     *
     * يصبح إشغال الكتلة هو `end`، حتى عندما يمتد النطاق
     * الممتلئ إلى ما بعد الإشغال السابق.
     *
     * @param {number} handler - مقبض الكتلة.
     * @param {number} value - القيمة المستخدمة في الملء.
     * @param {number} [start=0] - الفهرس الأولي، مشمول.
     * @param {number|null} [end=null] - الفهرس النهائي، غير مشمول. عندما
     * يتم تخطيه أو يكون `null`، يستخدم السعة الكلية للكتلة.
     * @returns {void}
     * @throws {Error} إذا كان المقبض غير صالح، أو تالفاً، أو كانت الكتلة معارة بواسطة withView().
     * @throws {RangeError} إذا كان `start` أو `end` خارج حدود
     * السعة، أو إذا كان `start > end`.
     */
    fill(handler, value, start = 0, end = null) {
        const meta = this.extractMetadata(handler, this.metadata);
        if (meta.borrowed) throw new Error("Block is borrowed");

        const slots = meta.byteCapacity / this.wordSize;
        const lastIndex = end ?? slots;

        if (start > lastIndex) {
            throw new RangeError(`start ${start} must be less or equal than end ${lastIndex}.`);
        }
        if (start < 0 || start > slots) {
            throw new RangeError(`start ${start} out of range [0, ${slots}].`);
        }
        if (lastIndex < 0 || lastIndex > slots) {
            throw new RangeError(`end ${lastIndex} out of range [0, ${slots}].`);
        }

        const rawAddress = meta.dataAddress >>> this.wordShift;
        this.auxiliary.fill(value, rawAddress + start, rawAddress + lastIndex);
        this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, lastIndex, IS_LITTLE_ENDIAN);
    }

    /**
     * يملأ جميع الفتحات الفيزيائية للكتلة بقيمة ويضع علامة على كامل
     * السعة على أنها مشغولة.
     *
     * على عكس `clear()`، تؤدي العملية إلى كتلة مشغولة بالكامل.
     *
     * @param {number} handler - مقبض الكتلة.
     * @param {number} value - القيمة المستخدمة في الملء.
     * @returns {void}
     * @throws {Error} إذا كان المقبض غير صالح، أو تالفاً، أو كانت الكتلة معارة بواسطة withView().
     */
    fillAll(handler, value) {
        const meta = this.extractMetadata(handler, this.metadata);
        if (meta.borrowed) throw new Error("Block is borrowed");

        const rawAddress = meta.dataAddress >>> this.wordShift;
        const capacityElements = meta.byteCapacity / this.wordSize;

        this.auxiliary.fill(value, rawAddress, rawAddress + capacityElements);
        this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, capacityElements, IS_LITTLE_ENDIAN);
    }

    /**
     * ينسخ عناصر من `Array` أو `TypedArray` إلى بداية الكتلة.
     *
     * الكمية المنسوخة محدودة بسعة الكتلة. يتم تحديث الإشغال
     * إلى القيمة الأكبر بين الإشغال السابق والكمية
     * المنسوخة فعلياً؛ لذلك، لا يؤدي استدعاء `put()` إلى تقليل
     * الإشغال الموجود عند تلقي تسلسل أصغر.
     *
     * بالنسبة لـ `Array`، يتم نسخ العناصر الأولى التي تناسب فقط.
     * بالنسبة لـ `TypedArray`، يتم استخدام مصفوفة فرعية (Subarray) من المصدر دون نسخ
     * وسيط.
     *
     * @param {number} handler - مقبض الكتلة.
     * @param {Array|TypedArray} data - تسلسل القيم المراد نسخها.
     * @returns {void}
     * @throws {Error} إذا كان المقبض غير صالح، أو تالفاً، أو كانت الكتلة معارة بواسطة withView().
     * @throws {TypeError} إذا لم تكن `data` عبارة عن `Array` ولا `TypedArray`.
     */
    put(handler, data) {
        const meta = this.extractMetadata(handler, this.metadata);
        if (meta.borrowed) throw new Error("Block is borrowed");

        const rawAddress = meta.dataAddress >>> this.wordShift;
        const length = Math.min(1 << meta.capacityExponent >>> 0, data.length);

        if (Array.isArray(data)) {
            this.auxiliary.set(data.slice(0, length), rawAddress);
        } else if (isTypedArray(data)) {
            this.auxiliary.set(data.subarray(0, length), rawAddress);
        } else {
            const actual = data?.constructor?.name ?? (data === null ? 'null' : typeof data);
            throw new TypeError(`data must be Array or TypedArray, but ${actual} was given.`);
        }

        this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, Math.max(length, meta.occupied), IS_LITTLE_ENDIAN);
    }

    /**
    * يرجع نسخة من العناصر المشغولة حالياً بواسطة الكتلة.
    *
    * النتيجة هي `TypedArray` من نفس النوع المُكوّن بواسطة
    * `bucketSize`. لا يتم تضمين السعة الفيزيائية غير المشغولة في النتيجة.
    *
    * لا تكشف العملية التخزين الداخلي مباشرة: يستخدم الأسلوب
    * `TypedArray.prototype.slice()`، مما ينتج عرضاً جديداً مع
    * تخزين مستقل.
    *
    * @param {number} handler - مقبض الكتلة.
    * @returns {TypedArray} نسخة من العناصر المشغولة بواسطة الكتلة. عندما
    * تكون الكتلة فارغة، يرجع `TypedArray` فارغاً من النوع المُكوّن.
    * @throws {Error} إذا كان المقبض غير صالح أو تالفاً.
    */
    pick(handler) {
        const meta = this.extractMetadata(handler, this.metadata);

        const rawAddress = meta.dataAddress >>> this.wordShift;

        if (meta.occupied === 0) {
            return this.auxiliary.slice(rawAddress, rawAddress);
        }

        return this.auxiliary.slice(rawAddress, rawAddress + meta.occupied);
    }

    /**
     * ينفذ دالة رد اتصال (Callback) على عرض مباشر للمنطقة المشغولة بواسطة الكتلة.
     *
     * يشترك العرض في التخزين الداخلي لـ Balloc ولا يقوم بالنسخ.
     * تتم حماية الكتلة ضد العمليات غير المتوافقة أثناء دالة رد الاتصال.
     *
     * يجب أن تكون دالة رد الاتصال متزامنة (Synchronous). يجب عدم تخزين العرض المُستلم،
     * أو إرجاعه، أو استخدامه بعد انتهاء دالة رد الاتصال. ينطبق هذا القيد أيضاً
     * على العروض الفرعية (Subviews) المشتقة من العرض الأصلي.
     *
     * @param {number} handler - مقبض الكتلة.
     * @param {...(number|Function)} args - مقبض كتلة واحد أو أكثر، تليها دالة رد الاتصال.
     * @returns {*} القيمة المُرجعة بواسطة دالة رد الاتصال.
     * @throws {TypeError} إذا لم يتم توفير أي مقبض أو لم تكن دالة رد الاتصال دالة.
     * @throws {Error} إذا كان أي مقبض غير صالح أو مكرراً أو معاراً مسبقاً.
     */
    withView(...args) {
        if (args.length < 2) throw new TypeError("At least one handler and one callback are required");
        const lastIndex = args.length - 1;
        const callback = args[lastIndex];
        if (typeof callback !== "function") throw new TypeError("callback must be a function");

        const lookup = Object.create(null);
        const acquired = [];
        const views = [];

        try {
            for (let i = 0; i < lastIndex; i++) {
                const metadata = this.extractMetadata(args[i], this.metadata);
                const headerAddr = metadata.headerAddress;


                if (Object.hasOwn(lookup, headerAddr)) throw new Error("Duplicate handler");
                if (metadata.borrowed) throw new Error("Block is already borrowed");

                this.controlBus[headerAddr + FLAGS_OFFSET] |= VIEW_LOCK;

                const rawAddress = metadata.dataAddress >>> this.wordShift;
                lookup[headerAddr] = true;
                acquired.push(headerAddr);

                views.push(this.auxiliary.subarray(rawAddress, rawAddress + metadata.occupied))
            }
            return callback(...views);
        } finally {
            for (let i = 0; i < acquired.length; i++) {
                this.controlBus[acquired[i] + FLAGS_OFFSET] &= ~VIEW_LOCK;
            }
        }
    }

    // ======== السعة بالفتحات (CAPACITY IN SLOTS) ==========

    /**
     * يرجع السعة الفيزيائية للكتلة بالبايت.
     *
     * تتوافق السعة مع المساحة المحجوزة لجميع فتحات
     * الكتلة، بغض النظر عن عدد العناصر المشغولة حالياً.
     *
     * @param {number} handler - مقبض الكتلة.
     * @returns {number} السعة الفيزيائية للكتلة، بالبايت.
     * @throws {Error} إذا كان المقبض غير صالح أو تالفاً.
     */
    byteSize(handler) {
        const meta = this.extractMetadata(handler, this.metadata);
        return meta.byteCapacity;
    }

    /**
     * يرجع كمية العناصر المشغولة حالياً في الكتلة.
     *
     * @param {number} handler - مقبض الكتلة.
     * @returns {number} عدد العناصر المشغولة.
     * @throws {Error} إذا كان المقبض غير صالح أو تالفاً.
     */
    occupied(handler) {
        const meta = this.extractMetadata(handler, this.metadata);
        return meta.occupied;

    }

    /**
     * يرجع سعة الكتلة بعدد العناصر.
     *
     * تتوافق القيمة مع الإجمالي لعدد الفتحات المحجوزة فيزيائياً،
     * وليس الكمية المشغولة حالياً.
     *
     * @param {number} handler - مقبض الكتلة.
     * @returns {number} العدد الإجمالي للفتحات المتاحة في الكتلة.
     * @throws {Error} إذا كان المقبض غير صالح أو تالفاً.
     */
    length(handler) {
        const meta = this.extractMetadata(handler, this.metadata);
        return 1 << meta.capacityExponent >>> 0;
    }

    /**
     * يتحقق مما إذا كانت كتلة الذاكرة قد وصلت إلى سعة تخصيصها.
     *
     * تعتبر الكتلة ممتلئة عندما يكون عدد العناصر المشغولة
     * مساوياً لسعتها الإجمالية المخصصة، وعدم تبقي أي مواضع متاحة
     * لتخزين عناصر جديدة.
     *
     * @param {number} handler - مقبض الكتلة.
     * @returns {boolean} `true` إذا كانت الكتلة ممتلئة؛ وإلا `false`.
     * @throws {Error} إذا كان المقبض غير صالح أو تالفاً.
     */
    isFull(handler) {
        const meta = this.extractMetadata(handler, this.metadata);
        return (1 << meta.capacityExponent >>> 0) - meta.occupied === 0;
    }

    // ========== العمليات بين الكتل (Operations between blocks)=============

    /**
    * ينسخ العناصر المشغولة من كتلة إلى أخرى.
    *
    * يبدأ النسخ عند العنصر الأول من `source` وأول فتحة من
    * `destination`. الكمية المنسوخة فعلياً محدودة بعدد العناصر
    * المشغولة في المصدر، والسعة الفيزيائية للوجهة، والحد
    * المحدد في `slots`.
    *
    * يتم رفع إشغال الوجهة، عند الضرورة، لتغطية العناصر
    * المنسوخة. لا يتم تغيير سعة الوجهة.
    *
    * تستخدم العملية `Uint8Array.prototype.copyWithin()` على `dataBus`،
    * لذلك النتيجة هي `Uint8Array` نفسها التي تمثل ناقل البيانات.
    *
    * @param {number} source - مقبض كتلة المصدر.
    * @param {number} destination - مقبض كتلة الوجهة.
    * @param {number} [slots=UNKNOWN] - الحد الأقصى لعدد العناصر المراد نسخها.
    * `UNKNOWN` يمثل القيمة الحارسة المستخدمة لعدم فرض حد
    * إضافي.
    * @returns {Uint8Array} ناقل البيانات `dataBus` بعد العملية.
    * @throws {Error} إذا كانت المقابض غير صالحة، أو تالفة،
    * أو كانت كتلة الوجهة معارة بواسطة withView().
    */
    copy(source, destination, slots = UNKNOWN) {
        /** @type {Metadata} */
        const metaA = {};
        /** @type {Metadata} */
        const metaB = {};

        this.extractMetadata(source, metaA);
        this.extractMetadata(destination, metaB);
        if (metaB.borrowed) throw new Error("Block is borrowed");

        const maxSlotsDest = Math.floor(metaB.byteCapacity / this.wordSize);
        const slotsToCopy = Math.min(metaA.occupied, maxSlotsDest, slots);
        const newOccupied = Math.max(metaB.occupied, slotsToCopy);

        this.controlAdapter.setUint32(metaB.headerAddress + OCCUPIED_OFFSET, newOccupied, IS_LITTLE_ENDIAN);
        return this.dataBus.copyWithin(metaB.dataAddress, metaA.dataAddress, metaA.dataAddress + slotsToCopy * this.wordSize);
    }

    /**
     * ينسخ منطقة من العناصر داخل الكتلة نفسها.
     *
     * الفهارس مبنية على أساس الصفر وتتبع دلالات
     * `Array.prototype.copyWithin()`: يحدد `target` موضع الوجهة،
     * ويمثل `start` الموضع الأولي للمصدر و `length` الحد الأقصى لعدد
     * العناصر المراد نسخها.
     *
     * الفهارس السالبة تُفسر من نهاية سعة الكتلة.
     * بعد هذا التطبيع، يتم تقييد الفهارس بالسعة الفيزيائية. كما أن الكمية المنسوخة محدودة أيضاً بالعناصر
     * المشغولة فعلياً والمساحة المتاحة بدءاً من `target`.
     *
     * تدعم العملية المناطق المتداخلة ويمكن أن تزيد إشغال الكتلة
     * عندما يتجاوز نطاق الوجهة الإشغال الحالي.
     *
     * @param {number} handler - مقبض الكتلة.
     * @param {number} target - الفهرس الأولي للوجهة.
     * @param {number} start - الفهرس الأولي للمصدر.
     * @param {number} length - الحد الأقصى لعدد العناصر المراد نسخها.
     * @returns {Uint8Array} ناقل البيانات `dataBus` بعد العملية.
     * @throws {Error} إذا كان المقبض غير صالح، أو تالفاً، أو كانت الكتلة معارة بواسطة withView().
     */
    copyWithin(handler, target, start, length) {
        const meta = this.extractMetadata(handler, this.metadata);
        if (meta.borrowed) throw new Error("Block is borrowed");

        const slots = Math.floor(meta.byteCapacity / this.wordSize);
        target = Math.trunc(target);
        start = Math.trunc(start);
        length = Math.trunc(length);

        if (target < 0) target += slots;
        if (start < 0) start += slots;

        target = Math.max(0, Math.min(target, slots));
        start = Math.max(0, Math.min(start, slots));

        const maxRead = Math.max(0, meta.occupied - start);
        const maxWrite = slots - target;
        length = Math.max(0, Math.min(length, maxRead, maxWrite));

        if (length === 0) return this.dataBus;

        const targetAddress = meta.dataAddress + target * this.wordSize;
        const sourceAddress = meta.dataAddress + start * this.wordSize;
        const newOccupied = Math.max(meta.occupied, target + length);

        this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, newOccupied, IS_LITTLE_ENDIAN);

        return this.dataBus.copyWithin(targetAddress, sourceAddress, sourceAddress + length * this.wordSize);
    }

    /**
     * يلحق العناصر المشغولة لـ `source` بنهاية `target`.
     *
     * الكمية المنسوخة محدودة بعدد العناصر المشغولة في
     * المصدر والمساحة الحرة المتبقية في سعة الوجهة.
     *
     * تدعم العملية إشارة `target` و `source` إلى نفس الكتلة.
     * في هذه الحالة، يتم تنفيذ النسخ على منطقة الكتلة نفسها
     * ويحافظ على دلالات التداخل لـ `copyWithin()`.
     *
     * @param {number} target - مقبض الكتلة التي ستستقبل العناصر.
     * @param {number} source - مقبض الكتلة التي سيتم إلحاق عناصرها.
     * @returns {number} عدد العناصر المُلحقة فعلياً.
     * @throws {Error} إذا كانت المقابض غير صالحة، أو تالفة،
     * أو كانت كتلة الوجهة معارة بواسطة withView().
     */
    append(target, source) {
        const metaTarget = {};
        const metaSource = {};

        this.extractMetadata(target, metaTarget);
        this.extractMetadata(source, metaSource);
        if (metaTarget.borrowed) throw new Error("Block is borrowed");


        const available = metaTarget.byteCapacity / this.wordSize - metaTarget.occupied;
        const count = Math.min(available, metaSource.occupied);

        if (count === 0) return 0;

        const targetAddress = metaTarget.dataAddress + metaTarget.occupied * this.wordSize;
        const sourceAddress = metaSource.dataAddress;

        this.dataBus.copyWithin(targetAddress, sourceAddress, sourceAddress + count * this.wordSize);

        this.controlAdapter.setUint32(metaTarget.headerAddress + OCCUPIED_OFFSET, metaTarget.occupied + count, IS_LITTLE_ENDIAN);

        return count;
    }

    /**
     * ينشئ نسخة مستقلة من الكتلة.
     *
     * تمتلك الكتلة الجديدة نفس السعة الفيزيائية ونفس الإشغال الخاص
     * بالكتلة الأصلية. يتم نسخ جميع بايتات المنطقة المحجوزة، بما في ذلك المواضع
     * غير المشغولة حالياً.
     *
     * تتلقى الكتلة الجديدة مقبضاً جديداً وتظل خاضعة لقواعد
     * التخصيص وإعادة التدوير العادية.
     *
     * @param {number} handler - مقبض الكتلة المراد استنساخها.
     * @returns {number} مقبض الكتلة الجديدة.
     * @throws {Error} إذا كان المقبض غير صالح أو تالفاً.
     */
    clone(handler) {
        const meta = this.extractMetadata(handler, this.metadata);
        const cloned = this.alloc(meta.byteCapacity / this.wordSize);

        const cloneMeta = {};
        this.extractMetadata(cloned, cloneMeta);

        this.dataBus.copyWithin(cloneMeta.dataAddress, meta.dataAddress, meta.dataAddress + meta.byteCapacity);
        this.controlAdapter.setUint32(cloneMeta.headerAddress + OCCUPIED_OFFSET, meta.occupied, IS_LITTLE_ENDIAN);

        return cloned;
    }

    /**
     * يتبادل مناطق البيانات المرتبطة بكتلتين.
     *
     * تتبادل العملية بين الترويسات عناوين المناطق،
     * سعاتها وإشغالاتها. تظل المقابض دون تغيير:
     * بعد العملية، يستمر كل مقبض في تحديد ترويسته الخاصة، ولكن هذه الترويسة تصبح صفة للممنطقة التي كانت
     * تنتمي سابقاً للكتلة الأخرى.
     *
     * لا يتم نسخ أي بيانات في `dataBus`؛ فقط البيانات الوصفية للترويستين
     * يتم تعديلها.
     *
     * @param {number} source - مقبض الكتلة الأولى.
     * @param {number} target - مقبض الكتلة الثانية.
     * @returns {void}
     * @throws {Error} إذا كانت المقابض غير صالحة، أو تالفة،
     * أو كانت أي من الكتلتين معارة بواسطة withView().
     */
    swap(source, target) {
        /** @type {Metadata} */
        const metaA = {};
        /** @type {Metadata} */
        const metaB = {};

        this.extractMetadata(source, metaA);
        this.extractMetadata(target, metaB);

        if (metaA.borrowed) throw new Error("Block is borrowed");
        if (metaB.borrowed) throw new Error("Block is borrowed");
        

        this.controlAdapter.setUint32(metaA.headerAddress + ADDRESS_OFFSET, metaB.dataAddress, IS_LITTLE_ENDIAN);
        this.controlAdapter.setUint32(metaB.headerAddress + ADDRESS_OFFSET, metaA.dataAddress, IS_LITTLE_ENDIAN);

        this.controlAdapter.setUint8(metaA.headerAddress + CAPACITY_OFFSET, metaB.capacityExponent);
        this.controlAdapter.setUint8(metaB.headerAddress + CAPACITY_OFFSET, metaA.capacityExponent);

        this.controlAdapter.setUint32(metaA.headerAddress + OCCUPIED_OFFSET, metaB.occupied, IS_LITTLE_ENDIAN);
        this.controlAdapter.setUint32(metaB.headerAddress + OCCUPIED_OFFSET, metaA.occupied, IS_LITTLE_ENDIAN);
    }


    // ============= التسلسل (SERIALIZATION) ==============

    /**
     * يسلسل محتوى والبيانات الوصفية لكتلة الذاكرة.
     *
     * يستخرج الأسلوب البيانات المشغولة للكتلة عبر `pick()`،
     * ويجمعها جنباً إلى جنب مع معلومات السعة ونوع الكلمة (Word type)
     * في مظروف بيانات ويقوم بتشفرها باستخدام تنسيق CBOR.
     *
     * @param {number} handler - مقبض الكتلة المراد تسلسلها.
     * @returns {Uint8Array} مخزن مؤقت يحتوي على البيانات المسلسلة للكتلة.
     * @throws {Error} إذا كان المقبض غير صالح أو تالفاً.
     */
    dump(handler) {
        const meta = this.extractMetadata(handler, this.metadata);
        const capacity = meta.capacityExponent;
        const capacityElements = 2 ** capacity;

        if (!Number.isInteger(capacity) || capacity < 1 || capacity > 31 || meta.occupied > capacityElements) {
            throw new Error("Cannot serialize a block with invalid metadata");
        }

        const payload = this.pick(handler);

        if (payload.length !== meta.occupied || payload.constructor !== this.bucketArray) {
            throw new Error("Cannot serialize a block with an invalid payload");
        }

        return encode({
            v: 1,
            wordType: this.wordType,
            capacity,
            occupied: meta.occupied,
            le: IS_LITTLE_ENDIAN,
            payload
        });
    }

    /**
     * يستعيد كتلة ذاكرة من بيانات مسلسلة.
     *
     * يفك تشفر مظروف CBOR، ويتحقق مما إذا كان نوع كلمة البيانات
     * المسلسلة متوافقاً مع مثيل المخصص الحالي ويخصص
     * كتلة جديدة بالسعة اللازمة لاستيعاب المحتوى.
     * بعد ذلك، يتم استعادة البيانات والإشغال الأصلي في الكتلة الجديدة.
     *
     * @param {Uint8Array|ArrayBuffer} serialized - المخزن المؤقت الذي يحتوي على البيانات المسلسلة.
     * @returns {number} مقبض الكتلة الجديدة المُعاد إنشاؤها.
     * @throws {Error} إذا كان نوع كلمة البيانات المفككة يختلف عن المُكوّن في المخصص.
     */
    load(serialized) {
        if (!(serialized instanceof ArrayBuffer) && !(serialized instanceof Uint8Array)) {
            throw new TypeError("serialized must be an ArrayBuffer or Uint8Array");
        }

        const envelope = decode(serialized);

        if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
            throw new TypeError("Invalid serialized block envelope");
        }

        if (envelope.v !== 1) {
            throw new Error(`Unsupported serialized block version: ${envelope.v}`);
        }

        if (envelope.wordType !== this.wordType) {
            throw new Error(`Can't load data, ${this.wordType} expected but ${envelope.wordType} found.`);
        }

        if (!Number.isInteger(envelope.capacity) || envelope.capacity < 1 || envelope.capacity > 31) {
            throw new RangeError("Invalid serialized block capacity");
        }

        const capacityElements = 2 ** envelope.capacity;

        if (!Number.isSafeInteger(envelope.occupied) || envelope.occupied < 0 || envelope.occupied > capacityElements) {
            throw new RangeError("Invalid serialized block occupancy");
        }

        if (typeof envelope.le !== "boolean") {
            throw new TypeError("Invalid serialized endianness flag");
        }

        const payload = envelope.payload;

        if (!isTypedArray(payload) || payload.constructor !== this.bucketArray || payload.length !== envelope.occupied) {
            throw new TypeError(`Invalid payload: expected ${this.bucketType}Array with ${envelope.occupied} elements`);
        }

        if (payload.BYTES_PER_ELEMENT !== this.wordSize || payload.byteLength !== envelope.occupied * this.wordSize) {
            throw new TypeError("Serialized payload has an invalid element size");
        }

        const handler = this.alloc(capacityElements);
        const meta = this.extractMetadata(handler, this.metadata);
        this.put(handler, payload);
        this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, envelope.occupied, IS_LITTLE_ENDIAN);

        return handler;
    }

    // ========== التكامل وإدخال البيانات ==========

    /**
     * عقد محوّل متزامن لإدخال البيانات.
     *
     * يتلقى المحوّل نسخة Balloc ويستخدم واجهتها العامة لتخزين البيانات، ثم يعيد المعالج الذي يحدد الكتلة الرئيسية.
     *
     * La operación es síncrona. El adaptador debe completar la ingesta antes de
     * regresar y es responsable de revertir sus propias asignaciones si ocurre
     * un error durante la carga.
     *
     * @param {FormatAdapter} adapter - محوّل يطبّق load(allocator).
     * @returns {number} المعالج الذي يعيده المحوّل.
     * @throws {TypeError} إذا لم يطبّق المحوّل الدالة load().
     */
    loadData(adapter) {
        if (!adapter || typeof adapter.load !== "function") throw new TypeError("adapter must implement load(allocator)");
        return adapter.load(this);
    }

    // ============= الأدوات المساعدة (UTILITIES) ==============

    /**
     * يمنع عمليات التعديل على كتلة معارة.
     *
     * يتحقق من علم VIEW_LOCK في الترويسة المرتبطة بالعنوان المُعطى.
     *
     * @param {number} headerAddress - عنوان الترويسة في controlBus.
     * @returns {void}
     * @throws {Error} إذا كانت الكتلة معارة بواسطة withView().
     * @private
     * @deprecated
    */
    assertNotBorrowed(headerAddress) {
        if (this.controlBus[headerAddress + FLAGS_OFFSET] & VIEW_LOCK) {
            throw new Error("Block is borrowed");
        }
    }

    /**
     * يمنع العمليات التي تستبدل أو تعيد تعيين dataBus
     * طالما كان هناك أي جزء معار.
     *
     * @returns {void}
     * @throws {Error} إذا كانت هناك أي كتلة معارة بواسطة withView().
     * @private
     */
    assertNoActiveViews() {
        for (let i = 0; i < this.controlPointer; i += HEADER_SIZE) {
            if (this.controlBus[i + COOKIE_OFFSET] === 0) continue;
            if (this.controlBus[i + FLAGS_OFFSET] & VIEW_LOCK) {
                throw new Error("Cannot remap memory while a block is borrowed");
            }
        }
    }

    /**
     * [استخدام داخلي]
     * يفك تشفر البيانات الوصفية المرتبطة بمقبض.
     *
     * ينقسم المقبض إلى جيل وعنوان الترويسة. يتم بعد ذلك إعادة حساب ملف تعريف الارتباط (Cookie) المخزن
     * في الترويسة للتحقق من التركيبة؛ وفقط بعد هذا التحقق يتم قراءة البيانات الوصفية.
     *
     * تتم كتابة الحقول المفككة في الكائن `out`، والذي يتم إرجاعه
     * بواسطة الدالة نفسها. يمكن إعادة استخدام الكائن بين الاستدعاءات لتجنب
     * تخصيصات جديدة.
     *
     * @param {number} handler - المقبض المراد فك تشفيره والتحقق منه.
     * @param {Metadata} out - الكائن الذي سيستقبل البيانات الوصفية المفككة.
     * @returns {Metadata} نفس المرجع المُقدم في `out`.
     * @throws {Error} إذا لم يتطابق ملف تعريف ارتباط الترويسة مع المقبض أو
     * إذا لم يحدد المقبض ترويسة صالحة.
     * @private
     */
    extractMetadata(handler, out) {
        out.generation = (handler / ROTATE_32BITS) & CLAMP_11BITS;
        out.headerAddress = handler >>> 0;

        const cookie = this.controlAdapter.getUint8(out.headerAddress + COOKIE_OFFSET);


        if (cookie !== this.bakeCookie(out.headerAddress, out.generation)) {
            throw new Error("Invalid or corrupted handle");
        }

        out.dataAddress = this.controlAdapter.getUint32(out.headerAddress + ADDRESS_OFFSET, IS_LITTLE_ENDIAN);
        out.capacityExponent = this.controlAdapter.getUint8(out.headerAddress + CAPACITY_OFFSET);
        out.byteCapacity = (1 << out.capacityExponent >>> 0) * this.wordSize;
        out.occupied = this.controlAdapter.getUint32(out.headerAddress + OCCUPIED_OFFSET, IS_LITTLE_ENDIAN);
        out.borrowed = this.controlAdapter.getUint32(out.headerAddress + FLAGS_OFFSET, IS_LITTLE_ENDIAN) & VIEW_LOCK;

        return out;
    }

    /**
     * [استخدام داخلي]
     * يحسب ملف تعريف ارتباط التحقق (Validation cookie) لترويسة.
     *
     * يتم اشتقاق ملف تعريف الارتباط من عنوان الترويسة وبتات الجيل الـ 11 عبر
     * التجزئة السريعة (Fast hash).
     * يتم تصغير النتيجة إلى 8 بتات.
     *
     * تُحجز القيمة صفر كمؤشر لترويسة غير صالحة؛ ولهذا السبب،
     * عندما ينتج عن الحساب صفر، يرجع الأسلوب `1`.
     *
     * لا يشكل ملف تعريف الارتباط آلية تشفير. الغرض منه هو
     * اكتشاف المقابض غير الصالحة، القديمة (Stale)، أو التالفة ضمن نموذج إدارة
     * الذاكرة الخاص بالمخصص.
     *
     * @param {number} addr - عنوان الترويسة.
     * @param {number} gen - الجيل المرتبط بالمقبض. يتم أخذ بتات الـ 11
     * الأقل أهمية في الاعتبار فقط.
     * @returns {number} ملف تعريف ارتباط بـ 8 بتات في النطاق [1, 255].
     * @private
     */
    bakeCookie(addr, gen) {
        return (addr ^ (gen & 0x7FF * 0x9e3779b1)) & 0xff || 1;
    }

    /**
     * يرجع كمية المناطق المخزنة حالياً في قائمة
     * إعادة التدوير.
     *
     * تتوافق كل منطقة مع كتلة محررة تعذر إرجاعها
     * مباشرة إلى قمة `dataBus`، وبالتالي تظل متاحة
     * لإعادة الاستخدام بواسطة تخصيص مستقبلي بسعة مطابقة.
     *
     * @returns {number} عدد المناطق الحرة المحتفظ بها في `recycle`.
     */
    recycleCount() {
        let count = 0;

        for (const [, page] of this.recycle) {
            count += page[0];
        }

        return count;
    }

    /**
     * يرجع إجمالي البايتات التابعة للمناطق المخزنة حالياً
     * في قائمة إعادة التدوير.
     *
     * يتم حساب القيمة بجمع سعة كل منطقة حرة مضروبة
     * في كمية المناطق المسجلة لتلك السعة.
     *
     * @returns {number} عدد البايتات المشغولة بواسطة المناطق القابلة لإعادة التدوير.
     */
    get recycleBytes() {
        let total = 0;

        for (const [capacity, page] of this.recycle) {
            total += page[0] * capacity;
        }

        return total;
    }

    /**
     * يرجع كمية البايتات المخصصة التي لا تنتمي إلى المناطق
     * القابلة لإعادة التدوير حالياً.
     *
     * يتم الحصول على القيمة عن طريق طرح البايتات التابعة للمناطق الحرة المحتفظ
     * بها في `recycle` من إجمالي تقدم `dataPointer`.
     *
     * @returns {number} عدد البايتات المرتبطة بالمناطق غير القابلة لإعادة التدوير
     * داخل المساحة المستخدمة بالفعل بواسطة `dataBus`.
     */
    get allocatedBytes() {
        return this.dataPointer - this.recycleBytes;
    }

    /**
     * يرجع كمية البايتات غير المستخدمة بعد في قمة `dataBus`.
     *
     * تتوافق هذه المساحة مع المنطقة بين `dataPointer` ونهاية
     * السعة المحجوزة حالياً للمخزن المؤقت.
     *
     * @returns {number} عدد البايتات المتاحة بعد `dataPointer`.
     */
    get unallocatedBytes() {
        return this.size - this.dataPointer;
    }

    /**
     * يرجع النسبة بين الذاكرة القابلة لإعادة التدوير ومنطقة الكومة (Heap) المستخدمة.
     *
     * تعتبر المقياس المناطق الحرة المحتفظ بها في `recycle` بمثابة تجزئة (Fragmentation)
     * وتستخدم `dataPointer` كمقام. عندما لا يتم استخدام أي بايت
     * بواسطة الكومة، تكون النتيجة صفراً.
     *
     * لا تمثل القيمة جزءاً من كامل سعة `dataBus`، بل
     * تمثل تحديداً نسبة البايتات القابلة لإعادة التدوير داخل المساحة التي تم المرور
     * عليها بالفعل بواسطة مؤشر الاندفاع (Bump pointer).
     *
     * @returns {number} نسبة التجزئة في النطاق [0, 1] في ظل ظروف
     * التشغيل العادية.
     */
    get fragmentationRatio() {
        if (this.dataPointer === 0) return 0;
        return this.recycleBytes / this.dataPointer;
    }

}