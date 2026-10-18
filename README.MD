📦 **[NPM Package](https://www.npmjs.com/package/balloc)** | 🔗 **[GitHub](https://github.com/AugustoVasques75/balloc)**

You can also find this documentation translated into other languages:
| Idioma | Link |
|---|---|
| Arabic | [README.ar.md](README.ar.md) |
| Chinese | [README.zh.md](README.zh.md) |
| Spanish | [README.es.md](README.es.md) |
| English | [README.en.md](README.en.md) |
| Japanese | [README.jp.md](README.jp.md) |
| Portuguese | [README.pt.md](README.pt.md) |

# Balloc.js

## A bump allocation memory allocator for JavaScript.

**`Balloc`** is an incremental memory allocator based on bump allocation that maintains contiguous data blocks identified by compact numeric handles.

## Motivation

The JavaScript/Node.js ecosystem has historically lacked low-level infrastructure for efficient Big Data processing such as parsing, editing, and continuous indexing of large volumes of CSV files, logs, and time series data, while the vast majority of data libraries available in the ecosystem use naive models based on reference graphs and dynamic allocation of object instances (`new Node()`). These approaches impose severe limitations such as:
* Heap and GC overhead, as the proliferation of millions of individual objects saturates V8's reference graph, causing unpredictable Garbage Collector pauses.
* Lack of layout control (AoS vs. SoA), where libraries ignore data organization as Array of Structures (AoS) or Structure of Arrays (SoA), resulting in high fragmentation and poor utilization of the CPU's L1/L2/L3 cache.
* Lack of primitives for building advanced storage engines such as Log-Structured Merge-trees, which require extremely high-throughput mutable write arenas followed by compacted immutability, something impractical on top of conventional JS abstractions.

Balloc was created to fill this engineering gap. It was conceived as a foundational memory allocation and low-abstraction dynamic arena management engine. By providing explicit control over contiguous memory layout through TypedArrays, Balloc provides the physical foundation required for the JavaScript ecosystem to support industrial-grade data structures such as LSM-Trees, MemTables, Quotient Filters, and Big Data processors, matching native approaches in C++, Rust, or Go in efficiency and predictability.


## Design

As a low-abstraction memory allocation engine and dynamic arena manager, **`Balloc`** was designed to fit into the JavaScript runtime without competing with JavaScript's native high-level data structures (such as `Object`, `Map`, or `Array`), instead operating at the immediately lower layer to provide **deterministic, high-performance contiguous memory management** without overloading the environment's *Garbage Collector*.

The allocator combines three mechanisms:

```text
                  ┌─────────────────┐
                  │     Balloc      │
                  └────────┬────────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
          ▼                ▼                ▼
     Bump allocation   Recycling       Compaction
          │                │                │
     Fast sequential  Reuse of freed regions  ReBump / gc()
       sequencial      liberadas

```

* The bump allocator provides sequential allocation on top of `dataBus`.
* The recycling system allows previously freed regions to be reused when their capacity matches a new allocation.
* `gc()` performs explicit compaction when the *heap* contains fragmented free regions.

This gives the allocator a simple memory model while maintaining explicit control over capacity, occupancy, recycling, and compaction, because `Balloc` separates the data block from the metadata block.

```text
                    Balloc
                       │
             ┌─────────┴─────────┐
             │                   │
          dataBus            controlBus
             │                   │
         conteúdo             headers

```

* `dataBus` contains the set of data blocks.


* `controlBus` contains the set of fixed-size headers that serve as descriptors for the data blocks.

Each block is externally identified by a 43-bit logical handle:

```text
┌───────────────────────┬───────────────────────────────┐
│ generation — 11 bits  │ header address — 32 bits     │
└───────────────────────┴───────────────────────────────┘

```

The handle itself does not directly contain the address of the data block. It identifies the block header, which in turn contains the data address, capacity, and block occupancy.

The generation is used by the allocator's *cookie* validation mechanism to detect invalid, stale, or corrupted handles.

## Installation

In Node.js, install the following NPM package:

```bash
npm install Balloc

```

In Bun, install:

```bash
bun add Balloc

```

In Deno, install:

```bash
deno add npm:Balloc

```

Using Yarn:

```bash
yarn add Balloc

```

In HTML, use the unpkg CDN:

```text
https://unpkg.com/Balloc

```

Or use its localized docstring versions for some languages:

```
Arabic:    https://unpkg.com/Balloc/src/ar/Balloc.mjs
English:   https://unpkg.com/Balloc/src/en/Balloc.mjs
Spanish: https://unpkg.com/Balloc/src/es/Balloc.mjs
Japanese:  https://unpkg.com/Balloc/src/jp/Balloc.mjs
Chinese:   https://unpkg.com/Balloc/src/zh/Balloc.mjs

```

Ou ainda utilize o CDN jsDelivr:

```text
https://cdn.jsdelivr.net/npm/Balloc

```

CDNs with localization support:

```
Arabic:    https://cdn.jsdelivr.net/npm/Balloc/src/ar/Balloc.mjs
English:   https://cdn.jsdelivr.net/npm/Balloc/src/en/Balloc.mjs
Spanish: https://cdn.jsdelivr.net/npm/Balloc/src/es/Balloc.mjs
Japanese:  https://cdn.jsdelivr.net/npm/Balloc/src/jp/Balloc.mjs
Chinese:   https://cdn.jsdelivr.net/npm/Balloc/src/zh/Balloc.mjs

```

## Basic usage

ESM:

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

CJS:

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

## Getting started

The constructor is:

```js
new Balloc(size, bucketSize, metadataSize)

```

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `size` | `number` | `65535` | Initial `dataBus` capacity in bytes |
| `bucketSize` | `BucketType` | `32u` | Element size in bits |
| `metadataSize` | `number` | `1024` | Initial `controlBus` capacity in bytes |

Example:

```js
const memory = new Balloc();

```

For 32-bit unsigned integer elements:

```js
const memory = new Balloc(65535, "32u");

```

`size` must be an integer in the range `[2, 0x80000000]`.

`bucketSize` must be a `BucketType`, a string in the format `[size in bits][data type]`, with the following accepted values:

| Signed Integer | Unsigned Integer | Float |
| --- | --- | --- |
| `8i` | `8u` |  |
| `16i` | `16u` |  |
| `32i` | `32u` | `32f` |
| `64i` | `64u` | `64f` |

*The half-precision type (`16f`), being a recent addition still undergoing consolidation in JavaScript specifications and runtimes, is not yet guaranteed to be supported by Balloc. Although the type is present in the library, its availability may be uncertain for use in your project.*

`metadataSize` must be an integer in the range `[16, 0x80000000]`.

The allocation size of a block is rounded up to the smallest power of two capable of accommodating the requested number of elements.

Por exemplo:

```js
const handler = memory.alloc(100);

```

does not necessarily create a block with exactly 100 physical slots. The allocator reserves a capacity that is a power of two.

Conceptually:

```text
requested:   100 elements
capacity:    128 elements

```

Physical capacity and logical occupancy are distinct:

```text
length(handler)     → physical capacity
occupied(handler)   → occupied elements
byteSize(handler)   → reserved physical bytes

```

This distinction allows a block to contain fewer occupied elements than its physical capacity.

## API

The fundamental lifecycle of a block is:

```text
alloc()
   │
   ├── acesso / modificação
   │
   ├── realloc()
   │
   └── free()
          │
          └── recycle

```

Balloc provides several data-view models for a block:

* Stack


* Queue


* Array / Random Access


The complete API documentation is available in the [`./docs`](./docs) directory and is available translated into several languages:

| Idioma | Link |
|---|---|
| Arabic | [./docs/API — balloc.ar.md](./docs/API%20—%20balloc.ar.md) |
| Chinese | [./docs/API — balloc.zh.md](./docs/API%20—%20balloc.zh.md) |
| Spanish | [./docs/API — balloc.es.md](./docs/API%20—%20balloc.es.md) |
| English | [./docs/API — balloc.en.md](./docs/API%20—%20balloc.en.md) |
| Japanese | [./docs/API — balloc.ja.md](./docs/API%20—%20balloc.ja.md) |
| Portuguese | [./docs/API — balloc.pt.md](./docs/API%20—%20balloc.pt.md) |


The API methods are grouped by affinity into the following categories:

* Lifecycle
* Stack operations
* Queue operations
* Array operations
* Block interchange
* Serialization
* Diagnostics
* Internal functions

The following is a summary of these groups:

### Lifecycle

| API | Description |
| --- | --- |
| `alloc()` | Allocate a block |
| `realloc()` | Increase block capacity |
| `free()` | Free a block |
| `gc()` | Compact the data heap |

### Stack operations

| API | Description |
| --- | --- |
| `push()` | Add an element |
| `pop()` | Remove the last element |
| `peek()` | Read the last element |

### Queue operations

| API | Description |
| --- | --- |
| `nudge()` | Insert at the beginning |
| `pull()` | Remove the first element |
| `head()` | Read the first element |

### Array operations

| API | Description |
| --- | --- |
| `has()` | Search for a value |
| `get()` | Read an element |
| `set()` | Write an element |
| `clear()` | Clear occupancy and fill the block |
| `fill()` | Fill a range |
| `fillAll()` | Fill and occupy the entire block |
| `put()` | Copy an array into a block |
| `pick()` | Copy occupied elements out of a block |

### Block interchange

| API | Description |
| --- | --- |
| `copy()` | Copy between blocks |
| `copyWithin()` | Copy within a block |
| `append()` | Append one block to another |
| `clone()` | Create an independent copy of the block |
| `swap()` | Swap block regions |

### Serialization

| API | Description |
| --- | --- |
| `dump()` | Serialize the block contents as CBOR |
| `load()` | Restore a block from serialized data |

### Diagnostics

| API | Description |
| --- | --- |
| `byteSize()` | Physical block size in bytes |
| `occupied()` | Number of occupied elements |
| `length()` | Physical element capacity |
| `recycleCount()` | Number of recyclable regions |
| `recycleBytes` | Currently recyclable bytes |
| `allocatedBytes` | Bytes associated with non-recycled regions |
| `unallocatedBytes` | Space remaining after the bump pointer |
| `fragmentationRatio` | Recycled bytes / used heap area |

### Internal functions

These are a special class of API primarily used internally by the allocator and generally not recommended for day-to-day code, as they may cause undocumented side effects. They are intended for library extensions and modifications where a thorough understanding of the Balloc source code is essential.

```text
Recirculation
├── recyclePush()
└── recyclePop()

Growth
├── grow()
└── headerGrow()

Validation / metadata
├── extractMetadata()
└── bakeCookie()

```

`recyclePush()` inserts a free block into the recycling list.

`recyclePop()` removes a free block from the recycling list and returns it.

`grow()` expands `dataBus` when the current region can no longer satisfy additional allocations.

`headerGrow()` expands `controlBus` when additional headers are required.

`extractMetadata()` decodes and validates a handle and extracts its associated metadata.

`bakeCookie()` calculates a validation cookie used by the handle validation mechanism.

## 💖 Donations / Support

If you like this project and want to support its development:

| Pix QR Code | Copy-and-Paste / Random Key |
| :---: | :--- |
| <img src="./img/pix.png" alt="Pix QR Code" width="200"> | **Random Key:**<br>`e87d773a-0b97-4410-8fc3-f7ec04cce6a2` |

## License

[MIT](./LICENSE)
