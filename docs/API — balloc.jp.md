このドキュメントの他の言語版もご利用いただけます：
| 言語 | リンク |
|---|---|
| アラビア語 | [API — balloc.ar.md](./docs/API%20—%20balloc.ar.md) |
| 中国語 | [API — balloc.zh.md](./docs/API%20—%20balloc.zh.md) |
| スペイン語 | [API — balloc.es.md](./docs/API%20—%20balloc.es.md) |
| 英語 | [API — balloc.en.md](./docs/API%20—%20balloc.en.md) |
| 日本語 | [API — balloc.jp.md](./docs/API%20—%20balloc.jp.md) |
| ポルトガル語 | [API — balloc.pt.md](./docs/API%20—%20balloc.pt.md) |

# Balloc.js

`Balloc` は **bump allocation** に基づくメモリアロケータであり、独立した 2 つのバスを備えています。

- `dataBus` — ブロックのデータを格納します。
- `controlBus` — ヘッダーおよびメタデータを格納します。

ブロックは、11 ビットの世代番号と 32 ビットのヘッダーアドレスから構成される **43 ビットの論理ハンドラー** によって外部から識別されます。ブロックの物理容量は、要素数で常に 2 の累乗になります。

## API の構成

```text
Balloc
├── インスタンス化
│   └── constructor()
├── ブロックのライフサイクル
│   ├── alloc()
│   ├── realloc()
│   ├── free()
│   └── gc()
├── 線形データ構造
│   ├── Stack: push(), pop(), peek()
│   └── Queue: nudge(), pull(), head()
├── コンテンツへのアクセス
│   ├── has(), get(), set(), clear()
│   ├── fill(), fillAll(), put(), pick()
├── 容量と使用量
│   ├── byteSize()
│   ├── occupied()
│   └── length()
├── ブロック間の操作
│   ├── copy(), copyWithin(), append()
│   └── clone(), swap()
├── シリアライズ
│   ├── dump()
│   └── load()
├── 診断と使用状況
│   ├── recycleCount()
│   ├── recycleBytes
│   ├── allocatedBytes
│   ├── unallocatedBytes
│   └── fragmentationRatio
└── 内部処理
    ├── 再利用: recyclePush(), recyclePop()
    ├── 拡張: grow(), headerGrow()
    └── ユーティリティ: extractMetadata(), bakeCookie()
```

---

## 容量のセマンティクス

容量の論理単位は `bucketSize` によって決まります。

```text
bucketSize = "8i"  または "8u"                         → 1 要素あたり 1 byte
bucketSize = "16i" または "16u" または "16f"          → 1 要素あたり 2 bytes
bucketSize = "32i" または "32u" または "32f"          → 1 要素あたり 4 bytes
bucketSize = "64i" または "64u" または "64f"          → 1 要素あたり 8 bytes
```

アロケータは、要素数で表した容量を 2 の累乗として計算し、その後でバイト数に変換します。

例：`bucketSize = "32u"` の場合

```text
capacity = 8 要素
wordSize = 4 bytes

byteCapacity = 8 × 4 = 32 bytes
```

物理容量と使用量は別の概念です。

```text
length(handler)    → 物理スロット数
occupied(handler)  → 使用中のスロット数
byteSize(handler)  → 予約済みの物理バイト数
```

---

# 1. インスタンス化

## `new Balloc(size, bucketSize, metadataSize)`

新しいアロケータを作成します。

ストレージは、ブロックのデータを格納する `dataBus` と、ヘッダーを格納する `controlBus` に分割されます。両方の初期容量は、内部の拡張方式に従って丸められます。

### パラメーター

| パラメーター | 型 | デフォルト値 | 説明 |
|---|---|---:|---|
| `size` | `number` | `65535` | `dataBus` の初期容量（バイト単位）。 |
| `bucketSize` | `BucketType` | — | 各要素のサイズ。 |
| `metadataSize` | `number` | `1024` | `controlBus` の初期容量（バイト単位）。 |

`size` は `[2, 0x80000000]` の範囲内にある安全な整数でなければなりません。

`bucketSize` は、`[ビット幅][データ型]` 形式の文字列である `BucketType` を受け取り、次の値のみを許可します。

