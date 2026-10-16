You can also get this documentation translated into other languages:
| Language | Link |
|---|---|
| Arabic | [API — balloc.ar.md](./docs/API%20—%20balloc.ar.md) |
| Chinese | [API — balloc.zh.md](./docs/API%20—%20balloc.zh.md) |
| Spanish | [API — balloc.es.md](./docs/API%20—%20balloc.es.md) |
| English | [API — balloc.en.md](./docs/API%20—%20balloc.en.md) |
| Japanese | [API — balloc.jp.md](./docs/API%20—%20balloc.jp.md) |
| Portuguese | [API — balloc.pt.md](./docs/API%20—%20balloc.pt.md) |

# Balloc.js

`Balloc` is a memory allocator based on **bump allocation**, featuring two independent buses:

* `dataBus` — storage for block data.
* `controlBus` — storage for headers and metadata.

Blocks are externally identified by a **43-bit logical handler**, composed of an 11-bit generation and a 32-bit header address. The physical capacity of the blocks is always a power of two in number of elements.

## API Ontology

```text
Balloc
├── Instantiation
│   └── constructor()
│
├── Block Lifecycle
│   ├── alloc()
│   ├── realloc()
│   ├── free()
│   └── gc()
│
├── Linear Structures
│   ├── Stack
│   │   ├── push()
│   │   ├── pop()
│   │   └── peek()
│   │
│   └── Queue
│       ├── nudge()
│       ├── pull()
│       └── head()
│
├── Content Access
│   ├── has()
│   ├── get()
│   ├── set()
│   ├── clear()
│   ├── fill()
│   ├── fillAll()
│   ├── put()
│   └── pick()
│
├── Capacity and Occupancy
│   ├── byteSize()
│   ├── occupied()
│   └── length()
│
├── Inter-block Operations
│   ├── copy()
│   ├── copyWithin()
│   ├── append()
│   └── clone()
│   └── swap()
│
├── Serialization
│   ├── dump()
│   └── load()
│
├── Diagnostics and Utilization
│   ├── recycleCount()
│   ├── recycleBytes
│   ├── allocatedBytes
│   ├── unallocatedBytes
│   └── fragmentationRatio
│
└── Internal Usage
    ├── Recycling
    │   ├── recyclePush()
    │   └── recyclePop()
    │
    ├── Scaling
    │   ├── grow()
    │   └── headerGrow()
    │
    └── Utilities
        ├── extractMetadata()
        └── bakeCookie()

```

---

## Capacity Semantics

The logical capacity unit depends on `bucketSize`.

```text
bucketSize = "8i"  or bucketSize = "8u"                         → 1 byte  per element
bucketSize = "16i" or bucketSize = "16u" or bucketSize = "16f"  → 2 bytes per element
bucketSize = "32i" or bucketSize = "32u" or bucketSize = "32f"  → 4 bytes per element
bucketSize = "64i" or bucketSize = "64u" or bucketSize = "64f"  → 8 bytes per element

```

The allocator computes capacity in **elements** as a power of two and subsequently converts this capacity into bytes.

For example, with `bucketSize = "32u"`:

```text
capacity = 8 elements
wordSize = 4 bytes

byteCapacity = 8 × 4 = 32 bytes

```

Physical capacity and occupancy are distinct concepts:

```text
length(handler)    → physical slots
occupied(handler)  → occupied slots
byteSize(handler)  → reserved physical bytes

```

---

# 1. Instantiation

## `new Balloc(size, bucketSize, metadataSize)`

Creates a new allocator.

Storage is split between `dataBus`, intended for block data, and `controlBus`, intended for headers. The initial capacity of both is rounded according to the internal growth strategy.

### Parameters

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `size` | `number` | `65535` | Initial capacity of `dataBus`, in bytes. |
| `bucketSize` | `BucketType` | Size of each element. |  |
| `metadataSize` | `number` | `1024` | Initial capacity of `controlBus`, in bytes. |

`size` must be a safe integer within the range `[2, 0x80000000]`.

`bucketSize` accepts a `BucketType` value which is a string in the format `[Size in bytes][data type]`, accepting only values from the table:

| Signed Integer | Unsigned Integer | Float |
| --- | --- | --- |
| `8i` | `8u` |  |
| `16i` | `16u` | `16f` |
| `32i` | `32u` | `32f` |
| `64i` | `64u` | `64f` |

`metadataSize` must be a safe integer within the range `[16, 0x80000000]`.

### Exceptions

