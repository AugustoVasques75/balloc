您也可以获取其他语言版本的文档：
| 语言 | 链接 |
|---|---|
| 阿拉伯语 | [API — balloc.ar.md](./docs/API%20—%20balloc.ar.md) |
| 中文 | [API — balloc.zh.md](./docs/API%20—%20balloc.zh.md) |
| 西班牙语 | [API — balloc.es.md](./docs/API%20—%20balloc.es.md) |
| 英语 | [API — balloc.en.md](./docs/API%20—%20balloc.en.md) |
| 日语 | [API — balloc.jp.md](./docs/API%20—%20balloc.jp.md) |
| 葡萄牙语 | [API — balloc.pt.md](./docs/API%20—%20balloc.pt.md) |

# Balloc.js

`Balloc` 是一种基于 **bump allocation（指针递增分配）** 的内存分配器，具有两条相互独立的总线：

- `dataBus` — 存储数据块的数据。
- `controlBus` — 存储 header（头部）和元数据。

数据块在外部通过一个 **43 位逻辑句柄** 标识，该句柄由 11 位 generation（代数）和 32 位 header 地址组成。数据块的物理容量始终是元素数量上的 2 的幂。

## API 本体结构

```text
Balloc
├── 实例化
│   └── constructor()
├── 数据块生命周期
│   ├── alloc()
│   ├── realloc()
│   ├── free()
│   └── gc()
├── 线性结构
│   ├── Stack
│   │   ├── push()
│   │   ├── pop()
│   │   └── peek()
│   └── Queue
│       ├── nudge()
│       ├── pull()
│       └── head()
├── 内容访问
│   ├── has()
│   ├── get()
│   ├── set()
│   ├── clear()
│   ├── fill()
│   ├── fillAll()
│   ├── put()
│   └── pick()
├── 容量与占用量
│   ├── byteSize()
│   ├── occupied()
│   └── length()
├── 数据块间操作
│   ├── copy()
│   ├── copyWithin()
│   ├── append()
│   ├── clone()
│   └── swap()
├── 序列化
│   ├── dump()
│   └── load()
├── 诊断与使用情况
│   ├── recycleCount()
│   ├── recycleBytes
│   ├── allocatedBytes
│   ├── unallocatedBytes
│   └── fragmentationRatio
└── 内部使用
    ├── 回收
    │   ├── recyclePush()
    │   └── recyclePop()
    ├── 扩容
    │   ├── grow()
    │   └── headerGrow()
    └── 工具方法
        ├── extractMetadata()
        └── bakeCookie()
```

---

## 容量语义

逻辑容量单位取决于 `bucketSize`。

```text
bucketSize = "8i"  或 bucketSize = "8u"                         → 每个元素 1 字节
bucketSize = "16i" 或 bucketSize = "16u" 或 bucketSize = "16f"  → 每个元素 2 字节
bucketSize = "32i" 或 bucketSize = "32u" 或 bucketSize = "32f"  → 每个元素 4 字节
bucketSize = "64i" 或 bucketSize = "64u" 或 bucketSize = "64f"  → 每个元素 8 字节
```

分配器先将元素容量计算为 2 的幂，再将该容量换算为字节数。

例如，`bucketSize = "32u"` 时：

```text
capacity = 8 个元素
wordSize = 4 字节

byteCapacity = 8 × 4 = 32 字节
```

物理容量与占用量是两个不同的概念：

```text
length(handler)    → 物理槽位数
occupied(handler)  → 已占用槽位数
byteSize(handler)  → 实际预留的物理字节数
```

---

# 1. 实例化

## `new Balloc(size, bucketSize, metadataSize)`

创建一个新的分配器。

存储空间分为 `dataBus` 和 `controlBus`：前者用于存放数据块数据，后者用于存放 headers。二者的初始容量都会根据内部扩容策略进行取整。

### 参数

| 参数 | 类型 | 默认值 | 说明 |
|---|---|---:|---|
| `size` | `number` | `65535` | `dataBus` 的初始容量，单位为字节。 |
| `bucketSize` | `BucketType` | — | 每个元素的类型和大小。 |
| `metadataSize` | `number` | `1024` | `controlBus` 的初始容量，单位为字节。 |