| 符号付き整数 | 符号なし整数 | 浮動小数点数 |
|---|---|---|
| `8i` | `8u` | |
| `16i` | `16u` | `16f` |
| `32i` | `32u` | `32f` |
| `64i` | `64u` | `64f` |

`metadataSize` は `[16, 0x80000000]` の範囲内にある安全な整数でなければなりません。

### 例外

- `RangeError` — `size` が範囲外です。
- `RangeError` — `bucketSize` が `BucketType` で定義された値と一致しません。
- `RangeError` — `metadataSize` が許可された範囲外です。

### 例

```js
const { Balloc } = require("Balloc");

const memory = new Balloc();
```

32 ビット符号なし要素を使用する場合：

```js
const memory = new Balloc(65535, "32u");
```

コンストラクターは、`bucketSize` に対応する `TypedArray` と、読み書きに使用する `DataView` を内部でインスタンス化します。

---

# 2. ブロックのライフサイクル

ブロックの基本的なライフサイクルは次のとおりです。

```text
alloc()
   │
   ├── ブロックに対する操作
   ├── realloc()
   └── free()
          │
          └── 再利用
```

再利用機構により、新しい割り当てと容量が完全に一致する解放済み領域を再利用できます。

## `alloc(size = 16)`

新しいブロックを割り当て、そのハンドラーを返します。

容量は、`size` 個の要素を格納できる最小の 2 の累乗に切り上げられます。最初に再利用可能な領域のリストを検索し、適合する領域がなければ `dataBus` の末尾から領域を取得します。

### パラメーター

| パラメーター | 型 | デフォルト値 | 説明 |
|---|---|---:|---|
| `size` | `number` | `16` | 要求する最小要素数。 |

`size` は `[2, 0x80000000]` の範囲内でなければなりません。

### 戻り値

```text
number
```

ブロックのハンドラー。

ハンドラーの論理形式：

```text
[ 世代番号 11 bits ][ ヘッダーアドレス 32 bits ]
```

### 例

```js
const handler = memory.alloc(100);

memory.push(handler, 42);
```

100 要素を要求しても、正確に 100 スロットが予約されるわけではありません。容量は次の 2 の累乗になります。

---

## `realloc(handler)`

ブロックの容量を次の 2 の累乗まで拡張します。

ブロックが現在の `dataBus` の末尾にある場合、拡張は **in-place** で行われます。それ以外の場合は、再利用機構またはヒープ末尾から新しい領域を取得し、使用中の要素をコピーしてから、以前の領域を再利用可能にします。

ヘッダーは維持されるため、ハンドラーは変わりません。

### パラメーター

| パラメーター | 型 | 説明 |
|---|---|---|
| `handler` | `number` | ブロックのハンドラー。 |

### 戻り値

```text
void
```

### 例外

- `Error` — ハンドラーが無効、または破損しています。
- `AggregateError` — 容量が最大上限に達しています。

### 例

```js
const handler = memory.alloc(8);

memory.realloc(handler);
```

この操作は物理容量を 2 倍にし、次の 2 の累乗へ拡張します。

---

## `free(handler)`

ブロックを解放します。

cookie をゼロに設定してヘッダーを無効化します。データ領域は次のように処理されます。

- `dataBus` の末尾にない場合は、再利用リストに戻されます。
- ヒープの最新領域である場合は、末尾から直接取り除かれます。

### パラメーター

| パラメーター | 型 | 説明 |
|---|---|---|
| `handler` | `number` | ブロックのハンドラー。 |

### 戻り値

```text
void
```

### 例外

ハンドラーが無効または破損している場合は `Error`。

```js
memory.free(handler);
```

解放されたハンドラーは無効になります。

---

## `gc()`

**ReBump** アルゴリズムによって `dataBus` をコンパクションします。

`controlBus` 内の既存ヘッダーを走査し、有効なブロックだけを新しい `dataBus` にコピーして、ヘッダー内のアドレスを更新します。ブロック間の空き領域は除去されます。

### 効果

- `recycle` 内のすべての領域を除去する
- 生存ブロックをコンパクションする
- ヘッダーの順序を維持する
- ブロックの物理容量を維持する
- 使用量を維持する
- ブロックのアドレスを更新する
- 最後の生存ブロックの直後に `dataPointer` を再配置する

### 戻り値

```text
void
```

### 計算量

