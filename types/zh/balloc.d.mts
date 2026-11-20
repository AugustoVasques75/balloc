export type BucketType = '8u' | '16u' | '32u' | '64u' | '8i' | '16i' | '32i' | '64i' | '16f' | '32f' | '64f';
export type Metadata = {
    /**
     * - 内存块的字节容量。
     */
    byteCapacity: number;
    /**
     * - 以 2 的幂次表示的内存块容量。
     */
    capacityExponent: number;
    /**
     * - dataBus 内的内存块地址。
     */
    dataAddress: number;
    /**
     * - 句柄所属的代数（generation）。
     */
    generation: number;
    /**
     * - controlBus 内的标头地址。
     */
    headerAddress: number;
    /**
     * - 块中已占用的元素数量。
     */
    occupied: number;
    /**
     * - 指示该内存块是否已被 withView() 借用的标志。
     */
    borrowed: number;
};
/**
 * 带有 ReBump GC 的 Echo 栈双总线指针碰撞分配器（Dual Bus Bump Allocator）。
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
     * 创建 `Balloc` 内存分配器的实例。
     *
     * 该分配器维护两个独立的缓冲区：
     * - `dataBus`：存储已分配块的数据；
     * - `controlBus`：存储标头和其他控制元数据。
     *
     * 每个块都有一个固定大小的标头（`HEADER_SIZE`），并在外部通过一个 43 位逻辑句柄标识，
     * 该句柄由一个 11 位的代数及其 32 位标头地址组成。
     *
     * 每个块的容量会按元素数量向上取整到下一个 2 的幂次，
     * 同时遵循配置的桶的宽度。
     *
     * @param {number} [size=65535] - `dataBus` 的初始容量（以字节为单位）。
     * 必须是范围在 [2, 0x80000000] 内的安全整数。
     * @param {BucketType} [bucketSize="32u"] - 桶类型和大小的标识符
     * （例如：Uint32 为 '32u'，Float64 为 '64f'，Int8 为 '8i'）。
     * @param {number} [metadataSize=1024] - `controlBus` 的初始容量（以字节为单位）。
     * 必须是范围在 [HEADER_SIZE, 0x80000000] 内的安全整数。
     *
     * @throws {RangeError} 如果 `size` 超出允许范围。
     * @throws {RangeError} 如果 `bucketSize` 不是有效的桶标识符。
     * @throws {RangeError} 如果 `metadataSize` 超出允许范围。
     */
    constructor(size?: number, bucketSize?: BucketType, metadataSize?: number);
    /**
     * 分配一个新的内存块。
     *
     * 请求的容量会被转换为能够容纳 `size` 个元素的最小 2 的幂次。
     * 优先从具有相应容量的可回收区域列表中获取该块；若不存在兼容的区域，则在 `dataBus` 的顶部预留该块。
     *
     * 随后，从控制空间中获取一个标头。先前释放的标头可以通过内部回收栈进行复用；
     * 否则，必要时会扩展 `controlBus`。
     *
     * 标头会接收地址、容量、初始占用数（零）以及一个验证 cookie。
     * 返回的值编码了分配代数与标头地址：
     *
     *     [11位代数][32位标头地址]
     *
     * @param {number} [size=16] - 块必须能够容纳的最少元素数。
     * 必须是范围在 [2, 0x80000000] 内的安全整数。
     * @returns {number} 标识已分配块的句柄。
     * @throws {RangeError} 如果 `size` 超出允许范围。
     * @throws {Error} 如果在某个块通过 withView() 被借用的同时需要扩展 `dataBus`。
     */
    alloc(size?: number): number;
    /**
     * 将块的容量扩展到下一个 2 的幂次。
     *
     * 当块位于 `dataBus` 的当前顶部时，会进行原地（in-place）扩展：
     * 仅更新其容量和 `dataPointer`。
     *
     * 如果块之后存在其他区域，则会从可回收空间中获取或在 `dataBus` 顶部
     * 分配一个容量加倍的新区域。随后，当前已占用的元素会被复制到新区域中，
     * 并且旧区域会被交还给回收列表。
     *
     * 句柄保持有效，因为它的标头得到了保留，仅更新了其中记录的地址和容量。
     *
     * @param {number} handler - 要扩展的块的句柄。
     * @returns {void}
     * @throws {Error} 如果句柄无效、已损坏，或者块正通过 withView() 被借用。
     * 如果扩展需要重新映射 dataBus 且有其他块被借用，也会抛出此错误。
     * @throws {AggregateError} 如果容量已达到支持的最大限制。
     */
    realloc(handler: number): void;
    /**
     * 将内存块缩小到能够容纳其已占用元素的最小 2 的幂次容量，
     * 同时保留其地址和句柄。
     *
     * 如果该块位于 dataBus 的顶部，则向后回退 dataPointer。
     * 否则，将释放的尾部区域拆分为若干个容量为 2 的幂次的区域，
     * 并将每个区域归还到回收列表。
     *
     * @param {number} handler - 要缩小的内存块的句柄。
     * @returns {void}
     * @throws {Error} 如果句柄无效、已损坏，或该块正通过 withView() 被借用。
     */
    shrink(handler: number): void;
    free(handler: any): void;
    /**
     * [内部使用]
     * 将空闲区域插入回收列表。
     *
     * 该列表按字节容量进行组织。对于每个容量，存储的值是一个 `Uint32Array`，
     * 其第 0 个位置包含已注册地址的数量，随后的位置包含空闲区域的地址：
     *
     *     [count, address1, address2, ...]
     *
     * 当页面填满时，其缓冲区会扩展为当前容量的两倍。
     *
     * @param {number} capacity - 空闲区域的容量（以字节为单位）。
     * @param {number} address - `dataBus` 中区域的起始地址。
     * @returns {void}
     * @private
     */
    private recyclePush;
    /**
     * [内部使用]
     * 从回收列表中移除空闲区域。
     *
     * 按请求的确切容量进行查找。当存在对应的页面时，从该页面中移除并返回最后注册的地址，
     * 从而将回收实现为 LIFO（后进先出）栈。
     *
     * @param {number} capacity - 期望的容量（以字节为单位）。
     * @returns {number} 可回收区域的起始地址，若不存在具有请求容量的区域则返回 `UNKNOWN`。
     * @private
     */
    private recyclePop;
    /**
     * 使用 ReBump 算法对 `dataBus` 进行碎片整理（压缩）。
     *
     * 顺序遍历 `controlBus` 中注册的标头，并将仍然有效的区域复制到新的 `dataBus` 中，
     * 从而消除它们之间存在的空闲空间。每个存活块的地址都会在其各自的标头中进行更新。
     *
     * `controlBus` 中块的顺序得以保留。每个块的内部数据也完全得以保留，
     * 包括其预留容量和当前占用数。
     *
     * 压缩完成后：
     * - 所有可回收区域均被消除；
     * - `dataPointer` 指向最后一个存活块之后的第一个字节；
     * - `dataBus` 为活动块呈现出一个连续的堆。
     *
     * 控制复杂度为 O(n)，其中 `n` 是遍历的标头数量。
     * 实际的内存移动成本还取决于属于存活块的字节量。
     *
     * @returns {void}
     * @throws {Error} 如果有任何块通过 withView() 被借用。
     */
    gc(): void;
    /**
     * [!!! 内部使用，请勿在您的代码中使用 !!!]
     * 将 `dataBus` 的容量扩展为当前的两倍。
     *
     * 底层缓冲区被转移到一个更大的 `ArrayBuffer` 中，同时保留现有数据。
     * 与该缓冲区关联的所有视图都会被重新创建，以引用新的存储空间。
     *
     * @returns {void}
     * @throws {Error} 如果有任何块通过 withView() 被借用。
     * @throws {RangeError} 如果 `dataBus` 的容量已超过支持的最大限制。
     * @private
     */
    private grow;
    /**
     * [!!! 内部使用，请勿在您的代码中使用 !!!]
     * 将 `controlBus` 的容量扩展为当前的两倍。
     *
     * 底层缓冲区被转移到一个更大的 `ArrayBuffer` 中，同时保留现有标头。
     * `controlAdapter` 被重新创建以引用新的存储空间。
     *
     * @returns {void}
     * @throws {RangeError} 如果当前的 `controlBus` 容量已超过支持的最大限制。
     * @private
     */
    private headerGrow;
    /**
     * 在块所占用的序列末尾追加一个元素。
     *
     * 该元素被写入最后一个占用元素之后的第一个空闲位置。
     * 只有在容量范围内有可用空间时，块的占用数才会递增。
     *
     * @param {number} value - 要插入的值。
     * @returns {boolean} 如果值已成功插入则为 `true`；如果块已无可用空间则为 `false`。
     * @throws {Error} 如果句柄无效、已损坏，或者块正通过 withView() 被借用。
     *
     */
    push(handler: any, value: number): boolean;
    /**
     * 移除块中最后一个占用的元素并将其返回。
     *
     * 在读取被移除的元素之前，占用数会先递减。对应的字节不会被清空，
     * 并且仍保留在分配的区域中，但不再属于已占用的序列。
     *
     * @param {number} handler - 块句柄。
     * @returns {number|undefined} 被移除的值，若块为空则返回 `undefined`。
     * @throws {Error} 如果句柄无效、已损坏，或者块正通过 withView() 被借用。
     */
    pop(handler: number): number | undefined;
    /**
     * 返回最后一个占用的元素，但不将其移除。
     *
     * @param {number} handler - 块句柄。
     * @returns {number|undefined} 最后一个占用的值，若块为空则返回 `undefined`。
     * @throws {Error} 如果句柄无效或已损坏。
     */
    peek(handler: number): number | undefined;
    /**
     * 在占用序列的开头插入一个元素。
     *
     * 当前已占用的元素向前移动一个位置，并将 `value` 写入第一个位置。
     * 该操作要求块的容量中存在空闲位置。
     *
     * 由于需要移动数据，该操作的成本与占用元素的数量成正比。
     *
     * @param {number} handler - 块句柄。
     * @param {number} value - 要插入的值。
     * @returns {boolean} 如果值已成功插入则为 `true`；如果块已满则为 `false`。
     * @throws {Error} 如果句柄无效、已损坏，或者块正通过 withView() 被借用。
     */
    nudge(handler: number, value: number): boolean;
    /**
     * 移除块中第一个占用的元素并将其返回。
     *
     * 其余元素向占用区域的开头方向移动一个位置。块的物理容量保持不变。
     *
     * 该操作的成本与移动的元素数量成正比。
     *
     * @param {number} handler - 块句柄。
     * @returns {number|undefined} 第一个被移除的值，若块为空则返回 `undefined`。
     * @throws {Error} 如果句柄无效、已损坏，或者块正通过 withView() 被借用。
     */
    pull(handler: number): number | undefined;
    /**
     * 返回第一个占用的元素，但不将其移除。
     *
     * @param {number} handler - 块句柄。
     * @returns {number|undefined} 第一个占用的值，若块为空则返回 `undefined`。
     * @throws {Error} 如果句柄无效或已损坏。
     */
    head(handler: number): number | undefined;
    /**
     * 检查某个值是否存在于块的占用元素中。
     *
     * 该查找直接在辅助 `TypedArray` 上执行，并且仅考虑当前占用的范围，
     * 而不是整个预留的物理容量。
     *
     * @param {number} handler - 块句柄。
     * @param {number} value - 要查找的值。
     * @returns {boolean} 如果 `value` 存在于占用元素中则为 `true`，否则为 `false`。
     * @throws {Error} 如果句柄无效或已损坏。
     */
    has(handler: number, value: number): boolean;
    /**
     * 定位元素在块的占用序列中首次出现的位置。
     *
     * 查找按索引升序执行，使用底层 TypedArray 的 `indexOf` 操作。
     * 搜索仅考虑占用的元素，忽略块中未使用的容量。
     *
     * 可以通过 `fromIndex` 指定搜索的起始位置，该参数遵循 TypedArray 的索引规则。
     *
     * @param {number} handler - 块句柄。
     * @param {number|bigint} searchElement - 要定位的元素。
     * @param {number} [fromIndex=0] - 开始搜索的索引。
     * @returns {number} 首次出现的索引；若未找到该元素或块为空，则返回 `-1`。
     * @throws {Error} 如果句柄无效或已损坏。
     */
    indexOf(handler: number, searchElement: number | bigint, fromIndex?: number): number;
    /**
     * 定位元素在块的占用序列中最后一次出现的位置。
     *
     * 查找按索引降序执行，使用底层 TypedArray 的 `lastIndexOf` 操作。
     * 搜索仅考虑占用的元素，忽略块中未使用的容量。
     *
     * 可以通过 `fromIndex` 指定搜索的起始位置，该参数遵循 TypedArray 的索引规则。
     * 默认情况下，搜索从最后一个占用元素开始。
     *
     * @param {number} handler - 块句柄。
     * @param {number|bigint} searchElement - 要定位的元素。
     * @param {number} [fromIndex=-1] - 开始搜索的索引。
     * @returns {number} 最后一次出现的索引；若未找到该元素或块为空，则返回 `-1`。
     * @throws {Error} 如果句柄无效或已损坏。
     */
    lastIndexOf(handler: number, searchElement: number | bigint, fromIndex?: number): number;
    /**
    * 返回基于零的索引处所占用的元素。
    *
    * 超出 `[0, occupied)` 范围的索引不被视为错误，会返回 `undefined`。
    *
    * @param {number} handler - 块句柄。
    * @param {number} index - 元素的基于零的索引。
    * @returns {number|undefined} 存储在索引处的值；若索引超出占用区域，则返回 `undefined`。
    * @throws {Error} 如果句柄无效或已损坏。
    */
    get(handler: number, index: number): number | undefined;
    /**
     * 替换存储在已占用索引处的值。
     *
     * 该操作不会改变块的占用数。超出 `[0, occupied)` 范围的索引将被忽略并返回 `false`。
     *
     * @param {number} handler - 块句柄。
     * @param {number} index - 元素的基于零的索引。
     * @param {number} value - 新值。
     * @returns {boolean} 如果值已成功写入则为 `true`；如果索引超出占用区域则为 `false`。
     * @throws {Error} 如果句柄无效、已损坏，或者块正通过 withView() 被借用。
     */
    set(handler: number, index: number, value: number): boolean;
    /**
     * 将块的占用数清零，并用相同的值填满其整个物理容量。
     *
     * 填充范围涵盖所有可用的槽位（slots），而不仅仅是当前占用的元素。
     * 操作完成后，无论填充使用的是什么值，该块都会被视为是空的。
     *
     * @param {number} handler - 块句柄。
     * @param {number} [value=0] - 用于填充所有槽位的值。
     * @returns {void}
     * @throws {Error} 如果句柄无效、已损坏，或者块正通过 withView() 被借用。
     */
    clear(handler: number, value?: number): void;
    /**
     * 用某个值填充块的一段槽位范围。
     *
     * 该范围使用基于零的索引，并遵循 `[start, end)` 惯例，因此 `start` 是包含的（inclusive），
     * 而 `end` 是排除的（exclusive）。当未提供 `end` 时，填充将一直延伸到块物理容量的末尾。
     *
     * 块的占用数将变为 `end`，即使填充的范围超出了先前的占用数也是如此。
     *
     * @param {number} handler - 块句柄。
     * @param {number} value - 用于填充的值。
     * @param {number} [start=0] - 起始索引（包含）。
     * @param {number|null} [end=null] - 结束索引（排除）。省略或为 `null` 时，使用块的总容量。
     * @returns {void}
     * @throws {Error} 如果句柄无效、已损坏，或者块正通过 withView() 被借用。
     * @throws {RangeError} 如果 `start` 或 `end` 超出容量边界，或者 `start > end`。
     */
    fill(handler: number, value: number, start?: number, end?: number | null): void;
    /**
     * 用某个值填满块的所有物理槽位，并将整个容量标记为已占用。
     *
     * 与 `clear()` 不同，该操作产生的是一个完全占用的块。
     *
     * @param {number} handler - 块句柄。
     * @param {number} value - 用于填充的值。
     * @returns {void}
     * @throws {Error} 如果句柄无效、已损坏，或者块正通过 withView() 被借用。
     */
    fillAll(handler: number, value: number): void;
    /**
     * 将 `Array` 或 `TypedArray` 中的元素复制到块的开头。
     *
     * 复制的数量受块容量的限制。占用数会被更新为先前占用数与实际复制数量中的较大者；
     * 因此，当接收到较短的序列时，调用 `put()` 不会减少现有的占用数。
     *
     * 对于 `Array`，仅复制能装下的前几个元素。
     * 对于 `TypedArray`，会直接使用源的子数组（subarray），无需进行中间复制。
     *
     * @param {number} handler - 块句柄。
     * @param {Array|TypedArray} data - 要复制的值序列。
     * @returns {void}
     * @throws {Error} 如果句柄无效、已损坏，或者块正通过 withView() 被借用。
     * @throws {TypeError} 如果 `data` 既不是 `Array` 也不是 `TypedArray`。
     */
    put(handler: number, data: any[] | TypedArray): void;
    /**
    * 返回块当前占用元素的副本。
    *
    * 结果是一个由 `bucketSize` 配置的同类型 `TypedArray`。未占用的物理容量不包含在结果中。
    *
    * 该操作不直接暴露内部存储：该方法使用 `TypedArray.prototype.slice()`，
    * 生成一个具有独立存储空间的新视图。
    *
    * @param {number} handler - 块句柄。
    * @returns {TypedArray} 块占用元素的副本。当块为空时，返回配置类型的空 `TypedArray`。
    * @throws {Error} 如果句柄无效或已损坏。
    */
    pick(handler: number): TypedArray;
    /**
     * 在块占用区域的直接视图上执行回调函数。
     *
     * 该视图共享 Balloc 的内部存储且不进行复制。
     * 在回调执行期间，该块受到保护，免受不兼容操作的影响。
     *
     * 回调必须是同步的。接收到的视图不得在回调结束后被存储、返回或使用。
     * 此限制同样适用于从原始视图派生的子视图（subviews）。
     *
     * @param {number} handler - 块句柄。
     * @param {...(number|Function)} args - 一个或多个块句柄，最后一个参数为回调函数。
     * @returns {*} 回调函数产生 返回值。
     * @throws {TypeError} 如果未提供句柄或回调不是函数。
     * @throws {Error} 如果任一句柄无效、重复或已被借用。
     */
    withView(...args: (number | Function)[]): any;
    /**
     * 返回块的物理容量（以字节为单位）。
     *
     * 容量对应于为块中所有槽位预留的空间，无论当前占用了多少个元素。
     *
     * @param {number} handler - 块句柄。
     * @returns {number} 块的物理容量，以字节为单位。
     * @throws {Error} 如果句柄无效或已损坏。
     */
    byteSize(handler: number): number;
    /**
     * 返回块中当前占用的元素数量。
     *
     * @param {number} handler - 块句柄。
     * @returns {number} 已占用元素数量。
     * @throws {Error} 如果句柄无效或已损坏。
     */
    occupied(handler: number): number;
    /**
     * 返回以元素数量表示的块容量。
     *
     * 该值对应于物理预留的总槽位数，而不是当前占用的数量。
     *
     * @param {number} handler - 块句柄。
     * @returns {number} 块中可用的槽位总数。
     * @throws {Error} 如果句柄无效或已损坏。
     */
    length(handler: number): number;
    /**
     * 检查内存块是否已达到其分配容量。
     *
     * 当占用元素数量等于其分配的总容量、且没有剩余位置可存储新元素时，块被视为已满。
     *
     * @param {number} handler - 块句柄。
     * @returns {boolean} 如果块已满则为 `true`，否则为 `false`。
     * @throws {Error} 如果句柄无效或已损坏。
     */
    isFull(handler: number): boolean;
    /**
    * 将占用元素从一个块复制到另一个块。
    *
    * 复制从 `source` 的第一个元素和 `destination` 的第一个槽位开始。
    * 实际复制的数量受源中占用元素数量、目标物理容量以及 `slots` 中指定限制的约束。
    *
    * 必要时会提高目标的占用数，以涵盖复制的元素。目标的容量保持不变。
    *
    * 该操作在 `dataBus` 上使用 `Uint8Array.prototype.copyWithin()`，
    * 因此返回值为代表数据总线的 `Uint8Array` 本身。
    *
    * @param {number} source - 源块句柄。
    * @param {number} destination - 目标块句柄。
    * @param {number} [slots=UNKNOWN] - 要复制的最大元素数。
    * `UNKNOWN` 代表哨兵值，用于不施加额外的限制。
    * @returns {Uint8Array} 操作后的 `dataBus`。
    * @throws {Error} 如果句柄无效、已损坏，或者目标块正通过 withView() 被借用。
    */
    copy(source: number, destination: number, slots?: number): Uint8Array;
    /**
     * 在块内部复制一段元素区域。
     *
     * 索引基于零，并遵循 `Array.prototype.copyWithin()` 的语义：
     * `target` 标识目标位置，`start` 标识源起始位置，`length` 标识要复制的最大元素数。
     *
     * 负索引会从块容量的末尾开始解析。经过此规范化后，索引会被限制在物理容量内。
     * 复制的数量也受实际占用元素以及从 `target` 开始的可用空间的限制。
     *
     * 该操作支持重叠区域，并且当目标范围超过先前的占用数时，可以增加块的占用数。
     *
     * @param {number} handler - 块句柄。
     * @param {number} target - 起始目标索引。
     * @param {number} start - 起始源索引。
     * @param {number} length - 要复制的最大元素数。
     * @returns {Uint8Array} 操作后的 `dataBus`。
     * @throws {Error} 如果句柄无效、已损坏，或者块正通过 withView() 被借用。
     */
    copyWithin(handler: number, target: number, start: number, length: number): Uint8Array;
    /**
     * 将 `source` 的占用元素追加到 `target` 的末尾。
     *
     * 复制的数量受源中占用元素数量以及目标容量中剩余可用空间的限制。
     *
     * 该操作支持 `target` 和 `source` 引用同一个块。在这种情况下，
     * 复制操作将在块自身的区域上执行，并保留 `copyWithin()` 的重叠语义。
     *
     * @param {number} target - 将接收元素的块句柄。
     * @param {number} source - 要将其元素追加进来的块句柄。
     * @returns {number} 实际追加的元素数量。
     * @throws {Error} 如果句柄无效、已损坏，或者目标块正通过 withView() 被借用。
     */
    append(target: number, source: number): number;
    /**
     * 创建块的独立副本。
     *
     * 新块具有与原块相同的物理容量和占用数。预留区域中的所有字节（包括当前未占用的位置）均会被复制。
     *
     * 新块会获得一个新句柄，并继续受正常的分配和回收规则约束。
     *
     * @param {number} handler - 要克隆的块句柄。
     * @returns {number} 新块的句柄。
     * @throws {Error} 如果句柄无效或已损坏。
     */
    clone(handler: number): number;
    /**
     * 交换两个块关联的数据区域。
     *
     * 该操作在标头之间交换区域地址、容量和占用数。句柄保持不变：
     * 操作完成后，每个句柄继续标识其自己的标头，但该标头现在描述的是先前属于另一个块的区域。
     *
     * `dataBus` 中不会复制任何数据；仅修改两个标头的元数据。
     *
     * @param {number} source - 第一个块的句柄。
     * @param {number} target - 第二个块的句柄。
     * @returns {void}
     * @throws {Error} 如果句柄无效、已损坏，或者任何一个块正通过 withView() 被借用。
     */
    swap(source: number, target: number): void;
    /**
     * 序列化内存块的内容和元数据。
     *
     * 该方法通过 `pick()` 提取块的占用数据，连同容量和字类型（word type）信息
     * 一起打包成一个数据信封（envelope），并使用 CBOR 格式对其进行编码。
     *
     * @param {number} handler - 要序列化的块句柄。
     * @returns {Uint8Array} 包含序列化块数据的缓冲区。
     * @throws {Error} 如果句柄无效或已损坏。
     */
    dump(handler: number): Uint8Array;
    /**
     * 从序列化数据恢复内存块。
     *
     * 解码 CBOR 信封，验证序列化数据的字类型是否与当前的分配器实例兼容，
     * 并分配一个能够容纳该内容所需容量的新块。随后，在新的块中恢复原始数据和占用数。
     *
     * @param {Uint8Array|ArrayBuffer} serialized - 包含序列化数据的缓冲区。
     * @returns {number} 重新创建的新块的句柄。
     * @throws {Error} 如果解码数据的字类型与分配器配置的不一致。
     */
    load(serialized: Uint8Array | ArrayBuffer): number;
    /**
     * 防止对已借用的块进行修改操作。
     *
     * 检查与所提供地址关联的标头中的 VIEW_LOCK 标志。
     *
     * @param {number} headerAddress - controlBus 中的标头地址。
     * @returns {void}
     * @throws {Error} 如果块正通过 withView() 被借用。
     * @private
     */
    private assertNotBorrowed;
    /**
     * 防止在存在任何借用片段时替换或重新映射 dataBus 的操作。
     *
     * @returns {void}
     * @throws {Error} 如果有任何块通过 withView() 被借用。
     * @private
     */
    private assertNoActiveViews;
    /**
     * [内部使用]
     * 解码与句柄关联的元数据。
     *
     * 句柄被拆分为代数和标头地址。然后重新计算标头中存储的 cookie 以验证该组合；
     * 只有在通过此验证后才会读取元数据。
     *
     * 解码后的字段写入 `out` 对象中，该对象由函数自身返回。
     * 可以在多次调用之间复用该对象以避免新的分配。
     *
     * @param {number} handler - 要解码和验证的句柄。
     * @param {Metadata} out - 将接收解码后元数据的对象。
     * @returns {Metadata} 在 `out` 中提供的相同引用。
     * @throws {Error} 如果标头 cookie 与句柄不匹配，或者句柄未能标识有效的标头。
     * @private
     */
    private extractMetadata;
    /**
     * [内部使用]
     * 计算标头的验证 cookie。
     *
     * cookie 是通过快速哈希（fast hash）从标头地址和 11 位代数派生而来的。
     * 结果会被缩减为 8 位。
     *
     * 值零被保留作为无效标头的指示符；因此，当计算结果为零时，该方法返回 `1`。
     *
     * 该 cookie 不构成加密机制。其目的是在分配器的内存管理模型中
     * 检测无效、陈旧（stale）或损坏的句柄。
     *
     * @param {number} addr - 标头地址。
     * @param {number} gen - 与句柄关联的代数。仅考虑最低的 11 位。
     * @returns {number} 范围在 [1, 255] 内的 8 位 cookie。
     * @private
     */
    private bakeCookie;
    /**
     * 返回当前存储在回收列表中的区域数量。
     *
     * 每个区域对应一个无法直接交还给 `dataBus` 顶部的释放块，
     * 因此它仍然可供未来相同容量的分配进行复用。
     *
     * @returns {number} 保存在 `recycle` 中的空闲区域数量。
     */
    recycleCount(): number;
    /**
     * 返回当前存储在回收列表中的区域所属的总字节数。
     *
     * 该值是通过将每个空闲区域的容量乘以该容量注册的区域数量相加来计算的。
     *
     * @returns {number} 可回收区域占用的字节数。
     */
    get recycleBytes(): number;
    /**
     * 返回不属于当前可回收区域的已分配字节数。
     *
     * 该值是通过从 `dataPointer` 的总推进量中减去保存在 `recycle` 中的空闲区域所属的字节数来获取的。
     *
     * @returns {number} 在 `dataBus` 已使用区域内，与不可回收区域关联的字节数。
     */
    get allocatedBytes(): number;
    /**
     * 返回 `dataBus` 顶部尚未使用的字节数。
     *
     * 此空间对应于 `dataPointer` 与当前为缓冲区预留容量末尾之间的区域。
     * @returns {number} `dataPointer` 之后可用的字节数。
     */
    get unallocatedBytes(): number;
    /**
     * 返回可回收内存与已使用堆区域之间的比率。
     *
     * 该指标将保存在 `recycle` 中的空闲区域视为碎片，并以 `dataPointer` 作为分母。
     * 当堆未消耗任何字节时，结果为零。
     *
     * 该值不代表整个 `dataBus` 容量的分数，而是具体代表碰撞指针（bump pointer）
     * 已遍历区域内可回收字节的比例。
     *
     * @returns {number} 正常运行条件下的碎片率，范围在 [0, 1] 内。
     */
    get fragmentationRatio(): number;
}