* `RangeError` — `size` out of range.
* `RangeError` — `bucketSize` different from those defined by `BucketType`.
* `RangeError` — `metadataSize` out of the permitted range.

### Example

```js
const { Balloc } = require("Balloc");

const memory = new Balloc();

```

To use 32-bit unsigned elements:

```js
const memory = new Balloc(65535, "32u");

```

The constructor internally instantiates the `TypedArray` corresponding to `bucketSize`, alongside the `DataView`s used for reading and writing.

---

# 2. Block Lifecycle

The fundamental cycle of a block is:

```text
alloc()
   │
   ├── block operations
   │
   ├── realloc()
   │
   └── free()
          │
          └── recycling

```

Recycling allows reusing freed regions with a capacity that exactly matches the new allocation.

## `alloc(size = 16)`

Allocates a new block and returns its handler.

Capacity is rounded up to the smallest power of two that can accommodate `size` elements. The block is searched first in the list of recyclable regions; if no compatible region exists, space is obtained from the top of the `dataBus`.

### Parameters

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `size` | `number` | `16` | Minimum desired number of elements. |

`size` must be within the range `[2, 0x80000000]`.

### Return

```text
number

```

Block handler.

The handler has the logical form:

```text
[ 11 generation bits ][ 32 header address bits ]

```

### Example

```js
const handler = memory.alloc(100);

memory.push(handler, 42);

```

A request for 100 elements does not reserve exactly 100 slots: capacity will be the next power of two.

---

## `realloc(handler)`

Increases block capacity to the next power of two.

If the block is located at the current top of the `dataBus`, expansion occurs **in-place**. Otherwise, a new region is obtained from the recycling system or the heap top, occupied elements are copied, and the previous region is recycled.

The handler does not change, as its header is preserved.

### Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `handler` | `number` | Block handler. |

### Return

```text
void

```

### Exceptions

* `Error` — invalid or corrupted handler.
* `AggregateError` — capacity has reached the maximum limit.

### Example

```js
const handler = memory.alloc(8);

memory.realloc(handler);

```

The operation doubles physical capacity, moving to the next power of two.

---

## `free(handler)`

Frees a block.

The header is invalidated by zeroing its cookie. The data region is:

* returned to recycling when it is not at the top of the `dataBus`;
* removed directly from the top when it is the most recent region on the heap.

### Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `handler` | `number` | Block handler. |

### Return

```text
void

```

### Exceptions

`Error` when the handler is invalid or corrupted.

```js
memory.free(handler);

```

A freed handler is no longer valid.

---

## `gc()`

Compacts the `dataBus` via the **ReBump** algorithm.

The operation traverses existing headers on the `controlBus`, copies only still-valid blocks to a new `dataBus`, and updates their addresses in the headers. Free spaces between blocks are eliminated.

### Effects

* eliminates all regions present in `recycle`;
* compacts live blocks;
* preserves header order;
* preserves physical block capacity;
* preserves occupancy;
* updates block addresses;
* repositions `dataPointer` after the last live block.

### Return

```text
void

```

### Complexity

Header traversal is `O(n)`, where `n` is the number of headers examined. Total cost also depends on the volume of data moved.

```js
memory.gc();

```

`gc()` does not alter handlers, as headers remain at the same addresses; only data regions are compacted.

---

# 3. Linear Structures

Blocks can be used as linear structures accessed from the extremities.

## 3.1 Stack

### `push(handler, value)`

Adds `value` to the end of the occupied sequence.

If space is unavailable, no element is inserted and the method returns `false`.

```js
memory.push(handler, 10);
memory.push(handler, 20);
memory.push(handler, 30);

```

Return:

```text
boolean

```

* `true` — element inserted.
* `false` — block full.

---

### `pop(handler)`

Removes and returns the last occupied element.

Occupancy is decremented before element reading. Old bytes are not cleared.

Return:

```text
number | undefined

```

`undefined` indicates an empty block.

```js
const value = memory.pop(handler);

```

---

### `peek(handler)`

Returns the last occupied element without removing it.

Return:

```text
number | undefined

```

---

## 3.2 Queue

### `nudge(handler, value)`

Inserts an element at the beginning of the occupied sequence.

Existing elements are shifted forward by one position. The operation is proportional to the number of occupied elements.

Return:

```text
boolean

```

* `true` — element inserted.
* `false` — block full.

---

### `pull(handler)`

Removes and returns the first element.

Remaining elements are shifted one position toward the beginning.

Return:

```text
number | undefined

```

---