ヘッダーの走査は `O(n)` です。`n` は検査対象となるヘッダー数です。総コストは、移動するデータ量にも依存します。

```js
memory.gc();
```

ヘッダーは同じアドレスに維持されるため、`gc()` はハンドラーを変更しません。コンパクションされるのはデータ領域のみです。

---

# 3. 線形データ構造

ブロックは、両端からアクセスする線形データ構造として使用できます。

## 3.1 Stack

### `push(handler, value)`

`value` を使用中シーケンスの末尾に追加します。

空き領域がない場合、要素は挿入されず、メソッドは `false` を返します。

```js
memory.push(handler, 10);
memory.push(handler, 20);
memory.push(handler, 30);
```

戻り値：

```text
boolean
```

- `true` — 要素を挿入しました。
- `false` — ブロックが満杯です。

### `pop(handler)`

最後の使用中要素を削除して返します。

要素を読み取る前に使用量がデクリメントされます。以前のバイト列は消去されません。

戻り値：

```text
number | undefined
```

`undefined` はブロックが空であることを示します。

```js
const value = memory.pop(handler);
```

### `peek(handler)`

最後の使用中要素を削除せずに返します。

戻り値：

```text
number | undefined
```

---

## 3.2 Queue

### `nudge(handler, value)`

`value` を使用中シーケンスの先頭に挿入します。

既存の要素は 1 位置分後方へシフトされます。この操作の計算量は使用中要素数に比例します。

戻り値：

```text
boolean
```

- `true` — 要素を挿入しました。
- `false` — ブロックが満杯です。

### `pull(handler)`

先頭要素を削除して返します。

残りの要素は先頭方向へ 1 位置分シフトされます。

戻り値：

```text
number | undefined
```

### `head(handler)`

先頭要素を削除せずに返します。

戻り値：

```text
number | undefined
```

---

# 4. コンテンツへのアクセス

## `has(handler, value)`

`value` が使用中要素に含まれているかを確認します。

補助 `TypedArray` を使用して検索し、`[0, occupied)` の範囲のみを対象とします。使用されていない物理容量は検索対象外です。

```js
if (memory.has(handler, 42)) {
    // ...
}
```

戻り値：

```text
boolean
```

## `get(handler, index)`

指定されたインデックスの要素を取得します。

インデックスはゼロ始まりです。`[0, occupied)` の範囲外のインデックスに対しては `undefined` を返します。

```js
const value = memory.get(handler, 3);
```

戻り値：

```text
number | undefined
```

## `set(handler, index, value)`

使用中インデックスの要素を置き換えます。

使用量は変更されません。

`[0, occupied)` の範囲外のインデックスは無視され、メソッドは `false` を返します。

```js
memory.set(handler, 3, 99);
```

戻り値：

```text
boolean
```

- `true` — 値を書き込みました。
- `false` — 使用中領域に対してインデックスが無効です。

## `clear(handler, value = 0)`

使用量をゼロにし、ブロックの **すべての物理スロット** を `value` で埋めます。

これには、使用中シーケンスに含まれていなかったスロットも含まれます。

```js
memory.clear(handler);
```

実行後：

```text
occupied = 0
```

物理容量は変わりません。

## `fill(handler, value, start = 0, end = null)`

指定範囲のスロットを `value` で埋めます。

範囲は次の規則に従います。

```text
[start, end)
```

`start` は包含、`end` は非包含です。`end` が `null` の場合、物理容量全体が上限になります。使用量は `end` になります。

```js
memory.fill(handler, 0, 2, 6);
```

次のインデックスを埋めます。

```text
2, 3, 4, 5
```

### 例外

次の場合は `RangeError` が発生します。

- `start < 0`
- `start > capacity`
- `end < 0`
- `end > capacity`
- `start > end`

## `fillAll(handler, value)`

すべての物理スロットを `value` で埋め、容量全体を使用中としてマークします。

容量全体を埋めた後、次の値を設定する処理と同等です。

```text
occupied = capacity
```

`clear()` と異なり、処理後のブロックは完全に使用中になります。

```js
memory.fillAll(handler, 0);
```

## `put(handler, data)`

`Array` または `TypedArray` をブロックの先頭にコピーします。

コピー数はブロック容量によって制限されます。使用量は、以前の使用量と実際にコピーした要素数の大きい方になります。そのため、短いシーケンスを渡しても、`put()` は既存の使用量を減らしません。

