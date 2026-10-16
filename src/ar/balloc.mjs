import { encode, decode } from 'cbor-x';

/**
 * علامة تشير إلى قيمة غير صالحة أو غير معروفة.
 */
const UNKNOWN = 0xFFFFFFFF >>> 0;

/**
 * أحجام وأنواع الحاويات الصالحة.
 * يتم دعم أحجام 8، 16، 32، و 64 بت فقط للأنواع الصحيحة، و
 * أحجام 16، 32، و 64 بت فقط للأنواع العائمة.
 * أنواع البيانات المدعومة:
 * u = عدد صحيح غير سالْب
 * i = عدد صحيح سالْب
 * f = عدد عائم
 * 
 * صياغة معرف الحاوية:
 * 
 * [الحجم بالبت][نوع البيانات]
 * 
 * أمثلة:
 * حاوية عدد صحيح غير سالب بـ 32 بت: 32u
 * حاوية عدد صحيح سالب بـ 64 بت: 64i
 * 
 */
const BUCKET_MAPPING = Object.freeze({
    "8u":  { type: "Uint8",  bits: 8 },
    "16u": { type: "Uint16",  bits: 16 },
    "32u": { type: "Uint32",  bits: 32 },
    "64u": { type: "BigUint64",  bits: 64 },
    "8i":  { type: "Int8",   bits: 8 },
    "16i": { type: "Int16",   bits: 16 },
    "32i": { type: "Int32",   bits: 32 },
    "64i": { type: "BigInt64",   bits: 64 },
    "16f": { type: "Float16", bits: 16 },
    "32f": { type: "Float32", bits: 32 },
    "64f": { type: "Float64", bits: 64 }
});

/**
 * أنواع الحاويات المدعومة بواسطة مخصص الذاكرة:
 * - الأعداد الصحيحة غير السالبة: '8u'، '16u'، '32u'، '64u'
 * - الأعداد الصحيحة السالبة: '8i'، '16i'، '32i'، '64i'
 * - الأعداد العائمة: '16f'، '32f'، '64f'
 *
 * @typedef {'8u'|'16u'|'32u'|'64u'|'8i'|'16i'|'32i'|'64i'|'16f'|'32f'|'64f'} BucketType
 */

/**
 * علامة تباين النظام (Endianness).
 *
 * تكتشف ما إذا كان النظام يعمل بنظام البايت الأصغر أولاً (Little Endian)، مما يؤثر
 * على ترتيب البايتات في عمليات DataView.
 */
const IS_LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;


/**
 * تنسيق البيانات الوصفية (Metadata).
 *  0               4                8               9             10              
 *  [عنوان 32بت]    [المشغول 32بت]   [السعة 8بت]     [الكوكيز 8بت]  [محجوز 48بت]
 * 
 * الإجمالي: 4 + 4 + 1 + 1 + 6 = 16 بايت
 */
const HEADER_SIZE = 16 >>> 0;

const ADDRESS_OFFSET  = 0 >>> 0;
const OCCUPIED_OFFSET = 4 >>> 0;
const CAPACITY_OFFSET = 8 >>> 0;
const COOKIE_OFFSET   = 9 >>> 0;


const ROTATE_32BITS = 4294967296;
const CLAMP_11BITS = 0x7FF >>> 0;

/**
 * هيكل يحتوي على البيانات الوصفية المشفرة داخل المقبض (Handle).
 * 
 * @typedef {Object} Metadata
 * @property {number} byteCapacity - سعة كتلة الذاكرة بالبايت.
 * @property {number} capacityExponent - سعة كتلة الذاكرة معبر عنها كأَس أساسه اثنان.
 * @property {number} dataAddress - عنوان كتلة الذاكرة داخل ناقل البيانات (dataBus).
 * @property {number} generation - الجيل الذي ينتمي إليه المقبض.
 * @property {number} headerAddress - عنوان الترويسة داخل ناقل التحكم (controlBus).
 * @property {number} occupied - عدد العناصر المشغولة في الكتلة.
 */

/**
 * يتحقق مما إذا كانت القيمة مثيلًا لـ TypedArray.
 * 
 * @param {any} val - القيمة المراد اختبارها.
 * @returns {boolean} `true` إذا كانت القيمة TypedArray، وإلا `false`.
 */
const isTypedArray = (val) => ArrayBuffer.isView(val) && !(val instanceof DataView);

/**
 * مخصص الذاكرة المزدوج الناقل Echo Stack Dual Bus Bump Allocator مع ReBump GC.
 */
export default class Balloc {

