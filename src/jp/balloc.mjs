import { encode, decode } from 'cbor-x';

/**
 * 無効または不明な値を示すフラグ。
 */
const UNKNOWN = 0xFFFFFFFF >>> 0;

/**
 * 有効なバケットのサイズと型。
 * 整数型では8、16、32、64ビットサイズのみがサポートされ、
 * 浮動小数点数では16、32、64ビットサイズのみがサポートされます。
 * サポートされているデータ型:
 * u = 符号なし整数 (unsigned integer)
 * i = 符号付き整数 (signed integer)
 * f = 浮動小数点数 (float)
 * 
 * バケット識別子の構文:
 * 
 * [ビットサイズ][データ型]
 * 
 * 例:
 * 32ビット符号なし整数バケット: 32u
 * 64ビット符号付き整数バケット: 64i
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
 * アロケータによってサポートされるバケット型:
 * - 符号なし整数: '8u', '16u', '32u', '64u'
 * - 符号付き整数: '8i', '16i', '32i', '64i'
 * - 浮動小数点数: '16f', '32f', '64f'
 *
 * @typedef {'8u'|'16u'|'32u'|'64u'|'8i'|'16i'|'32i'|'64i'|'16f'|'32f'|'64f'} BucketType
 */

/**
 * システムのエンディアンフラグ。
 *
 * システムがリトルエンディアンかどうかを検出し、
 * DataView操作でのバイトオーダーに影響を与えます。
 */
const IS_LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;


/**
 * メタデータのフォーマット。
 *
 * [32bits address][32bits occupied][8bits capacity][8bits cookie][8bits flags][40bits reserved]
 *
 *
 * 合計: 16バイト
 */
const HEADER_SIZE = 16 >>> 0;
const ADDRESS_OFFSET = 0 >>> 0;
const OCCUPIED_OFFSET = 4 >>> 0;
const CAPACITY_OFFSET = 8 >>> 0;
const COOKIE_OFFSET = 9 >>> 0;
const FLAGS_OFFSET = 10 >>> 0;

/**
 * フラグ:
 * bit 0: VIEW_LOCK
 */
const VIEW_LOCK = 1 >>> 0;


const ROTATE_32BITS = 4294967296;
const CLAMP_11BITS = 0x7FF >>> 0;

/**
 * ハンドル内にエンコードされたメタデータを格納する構造体。
 * 
 * @typedef {Object} Metadata
 * @property {number} byteCapacity - メモリブロックのバイト単位の容量。
 * @property {number} capacityExponent - 2のべき乗の指数として表現されたメモリブロックの容量。
 * @property {number} dataAddress - dataBus内におけるメモリブロックのアドレス。
 * @property {number} generation - ハンドルが属する世代。
 * @property {number} headerAddress - controlBus内におけるヘッダーのアドレス。
 * @property {number} occupied - ブロック内の占有要素数。
 */

/**
 * 値がTypedArrayのインスタンスであるかどうかを検証します。
 * 
 * @param {any} val - テスト対象の値。
 * @returns {boolean} 値がTypedArrayの場合は `true`、それ以外の場合は `false`。
 */
const isTypedArray = (val) => ArrayBuffer.isView(val) && !(val instanceof DataView);

/**
 * ReBump GCを備えたEcho Stackデュアルバス・バンプアロケータ。
 */
export default class Balloc {