```js
memory.put(handler, [10, 20, 30, 40]);
```

`TypedArray` も受け付けます。

```js
memory.put(handler, new Uint32Array([10, 20, 30]));
```

### 対応する型

```text
Array
TypedArray
```

### 例外

`data` が `Array` または `TypedArray` ではない場合、`TypeError` が発生します。

## `pick(handler)`

現在使用中の要素のコピーを返します。

返される `TypedArray` の型は、アロケータに設定された `bucketSize` に対応します。使用されていない物理容量は含まれません。

```js
const values = memory.pick(handler);
```

戻り値は `dataBus` とは独立したストレージを持ちます。

たとえば `bucketSize = "32u"` のアロケータでは、結果は `Uint32Array` に格納されます。

---

# 5. 容量と使用量

## `byteSize(handler)`

ブロックの物理容量をバイト単位で返します。

これは要素によって現在使用されているバイト数ではなく、ブロックの全スロットに予約された領域のサイズです。

```js
const bytes = memory.byteSize(handler);
```

## `occupied(handler)`

現在使用中の要素数を返します。

```js
const count = memory.occupied(handler);
```

## `length(handler)`

使用可能な物理スロットの総数を返します。

容量と使用量は独立しています。

```text
length >= occupied
```

```js
const capacity = memory.length(handler);
```

---

# 6. ブロック間の操作

## `copy(source, destiny, slots = UNKNOWN)`

`source` の使用中要素を `destiny` の先頭にコピーします。

コピー数は次の条件によって制限されます。

1. `source` の使用量
2. `destiny` の容量
3. `slots`

必要に応じて `destiny` の使用量は増加しますが、容量は変更されません。

```js
memory.copy(source, destiny);
```

コピー数を明示的に制限する場合：

```js
memory.copy(source, destiny, 8);
```

### 戻り値

```text
Uint8Array
```

操作後の `dataBus` 自体を返します。

## `copyWithin(handler, target, start, length)`

同一ブロック内の領域をコピーします。

セマンティクスは `Array.prototype.copyWithin()` の概念に従いますが、ブロックの物理容量に適用され、コピー元で使用可能な占有範囲によって制限されます。

```js
memory.copyWithin(handler, 4, 0, 4);
```

負のインデックスは容量末尾からの相対位置として解釈されます。

この操作は次の特性を持ちます。

- 重複する領域に対応する
- インデックスを容量内に制限する
- 読み取りを使用中領域に制限する
- 書き込みを容量内に制限する
- `occupied` を増加させる場合がある

戻り値：

```text
Uint8Array
```

`dataBus` を返します。

## `append(target, source)`

`source` の使用中要素を `target` の使用中要素の末尾に追加します。

追加数は、コピー元の使用量とコピー先の空き領域によって制限されます。

```js
const count = memory.append(target, source);
```

### 戻り値

```text
number
```

実際に追加された要素数。

次のように、`target` と `source` が同一ブロックの場合も使用できます。

```js
memory.append(handler, handler);
```

## `clone(handler)`

ブロックの独立したコピーを作成します。

クローンは次の特性を持ちます。

- 同じ物理容量
- 同じ使用量
- 予約領域全体の同じバイト内容
- 新しいハンドラー

```js
const copy = memory.clone(handler);
```

未使用領域の内容もコピーされます。

## `swap(source, target)`

2 つのハンドラーに関連付けられたデータ領域を交換します。

ヘッダー内の次の値が交換されます。

- アドレス
- 容量
- 使用量

`dataBus` 内のバイトはコピーされません。ハンドラーは引き続き、それぞれのヘッダーを参照します。

```js
memory.swap(a, b);
```

概念的には次のとおりです。

```text
交換前:

handler A → region A
handler B → region B

交換後:

handler A → region B
handler B → region A
```

---

# 7. シリアライズ

CBOR 形式を使用してブロックの状態をエクスポートおよびインポートするためのメソッドです。

## `dump(handler)`

`handler` で識別されるメモリブロックの内容をシリアライズします。

ブロックの使用中データを抽出し、容量およびワード型の情報とともにデータコンテナにまとめ、CBOR 形式でエンコードします。

### 戻り値

```text
Uint8Array
```

