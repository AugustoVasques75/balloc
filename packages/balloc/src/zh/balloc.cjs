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
var FLAGS_OFFSET = 10 >>> 0;
var VIEW_LOCK = 1 >>> 0;
var ROTATE_32BITS = 4294967296;
var CLAMP_11BITS = 2047 >>> 0;
var isTypedArray = (val) => ArrayBuffer.isView(val) && !(val instanceof DataView);
var Balloc = class {
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
    this.size = Math.max(1 << 32 - Math.clz32(size - 1) >>> 0, this.wordSize);
    this.headerSize = 1 << 32 - Math.clz32(metadataSize - 1) >>> 0;
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
    this.controlBus[headerAddress + FLAGS_OFFSET] = 0;
    return (this.generation & CLAMP_11BITS) * ROTATE_32BITS + headerAddress;
  }
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
  realloc(handler) {
    const generation = handler / ROTATE_32BITS & CLAMP_11BITS;
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
    if (capacity >= 31) throw new AggregateError([new Error("Can\xB4t reallocate handler."), new RangeError("Capacity has reached its limit.")], "Internal Error.");
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
  shrink(handler) {
    const meta = this.extractMetadata(handler, this.metadata);
    if (meta.borrowed) throw new Error("Block is borrowed");
    const newCapacity = Math.max(1, 32 - Math.clz32(Math.max(2, meta.occupied) - 1));
    if (newCapacity >= meta.capacityExponent) return;
    const oldBlockSize = meta.byteCapacity;
    const newBlockSize = 2 ** newCapacity * this.wordSize;
    const oldEnd = meta.dataAddress + oldBlockSize;
    this.controlAdapter.setUint8(meta.headerAddress + CAPACITY_OFFSET, newCapacity);
    if (oldEnd === this.dataPointer) {
      this.dataPointer = meta.dataAddress + newBlockSize;
      return;
    }
    let address = meta.dataAddress + newBlockSize;
    for (let exponent = newCapacity; exponent < meta.capacityExponent; exponent++) {
      const segmentSize = 2 ** exponent * this.wordSize;
      this.recyclePush(segmentSize, address);
      address += segmentSize;
    }
  }
  free(handler) {
    const generation = handler / ROTATE_32BITS & CLAMP_11BITS;
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
  // ========== 回收 (RECYCLING) ==========
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
   * 按请求的确切容量进行查找。当存在对应的页面时，从该页面中移除并返回最后注册的地址，
   * 从而将回收实现为 LIFO（后进先出）栈。
   *
   * @param {number} capacity - 期望的容量（以字节为单位）。
   * @returns {number} 可回收区域的起始地址，若不存在具有请求容量的区域则返回 `UNKNOWN`。
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
  // ========== 扩容 (SCALING) ==========
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
  grow() {
    this.assertNoActiveViews();
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
   * 将 `controlBus` 的容量扩展为当前的两倍。
   *
   * 底层缓冲区被转移到一个更大的 `ArrayBuffer` 中，同时保留现有标头。
   * `controlAdapter` 被重新创建以引用新的存储空间。
   *
   * @returns {void}
   * @throws {RangeError} 如果当前的 `controlBus` 容量已超过支持的最大限制。
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
  push(handler, value) {
    const meta = this.extractMetadata(handler, this.metadata);
    if (meta.borrowed) throw new Error("Block is borrowed");
    if ((meta.occupied + 1) * this.wordSize > meta.byteCapacity) return false;
    this.writer(meta.dataAddress + meta.occupied * this.wordSize, value, IS_LITTLE_ENDIAN);
    this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, meta.occupied + 1, IS_LITTLE_ENDIAN);
    return true;
  }
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
  pop(handler) {
    const meta = this.extractMetadata(handler, this.metadata);
    if (meta.borrowed) throw new Error("Block is borrowed");
    if (meta.occupied === 0) return void 0;
    this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, meta.occupied - 1, IS_LITTLE_ENDIAN);
    return this.reader(meta.dataAddress + (meta.occupied - 1) * this.wordSize, IS_LITTLE_ENDIAN);
  }
  /**
   * 返回最后一个占用的元素，但不将其移除。
   *
   * @param {number} handler - 块句柄。
   * @returns {number|undefined} 最后一个占用的值，若块为空则返回 `undefined`。
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
  pull(handler) {
    const meta = this.extractMetadata(handler, this.metadata);
    if (meta.borrowed) throw new Error("Block is borrowed");
    if (meta.occupied === 0) return void 0;
    const result = this.reader(meta.dataAddress, IS_LITTLE_ENDIAN);
    this.dataBus.copyWithin(meta.dataAddress, meta.dataAddress + this.wordSize, meta.dataAddress + meta.occupied * this.wordSize);
    this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, meta.occupied - 1, IS_LITTLE_ENDIAN);
    return result;
  }
  /**
   * 返回第一个占用的元素，但不将其移除。
   *
   * @param {number} handler - 块句柄。
   * @returns {number|undefined} 第一个占用的值，若块为空则返回 `undefined`。
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
   * 该查找直接在辅助 `TypedArray` 上执行，并且仅考虑当前占用的范围，
   * 而不是整个预留的物理容量。
   *
   * @param {number} handler - 块句柄。
   * @param {number} value - 要查找的值。
   * @returns {boolean} 如果 `value` 存在于占用元素中则为 `true`，否则为 `false`。
   * @throws {Error} 如果句柄无效或已损坏。
   */
  has(handler, value) {
    const meta = this.extractMetadata(handler, this.metadata);
    if (meta.occupied === 0) return false;
    const rawAddres = meta.dataAddress >>> this.wordShift;
    return this.auxiliary.subarray(rawAddres, rawAddres + meta.occupied).includes(value);
  }
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
  indexOf(handler, searchElement, fromIndex = 0) {
    const meta = this.extractMetadata(handler, this.metadata);
    if (meta.occupied === 0) return -1;
    const rawAddres = meta.dataAddress >>> this.wordShift;
    return this.auxiliary.subarray(rawAddres, rawAddres + meta.occupied).indexOf(searchElement, fromIndex);
  }
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
  lastIndexOf(handler, searchElement, fromIndex = -1) {
    const meta = this.extractMetadata(handler, this.metadata);
    if (meta.occupied === 0) return -1;
    const rawAddres = meta.dataAddress >>> this.wordShift;
    return this.auxiliary.subarray(rawAddres, rawAddres + meta.occupied).lastIndexOf(searchElement, fromIndex);
  }
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
  get(handler, index) {
    const meta = this.extractMetadata(handler, this.metadata);
    if (index < 0 || index >= meta.occupied) return void 0;
    return this.reader(meta.dataAddress + index * this.wordSize, IS_LITTLE_ENDIAN);
  }
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
  set(handler, index, value) {
    const meta = this.extractMetadata(handler, this.metadata);
    if (meta.borrowed) throw new Error("Block is borrowed");
    if (index < 0 || index >= meta.occupied) return false;
    this.writer(meta.dataAddress + index * this.wordSize, value, IS_LITTLE_ENDIAN);
    return true;
  }
  // ============= 杂项 (MISCELLANEOUS) ==============
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
  clear(handler, value = 0) {
    const meta = this.extractMetadata(handler, this.metadata);
    if (meta.borrowed) throw new Error("Block is borrowed");
    const slots = meta.byteCapacity / this.wordSize;
    const rawAddress = meta.dataAddress >>> this.wordShift;
    this.auxiliary.fill(value, rawAddress, rawAddress + slots);
    this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, 0, IS_LITTLE_ENDIAN);
  }
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
   * 用某个值填满块的所有物理槽位，并将整个容量标记为已占用。
   *
   * 与 `clear()` 不同，该操作产生的是一个完全占用的块。
   *
   * @param {number} handler - 块句柄。
   * @param {number} value - 用于填充的值。
   * @returns {void}
   * @throws {Error} 如果句柄无效、已损坏，或者块正通过 withView() 被借用。
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
      const actual = data?.constructor?.name ?? (data === null ? "null" : typeof data);
      throw new TypeError(`data must be Array or TypedArray, but ${actual} was given.`);
    }
    this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, Math.max(length, meta.occupied), IS_LITTLE_ENDIAN);
  }
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
  pick(handler) {
    const meta = this.extractMetadata(handler, this.metadata);
    const rawAddress = meta.dataAddress >>> this.wordShift;
    if (meta.occupied === 0) {
      return this.auxiliary.slice(rawAddress, rawAddress);
    }
    return this.auxiliary.slice(rawAddress, rawAddress + meta.occupied);
  }
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
  withView(...args) {
    if (args.length < 2) throw new TypeError("At least one handler and one callback are required");
    const lastIndex = args.length - 1;
    const callback = args[lastIndex];
    if (typeof callback !== "function") throw new TypeError("callback must be a function");
    const lookup = /* @__PURE__ */ Object.create(null);
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
        views.push(this.auxiliary.subarray(rawAddress, rawAddress + metadata.occupied));
      }
      return callback(...views);
    } finally {
      for (let i = 0; i < acquired.length; i++) {
        this.controlBus[acquired[i] + FLAGS_OFFSET] &= ~VIEW_LOCK;
      }
    }
  }
  // ======== 槽位容量 (CAPACITY IN SLOTS) ==========
  /**
   * 返回块的物理容量（以字节为单位）。
   *
   * 容量对应于为块中所有槽位预留的空间，无论当前占用了多少个元素。
   *
   * @param {number} handler - 块句柄。
   * @returns {number} 块的物理容量，以字节为单位。
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
   * @returns {number} 已占用元素数量。
   * @throws {Error} 如果句柄无效或已损坏。
   */
  occupied(handler) {
    const meta = this.extractMetadata(handler, this.metadata);
    return meta.occupied;
  }
  /**
   * 返回以元素数量表示的块容量。
   *
   * 该值对应于物理预留的总槽位数，而不是当前占用的数量。
   *
   * @param {number} handler - 块句柄。
   * @returns {number} 块中可用的槽位总数。
   * @throws {Error} 如果句柄无效或已损坏。
   */
  length(handler) {
    const meta = this.extractMetadata(handler, this.metadata);
    return 1 << meta.capacityExponent >>> 0;
  }
  /**
   * 检查内存块是否已达到其分配容量。
   *
   * 当占用元素数量等于其分配的总容量、且没有剩余位置可存储新元素时，块被视为已满。
   *
   * @param {number} handler - 块句柄。
   * @returns {boolean} 如果块已满则为 `true`，否则为 `false`。
   * @throws {Error} 如果句柄无效或已损坏。
   */
  isFull(handler) {
    const meta = this.extractMetadata(handler, this.metadata);
    return (1 << meta.capacityExponent >>> 0) - meta.occupied === 0;
  }
  // ========== 块间操作 (Operations between blocks)=============
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
  copy(source, destination, slots = UNKNOWN) {
    const metaA = {};
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
  swap(source, target) {
    const metaA = {};
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
  // ============= 序列化 (SERIALIZATION) ==============
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
   * 解码 CBOR 信封，验证序列化数据的字类型是否与当前的分配器实例兼容，
   * 并分配一个能够容纳该内容所需容量的新块。随后，在新的块中恢复原始数据和占用数。
   *
   * @param {Uint8Array|ArrayBuffer} serialized - 包含序列化数据的缓冲区。
   * @returns {number} 重新创建的新块的句柄。
   * @throws {Error} 如果解码数据的字类型与分配器配置的不一致。
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
  // ========== 数据集成与导入 ==========
  /**
   * 将数据导入委托给指定的适配器。
   *
   * 此操作为同步操作。适配器必须在返回前完成数据导入；如果加载过程中发生错误，适配器负责回滚自身的分配。
   *
   * @param {FormatAdapter} adapter - 实现 load(allocator) 的适配器。
   * @returns {number} 适配器返回的句柄。
   * @throws {TypeError} 适配器未实现 load() 方法时。
   */
  loadData(adapter) {
    if (!adapter || typeof adapter.load !== "function") throw new TypeError("adapter must implement load(allocator)");
    return adapter.load(this);
  }
  // ============= 工具 (UTILITIES) ==============
  /**
   * 防止对已借用的块进行修改操作。
   *
   * 检查与所提供地址关联的标头中的 VIEW_LOCK 标志。
   *
   * @param {number} headerAddress - controlBus 中的标头地址。
   * @returns {void}
   * @throws {Error} 如果块正通过 withView() 被借用。
   * @private
   * @deprecated
  */
  assertNotBorrowed(headerAddress) {
    if (this.controlBus[headerAddress + FLAGS_OFFSET] & VIEW_LOCK) {
      throw new Error("Block is borrowed");
    }
  }
  /**
   * 防止在存在任何借用片段时替换或重新映射 dataBus 的操作。
   *
   * @returns {void}
   * @throws {Error} 如果有任何块通过 withView() 被借用。
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
    out.borrowed = this.controlAdapter.getUint32(out.headerAddress + FLAGS_OFFSET, IS_LITTLE_ENDIAN) & VIEW_LOCK;
    return out;
  }
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
  bakeCookie(addr, gen) {
    return (addr ^ gen & 2047 * 2654435761) & 255 || 1;
  }
  /**
   * 返回当前存储在回收列表中的区域数量。
   *
   * 每个区域对应一个无法直接交还给 `dataBus` 顶部的释放块，
   * 因此它仍然可供未来相同容量的分配进行复用。
   *
   * @returns {number} 保存在 `recycle` 中的空闲区域数量。
   */
  recycleCount() {
    let count = 0;
    for (const [, page] of this.recycle) {
      count += page[0];
    }
    return count;
  }
  /**
   * 返回当前存储在回收列表中的区域所属的总字节数。
   *
   * 该值是通过将每个空闲区域的容量乘以该容量注册的区域数量相加来计算的。
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
   * 该值是通过从 `dataPointer` 的总推进量中减去保存在 `recycle` 中的空闲区域所属的字节数来获取的。
   *
   * @returns {number} 在 `dataBus` 已使用区域内，与不可回收区域关联的字节数。
   */
  get allocatedBytes() {
    return this.dataPointer - this.recycleBytes;
  }
  /**
   * 返回 `dataBus` 顶部尚未使用的字节数。
   *
   * 此空间对应于 `dataPointer` 与当前为缓冲区预留容量末尾之间的区域。
   * @returns {number} `dataPointer` 之后可用的字节数。
   */
  get unallocatedBytes() {
    return this.size - this.dataPointer;
  }
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
  get fragmentationRatio() {
    if (this.dataPointer === 0) return 0;
    return this.recycleBytes / this.dataPointer;
  }
};
module.exports = { Balloc };