    /**
     * `Balloc` メモリアロケータのインスタンスを作成します。
     *
     * アロケータは2つの独立したバッファを維持します:
     * - `dataBus`: 割り当てられたブロックのデータを格納します。
     * - `controlBus`: ヘッダーおよびその他の制御メタデータを格納します。
     *
     * 各ブロックは固定サイズのヘッダー (`HEADER_SIZE`) を持ち、
     * 11ビットの世代と32ビットのヘッダーアドレスで構成される
     * 43ビットの論理ハンドルによって外部から識別されます。
     *
     * 各ブロックの容量は、設定されたバケットの幅を考慮し、
     * 要素数における次の2のべき乗に切り上げられます。
     *
     * @param {number} [size=65535] - `dataBus` の初期容量（バイト単位）。
     * [2, 0x80000000] の範囲内の安全な整数である必要があります。
     * @param {BucketType} [bucketSize="32u"] - バケットの型およびサイズの識別子
     * （例: Uint32の場合は '32u'、Float64の場合は '64f'、Int8の場合は '8i'）。
     * @param {number} [metadataSize=1024] - `controlBus` の初期容量（バイト単位）。
     * [HEADER_SIZE, 0x80000000] の範囲内の安全な整数である必要があります。
     *
     * @throws {RangeError} `size` が許容範囲外の場合。
     * @throws {RangeError} `bucketSize` が有効なバケット識別子ではない場合。
     * @throws {RangeError} `metadataSize` が許容範囲外の場合。
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

    // ========== 割り当て (ALLOCATION) ==========

    /**
     * 新しいメモリブロックを割り当てます。
     *
     * 要求された容量は、`size` 要素を格納できる最小の2のべき乗に変換されます。
     * ブロックは、対応する容量を持つ再利用可能な領域のリストから優先的に取得されます。
     * 互換性のある領域が存在しない場合、ブロックは `dataBus` のトップに予約されます。
     *
     * 次に、コントロールスペースからヘッダーが取得されます。以前に解放されたヘッダーは
     * 内部の再利用スタックを通じて再利用でき、そうでない場合は必要に応じて
     * `controlBus` が拡張されます。
     *
     * ヘッダーには、アドレス、容量、初期占有数（ゼロ）、および検証用クッキーが格納されます。
     * 返される値は、割り当て世代とヘッダーアドレスをエンコードしたものです:
     *
     *     [11世代ビット][32ヘッダーアドレスビット]
     *
     * @param {number} [size=16] - ブロックが格納しなければならない最小要素数。
     * [2, 0x80000000] の範囲内の安全な整数である必要があります。
     * @returns {number} 割り当てられたブロックを識別するハンドル。
     * @throws {RangeError} `size` が許容範囲外の場合。
     * @throws {Error} withView() によって借用されているブロックが存在する状態で
     * `dataBus` の拡張が必要になった場合。
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
     * ブロックの容量を次の2のべき乗に拡張します。
     *
     * ブロックが `dataBus` の現在のトップに位置している場合、拡張はインプレースで実行されます：
     * 容量と `dataPointer` のみが更新されます。
     *
     * ブロックの後に別の領域が存在する場合、2倍の容量を持つ新しい領域が
     * 再利用可能な領域から取得されるか、`dataBus` のトップに割り当てられます。
     * 現在占有されている要素が新しい領域にコピーされ、古い領域は再利用リストに戻されます。
     *
     * ヘッダーが保持され、そこに記録されているアドレスと容量のみが更新されるため、
     * ハンドルは有効なまま維持されます。
     *
     * @param {number} handler - 拡張するブロックのハンドル。
     * @returns {void}
     * @throws {Error} ハンドルが無効、破損している場合、またはブロックが
     * withView() によって借用されている場合。また、別のブロックが借用されている状態で
     * 拡張により dataBus の再マッピングが必要になった場合にも発生します。
     * @throws {AggregateError} 容量がサポートされている最大制限に達した場合。
     */
    realloc(handler) {

        const generation = (handler / ROTATE_32BITS) & CLAMP_11BITS;
        const headerAddress = handler >>> 0;
        const dataAddress = this.controlAdapter.getUint32(headerAddress + ADDRESS_OFFSET, IS_LITTLE_ENDIAN);
        const occupied = this.controlAdapter.getUint32(headerAddress + OCCUPIED_OFFSET, IS_LITTLE_ENDIAN);
        const capacity = this.controlAdapter.getUint8(headerAddress + CAPACITY_OFFSET);
        const cookie = this.controlAdapter.getUint8(headerAddress + COOKIE_OFFSET);

        if (cookie !== this.bakeCookie(headerAddress, generation)) {
            throw new Error("Invalid or corrupted handle");
        }

        this.assertNotBorrowed(headerAddress);

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
     * ブロックのアドレスとハンドルを維持したまま、使用中の要素を格納できる
     * 最小の2のべき乗の容量まで縮小します。
     *
     * ブロックが dataBus のトップにある場合、dataPointer を後退させます。
     * それ以外の場合、解放された末尾領域を2のべき乗の領域に分割し、
     * 各領域を再利用リストに戻します。
     *
     * @param {number} handler - 縮小するブロックのハンドル。
     * @returns {void}
     * @throws {Error} ハンドルが無効または破損している場合、あるいは
     * withView() によってブロックが借用されている場合。
     */
    shrink(handler) {
        const meta = this.extractMetadata(handler, this.metadata);
        this.assertNotBorrowed(meta.headerAddress);

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

        if (cookie !== this.bakeCookie(headerAddress, generation)) {
            throw new Error("Invalid or corrupted handle");
        }

        this.assertNotBorrowed(headerAddress);

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
    // ========== 再利用 (RECYCLING) ==========

    /**
     * [内部利用]
     * 空き領域を再利用リストに挿入します。
     *
     * リストはバイト単位の容量ごとに整理されます。各容量について、
     * 格納される値は `Uint32Array` であり、位置0には登録されたアドレスの数が格納され、
     * 後続の位置には空き領域のアドレスが格納されます:
     *
     *     [count, address1, address2, ...]
     *
     * ページが一杯になると、そのバッファは現在の容量の2倍に拡張されます。
     *
     * @param {number} capacity - 空き領域の容量（バイト単位）。
     * @param {number} address - `dataBus` 内における領域の開始アドレス。
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
     * [内部利用]
     * 再利用リストから空き領域を削除します。
     *
     * 検索は要求された正確な容量によって行われます。対応するページが存在する場合、
     * 最後に登録されたアドレスがページから削除されて返され、LIFOスタックとしての
     * 再利用を実現します。
     *
     * @param {number} capacity - 希望する容量（バイト単位）。
     * @returns {number} 再利用可能な領域の開始アドレス、または要求された容量の領域が
     * 存在しない場合は `UNKNOWN`。
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

    // ========== ガベージコレクション (GARBAGE COLLECTION) ==========

    /**
     * ReBumpアルゴリズムを使用して `dataBus` をコンパクション（圧縮）します。
     *
     * `controlBus` に登録されたヘッダーを順番に走査し、まだ有効な領域を
     * 新しい `dataBus` にコピーすることで、それらの間にある空きスペースを排除します。
     * 生存している各ブロックのアドレスは、それぞれのヘッダー内で更新されます。
     *
     * `controlBus` 内のブロックの順序は保持されます。各ブロックの内部データも、
     * 予約された容量や現在の占有数を含めて完全に保持されます。
     *
     * コンパクションの完了時:
     * - すべての再利用可能な領域が排除されます。
     * - `dataPointer` は、最後に生存しているブロックの直後のバイトを指すようになります。
     * - `dataBus` は、アクティブなブロックのための連続したヒープを表すようになります。
     *
     * 制御の計算量は O(n) です（`n` は走査されたヘッダーの数）。
     * 実効的なメモリ移動コストは、生存ブロックに属するバイトのボリュームにも依存します。
     *
     * @returns {void}
     * @throws {Error} withView() によって借用されているブロックが存在する場合。
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

    // ========== スケーリング (SCALING) ==========

    /**
     * [!!! 内部利用、コード内で使用しないでください !!!]
     * `dataBus` の容量を現在の2倍に拡張します。
     *
     * 内部バッファはより大きな `ArrayBuffer` に転送され、既存のデータは保持されます。
     * バッファに関連付けられているすべてのビューは、新しいストレージを参照するように再作成されます。
     *
     * @returns {void}
     * @throws {Error} withView() によって借用されているブロックが存在する場合。
     * @throws {RangeError} `dataBus` の容量がサポートされている最大制限を超過した場合。
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
     * [!!! 内部利用、コード内で使用しないでください !!!]
     * `controlBus` の容量を現在の2倍に拡張します。
     *
     * 内部バッファはより大きな `ArrayBuffer` に転送され、既存のヘッダーは保持されます。
     * `controlAdapter` は新しいストレージを参照するように再作成されます。
     *
     * @returns {void}
     * @throws {RangeError} `controlBus` の現在の容量がサポートされている最大制限を
     * 超過した場合。
     * @private
     */
    headerGrow() {
        if (this.controlBus.byteLength > 0x80000000) throw new RangeError("Control bus capacity exceeded");
        const newSize = (this.controlBus.byteLength * 2) >>> 0;
        const newBuffer = this.controlBus.buffer.transfer(newSize);

        this.controlBus = new Uint8Array(newBuffer);
        this.controlAdapter = new DataView(newBuffer);
    }

    // ========== スタック操作 (STACK OPERATIONS) ==========

    /**
     * ブロックによって占有されているシーケンスの末尾に要素を追加します。
     *
     * 要素は、最後尾の占有要素の直後の最初の空き位置に書き込まれます。
     * ブロックの占有数は、その容量内に空きスペースが存在する場合にのみインクリメントされます。
     *
     * @param {number} value - 挿入する値。
     * @returns {boolean} 値が挿入された場合は `true`、ブロックに利用可能な
     * スペースがない場合は `false`。
     * @throws {Error} ハンドルが無効、破損している場合、またはブロックが withView() によって借用されている場合。
     * 
     */
    push(handler, value) {
        const meta = this.extractMetadata(handler, this.metadata);
        this.assertNotBorrowed(meta.headerAddress);

        if ((meta.occupied + 1) * this.wordSize > meta.byteCapacity) return false;

        this.writer(meta.dataAddress + meta.occupied * this.wordSize, value, IS_LITTLE_ENDIAN);
        this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, meta.occupied + 1, IS_LITTLE_ENDIAN);

        return true;
    }

    /**
     * ブロックから最後尾の占有要素を削除し、それを返します。
     *
     * 占有数は、削除される要素を読み取る前にデクリメントされます。対応するバイトは
     * クリアされず割り当てられた領域に残りますが、占有されているシーケンスの一部ではなくなります。
     *
     * @param {number} handler - ブロックのハンドル。
     * @returns {number|undefined} 削除された値、またはブロックが空の場合は `undefined`。
     * @throws {Error} ハンドルが無効、破損している場合、またはブロックが withView() によって借用されている場合。
     */
    pop(handler) {
        const meta = this.extractMetadata(handler, this.metadata);
        this.assertNotBorrowed(meta.headerAddress);

        if (meta.occupied === 0) return undefined;

        this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, meta.occupied - 1, IS_LITTLE_ENDIAN);
        return this.reader(meta.dataAddress + (meta.occupied - 1) * this.wordSize, IS_LITTLE_ENDIAN);
    }