シリアライズされたブロックデータを含むバッファー。

### 例外

`Error` — ハンドラーが無効、または破損しています。

## `load(serialized)`

シリアライズされたデータからメモリブロックを復元します。

`serialized` に渡された CBOR コンテナをデコードし、シリアライズデータのワード型が現在のアロケータインスタンスと互換性があることを検証します。次に、コンテンツを格納するために必要な容量を持つ新しいブロックを割り当て、元のデータと使用量を復元します。

### 戻り値

```text
number
```

再作成された新しいブロックのハンドラー。

### 例外

`Error` — デコードされたデータのワード型が、アロケータに設定された型と異なります。

---

# 8. 診断と使用状況

## `recycleCount()`

再利用システムに現在格納されている領域数を返します。

領域とは、`dataBus` の末尾から直接取り除くことができなかった解放済み領域です。

```js
const count = memory.recycleCount();
```

## `recycleBytes`

現在再利用可能な領域に属するバイト数の合計を返す getter です。

```js
const bytes = memory.recycleBytes;
```

値は次の式で計算されます。

```text
Σ(capacity × 領域数)
```

## `allocatedBytes`

現在再利用リストに含まれていない領域に関連するバイト数を返す getter です。

次の式で計算されます。

```text
dataPointer - recycleBytes
```

```js
const bytes = memory.allocatedBytes;
```

## `unallocatedBytes`

`dataBus` の末尾で利用可能な残りの領域を返す getter です。

`dataPointer` から予約容量の末尾までの領域を表します。

```text
size - dataPointer
```

```js
const bytes = memory.unallocatedBytes;
```

## `fragmentationRatio`

再利用可能なバイト数と、bump pointer がすでに進んだヒープ領域との比率を計算する getter です。

```text
recycleBytes / dataPointer
```

`dataPointer` がゼロの場合、結果は `0` です。

この値は `dataBus` 全体の容量に対する比率ではなく、**すでに使用されたヒープ領域内の** フラグメンテーションを測定します。

---

# 9. 内部処理

このセクションのメソッドは `Balloc` の実装内部に属し、利用側コード向けのインターフェースではありません。

```text
内部処理
├── 再利用
│   ├── recyclePush()
│   └── recyclePop()
├── 拡張
│   ├── grow()
│   └── headerGrow()
└── 検証 / メタデータ
    ├── extractMetadata()
    └── bakeCookie()
```

## 9.1 再利用

### `recyclePush(capacity, address)`

**プライベート。**

バイト単位の容量に対応する再利用リストに、空き領域を追加します。

各容量には、`Uint32Array` で表現されるページがあります。

```text
[count, address1, address2, ...]
```

この構造は LIFO スタックとして機能します。ページが満杯になると、バッファーは 2 倍に拡張されます。

### `recyclePop(capacity)`

**プライベート。**

指定容量と完全に一致する再利用可能な領域を取り出して返します。

ページ末尾から取り出すため、LIFO 動作になります。

戻り値：

```text
address
```

該当容量の領域が存在しない場合：

```js
UNKNOWN // 0xFFFFFFFF
```

## 9.2 拡張

### `grow()`

**プライベート。直接呼び出さないでください。**

`dataBus` の容量を 2 倍にします。

基盤となる `ArrayBuffer` をより大きなバッファーに移し、関連するビューを再作成します。

新しい領域が `dataBus` の残りの空き領域に収まらない場合、自動的に呼び出されます。

### `headerGrow()`

**プライベート。直接呼び出さないでください。**

`controlBus` の容量を 2 倍にします。

`ArrayBuffer` の移行中も既存ヘッダーは保持され、新しいストレージ上に `controlAdapter` が再作成されます。

新しいヘッダーを格納する空き領域がなくなると、自動的に呼び出されます。

## 9.3 検証とメタデータ

### `extractMetadata(handler, out)`

**プライベート。**

ハンドラーをデコードして検証します。

次の情報を抽出します。

```text
generation
headerAddress
dataAddress
capacityExponent
byteCapacity
occupied
```

ヘッダーに格納された cookie を再計算して、ハンドラーの有効性を検証します。`out` オブジェクトは再利用できるため、新たな割り当てを回避できます。

シグネチャ：

```js
extractMetadata(handler, out)
```

戻り値：