### `head(handler)`

Returns the first element without removing it.

Return:

```text
number | undefined

```

---

# 4. Content Access

## `has(handler, value)`

Checks whether `value` is among the occupied elements.

The search uses the auxiliary `TypedArray` and considers only `[0, occupied)`, ignoring unoccupied physical capacity.

```js
if (memory.has(handler, 42)) {
    // ...
}

```

Return:

```text
boolean

```

---

## `get(handler, index)`

Gets the element at the specified index.

Zero-based index. Indices outside `[0, occupied)` return `undefined`.

```js
const value = memory.get(handler, 3);

```

Return:

```text
number | undefined

```

---

## `set(handler, index, value)`

Replaces the element at an occupied index.

Occupancy is not modified.

Indices outside `[0, occupied)` are ignored and cause the method to return `false`.

```js
memory.set(handler, 3, 99);

```

Return:

```text
boolean

```

* `true` — value written.
* `false` — invalid index for the occupied region.

---

## `clear(handler, value = 0)`

Zeros occupancy and fills **all physical slots** of the block with `value`.

This includes slots that were not part of the occupied sequence.

```js
memory.clear(handler);

```

After the operation:

```text
occupied = 0

```

Physical capacity remains unchanged.

---

## `fill(handler, value, start = 0, end = null)`

Fills a range of slots with `value`.

The range follows the convention:

```text
[start, end)

```

`start` is inclusive and `end` is exclusive. When `end` is `null`, the limit is the total physical capacity. Occupancy becomes `end`.

```js
memory.fill(handler, 0, 2, 6);

```

Fills:

```text
2, 3, 4, 5

```

### Exceptions

`RangeError` when:

* `start < 0`;
* `start > capacity`;
* `end < 0`;
* `end > capacity`;
* `start > end`.

---

## `fillAll(handler, value)`

Fills all physical slots with `value` and marks the entire capacity as occupied.

Equivalent to filling the entire capacity followed by setting:

```text
occupied = capacity

```

Unlike `clear()`, the block ends up fully occupied.

```js
memory.fillAll(handler, 0);

```

---

## `put(handler, data)`

Copies an `Array` or `TypedArray` to the beginning of the block.

The amount copied is limited to block capacity. Occupancy becomes the greater value between prior occupancy and the amount actually copied. Therefore, `put()` does not reduce existing occupancy when receiving a smaller sequence.

```js
memory.put(handler, [10, 20, 30, 40]);

```

Also accepts `TypedArray`:

```js
memory.put(handler, new Uint32Array([10, 20, 30]));

```

### Accepted Types

```text
Array
TypedArray

```

### Exceptions

`TypeError` when `data` is neither `Array` nor `TypedArray`.

---

## `pick(handler)`

Returns a copy of currently occupied elements.

The type of the returned `TypedArray` matches the `bucketSize` configured in the allocator. Unoccupied physical capacity is not included.

```js
const values = memory.pick(handler);

```

The result has storage independent of `dataBus`.

For a `bucketSize = "32u"` allocator, for instance, the `Uint32Array` type will store the result.

---

# 5. Capacity and Occupancy

## `byteSize(handler)`

Returns the physical capacity of the block in bytes.

Does not represent the number of bytes currently occupied by elements; it represents the space reserved for all slots in the block.

```js
const bytes = memory.byteSize(handler);

```

---

## `occupied(handler)`

Returns the number of currently occupied elements.

```js
const count = memory.occupied(handler);

```

---

## `length(handler)`

Returns the total quantity of available physical slots.

Capacity is independent of occupancy:

```text
length >= occupied

```

```js
const capacity = memory.length(handler);

```

---

# 6. Inter-block Operations

## `copy(source, destiny, slots = UNKNOWN)`

Copies occupied elements from `source` to the beginning of `destiny`.

The amount copied is limited by:

1. `source` occupancy;
2. `destiny` capacity;
3. `slots`.

`destiny` occupancy is increased when necessary, but its capacity is not altered.

```js
memory.copy(source, destiny);

```

Explicit limitation:

```js
memory.copy(source, destiny, 8);

```

### Return

```text
Uint8Array

```

The `dataBus` itself after the operation.

---

## `copyWithin(handler, target, start, length)`

Copies a region within the block itself.

Semantics follow the concept of `Array.prototype.copyWithin()`, but applied over physical block capacity and limited by source occupancy available.

```js
memory.copyWithin(handler, 4, 0, 4);

```

Negative indices are interpreted relative to capacity end.