`size` 必须是安全整数，范围为 `[2, 0x80000000]`。

`bucketSize` 接受 `BucketType` 类型的字符串，格式为 `[位宽][数据类型]`，且仅允许下表中的值：

| 有符号整数 | 无符号整数 | 浮点数 |
|---|---|---|
| `8i` | `8u` | — |
| `16i` | `16u` | `16f` |
| `32i` | `32u` | `32f` |
| `64i` | `64u` | `64f` |

`metadataSize` 必须是安全整数，范围为 `[16, 0x80000000]`。

### 异常

- `RangeError` — `size` 超出允许范围。
- `RangeError` — `bucketSize` 不属于 `BucketType` 定义的值。
- `RangeError` — `metadataSize` 超出允许范围。

### 示例

```js
const { Balloc } = require("Balloc");

const memory = new Balloc();
```

若要使用 32 位无符号元素：

```js
const memory = new Balloc(65535, "32u");
```

构造函数会根据 `bucketSize` 在内部实例化相应的 `TypedArray`，并创建用于读写操作的 `DataView`。

---

# 2. 数据块生命周期

数据块的基本生命周期如下：

```text
alloc()
   │
   ├── 对数据块执行操作
   │
   ├── realloc()
   │
   └── free()
          │
          └── 回收
```

回收机制可以重新利用已释放的区域，但只有容量与新分配需求完全匹配的区域才可直接复用。

## `alloc(size = 16)`

分配一个新数据块并返回其句柄。

容量会向上取整为能够容纳 `size` 个元素的最小 2 的幂。系统首先在可回收区域列表中查找合适区域；如果不存在匹配区域，则从 `dataBus` 的末端分配空间。

### 参数

| 参数 | 类型 | 默认值 | 说明 |
|---|---|---:|---|
| `size` | `number` | `16` | 所需元素数的下限。 |

`size` 必须在 `[2, 0x80000000]` 范围内。

### 返回值

```text
number
```

数据块句柄。

句柄的逻辑结构如下：

```text
[ 11 位 generation ][ 32 位 header 地址 ]
```

### 示例

```js
const handler = memory.alloc(100);

memory.push(handler, 42);
```

申请 100 个元素并不意味着恰好预留 100 个槽位；实际容量会取整为大于或等于 100 的最小 2 的幂。

---

## `realloc(handler)`

将数据块容量扩展至下一个 2 的幂。

如果数据块位于当前 `dataBus` 的末端，则可执行 **原地扩容（in-place）**。否则，系统会从回收机制或堆末端取得新区域，复制已占用的元素，然后回收旧区域。

由于 header 保持不变，句柄也不会改变。

### 参数

| 参数 | 类型 | 说明 |
|---|---|---|
| `handler` | `number` | 数据块句柄。 |

### 返回值

```text
void
```

### 异常

- `Error` — 句柄无效或已损坏。
- `AggregateError` — 容量已达到最大限制。

### 示例

```js
const handler = memory.alloc(8);

memory.realloc(handler);
```

该操作会将物理容量加倍，扩展到下一个 2 的幂。

---

## `free(handler)`

释放数据块。

通过将 cookie 清零使 header 失效。数据区域的处理方式如下：

- 如果该区域不位于 `dataBus` 末端，则将其放回回收池；
- 如果该区域是堆中最近分配的区域，则直接回退堆末端指针。

### 参数

| 参数 | 类型 | 说明 |
|---|---|---|
| `handler` | `number` | 数据块句柄。 |

### 返回值

```text
void
```

### 异常

当句柄无效或已损坏时抛出 `Error`。

```js
memory.free(handler);
```

释放后的句柄不再有效。

---

## `gc()`

通过 **ReBump** 算法压缩 `dataBus`。

该操作遍历 `controlBus` 中现存的 headers，将仍然有效的数据块复制到新的 `dataBus`，并更新 headers 中记录的数据地址。数据块之间的空闲区域将被消除。

### 影响

