此文档也提供以下语言的译本：

| 语言 | 链接 |
|---|---|
| 阿拉伯语 | [README.ar.md](README.ar.md) |
| 中文 | [README.zh.md](README.zh.md) |
| 西班牙语 | [README.es.md](README.es.md) |
| 英语 | [README.en.md](README.en.md) |
| 日语 | [README.jp.md](README.jp.md) |
| 葡萄牙语 | [README.pt.md](README.pt.md) |

# Balloc.js

## 面向 JavaScript 的 bump allocation 内存分配器

**`Balloc`** 是一种基于 bump allocation（指针递增分配）的增量式内存分配器。它管理连续的数据块，并通过紧凑的数值句柄标识这些数据块。

## 设计动机

长期以来，JavaScript/Node.js 生态系统一直缺少面向底层的大数据处理基础设施，难以高效地持续解析、编辑和索引大型 CSV、日志及时间序列数据。生态系统中绝大多数数据处理库采用基于引用图的简单模型，并通过动态分配字面对象（`new Node()`）管理数据。这类方案存在严重局限：

* **堆与 GC 开销：** 大量独立对象会使 V8 的引用图膨胀，导致垃圾回收器出现不可预测的停顿。
* **缺乏内存布局控制（AoS 与 SoA）：** 许多库忽视 Array of Structures（AoS，结构体数组）和 Structure of Arrays（SoA，数组结构体）等数据组织方式，造成较高的内存碎片，并严重降低 CPU L1/L2/L3 缓存的利用率。
* **缺少构建高级存储引擎所需的原语：** 构建 Log-Structured Merge Tree 等存储引擎，需要吞吐量极高的可变写入区域，以及后续的不可变压缩过程。仅依赖常规 JavaScript 抽象很难实现这一点。

Balloc 旨在填补这一工程空白。它被设计为底层内存分配与动态内存区域（arena）管理引擎。通过 TypedArray 显式控制连续内存布局，Balloc 为 JavaScript 生态系统构建工业级数据结构提供物理基础，例如 LSM Tree、MemTable、Quotient Filter 和大数据处理器；其目标是在效率与可预测性方面媲美 C++、Rust 或 Go 的原生实现。

## 设计

作为底层内存分配与动态内存区域管理引擎，**`Balloc`** 的设计旨在适配 JavaScript 运行时，而非与 `Object`、`Map` 或 `Array` 等 JavaScript 原生高层数据结构竞争。它工作在更底层，提供**确定性、高性能的连续内存管理**，同时避免给运行环境的垃圾回收器带来过重负担。

该分配器结合了三种机制：

```text
                  ┌─────────────────┐
                  │     Balloc      │
                  └────────┬────────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
          ▼                ▼                ▼
      bump allocation     回收再利用       内存压缩
          │                │                │
      快速顺序分配       重用已释放区域     ReBump / gc()
```

* bump allocator 在 `dataBus` 上执行顺序分配。
* 回收机制会在已释放区域的容量满足新分配请求时，将其重新利用。
* 当堆中存在碎片化的空闲区域时，`gc()` 会显式执行压缩。

Balloc 将数据块与元数据块分离，使内存模型保持简单，同时显式控制容量、占用量、回收再利用和压缩。

```text
                    Balloc
                       │
             ┌─────────┴─────────┐
             │                   │
          dataBus            controlBus
             │                   │
          数据内容               头部
```

* `dataBus` 存放数据块。
* `controlBus` 存放固定大小的头部（header），用于描述数据块。

每个数据块在外部通过一个 43 位逻辑句柄进行标识：

```text
┌───────────────────────┬───────────────────────────────┐
│ 代次 — 11 位          │ 头部地址 — 32 位              │
└───────────────────────┴───────────────────────────────┘
```

句柄本身不直接包含数据块地址，而是标识该数据块的头部。头部中记录数据地址、容量和占用量。

代次用于分配器的 Cookie 校验机制，以检测无效、过期或损坏的句柄。

## 安装

在 Node.js 中安装以下 NPM 包：

```bash
npm install Balloc
```

在 Bun 中安装：

```bash
bun add Balloc
```

在 Deno 中安装：

```bash
deno add npm:Balloc
```

使用 Yarn 安装：

```bash
yarn add Balloc
```

在 HTML 中可通过 unpkg CDN 使用：

```text
[https://unpkg.com/Balloc](https://unpkg.com/Balloc)
```

也可以使用带有本地化 docstring 的版本，目前提供以下语言：