    /**
     * ينشئ مثيلًا من مخصص الذاكرة `Balloc`.
     *
     * يحتفظ المخصص بناقلين مستقلين:
     * - `dataBus`: يخزن بيانات الكتل المخصصة؛
     * - `controlBus`: يخزن الترويسات وبيانات التحكم الأخرى.
     *
     * كل كتلة لها ترويسة ذات حجم ثابت (`HEADER_SIZE`) ويتم تحديدها خارجيًا
     * بواسطة مقبض منطقي بـ 43 بت، يتكون من جيل بـ 11 بت
     * وعنوان ترويسة بـ 32 بت.
     *
     * يتم تقريب سعة كل كتلة لأقرب قوة للعدد اثنين
     * من حيث العناصر، مع احترام عرض الحاوية المُكوّن.
     *
     * @param {number} [size=65535] - السعة الأولية لـ `dataBus` بالبايت.
     * يجب أن يكون عددًا صحيحًا آمنًا في النطاق [2, 0x80000000].
     * @param {BucketType} [bucketSize="32u"] - معرف نوع وحجم الحاوية
     * (مثل: '32u' لـ Uint32، '64f' لـ Float64، '8i' لـ Int8).
     * @param {number} [metadataSize=1024] - السعة الأولية لـ `controlBus`
     * بالبايت. يجب أن يكون عددًا صحيحًا آمنًا في النطاق
     * [HEADER_SIZE, 0x80000000].
     *
     * @throws {RangeError} إذا كانت `size` خارج النطاق المسموح به.
     * @throws {RangeError} إذا كانت `bucketSize` ليست معرف حاوية صالحًا.
     * @throws {RangeError} إذا كانت `metadataSize` خارج النطاق المسموح به.
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
        this.size = Math.max(1 << (32 - Math.clz32(size)) >>> 0, this.wordSize);
        this.headerSize = 1 << (32 - Math.clz32(metadataSize)) >>> 0;
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

    // ========== ALLOCATION ==========

    /**
     * يخصص كتلة ذاكرة جديدة.
     *
     * يتم تحويل السعة المطلوبة إلى أصغر قوة للعدد اثنين
     * تتسع لـ `size` من العناصر. يُفضل الحصول على الكتلة من قائمة
     * المناطق القابلة لإعادة التدوير التي لها السعة المقابلة؛ وإذا لم توجد منطقة متوافقة،
     * يتم حجز الكتلة في قمة `dataBus`.
     *
     * بعد ذلك، يتم الحصول على ترويسة من مساحة التحكم. يمكن إعادة استخدام الترويسات
     * المُحررة مسبقًا عبر مكدس إعادة التدوير الداخلي؛ وإلا، يتم توسيع `controlBus`
     * عند الضرورة.
     *
     * تتلقى الترويسة العنوان، السعة، الإشغال الأولي (صفر)، وكوكي التحقق (validation cookie).
     * تشفر القيمة المُرجعة جيل التخصيص وعنوان الترويسة:
     *
     *     [11 بت للجيل][32 بت لعنوان الترويسة]
     *
     * @param {number} [size=16] - الحد الأدنى لعدد العناصر التي يجب أن تتسع لها الكتلة.
     * يجب أن يكون عددًا صحيحًا آمنًا في النطاق [2, 0x80000000].
     * @returns {number} مقبض يحدد الكتلة المخصصة.
     * @throws {RangeError} إذا كانت `size` خارج النطاق المسموح به.
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
            this.controlPointer+= HEADER_SIZE;
            this.echoPointer+= HEADER_SIZE;
        }

        this.controlAdapter.setUint32(headerAddress + ADDRESS_OFFSET, dataAddress, IS_LITTLE_ENDIAN);
        this.controlAdapter.setUint32(headerAddress + OCCUPIED_OFFSET, 0, IS_LITTLE_ENDIAN);
        this.controlAdapter.setUint8(headerAddress + CAPACITY_OFFSET, capacity);
        this.controlAdapter.setUint8(headerAddress + COOKIE_OFFSET, this.bakeCookie(headerAddress, ++this.generation));

        return (this.generation & CLAMP_11BITS) * ROTATE_32BITS + headerAddress;
    }

    /**
     * يوسع سعة الكتلة إلى القوة التالية للعدد اثنين.
     *
     * عندما تقع الكتلة في القمة الحالية لـ `dataBus`، يتم التوسيع
     * في نفس المكان (in-place): يتم تحديث سعتها و `dataPointer` فقط.
     *
     * إذا كانت هناك منطقة أخرى موجودة بعد الكتلة، يتم الحصول على منطقة جديدة بضعف
     * السعة من المساحة القابلة لإعادة التدوير أو تخصيصها في قمة `dataBus`.
     * ثم يتم نسخ العناصر المشغولة حاليًا إلى المنطقة الجديدة،
     * وإرجاع المنطقة السابقة إلى قائمة إعادة التدوير.
     *
     * يظل المقبض صالحًا لأن ترويسته محفوظة، ويتم تحديث العنوان
     * والسعة المسجلين بداخله فقط.
     *
     * @param {number} handler - مقبض الكتلة المراد توسيعها.
     * @returns {void}
     * @throws {Error} إذا كان المقبض غير صالح أو تالفًا.
     * @throws {AggregateError} إذا وصلت السعة إلى الحد الأقصى
     * المدعوم.
     */
    realloc(handler) {
        const generation = (handler / ROTATE_32BITS) & CLAMP_11BITS;
        let headerAddress = handler >>> 0;

        const dataAddress = this.controlAdapter.getUint32(headerAddress + ADDRESS_OFFSET, IS_LITTLE_ENDIAN);
        const occupied = this.controlAdapter.getUint32(headerAddress + OCCUPIED_OFFSET, IS_LITTLE_ENDIAN);
        const capacity = this.controlAdapter.getUint8(headerAddress + CAPACITY_OFFSET);
        const cookie = this.controlAdapter.getUint8(headerAddress + COOKIE_OFFSET);


        if (cookie !== this.bakeCookie(headerAddress, generation)) {
            throw new Error("Invalid or corrupted handle");
        }

        if (capacity >= 31) throw new AggregateError([new Error("Can´t reallocate handler.") ,new RangeError("Capacity has reached its limit.")], "Internal Error.");

        const newCapacity = capacity + 1;
        const newBlockSize = (1 << newCapacity >>> 0) * this.wordSize;
        const oldBlockSize = (1 << capacity >>> 0) * this.wordSize;

        if (dataAddress + oldBlockSize === this.dataPointer) {
            while (dataAddress + newBlockSize > this.size) this.grow();

            this.controlAdapter.setUint8(headerAddress + CAPACITY_OFFSET, newCapacity, IS_LITTLE_ENDIAN);
            this.dataPointer = dataAddress + newBlockSize;

            return;
        }

        this.recyclePush(oldBlockSize, dataAddress);

        let newAddress = this.recyclePop(newBlockSize);

        if (newAddress === UNKNOWN) {
            while (this.dataPointer + newBlockSize > this.size) this.grow();

            newAddress = this.dataPointer;
            this.dataPointer += newBlockSize;
        }

        this.controlAdapter.setUint8(headerAddress + CAPACITY_OFFSET, newCapacity);
        this.dataBus.copyWithin(newAddress, dataAddress, dataAddress + occupied * this.wordSize);

        this.controlAdapter.setUint32(headerAddress + ADDRESS_OFFSET, newAddress, IS_LITTLE_ENDIAN);
    }