- 清除 `recycle` 中的所有区域；
- 压缩仍然存活的数据块；
- 保留 headers 的顺序；
- 保留数据块的物理容量；
- 保留数据块的占用量；
- 更新数据块地址；
- 将 `dataPointer` 移至最后一个存活数据块之后。

### 返回值

```text
void
```

### 复杂度

遍历 headers 的时间复杂度为 `O(n)`，其中 `n` 是检查的 header 数量。总成本还取决于需要搬移的数据量。

```js
memory.gc();
```

`gc()` 不会更改句柄，因为 headers 仍位于原地址；它只压缩数据区域。

---

# 3. 线性数据结构

数据块可用作从两端进行访问的线性结构。

## 3.1 Stack（栈）

### `push(handler, value)`

将 `value` 添加到已占用序列的末尾。

如果没有可用空间，则不会插入元素，方法返回 `false`。

```js
memory.push(handler, 10);
memory.push(handler, 20);
memory.push(handler, 30);
```

返回值：

```text
boolean
```

- `true` — 元素已插入。
- `false` — 数据块已满。

---

### `pop(handler)`

移除并返回最后一个已占用元素。

该操作会先递减占用量，再读取元素。原有字节不会被清除。

返回值：

```text
number | undefined
```

数据块为空时返回 `undefined`。

```js
const value = memory.pop(handler);
```

---

### `peek(handler)`

返回最后一个已占用元素，但不将其移除。

返回值：

```text
number | undefined
```

---

## 3.2 Queue（队列）

### `nudge(handler, value)`

在已占用序列的开头插入一个元素。

现有元素会向后移动一个位置。该操作的开销与已占用元素的数量成正比。

返回值：

```text
boolean
```

- `true` — 元素已插入。
- `false` — 数据块已满。

---

### `pull(handler)`

移除并返回第一个元素。

其余元素会向序列开头方向移动一个位置。

返回值：

```text
number | undefined
```

---

### `head(handler)`

返回第一个元素，但不将其移除。

返回值：

```text
number | undefined
```

---

# 4. 内容访问

## `has(handler, value)`

检查 `value` 是否存在于已占用元素中。

搜索使用辅助 `TypedArray`，并且只检查 `[0, occupied)` 范围，忽略尚未占用的物理容量。

```js
if (memory.has(handler, 42)) {
    // ...
}
```

返回值：

```text
boolean
```

---

## `get(handler, index)`

获取指定索引处的元素。

索引从零开始。索引不在 `[0, occupied)` 范围内时返回 `undefined`。

```js
const value = memory.get(handler, 3);
```

返回值：

```text
number | undefined
```

---

## `set(handler, index, value)`

替换已占用位置上的元素。

该操作不会改变占用量。

索引不在 `[0, occupied)` 范围内时会被忽略，方法返回 `false`。

```js
memory.set(handler, 3, 99);
```

返回值：

```text
boolean
```

- `true` — 值已写入。
- `false` — 索引不属于已占用区域。

---

## `clear(handler, value = 0)`

将占用量清零，并使用 `value` 填充数据块的**所有物理槽位**。

这也包括原本不属于已占用序列的槽位。

```js
memory.clear(handler);
```

操作完成后：

```text
occupied = 0
```

物理容量保持不变。

---

## `fill(handler, value, start = 0, end = null)`

使用 `value` 填充一个槽位区间。

区间遵循以下约定：

```text
[start, end)
```

`start` 为包含端点，`end` 为不包含端点。`end` 为 `null` 时，结束位置默认为物理总容量。操作后，占用量将变为 `end`。

```js
memory.fill(handler, 0, 2, 6);
```

填充的索引为：

```text
2, 3, 4, 5
```

### 异常

以下情况会抛出 `RangeError`：

- `start < 0`；
- `start > capacity`；
- `end < 0`；
- `end > capacity`；
- `start > end`。

---

## `fillAll(handler, value)`

使用 `value` 填充所有物理槽位，并将整个容量标记为已占用。

该操作等价于填充整个容量，然后设置：

```text
occupied = capacity
```

与 `clear()` 不同，操作完成后数据块处于完全占用状态。

