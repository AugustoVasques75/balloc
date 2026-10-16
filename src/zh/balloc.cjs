var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/zh/balloc.mjs
var balloc_exports = {};
__export(balloc_exports, {
  default: () => Balloc
});
module.exports = __toCommonJS(balloc_exports);
var import_cbor_x = require("cbor-x");
var UNKNOWN = 4294967295 >>> 0;
var BUCKET_MAPPING = Object.freeze({
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
var IS_LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
var HEADER_SIZE = 16 >>> 0;
var ADDRESS_OFFSET = 0 >>> 0;
var OCCUPIED_OFFSET = 4 >>> 0;
var CAPACITY_OFFSET = 8 >>> 0;
var COOKIE_OFFSET = 9 >>> 0;
var ROTATE_32BITS = 4294967296;
var CLAMP_11BITS = 2047 >>> 0;
var isTypedArray = (val) => ArrayBuffer.isView(val) && !(val instanceof DataView);
var Balloc = class {
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
  constructor(size = 65535, bucketSize = "32u", metadataSize = 1024) {
    if (!Number.isSafeInteger(size) || size < 2 || size > 2147483648) throw new RangeError(`Parameter size must be in range [2, 0x80000000] but size is ${size}`);
    if (!BUCKET_MAPPING[bucketSize]) {
      throw new RangeError(`bucketSize must be in ([ 8 || 16 || 32 || 64][ u || i ]) || ([ 16 || 32 || 64][ f ]) but I found ${bucketSize}`);
    }
    if (!Number.isSafeInteger(metadataSize) || metadataSize < HEADER_SIZE || metadataSize > 2147483648) throw new RangeError(`Parameter metadataSize must be in range [HEADER_SIZE, 0x80000000] but metadataSize is ${metadataSize}`);
    this.wordType = bucketSize;
    this.bucketType = BUCKET_MAPPING[bucketSize].type;
    this.bucketSize = BUCKET_MAPPING[bucketSize].bits >>> 0;
    this.bucketArray = globalThis[`${this.bucketType}Array`];
    this.wordSize = this.bucketSize >>> 3;
    this.wordShift = this.bucketSize >>> 4;
    this.size = Math.max(1 << 32 - Math.clz32(size) >>> 0, this.wordSize);
    this.headerSize = 1 << 32 - Math.clz32(metadataSize) >>> 0;
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
    this.recycle = /* @__PURE__ */ new Map();
    this.metadata = {
      generation: 0 >>> 0,
      headerAddress: 0 >>> 0,
      dataAddress: 0 >>> 0,
      capacityExponent: 0 >>> 0,
      byteCapacity: 0 >>> 0,
      occupied: 0 >>> 0
    };
  }
  // ========== 分配 (ALLOCATION) ==========
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
  alloc(size = 16) {
    if (!Number.isSafeInteger(size) || size < 2 || size > 2147483648) throw new RangeError(`Parameter size must be in range [2, 0x80000000] but size is ${size}`);
    const capacity = 32 - Math.clz32(size - 1);
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
    return (this.generation & CLAMP_11BITS) * ROTATE_32BITS + headerAddress;
  }
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
  realloc(handler) {
    const generation = handler / ROTATE_32BITS & CLAMP_11BITS;
    let headerAddress = handler >>> 0;
    const dataAddress = this.controlAdapter.getUint32(headerAddress + ADDRESS_OFFSET, IS_LITTLE_ENDIAN);
    const occupied = this.controlAdapter.getUint32(headerAddress + OCCUPIED_OFFSET, IS_LITTLE_ENDIAN);
    const capacity = this.controlAdapter.getUint8(headerAddress + CAPACITY_OFFSET);
    const cookie = this.controlAdapter.getUint8(headerAddress + COOKIE_OFFSET);
    if (cookie !== this.bakeCookie(headerAddress, generation)) {
      throw new Error("Invalid or corrupted handle");
    }
    if (capacity >= 31) throw new AggregateError([new Error("Can\xB4t reallocate handler."), new RangeError("Capacity has reached its limit.")], "Internal Error.");
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
  free(handler) {
    const generation = handler / ROTATE_32BITS & CLAMP_11BITS;
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
  // ========== 回收 (RECYCLING) ==========
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
  recyclePop(capacity) {
    if (!this.recycle.has(capacity)) return UNKNOWN;
    const page = this.recycle.get(capacity);
    const count = page[0];
    if (count === 0) return UNKNOWN;
    const address = page[count];
    page[0] = count - 1;
    return address;
  }
  // ========== 垃圾回收 (GARBAGE COLLECTION) ==========
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
  gc() {
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
  // ========== 扩容 (SCALING) ==========
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
  grow() {
    if (this.size > 2147483648) throw new RangeError("Data bus capacity exceeded");
    const newSize = this.size * 2 >>> 0;
    const newBuffer = this.dataBus.buffer.transfer(newSize);
    this.size = newSize;
    this.dataBus = new Uint8Array(newBuffer);
    this.dataAdapter = new DataView(newBuffer);
    this.writer = this.dataAdapter[`set${this.bucketType}`].bind(this.dataAdapter);
    this.reader = this.dataAdapter[`get${this.bucketType}`].bind(this.dataAdapter);
    this.auxiliary = new this.bucketArray(newBuffer);
  }
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
  headerGrow() {
    if (this.controlBus.byteLength > 2147483648) throw new RangeError("Control bus capacity exceeded");
    const newSize = this.controlBus.byteLength * 2 >>> 0;
    const newBuffer = this.controlBus.buffer.transfer(newSize);
    this.controlBus = new Uint8Array(newBuffer);
    this.controlAdapter = new DataView(newBuffer);
  }
  // ========== 栈操作 (STACK OPERATIONS) ==========
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
  push(handler, value) {
    const meta = this.extractMetadata(handler, this.metadata);
    if ((meta.occupied + 1) * this.wordSize > meta.byteCapacity) return false;
    this.writer(meta.dataAddress + meta.occupied * this.wordSize, value, IS_LITTLE_ENDIAN);
    this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, meta.occupied + 1, IS_LITTLE_ENDIAN);
    return true;
  }
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
  pop(handler) {
    const meta = this.extractMetadata(handler, this.metadata);
    if (meta.occupied === 0) return void 0;
    this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, meta.occupied - 1, IS_LITTLE_ENDIAN);
    return this.reader(meta.dataAddress + (meta.occupied - 1) * this.wordSize, IS_LITTLE_ENDIAN);
  }
  /**
   * 返回最后占用的元素而不将其移除。
   *
   * @param {number} handler - 块句柄。
   * @returns {number|undefined} 最后占用的值，如果块为空则返回 `undefined`。
   * @throws {Error} 如果句柄无效或已损坏。
   */
  peek(handler) {
    const meta = this.extractMetadata(handler, this.metadata);
    if (meta.occupied === 0) return void 0;
    return this.reader(meta.dataAddress + (meta.occupied - 1) * this.wordSize, IS_LITTLE_ENDIAN);
  }
  // ========== 队列操作 (QUEUE OPERATIONS) ==========
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
  nudge(handler, value) {
    const meta = this.extractMetadata(handler, this.metadata);
    if ((meta.occupied + 1) * this.wordSize > meta.byteCapacity) return false;
    this.dataBus.copyWithin(meta.dataAddress + this.wordSize, meta.dataAddress, meta.dataAddress + meta.occupied * this.wordSize);
    this.writer(meta.dataAddress, value, IS_LITTLE_ENDIAN);
    this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, meta.occupied + 1, IS_LITTLE_ENDIAN);
    return true;
  }
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
  pull(handler) {
    const meta = this.extractMetadata(handler, this.metadata);
    if (meta.occupied === 0) return void 0;
    const result = this.reader(meta.dataAddress, IS_LITTLE_ENDIAN);
    this.dataBus.copyWithin(meta.dataAddress, meta.dataAddress + this.wordSize, meta.dataAddress + meta.occupied * this.wordSize);
    this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, meta.occupied - 1, IS_LITTLE_ENDIAN);
    return result;
  }
  /**
   * 返回第一个占用的元素而不将其移除。
   *
   * @param {number} handler - 块句柄。
   * @returns {number|undefined} 第一个占用的值，如果块为空则返回 `undefined`。
   * @throws {Error} 如果句柄无效或已损坏。
   */
  head(handler) {
    const meta = this.extractMetadata(handler, this.metadata);
    if (meta.occupied === 0) return void 0;
    return this.reader(meta.dataAddress, IS_LITTLE_ENDIAN);
  }
  // ========== 随机访问 (RANDOM ACCESS) ==========
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
  has(handler, value) {
    const meta = this.extractMetadata(handler, this.metadata);
    if (meta.occupied === 0) return false;
    const rawAddres = meta.dataAddress >>> this.wordShift;
    return this.auxiliary.subarray(rawAddres, rawAddres + meta.occupied).includes(value);
  }
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
  get(handler, index) {
    const meta = this.extractMetadata(handler, this.metadata);
    if (index < 0 || index >= meta.occupied) return void 0;
    return this.reader(meta.dataAddress + index * this.wordSize, IS_LITTLE_ENDIAN);
  }
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
  set(handler, index, value) {
    const meta = this.extractMetadata(handler, this.metadata);
    if (index < 0 || index >= meta.occupied) return false;
    this.writer(meta.dataAddress + index * this.wordSize, value, IS_LITTLE_ENDIAN);
    return true;
  }
  // ============= 杂项 (MISCELLANEOUS) ===============
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
  clear(handler, value = 0) {
    const meta = this.extractMetadata(handler, this.metadata);
    const slots = meta.byteCapacity / this.wordSize;
    const rawAddress = meta.dataAddress >>> this.wordShift;
    this.auxiliary.fill(value, rawAddress, rawAddress + slots);
    this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, 0, IS_LITTLE_ENDIAN);
  }
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
   * 用一个值填充块的所有物理槽位，并将整个容量标记为已占用。
   *
   * 与 `clear()` 不同，该操作会产生一个完全被占用的块。
   *
   * @param {number} handler - 块句柄。
   * @param {number} value - 用于填充的值。
   * @returns {void}
   * @throws {Error} 如果句柄无效或已损坏。
   */
  fillAll(handler, value) {
    const meta = this.extractMetadata(handler, this.metadata);
    const rawAddress = meta.dataAddress >>> this.wordShift;
    const capacityElements = meta.byteCapacity / this.wordSize;
    this.auxiliary.fill(value, rawAddress, rawAddress + capacityElements);
    this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, capacityElements, IS_LITTLE_ENDIAN);
  }
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
      const actual = data?.constructor?.name ?? (data === null ? "null" : typeof data);
      throw new TypeError(`data must be Array or TypedArray, but ${actual} was given.`);
    }
    this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, meta.occupied, IS_LITTLE_ENDIAN);
  }
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
  pick(handler) {
    const meta = this.extractMetadata(handler, this.metadata);
    const rawAddress = meta.dataAddress >>> this.wordShift;
    if (meta.occupied === 0) {
      return this.auxiliary.slice(rawAddress, rawAddress);
    }
    return this.auxiliary.slice(rawAddress, rawAddress + meta.occupied);
  }
  // ======== 按槽位计算的容量 (CAPACITY IN SLOTS) ==========
  /**
   * 返回块以字节为单位的物理容量。
   *
   * 容量对应于为块中所有槽位预留的空间，无论当前占用了多少元素。
   *
   * @param {number} handler - 块句柄。
   * @returns {number} 块的物理容量（以字节为单位）。
   * @throws {Error} 如果句柄无效或已损坏。
   */
  byteSize(handler) {
    const meta = this.extractMetadata(handler, this.metadata);
    return meta.byteCapacity;
  }
  /**
   * 返回块中当前占用的元素数量。
   *
   * @param {number} handler - 块句柄。
   * @returns {number} 已占用元素的数量。
   * @throws {Error} 如果句柄无效或已损坏。
   */
  occupied(handler) {
    const meta = this.extractMetadata(handler, this.metadata);
    return meta.occupied;
  }
  /**
   * 返回以元素数量计算的块容量。
   *
   * 该值对应物理预留槽位的总数，而不是当前占用的数量。
   *
   * @param {number} handler - 块句柄。
   * @returns {number} 块中可用的槽位总数。
   * @throws {Error} 如果句柄无效或已损坏。
   */
  length(handler) {
    const meta = this.extractMetadata(handler, this.metadata);
    return 1 << meta.capacityExponent >>> 0;
  }
  // ========== 块间操作 (Inter-block Operations) =============
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
  copy(source, destiny, slots = UNKNOWN) {
    const metaA = {};
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
  copyWithin(handler, target, start, length) {
    const meta = this.extractMetadata(handler, this.metadata);
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
      this.dataBus.copyWithin(targetAddress, sourceAddress, sourceAddress + count * this.wordSize);
    } else {
      this.dataBus.copyWithin(targetAddress, sourceAddress, sourceAddress + count * this.wordSize);
    }
    this.controlAdapter.setUint32(metaTarget.headerAddress + OCCUPIED_OFFSET, metaTarget.occupied + count, IS_LITTLE_ENDIAN);
    return count;
  }
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
  swap(source, target) {
    const metaA = {};
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
  // ============= 序列化 (SERIALIZATION) ==============
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
    return (0, import_cbor_x.encode)({
      v: 1,
      wordType: this.wordType,
      capacity,
      occupied: meta.occupied,
      le: IS_LITTLE_ENDIAN,
      payload
    });
  }
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
  load(serialized) {
    if (!(serialized instanceof ArrayBuffer) && !(serialized instanceof Uint8Array)) {
      throw new TypeError("serialized must be an ArrayBuffer or Uint8Array");
    }
    const envelope = (0, import_cbor_x.decode)(serialized);
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
  // ============= 工具 (UTILITIES) ==============
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
  extractMetadata(handler, out) {
    out.generation = handler / ROTATE_32BITS & CLAMP_11BITS;
    out.headerAddress = handler >>> 0;
    const cookie = this.controlAdapter.getUint8(out.headerAddress + COOKIE_OFFSET);
    if (cookie !== this.bakeCookie(out.headerAddress, out.generation)) {
      throw new Error("Invalid or corrupted handle");
    }
    out.dataAddress = this.controlAdapter.getUint32(out.headerAddress + ADDRESS_OFFSET, IS_LITTLE_ENDIAN);
    out.capacityExponent = this.controlAdapter.getUint8(out.headerAddress + CAPACITY_OFFSET);
    out.byteCapacity = (1 << out.capacityExponent >>> 0) * this.wordSize;
    out.occupied = this.controlAdapter.getUint32(out.headerAddress + OCCUPIED_OFFSET, IS_LITTLE_ENDIAN);
    return out;
  }
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
  bakeCookie(addr, gen) {
    return (addr ^ gen & 2047 * 2654435761) & 255 || 1;
  }
  /**
   * 返回当前存储在回收列表中的区域数量。
   *
   * 每个区域对应一个无法直接归还给 `dataBus`顶部的已释放块，
   * 因此保留下来以便未来容量相同的分配进行重用。
   *
   * @returns {number} `recycle` 中维护的空闲区域数量。
   */
  recycleCount() {
    let count = 0;
    for (const [, page] of this.recycle) {
      count += page[0];
    }
    return count;
  }
  /**
   * 返回当前存储在回收列表中的区域所属的字节总数。
   *
   * 该值通过将每个空闲区域的容量乘以针对该容量注册的区域数量相加来计算。
   *
   * @returns {number} 可回收区域占用的字节数。
   */
  get recycleBytes() {
    let total = 0;
    for (const [capacity, page] of this.recycle) {
      total += page[0] * capacity;
    }
    return total;
  }
  /**
   * 返回不属于当前可回收区域的已分配字节数。
   *
   * 该值通过从 `dataPointer` 的总推进量中减去 `recycle` 中维护的空闲区域所属的字节来获得。
   *
   * @returns {number} `dataBus` 已使用区域内与不可回收区域关联的字节数。
   */
  get allocatedBytes() {
    return this.dataPointer - this.recycleBytes;
  }
  /**
   * 返回 `dataBus` 顶部尚未使用的字节数。
   *
   * 此空间对应于 `dataPointer` 与当前为缓冲区预留容量末尾之间的区域。
   * @returns {number} `dataPointer` 之后的可用字节数。
   */
  get unallocatedBytes() {
    return this.size - this.dataPointer;
  }
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
  get fragmentationRatio() {
    if (this.dataPointer === 0) return 0;
    return this.recycleBytes / this.dataPointer;
  }
};
module.exports = { Balloc };
