このドキュメントは、以下の言語にも翻訳されています。

| 言語 | リンク |
|---|---|
| アラビア語 | [README.ar.md](README.ar.md) |
| 中国語 | [README.zh.md](README.zh.md) |
| スペイン語 | [README.es.md](README.es.md) |
| 英語 | [README.en.md](README.en.md) |
| 日本語 | [README.jp.md](README.jp.md) |
| ポルトガル語 | [README.pt.md](README.pt.md) |

# Balloc.js

## JavaScript向けバンプアロケーション方式メモリアロケータ

**`Balloc`** は、バンプアロケーションを基盤とするインクリメンタルなメモリアロケータです。連続したデータブロックを管理し、コンパクトな数値ハンドラによってブロックを識別します。

## 開発の背景

JavaScript／Node.jsのエコシステムには、大規模なCSV、ログ、時系列データの継続的な解析・編集・索引付けなど、ビッグデータを効率的に処理するための低レベルな基盤が歴史的に不足してきました。エコシステムにあるデータ処理ライブラリの大半は、参照グラフに基づく単純なモデルと、リテラルオブジェクトの動的な割り当て（`new Node()`）を採用しています。こうした方法には、次のような重大な制約があります。

* **ヒープとGCのオーバーヘッド：** 個別オブジェクトが数百万単位で増えると、V8の参照グラフが肥大化し、予測困難なガベージコレクションの停止が発生します。
* **メモリレイアウトの制御不足（AoS対SoA）：** Array of Structures（AoS）やStructure of Arrays（SoA）といったデータ配置を考慮しないライブラリでは、断片化が進み、CPUのL1／L2／L3キャッシュを有効活用できません。
* **高度なストレージエンジンに必要なプリミティブの欠如：** Log-Structured Merge Treeなどの構築には、高スループットの可変書き込みアリーナと、その後の不変形式への圧縮が必要です。通常のJavaScriptの抽象化だけでこれを実現するのは困難です。

Ballocは、このエンジニアリング上の空白を埋めるために開発されました。低レベルなメモリアロケータおよび動的アリーナ管理エンジンとして設計されています。TypedArrayを介して連続メモリのレイアウトを明示的に制御できるため、LSM Tree、MemTable、Quotient Filter、ビッグデータ処理器など、産業用途に耐えるデータ構造をJavaScriptエコシステムで実装するための物理的な基盤を提供します。その効率と予測可能性は、C++、Rust、Goによるネイティブ実装に匹敵することを目指しています。

## 設計

低レベルなメモリアロケータおよび動的アリーナ管理エンジンである**`Balloc`**は、JavaScriptランタイムに適合するよう設計されています。`Object`、`Map`、`Array`などの高水準な組み込みデータ構造と競合するのではなく、その一段下の層で動作し、ガベージコレクタに過剰な負荷をかけずに、**決定性の高い高性能な連続メモリ管理**を提供します。

このアロケータは、次の3つの仕組みを組み合わせています。

```text
                  ┌─────────────────┐
                  │     Balloc      │
                  └────────┬────────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
          ▼                ▼                ▼
     バンプ割り当て      再利用           コンパクション
          │                │                │
      高速な逐次割り当て  解放領域の再利用   ReBump / gc()
```

* バンプアロケータは、`dataBus`上でデータを逐次的に割り当てます。
* 再利用機構は、以前に解放された領域の容量が新しい割り当て要求に適合する場合、その領域を再利用します。
* `gc()`は、ヒープに断片化した空き領域がある場合に、明示的なコンパクションを実行します。

Ballocは、データ領域とメタデータ領域を分離することで、容量、使用量、再利用、コンパクションを明示的に制御しながら、シンプルなメモリモデルを実現します。

```text
                    Balloc
                       │
             ┌─────────┴─────────┐
             │                   │
          dataBus            controlBus
             │                   │
          コンテンツ             ヘッダー
```

* `dataBus`には、データブロックが格納されます。
* `controlBus`には、データブロックの記述子となる固定サイズのヘッダーが格納されます。

各ブロックは、外部から43ビットの論理ハンドラで識別されます。

```text
┌───────────────────────┬───────────────────────────────┐
│ 世代 — 11ビット       │ ヘッダーアドレス — 32ビット   │
└───────────────────────┴───────────────────────────────┘
```

ハンドラ自体は、データブロックのアドレスを直接保持しません。ハンドラはブロックのヘッダーを識別し、そのヘッダーにデータのアドレス、容量、使用量が記録されます。

世代番号は、アロケータのCookie検証機構で使用され、無効・古い・破損したハンドラを検出します。

## インストール

Node.jsでは、次のNPMパッケージをインストールします。

```bash
npm install Balloc
```

Bunでは、次のようにインストールします。

```bash
bun add Balloc
```

Denoでは、次のようにインストールします。

```bash
deno add npm:Balloc
```