The operation:

* supports overlapping regions;
* limits indices to capacity;
* limits reading to the occupied region;
* limits writing to capacity;
* may increase `occupied`.

Return:

```text
Uint8Array

```

The `dataBus`.

---

## `append(target, source)`

Appends occupied elements of `source` to the end of occupied elements of `target`.

The amount is limited by source occupancy and available space in destination.

```js
const count = memory.append(target, source);

```

### Return

```text
number

```

Number of elements effectively appended.

The operation also accepts:

```js
memory.append(handler, handler);

```

when `target` and `source` are the same block.

---

## `clone(handler)`

Creates an independent copy of the block.

The clone possesses:

* same physical capacity;
* same occupancy;
* same bytes across the entire reserved region;
* new handler.

```js
const copy = memory.clone(handler);

```

Unoccupied content is also copied.

---

## `swap(source, target)`

Swaps the data regions associated with two handlers.

The operation swaps in headers:

* address;
* capacity;
* occupancy.

No bytes are copied in `dataBus`. Handlers continue pointing to their respective headers.

```js
memory.swap(a, b);

```

Conceptually:

```text
before:

handler A → region A
handler B → region B

after:

handler A → region B
handler B → region A

```

---

# 7. Serialization

Methods specialized in supporting block state export and import using the CBOR format.

## `dump(handler)`

Serializes the contents of a memory block identified by `handler`.

The method extracts the occupied data from the block, groups it alongside capacity and word type information into a data envelope, and encodes it using the CBOR format.

### Return

```text
Uint8Array


```

A buffer containing the serialized block data.

### Exceptions

`Error` — if the handler is invalid or corrupted.

---

## `load(serialized)`

Restores a memory block from serialized data.

Decodes the CBOR envelope passed in `serialized`, validates whether the word type of the serialized data is compatible with the current allocator instance, and allocates a new block with the necessary capacity to accommodate the content. Then, original data and occupancy are restored in the new block.

### Return

```text
number


```

Handler of the newly recreated block.

### Exceptions

`Error` — if the word type of the decoded data diverges from the one configured in the allocator.

---

# 8. Diagnostics and Utilization

## `recycleCount()`

Returns the quantity of regions currently stored in the recycling system.

A region corresponds to a freed area that could not simply be removed from the top of the `dataBus`.

```js
const count = memory.recycleCount();

```

---

## `recycleBytes`

Getter that returns the total bytes belonging to currently recyclable regions.

```js
const bytes = memory.recycleBytes;

```

The value is calculated as:

```text
Σ(capacity × region_quantity)

```

---

## `allocatedBytes`

Getter that returns bytes associated with regions not currently in the recycling list.

Calculated by:

```text
dataPointer - recycleBytes

```

```js
const bytes = memory.allocatedBytes;

```

---

## `unallocatedBytes`

Getter that returns space still available at the top of the `dataBus`.

This is the region between `dataPointer` and the end of reserved capacity:

```text
size - dataPointer

```

```js
const bytes = memory.unallocatedBytes;

```

---

## `fragmentationRatio`

Getter that calculates the ratio between recyclable bytes and the heap area already traversed by the bump pointer.

```text
recycleBytes / dataPointer

```

When `dataPointer` is zero, the result is `0`.

```js
const ratio = memory.fragmentationRatio;

```

The value measures fragmentation **within the already used area of the heap**, rather than relative to total `dataBus` capacity.

---

# 9. Internal Usage

Methods in this section are part of `Balloc` implementation and do not constitute the interface intended for consumer code.

```text
Internal usage
├── Recycling
│   ├── recyclePush()
│   └── recyclePop()
│
├── Scaling
│   ├── grow()
│   └── headerGrow()
│
└── Validation / metadata
    ├── extractMetadata()
    └── bakeCookie()

```

## 9.1 Recycling

### `recyclePush(capacity, address)`

**Private.**

Inserts a free region into the recycling list associated with its capacity in bytes.

Each capacity has a page represented by `Uint32Array`:

```text
[count, address1, address2, ...]

```

The structure operates as a LIFO stack. When the page becomes full, its buffer expands to double.

---

### `recyclePop(capacity)`

**Private.**

Removes and returns a recyclable region of exact capacity.

Removal occurs from the end of the page, characterizing LIFO behavior.

Returns:

```text
address

```

or:

```js
UNKNOWN // 0xFFFFFFFF

```

when no region exists available for that capacity.

---

## 9.2 Scaling

### `grow()`

**Private. Do not use directly.**