    /**
     * 最後尾の占有要素を削除せずに返します。
     *
     * @param {number} handler - ブロックのハンドル。
     * @returns {number|undefined} 最後尾の占有値、またはブロックが空の場合は `undefined`。
     * @throws {Error} ハンドルが無効または破損している場合。
     */
    peek(handler) {
        const meta = this.extractMetadata(handler, this.metadata);

        if (meta.occupied === 0) return undefined;

        return this.reader(meta.dataAddress + (meta.occupied - 1) * this.wordSize, IS_LITTLE_ENDIAN);
    }

    // ========== キュー操作 (QUEUE OPERATIONS) ==========

    /**
     * 占有されているシーケンスの先頭に要素を挿入します。
     *
     * 現在占有されている要素が1つ前方にシフトされ、最初の位置に `value` が書き込まれます。
     * この操作には、ブロックの容量内に空き位置が必要です。
     *
     * データのシフトが必要となるため、操作のコストは占有されている要素数に比例します。
     *
     * @param {number} handler - ブロックのハンドル。
     * @param {number} value - 挿入する値。
     * @returns {boolean} 値が挿入された場合は `true`、ブロックが一杯の場合は `false`。
     * @throws {Error} ハンドルが無効、破損している場合、またはブロックが withView() によって借用されている場合。
     */
    nudge(handler, value) {
        const meta = this.extractMetadata(handler, this.metadata);
        this.assertNotBorrowed(meta.headerAddress);

        if ((meta.occupied + 1) * this.wordSize > meta.byteCapacity) return false;

        this.dataBus.copyWithin(meta.dataAddress + this.wordSize, meta.dataAddress, meta.dataAddress + meta.occupied * this.wordSize);
        this.writer(meta.dataAddress, value, IS_LITTLE_ENDIAN);
        this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, meta.occupied + 1, IS_LITTLE_ENDIAN);

