import { encode, decode } from 'cbor-x';

/**
 * Flag indicating an invalid or unknown value.
 */
const UNKNOWN = 0xFFFFFFFF >>> 0;

/**
 * Valid bucket sizes and types.
 * Only 8, 16, 32, and 64-bit sizes are supported for integer types, and
 * only 16, 32, and 64-bit sizes are supported for floats.
 * Supported data types:
 * u = unsigned integer
 * i = signed integer
 * f = float
 * 
 * Bucket identifier syntax:
 * 
 * [Size in bits][Data type]
 * 
 * Examples:
 * A 32-bit unsigned integer bucket: 32u
 * A 64-bit signed integer bucket: 64i
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
 * Bucket types supported by the allocator:
 * - Unsigned integers: '8u', '16u', '32u', '64u'
 * - Signed integers: '8i', '16i', '32i', '64i'
 * - Floating-point: '16f', '32f', '64f'
 *
 * @typedef {'8u'|'16u'|'32u'|'64u'|'8i'|'16i'|'32i'|'64i'|'16f'|'32f'|'64f'} BucketType
 */

/**
 * System endianness flag.
 *
 * Detects whether the system is Little Endian, which affects
 * byte order in DataView operations.
 */
const IS_LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;


/**
 * Metadata format.
 *  0               4                8               9             10              
 *  [32bits address][32bits occupied][8bits capacity][8bits cookie][48bits reserved]
 * 
 * Total: 4 + 4 + 1 + 1 + 6 = 16 bytes
 */
const HEADER_SIZE = 16 >>> 0;

const ADDRESS_OFFSET  = 0 >>> 0;
const OCCUPIED_OFFSET = 4 >>> 0;
const CAPACITY_OFFSET = 8 >>> 0;
const COOKIE_OFFSET   = 9 >>> 0;


const ROTATE_32BITS = 4294967296;
const CLAMP_11BITS = 0x7FF >>> 0;

/**
 * Structure containing metadata encoded within a handle.
 * 
 * @typedef {Object} Metadata
 * @property {number} byteCapacity - The capacity of the memory block in bytes.
 * @property {number} capacityExponent - The capacity of the memory block expressed as a base-two exponent.
 * @property {number} dataAddress - Address of the memory block within the dataBus.
 * @property {number} generation - Generation to which the handle belongs.
 * @property {number} headerAddress - Address of the header within the controlBus.
 * @property {number} occupied - Number of occupied elements in the block.
 */

/**
 * Checks if a value is an instance of a TypedArray.
 * 
 * @param {any} val - Value to test.
 * @returns {boolean} `true` if the value is a TypedArray, otherwise `false`.
 */
const isTypedArray = (val) => ArrayBuffer.isView(val) && !(val instanceof DataView);

/**
 * Echo Stack Dual Bus Bump Allocator with ReBump GC.
 */
export default class Balloc {