Yarnを使用する場合：

```bash
yarn add Balloc
```

HTMLでは、unpkg CDNを使用できます。

```text
[https://unpkg.com/Balloc](https://unpkg.com/Balloc)
```

一部の言語では、ローカライズされたdocstringを含むバージョンも利用できます。

```text
アラビア語: [https://unpkg.com/Balloc/src/ar/Balloc.mjs](https://unpkg.com/Balloc/src/ar/Balloc.mjs)
英語:       [https://unpkg.com/Balloc/src/en/Balloc.mjs](https://unpkg.com/Balloc/src/en/Balloc.mjs)
スペイン語: [https://unpkg.com/Balloc/src/es/Balloc.mjs](https://unpkg.com/Balloc/src/es/Balloc.mjs)
日本語:     [https://unpkg.com/Balloc/src/jp/Balloc.mjs](https://unpkg.com/Balloc/src/jp/Balloc.mjs)
中国語:     [https://unpkg.com/Balloc/src/zh/Balloc.mjs](https://unpkg.com/Balloc/src/zh/Balloc.mjs)
```

jsDelivr CDNも利用できます。

```text
[https://cdn.jsdelivr.net/npm/Balloc](https://cdn.jsdelivr.net/npm/Balloc)
```

ローカライズ版を提供するCDNのURLは次のとおりです。

```text
アラビア語: [https://cdn.jsdelivr.net/npm/Balloc/src/ar/Balloc.mjs](https://cdn.jsdelivr.net/npm/Balloc/src/ar/Balloc.mjs)
英語:       [https://cdn.jsdelivr.net/npm/Balloc/src/en/Balloc.mjs](https://cdn.jsdelivr.net/npm/Balloc/src/en/Balloc.mjs)
スペイン語: [https://cdn.jsdelivr.net/npm/Balloc/src/es/Balloc.mjs](https://cdn.jsdelivr.net/npm/Balloc/src/es/Balloc.mjs)
日本語:     [https://cdn.jsdelivr.net/npm/Balloc/src/jp/Balloc.mjs](https://cdn.jsdelivr.net/npm/Balloc/src/jp/Balloc.mjs)
中国語:     [https://cdn.jsdelivr.net/npm/Balloc/src/zh/Balloc.mjs](https://cdn.jsdelivr.net/npm/Balloc/src/zh/Balloc.mjs)
```

## 基本的な使い方

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

## はじめに

コンストラクターは次のとおりです。

```js
new Balloc(size, bucketSize, metadataSize)
```

| パラメーター | 型 | 既定値 | 説明 |
|---|---|---:|---|
| `size` | `number` | `65535` | `dataBus`の初期容量（バイト） |
| `bucketSize` | `BucketType` | `32u` | 要素のビット幅 |
| `metadataSize` | `number` | `1024` | `controlBus`の初期容量（バイト） |

例：

```js
const memory = new Balloc();
```

32ビット符号なし整数の要素を使用する場合：

```js
const memory = new Balloc(65535, "32u");
```

`size`は、`[2, 0x80000000]`の範囲内の整数である必要があります。

`bucketSize`には、`[ビット幅][データ型]`の形式の文字列である`BucketType`を指定します。使用可能な値は次のとおりです。

| 符号付き整数 | 符号なし整数 | 浮動小数点数 |
|---|---|---|
| `8i` | `8u` |  |
| `16i` | `16u` |  |
| `32i` | `32u` | `32f` |
| `64i` | `64u` | `64f` |

半精度浮動小数点数型（`16f`）は、JavaScriptの仕様およびランタイムへの導入が比較的新しく、現在も定着過程にあるため、Ballocではサポートが保証されていません。ライブラリ内に型が存在していても、プロジェクトで利用できるかどうかは不確実な場合があります。

`metadataSize`は、`[16, 0x80000000]`の範囲内の整数である必要があります。

ブロックの割り当てサイズは、要求された要素数を収容できる最小の2の累乗に切り上げられます。

たとえば、次のコードの場合：

```js
const handler = memory.alloc(100);
```

物理スロットが必ず100個のブロックが作成されるとは限りません。アロケータは、2の累乗となる容量を確保します。

概念的には次のとおりです。

```text
要求数: 100 elements
容量:   128 elements
```

物理容量と論理的な使用量は異なります。

```text
length(handler)     → 物理容量
occupied(handler)  → 使用中の要素数
byteSize(handler)  → 物理的に確保されたバイト数
```

この区別により、ブロックの物理容量より少ない要素だけを使用できます。

## API

ブロックの基本的なライフサイクルは次のとおりです。

```text
alloc()
   │
   ├── アクセス／変更
   │
   ├── realloc()
   │
   └── free()
          │
          └── 再利用
```

Ballocは、ブロックのデータを扱うために、次のようなアクセスモデルを提供します。

* スタック
* キュー
* 配列／ランダムアクセス