```js
memory.fillAll(handler, 0);
```

---

## `put(handler, data)`

将一个 `Array` 或 `TypedArray` 复制到数据块开头。

复制数量不会超过数据块容量。操作后的占用量为原占用量与实际复制数量中的较大值。因此，当输入序列较短时，`put()` 不会降低现有占用量。

```js
memory.put(handler, [10, 20, 30, 40]);
```

也接受 `TypedArray`：

```js
memory.put(handler, new Uint32Array([10, 20, 30]));
```

### 接受的类型

```text
Array
TypedArray
```

### 异常

当 `data` 既不是 `Array` 也不是 `TypedArray` 时，抛出 `TypeError`。

---

## `pick(handler)`

返回当前所有已占用元素的副本。

返回的 `TypedArray` 类型与分配器配置的 `bucketSize` 对应。不包含尚未占用的物理容量。

```js
const values = memory.pick(handler);
```

返回结果拥有独立于 `dataBus` 的存储空间。

例如，当分配器的 `bucketSize = "32u"` 时，结果将使用 `Uint32Array` 存储。

---

# 5. 容量与占用量

## `byteSize(handler)`

返回数据块的物理容量，单位为字节。

它并不表示当前已占用元素对应的字节数，而是表示为该数据块全部槽位预留的空间。

```js
const bytes = memory.byteSize(handler);
```

---

## `occupied(handler)`

返回当前已占用的元素数量。

```js
const count = memory.occupied(handler);
```

---

## `length(handler)`

返回可用物理槽位的总数。

容量与占用量相互独立：

```text
length >= occupied
```

```js
const capacity = memory.length(handler);
```

---

# 6. 数据块间操作

## `copy(source, destiny, slots = UNKNOWN)`

将 `source` 中已占用的元素复制到 `destiny` 的开头。

实际复制数量受以下因素限制：

1. `source` 的占用量；
2. `destiny` 的容量；
3. `slots`。

必要时会增加 `destiny` 的占用量，但不会改变其容量。

```js
memory.copy(source, destiny);
```

指定复制数量：

```js
memory.copy(source, destiny, 8);
```

### 返回值

```text
Uint8Array
```

返回操作后的 `dataBus` 本身。

---

## `copyWithin(handler, target, start, length)`

在同一数据块内部复制一个区域。

其语义遵循 `Array.prototype.copyWithin()` 的概念，但操作范围是数据块的物理容量，并且源区域的读取受当前占用量限制。

```js
memory.copyWithin(handler, 4, 0, 4);
```

负索引按相对于容量末端的位置解释。

该操作：

- 支持源区域与目标区域重叠；
- 将索引限制在容量范围内；
- 将读取范围限制在已占用区域内；
- 将写入范围限制在容量范围内；
- 可能增加 `occupied`。

返回值：

```text
Uint8Array
```

即 `dataBus`。

---

## `append(target, source)`

将 `source` 中已占用的元素追加到 `target` 的已占用元素末尾。

追加数量受源数据块的占用量和目标数据块的可用空间限制。

```js
const count = memory.append(target, source);
```

### 返回值

```text
number
```

实际追加的元素数量。

当 `target` 与 `source` 是同一数据块时，也支持如下调用：

```js
memory.append(handler, handler);
```

---

## `clone(handler)`

创建该数据块的独立副本。

克隆对象具有：

- 相同的物理容量；
- 相同的占用量；
- 相同的整个预留区域字节内容；
- 新的句柄。

```js
const copy = memory.clone(handler);
```

未占用区域中的内容也会被复制。

---

## `swap(source, target)`

交换两个句柄所关联的数据区域。

该操作会交换 headers 中的以下字段：

- 地址；
- 容量；
- 占用量。

不会在 `dataBus` 中复制任何字节。两个句柄仍然指向各自原有的 header。

```js
memory.swap(a, b);
```

概念上：

```text
交换前：

handler A → 区域 A
handler B → 区域 B

交换后：

handler A → 区域 B
handler B → 区域 A
```

---

# 7. 序列化

这些方法用于通过 CBOR 格式导出和导入数据块状态。