    /**
     * Creates an instance of the `Balloc` memory allocator.
     *
     * The allocator maintains two independent buffers:
     * - `dataBus`: stores the data of allocated blocks;
     * - `controlBus`: stores headers and other control metadata.
     *
     * Each block has a fixed-size header (`HEADER_SIZE`) and is externally
     * identified by a 43-bit logical handle, composed of an 11-bit generation
     * and a 32-bit header address.
     *
     * The capacity of each block is rounded up to the next power of two
     * in elements, respecting the configured bucket width.
     *
     * @param {number} [size=65535] - Initial capacity of the `dataBus`, in bytes.
     * Must be a safe integer in the range [2, 0x80000000].
     * @param {BucketType} [bucketSize="32u"] - Bucket type and size identifier
     * (e.g., '32u' for Uint32, '64f' for Float64, '8i' for Int8).
     * @param {number} [metadataSize=1024] - Initial capacity of the `controlBus`,
     * in bytes. Must be a safe integer in the range
     * [HEADER_SIZE, 0x80000000].
     *
     * @throws {RangeError} If `size` is out of the allowed range.
     * @throws {RangeError} If `bucketSize` is not a valid bucket identifier.
     * @throws {RangeError} If `metadataSize` is out of the allowed range.
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
     * Allocates a new memory block.
     *
     * The requested capacity is converted to the smallest power of two that
     * accommodates `size` elements. The block is preferably obtained from the list
     * of recyclable regions with the corresponding capacity; if no compatible
     * region exists, the block is reserved at the top of the `dataBus`.
     *
     * Next, a header is obtained from the control space. Previously freed headers
     * can be reused via the internal recycling stack; otherwise, the `controlBus`
     * is expanded when necessary.
     *
     * The header receives the address, capacity, initial occupancy (zero), and
     * a validation cookie. The returned value encodes the allocation generation
     * and the header address:
     *
     *     [11 bits generation][32 bits header address]
     *
     * @param {number} [size=16] - Minimum number of elements the block must
     * accommodate. Must be a safe integer in the range [2, 0x80000000].
     * @returns {number} Handle identifying the allocated block.
     * @throws {RangeError} If `size` is out of the allowed range.
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
     * Expands a block's capacity to the next power of two.
     *
     * When the block is located at the current top of the `dataBus`, expansion
     * occurs in-place: only its capacity and `dataPointer` are updated.
     *
     * If another region exists after the block, a new region with double the
     * capacity is obtained from the recyclable space or allocated at the top of
     * the `dataBus`. Currently occupied elements are then copied to the new region,
     * and the previous region is returned to the recycling list.
     *
     * The handle remains valid because its header is preserved, and only the
     * address and capacity recorded within it are updated.
     *
     * @param {number} handler - Handle of the block to expand.
     * @returns {void}
     * @throws {Error} If the handle is invalid or corrupted.
     * @throws {AggregateError} If the capacity has reached its maximum
     * supported limit.
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
     * Frees a memory block.
     *
     * The block's header is invalidated by zeroing its cookie, and its address
     * is registered for later reuse. The data region is also returned to the
     * recycling system, except when the block is exactly at the top of the
     * `dataBus`; in that case, `dataPointer` is simply rolled back, eliminating
     * the region without creating an entry in the recycling list.
     *
     * @param {number} handler - Handle of the block to free.
     * @returns {void}
     * @throws {Error} If the handle is invalid or corrupted.
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
     * [INTERNAL USE]
     * Inserts a free region into the recycling list.
     *
     * The list is organized by capacity in bytes. For each capacity, the
     * stored value is a `Uint32Array` whose zero position contains the number
     * of registered addresses, and subsequent positions contain the addresses
     * of the free regions:
     *
     *     [count, address1, address2, ...]
     *
     * When the page becomes full, its buffer is expanded to double the current
     * capacity.
     *
     * @param {number} capacity - Capacity of the free region, in bytes.
     * @param {number} address - Initial address of the region in the `dataBus`.
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
     * [INTERNAL USE]
     * Removes a free region from the recycling list.
     *
     * The search is performed by the exact requested capacity. When a corresponding
     * page exists, the last registered address is removed from the page and returned,
     * implementing recycling as a LIFO stack.
     *
     * @param {number} capacity - Desired capacity, in bytes.
     * @returns {number} Initial address of a recyclable region or `UNKNOWN`
     * when no region exists with the requested capacity.
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
     * Compacts the `dataBus` using the ReBump algorithm.
     *
     * Sequentially traverses the headers registered in the `controlBus` and copies
     * still-valid regions to a new `dataBus`, eliminating free spaces between them.
     * The address of each surviving block is updated in its respective header.
     *
     * The order of blocks in the `controlBus` is preserved. Internal data of each
     * block is also fully preserved, including its reserved capacity and current
     * occupancy.
     *
     * At the end of compaction:
     * - all recyclable regions are eliminated;
     * - `dataPointer` points to the first byte after the last live block;
     * - `dataBus` represents a contiguous heap for active blocks.
     *
     * Control complexity is O(n), where `n` is the number of headers traversed.
     * The effective cost of memory movement also depends on the volume of bytes
     * belonging to live blocks.
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
     * [!!! INTERNAL USE, DO NOT USE IN YOUR CODE !!!]
     * Expands the `dataBus` to double its current capacity.
     *
     * The underlying buffer is transferred to a larger `ArrayBuffer`, preserving
     * existing data. All views associated with the buffer are recreated to reference
     * the new storage.
     *
     * @returns {void}
     * @throws {RangeError} If the `dataBus` capacity has exceeded the maximum
     * supported limit.
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
     * [!!! INTERNAL USE, DO NOT USE IN YOUR CODE !!!]
     * Expands the `controlBus` to double its current capacity.
     *
     * The underlying buffer is transferred to a larger `ArrayBuffer`, preserving
     * existing headers. The `controlAdapter` is recreated to reference the new
     * storage.
     *
     * @returns {void}
     * @throws {RangeError} If the current `controlBus` capacity has exceeded
     * the maximum supported limit.
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
     * Appends an element to the end of the block's occupied sequence.
     *
     * The element is written at the first free position after the last occupied
     * element. Block occupancy is incremented only when space is available within
     * its capacity.
     *
     * @param {number} handler - Block handle.
     * @param {number} value - Value to insert.
     * @returns {boolean} `true` if the value was inserted; `false` if the block
     * has no available space.
     * @throws {Error} If the handle is invalid or corrupted.
     */
    push(handler, value) {

        const meta = this.extractMetadata(handler, this.metadata);

        if ((meta.occupied + 1) * this.wordSize > meta.byteCapacity) return false;

        this.writer(meta.dataAddress + meta.occupied * this.wordSize , value, IS_LITTLE_ENDIAN);
        this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, meta.occupied + 1,IS_LITTLE_ENDIAN);