```text
阿拉伯语： [https://unpkg.com/Balloc/src/ar/Balloc.mjs](https://unpkg.com/Balloc/src/ar/Balloc.mjs)
英语：     [https://unpkg.com/Balloc/src/en/Balloc.mjs](https://unpkg.com/Balloc/src/en/Balloc.mjs)
西班牙语： [https://unpkg.com/Balloc/src/es/Balloc.mjs](https://unpkg.com/Balloc/src/es/Balloc.mjs)
日语：     [https://unpkg.com/Balloc/src/jp/Balloc.mjs](https://unpkg.com/Balloc/src/jp/Balloc.mjs)
中文：     [https://unpkg.com/Balloc/src/zh/Balloc.mjs](https://unpkg.com/Balloc/src/zh/Balloc.mjs)
```

也可以使用 jsDelivr CDN：

```text
[https://cdn.jsdelivr.net/npm/Balloc](https://cdn.jsdelivr.net/npm/Balloc)
```

支持本地化的 CDN 地址如下：

```text
阿拉伯语： [https://cdn.jsdelivr.net/npm/Balloc/src/ar/Balloc.mjs](https://cdn.jsdelivr.net/npm/Balloc/src/ar/Balloc.mjs)
英语：     [https://cdn.jsdelivr.net/npm/Balloc/src/en/Balloc.mjs](https://cdn.jsdelivr.net/npm/Balloc/src/en/Balloc.mjs)
西班牙语： [https://cdn.jsdelivr.net/npm/Balloc/src/es/Balloc.mjs](https://cdn.jsdelivr.net/npm/Balloc/src/es/Balloc.mjs)
日语：     [https://cdn.jsdelivr.net/npm/Balloc/src/jp/Balloc.mjs](https://cdn.jsdelivr.net/npm/Balloc/src/jp/Balloc.mjs)
中文：     [https://cdn.jsdelivr.net/npm/Balloc/src/zh/Balloc.mjs](https://cdn.jsdelivr.net/npm/Balloc/src/zh/Balloc.mjs)
```

## 基本用法

ESM：

```js
import Balloc from "Balloc";

const memory = new Balloc();

const handler = memory.alloc(100);

memory.push(handler, 10);
memory.push(handler, 20);
memory.push(handler, 30);

console.log(memory.length(handler));
console.log(memory.occupied(handler));

console.log(memory.pop(handler));
console.log(memory.pop(handler));

memory.free(handler);
```

CJS：

```js
const Balloc = require("Balloc").default;

const memory = new Balloc();

const handler = memory.alloc(100);

memory.push(handler, 10);
memory.push(handler, 20);
memory.push(handler, 30);

console.log(memory.length(handler));
console.log(memory.occupied(handler));

console.log(memory.pop(handler));
console.log(memory.pop(handler));

memory.free(handler);
```

## 快速入门

构造函数如下：

```js
new Balloc(size, bucketSize, metadataSize)
```

| 参数 | 类型 | 默认值 | 说明 |
|---|---|---:|---|
| `size` | `number` | `65535` | `dataBus` 的初始容量，单位为字节 |
| `bucketSize` | `BucketType` | `32u` | 单个元素的位宽 |
| `metadataSize` | `number` | `1024` | `controlBus` 的初始容量，单位为字节 |

示例：

```js
const memory = new Balloc();
```

使用 32 位无符号整数元素：

```js
const memory = new Balloc(65535, "32u");
```

`size` 必须是范围为 `[2, 0x80000000]` 的整数。

`bucketSize` 必须是 `BucketType`，即格式为 `[位宽][数据类型]` 的字符串。支持的值如下：

| 有符号整数 | 无符号整数 | 浮点数 |
|---|---|---|
| `8i` | `8u` |  |
| `16i` | `16u` |  |
| `32i` | `32u` | `32f` |
| `64i` | `64u` | `64f` |

半精度浮点类型（`16f`）是 JavaScript 规范和运行时中新近加入、仍处于逐步成熟阶段的类型，因此 Balloc 尚不能保证对其提供支持。即使该类型已存在于库中，在具体项目中能否使用仍存在不确定性。

`metadataSize` 必须是范围为 `[16, 0x80000000]` 的整数。

数据块的分配大小会向上取整为能够容纳所请求元素数量的最小 2 的幂。

例如：

```js
const handler = memory.alloc(100);
```

这并不意味着一定会创建恰好包含 100 个物理槽位的数据块。分配器会预留一个容量为 2 的幂的数据块。

概念上：

```text
请求数量：100 个元素
容量：    128 个元素
```

物理容量与逻辑占用量是两个不同的概念：

```text
length(handler)     → 物理容量
occupied(handler)  → 已占用的元素数量
byteSize(handler)  → 实际预留的物理字节数
```

因此，数据块的已占用元素数量可以小于其物理容量。

## API

数据块的基本生命周期如下：