    /**
     * يحرر كتلة ذاكرة.
     *
     * يتم إبطال ترويسة الكتلة بتسجيل كوكي الخاص بها إلى الصفر، وتسجيل عنوانها
     * لإعادة استخدامه لاحقًا. كما يتم إرجاع منطقة البيانات إلى نظام إعادة التدوير،
     * إلا إذا كانت الكتلة تقع تمامًا في قمة `dataBus`؛ في هذه الحالة،
     * يتم التراجع عن `dataPointer` ببساطة، مما يلغي المنطقة دون إنشاء إدخال في قائمة إعادة التدوير.
     *
     * @param {number} handler - مقبض الكتلة المراد تحريرها.
     * @returns {void}
     * @throws {Error} إذا كان المقبض غير صالح أو تالفًا.
     */
    free(handler) {
        const generation = (handler / ROTATE_32BITS) & CLAMP_11BITS;
        let headerAddress = handler >>> 0;

        const dataAddress = this.controlAdapter.getUint32(headerAddress + ADDRESS_OFFSET, IS_LITTLE_ENDIAN);
        const capacity = this.controlAdapter.getUint8(headerAddress + CAPACITY_OFFSET);
        const cookie = this.controlAdapter.getUint8(headerAddress + COOKIE_OFFSET);


        if (cookie !== this.bakeCookie(headerAddress, generation)) {
            throw new Error("Invalid or corrupted handle");
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

    // ========== RECYCLING ==========

    /**
     * [استخدام داخلي]
     * يدخل منطقة حرة في قائمة إعادة التدوير.
     *
     * يتم تنظيم القائمة حسب السعة بالبايت. لكل سعة، القيمة المخزنة
     * هي `Uint32Array` يحتوي موضعها الصفري على عدد العناوين المسجلة،
     * والمواضع اللاحقة تحتوي على عناوين المناطق الحرة:
     *
     *     [العدد، العنوان1، العنوان2، ...]
     *
     * عندما تمتتلئ الصفحة، يتم توسيع مخزنها المؤقت إلى ضعف السعة الحالية.
     *
     * @param {number} capacity - سعة المنطقة الحرة بالبايت.
     * @param {number} address - العنوان الأولي للمنطقة في `dataBus`.
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
     * يتم إجراء البحث بواسطة السعة المطلوبة بالضبط. عندما توجد صفحة مقابلة،
     * يتم إزالة العنوان المسجل الأخير من الصفحة وإرجاعه،
     * مما ينفذ إعادة التدوير كمكدس LIFO (الأخير داخل، الأول خارج).
     *
     * @param {number} capacity - السعة المطلوبة بالبايت.
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

    // ========== GARBAGE COLLECTION ==========
    /**
     * يضغط `dataBus` باستخدام خوارزمية ReBump.
     *
     * يجتاز الترويسات المسجلة في `controlBus` تسلسليًا وانسخ المناطق التي لا تزال صالحة
     * إلى `dataBus` جديد، مما يلغي المساحات الحرة فيما بينها.
     * يتم تحديث عنوان كل كتلة ناجية في ترويستها الخاصة.
     *
     * يتم الحفاظ على ترتيب الكتل في `controlBus`. كما يتم الحفاظ بالكامل على البيانات الداخلية
     * لكل كتلة، بما في ذلك سعتها المحجوزة وإشغالها الحالي.
     *
     * في نهاية الضغط:
     * - يتم إلغاء جميع المناطق القابلة لإعادة التدوير؛
     * - يشير `dataPointer` إلى البايت الأول بعد آخر كتلة حية؛
     * - يمثل `dataBus` كومة متجاورة (contiguous heap) للكتل النشطة.
     *
     * تعقيد التحكم هو O(n)، حيث `n` هو عدد الترويسات التي تم اجتيازها.
     * تعتمد التكلفة الفعلية لنقل الذاكرة أيضًا على حجم البايتات
     * التي تنتمي إلى الكتل الحية.
     *
     * @returns {void}
     */
    gc() {
        const newDataBus = new Uint8Array(this.dataBus.buffer.byteLength);
        this.recycle.clear();
        this.dataPointer = 0 >>> 0;
        for (let i = 0; i < this.controlPointer; i+= HEADER_SIZE) {
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

    // ========== SCALING ==========
    /**
     * [!!! استخدام داخلي، لا تستخدمه في كودك !!!]
     * يوسع `dataBus` إلى ضعف سعتها الحالية.
     *
     * يتم نقل المخزن المؤقت الأساسي إلى `ArrayBuffer` أكبر، مع الحفاظ
     * على البيانات الموجودة. يتم إعادة إنشاء جميع العروض (views) المرتبطة بالمخزن المؤقت لتشير
     * إلى التخزين الجديد.
     *
     * @returns {void}
     * @throws {RangeError} إذا تجاوزت سعة `dataBus` الحد الأقصى
     * المدعوم.
     * @private
     */
    grow() {
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
     * يوسع `controlBus` إلى ضعف سعتها الحالية.
     *
     * يتم نقل المخزن المؤقت الأساسي إلى `ArrayBuffer` أكبر، مع الحفاظ
     * على الترويسات الموجودة. يتم إعادة إنشاء `controlAdapter` لتشير إلى التخزين الجديد.
     *
     * @returns {void}
     * @throws {RangeError} إذا تجاوزت سعة `controlBus` الحالية
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

    // ========== STACK OPERATIONS ==========

    /**
     * يلحق عنصرًا بنهاية تسلسل الكتلة المشغول.
     *
     * يتم كتابة العنصر في أول موضع حر بعد آخر عنصر مشغول.
     * يتم زيادة إشغال الكتلة فقط عندما تكون المساحة متاحة ضمن سعتها.
     *
     * @param {number} handler - مقبض الكتلة.
     * @param {number} value - القيمة المراد إضافتها.
     * @returns {boolean} `true` إذا تم إدراج القيمة؛ `false` إذا لم يكن للكتلة
     * مساحة متاحة.
     * @throws {Error} إذا كان المقبض غير صالح أو تالفًا.
     */
    push(handler, value) {

        const meta = this.extractMetadata(handler, this.metadata);

        if ((meta.occupied + 1) * this.wordSize > meta.byteCapacity) return false;

        this.writer(meta.dataAddress + meta.occupied * this.wordSize , value, IS_LITTLE_ENDIAN);
        this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, meta.occupied + 1,IS_LITTLE_ENDIAN);

        return true;
    }

    /**
     * يزيل ويُرجع العنصر المشغول الأخير من الكتلة.
     *
     * يتم تقليل الإشغال قبل قراءة العنصر المُزال. البايتات المقابلة
     * لا يتم مسحها وتظل في المنطقة المخصصة، لكنها تتوقف عن كونها
     * جزءًا من التسلسل المشغول.
     *
     * @param {number} handler - مقبض الكتلة.
     * @returns {number|undefined} القيمة المُزالة أو `undefined` إذا كانت الكتلة
     * فارغة.
     * @throws {Error} إذا كان المقبض غير صالح أو تالفًا.
     */
    pop(handler) {
        const meta = this.extractMetadata(handler, this.metadata);

        if (meta.occupied === 0) return undefined;

        this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, meta.occupied - 1,IS_LITTLE_ENDIAN);
        return this.reader(meta.dataAddress + (meta.occupied - 1) * this.wordSize, IS_LITTLE_ENDIAN);
    }

    /**
     * يُرجع العنصر المشغول الأخير دون إزالته.
     *
     * @param {number} handler - مقبض الكتلة.
     * @returns {number|undefined} القيمة المشغولة الأخيرة أو `undefined` إذا كانت
     * الكتلة فارغة.
     * @throws {Error} إذا كان المقبض غير صالح أو تالفًا.
     */
    peek(handler) {
        const meta = this.extractMetadata(handler, this.metadata);

        if (meta.occupied === 0) return undefined;

        return this.reader(meta.dataAddress + (meta.occupied - 1) * this.wordSize, IS_LITTLE_ENDIAN);
    }

    // ========== QUEUE OPERATIONS ==========

    /**
     * يدرج عنصرًا في بداية التسلسل المشغول.
     *
     * يتم إزاحة العناصر المشغولة حاليًا بمقدار موضع واحد للأمام وتتم كتابة `value`
     * في الموضع الأول. تتطلب العملية موضعًا حرًا ضمن سعة الكتلة.
     *
     * تكلفة العملية تتناسب طرديًا مع عدد العناصر المشغولة،
     * حيث تحتاج البيانات إلى إزاحة.
     *
     * @param {number} handler - مقبض الكتلة.
     * @param {number} value - القيمة المراد إدراجها.
     * @returns {boolean} `true` إذا تم إدراج القيمة؛ `false` إذا كانت الكتلة
     * ممتلئة.
     * @throws {Error} إذا كان المقبض غير صالح أو تالفًا.
     */
    nudge(handler, value) {
        const meta = this.extractMetadata(handler, this.metadata);

        if ((meta.occupied + 1) * this.wordSize > meta.byteCapacity) return false;

        this.dataBus.copyWithin(meta.dataAddress + this.wordSize, meta.dataAddress, meta.dataAddress + meta.occupied * this.wordSize);
        this.writer(meta.dataAddress, value, IS_LITTLE_ENDIAN);
        this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, meta.occupied + 1,IS_LITTLE_ENDIAN);

        return true;
    }

    /**
     * يزيل ويُرجع العنصر المشغول الأول من الكتلة.
     *
     * يتم إزاحة العناصر المتبقية بمقدار موضع واحد نحو بداية
     * المنطقة المشغولة. تبقى السعة الفيزيائية للكتلة كما هي دون تغيير.
     *
     * تكلفة العملية تتناسب طرديًا مع عدد العناصر المزاحة.
     *
     * @param {number} handler - مقبض الكتلة.
     * @returns {number|undefined} القيمة الأولى المُزالة أو `undefined` إذا كانت
     * الكتلة فارغة.
     * @throws {Error} إذا كان المقبض غير صالح أو تالفًا.
     */
    pull(handler) {
        const meta = this.extractMetadata(handler, this.metadata);

        if (meta.occupied === 0) return undefined;

        const result = this.reader(meta.dataAddress, IS_LITTLE_ENDIAN);
        this.dataBus.copyWithin(meta.dataAddress, meta.dataAddress + this.wordSize, meta.dataAddress + meta.occupied * this.wordSize);
        this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, meta.occupied - 1, IS_LITTLE_ENDIAN);
        return result;
    }

    /**
     * يُرجع العنصر المشغول الأول دون إزالته.
     *
     * @param {number} handler - مقبض الكتلة.
     * @returns {number|undefined} القيمة المشغولة الأولى أو `undefined` إذا كانت
     * الكتلة فارغة.
     * @throws {Error} إذا كان المقبض غير صالح أو تالفًا.
     */
    head(handler) {
        const meta = this.extractMetadata(handler, this.metadata);

        if (meta.occupied === 0) return undefined;

        return this.reader(meta.dataAddress, IS_LITTLE_ENDIAN);    
    }

    // ========== RANDOM ACCESS ==========

    /**
     * يتحقق مما إذا كانت القيمة موجودة ضمن العناصر المشغولة للكتلة.
     *
     * يتم إجراء البحث مباشرة على `TypedArray` المساعد ويأخذ في الاعتبار
     * النطاق المشغول حاليًا فقط، وليس السعة الفيزيائية المحجوزة بالكامل.
     *
     * @param {number} handler - مقبض الكتلة.
     * @param {number} value - القيمة المراد البحث عنها.
     * @returns {boolean} `true` إذا كانت `value` موجودة بين العناصر المشغولة؛
     * وإلا، `false`.
     * @throws {Error} إذا كان المقبض غير صالح أو تالفًا.
     */
    has(handler, value) {
        const meta = this.extractMetadata(handler, this.metadata);

        if (meta.occupied === 0) return false;

        const rawAddres = meta.dataAddress >>> this.wordShift;

        return this.auxiliary.subarray(rawAddres, rawAddres + meta.occupied).includes(value);
    }

     /**
     * يُرجع العنصر المشغول عند فهرس يعتمد على الصفر (zero-based index).
     *
     * الفهارس خارج النطاق `[0, occupied)` لا تُعتبر خطأ و
     * تؤدي إلى إرجاع `undefined`.
     *
     * @param {number} handler - مقبض الكتلة.
     * @param {number} index - الفهرس المبدئي للصفر للعنصر.
     * @returns {number|undefined} القيمة المخزنة في الفهرس أو `undefined` إذا كان
     * الفهرس خارج المنطقة المشغولة.
     * @throws {Error} إذا كان المقبض غير صالح أو تالفًا.
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
     * `[0, occupied)` يتم تجاهلها وتؤدي إلى إرجاع `false`.
     *
     * @param {number} handler - مقبض الكتلة.
     * @param {number} index - الفهرس المبدئي للصفر للعنصر.
     * @param {number} value - القيمة الجديدة.
     * @returns {boolean} `true` إذا تم كتابة القيمة؛ `false` إذا كان الفهرس
     * خارج المنطقة المشغولة.
     * @throws {Error} إذا كان المقبض غير صالح أو تالفًا.
     */
    set(handler, index, value) {
        const meta = this.extractMetadata(handler, this.metadata);

        if (index < 0 || index >= meta.occupied) return false;

        this.writer(meta.dataAddress + index * this.wordSize, value, IS_LITTLE_ENDIAN);
        return true;
    }

    // ============= MISCELLANEOUS ===============

    /**
     * يمسح إشغال الكتلة ويملأ سعتها الفيزيائية بالكامل بقيمة واحدة.
     *
     * يغطي التعبئة جميع الفتحات المتاحة، وليس فقط العناصر المشغولة حاليًا.
     * بعد العملية، تُعتبر الكتلة فارغة بغض النظر عن القيمة
     * المستخدمة للتعبئة.
     *
     * @param {number} handler - مقبض الكتلة.
     * @param {number} [value=0] - القيمة المستخدمة لملء جميع الفتحات.
     * @returns {void}
     * @throws {Error} إذا كان المقبض غير صالح أو تالفًا.
     */
    clear(handler, value=0) {
        const meta = this.extractMetadata(handler, this.metadata);

        const slots = meta.byteCapacity / this.wordSize;
        const rawAddress = meta.dataAddress >>> this.wordShift;

        this.auxiliary.fill(value, rawAddress, rawAddress + slots);        
        this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, 0, IS_LITTLE_ENDIAN);
    }