        return true;
    }

    /**
     * Removes and returns the last occupied element from the block.
     *
     * Occupancy is decremented before reading the removed element. Corresponding
     * bytes are not cleared and remain in the allocated region, but cease to be
     * part of the occupied sequence.
     *
     * @param {number} handler - Block handle.
     * @returns {number|undefined} Removed value or `undefined` if the block
     * is empty.
     * @throws {Error} If the handle is invalid or corrupted.
     */
    pop(handler) {
        const meta = this.extractMetadata(handler, this.metadata);

        if (meta.occupied === 0) return undefined;

        this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, meta.occupied - 1,IS_LITTLE_ENDIAN);
        return this.reader(meta.dataAddress + (meta.occupied - 1) * this.wordSize, IS_LITTLE_ENDIAN);
    }

    /**
     * Returns the last occupied element without removing it.
     *
     * @param {number} handler - Block handle.
     * @returns {number|undefined} Last occupied value or `undefined` if the
     * block is empty.
     * @throws {Error} If the handle is invalid or corrupted.
     */
    peek(handler) {
        const meta = this.extractMetadata(handler, this.metadata);

        if (meta.occupied === 0) return undefined;

        return this.reader(meta.dataAddress + (meta.occupied - 1) * this.wordSize, IS_LITTLE_ENDIAN);
    }

    // ========== QUEUE OPERATIONS ==========

    /**
     * Inserts an element at the beginning of the occupied sequence.
     *
     * Currently occupied elements are shifted one position forward and `value`
     * is written to the first position. The operation requires a free position
     * within the block's capacity.
     *
     * The operation's cost is proportional to the number of occupied elements,
     * as data needs to be shifted.
     *
     * @param {number} handler - Block handle.
     * @param {number} value - Value to insert.
     * @returns {boolean} `true` if the value was inserted; `false` if the block
     * is full.
     * @throws {Error} If the handle is invalid or corrupted.
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
     * Removes and returns the first occupied element from the block.
     *
     * Remaining elements are shifted one position toward the beginning of the
     * occupied region. The block's physical capacity remains unchanged.
     *
     * The operation's cost is proportional to the number of shifted elements.
     *
     * @param {number} handler - Block handle.
     * @returns {number|undefined} First removed value or `undefined` if the
     * block is empty.
     * @throws {Error} If the handle is invalid or corrupted.
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
     * Returns the first occupied element without removing it.
     *
     * @param {number} handler - Block handle.
     * @returns {number|undefined} First occupied value or `undefined` if the
     * block is empty.
     * @throws {Error} If the handle is invalid or corrupted.
     */
    head(handler) {
        const meta = this.extractMetadata(handler, this.metadata);

        if (meta.occupied === 0) return undefined;

        return this.reader(meta.dataAddress, IS_LITTLE_ENDIAN);    
    }

    // ========== RANDOM ACCESS ==========

    /**
     * Checks if a value is present among the block's occupied elements.
     *
     * The search is performed directly on the auxiliary `TypedArray` and considers
     * only the currently occupied range, not the entire reserved physical capacity.
     *
     * @param {number} handler - Block handle.
     * @param {number} value - Value to search for.
     * @returns {boolean} `true` if `value` is present among the occupied elements;
     * otherwise, `false`.
     * @throws {Error} If the handle is invalid or corrupted.
     */
    has(handler, value) {
        const meta = this.extractMetadata(handler, this.metadata);

        if (meta.occupied === 0) return false;

        const rawAddres = meta.dataAddress >>> this.wordShift;

        return this.auxiliary.subarray(rawAddres, rawAddres + meta.occupied).includes(value);
    }

     /**
     * Returns the occupied element at a zero-based index.
     *
     * Indices outside the range `[0, occupied)` are not considered an error and
     * result in `undefined`.
     *
     * @param {number} handler - Block handle.
     * @param {number} index - Zero-based index of the element.
     * @returns {number|undefined} Value stored at the index or `undefined` if
     * the index is outside the occupied region.
     * @throws {Error} If the handle is invalid or corrupted.
     */
    get(handler, index) {

        const meta = this.extractMetadata(handler, this.metadata);

        if (index < 0 || index >= meta.occupied) return undefined;

        return this.reader(meta.dataAddress + index * this.wordSize, IS_LITTLE_ENDIAN);
    }

    /**
     * Replaces the value stored at an occupied index.
     *
     * The operation does not alter block occupancy. Indices outside the range
     * `[0, occupied)` are ignored and result in `false`.
     *
     * @param {number} handler - Block handle.
     * @param {number} index - Zero-based index of the element.
     * @param {number} value - New value.
     * @returns {boolean} `true` if the value was written; `false` if the index
     * is outside the occupied region.
     * @throws {Error} If the handle is invalid or corrupted.
     */
    set(handler, index, value) {
        const meta = this.extractMetadata(handler, this.metadata);

        if (index < 0 || index >= meta.occupied) return false;

        this.writer(meta.dataAddress + index * this.wordSize, value, IS_LITTLE_ENDIAN);
        return true;
    }

    // ============= MISCELLANEOUS ===============

    /**
     * Clears block occupancy and fills its entire physical capacity with a single value.
     *
     * Filling covers all available slots, not just currently occupied elements.
     * After the operation, the block is considered empty regardless of the value
     * used for filling.
     *
     * @param {number} handler - Block handle.
     * @param {number} [value=0] - Value used to fill all slots.
     * @returns {void}
     * @throws {Error} If the handle is invalid or corrupted.
     */
    clear(handler, value=0) {
        const meta = this.extractMetadata(handler, this.metadata);

        const slots = meta.byteCapacity / this.wordSize;
        const rawAddress = meta.dataAddress >>> this.wordShift;

        this.auxiliary.fill(value, rawAddress, rawAddress + slots);        
        this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, 0, IS_LITTLE_ENDIAN);
    }


    /**
     * Fills a range of block slots with a value.
     *
     * The range uses zero-based indices and follows the convention `[start, end)`,
     * meaning `start` is inclusive and `end` is exclusive. When `end` is not provided,
     * filling extends to the end of the block's physical capacity.
     *
     * Block occupancy becomes `end`, including when the filled range extends beyond
     * the previous occupancy.
     *
     * @param {number} handler - Block handle.
     * @param {number} value - Value used for filling.
     * @param {number} [start=0] - Initial index, inclusive.
     * @param {number|null} [end=null] - Final index, exclusive. When omitted or
     * `null`, uses the total block capacity.
     * @returns {void}
     * @throws {Error} If the handle is invalid or corrupted.
     * @throws {RangeError} If `start` or `end` is out of capacity bounds, or if
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
     * Fills all physical slots of the block with a value and marks the entire
     * capacity as occupied.
     *
     * Unlike `clear()`, the operation results in a fully occupied block.
     *
     * @param {number} handler - Block handle.
     * @param {number} value - Value used for filling.
     * @returns {void}
     * @throws {Error} If the handle is invalid or corrupted.
     */
    fillAll(handler, value) {
        const meta = this.extractMetadata(handler, this.metadata);
        
        const rawAddress = meta.dataAddress >>> this.wordShift;
        const capacityElements = meta.byteCapacity / this.wordSize;

        this.auxiliary.fill(value, rawAddress, rawAddress + capacityElements);
        this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, capacityElements, IS_LITTLE_ENDIAN);
    }

    /**
     * Copies elements from an `Array` or `TypedArray` to the beginning of the block.
     *
     * The copied quantity is limited by the block's capacity. Occupancy is updated
     * to the greater value between the previous occupancy and the quantity effectively
     * copied; therefore, a call to `put()` does not reduce existing occupancy when
     * receiving a smaller sequence.
     *
     * For `Array`, only the first fitting elements are copied. For `TypedArray`,
     * a source subarray is used without intermediate copying.
     *
     * @param {number} handler - Block handle.
     * @param {Array|TypedArray} data - Sequence of values to copy.
     * @returns {void}
     * @throws {Error} If the handle is invalid or corrupted.
     * @throws {TypeError} If `data` is neither an `Array` nor a `TypedArray`.
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
     * Returns a copy of the elements currently occupied by the block.
     *
     * The result is a `TypedArray` of the same type configured by `bucketSize`.
     * Unoccupied physical capacity is not included in the result.
     *
     * The operation does not directly expose internal storage: the method uses
     * `TypedArray.prototype.slice()`, producing a new view with independent storage.
     *
     * @param {number} handler - Block handle.
     * @returns {TypedArray} Copy of the elements occupied by the block. When the
     * block is empty, returns an empty `TypedArray` of the configured type.
     * @throws {Error} If the handle is invalid or corrupted.
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
     * Returns the physical capacity of the block in bytes.
     *
     * Capacity corresponds to the space reserved for all slots in the block,
     * regardless of how many elements are currently occupied.
     *
     * @param {number} handler - Block handle.
     * @returns {number} Physical capacity of the block, in bytes.
     * @throws {Error} If the handle is invalid or corrupted.
     */
    byteSize(handler) {
        const meta = this.extractMetadata(handler, this.metadata);
        return meta.byteCapacity;
    }

    /**
     * Returns the number of elements currently occupied in the block.
     *
     * @param {number} handler - Block handle.
     * @returns {number} Number of occupied elements.
     * @throws {Error} If the handle is invalid or corrupted.
     */
    occupied(handler){
        const meta = this.extractMetadata(handler, this.metadata);
        return meta.occupied;

    }

    /**
     * Returns the capacity of the block in number of elements.
     *
     * The value corresponds to the total quantity of physically reserved slots,
     * not the currently occupied quantity.
     *
     * @param {number} handler - Block handle.
     * @returns {number} Total number of slots available in the block.
     * @throws {Error} If the handle is invalid or corrupted.
     */
    length(handler) {
        const meta = this.extractMetadata(handler, this.metadata);
        return 1 << meta.capacityExponent >>> 0;
    }

    // ========== Inter-block Operations =============

    /**
     * Copies occupied elements from one block to another.
     *
     * Copying begins at the first element of `source` and the first slot of
     * `destiny`. The effectively copied quantity is limited by the number of occupied
     * elements in the source, the destination's physical capacity, and the limit
     * specified in `slots`.
     *
     * Destination occupancy is increased, when necessary, to cover the copied
     * elements. Destination capacity is not changed.
     *
     * The operation uses `Uint8Array.prototype.copyWithin()` on the `dataBus`,
     * therefore the return value is the `Uint8Array` representing the data bus.
     *
     * @param {number} source - Source block handle.
     * @param {number} destiny - Destination block handle.
     * @param {number} [slots=UNKNOWN] - Maximum number of elements to copy.
     * `UNKNOWN` represents the sentinel value used not to impose an additional limit.
     * @returns {Uint8Array} The `dataBus` after the operation.
     * @throws {Error} If `source` or `destiny` is invalid or corrupted.
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
     * Copies a region of elements within the same block.
     *
     * Indices are zero-based and follow the semantics of `Array.prototype.copyWithin()`:
     * `target` identifies the destination position, `start` the source starting
     * position, and `length` the maximum number of elements to copy.
     *
     * Negative indices are interpreted from the end of the block's capacity. After
     * this normalization, indices are clamped to physical capacity. The copied quantity
     * is also limited by effectively occupied elements and available space from `target`.
     *
     * The operation supports overlapping regions and can increase block occupancy
     * when the target range exceeds current occupancy.
     *
     * @param {number} handler - Block handle.
     * @param {number} target - Initial destination index.
     * @param {number} start - Initial source index.
     * @param {number} length - Maximum number of elements to copy.
     * @returns {Uint8Array} The `dataBus` after the operation.
     * @throws {Error} If the handle is invalid or corrupted.
     */
    copyWithin(handler, target, start, length) {
        const meta = this.extractMetadata(handler, this.metadata);
        const slots = Math.floor(meta.byteCapacity / this.wordSize);

        target = Math.trunc(target);
        start = Math.trunc(start);
        length = Math.trunc(length);

        if (target < 0) target += slots;
        if (start < 0) start += slots;

        // Clamps indices within capacity limits
        target = Math.max(0, Math.min(target, slots));
        start = Math.max(0, Math.min(start, slots));

        // Limits copying to available space starting from target 
        // and effectively occupied elements starting from start
        const maxRead = Math.max(0, meta.occupied - start);
        const maxWrite = slots - target;
        length = Math.max(0, Math.min(length, maxRead, maxWrite));

        if (length === 0) return this.dataBus;

        const targetAddress = meta.dataAddress + target * this.wordSize;
        const sourceAddress = meta.dataAddress + start * this.wordSize;

        // Updates occupancy if the copy expands the block's occupied top
        const newOccupied = Math.max(meta.occupied, target + length);
        this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, newOccupied, IS_LITTLE_ENDIAN);

        return this.dataBus.copyWithin(targetAddress, sourceAddress, sourceAddress + length * this.wordSize);
    }

    /**
     * Appends occupied elements of `source` to the end of `target`.
     *
     * The copied quantity is limited by the number of occupied elements in the
     * source and the remaining free space in the destination's capacity.
     *
     * The operation supports `target` and `source` referencing the same block.
     * In that case, the copy is performed on the block's own region and preserves
     * `copyWithin()` overlap semantics.
     *
     * @param {number} target - Handle of the block that will receive the elements.
     * @param {number} source - Handle of the block whose elements will be appended.
     * @returns {number} Number of elements effectively appended.
     * @throws {Error} If `target` or `source` is invalid or corrupted.
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
     * Creates an independent copy of a block.
     *
     * The new block has the same physical capacity and occupancy as the original block.
     * All bytes in the reserved region, including currently unoccupied positions,
     * are copied.
     *
     * The new block receives a new handle and remains subject to normal allocation
     * and recycling rules.
     *
     * @param {number} handler - Handle of the block to clone.
     * @returns {number} Handle of the new block.
     * @throws {Error} If the handle is invalid or corrupted.
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
     * Swaps the data regions associated with two blocks.
     *
     * The operation swaps region addresses, capacities, and occupancies between headers.
     * Handles remain unchanged: after the operation, each handle continues identifying
     * its own header, but that header now describes the region previously belonging
     * to the other block.
     *
     * No data is copied in the `dataBus`; only the metadata of the two headers
     * is modified.
     *
     * @param {number} source - Handle of the first block.
     * @param {number} target - Handle of the second block.
     * @returns {void}
     * @throws {Error} If `source` or `target` is invalid or corrupted.
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
     * Serializes the content and metadata of a memory block.
     *
     * The method extracts occupied data from the block via `pick()`, groups them
     * along with capacity and word type information into a data envelope, and encodes
     * them using the CBOR format.
     *
     * @param {number} handler - Handle of the block to serialize.
     * @returns {Uint8Array} A buffer containing the serialized block data.
     * @throws {Error} If the handle is invalid or corrupted.
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
     * Restores a memory block from serialized data.
     *
     * Decodes the CBOR envelope, validates whether the word type of the serialized
     * data is compatible with the current allocator instance, and allocates a new
     * block with the necessary capacity to accommodate the content. Then, the original
     * data and occupancy are restored in the new block.
     *
     * @param {Uint8Array|ArrayBuffer} serialized - Buffer containing serialized data.
     * @returns {number} Handle of the newly recreated block.
     * @throws {Error} If the decoded data's word type differs from the one configured in the allocator.
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
     * [INTERNAL USE]
     * Decodes the metadata associated with a handle.
     *
     * The handle is split into generation and header address. The cookie stored
     * in the header is then recalculated to validate the combination; only after
     * this validation is metadata read.
     *
     * Decoded fields are written to the `out` object, which is returned by the function
     * itself. The object can be reused across calls to avoid new allocations.
     *
     * @param {number} handler - Handle to decode and validate.
     * @param {Metadata} out - Object that will receive the decoded metadata.
     * @returns {Metadata} The same reference provided in `out`.
     * @throws {Error} If the header cookie does not match the handle or if the
     * handle does not identify a valid header.
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
     * [INTERNAL USE]
     * Calculates the validation cookie of a header.
     *
     * The cookie is derived from the header address and the 11-bit generation via
     * fast hash. The result is reduced to 8 bits.
     *
     * The value zero is reserved as an invalid header indicator; therefore, when
     * the calculation yields zero, the method returns `1`.
     *
     * The cookie is not a cryptographic mechanism. Its purpose is to detect invalid,
     * stale, or corrupted handles within the allocator's memory management model.
     *
     * @param {number} addr - Header address.
     * @param {number} gen - Generation associated with the handle. Only the 11 least
     * significant bits are considered.
     * @returns {number} 8-bit cookie in the range [1, 255].
     * @private
     */
    bakeCookie(addr, gen) {
        return (addr ^ (gen & 0x7FF * 0x9e3779b1)) & 0xff || 1;
    }

    /**
     * Returns the number of regions currently stored in the recycling list.
     *
     * Each region corresponds to a freed block that could not be returned directly
     * to the top of the `dataBus` and therefore remains available for reuse by a
     * future allocation of identical capacity.
     *
     * @returns {number} Number of free regions maintained in `recycle`.
     */
    recycleCount() {
        let count = 0;

        for (const [, page] of this.recycle) {
            count += page[0];
        }

        return count;
    }

    /**
     * Returns the total bytes belonging to regions currently stored in the recycling list.
     *
     * The value is calculated by summing the capacity of each free region multiplied
     * by the number of regions registered for that capacity.
     *
     * @returns {number} Number of bytes occupied by recyclable regions.
     */
    get recycleBytes() {
        let total = 0;

        for (const [capacity, page] of this.recycle) {
            total += page[0] * capacity;
        }

        return total;
    }

    /**
     * Returns the amount of allocated bytes that do not belong to currently recyclable regions.
     *
     * The value is obtained by subtracting the bytes belonging to free regions maintained
     * in `recycle` from the total advance of `dataPointer`.
     *
     * @returns {number} Number of bytes associated with non-recyclable regions within
     * the area already used by the `dataBus`.
     */
    get allocatedBytes() {
        return this.dataPointer - this.recycleBytes;
    }

    /**
     * Returns the amount of bytes not yet used at the top of the `dataBus`.
     *
     * This space corresponds to the region between `dataPointer` and the end of the
     * capacity currently reserved for the buffer.
     *
     * @returns {number} Number of available bytes after `dataPointer`.
     */
    get unallocatedBytes() {
        return this.size - this.dataPointer;
    }

    /**
     * Returns the ratio between recyclable memory and the used heap area.
     *
     * The metric considers free regions maintained in `recycle` as fragmentation
     * and uses `dataPointer` as the denominator. When no bytes have been used by the heap,
     * the result is zero.
     *
     * The value does not represent the fraction of the entire `dataBus` capacity,
     * but specifically the proportion of recyclable bytes within the area already
     * traversed by the bump pointer.
     *
     * @returns {number} Fragmentation ratio in the range [0, 1] under normal
     * operating conditions.
     */
    get fragmentationRatio() {
        if (this.dataPointer === 0) return 0;
        return this.recycleBytes / this.dataPointer;
    }

}