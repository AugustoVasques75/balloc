export type BucketType = '8u' | '16u' | '32u' | '64u' | '8i' | '16i' | '32i' | '64i' | '16f' | '32f' | '64f';
export type Metadata = {
    /**
     * - 内存块的容量（以字节为单位）。
     */
    byteCapacity: number;
    /**
     * - 以二为底的指数形式表示的内存块容量。
     */
    capacityExponent: number;
    /**
     * - dataBus 内的内存块地址。
     */
    dataAddress: number;
    /**
     * - 句柄所属的代（generation）。
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
};
/**
 * 带有 ReBump GC 的回显栈双总线 Bump 分配器（Echo Stack Dual Bus Bump Allocator with ReBump GC）。
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
     * - `controlBus`：存储标头及其他控制元数据。
     *
     * 每个块都有一个固定大小的标头（`HEADER_SIZE`），并由一个 43 位逻辑句柄
     * 在外部进行标识，该句柄由 11 位的代和 32 位的标头地址组成。
     *
     * 每个块的容量会按元素向上取整到下一个二的幂，同时遵循配置的桶宽度。
     *
     * @param {number} [size=65535] - `dataBus` 的初始容量（以字节为单位）。
     * 必须是范围在 [2, 0x80000000] 内的安全整数。
     * @param {BucketType} [bucketSize="32u"] - 桶类型和大小标识符
     * （例如：'32u' 表示 Uint32，'64f' 表示 Float64，'8i' 表示 Int8）。
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
     * 请求的容量会被转换为能够容纳 `size` 个元素的最小二的幂。
     * 该块优先从具有相应容量的可回收区域列表中获取；如果不存在兼容的区域，
     * 则在 `dataBus` 的顶部保留该块。
     *
     * 接下来，从控制空间获取一个标头。先前释放的标头可以通过内部回收栈进行重用；
     * 否则，会在必要时扩展 `controlBus`。
     *
     * 标头会接收地址、容量、初始占用数（零）以及验证 Cookie。
     * 返回的值对分配代数和标头地址进行编码：
     *
     *     [11 位代数][32 位标头地址]
     *
     * @param {number} [size=16] - 块必须容纳的最小元素数量。
     * 必须是范围在 [2, 0x80000000] 内的安全整数。
     * @returns {number} 标识已分配块的句柄。
     * @throws {RangeError} 如果 `size` 超出允许范围。
     */
    alloc(size?: number): number;
    /**
     * 将块的容量扩展到下一个二的幂。
     *
     * 当块位于 `dataBus` 的当前顶部时，扩展以就地（in-place）方式发生：
     * 仅更新其容量和 `dataPointer`。
     *
     * 如果块之后存在其他区域，则从可回收空间中获取或在 `dataBus` 顶部
     * 分配一个容量加倍的新区域。随后，当前占用的元素将被复制到新区域中，
     * 并且先前的区域被归还给回收列表。
     *
     * 句柄保持有效，因为它的标头得到了保留，并且仅更新了其中记录的地址和容量。
     *
     * @param {number} handler - 要扩展的块的句柄。
     * @returns {void}
     * @throws {Error} 如果句柄无效或已损坏。
     * @throws {AggregateError} 如果容量已达到其支持的最大限制。
     */
    realloc(handler: number): void;
    /**
     * 释放内存块。
     *
     * 通过将块的 Cookie 清零来使其标头失效，并记录其地址以便后续重用。
     * 数据区域也会被归还给回收系统，但块精确处于 `dataBus` 顶部的情况除外；
     * 在这种情况下，只需回退 `dataPointer` 即可消除该区域，而无需在回收列表中创建条目。
     *
     * @param {number} handler - 要释放的块的句柄。
     * @returns {void}
     * @throws {Error} 如果句柄无效或已损坏。
     */
    free(handler: number): void;
    /**
     * [内部使用]
     * 将空闲区域插入回收列表。
     *
     * 该列表按字节容量进行组织。对于每个容量，存储的值是一个 `Uint32Array`，
     * 其零位置包含已注册地址的数量，后续位置包含空闲区域的地址：
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
     * 通过请求的确切容量进行搜索。当存在对应的页面时，
     * 从页面中移除最后一个注册的地址并将其返回，从而将回收实现为 LIFO 栈。
     *
     * @param {number} capacity - 所需的容量（以字节为单位）。
     * @returns {number} 可回收区域的起始地址，如果不存在具有请求容量的区域则返回 `UNKNOWN`。
     * @private
     */
    private recyclePop;
    /**
     * 使用 ReBump 算法对 `dataBus` 进行压缩。
     *
     * 顺序遍历 `controlBus` 中注册的标头，并将仍然有效的区域复制到新的 `dataBus` 中，
     * 从而消除它们之间存在的空闲空间。每个存活块的地址在其各自的标头中得到更新。
     *
     * `controlBus` 中块的顺序得以保留。每个块的内部数据也完全得以保留，
     * 包括其预留的容量和当前的占用数。
     *
     * 压缩结束时：
     * - 所有可回收区域均被消除；
     * - `dataPointer` 指向最后一个存活块之后的第一个字节；
     * - `dataBus` 表现为活动块的连续堆（heap）。
     *
     * 控制复杂度为 O(n)，其中 `n` 是遍历的标头数量。
     * 内存移动的有效成本还取决于属于存活块的字节量。
     *
     * @returns {void}
     */
    gc(): void;
    /**
     * [!!! 内部使用，请勿在您的代码中使用 !!!]
     * 将 `dataBus` 的容量扩展为其当前容量的两倍。
     *
     * 底层缓冲区被传输到更大的 `ArrayBuffer` 中，同时保留现有数据。
     * 与该缓冲区关联的所有视图都会被重新创建以引用新的存储空间。
     *
     * @returns {void}
     * @throws {RangeError} 如果 `dataBus` 容量超出支持的最大限制。
     * @private
     */
    private grow;
    /**
     * [!!! 内部使用，请勿在您的代码中使用 !!!]
     * 将 `controlBus` 的容量扩展为其当前容量的两倍。
     *
     * 底层缓冲区被传输到更大的 `ArrayBuffer` 中，同时保留现有标头。
     * 重新创建 `controlAdapter` 以引用新的存储空间。
     *
     * @returns {void}
     * @throws {RangeError} 如果当前 `controlBus` 容量超出支持的最大限制。
     * @private
     */
    private headerGrow;
    /**
     * 将元素追加到块所占用序列的末尾。
     *
     * 该元素写入最后一个已占用元素之后的第一个空闲位置。
     * 只有在其容量中有可用空间时，才会增加块的占用数。
     *
     * @param {number} handler - 块句柄。
     * @param {number} value - 要插入的值。
     * @returns {boolean} 如果成功插入值则为 `true`；如果块没有可用空间则为 `false`。
     * @throws {Error} 如果句柄无效或已损坏。
     */
    push(handler: number, value: number): boolean;
    /**
     * 移除并返回块中最后占用的元素。
     *
     * 在读取被移除的元素之前，占用数会递减。对应的字节不会被清空，
     * 仍留在分配的区域中，但不再属于占用的序列。
     *
     * @param {number} handler - 块句柄。
     * @returns {number|undefined} 被移除的值，如果块为空则返回 `undefined`。
     * @throws {Error} 如果句柄无效或已损坏。
     */
    pop(handler: number): number | undefined;
    /**
     * 返回最后占用的元素而不将其移除。
     *
     * @param {number} handler - 块句柄。
     * @returns {number|undefined} 最后占用的值，如果块为空则返回 `undefined`。
     * @throws {Error} 如果句柄无效或已损坏。
     */
    peek(handler: number): number | undefined;
    /**
     * 在占用序列的开头插入一个元素。
     *
     * 当前占用的元素向前移动一个位置，并将 `value` 写入第一个位置。
     * 该操作要求块的容量中有空闲位置。
     *
     * 该操作的成本与占用元素的数量成正比，因为需要移动数据。
     *
     * @param {number} handler - 块句柄。
     * @param {number} value - 要插入的值。
     * @returns {boolean} 如果成功插入值则为 `true`；如果块已满则为 `false`。
     * @throws {Error} 如果句柄无效或已损坏。
     */
    nudge(handler: number, value: number): boolean;
    /**
     * 移除并返回块中第一个占用的元素。
     *
     * 剩余元素向占用区域的开头方向移动一个位置。块的物理容量保持不变。
     *
     * 该操作的成本与移动的元素数量成正比。
     *
     * @param {number} handler - 块句柄。
     * @returns {number|undefined} 第一个被移除的值，如果块为空则返回 `undefined`。
     * @throws {Error} 如果句柄无效或已损坏。
     */
    pull(handler: number): number | undefined;
    /**
     * 返回第一个占用的元素而不将其移除。
     *
     * @param {number} handler - 块句柄。
     * @returns {number|undefined} 第一个占用的值，如果块为空则返回 `undefined`。
     * @throws {Error} 如果句柄无效或已损坏。
     */
    head(handler: number): number | undefined;
    /**
     * 检查某个值是否存在于块的占用元素中。
     *
     * 该搜索直接在辅助 `TypedArray` 上执行，并且仅考虑当前占用的范围，
     * 而不是整个预留的物理容量。
     *
     * @param {number} handler - 块句柄。
     * .@param {number} value - 要寻找的值。
     * @returns {boolean} 如果 `value` 存在于占用元素中则为 `true`；否则为 `false`。
     * @throws {Error} 如果句柄无效或已损坏。
     */
    has(handler: number, value: any): boolean;
    /**
    * 返回基于零的索引处的占用元素。
    *
    * 超出范围 `[0, occupied)` 的索引不被视为错误，会返回 `undefined`。
    *
    * @param {number} handler - 块句柄。
    * @param {number} index - 元素的基于零的索引。
    * @returns {number|undefined} 存储在索引处的值，如果索引超出占用区域则返回 `undefined`。
    * @throws {Error} 如果句柄无效或已损坏。
    */
    get(handler: number, index: number): number | undefined;
    /**
     * 替换存储在已占用索引处的值。
     *
     * 该操作不会改变块的占用数。超出范围 `[0, occupied)` 的索引会被忽略并返回 `false`。
     *
     * @param {number} handler - 块句柄。
     * @param {number} index - 元素的基于零的索引。
     * @param {number} value - 新值。
     * @returns {boolean} 如果成功写入值则为 `true`；如果索引超出占用区域则为 `false`。
     * @throws {Error} 如果句柄无效或已损坏。
     */
    set(handler: number, index: number, value: number): boolean;
    /**
     * 清零块的占用数，并用相同的值填充其整个物理容量。
     *
     * 填充涵盖所有可用的槽位（slots），而不仅仅是当前占用的元素。
     * 操作完成后，无论填充时使用什么值，该块都被视为是空的。
     *
     * @param {number} handler - 块句柄。
     * @param {number} [value=0] - 用于填充所有槽位的值。
     * @returns {void}
     * @throws {Error} 如果句柄无效或已损坏。
     */
    clear(handler: number, value?: number): void;
    /**
     * 用某个值填充块的一段槽位范围。
     *
     * 该范围使用基于零的索引，并遵循 `[start, end)` 惯例，
     * 因此 `start` 是包含的（inclusive），而 `end` 是排他的（exclusive）。
     * 当未指定 `end` 时，填充会延伸到块物理容量的末尾。
     *
     * 块的占用数变为 `end`，即使填充的范围超出了先前的占用数也是如此。
     *
     * @param {number} handler - 块句柄。
     * @param {number} value - 用于填充的值。
     * @param {number} [start=0] - 起始索引，包含。
     * @param {number|null} [end=null] - 结束索引，排他。当省略或为 `null` 时，
     * 使用块的总容量。
     * @returns {void}
     * @throws {Error} 如果句柄无效或已损坏。
     * @throws {RangeError} 如果 `start` 或 `end` 超出容量边界，或者 `start > end`。
     */
    fill(handler: number, value: number, start?: number, end?: number | null): void;
    /**
     * 用一个值填充块的所有物理槽位，并将整个容量标记为已占用。
     *
     * 与 `clear()` 不同，该操作会产生一个完全被占用的块。
     *
     * @param {number} handler - 块句柄。
     * @param {number} value - 用于填充的值。
     * @returns {void}
     * @throws {Error} 如果句柄无效或已损坏。
     */
    fillAll(handler: number, value: number): void;
    /**
     * 将 `Array` 或 `TypedArray` 的元素复制到块的开头。
     *
     * 复制的数量受块容量的限制。占用数更新为先前占用数与实际复制数量中的较大值；
     * 因此，当接收到较小的序列时，调用 `put()` 不会减少现有的占用数。
     *
     * 对于 `Array`，仅复制能装下的前几个元素。
     * 对于 `TypedArray`，使用源的子数组（subarray），无需中间复制。
     *
     * @param {number} handler - 块句柄。
     * @param {Array|TypedArray} data - 要复制的值序列。
     * @returns {void}
     * @throws {Error} 如果句柄无效或已损坏。
     * @throws {TypeError} 如果 `data` 既不是 `Array` 也不是 `TypedArray`。
     */
    put(handler: number, data: any[] | TypedArray): void;
    /**
    * 返回块当前占用元素的副本。
    *
    * 结果是由 `bucketSize` 配置的同类型 `TypedArray`。未占用的物理容量不包含在结果中。
    *
    * 该操作不直接暴露内部存储：该方法使用 `TypedArray.prototype.slice()`，
    * 产生一个具有独立存储的新视图。
    *
    * @param {number} handler - 块句柄。
    * @returns {TypedArray} 块占用的元素副本。当块为空时，返回配置类型的空 `TypedArray`。
    * @throws {Error} 如果句柄无效或已损坏。
    */
    pick(handler: number): TypedArray;
    /**
     * 返回块以字节为单位的物理容量。
     *
     * 容量对应于为块中所有槽位预留的空间，无论当前占用了多少元素。
     *
     * @param {number} handler - 块句柄。
     * @returns {number} 块的物理容量（以字节为单位）。
     * @throws {Error} 如果句柄无效或已损坏。
     */
    byteSize(handler: number): number;
    /**
     * 返回块中当前占用的元素数量。
     *
     * @param {number} handler - 块句柄。
     * @returns {number} 已占用元素的数量。
     * @throws {Error} 如果句柄无效或已损坏。
     */
    occupied(handler: number): number;
    /**
     * 返回以元素数量计算的块容量。
     *
     * 该值对应物理预留槽位的总数，而不是当前占用的数量。
     *
     * @param {number} handler - 块句柄。
     * @returns {number} 块中可用的槽位总数。
     * @throws {Error} 如果句柄无效或已损坏。
     */
    length(handler: number): number;
    /**
     * 将占用的元素从一个块复制到另一个块。
     *
     * 复制从 `source` 的第一个元素和 `destiny` 的第一个槽位开始。
     * 实际复制的数量受源中占用元素数量、目标物理容量以及 `slots` 中指定的限制所限制。
     *
     * 必要时会增加目标的占用数以涵盖复制的元素。目标的容量保持不变。
     *
     * 该操作在 `dataBus` 上使用 `Uint8Array.prototype.copyWithin()`，
     * 因此返回值为表示数据总线的 `Uint8Array` 本身。
     *
     * @param {number} source - 源块句柄。
     * @param {number} destiny - 目标块句柄。
     * @param {number} [slots=UNKNOWN] - 要复制的最大元素数量。
     * `UNKNOWN` 表示不施加额外限制所使用的哨兵值。
     * @returns {Uint8Array} 操作后的 `dataBus`。
     * @throws {Error} 如果 `source` 或 `destiny` 无效或已损坏。
     */
    copy(source: number, destiny: number, slots?: number): Uint8Array;
    /**
     * 在块内部复制一段元素区域。
     *
     * 索引基于零并遵循 `Array.prototype.copyWithin()` 的语义：
     * `target` 标识目标位置，`start` 标识源起始位置，`length` 标识要复制的最大元素数量。
     *
     * 负索引从块容量的末尾开始解释。完成此规范化后，索引将被限制在物理容量之内。
     * 复制的数量也受实际占用元素以及从 `target` 开始的可用空间的限制。
     *
     * 该操作支持重叠区域，并且当目标范围超过当前占用数时可以增加块的占用数。
     *
     * @param {number} handler - 块句柄。
     * @param {number} target - 起始目标索引。
     * @param {number} start - 起始源索引。
     * @param {number} length - 要复制的最大元素数量。
     * @returns {Uint8Array} 操作后的 `dataBus`。
     * @throws {Error} 如果句柄无效或已损坏。
     */
    copyWithin(handler: number, target: number, start: number, length: number): Uint8Array;
    /**
     * 将 `source` 的占用元素追加到 `target` 的末尾。
     *
     * 复制的数量受源中占用元素数量以及目标容量中剩余可用空间的限制。
     *
     * 该操作支持 `target` 和 `source` 引用同一个块。
     * 在这种情况下，复制在块自己的区域上执行，并保留 `copyWithin()` 的重叠语义。
     *
     * @param {number} target - 将接收元素的块句柄。
     * @param {number} source - 其元素将被追加的块句柄。
     * @returns {number} 实际追加的元素数量。
     * @throws {Error} 如果 `target` 或 `source` 无效或已损坏。
     */
    append(target: number, source: number): number;
    /**
     * 创建块的独立副本。
     *
     * 新块具有与原始块相同的物理容量和占用数。
     * 预留区域中的所有字节（包括当前未占用的位置）都会被复制。
     *
     * 新块会获得一个新句柄，并受常规分配和回收规则的约束。
     *
     * @param {number} handler - 要克隆的块的句柄。
     * @returns {number} 新块的句柄。
     * @throws {Error} 如果句柄无效或已损坏。
     */
    clone(handler: number): number;
    /**
     * 交换与两个块关联的数据区域。
     *
     * 该操作在标头之间交换区域地址、容量和占用数。句柄保持不变：
     * 操作后，每个句柄继续标识其自己的标头，但该标头现在描述的是先前属于另一个块的区域。
     *
     * `dataBus` 中不复制任何数据；仅修改两个标头的元数据。
     *
     * @param {number} source - 第一个块的句柄。
     * @param {number} target - 第二个块的句柄。
     * @returns {void}
     * @throws {Error} 如果 `source` 或 `target` 无效或已损坏。
     */
    swap(source: number, target: number): void;
    /**
     * 序列化内存块的内容和元数据。
     *
     * 该方法通过 `pick()` 提取块的占用数据，将其与容量和单词类型信息一起
     * 组合到数据信封（envelope）中，并使用 CBOR 格式对其进行编码。
     *
     * @param {number} handler - 要序列化的块的句柄。
     * @returns {Uint8Array} 包含序列化块数据的缓冲区。
     * @throws {Error} 如果句柄无效或已损坏。
     */
    dump(handler: number): Uint8Array;
    /**
     * 从序列化数据恢复内存块。
     *
     * 解码 CBOR 信封，验证序列化数据的单词类型是否与当前分配器实例兼容，
     * 并分配一个容纳内容所需容量的新块。然后，在的新块中恢复原始数据和占用数。
     *
     * @param {Uint8Array|ArrayBuffer} serialized - 包含序列化数据的缓冲区。
     * @returns {number} 重新创建的新块的句柄。
     * @throws {Error} 如果解码数据的单词类型与分配器中配置的不同。
     */
    load(serialized: Uint8Array | ArrayBuffer): number;
    /**
     * [内部使用]
     * 解码与句柄关联的元数据。
     *
     * 句柄被拆分为代和标头地址。然后重新计算标头中存储的 Cookie 以验证组合；
     * 只有在此验证之后才会读取元数据。
     *
     * 解码后的字段被写入 `out` 对象中，该对象由函数自身返回。
     * 可以在多次调用之间重用该对象以避免新的分配。
     *
     * @param {number} handler - 要解码和验证的句柄。
     * @param {Metadata} out - 将接收解码元数据的对象。
     * @returns {Metadata} 在 `out` 中提供的相同引用。
     * @throws {Error} 如果标头 Cookie 与句柄不匹配，或者句柄未标识有效的标头。
     * @private
     */
    private extractMetadata;
    /**
     * [内部使用]
     * 计算标头的验证 Cookie。
     *
     * Cookie 通过快速哈希（fast hash）由标头地址和 11 位代数派生而来。
     * 结果被缩减为 8 位。
     *
     * 零值保留为无效标头指示符；因此，当计算产生零时，该方法返回 `1`。
     *
     * Cookie 不构成加密机制。其目的是在分配器的内存管理模型中
     * 检测无效、过时（stale）或损坏的句柄。
     *
     * @param {number} addr - 标头地址。
     * @param {number} gen - 与句柄关联的代。仅考虑最低的 11 位。
     * @returns {number} 范围在 [1, 255] 内的 8 位 Cookie。
     * @private
     */
    private bakeCookie;
    /**
     * 返回当前存储在回收列表中的区域数量。
     *
     * 每个区域对应一个无法直接归还给 `dataBus`顶部的已释放块，
     * 因此保留下来以便未来容量相同的分配进行重用。
     *
     * @returns {number} `recycle` 中维护的空闲区域数量。
     */
    recycleCount(): number;
    /**
     * 返回当前存储在回收列表中的区域所属的字节总数。
     *
     * 该值通过将每个空闲区域的容量乘以针对该容量注册的区域数量相加来计算。
     *
     * @returns {number} 可回收区域占用的字节数。
     */
    get recycleBytes(): number;
    /**
     * 返回不属于当前可回收区域的已分配字节数。
     *
     * 该值通过从 `dataPointer` 的总推进量中减去 `recycle` 中维护的空闲区域所属的字节来获得。
     *
     * @returns {number} `dataBus` 已使用区域内与不可回收区域关联的字节数。
     */
    get allocatedBytes(): number;
    /**
     * 返回 `dataBus` 顶部尚未使用的字节数。
     *
     * 此空间对应于 `dataPointer` 与当前为缓冲区预留容量末尾之间的区域。
     * @returns {number} `dataPointer` 之后的可用字节数。
     */
    get unallocatedBytes(): number;
    /**
     * 返回可回收内存与已使用堆区域之间的比率。
     *
     * 该指标将 `recycle` 中维护的空闲区域视为碎片化，并使用 `dataPointer` 作为分母。
     * 当堆未曾使用任何字节时，结果为零。
     *
     * 该值不代表整个 `dataBus` 容量的分数，而是具体表示 bump 指针已遍历区域内
     * 可回收字节的比例。
     *
     * @returns {number} 在正常运行条件下的 [0, 1] 范围内的碎片化比率。
     */
    get fragmentationRatio(): number;
}