    /**
     * يملأ نطاقًا من فتحات الكتلة بقيمة.
     *
     * يستخدم النطاق فهارس مبدئية للصفر ويتبع اصطلاح `[start, end)`،
     * مما يعني أن `start` متضمن (inclusive) و `end` مستبعد (exclusive). عندما لا يتم توفير `end`،
     * يمتد الملء إلى نهاية سعة الكتلة الفيزيائية.
     *
     * يصبح إشغال الكتلة مساويًا لـ `end`، بما في ذلك عندما يمتد النطاق المملوء إلى ما بعد
     * الإشغال السابق.
     *
     * @param {number} handler - مقبض الكتلة.
     * @param {number} value - القيمة المستخدمة للتعبئة.
     * @param {number} [start=0] - الفهرس الأولي، متضمن.
     * @param {number|null} [end=null] - الفهرس النهائي، مستبعد. عند حذفه أو
     * جعله `null`، يستخدم إجمالي سعة الكتلة.
     * @returns {void}
     * @throws {Error} إذا كان المقبض غير صالح أو تالفًا.
     * @throws {RangeError} إذا كان `start` أو `end` خارج حدود السعة، أو إذا كان
     * `start > end`.
     */
    fill(handler, value, start = 0, end = null) {
        const meta = this.extractMetadata(handler, this.metadata);
        
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
     * يملأ جميع الفتحات الفيزيائية للكتلة بقيمة ويضع علامة على السعة بالكامل
     * على أنها مشغولة.
     *
     * على عكس `clear()`، تؤدي العملية إلى كتلة مشغولة بالكامل.
     *
     * @param {number} handler - مقبض الكتلة.
     * @param {number} value - القيمة المستخدمة للتعبئة.
     * @returns {void}
     * @throws {Error} إذا كان المقبض غير صالح أو تالفًا.
     */
    fillAll(handler, value) {
        const meta = this.extractMetadata(handler, this.metadata);
        
        const rawAddress = meta.dataAddress >>> this.wordShift;
        const capacityElements = meta.byteCapacity / this.wordSize;

        this.auxiliary.fill(value, rawAddress, rawAddress + capacityElements);
        this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, capacityElements, IS_LITTLE_ENDIAN);
    }

