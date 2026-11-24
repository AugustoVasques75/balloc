export type BucketType = '8u' | '16u' | '32u' | '64u' | '8i' | '16i' | '32i' | '64i' | '16f' | '32f' | '64f';
export type Metadata = {
    /**
     * - The byte capacity of the memory block.
     */
    byteCapacity: number;
    /**
     * - The capacity of the memory block expressed as a base-two exponent.
     */
    capacityExponent: number;
    /**
     * - Address of the memory block within the dataBus.
     */
    dataAddress: number;
    /**
     * - Generation to which the handle belongs.
     */
    generation: number;
    /**
     * - Address of the header within the controlBus.
     */
    headerAddress: number;
    /**
     * - Number of occupied elements in the block.
     */
    occupied: number;
    /**
     * - Flag indicating whether the block has been borrowed by withView().
     */
    borrowed: number;
};
/**
 * Echo Stack Dual Bus Bump Allocator with ReBump GC.
 */
export default class Balloc {
    wordType: BucketType;
    bucketType: string;
    bucketSize: number;
    bucketArray: any;
    wordSize: number;
    wordShift: number;
    size: number;
    headerSize: number;
    dataPointer: number;
    controlPointer: number;
    echoPointer: number;
    generation: number;
    dataBus: Uint8Array<ArrayBuffer>;
    controlBus: Uint8Array<ArrayBuffer>;
    dataAdapter: DataView<ArrayBuffer>;
    controlAdapter: DataView<ArrayBuffer>;
    auxiliary: any;
    writer: any;
    reader: any;
    recycle: Map<any, any>;
    /** @type {Metadata} */
    metadata: Metadata;
    /**
     * Creates an instance of the `Balloc` memory allocator.
     *
     * The allocator maintains two independent buffers:
     * - `dataBus`: stores the data of allocated blocks;
     * - `controlBus`: stores headers and other control metadata.
     *
     * Each block has a fixed-size header (`HEADER_SIZE`) and is
     * identified externally by a 43-bit logical handle, composed
     * of an 11-bit generation and its 32-bit header address.
     *
     * The capacity of each block is rounded up to the next power of
     * two in elements, respecting the width of the configured bucket.
     *
     * @param {number} [size=65535] - Initial capacity of the `dataBus`, in bytes.
     * Must be a safe integer in the range [2, 0x80000000].
     * @param {BucketType} [bucketSize="32u"] - Identifier for the bucket type and size
     * (e.g., '32u' for Uint32, '64f' for Float64, '8i' for Int8).
     * @param {number} [metadataSize=1024] - Initial capacity of the `controlBus`,
     * in bytes. Must be a safe integer in the range
     * [HEADER_SIZE, 0x80000000].
     *
     * @throws {RangeError} If `size` is outside the allowed range.
     * @throws {RangeError} If `bucketSize` is not a valid bucket identifier.
     * @throws {RangeError} If `metadataSize` is outside the allowed range.
     */
    constructor(size?: number, bucketSize?: BucketType, metadataSize?: number);
    /**
     * Allocates a new memory block.
     *
     * The requested capacity is converted to the smallest power of two that
     * can accommodate `size` elements. The block is obtained preferentially from the list
     * of recyclable regions with the corresponding capacity; if a compatible
     * region does not exist, the block is reserved at the top of the `dataBus`.
     *
     * Next, a header is obtained from the control space. Previously freed headers
     * can be reused via the internal recycling stack;
     * otherwise, the `controlBus` is expanded when necessary.
     *
     * The header receives the address, capacity, initial occupancy (zero), and
     * a validation cookie. The returned value encodes the allocation generation
     * and the header address:
     *
     *     [11 generation bits][32 header address bits]
     *
     * @param {number} [size=16] - Minimum number of elements the block must
     * accommodate. Must be a safe integer in the range [2, 0x80000000].
     * @returns {number} Handle identifying the allocated block.
     * @throws {RangeError} If `size` is outside the allowed range.
     * @throws {Error} If it is necessary to expand the `dataBus` while any
     * block is borrowed via withView().
     */
    alloc(size?: number): number;
    /**
     * Expands a block's capacity to the next power of two.
     *
     * When the block is located at the current top of the `dataBus`, expansion
     * occurs in-place: only its capacity and `dataPointer` are
     * updated.
     *
     * If another region exists after the block, a new region with double the
     * capacity is obtained from the recyclable space or allocated at the top of the `dataBus`.
     * The currently occupied elements are then copied to the new region,
     * and the previous region is returned to the recycling list.
     *
     * The handle remains valid because its header is preserved and only the
     * address and capacity recorded in it are updated.
     *
     * @param {number} handler - Handle of the block to be expanded.
     * @returns {void}
     * @throws {Error} If the handle is invalid, corrupted, or the block
     * is borrowed via withView(). Also occurs if expansion requires
     * dataBus remapping while another block is borrowed.
     * @throws {AggregateError} If the capacity has reached the maximum
     * supported limit.
     */
    realloc(handler: number): void;
    /**
     * Reduces a block to the smallest power-of-two capacity that can contain
     * its occupied elements, while preserving its address and handler.
     *
     * If the block is at the top of the dataBus, dataPointer is moved backward.
     * Otherwise, the released tail is split into power-of-two regions and each
     * region is returned to the recycling list.
     *
     * @param {number} handler - Handler of the block to shrink.
     * @returns {void}
     * @throws {Error} If the handler is invalid, corrupted, or borrowed by withView().
     */
    shrink(handler: number): void;
    /**
    * Frees a memory block.
    *
    * The block's header is invalidated by zeroing its cookie, and its
    * address is registered for later reuse. The data region
    * is also returned to the recycling system, except when the block is
    * exactly at the top of the `dataBus`; in that case, the `dataPointer` is simply
    * rolled back, eliminating the region without creating an entry in the recycling
    * list.
    *
    * @param {number} handler - Handle of the block to be freed.
    * @returns {void}
    * @throws {Error} If the handle is invalid, corrupted, or the block
    * is borrowed via withView().
    */
    free(handler: number): void;
    /**
     * [INTERNAL USE]
     * Inserts a free region into the recycling list.
     *
     * The list is organized by capacity in bytes. For each capacity, the
     * stored value is a `Uint32Array` whose zero position contains the quantity
     * of registered addresses and subsequent positions contain the addresses of
     * the free regions:
     *
     *     [count, address1, address2, ...]
     *
     * When the page becomes full, its buffer is expanded to double its current
     * capacity.
     *
     * @param {number} capacity - Capacity of the free region, in bytes.
     * @param {number} address - Initial address of the region in the `dataBus`.
     * @returns {void}
     * @private
     */
    private recyclePush;
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
     * when a region with the requested capacity does not exist.
     * @private
     */
    private recyclePop;
    /**
     * Compacts the `dataBus` using the ReBump algorithm.
     *
     * Sequentially traverses the headers registered in the `controlBus` and copies
     * still-valid regions to a new `dataBus`, eliminating free spaces
     * between them. Each surviving block's address is updated in its
     * respective header.
     *
     * The order of blocks in the `controlBus` is preserved. The internal data of
     * each block is also fully preserved, including its reserved capacity
     * and current occupancy.
     *
     * Upon completion of compaction:
     * - all recyclable regions are eliminated;
     * - `dataPointer` points to the first byte after the last live block;
     * - the `dataBus` represents a contiguous heap for active blocks.
     *
     * Control complexity is O(n), where `n` is the number of traversed
     * headers. The effective memory movement cost also depends on the volume
     * of bytes belonging to live blocks.
     *
     * @returns {void}
     * @throws {Error} If any block is borrowed via withView().
     */
    gc(): void;
    /**
     * [!!! INTERNAL USE, DO NOT USE IN YOUR CODE !!!]
     * Expands the `dataBus` to double its current capacity.
     *
     * The underlying buffer is transferred to a larger `ArrayBuffer`, preserving
     * existing data. All views associated with the buffer are recreated
     * to reference the new storage.
     *
     * @returns {void}
     * @throws {Error} If any block is borrowed via withView().
     * @throws {RangeError} If the `dataBus` capacity has already exceeded the
     * maximum supported limit.
     * @private
     */
    private grow;
    /**
     * [!!! INTERNAL USE, DO NOT USE IN YOUR CODE !!!]
     * Expands the `controlBus` to double its current capacity.
     *
     * The underlying buffer is transferred to a larger `ArrayBuffer`, preserving
     * existing headers. The `controlAdapter` is recreated to reference
     * the new storage.
     *
     * @returns {void}
     * @throws {RangeError} If the current `controlBus` capacity has already
     * exceeded the maximum supported limit.
     * @private
     */
    private headerGrow;
    /**
     * Appends an element to the end of the sequence occupied by the block.
     *
     * The element is written at the first free position after the last occupied
     * element. Block occupancy is incremented only when space is available
     * within its capacity.
     *
     * @param {number} value - Value to be inserted.
     * @returns {boolean} `true` if the value was inserted; `false` if the block
     * is already out of available space.
     * @throws {Error} If the handle is invalid, corrupted, or the block is borrowed via withView().
     *
     */
    push(handler: any, value: number): boolean;
    /**
     * Removes the last occupied element from the block and returns it.
     *
     * Occupancy is decremented before reading the removed element. The corresponding
     * bytes are not cleared and remain in the allocated region, but cease to be
     * part of the occupied sequence.
     *
     * @param {number} handler - Block handle.
     * @returns {number|undefined} Removed value or `undefined` if the block
     * is empty.
     * @throws {Error} If the handle is invalid, corrupted, or the block is borrowed via withView().
     */
    pop(handler: number): number | undefined;
    /**
     * Returns the last occupied element without removing it.
     *
     * @param {number} handler - Block handle.
     * @returns {number|undefined} Last occupied value or `undefined` if the
     * block is empty.
     * @throws {Error} If the handle is invalid or corrupted.
     */
    peek(handler: number): number | undefined;
    /**
     * Inserts an element at the beginning of the occupied sequence.
     *
     * Currently occupied elements are shifted forward by one position and
     * `value` is written at the first position. The operation requires a free
     * position within the block's capacity.
     *
     * The operation cost is proportional to the number of occupied elements,
     * as data needs to be shifted.
     *
     * @param {number} handler - Block handle.
     * @param {number} value - Value to be inserted.
     * @returns {boolean} `true` if the value was inserted; `false` if the block
     * is full.
     * @throws {Error} If the handle is invalid, corrupted, or the block is borrowed via withView().
     */
    nudge(handler: number, value: number): boolean;
    /**
     * Removes the first occupied element from the block and returns it.
     *
     * Remaining elements are shifted one position toward the beginning
     * of the occupied region. The physical capacity of the block remains unchanged.
     *
     * The operation cost is proportional to the number of shifted elements.
     *
     * @param {number} handler - Block handle.
     * @returns {number|undefined} First removed value or `undefined` if the
     * block is empty.
     * @throws {Error} If the handle is invalid, corrupted, or the block is borrowed via withView().
     */
    pull(handler: number): number | undefined;
    /**
     * Returns the first occupied element without removing it.
     *
     * @param {number} handler - Block handle.
     * @returns {number|undefined} First occupied value or `undefined` if the
     * block is empty.
     * @throws {Error} If the handle is invalid or corrupted.
     */
    head(handler: number): number | undefined;
    /**
     * Checks if a value is present among the occupied elements of the block.
     *
     * The search is performed directly on the auxiliary `TypedArray` and considers
     * only the currently occupied range, not the entire reserved physical capacity.
     *
     * @param {number} handler - Block handle.
     * @param {number} value - Value to search for.
     * @returns {boolean} `true` if `value` is present among the occupied
     * elements; otherwise, `false`.
     * @throws {Error} If the handle is invalid or corrupted.
     */
    has(handler: number, value: number): boolean;
    /**
     * Locates the first occurrence of an element in the block's occupied sequence.
     *
     * The search is performed in ascending order of indices, using the `indexOf`
     * operation of the underlying TypedArray. The search exclusively considers
     * occupied elements, ignoring the block's unused capacity.
     *
     * The starting search position can be specified by `fromIndex`,
     * following TypedArray indexing rules.
     *
     * @param {number} handler - Block handle.
     * @param {number|bigint} searchElement - Element to locate.
     * @param {number} [fromIndex=0] - Index from which to start the search.
     * @returns {number} Index of the first occurrence or `-1` if the
     * element is not found or if the block is empty.
     * @throws {Error} If the handle is invalid or corrupted.
     */
    indexOf(handler: number, searchElement: number | bigint, fromIndex?: number): number;
    /**
     * Locates the last occurrence of an element in the block's occupied sequence.
     *
     * The search is performed in descending order of indices, using the `lastIndexOf`
     * operation of the underlying TypedArray. The search exclusively considers
     * occupied elements, ignoring the block's unused capacity.
     *
     * The starting search position can be specified by `fromIndex`,
     * following TypedArray indexing rules. By default, the search starts
     * at the last occupied element.
     *
     * @param {number} handler - Block handle.
     * @param {number|bigint} searchElement - Element to locate.
     * @param {number} [fromIndex=-1] - Index from which to start the search.
     * @returns {number} Index of the last occurrence or `-1` if the
     * element is not found or if the block is empty.
     * @throws {Error} If the handle is invalid or corrupted.
     */
    lastIndexOf(handler: number, searchElement: number | bigint, fromIndex?: number): number;
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
    get(handler: number, index: number): number | undefined;
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
     * @throws {Error} If the handle is invalid, corrupted, or the block is borrowed via withView().
     */
    set(handler: number, index: number, value: number): boolean;
    /**
     * Zeroes block occupancy and fills its entire physical capacity with
     * a single value.
     *
     * The fill covers all available slots, not just currently
     * occupied elements. After the operation, the block is considered
     * empty regardless of the value used for filling.
     *
     * @param {number} handler - Block handle.
     * @param {number} [value=0] - Value used to fill all slots.
     * @returns {void}
     * @throws {Error} If the handle is invalid, corrupted, or the block is borrowed via withView().
     */
    clear(handler: number, value?: number): void;
    /**
     * Fills a range of block slots with a value.
     *
     * The range uses zero-based indices and follows the convention
     * `[start, end)`, therefore `start` is inclusive and `end` is exclusive.
     * When `end` is not provided, filling extends to the end of the block's
     * physical capacity.
     *
     * Block occupancy becomes `end`, including when the filled range
     * extends beyond previous occupancy.
     *
     * @param {number} handler - Block handle.
     * @param {number} value - Value used for filling.
     * @param {number} [start=0] - Initial index, inclusive.
     * @param {number|null} [end=null] - Final index, exclusive. When
     * omitted or `null`, uses the block's total capacity.
     * @returns {void}
     * @throws {Error} If the handle is invalid, corrupted, or the block is borrowed via withView().
     * @throws {RangeError} If `start` or `end` is outside capacity limits,
     * or if `start > end`.
     */
    fill(handler: number, value: number, start?: number, end?: number | null): void;
    /**
     * Fills all physical slots of the block with a value and marks the entire
     * capacity as occupied.
     *
     * Unlike `clear()`, this operation results in a fully occupied block.
     *
     * @param {number} handler - Block handle.
     * @param {number} value - Value used for filling.
     * @returns {void}
     * @throws {Error} If the handle is invalid, corrupted, or the block is borrowed via withView().
     */
    fillAll(handler: number, value: number): void;
    /**
     * Copies elements from an `Array` or `TypedArray` to the beginning of the block.
     *
     * The copied quantity is limited by the block's capacity. Occupancy is
     * updated to the greater value between previous occupancy and the quantity
     * effectively copied; therefore, a call to `put()` does not reduce existing
     * occupancy when receiving a smaller sequence.
     *
     * For `Array`, only the first elements that fit are copied.
     * For `TypedArray`, a source subarray is used without intermediate copying.
     *
     * @param {number} handler - Block handle.
     * @param {Array|TypedArray} data - Sequence of values to copy.
     * @returns {void}
     * @throws {Error} If the handle is invalid, corrupted, or the block is borrowed via withView().
     * @throws {TypeError} If `data` is neither an `Array` nor a `TypedArray`.
     */
    put(handler: number, data: any[] | TypedArray): void;
    /**
    * Returns a copy of the elements currently occupied by the block.
    *
    * The result is a `TypedArray` of the same type configured by
    * `bucketSize`. Unoccupied physical capacity is not included in the result.
    *
    * The operation does not directly expose internal storage: the method
    * uses `TypedArray.prototype.slice()`, producing a new view with
    * independent storage.
    *
    * @param {number} handler - Block handle.
    * @returns {TypedArray} Copy of elements occupied by the block. When
    * the block is empty, returns an empty `TypedArray` of the configured type.
    * @throws {Error} If the handle is invalid or corrupted.
    */
    pick(handler: number): TypedArray;
    /**
     * Executes a callback over a direct view of the block's occupied region.
     *
     * The view shares Balloc's internal storage and performs no copying.
     * The block is protected against incompatible operations during the callback.
     *
     * The callback must be synchronous. The received view must not be stored,
     * returned, or used after the callback terminates. This restriction
     * also applies to subviews derived from the original view.
     *
     * @param {number} handler - Block handle.
     * @param {...(number|Function)} args - One or more block handles followed by the callback.
     * @returns {*} Return value produced by the callback.
     * @throws {TypeError} If no handle is provided or the callback is not a function.
     * @throws {Error} If a handle is invalid, duplicated, or already borrowed.
     */
    withView(...args: (number | Function)[]): any;
    /**
     * Returns the physical capacity of the block in bytes.
     *
     * Capacity corresponds to the space reserved for all slots in the
     * block, regardless of how many elements are currently occupied.
     *
     * @param {number} handler - Block handle.
     * @returns {number} Physical capacity of the block, in bytes.
     * @throws {Error} If the handle is invalid or corrupted.
     */
    byteSize(handler: number): number;
    /**
     * Returns the number of elements currently occupied in the block.
     *
     * @param {number} handler - Block handle.
     * @returns {number} Number of occupied elements.
     * @throws {Error} If the handle is invalid or corrupted.
     */
    occupied(handler: number): number;
    /**
     * Returns the block's capacity in number of elements.
     *
     * The value corresponds to the total number of physically reserved slots,
     * not the currently occupied quantity.
     *
     * @param {number} handler - Block handle.
     * @returns {number} Total number of slots available in the block.
     * @throws {Error} If the handle is invalid or corrupted.
     */
    length(handler: number): number;
    /**
     * Checks if the memory block has reached its allocation capacity.
     *
     * A block is considered full when the number of occupied elements
     * equals its total allocated capacity, leaving no positions available
     * to store new elements.
     *
     * @param {number} handler - Block handle.
     * @returns {boolean} `true` if the block is full; otherwise, `false`.
     * @throws {Error} If the handle is invalid or corrupted.
     */
    isFull(handler: number): boolean;
    /**
    * Copies occupied elements from one block to another.
    *
    * Copying starts at the first element of `source` and the first slot of
    * `destination`. The quantity effectively copied is limited by the number of
    * occupied elements in the source, the physical capacity of the destination, and the
    * limit specified in `slots`.
    *
    * Destination occupancy is increased, when necessary, to cover the
    * copied elements. Destination capacity is unchanged.
    *
    * The operation uses `Uint8Array.prototype.copyWithin()` on the `dataBus`,
    * therefore the return value is the `Uint8Array` representing the data bus.
    *
    * @param {number} source - Source block handle.
    * @param {number} destination - Destination block handle.
    * @param {number} [slots=UNKNOWN] - Maximum number of elements to copy.
    * `UNKNOWN` represents the sentinel value used not to impose an
    * additional limit.
    * @returns {Uint8Array} The `dataBus` after the operation.
    * @throws {Error} If handles are invalid, corrupted,
    * or the destination block is borrowed via withView().
    */
    copy(source: number, destination: number, slots?: number): Uint8Array;
    /**
     * Copies a region of elements within the same block.
     *
     * Indices are zero-based and follow the semantics of
     * `Array.prototype.copyWithin()`: `target` identifies the destination position,
     * `start` the starting source position, and `length` the maximum quantity of
     * elements to copy.
     *
     * Negative indices are interpreted from the end of the block's capacity.
     * After this normalization, indices are clamped to physical capacity.
     * The copied quantity is also limited by effectively occupied elements
     * and available space starting from `target`.
     *
     * The operation supports overlapping regions and can increase block occupancy
     * when the destination range exceeds previous occupancy.
     *
     * @param {number} handler - Block handle.
     * @param {number} target - Initial destination index.
     * @param {number} start - Initial source index.
     * @param {number} length - Maximum number of elements to copy.
     * @returns {Uint8Array} The `dataBus` after the operation.
     * @throws {Error} If the handle is invalid, corrupted, or the block is borrowed via withView().
     */
    copyWithin(handler: number, target: number, start: number, length: number): Uint8Array;
    /**
     * Appends occupied elements of `source` to the end of `target`.
     *
     * The copied quantity is limited by the number of occupied elements in the
     * source and remaining free space in the destination's capacity.
     *
     * The operation supports `target` and `source` referencing the same block.
     * In this case, copying is performed over the block's own region and
     * preserves `copyWithin()` overlap semantics.
     *
     * @param {number} target - Handle of the block that will receive elements.
     * @param {number} source - Handle of the block whose elements will be
     * appended.
     * @returns {number} Number of elements effectively appended.
     * @throws {Error} If handles are invalid, corrupted,
     * or the destination block is borrowed via withView().
     */
    append(target: number, source: number): number;
    /**
     * Creates an independent copy of a block.
     *
     * The new block has the same physical capacity and occupancy as the
     * original block. All bytes in the reserved region, including currently
     * unoccupied positions, are copied.
     *
     * The new block receives a new handle and remains subject to normal
     * allocation and recycling rules.
     *
     * @param {number} handler - Handle of the block to be cloned.
     * @returns {number} Handle of the new block.
     * @throws {Error} If the handle is invalid or corrupted.
     */
    clone(handler: number): number;
    /**
     * Swaps the data regions associated with two blocks.
     *
     * The operation swaps region addresses, capacities, and occupancies
     * between headers. Handles remain unchanged:
     * after the operation, each handle continues identifying its own
     * header, but that header now describes the region previously
     * belonging to the other block.
     *
     * No data is copied in the `dataBus`; only the metadata of the two
     * headers is modified.
     *
     * @param {number} source - Handle of the first block.
     * @param {number} target - Handle of the second block.
     * @returns {void}
     * @throws {Error} If handles are invalid, corrupted,
     * or either block is borrowed via withView().
     */
    swap(source: number, target: number): void;
    /**
     * Serializes the content and metadata of a memory block.
     *
     * The method extracts occupied block data via `pick()`,
     * groups it alongside capacity and word type information
     * into a data envelope, and encodes it using the CBOR format.
     *
     * @param {number} handler - Handle of the block to be serialized.
     * @returns {Uint8Array} A buffer containing the serialized block data.
     * @throws {Error} If the handle is invalid or corrupted.
     */
    dump(handler: number): Uint8Array;
    /**
     * Restores a memory block from serialized data.
     *
     * Decodes the CBOR envelope, validates whether the word type of the serialized
     * data is compatible with the current allocator instance, and allocates
     * a new block with the capacity required to accommodate the content.
     * Then, original data and occupancy are restored in the new block.
     *
     * @param {Uint8Array|ArrayBuffer} serialized - Buffer containing serialized data.
     * @returns {number} Handle of the newly recreated block.
     * @throws {Error} If the decoded data's word type differs from the allocator's configuration.
     */
    load(serialized: Uint8Array | ArrayBuffer): number;
    /**
     * Prevents modification operations on a borrowed block.
     *
     * Checks the VIEW_LOCK flag in the header associated with the provided address.
     *
     * @param {number} headerAddress - Address of the header in controlBus.
     * @returns {void}
     * @throws {Error} If the block is borrowed via withView().
     * @private
     */
    private assertNotBorrowed;
    /**
     * Prevents operations that replace or remap the dataBus
     * while any segment is borrowed.
     *
     * @returns {void}
     * @throws {Error} If any block is borrowed via withView().
     * @private
     */
    private assertNoActiveViews;
    /**
     * [INTERNAL USE]
     * Decodes metadata associated with a handle.
     *
     * The handle is split into generation and header address. The cookie stored
     * in the header is then recalculated to validate the combination; only after
     * this validation are metadata read.
     *
     * Decoded fields are written to the `out` object, which is returned
     * by the function itself. The object can be reused between calls to avoid
     * new allocations.
     *
     * @param {number} handler - Handle to be decoded and validated.
     * @param {Metadata} out - Object that will receive decoded metadata.
     * @returns {Metadata} The same reference provided in `out`.
     * @throws {Error} If the header cookie does not match the handle or
     * if the handle does not identify a valid header.
     * @private
     */
    private extractMetadata;
    /**
     * [INTERNAL USE]
     * Calculates a header's validation cookie.
     *
     * The cookie is derived from the header address and the 11 generation bits via
     * fast hash.
     * The result is reduced to 8 bits.
     *
     * The value zero is reserved as an invalid header indicator; therefore,
     * when the calculation produces zero, the method returns `1`.
     *
     * The cookie does not constitute a cryptographic mechanism. Its purpose is
     * to detect invalid, stale, or corrupted handles within the allocator's
     * memory management model.
     *
     * @param {number} addr - Header address.
     * @param {number} gen - Generation associated with the handle. Only the 11
     * least significant bits are considered.
     * @returns {number} 8-bit cookie in the range [1, 255].
     * @private
     */
    private bakeCookie;
    /**
     * Returns the number of regions currently stored in the recycling list.
     *
     * Each region corresponds to a freed block that could not be returned
     * directly to the top of the `dataBus` and, therefore, remains available for
     * reuse by a future allocation of identical capacity.
     *
     * @returns {number} Number of free regions kept in `recycle`.
     */
    recycleCount(): number;
    /**
     * Returns the total bytes belonging to regions currently stored in the
     * recycling list.
     *
     * The value is calculated by summing each free region's capacity multiplied
     * by the number of regions registered for that capacity.
     *
     * @returns {number} Number of bytes occupied by recyclable regions.
     */
    get recycleBytes(): number;
    /**
     * Returns the quantity of allocated bytes that do not belong to currently
     * recyclable regions.
     *
     * The value is obtained by subtracting the bytes belonging to free regions
     * kept in `recycle` from the total advance of `dataPointer`.
     *
     * @returns {number} Number of bytes associated with non-recyclable regions
     * within the area already used by `dataBus`.
     */
    get allocatedBytes(): number;
    /**
     * Returns the quantity of bytes not yet used at the top of the `dataBus`.
     *
     * This space corresponds to the region between `dataPointer` and the end of the
     * capacity currently reserved for the buffer.
     *
     * @returns {number} Number of bytes available after `dataPointer`.
     */
    get unallocatedBytes(): number;
    /**
     * Returns the ratio between recyclable memory and the used heap area.
     *
     * The metric considers free regions kept in `recycle` as fragmentation
     * and uses `dataPointer` as the denominator. When no bytes have been used
     * by the heap, the result is zero.
     *
     * The value does not represent the fraction of the entire `dataBus` capacity, but
     * specifically the proportion of recyclable bytes within the area already traversed
     * by the bump pointer.
     *
     * @returns {number} Fragmentation ratio in the range [0, 1] under normal
     * operating conditions.
     */
    get fragmentationRatio(): number;
}