```text
alloc()
   │
   ├── 访问／修改
   │
   ├── realloc()
   │
   └── free()
          │
          └── 回收再利用
```

Balloc 提供以下几种数据访问模型：

* 栈（Stack）
* 队列（Queue）
* 数组／随机访问

完整 API 文档位于 [`./docs`](./docs) 目录，并提供多种语言的译本：

| 语言 | 链接 |
|---|---|
| 阿拉伯语 | [./docs/API — balloc.ar.md](./docs/API%20—%20balloc.ar.md) |
| 中文 | [./docs/API — balloc.zh.md](./docs/API%20—%20balloc.zh.md) |
| 西班牙语 | [./docs/API — balloc.es.md](./docs/API%20—%20balloc.es.md) |
| 英语 | [./docs/API — balloc.en.md](./docs/API%20—%20balloc.en.md) |
| 日语 | [./docs/API — balloc.ja.md](./docs/API%20—%20balloc.ja.md) |
| 葡萄牙语 | [./docs/API — balloc.pt.md](./docs/API%20—%20balloc.pt.md) |

API 方法按功能归为以下类别：

* 生命周期管理
* 栈操作
* 队列操作
* 数组操作
* 数据块间交换
* 序列化
* 诊断
* 内部函数

各类别概述如下。

### 生命周期管理

| API | 说明 |
|---|---|
| `alloc()` | 分配数据块 |
| `realloc()` | 扩展数据块容量 |
| `free()` | 释放数据块 |
| `gc()` | 压缩数据堆 |

### 栈操作

| API | 说明 |
|---|---|
| `push()` | 添加元素 |
| `pop()` | 移除最后一个元素 |
| `peek()` | 读取最后一个元素 |

### 队列操作

| API | 说明 |
|---|---|
| `nudge()` | 在队列头部插入元素 |
| `pull()` | 移除队列首元素 |
| `head()` | 读取队列首元素 |

### 数组操作

| API | 说明 |
|---|---|
| `has()` | 搜索指定值 |
| `get()` | 读取元素 |
| `set()` | 写入元素 |
| `clear()` | 清除占用状态并填充数据块 |
| `fill()` | 填充指定范围 |
| `fillAll()` | 填充整个数据块并将其全部标记为已占用 |
| `put()` | 将数组复制到数据块 |
| `pick()` | 将已占用的元素复制出数据块 |

### 数据块间交换

| API | 说明 |
|---|---|
| `copy()` | 在数据块之间复制 |
| `copyWithin()` | 在同一数据块内复制 |
| `append()` | 将一个数据块追加到另一个数据块 |
| `clone()` | 创建数据块的独立副本 |
| `swap()` | 交换数据块中的区域 |

### 序列化

| API | 说明 |
|---|---|
| `dump()` | 将数据块内容序列化为 CBOR |
| `load()` | 从序列化数据中恢复数据块 |

### 诊断

| API | 说明 |
|---|---|
| `byteSize()` | 返回数据块的物理大小，单位为字节 |
| `occupied()` | 返回已占用的元素数量 |
| `length()` | 返回物理容量（元素数量） |
| `recycleCount()` | 返回可回收区域的数量 |
| `recycleBytes` | 当前可回收的字节数 |
| `allocatedBytes` | 已分配给非回收区域的字节数 |
| `unallocatedBytes` | bump 指针之后的剩余空间 |
| `fragmentationRatio` | 可回收字节数／已使用堆区域 |

### 内部函数

内部函数属于特殊 API，主要供分配器内部使用。由于可能产生未文档化的副作用，通常不建议在日常业务代码中调用。它们面向对 Balloc 源码有充分理解、需要扩展或修改库的开发者。

```text
循环回收
├── recyclePush()
└── recyclePop()

扩容
├── grow()
└── headerGrow()

验证／元数据
├── extractMetadata()
└── bakeCookie()
```

`recyclePush()` 将空闲数据块加入回收列表。

`recyclePop()` 从回收列表中移除一个空闲数据块并将其返回。

当当前区域无法满足后续分配请求时，`grow()` 会扩展 `dataBus`。

当需要更多头部空间时，`headerGrow()` 会扩展 `controlBus`。

`extractMetadata()` 解码并验证句柄，然后提取与之关联的元数据。

`bakeCookie()` 计算供句柄验证机制使用的校验 Cookie。

## 💖 捐赠与支持

如果您喜欢这个项目并希望支持其开发：

| Pix 二维码 | 复制粘贴密钥／随机密钥 |
| :---: | :--- |
| ![Pix QR Code](./img/pix.png) | **随机密钥：**<br>`e87d773a-0b97-4410-8fc3-f7ec04cce6a2` |

## 许可证

[MIT](./LICENSE)