    /**
     * ينسخ عناصر من `Array` أو `TypedArray` إلى بداية الكتلة.
     *
     * الكمية المنسوخة محددة بسعة الكتلة. يتم تحديث الإشغال
     * إلى القيمة الأكبر بين الإشغال السابق والكمية المنسوخة فعليًا؛
     * لذلك، استدعاء `put()` لا يقلل الإشغال الحالي عند
     * تلقي تسلسل أصغر.
     *
     * بالنسبة لـ `Array`، يتم نسخ العناصر الملائمة الأولى فقط. بالنسبة لـ `TypedArray`،
     * يتم استخدام نطاق فرعي للمصدر دون نسخ وسيط.
     *
     * @param {number} handler - مقبض الكتلة.
     * @param {Array|TypedArray} data - تسلسل القيم المراد نسخها.
     * @returns {void}
     * @throws {Error} إذا كان المقبض غير صالح أو تالفًا.
     * @throws {TypeError} إذا كانت `data` ليست `Array` ولا `TypedArray`.
     */
    put(handler, data) {
        const meta = this.extractMetadata(handler, this.metadata);

        const rawAddress = meta.dataAddress >>> this.wordShift;
        const length = Math.min(1 << meta.capacityExponent >>> 0, data.length);

        meta.occupied = Math.max(length, meta.occupied);

        if (Array.isArray(data)) {
            this.auxiliary.set(data.slice(0, length), rawAddress);
        } else if (isTypedArray(data)) {
            this.auxiliary.set(data.subarray(0, length), rawAddress);
        } else {
            const actual = data?.constructor?.name ?? (data === null ? 'null' : typeof data);
            throw new TypeError(`data must be Array or TypedArray, but ${actual} was given.`);
        }    
        this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, meta.occupied, IS_LITTLE_ENDIAN);
    }

     /**
     * يُرجع نسخة من العناصر المشغولة حاليًا بواسطة الكتلة.
     *
     * النتيجة هي `TypedArray` من نفس النوع المُكوّن بواسطة `bucketSize`.
     * لا يتم تضمين السعة الفيزيائية غير المشغولة في النتيجة.
     *
     * لا تكشف العملية عن التخزين الداخلي بشكل مباشر: تستخدم الطريقة
     * `TypedArray.prototype.slice()`، مما ينتج عنه عرض جديد بتخزين مستقل.
     *
     * @param {number} handler - مقبض الكتلة.
     * @returns {TypedArray} نسخة من العناصر المشغولة بواسطة الكتلة. عندما تكون
     * الكتلة فارغة، تُرجع `TypedArray` فارغًا من النوع المُكوّن.
     * @throws {Error} إذا كان المقبض غير صالح أو تالفًا.
     */
    pick(handler) {
        const meta = this.extractMetadata(handler, this.metadata);

        const rawAddress = meta.dataAddress >>> this.wordShift;

        if (meta.occupied === 0) {
            return this.auxiliary.slice(rawAddress, rawAddress); 
        }        

        return this.auxiliary.slice(rawAddress, rawAddress + meta.occupied);
    }

    // ======== CAPACITY IN SLOTS ==========

    /**
     * يُرجع السعة الفيزيائية للكتلة بالبايت.
     *
     * تتوافق السعة مع المساحة المحجوزة لجميع الفتحات في الكتلة،
     * بغض النظر عن عدد العناصر المشغولة حاليًا.
     *
     * @param {number} handler - مقبض الكتلة.
     * @returns {number} السعة الفيزيائية للكتلة بالبايت.
     * @throws {Error} إذا كان المقبض غير صالح أو تالفًا.
     */
    byteSize(handler) {
        const meta = this.extractMetadata(handler, this.metadata);
        return meta.byteCapacity;
    }

    /**
     * يُرجع عدد العناصر المشغولة حاليًا في الكتلة.
     *
     * @param {number} handler - مقبض الكتلة.
     * @returns {number} عدد العناصر المشغولة.
     * @throws {Error} إذا كان المقبض غير صالح أو تالفًا.
     */
    occupied(handler){
        const meta = this.extractMetadata(handler, this.metadata);
        return meta.occupied;

    }

    /**
     * يُرجع سعة الكتلة بعدد العناصر.
     *
     * تتوافق القيمة مع الكمية الإجمالية للفتحات المحجوزة فيزيائيًا،
     * وليست الكمية المشغولة حاليًا.
     *
     * @param {number} handler - مقبض الكتلة.
     * @returns {number} العدد الإجمالي للفتحات المتاحة في الكتلة.
     * @throws {Error} إذا كان المقبض غير صالح أو تالفًا.
     */
    length(handler) {
        const meta = this.extractMetadata(handler, this.metadata);
        return 1 << meta.capacityExponent >>> 0;
    }

    // ========== Inter-block Operations =============

    /**
     * ينسخ العناصر المشغولة من كتلة إلى أخرى.
     *
     * يبدأ النسخ من العنصر الأول لـ `source` وأول فتحة لـ `destiny`.
     * الكمية المنسوخة فعليًا محددة بعدد العناصر المشغولة في المصدر،
     * السعة الفيزيائية للوجهة، والحد المحدد في `slots`.
     *
     * يتم زيادة إشغال الوجهة، عند الضرورة، لتغطية العناصر المنسوخة.
     * لا تتغير سعة الوجهة.
     *
     * تستخدم العملية `Uint8Array.prototype.copyWithin()` على `dataBus`،
     * وبالتالي تكون القيمة المُرجعة هي `Uint8Array` التي تمثل ناقل البيانات.
     *
     * @param {number} source - مقبض كتلة المصدر.
     * @param {number} destiny - مقبض كتلة الوجهة.
     * @param {number} [slots=UNKNOWN] - الحد الأقصى لعدد العناصر المراد نسخها.
     * يمثل `UNKNOWN` قيمة الحراسة المستخدمة لعدم فرض حد إضافي.
     * @returns {Uint8Array} ناقل البيانات (`dataBus`) بعد العملية.
     * @throws {Error} إذا كانت `source` أو `destiny` غير صالحة أو تالفة.
     */
    copy(source, destiny, slots = UNKNOWN){
        /** @type {Metadata} */
        const metaA = {};
        /** @type {Metadata} */
        const metaB = {};

        this.extractMetadata(source, metaA);
        this.extractMetadata(destiny, metaB);

        const maxSlotsDest = Math.floor(metaB.byteCapacity / this.wordSize);
        const slotsToCopy = Math.min(metaA.occupied, maxSlotsDest, slots);
        const newOccupied = Math.max(metaB.occupied, slotsToCopy);

        this.controlAdapter.setUint32(metaB.headerAddress + OCCUPIED_OFFSET, newOccupied, IS_LITTLE_ENDIAN);

        return this.dataBus.copyWithin(metaB.dataAddress, metaA.dataAddress, metaA.dataAddress + slotsToCopy * this.wordSize);
    }

    /**
     * ينسخ منطقة من العناصر داخل نفس الكتلة.
     *
     * الفهارس مبدئية للصفر وتتبع دلالات `Array.prototype.copyWithin()`:
     * يحدد `target` موضع الوجهة، و `start` موضع بدء المصدر،
     * و `length` الحد الأقصى لعدد العناصر المراد نسخها.
     *
     * الفهارس السالبة يتم تفسيرها من نهاية سعة الكتلة. بعد
     * هذا التطبيع، يتم تقييد الفهارس بحدود السعة الفيزيائية. الكمية المنسوخة
5     * مقيدة أيضًا بالعناصر المشغولة فعليًا والمساحة المتاحة من `target`.
     *
     * تدعم العملية المناطق المتداخلة ويمكنها زيادة إشغال الكتلة
     * عندما يتجاوز نطاق الوجهة الإشغال الحالي.
     *
     * @param {number} handler - مقبض الكتلة.
     * @param {number} target - فهرس الوجهة الأولي.
     * @param {number} start - فهرس المصدر الأولي.
     * @param {number} length - الحد الأقصى لعدد العناصر المراد نسخها.
     * @returns {Uint8Array} ناقل البيانات (`dataBus`) بعد العملية.
     * @throws {Error} إذا كان المقبض غير صالح أو تالفًا.
     */
    copyWithin(handler, target, start, length) {
        const meta = this.extractMetadata(handler, this.metadata);
        const slots = Math.floor(meta.byteCapacity / this.wordSize);

        target = Math.trunc(target);
        start = Math.trunc(start);
        length = Math.trunc(length);

        if (target < 0) target += slots;
        if (start < 0) start += slots;

        // يثبت الفهارس ضمن حدود السعة
        target = Math.max(0, Math.min(target, slots));
        start = Math.max(0, Math.min(start, slots));

        // يحدد النسخ للمساحة المتاحة بدءًا من الوجهة
        // والعناصر المشغولة فعليًا بدءًا من البداية
        const maxRead = Math.max(0, meta.occupied - start);
        const maxWrite = slots - target;
        length = Math.max(0, Math.min(length, maxRead, maxWrite));

        if (length === 0) return this.dataBus;

        const targetAddress = meta.dataAddress + target * this.wordSize;
        const sourceAddress = meta.dataAddress + start * this.wordSize;

        // يحدث الإشغال إذا وسع النسخ القمة المشغولة للكتلة
        const newOccupied = Math.max(meta.occupied, target + length);
        this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, newOccupied, IS_LITTLE_ENDIAN);

        return this.dataBus.copyWithin(targetAddress, sourceAddress, sourceAddress + length * this.wordSize);
    }

    /**
     * يلحق العناصر المشغولة لـ `source` بنهاية `target`.
     *
     * الكمية المنسوخة مقيدة بعدد العناصر المشغولة في المصدر
     * والمساحة الحرة المتبقية في سعة الوجهة.
     *
     * تدعم العملية أن تشير `target` و `source` إلى نفس الكتلة.
     * في هذه الحالة، يتم تنفيذ النسخ على منطقة الكتلة نفسها ويحافظ على
     * دلالات التداخل لـ `copyWithin()`.
     *
     * @param {number} target - مقبض الكتلة التي ستستقبل العناصر.
     * @param {number} source - مقبض الكتلة التي سيتم إلحاق عناصرها.
     * @returns {number} عدد العناصر المُلحقة فعليًا.
     * @throws {Error} إذا كانت `target` أو `source` غير صالحة أو تالفة.
     */
    append(target, source) {
        const metaTarget = {};
        const metaSource = {};

        this.extractMetadata(target, metaTarget);
        this.extractMetadata(source, metaSource);

        const available = metaTarget.byteCapacity / this.wordSize - metaTarget.occupied;
        const count = Math.min(available, metaSource.occupied);

        if (count === 0) return 0;

        const targetAddress = metaTarget.dataAddress + metaTarget.occupied * this.wordSize;
        const sourceAddress = metaSource.dataAddress;

        if (target === source) {
            this.dataBus.copyWithin(targetAddress, sourceAddress,  sourceAddress + count * this.wordSize);
        } else {
            this.dataBus.copyWithin(targetAddress, sourceAddress, sourceAddress + count * this.wordSize);
        }

        this.controlAdapter.setUint32(metaTarget.headerAddress + OCCUPIED_OFFSET, metaTarget.occupied + count, IS_LITTLE_ENDIAN);

        return count;
    }

    /**
     * ينشئ نسخة مستقلة من الكتلة.
     *
     * تمتلك الكتلة الجديدة نفس السعة الفيزيائية والإشغال للكتلة الأصلية.
     * يتم نسخ جميع البايتات في المنطقة المحجوزة، بما في ذلك المواضع غير المشغولة حاليًا.
     *
     * تتلقى الكتلة الجديدة مقبضًا جديدًا وتظل خاضعة لقواعد التخصيص
     * وإعادة التدوير العادية.
     *
     * @param {number} handler - مقبض الكتلة المراد استنساخها.
     * @returns {number} مقبض الكتلة الجديدة.
     * @throws {Error} إذا كان المقبض غير صالح أو تالفًا.
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
     * تتبادل العملية عناوين المناطق، السعات، والإشغالات بين الترويسات.
     * تظل المقبضات دون تغيير: بعد العملية، يستمر كل مقبض في تحديد
     * ترويسته الخاصة، لكن تلك الترويسة تصف الآن المنطقة التي كانت تنتمي سابقًا
     * للكتلة الأخرى.
     *
     * لا يتم نسخ أي بيانات في `dataBus`؛ بل يتم تعديل بيانات التحكم للترويستين فقط.
     *
     * @param {number} source - مقبض الكتلة الأولى.
     * @param {number} target - مقبض الكتلة الثانية.
     * @returns {void}
     * @throws {Error} إذا كانت `source` أو `target` غير صالحة أو تالفة.
     */
    swap(source, target) {
        /** @type {Metadata} */
        const metaA = {};
        /** @type {Metadata} */
        const metaB = {};
        
        this.extractMetadata(source, metaA);
        this.extractMetadata(target, metaB);

        this.controlAdapter.setUint32(metaA.headerAddress + ADDRESS_OFFSET, metaB.dataAddress, IS_LITTLE_ENDIAN);
        this.controlAdapter.setUint32(metaB.headerAddress + ADDRESS_OFFSET, metaA.dataAddress, IS_LITTLE_ENDIAN);

        this.controlAdapter.setUint8(metaA.headerAddress + CAPACITY_OFFSET, metaB.capacityExponent);
        this.controlAdapter.setUint8(metaB.headerAddress + CAPACITY_OFFSET, metaA.capacityExponent);

        this.controlAdapter.setUint32(metaA.headerAddress + OCCUPIED_OFFSET, metaB.occupied, IS_LITTLE_ENDIAN);
        this.controlAdapter.setUint32(metaB.headerAddress + OCCUPIED_OFFSET, metaA.occupied, IS_LITTLE_ENDIAN);
    } 


    // ============= SERIALIZATION ==============

    /**
     * يحول محتوى والبيانات الوصفية لكتلة ذاكرة إلى تسلسل (Serializes).
     *
     * تستخرج الطريقة البيانات المشغولة من الكتلة عبر `pick()`، وتجمعها
     * مع معلومات السعة ونوع الكلمة في غلاف بيانات (data envelope)، وتشفيرها
     * باستخدام تنسيق CBOR.
     *
     * @param {number} handler - مقبض الكتلة المراد تسلسلسها.
     * @returns {Uint8Array} مخزن مؤقت يحتوي على بيانات الكتلة المسلسلة.
     * @throws {Error} إذا كان المقبض غير صالح أو تالفًا.
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
     * يفك تشفير غلاف CBOR، ويتحقق مما إذا كان نوع الكلمة للبيانات المسلسلة
     * متوافقًا مع مثيل المخصص الحالي، ويخصص كتلة جديدة
     * بالسعة اللازمة لاستيعاب المحتوى. بعد ذلك، يتم استعادة البيانات الأصلية
     * والإشغال في الكتلة الجديدة.
     *
     * @param {Uint8Array|ArrayBuffer} serialized - مخزن مؤقت يحتوي على البيانات المسلسلة.
     * @returns {number} مقبض الكتلة المُعاد إنشاؤها حديثًا.
     * @throws {Error} إذا كان نوع كلمة البيانات المفكوكة يختلف عن النوع المُكوّن في المخصص.
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

    // ============= UTILITIES ==============

    /**
     * [استخدام داخلي]
     * يفك تشفير البيانات الوصفية المرتبطة بالمقبض.
     *
     * يتم تقسيم المقبض إلى جيل وعنوان ترويسة. ثم يتم إعادة حساب الكوكي المخزن
     * في الترويسة للتحقق من التركيبة؛ وفقط بعد هذا التحقق يتم قراءة البيانات الوصفية.
     *
     * تتم كتابة الحقول المفكوكة إلى الكائن `out`، والذي يتم إرجاعه بواسطة الدالة
     * نفسها. يمكن إعادة استخدام الكائن عبر الاستدعاءات لتجنب تخصيصات جديدة.
     *
     * @param {number} handler - المقبض المراد فك تشفيره والتحقق منه.
     * @param {Metadata} out - الكائن الذي سيتلقى البيانات الوصفية المفكوكة.
     * @returns {Metadata} نفس المرجع المُقدم في `out`.
     * @throws {Error} إذا كان كوكي الترويسة لا يتطابق مع المقبض أو إذا كان
     * المقبض لا يحدد ترويسة صالحة.
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
        out.capacityExponent  = this.controlAdapter.getUint8(out.headerAddress + CAPACITY_OFFSET);
        out.byteCapacity = (1 << out.capacityExponent >>> 0) * this.wordSize;
        out.occupied = this.controlAdapter.getUint32(out.headerAddress + OCCUPIED_OFFSET, IS_LITTLE_ENDIAN);

        return out;
    }

    /**
     * [استخدام داخلي]
     * يحسب كوكي التحقق للترويسة.
     *
     * يتم اشتقاق الكوكي من عنوان الترويسة والجيل ذي 11 بت عبر
     * دالة تجزئة سريعة (fast hash). يتم اختزال النتيجة إلى 8 بت.
     *
     * القيمة صفر محجوزة كمؤشر لترويسة غير صالحة؛ لذلك، عندما
     * تنتج العملية صفرًا، تُرجع الطريقة `1`.
     *
     * الكوكي ليس آلية تشفير. الغرض منه هو اكتشاف المقبضات غير الصالحة،
     * القديمة، أو التالفة داخل نموذج إدارة الذاكرة للمخصص.
     *
     * @param {number} addr - عنوان الترويسة.
     * @param {number} gen - الجيل المرتبط بالمقبض. يتم أخذ الـ 11 بت الأقل
     * أهمية فقط.
     * @returns {number} كوكي بـ 8 بت في النطاق [1, 255].
     * @private
     */
    bakeCookie(addr, gen) {
        return (addr ^ (gen & 0x7FF * 0x9e3779b1)) & 0xff || 1;
    }

    /**
     * يُرجع عدد المناطق المخزنة حاليًا في قائمة إعادة التدوير.
     *
     * تتوافق كل منطقة مع كتلة مُحررة لم يمكن إرجاعها مباشرة
     * إلى قمة `dataBus` وبالتالي تظل متاحًة لإعادة الاستخدام بواسطة
     * تخصيص مستقبل بنفس السعة.
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
     * يُرجع إجمالي البايتات التي تنتمي إلى المناطق المخزنة حاليًا في قائمة إعادة التدوير.
     *
     * يتم حساب القيمة عن طريق جمع سعة كل منطقة حرة مضروبة
     * في عدد المناطق المسجلة لتلك السعة.
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
     * يُرجع كمية البايتات المخصصة التي لا تنتمي إلى مناطق قابلة لإعادة التدوير حاليًا.
     *
     * يتم الحصول على القيمة عن طريق طرح البايتات التي تنتمي إلى المناطق الحرة المحتفظ بها
     * في `recycle` من إجمالي تقدم `dataPointer`.
     *
     * @returns {number} عدد البايتات المرتبطة بالمناطق غير القابلة لإعادة التدوير ضمن
     * المساحة المستخدمة بالفعل بواسطة `dataBus`.
     */
    get allocatedBytes() {
        return this.dataPointer - this.recycleBytes;
    }

    /**
     * يُرجع كمية البايتات التي لم تُستخدم بعد في قمة `dataBus`.
     *
     * تتوافق هذه المساحة مع المنطقة الواقعة بين `dataPointer` ونهاية
     * السعة المحجوزة حاليًا للمخزن المؤقت.
     *
     * @returns {number} عدد البايتات المتاحة بعد `dataPointer`.
     */
    get unallocatedBytes() {
        return this.size - this.dataPointer;
    }

    /**
     * يُرجع النسبة بين الذاكرة القابلة لإعادة التدوير ومساحة الكومة المستخدمة.
     *
     * يعتبر المقياس المناطق الحرة المحتفظ بها في `recycle` بمثابة تجزئة (fragmentation)
     * ويستخدم `dataPointer` كمقام. عندما لا يتم استخدام أي بايتات بواسطة الكومة،
     * تكون النتيجة صفرًا.
     *
     * لا تمثل القيمة جزءًا من إجمالي سعة `dataBus` بالكامل،
     * بل تحديدًا نسبة البايتات القابلة لإعادة التدوير ضمن المساحة التي
     * تم اجتيازها بالفعل بواسطة المؤشر التراكمي (bump pointer).
     *
     * @returns {number} نسبة التجزئة في النطاق [0, 1] في ظل ظروف
     * التشغيل العادية.
     */
    get fragmentationRatio() {
        if (this.dataPointer === 0) return 0;
        return this.recycleBytes / this.dataPointer;
    }

}