APIの完全なドキュメントは[`./docs`](./docs)フォルダーにあり、複数の言語に翻訳されています。

| 言語 | リンク |
|---|---|
| アラビア語 | [./docs/API — balloc.ar.md](./docs/API%20—%20balloc.ar.md) |
| 中国語 | [./docs/API — balloc.zh.md](./docs/API%20—%20balloc.zh.md) |
| スペイン語 | [./docs/API — balloc.es.md](./docs/API%20—%20balloc.es.md) |
| 英語 | [./docs/API — balloc.en.md](./docs/API%20—%20balloc.en.md) |
| 日本語 | [./docs/API — balloc.ja.md](./docs/API%20—%20balloc.ja.md) |
| ポルトガル語 | [./docs/API — balloc.pt.md](./docs/API%20—%20balloc.pt.md) |

APIメソッドは機能ごとに次のグループに分類されています。

* ライフサイクル
* スタック操作
* キュー操作
* 配列操作
* ブロック間のデータ交換
* シリアライズ
* 診断
* 内部関数

各グループの概要は次のとおりです。

### ライフサイクル

| API | 説明 |
|---|---|
| `alloc()` | ブロックを割り当てる |
| `realloc()` | ブロックの容量を拡張する |
| `free()` | ブロックを解放する |
| `gc()` | データヒープをコンパクションする |

### スタック操作

| API | 説明 |
|---|---|
| `push()` | 要素を追加する |
| `pop()` | 最後の要素を削除する |
| `peek()` | 最後の要素を読み取る |

### キュー操作

| API | 説明 |
|---|---|
| `nudge()` | 先頭に要素を挿入する |
| `pull()` | 先頭の要素を削除する |
| `head()` | 先頭の要素を読み取る |

### 配列操作

| API | 説明 |
|---|---|
| `has()` | 値を検索する |
| `get()` | 要素を読み取る |
| `set()` | 要素を書き込む |
| `clear()` | 使用状態をクリアし、ブロックを値で埋める |
| `fill()` | 指定範囲を埋める |
| `fillAll()` | ブロック全体を埋め、すべての要素を使用済みにする |
| `put()` | 配列をブロックにコピーする |
| `pick()` | 使用中の要素をブロックから外部へコピーする |

### ブロック間のデータ交換

| API | 説明 |
|---|---|
| `copy()` | ブロック間でコピーする |
| `copyWithin()` | ブロック内でコピーする |
| `append()` | あるブロックを別のブロックに追加する |
| `clone()` | ブロックの独立したコピーを作成する |
| `swap()` | ブロックの領域を入れ替える |

### シリアライズ

| API | 説明 |
|---|---|
| `dump()` | ブロックの内容をCBOR形式でシリアライズする |
| `load()` | シリアライズ済みデータからブロックを復元する |

### 診断

| API | 説明 |
|---|---|
| `byteSize()` | ブロックの物理サイズをバイト単位で返す |
| `occupied()` | 使用中の要素数を返す |
| `length()` | 物理容量（要素数）を返す |
| `recycleCount()` | 再利用可能な領域の数を返す |
| `recycleBytes` | 現在再利用可能なバイト数 |
| `allocatedBytes` | 再利用対象ではない領域に割り当てられているバイト数 |
| `unallocatedBytes` | バンプポインター以降の残り領域のバイト数 |
| `fragmentationRatio` | 再利用済みバイト数／使用中ヒープ領域 |

### 内部関数

内部関数は、主にアロケータ内部で使用される特殊なAPIです。未記載の副作用が生じる可能性があるため、日常的なコードでの使用は通常推奨されません。Ballocのソースコードを十分に理解したうえで行う、ライブラリの拡張や変更を目的としています。

```text
再利用管理
├── recyclePush()
└── recyclePop()

拡張
├── grow()
└── headerGrow()

検証／メタデータ
├── extractMetadata()
└── bakeCookie()
```

`recyclePush()`は、解放されたブロックを再利用リストに追加します。

`recyclePop()`は、再利用リストから解放済みブロックを取り出して返します。

`grow()`は、現在の領域では以降の割り当て要求に対応できない場合に、`dataBus`を拡張します。

`headerGrow()`は、追加のヘッダーが必要になった場合に、`controlBus`を拡張します。

`extractMetadata()`は、ハンドラをデコードして検証し、関連するメタデータを取り出します。

`bakeCookie()`は、ハンドラ検証機構で使用する検証用Cookieを計算します。

## 💖 寄付・支援

このプロジェクトを気に入っていただき、開発を支援したい場合は、以下をご利用ください。

| Pix QRコード | コピー＆ペースト用キー／ランダムキー |
| :---: | :--- |
| ![Pix QR Code](./img/pix.png) | **ランダムキー：**<br>`e87d773a-0b97-4410-8fc3-f7ec04cce6a2` |

## ライセンス

[MIT](./LICENSE)