## `dump(handler)`

序列化由 `handler` 标识的内存数据块。

该方法提取数据块中已占用的数据，将其与容量和字长类型等信息封装到数据信封中，然后使用 CBOR 格式编码。

### 返回值

```text
Uint8Array
```

包含序列化数据块内容的缓冲区。

### 异常

`Error` — 句柄无效或已损坏。

---

## `load(serialized)`

从序列化数据中恢复内存数据块。

该方法解码 `serialized` 中的 CBOR 信封，验证序列化数据的字长类型是否与当前分配器实例兼容，然后分配一个容量足以容纳内容的新数据块。随后恢复数据和原始占用量。

### 返回值

```text
number
```

重新创建的数据块的新句柄。

### 异常

`Error` — 解码数据的字长类型与分配器配置不一致。

---

# 8. 诊断与使用情况

## `recycleCount()`

返回回收系统中当前存储的区域数量。

一个区域表示已释放、但无法直接从 `dataBus` 末端移除的内存范围。

```js
const count = memory.recycleCount();
```

---

## `recycleBytes`

Getter，返回当前所有可回收区域所占的总字节数。

```js
const bytes = memory.recycleBytes;
```

计算方式：

```text
Σ(capacity × 区域数量)
```

---

## `allocatedBytes`

Getter，返回当前不在回收列表中的区域所占字节数。

计算方式：

```text
dataPointer - recycleBytes
```

```js
const bytes = memory.allocatedBytes;
```

---

## `unallocatedBytes`

Getter，返回 `dataBus` 末端仍可使用的空间。

该空间位于 `dataPointer` 与已预留容量末端之间：

```text
size - dataPointer
```

```js
const bytes = memory.unallocatedBytes;
```

---

## `fragmentationRatio`

Getter，计算可回收字节数与 bump pointer 已经推进过的堆区域之间的比率。

```text
recycleBytes / dataPointer
```

当 `dataPointer` 为零时，结果为 `0`。

```js
const ratio = memory.fragmentationRatio;
```

该值衡量的是**已使用堆区域内部的碎片化程度**，而不是相对于 `dataBus` 总容量的碎片化程度。

---

# 9. 内部使用

本节中的方法属于 `Balloc` 的实现细节，并非面向调用方代码的公共接口。

```text
内部使用
├── 回收
│   ├── recyclePush()
│   └── recyclePop()
├── 扩容
│   ├── grow()
│   └── headerGrow()
└── 校验 / 元数据
    ├── extractMetadata()
    └── bakeCookie()
```

## 9.1 回收

### `recyclePush(capacity, address)`

**私有方法。**

将空闲区域按照其字节容量放入相应的回收列表。

每种容量都有一个由 `Uint32Array` 表示的页面：

```text
[count, address1, address2, ...]
```

该结构采用 LIFO（后进先出）栈。当页面填满时，其缓冲区容量会扩展为原来的两倍。

---

### `recyclePop(capacity)`

**私有方法。**

移除并返回一个容量完全匹配的可回收区域。

移除操作发生在页面末端，因此采用 LIFO 行为。

返回：

```text
address
```

如果该容量没有可用区域，则返回：

```js
UNKNOWN // 0xFFFFFFFF
```

---

## 9.2 扩容

### `grow()`

**私有方法。请勿直接调用。**

将 `dataBus` 的容量扩大一倍。

底层 `ArrayBuffer` 会转移到更大的缓冲区，并重新创建相关视图。

当新区域无法放入 `dataBus` 的剩余空间时，会自动触发此操作。

---

### `headerGrow()`

**私有方法。请勿直接调用。**

将 `controlBus` 的容量扩大一倍。

转移 `ArrayBuffer` 时会保留现有 headers，并在新存储上重新创建 `controlAdapter`。

当没有足够空间容纳新 header 时，会自动触发此操作。

---

## 9.3 校验与元数据

### `extractMetadata(handler, out)`

**私有方法。**

解码并验证句柄。

该方法提取：

```text
generation
headerAddress
dataAddress
capacityExponent
byteCapacity
occupied
```