Doubles `dataBus` capacity.

The underlying `ArrayBuffer` is transferred to a larger buffer and associated views are recreated.

Triggered automatically when a new region does not fit in remaining `dataBus` space.

---

### `headerGrow()`

**Private. Do not use directly.**

Doubles `controlBus` capacity.

Existing headers are preserved during `ArrayBuffer` transfer, and `controlAdapter` is recreated over the new storage.

Triggered automatically when there is no space for a new header.

---

## 9.3 Validation and Metadata

### `extractMetadata(handler, out)`

**Private.**

Decodes and validates a handler.

The method extracts:

```text
generation
headerAddress
dataAddress
capacityExponent
byteCapacity
occupied

```

Handler validity is verified by recalculating the cookie stored in the header. The `out` object is reusable, avoiding new allocations.

Signature:

```js
extractMetadata(handler, out)

```

Return:

```text
Metadata

```

The return is the reference provided in `out` itself.

---

### `bakeCookie(addr, gen)`

**Private.**

Calculates the validation cookie used to verify handlers.

The cookie combines:

* header address;
* lower 11 bits of generation.

The result is reduced to 8 bits. The value `0` is reserved to indicate an invalid header, so the method replaces `0` with `1`.

The cookie is not cryptographic. Its function is to detect invalid, stale, or corrupted handlers within the allocator management model.

---

# 10. Storage Model

Each block features a fixed **16-byte** header:

```text
offset  size     field
──────  ───────  ─────────────
0       4 bytes  address
4       4 bytes  occupied
8       1 byte   capacity
9       1 byte   cookie
10      6 bytes  reserved

```

Relevant fields are:

### `address`

Initial address of the data region inside `dataBus`.

### `occupied`

Number of currently occupied elements.

### `capacity`

Power of two exponent representing physical capacity:

```text
capacityElements = 2 ** capacity

```

Capacity in bytes is:

```text
capacityBytes = 2 ** capacity × wordSize

```

### `cookie`

Validation value associated with the header address and handler generation.

---

# 11. Handlers

The handler is the external identifier used by practically all block operations.

Its logical composition is:

```text
┌───────────────────────┬───────────────────────────────┐
│ generation — 11 bits  │ header address — 32 bits      │
└───────────────────────┴───────────────────────────────┘

```

The lower part corresponds directly to the header address; the upper part represents generation.

Generation participates in cookie validation. Consequently, an invalid handler or one whose header has been invalidated causes an error in operations using it.

---

# 12. Public API Summary

| Category | Method / property | Return |
| --- | --- | --- |
| Instantiation | `constructor()` | `Balloc`|
| Lifecycle | `alloc()` | `number`|
| Lifecycle | `realloc()` | `void`|
| Lifecycle | `free()` | `void`|
| Lifecycle | `gc()` | `void`|
| Stack | `push()` | `boolean`|
| Stack | `pop()` | `number` |
| Stack | `peek()` | `number` |
| Queue | `nudge()` | `boolean`|
| Queue | `pull()` | `number` |
| Queue | `head()` | `number` |
| Access | `has()` | `boolean`|
| Access | `get()` | `number` |
| Access | `set()` | `boolean`|
| Access | `clear()` | `void`|
| Access | `fill()` | `void`|
| Access | `fillAll()` | `void`|
| Access | `put()` | `void`|
| Access | `pick()` | `TypedArray`|
| Capacity | `byteSize()` | `number`|
| Capacity | `occupied()` | `number`|
| Capacity | `length()` | `number`|
| Blocks | `copy()` | `Uint8Array`|
| Blocks | `copyWithin()` | `Uint8Array`|
| Blocks | `append()` | `number`|
| Blocks | `clone()` | `number`|
| Blocks | `swap()` | `void`|
| Serialization | `dump()` | `Uint8Array`|
| Serialization | `load()` | `number`|
| Diagnostics | `recycleCount()` | `number`|
| Diagnostics | `recycleBytes` | `number`|
| Diagnostics | `allocatedBytes` | `number`|
| Diagnostics | `unallocatedBytes` | `number`|
| Diagnostics | `fragmentationRatio` | `number`|

## Internal Methods

| Group | Method | Visibility |
| --- | --- | --- |
| Recycling | `recyclePush()` | private |
| Recycling | `recyclePop()` | private |
| Scaling | `grow()` | private |
| Scaling | `headerGrow()` | private |
| Metadata | `extractMetadata()` | private |
| Validation | `bakeCookie()` | private |