        return true;
    }

    /**
     * ブロックから先頭の占有要素を削除し、それを返します。
     *
     * 残りの要素は、占有領域の先頭に向かって1つシフトされます。ブロックの物理的容量は
     * 変更されません。
     *
     * 操作のコストは、シフトされる要素数に比例します。
     *
     * @param {number} handler - ブロックのハンドル。
     * @returns {number|undefined} 削除された先頭の値、またはブロックが空の場合は `undefined`。
     * @throws {Error} ハンドルが無効、破損している場合、またはブロックが withView() によって借用されている場合。
     */
    pull(handler) {
        const meta = this.extractMetadata(handler, this.metadata);
        this.assertNotBorrowed(meta.headerAddress);

        if (meta.occupied === 0) return undefined;

        const result = this.reader(meta.dataAddress, IS_LITTLE_ENDIAN);
        this.dataBus.copyWithin(meta.dataAddress, meta.dataAddress + this.wordSize, meta.dataAddress + meta.occupied * this.wordSize);
        this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, meta.occupied - 1, IS_LITTLE_ENDIAN);

        return result;
    }

    /**
     * 先頭の占有要素を削除せずに返します。
     *
     * @param {number} handler - ブロックのハンドル。
     * @returns {number|undefined} 先頭の占有値、またはブロックが空の場合は `undefined`。
     * @throws {Error} ハンドルが無効または破損している場合。
     */
    head(handler) {
        const meta = this.extractMetadata(handler, this.metadata);

        if (meta.occupied === 0) return undefined;

        return this.reader(meta.dataAddress, IS_LITTLE_ENDIAN);
    }

    // ========== ランダムアクセス (RANDOM ACCESS) ==========

    /**
     * ブロックの占有要素の中に特定の値が存在するかどうかを確認します。
     *
     * 検索は補助 `TypedArray` に対して直接実行され、予約された物理的容量全体ではなく、
     * 現在占有されている範囲のみを対象とします。
     *
     * @param {number} handler - ブロックのハンドル。
     * @param {number} value - 検索する値。
     * @returns {boolean} `value` が占有要素の中に存在する場合は `true`、それ以外の場合は `false`。
     * @throws {Error} ハンドルが無効または破損している場合。
     */
    has(handler, value) {
        const meta = this.extractMetadata(handler, this.metadata);

        if (meta.occupied === 0) return false;

        const rawAddres = meta.dataAddress >>> this.wordShift;

        return this.auxiliary.subarray(rawAddres, rawAddres + meta.occupied).includes(value);
    }

    /**
     * ブロックの占有シーケンス内における要素の最初の出現位置を検索します。
     *
     * 検索はインデックスの昇順で、配下の TypedArray の `indexOf` 操作を使用して実行されます。
     * ブロックの未使用容量は無視され、占有されている要素のみが対象となります。
     *
     * 検索の開始位置は `fromIndex` で指定でき、TypedArray のインデックス付けルールに従います。
     *
     * @param {number} handler - ブロックのハンドル。
     * @param {number|bigint} searchElement - 検索する要素。
     * @param {number} [fromIndex=0] - 検索を開始するインデックス。
     * @returns {number} 最初に見つかったインデックス、または要素が見つからない場合や
     * ブロックが空の場合は `-1`。
     * @throws {Error} ハンドルが無効または破損している場合。
     */
    indexOf(handler, searchElement, fromIndex = 0) {
        const meta = this.extractMetadata(handler, this.metadata);

        if (meta.occupied === 0) return -1;

        const rawAddres = meta.dataAddress >>> this.wordShift;

        return this.auxiliary.subarray(rawAddres, rawAddres + meta.occupied).indexOf(searchElement, fromIndex);
    }

    /**
     * ブロックの占有シーケンス内における要素の最後の出現位置を検索します。
     *
     * 検索はインデックスの降順で、配下の TypedArray の `lastIndexOf` 操作を使用して実行されます。
     * ブロックの未使用容量は無視され、占有されている要素のみが対象となります。
     *
     * 検索の開始位置は `fromIndex` で指定でき、TypedArray のインデックス付けルールに従います。
     * デフォルトでは、検索は最後尾の占有要素から開始されます。
     *
     * @param {number} handler - ブロックのハンドル。
     * @param {number|bigint} searchElement - 検索する要素。
     * @param {number} [fromIndex=-1] - 検索を開始するインデックス。
     * @returns {number} 最後に見つかったインデックス、または要素が見つからない場合や
     * ブロックが空の場合は `-1`。
     * @throws {Error} ハンドルが無効または破損している場合。
     */
    lastIndexOf(handler, searchElement, fromIndex = -1) {
        const meta = this.extractMetadata(handler, this.metadata);

        if (meta.occupied === 0) return -1;

        const rawAddres = meta.dataAddress >>> this.wordShift;

        return this.auxiliary.subarray(rawAddres, rawAddres + meta.occupied).lastIndexOf(searchElement, fromIndex);
    }


    /**
    * 0ベースのインデックスに対応する占有要素を返します。
    *
    * `[0, occupied)` の範囲外のインデックスはエラーとはみなされず、
    * `undefined` を返します。
    *
    * @param {number} handler - Block handle.
    * @param {number} index - 要素の0ベースのインデックス。
    * @returns {number|undefined} インデックスに格納されている値、またはインデックスが
    * 占有領域外である場合は `undefined`。
    * @throws {Error} ハンドルが無効または破損している場合。
    */
    get(handler, index) {

        const meta = this.extractMetadata(handler, this.metadata);

        if (index < 0 || index >= meta.occupied) return undefined;

        return this.reader(meta.dataAddress + index * this.wordSize, IS_LITTLE_ENDIAN);
    }

    /**
     * 占有されているインデックスに格納されている値を置き換えます。
     *
     * この操作はブロックの占有数を変更しません。`[0, occupied)` の範囲外のインデックスは
     * 無視され、`false` を返します。
     *
     * @param {number} handler - ブロックのハンドル。
     * @param {number} index - 要素の0ベースのインデックス。
     * @param {number} value - 新しい値。
     * @returns {boolean} 値が書き込まれた場合は `true`、インデックスが占有領域外である場合は `false`。
     * @throws {Error} ハンドルが無効、破損している場合、またはブロックが withView() によって借用されている場合。
     */
    set(handler, index, value) {
        const meta = this.extractMetadata(handler, this.metadata);
        this.assertNotBorrowed(meta.headerAddress);

        if (index < 0 || index >= meta.occupied) return false;

        this.writer(meta.dataAddress + index * this.wordSize, value, IS_LITTLE_ENDIAN);
        return true;
    }

    // ============= その他 (MISCELLANEOUS) ==============

    /**
     * ブロックの占有数をゼロにし、物理的容量全体を同一の値で埋めます。
     *
     * 埋め立ては、現在占有されている要素だけでなく、利用可能なすべてのスロットを対象とします。
     * 操作後、埋め立てに使用された値に関係なく、ブロックは空とみなされます。
     *
     * @param {number} handler - ブロックのハンドル。
     * @param {number} [value=0] - すべてのスロットを埋めるために使用する値。
     * @returns {void}
     * @throws {Error} ハンドルが無効、破損している場合、またはブロックが withView() によって借用されている場合。
     */
    clear(handler, value = 0) {
        const meta = this.extractMetadata(handler, this.metadata);
        this.assertNotBorrowed(meta.headerAddress);

        const slots = meta.byteCapacity / this.wordSize;
        const rawAddress = meta.dataAddress >>> this.wordShift;

        this.auxiliary.fill(value, rawAddress, rawAddress + slots);
        this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, 0, IS_LITTLE_ENDIAN);
    }


    /**
     * ブロックのスロットの範囲を指定した値で埋めます。
     *
     * 範囲には0ベースのインデックスを使用し、`[start, end)` の規約に従います。
     * つまり、`start` は包括的（inclusive）であり、`end` は排他的（exclusive）です。
     * `end` が指定されていない場合、埋め立てはブロックの物理的容量の末尾まで拡張されます。
     *
     * 埋められた範囲が以前の占有数を超える場合を含め、ブロックの占有数は `end` になります。
     *
     * @param {number} handler - ブロックのハンドル。
     * @param {number} value - 埋め立てに使用する値。
     * @param {number} [start=0] - 開始インデックス（包括的）。
     * @param {number|null} [end=null] - 終了インデックス（排他的）。省略された場合や
     * `null` の場合は、ブロックの総容量を使用します。
     * @returns {void}
     * @throws {Error} ハンドルが無効、破損している場合、またはブロックが withView() によって借用されている場合。
     * @throws {RangeError} `start` または `end` が容量の制限外である場合、
     * または `start > end` である場合。
     */
    fill(handler, value, start = 0, end = null) {
        const meta = this.extractMetadata(handler, this.metadata);
        this.assertNotBorrowed(meta.headerAddress);

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
     * ブロックのすべての物理的スロットを指定した値で埋め、容量全体を占有済みにマークします。
     *
     * `clear()` とは異なり、この操作結果は完全に占有されたブロックとなります。
     *
     * @param {number} handler - ブロックのハンドル。
     * @param {number} value - 埋め立てに使用する値。
     * @returns {void}
     * @throws {Error} ハンドルが無効、破損している場合、またはブロックが withView() によって借用されている場合。
     */
    fillAll(handler, value) {
        const meta = this.extractMetadata(handler, this.metadata);
        this.assertNotBorrowed(meta.headerAddress);

        const rawAddress = meta.dataAddress >>> this.wordShift;
        const capacityElements = meta.byteCapacity / this.wordSize;

        this.auxiliary.fill(value, rawAddress, rawAddress + capacityElements);
        this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, capacityElements, IS_LITTLE_ENDIAN);
    }

    /**
     * `Array` または `TypedArray` の要素をブロックの先頭にコピーします。
     *
     * コピーされる量はブロックの容量によって制限されます。占有数は、以前の占有数と
     * 実際にコピーされた量のうち大きい方に更新されます。したがって、より短いシーケンスが
     * 渡された場合でも、`put()` の呼び出しによって既存の占有数が減少することはありません。
     *
     * `Array` の場合、収まる最初の要素のみがコピーされます。
     * `TypedArray` の場合、中間コピーなしでソースのサブアレイが使用されます。
     *
     * @param {number} handler - ブロックのハンドル。
     * @param {Array|TypedArray} data - コピーする値のシーケンス。
     * @returns {void}
     * @throws {Error} ハンドルが無効、破損している場合、またはブロックが withView() によって借用されている場合。
     * @throws {TypeError} `data` が `Array` でも `TypedArray` でも無い場合。
     */
    put(handler, data) {
        const meta = this.extractMetadata(handler, this.metadata);
        this.assertNotBorrowed(meta.headerAddress);

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
    * ブロックによって現在占有されている要素のコピーを返します。
    *
    * 結果は `bucketSize` によって設定された型と同じ `TypedArray` です。
    * 占有されていない物理的容量は結果に含まれません。
    *
    * この操作は内部ストレージを直接公開しません。メソッドは `TypedArray.prototype.slice()` を
    * 使用し、独立したストレージを持つ新しいビューを生成します。
    *
    * @param {number} handler - ブロックのハンドル。
    * @returns {TypedArray} ブロックによって占有されている要素のコピー。ブロックが空の場合、
    * 設定された型の空の `TypedArray` を返します。
    * @throws {Error} ハンドルが無効または破損している場合。
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
     * ブロックの占有領域のダイレクトビューに対してコールバックを実行します。
     *
     * ビューは Balloc の内部ストレージを共有し、コピーは行われません。
     * コールバックの実行中、ブロックは互換性のない操作から保護されます。
     *
     * コールバックは同期でなければなりません。受け取ったビューを、コールバックの終了後に
     * 格納、返却、または使用してはなりません。この制限は、元のビューから派生した
     * サブビューにも適用されます。
     *
     * @param {number} handler - ブロックのハンドル。
     * @param {...(number|Function)} args - 1つ以上のブロックハンドルと、その後に続くコールバック。
     * @returns {*} コールバックによって生成された戻り値。
     * @throws {TypeError} ハンドルが指定されていない場合、またはコールバックが関数ではない場合。
     * @throws {Error} いずれかのハンドルが無効、重複、または借用中の場合。
     */
    withView(...args) {
        if (args.length < 2) throw new TypeError("At least one handler and one callback are required");
        const lastIndex = args.length - 1;
        const callback = args[lastIndex];
        if (typeof callback !== "function") throw new TypeError("callback must be a function");

        const lookup = Object.create(null);
        const views = [];

        try {
            for(let i = 0; i < lastIndex; i++) {
                const metadata = this.extractMetadata(args[i], {});

                
                if (Object.hasOwn(lookup, metadata.headerAddress)) throw new Error("Duplicate handler");
                if (metadata.borrowed) throw new Error("Block is already borrowed"); 
                
                this.controlBus[metadata.headerAddress + FLAGS_OFFSET] |= VIEW_LOCK;

                const rawAddress = metadata.dataAddress >>> this.wordShift;
                lookup[metadata.headerAddress] = metadata.headerAddress;     
                views.push(this.auxiliary.subarray(rawAddress, rawAddress + metadata.occupied))
            }
            return callback(...views);
        } finally {
            for (const key in lookup) {
                this.controlBus[lookup[key] + FLAGS_OFFSET] &= ~VIEW_LOCK;
            }
        }
    }

    // ======== スロット単位の容量 (CAPACITY IN SLOTS) ==========

    /**
     * ブロックの物理的容量をバイト単位で返します。
     *
     * 容量は、現在占有されている要素数に関係なく、ブロックのすべてのスロット用に
     * 予約されたスペースに対応します。
     *
     * @param {number} handler - ブロックのハンドル。
     * @returns {number} ブロックの物理的容量（バイト単位）。
     * @throws {Error} ハンドルが無効または破損している場合。
     */
    byteSize(handler) {
        const meta = this.extractMetadata(handler, this.metadata);
        return meta.byteCapacity;
    }

    /**
     * ブロック内で現在占有されている要素の数を返します。
     *
     * @param {number} handler - ブロックのハンドル。
     * @returns {number} 占有されている要素数。
     * @throws {Error} ハンドルが無効または破損している場合。
     */
    occupied(handler) {
        const meta = this.extractMetadata(handler, this.metadata);
        return meta.occupied;

    }

    /**
     * 要素数におけるブロックの容量を返します。
     *
     * この値は、現在占有されている数量ではなく、物理的に予約されたスロットの総数に対応します。
     *
     * @param {number} handler - ブロックのハンドル。
     * @returns {number} ブロック内で利用可能なスロットの総数。
     * @throws {Error} ハンドルが無効または破損している場合。
     */
    length(handler) {
        const meta = this.extractMetadata(handler, this.metadata);
        return 1 << meta.capacityExponent >>> 0;
    }

    /**
     * メモリブロックが割り当て容量に達しているかどうかを確認します。
     *
     * 占有されている要素数が割り当てられた総容量に等しく、新しい要素を格納する
     * 利用可能な位置が残っていない場合、ブロックは一杯とみなされます。
     *
     * @param {number} handler - ブロックのハンドル。
     * @returns {boolean} ブロックが一杯の場合は `true`、それ以外の場合は `false`。
     * @throws {Error} ハンドルが無効または破損している場合。
     */
    isFull(handler) {
        const meta = this.extractMetadata(handler, this.metadata);
        return (1 << meta.capacityExponent >>> 0) - meta.occupied === 0;
    }

    // ========== ブロック間の操作 (Operations between blocks)=============

    /**
    * あるブロックから別のブロックへ占有要素をコピーします。
    *
    * コピーは `source` の最初の要素と `destination` の最初のスロットから開始されます。
    * 実際にコピーされる量は、ソース内の占有要素数、宛先の物理的容量、および
    * `slots` で指定された制限によって制限されます。
    *
    * 必要に応じて、コピーされた要素をカバーするように宛先の占有数が引き上げられます。
    * 宛先の容量は変更されません。
    *
    * この操作では `dataBus` に対して `Uint8Array.prototype.copyWithin()` を使用するため、
    * 戻り値はデータバスを表す `Uint8Array` 自体になります。
    *
    * @param {number} source - コピー元ブロックのハンドル。
    * @param {number} destination - コピー先ブロックのハンドル。
    * @param {number} [slots=UNKNOWN] - コピーする最大要素数。
    * `UNKNOWN` は、追加の制限を課さないために使用されるセンチネル値を表します。
    * @returns {Uint8Array} 操作後の `dataBus`。
    * @throws {Error} ハンドルが無効、破損している場合、
    * またはコピー先ブロックが withView() によって借用されている場合。
    */
    copy(source, destination, slots = UNKNOWN) {
        /** @type {Metadata} */
        const metaA = {};
        /** @type {Metadata} */
        const metaB = {};

        this.extractMetadata(source, metaA);
        this.extractMetadata(destination, metaB);
        this.assertNotBorrowed(metaB.headerAddress);

        const maxSlotsDest = Math.floor(metaB.byteCapacity / this.wordSize);
        const slotsToCopy = Math.min(metaA.occupied, maxSlotsDest, slots);
        const newOccupied = Math.max(metaB.occupied, slotsToCopy);

        this.controlAdapter.setUint32(metaB.headerAddress + OCCUPIED_OFFSET, newOccupied, IS_LITTLE_ENDIAN);
        return this.dataBus.copyWithin(metaB.dataAddress, metaA.dataAddress, metaA.dataAddress + slotsToCopy * this.wordSize);
    }

    /**
     * ブロック内の要素の領域をブロック自身の中でコピーします。
     *
     * インデックスは0ベースであり、`Array.prototype.copyWithin()` のセマンティクスに従います：
     * `target` は宛先位置を特定し、`start` はソースの開始位置を特定し、
     * `length` はコピーする最大要素数を特定します。
     *
     * 負のインデックスはブロックの容量の末尾から解釈されます。この正規化の後、インデックスは
     * 物理的容量にクランプされます。コピーされる量も、実際に占有されている要素と
     * `target` から利用可能なスペースによって制限されます。
     *
     * この操作は重複する領域をサポートしており、宛先の範囲が以前の占有数を超える場合に
     * ブロックの占有数を増やすことができます。
     *
     * @param {number} handler - ブロックのハンドル。
     * @param {number} target - 宛先の開始インデックス。
     * @param {number} start - ソースの開始インデックス。
     * @param {number} length - コピーする最大要素数。
     * @returns {Uint8Array} 操作後の `dataBus`。
     * @throws {Error} ハンドルが無効、破損している場合、またはブロックが withView() によって借用されている場合。
     */
    copyWithin(handler, target, start, length) {
        const meta = this.extractMetadata(handler, this.metadata);
        this.assertNotBorrowed(meta.headerAddress);

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
     * `source` の占有要素を `target` の末尾に追加します。
     *
     * コピーされる量は、ソース内の占有要素数と、宛先の容量に残っている空きスペースによって制限されます。
     *
     * この操作は、`target` と `source` が同じブロックを参照することをサポートしています。
     * その場合、コピーはブロック自身の領域上で実行され、`copyWithin()` の重複セマンティクスを保持します。
     *
     * @param {number} target - 要素を受け取るブロックのハンドル。
     * @param {number} source - 要素が追加される元となるブロックのハンドル。
     * @returns {number} 実際に追加された要素数。
     * @throws {Error} ハンドルが無効、破損している場合、
     * またはコピー先ブロックが withView() によって借用されている場合。
     */
    append(target, source) {
        const metaTarget = {};
        const metaSource = {};

        this.extractMetadata(target, metaTarget);
        this.extractMetadata(source, metaSource);
        this.assertNotBorrowed(metaTarget.headerAddress);

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
     * ブロックの独立したコピーを作成します。
     *
     * 新しいブロックは、元のブロックと同じ物理的容量と占有数を持ちます。
     * 現在占有されていない位置を含む、予約された領域内のすべてのバイトがコピーされます。
     *
     * 新しいブロックには新しいハンドルが割り当てられ、通常の割り当ておよび
     * 再利用のルールの対象となり続けます。
     *
     * @param {number} handler - クローンを作成するブロックのハンドル。
     * @returns {number} 新しいブロックのハンドル。
     * @throws {Error} ハンドルが無効または破損している場合。
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
     * 2つのブロックに関連付けられたデータ領域をスワップ（交換）します。
     *
     * この操作は、ヘッダー間で領域のアドレス、容量、および占有数を交換します。
     * ハンドルは変更されません：操作後も、各ハンドルは自身のヘッダーを識別し続けますが、
     * そのヘッダーは以前もう一方のブロックに属していた領域を記述するようになります。
     *
     * `dataBus` 内のデータは一切コピーされず、2つのヘッダーのメタデータのみが変更されます。
     *
     * @param {number} source - 1つ目のブロックのハンドル。
     * @param {number} target - 2つ目のブロックのハンドル。
     * @returns {void}
     * @throws {Error} ハンドルが無効、破損している場合、
     * またはいずれかのブロックが withView() によって借用されている場合。
     */
    swap(source, target) {
        /** @type {Metadata} */
        const metaA = {};
        /** @type {Metadata} */
        const metaB = {};

        this.extractMetadata(source, metaA);
        this.extractMetadata(target, metaB);

        this.assertNotBorrowed(metaA.headerAddress);
        this.assertNotBorrowed(metaB.headerAddress);

        this.controlAdapter.setUint32(metaA.headerAddress + ADDRESS_OFFSET, metaB.dataAddress, IS_LITTLE_ENDIAN);
        this.controlAdapter.setUint32(metaB.headerAddress + ADDRESS_OFFSET, metaA.dataAddress, IS_LITTLE_ENDIAN);

        this.controlAdapter.setUint8(metaA.headerAddress + CAPACITY_OFFSET, metaB.capacityExponent);
        this.controlAdapter.setUint8(metaB.headerAddress + CAPACITY_OFFSET, metaA.capacityExponent);

        this.controlAdapter.setUint32(metaA.headerAddress + OCCUPIED_OFFSET, metaB.occupied, IS_LITTLE_ENDIAN);
        this.controlAdapter.setUint32(metaB.headerAddress + OCCUPIED_OFFSET, metaA.occupied, IS_LITTLE_ENDIAN);
    }


    // ============= シリアライズ (SERIALIZATION) ==============

    /**
     * メモリブロックのコンテンツとメタデータをシリアライズします。
     *
     * このメソッドは `pick()` を介してブロックの占有データを抽出し、
     * 容量およびワード型の情報とともにデータエンベロープにグループ化し、
     * CBORフォーマットを使用してエンコードします。
     *
     * @param {number} handler - シリアライズするブロックのハンドル。
     * @returns {Uint8Array} ブロックのシリアライズされたデータを格納するバッファ。
     * @throws {Error} ハンドルが無効または破損している場合。
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
     * シリアライズされたデータからメモリブロックを復元します。
     *
     * CBORエンベロープをデコードし、シリアライズされたデータのワード型が
     * 現在のアロケータインスタンスと互換性があるかどうかを検証し、
     * コンテンツを格納するために必要な容量を持つ新しいブロックを割り当てます。
     * その後、元のデータと占有数が新しいブロックに復元されます。
     *
     * @param {Uint8Array|ArrayBuffer} serialized - シリアライズされたデータを格納するバッファ。
     * @returns {number} 再作成された新しいブロックのハンドル。
     * @throws {Error} デコードされたデータのワード型がアロケータの設定と異なる場合。
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

    // ============= ユーティリティ (UTILITIES) ==============

    /**
     * 借用中のブロックに対する変更操作を禁止します。
     *
     * 指定されたアドレスに関連付けられたヘッダー内の VIEW_LOCK フラグを確認します。
     *
     * @param {number} headerAddress - controlBus 内のヘッダーのアドレス。
     * @returns {void}
     * @throws {Error} ブロックが withView() によって借用されている場合。
     * @private
     */
    assertNotBorrowed(headerAddress) {
        if (this.controlBus[headerAddress + FLAGS_OFFSET] & VIEW_LOCK) {
            throw new Error("Block is borrowed");
        }
    }

    /**
     * いずれかのセグメントが借用されている間、dataBus を置き換える
     * または再マッピングする操作を禁止します。
     *
     * @returns {void}
     * @throws {Error} withView() によって借用されているブロックが存在する場合。
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
     * [内部利用]
     * ハンドルに関連付けられたメタデータをデコードします。
     *
     * ハンドルは世代とヘッダーアドレスに分割されます。次に、ヘッダーに格納されているクッキーが
     * 再計算されて組み合わせが検証され、この検証が成功した後にのみメタデータが読み取られます。
     *
     * デコードされたフィールドは `out` オブジェクトに書き込まれ、この関数自身によって返されます。
     * 新しい割り当てを回避するために、このオブジェクトは呼び出し間で再利用できます。
     *
     * @param {number} handler - デコードおよび検証するハンドル。
     * @param {Metadata} out - デコードされたメタデータを受け取るオブジェクト。
     * @returns {Metadata} `out` で提供されたものと同じ参照。
     * @throws {Error} ヘッダーのクッキーがハンドルと一致しない場合、
     * またはハンドルが有効なヘッダーを特定できない場合。
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
     * [内部利用]
     * ヘッダーの検証用クッキーを計算します。
     *
     * クッキーは、高速ハッシュ（fast hash）を使用してヘッダーアドレスと
     * 11個の世代ビットから導出されます。
     * 結果は8ビットに縮小されます。
     *
     * 値ゼロは無効なヘッダーインジケータとして予約されているため、
     * 計算結果がゼロになった場合、このメソッドは `1` を返します。
     *
     * クッキーは暗号化メカニズムを構成するものではありません。その目的は、
     * アロケータのメモリ管理モデル内において、無効、失効（stale）、または
     * 破損したハンドルを検出することです。
     *
     * @param {number} addr - ヘッダーのアドレス。
     * @param {number} gen - ハンドルに関連付けられた世代。下位11ビットのみが考慮されます。
     * @returns {number} [1, 255] の範囲の8ビットクッキー。
     * @private
     */
    bakeCookie(addr, gen) {
        return (addr ^ (gen & 0x7FF * 0x9e3779b1)) & 0xff || 1;
    }

    /**
     * 再利用リストに現在格納されている領域の数を返します。
     *
     * 各領域は、`dataBus` のトップに直接戻すことができなかった解放済みブロックに
     * 対応しており、将来の同一容量の割り当てによる再利用のために利用可能な状態を維持します。
     *
     * @returns {number} `recycle` に保持されている空き領域の数。
     */
    recycleCount() {
        let count = 0;

        for (const [, page] of this.recycle) {
            count += page[0];
        }

        return count;
    }

    /**
     * 再利用リストに現在格納されている領域に属するバイトの総数を返します。
     *
     * この値は、各空き領域の容量に、その容量に対して登録されている領域の数を
     * 乗算したものを合計して計算されます。
     *
     * @returns {number} 再利用可能な領域によって占有されているバイト数。
     */
    get recycleBytes() {
        let total = 0;

        for (const [capacity, page] of this.recycle) {
            total += page[0] * capacity;
        }

        return total;
    }

    /**
     * 現在再利用可能ではない領域に属する、割り当てられたバイト数を返します。
     *
     * この値は、`dataPointer` の総進捗から、`recycle` に保持されている空き領域に
     * 属するバイトを減算して取得されます。
     *
     * @returns {number} `dataBus` によってすでに使用されている領域内における、
     * 再利用不可領域に関連付けられたバイト数。
     */
    get allocatedBytes() {
        return this.dataPointer - this.recycleBytes;
    }

    /**
     * `dataBus` のトップでまだ使用されていないバイト数を返します。
     *
     * このスペースは、`dataPointer` と、バッファ用に現在予約されている容量の
     * 終端の間の領域に対応します。
     *
     * @returns {number} `dataPointer` の後に利用可能なバイト数。
     */
    get unallocatedBytes() {
        return this.size - this.dataPointer;
    }

    /**
     * 再利用可能なメモリと使用済みヒープ領域の比率を返します。
     *
     * この指標は、`recycle` に保持されている空き領域を断片化とみな軸とし、
     * `dataPointer` を分母として使用します。ヒープによってバイトが使用されていない場合、
     * 結果はゼロになります。
     *
     * この値は `dataBus` の全容量の割合を表すものではなく、バンプポインタによって
     * すでに走査された領域内における再利用可能なバイトの比率を具体的に表します。
     *
     * @returns {number} 通常の稼働条件下における [0, 1] の範囲の断片化率。
     */
    get fragmentationRatio() {
        if (this.dataPointer === 0) return 0;
        return this.recycleBytes / this.dataPointer;
    }

}