通过重新计算 header 中存储的 cookie 来验证句柄。对象 `out` 可重复使用，以避免额外的内存分配。

签名：

```js
extractMetadata(handler, out)
```

返回值：

```text
Metadata
```

返回值就是传入的 `out` 引用本身。

---

### `bakeCookie(addr, gen)`

**私有方法。**

计算用于验证句柄的 cookie。

cookie 组合以下信息：

- header 地址；
- generation 的低 11 位。

结果被压缩为 8 位。值 `0` 保留用于表示无效 header，因此该方法会将计算结果中的 `0` 替换为 `1`。

该 cookie 不具备密码学安全性。它的用途是在分配器的内存管理模型中检测无效、过期（`stale`）或损坏的句柄。

---

# 10. 存储模型

每个数据块都有一个固定大小为 **16 字节** 的 header：

```text
偏移量  大小      字段
──────  ───────  ─────────────
0       4 字节    address
4       4 字节    occupied
8       1 字节    capacity
9       1 字节    cookie
10      6 字节    reserved
```

相关字段如下：

### `address`

`dataBus` 内数据区域的起始地址。

### `occupied`

当前已占用的元素数量。

### `capacity`

表示物理容量的 2 的幂指数：

```text
capacityElements = 2 ** capacity
```

以字节为单位的容量为：

```text
capacityBytes = 2 ** capacity × wordSize
```

### `cookie`

与 header 地址和句柄 generation 关联的校验值。

---

# 11. 句柄

句柄是几乎所有数据块操作使用的外部标识符。

其逻辑组成如下：

```text
┌───────────────────────┬───────────────────────────────┐
│ generation — 11 位    │ header 地址 — 32 位           │
└───────────────────────┴───────────────────────────────┘
```

低位部分直接对应 header 地址；高位部分表示 generation。

generation 参与 cookie 校验。因此，如果句柄无效或其 header 已失效，使用该句柄的操作就会报错。

---

# 12. 公共 API 摘要

| 类别 | 方法 / 属性 | 返回值 |
|---|---|---|
| 实例化 | `constructor()` | `Balloc` |
| 生命周期 | `alloc()` | `number` |
| 生命周期 | `realloc()` | `void` |
| 生命周期 | `free()` | `void` |
| 生命周期 | `gc()` | `void` |
| Stack | `push()` | `boolean` |
| Stack | `pop()` | `number \| undefined` |
| Stack | `peek()` | `number \| undefined` |
| Queue | `nudge()` | `boolean` |
| Queue | `pull()` | `number \| undefined` |
| Queue | `head()` | `number \| undefined` |
| 访问 | `has()` | `boolean` |
| 访问 | `get()` | `number \| undefined` |
| 访问 | `set()` | `boolean` |
| 访问 | `clear()` | `void` |
| 访问 | `fill()` | `void` |
| 访问 | `fillAll()` | `void` |
| 访问 | `put()` | `void` |
| 访问 | `pick()` | `TypedArray` |
| 容量 | `byteSize()` | `number` |
| 容量 | `occupied()` | `number` |
| 容量 | `length()` | `number` |
| 数据块 | `copy()` | `Uint8Array` |
| 数据块 | `copyWithin()` | `Uint8Array` |
| 数据块 | `append()` | `number` |
| 数据块 | `clone()` | `number` |
| 数据块 | `swap()` | `void` |
| 序列化 | `dump()` | `Uint8Array` |
| 序列化 | `load()` | `number` |
| 诊断 | `recycleCount()` | `number` |
| 诊断 | `recycleBytes` | `number` |
| 诊断 | `allocatedBytes` | `number` |
| 诊断 | `unallocatedBytes` | `number` |
| 诊断 | `fragmentationRatio` | `number` |

## 内部方法

| 组别 | 方法 | 可见性 |
|---|---|---|
| 回收 | `recyclePush()` | 私有 |
| 回收 | `recyclePop()` | 私有 |
| 扩容 | `grow()` | 私有 |
| 扩容 | `headerGrow()` | 私有 |
| 元数据 | `extractMetadata()` | 私有 |
| 校验 | `bakeCookie()` | 私有 |