```text
Metadata
```

戻り値は `out` に渡された参照そのものです。

### `bakeCookie(addr, gen)`

**プライベート。**

ハンドラーの検証に使用する cookie を計算します。

cookie は次の値を組み合わせます。

- ヘッダーアドレス
- 世代番号の下位 11 ビット

結果は 8 ビットに縮小されます。`0` は無効なヘッダーを示すために予約されているので、計算結果が `0` の場合は `1` に置き換えられます。

cookie は暗号学的な値ではありません。アロケータの管理モデル内で、無効なハンドラー、古い（`stale`）ハンドラー、または破損したハンドラーを検出するためのものです。

---

# 10. ストレージモデル

各ブロックには固定長 **16 bytes** のヘッダーがあります。

```text
offset  サイズ    フィールド
──────  ────────  ─────────────
0       4 bytes   address
4       4 bytes   occupied
8       1 byte    capacity
9       1 byte    cookie
10      6 bytes   reserved
```

重要なフィールドは次のとおりです。

### `address`

`dataBus` 内におけるデータ領域の先頭アドレス。

### `occupied`

現在使用中の要素数。

### `capacity`

物理容量を表す 2 の累乗の指数です。

```text
capacityElements = 2 ** capacity
```

バイト単位の容量：

```text
capacityBytes = 2 ** capacity × wordSize
```

### `cookie`

ヘッダーアドレスとハンドラーの世代番号に関連付けられた検証値。

---

# 11. ハンドラー

ハンドラーは、ほとんどすべてのブロック操作で使用される外部識別子です。

論理的な構成は次のとおりです。

```text
┌───────────────────────┬───────────────────────────────┐
│ 世代番号 — 11 bits    │ ヘッダーアドレス — 32 bits    │
└───────────────────────┴───────────────────────────────┘
```

下位部分はヘッダーアドレスに直接対応し、上位部分は世代番号を表します。

世代番号は cookie による検証に使用されます。そのため、無効なハンドラー、またはヘッダーが無効化されたハンドラーを使用すると、該当する操作でエラーが発生します。

---

# 12. 公開 API の概要

| カテゴリー | メソッド / プロパティ | 戻り値 |
|---|---|---|
| インスタンス化 | `constructor()` | `Balloc` |
| ライフサイクル | `alloc()` | `number` |
| ライフサイクル | `realloc()` | `void` |
| ライフサイクル | `free()` | `void` |
| ライフサイクル | `gc()` | `void` |
| Stack | `push()` | `boolean` |
| Stack | `pop()` | `number \| undefined` |
| Stack | `peek()` | `number \| undefined` |
| Queue | `nudge()` | `boolean` |
| Queue | `pull()` | `number \| undefined` |
| Queue | `head()` | `number \| undefined` |
| アクセス | `has()` | `boolean` |
| アクセス | `get()` | `number \| undefined` |
| アクセス | `set()` | `boolean` |
| アクセス | `clear()` | `void` |
| アクセス | `fill()` | `void` |
| アクセス | `fillAll()` | `void` |
| アクセス | `put()` | `void` |
| アクセス | `pick()` | `TypedArray` |
| 容量 | `byteSize()` | `number` |
| 容量 | `occupied()` | `number` |
| 容量 | `length()` | `number` |
| ブロック | `copy()` | `Uint8Array` |
| ブロック | `copyWithin()` | `Uint8Array` |
| ブロック | `append()` | `number` |
| ブロック | `clone()` | `number` |
| ブロック | `swap()` | `void` |
| シリアライズ | `dump()` | `Uint8Array` |
| シリアライズ | `load()` | `number` |
| 診断 | `recycleCount()` | `number` |
| 診断 | `recycleBytes` | `number` |
| 診断 | `allocatedBytes` | `number` |
| 診断 | `unallocatedBytes` | `number` |
| 診断 | `fragmentationRatio` | `number` |

## 内部メソッド

| グループ | メソッド | 可視性 |
|---|---|---|
| 再利用 | `recyclePush()` | プライベート |
| 再利用 | `recyclePop()` | プライベート |
| 拡張 | `grow()` | プライベート |
| 拡張 | `headerGrow()` | プライベート |
| メタデータ | `extractMetadata()` | プライベート |
| 検証 | `bakeCookie()` | プライベート |

