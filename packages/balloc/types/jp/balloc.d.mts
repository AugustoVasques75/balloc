export type BucketType = '8u' | '16u' | '32u' | '64u' | '8i' | '16i' | '32i' | '64i' | '16f' | '32f' | '64f';
export type Metadata = {
    /**
     * - メモリブロックのバイト単位の容量。
     */
    byteCapacity: number;
    /**
     * - 2のべき乗の指数として表現されたメモリブロックの容量。
     */
    capacityExponent: number;
    /**
     * - dataBus内におけるメモリブロックのアドレス。
     */
    dataAddress: number;
    /**
     * - ハンドルが属する世代。
     */
    generation: number;
    /**
     * - controlBus内におけるヘッダーのアドレス。
     */
    headerAddress: number;
    /**
     * - ブロック内の占有要素数。
     */
    occupied: number;
    /**
     * - ブロックが withView() によって借用されているかどうかを示すフラグ。
     */
    borrowed: number;
};
export type FormatAdapter = {
    /**
     * - アロケーターにデータを読み込み、対応するハンドラーを返します。
     */
    load: (allocator: Balloc) => number;
};
/**
 * ReBump GCを備えたEcho Stackデュアルバス・バンプアロケータ。
 */
/**
 * データ取り込み用の同期アダプター契約。
 *
 * アダプターは Balloc インスタンスを受け取り、その公開 API を使用してデータを格納し、主要ブロックを識別するハンドラーを返します。
 *
 * @typedef {Object} FormatAdapter
 * @property {(allocator: Balloc) => number} load - アロケーターにデータを読み込み、対応するハンドラーを返します。
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
     * `Balloc` メモリアロケータのインスタンスを作成します。
     *
     * アロケータは2つの独立したバッファを維持します:
     * - `dataBus`: 割り当てられたブロックのデータを格納します。
     * - `controlBus`: ヘッダーおよびその他の制御メタデータを格納します。
     *
     * 各ブロックは固定サイズのヘッダー (`HEADER_SIZE`) を持ち、
     * 11ビットの世代と32ビットのヘッダーアドレスで構成される
     * 43ビットの論理ハンドルによって外部から識別されます。
     *
     * 各ブロックの容量は、設定されたバケットの幅を考慮し、
     * 要素数における次の2のべき乗に切り上げられます。
     *
     * @param {number} [size=65535] - `dataBus` の初期容量（バイト単位）。
     * [2, 0x80000000] の範囲内の安全な整数である必要があります。
     * @param {BucketType} [bucketSize="32u"] - バケットの型およびサイズの識別子
     * （例: Uint32の場合は '32u'、Float64の場合は '64f'、Int8の場合は '8i'）。
     * @param {number} [metadataSize=1024] - `controlBus` の初期容量（バイト単位）。
     * [HEADER_SIZE, 0x80000000] の範囲内の安全な整数である必要があります。
     *
     * @throws {RangeError} `size` が許容範囲外の場合。
     * @throws {RangeError} `bucketSize` が有効なバケット識別子ではない場合。
     * @throws {RangeError} `metadataSize` が許容範囲外の場合。
     */
    constructor(size?: number, bucketSize?: BucketType, metadataSize?: number);
    /**
     * 新しいメモリブロックを割り当てます。
     *
     * 要求された容量は、`size` 要素を格納できる最小の2のべき乗に変換されます。
     * ブロックは、対応する容量を持つ再利用可能な領域のリストから優先的に取得されます。
     * 互換性のある領域が存在しない場合、ブロックは `dataBus` のトップに予約されます。
     *
     * 次に、コントロールスペースからヘッダーが取得されます。以前に解放されたヘッダーは
     * 内部の再利用スタックを通じて再利用でき、そうでない場合は必要に応じて
     * `controlBus` が拡張されます。
     *
     * ヘッダーには、アドレス、容量、初期占有数（ゼロ）、および検証用クッキーが格納されます。
     * 返される値は、割り当て世代とヘッダーアドレスをエンコードしたものです:
     *
     *     [11世代ビット][32ヘッダーアドレスビット]
     *
     * @param {number} [size=16] - ブロックが格納しなければならない最小要素数。
     * [2, 0x80000000] の範囲内の安全な整数である必要があります。
     * @returns {number} 割り当てられたブロックを識別するハンドル。
     * @throws {RangeError} `size` が許容範囲外の場合。
     * @throws {Error} withView() によって借用されているブロックが存在する状態で
     * `dataBus` の拡張が必要になった場合。
     */
    alloc(size?: number): number;
    /**
     * ブロックの容量を次の2のべき乗に拡張します。
     *
     * ブロックが `dataBus` の現在のトップに位置している場合、拡張はインプレースで実行されます：
     * 容量と `dataPointer` のみが更新されます。
     *
     * ブロックの後に別の領域が存在する場合、2倍の容量を持つ新しい領域が
     * 再利用可能な領域から取得されるか、`dataBus` のトップに割り当てられます。
     * 現在占有されている要素が新しい領域にコピーされ、古い領域は再利用リストに戻されます。
     *
     * ヘッダーが保持され、そこに記録されているアドレスと容量のみが更新されるため、
     * ハンドルは有効なまま維持されます。
     *
     * @param {number} handler - 拡張するブロックのハンドル。
     * @returns {void}
     * @throws {Error} ハンドルが無効、破損している場合、またはブロックが
     * withView() によって借用されている場合。また、別のブロックが借用されている状態で
     * 拡張により dataBus の再マッピングが必要になった場合にも発生します。
     * @throws {AggregateError} 容量がサポートされている最大制限に達した場合。
     */
    realloc(handler: number): void;
    /**
     * ブロックのアドレスとハンドルを維持したまま、使用中の要素を格納できる
     * 最小の2のべき乗の容量まで縮小します。
     *
     * ブロックが dataBus のトップにある場合、dataPointer を後退させます。
     * それ以外の場合、解放された末尾領域を2のべき乗の領域に分割し、
     * 各領域を再利用リストに戻します。
     *
     * @param {number} handler - 縮小するブロックのハンドル。
     * @returns {void}
     * @throws {Error} ハンドルが無効または破損している場合、あるいは
     * withView() によってブロックが借用されている場合。
     */
    shrink(handler: number): void;
    free(handler: any): void;
    /**
     * [内部利用]
     * 空き領域を再利用リストに挿入します。
     *
     * リストはバイト単位の容量ごとに整理されます。各容量について、
     * 格納される値は `Uint32Array` であり、位置0には登録されたアドレスの数が格納され、
     * 後続の位置には空き領域のアドレスが格納されます:
     *
     *     [count, address1, address2, ...]
     *
     * ページが一杯になると、そのバッファは現在の容量の2倍に拡張されます。
     *
     * @param {number} capacity - 空き領域の容量（バイト単位）。
     * @param {number} address - `dataBus` 内における領域の開始アドレス。
     * @returns {void}
     * @private
     */
    private recyclePush;
    /**
     * [内部利用]
     * 再利用リストから空き領域を削除します。
     *
     * 検索は要求された正確な容量によって行われます。対応するページが存在する場合、
     * 最後に登録されたアドレスがページから削除されて返され、LIFOスタックとしての
     * 再利用を実現します。
     *
     * @param {number} capacity - 希望する容量（バイト単位）。
     * @returns {number} 再利用可能な領域の開始アドレス、または要求された容量の領域が
     * 存在しない場合は `UNKNOWN`。
     * @private
     */
    private recyclePop;
    /**
     * ReBumpアルゴリズムを使用して `dataBus` をコンパクション（圧縮）します。
     *
     * `controlBus` に登録されたヘッダーを順番に走査し、まだ有効な領域を
     * 新しい `dataBus` にコピーすることで、それらの間にある空きスペースを排除します。
     * 生存している各ブロックのアドレスは、それぞれのヘッダー内で更新されます。
     *
     * `controlBus` 内のブロックの順序は保持されます。各ブロックの内部データも、
     * 予約された容量や現在の占有数を含めて完全に保持されます。
     *
     * コンパクションの完了時:
     * - すべての再利用可能な領域が排除されます。
     * - `dataPointer` は、最後に生存しているブロックの直後のバイトを指すようになります。
     * - `dataBus` は、アクティブなブロックのための連続したヒープを表すようになります。
     *
     * 制御の計算量は O(n) です（`n` は走査されたヘッダーの数）。
     * 実効的なメモリ移動コストは、生存ブロックに属するバイトのボリュームにも依存します。
     *
     * @returns {void}
     * @throws {Error} withView() によって借用されているブロックが存在する場合。
     */
    gc(): void;
    /**
     * [!!! 内部利用、コード内で使用しないでください !!!]
     * `dataBus` の容量を現在の2倍に拡張します。
     *
     * 内部バッファはより大きな `ArrayBuffer` に転送され、既存のデータは保持されます。
     * バッファに関連付けられているすべてのビューは、新しいストレージを参照するように再作成されます。
     *
     * @returns {void}
     * @throws {Error} withView() によって借用されているブロックが存在する場合。
     * @throws {RangeError} `dataBus` の容量がサポートされている最大制限を超過した場合。
     * @private
     */
    private grow;
    /**
     * [!!! 内部利用、コード内で使用しないでください !!!]
     * `controlBus` の容量を現在の2倍に拡張します。
     *
     * 内部バッファはより大きな `ArrayBuffer` に転送され、既存のヘッダーは保持されます。
     * `controlAdapter` は新しいストレージを参照するように再作成されます。
     *
     * @returns {void}
     * @throws {RangeError} `controlBus` の現在の容量がサポートされている最大制限を
     * 超過した場合。
     * @private
     */
    private headerGrow;
    /**
     * ブロックによって占有されているシーケンスの末尾に要素を追加します。
     *
     * 要素は、最後尾の占有要素の直後の最初の空き位置に書き込まれます。
     * ブロックの占有数は、その容量内に空きスペースが存在する場合にのみインクリメントされます。
     *
     * @param {number} value - 挿入する値。
     * @returns {boolean} 値が挿入された場合は `true`、ブロックに利用可能な
     * スペースがない場合は `false`。
     * @throws {Error} ハンドルが無効、破損している場合、またはブロックが withView() によって借用されている場合。
     *
     */
    push(handler: any, value: number): boolean;
    /**
     * ブロックから最後尾の占有要素を削除し、それを返します。
     *
     * 占有数は、削除される要素を読み取る前にデクリメントされます。対応するバイトは
     * クリアされず割り当てられた領域に残りますが、占有されているシーケンスの一部ではなくなります。
     *
     * @param {number} handler - ブロックのハンドル。
     * @returns {number|undefined} 削除された値、またはブロックが空の場合は `undefined`。
     * @throws {Error} ハンドルが無効、破損している場合、またはブロックが withView() によって借用されている場合。
     */
    pop(handler: number): number | undefined;
    /**
     * 最後尾の占有要素を削除せずに返します。
     *
     * @param {number} handler - ブロックのハンドル。
     * @returns {number|undefined} 最後尾の占有値、またはブロックが空の場合は `undefined`。
     * @throws {Error} ハンドルが無効または破損している場合。
     */
    peek(handler: number): number | undefined;
    /**
     * 占有されているシーケンスの先頭に要素を挿入します。
     *
     * 現在占有されている要素が1つ前方にシフトされ、最初の位置に `value` が書き込まれます。
     * この操作には、ブロックの容量内に空き位置が必要です。
     *
     * データのシフトが必要となるため、操作のコストは占有されている要素数に比例します。
     *
     * @param {number} handler - ブロックのハンドル。
     * @param {number} value - 挿入する値。
     * @returns {boolean} 値が挿入された場合は `true`、ブロックが一杯の場合は `false`。
     * @throws {Error} ハンドルが無効、破損している場合、またはブロックが withView() によって借用されている場合。
     */
    nudge(handler: number, value: number): boolean;
    /**
     * ブロックから先頭の占有要素を削除し、それを返します。
     *
     * 残りの要素は、占有領域の先頭に向かって1つシフトされます。ブロックの物理的容量は
     * 変更されません。
     *
     * 操作のコストは、シフトされる要素数に比例します。
     *
     * @param {number} handler - ブロックのハンドル。
     * @returns {number|undefined} 削除された先頭の値、またはブロックが空の場合は `undefined`。
     * @throws {Error} ハンドルが無効、破損している場合、またはブロックが withView() によって借用されている場合。
     */
    pull(handler: number): number | undefined;
    /**
     * 先頭の占有要素を削除せずに返します。
     *
     * @param {number} handler - ブロックのハンドル。
     * @returns {number|undefined} 先頭の占有値、またはブロックが空の場合は `undefined`。
     * @throws {Error} ハンドルが無効または破損している場合。
     */
    head(handler: number): number | undefined;
    /**
     * ブロックの占有要素の中に特定の値が存在するかどうかを確認します。
     *
     * 検索は補助 `TypedArray` に対して直接実行され、予約された物理的容量全体ではなく、
     * 現在占有されている範囲のみを対象とします。
     *
     * @param {number} handler - ブロックのハンドル。
     * @param {number} value - 検索する値。
     * @returns {boolean} `value` が占有要素の中に存在する場合は `true`、それ以外の場合は `false`。
     * @throws {Error} ハンドルが無効または破損している場合。
     */
    has(handler: number, value: number): boolean;
    /**
     * ブロックの占有シーケンス内における要素の最初の出現位置を検索します。
     *
     * 検索はインデックスの昇順で、配下の TypedArray の `indexOf` 操作を使用して実行されます。
     * ブロックの未使用容量は無視され、占有されている要素のみが対象となります。
     *
     * 検索の開始位置は `fromIndex` で指定でき、TypedArray のインデックス付けルールに従います。
     *
     * @param {number} handler - ブロックのハンドル。
     * @param {number|bigint} searchElement - 検索する要素。
     * @param {number} [fromIndex=0] - 検索を開始するインデックス。
     * @returns {number} 最初に見つかったインデックス、または要素が見つからない場合や
     * ブロックが空の場合は `-1`。
     * @throws {Error} ハンドルが無効または破損している場合。
     */
    indexOf(handler: number, searchElement: number | bigint, fromIndex?: number): number;
    /**
     * ブロックの占有シーケンス内における要素の最後の出現位置を検索します。
     *
     * 検索はインデックスの降順で、配下の TypedArray の `lastIndexOf` 操作を使用して実行されます。
     * ブロックの未使用容量は無視され、占有されている要素のみが対象となります。
     *
     * 検索の開始位置は `fromIndex` で指定でき、TypedArray のインデックス付けルールに従います。
     * デフォルトでは、検索は最後尾の占有要素から開始されます。
     *
     * @param {number} handler - ブロックのハンドル。
     * @param {number|bigint} searchElement - 検索する要素。
     * @param {number} [fromIndex=-1] - 検索を開始するインデックス。
     * @returns {number} 最後に見つかったインデックス、または要素が見つからない場合や
     * ブロックが空の場合は `-1`。
     * @throws {Error} ハンドルが無効または破損している場合。
     */
    lastIndexOf(handler: number, searchElement: number | bigint, fromIndex?: number): number;
    /**
    * 0ベースのインデックスに対応する占有要素を返します。
    *
    * `[0, occupied)` の範囲外のインデックスはエラーとはみなされず、
    * `undefined` を返します。
    *
    * @param {number} handler - Block handle.
    * @param {number} index - 要素の0ベースのインデックス。
    * @returns {number|undefined} インデックスに格納されている値、またはインデックスが
    * 占有領域外である場合は `undefined`。
    * @throws {Error} ハンドルが無効または破損している場合。
    */
    get(handler: number, index: number): number | undefined;
    /**
     * 占有されているインデックスに格納されている値を置き換えます。
     *
     * この操作はブロックの占有数を変更しません。`[0, occupied)` の範囲外のインデックスは
     * 無視され、`false` を返します。
     *
     * @param {number} handler - ブロックのハンドル。
     * @param {number} index - 要素の0ベースのインデックス。
     * @param {number} value - 新しい値。
     * @returns {boolean} 値が書き込まれた場合は `true`、インデックスが占有領域外である場合は `false`。
     * @throws {Error} ハンドルが無効、破損している場合、またはブロックが withView() によって借用されている場合。
     */
    set(handler: number, index: number, value: number): boolean;
    /**
     * ブロックの占有数をゼロにし、物理的容量全体を同一の値で埋めます。
     *
     * 埋め立ては、現在占有されている要素だけでなく、利用可能なすべてのスロットを対象とします。
     * 操作後、埋め立てに使用された値に関係なく、ブロックは空とみなされます。
     *
     * @param {number} handler - ブロックのハンドル。
     * @param {number} [value=0] - すべてのスロットを埋めるために使用する値。
     * @returns {void}
     * @throws {Error} ハンドルが無効、破損している場合、またはブロックが withView() によって借用されている場合。
     */
    clear(handler: number, value?: number): void;
    /**
     * ブロックのスロットの範囲を指定した値で埋めます。
     *
     * 範囲には0ベースのインデックスを使用し、`[start, end)` の規約に従います。
     * つまり、`start` は包括的（inclusive）であり、`end` は排他的（exclusive）です。
     * `end` が指定されていない場合、埋め立てはブロックの物理的容量の末尾まで拡張されます。
     *
     * 埋められた範囲が以前の占有数を超える場合を含め、ブロックの占有数は `end` になります。
     *
     * @param {number} handler - ブロックのハンドル。
     * @param {number} value - 埋め立てに使用する値。
     * @param {number} [start=0] - 開始インデックス（包括的）。
     * @param {number|null} [end=null] - 終了インデックス（排他的）。省略された場合や
     * `null` の場合は、ブロックの総容量を使用します。
     * @returns {void}
     * @throws {Error} ハンドルが無効、破損している場合、またはブロックが withView() によって借用されている場合。
     * @throws {RangeError} `start` または `end` が容量の制限外である場合、
     * または `start > end` である場合。
     */
    fill(handler: number, value: number, start?: number, end?: number | null): void;
    /**
     * ブロックのすべての物理的スロットを指定した値で埋め、容量全体を占有済みにマークします。
     *
     * `clear()` とは異なり、この操作結果は完全に占有されたブロックとなります。
     *
     * @param {number} handler - ブロックのハンドル。
     * @param {number} value - 埋め立てに使用する値。
     * @returns {void}
     * @throws {Error} ハンドルが無効、破損している場合、またはブロックが withView() によって借用されている場合。
     */
    fillAll(handler: number, value: number): void;
    /**
     * `Array` または `TypedArray` の要素をブロックの先頭にコピーします。
     *
     * コピーされる量はブロックの容量によって制限されます。占有数は、以前の占有数と
     * 実際にコピーされた量のうち大きい方に更新されます。したがって、より短いシーケンスが
     * 渡された場合でも、`put()` の呼び出しによって既存の占有数が減少することはありません。
     *
     * `Array` の場合、収まる最初の要素のみがコピーされます。
     * `TypedArray` の場合、中間コピーなしでソースのサブアレイが使用されます。
     *
     * @param {number} handler - ブロックのハンドル。
     * @param {Array|TypedArray} data - コピーする値のシーケンス。
     * @returns {void}
     * @throws {Error} ハンドルが無効、破損している場合、またはブロックが withView() によって借用されている場合。
     * @throws {TypeError} `data` が `Array` でも `TypedArray` でも無い場合。
     */
    put(handler: number, data: any[] | TypedArray): void;
    /**
    * ブロックによって現在占有されている要素のコピーを返します。
    *
    * 結果は `bucketSize` によって設定された型と同じ `TypedArray` です。
    * 占有されていない物理的容量は結果に含まれません。
    *
    * この操作は内部ストレージを直接公開しません。メソッドは `TypedArray.prototype.slice()` を
    * 使用し、独立したストレージを持つ新しいビューを生成します。
    *
    * @param {number} handler - ブロックのハンドル。
    * @returns {TypedArray} ブロックによって占有されている要素のコピー。ブロックが空の場合、
    * 設定された型の空の `TypedArray` を返します。
    * @throws {Error} ハンドルが無効または破損している場合。
    */
    pick(handler: number): TypedArray;
    /**
     * ブロックの占有領域のダイレクトビューに対してコールバックを実行します。
     *
     * ビューは Balloc の内部ストレージを共有し、コピーは行われません。
     * コールバックの実行中、ブロックは互換性のない操作から保護されます。
     *
     * コールバックは同期でなければなりません。受け取ったビューを、コールバックの終了後に
     * 格納、返却、または使用してはなりません。この制限は、元のビューから派生した
     * サブビューにも適用されます。
     *
     * @param {number} handler - ブロックのハンドル。
     * @param {...(number|Function)} args - 1つ以上のブロックハンドルと、その後に続くコールバック。
     * @returns {*} コールバックによって生成された戻り値。
     * @throws {TypeError} ハンドルが指定されていない場合、またはコールバックが関数ではない場合。
     * @throws {Error} いずれかのハンドルが無効、重複、または借用中の場合。
     */
    withView(...args: (number | Function)[]): any;
    /**
     * ブロックの物理的容量をバイト単位で返します。
     *
     * 容量は、現在占有されている要素数に関係なく、ブロックのすべてのスロット用に
     * 予約されたスペースに対応します。
     *
     * @param {number} handler - ブロックのハンドル。
     * @returns {number} ブロックの物理的容量（バイト単位）。
     * @throws {Error} ハンドルが無効または破損している場合。
     */
    byteSize(handler: number): number;
    /**
     * ブロック内で現在占有されている要素の数を返します。
     *
     * @param {number} handler - ブロックのハンドル。
     * @returns {number} 占有されている要素数。
     * @throws {Error} ハンドルが無効または破損している場合。
     */
    occupied(handler: number): number;
    /**
     * 要素数におけるブロックの容量を返します。
     *
     * この値は、現在占有されている数量ではなく、物理的に予約されたスロットの総数に対応します。
     *
     * @param {number} handler - ブロックのハンドル。
     * @returns {number} ブロック内で利用可能なスロットの総数。
     * @throws {Error} ハンドルが無効または破損している場合。
     */
    length(handler: number): number;
    /**
     * メモリブロックが割り当て容量に達しているかどうかを確認します。
     *
     * 占有されている要素数が割り当てられた総容量に等しく、新しい要素を格納する
     * 利用可能な位置が残っていない場合、ブロックは一杯とみなされます。
     *
     * @param {number} handler - ブロックのハンドル。
     * @returns {boolean} ブロックが一杯の場合は `true`、それ以外の場合は `false`。
     * @throws {Error} ハンドルが無効または破損している場合。
     */
    isFull(handler: number): boolean;
    /**
    * あるブロックから別のブロックへ占有要素をコピーします。
    *
    * コピーは `source` の最初の要素と `destination` の最初のスロットから開始されます。
    * 実際にコピーされる量は、ソース内の占有要素数、宛先の物理的容量、および
    * `slots` で指定された制限によって制限されます。
    *
    * 必要に応じて、コピーされた要素をカバーするように宛先の占有数が引き上げられます。
    * 宛先の容量は変更されません。
    *
    * この操作では `dataBus` に対して `Uint8Array.prototype.copyWithin()` を使用するため、
    * 戻り値はデータバスを表す `Uint8Array` 自体になります。
    *
    * @param {number} source - コピー元ブロックのハンドル。
    * @param {number} destination - コピー先ブロックのハンドル。
    * @param {number} [slots=UNKNOWN] - コピーする最大要素数。
    * `UNKNOWN` は、追加の制限を課さないために使用されるセンチネル値を表します。
    * @returns {Uint8Array} 操作後の `dataBus`。
    * @throws {Error} ハンドルが無効、破損している場合、
    * またはコピー先ブロックが withView() によって借用されている場合。
    */
    copy(source: number, destination: number, slots?: number): Uint8Array;
    /**
     * ブロック内の要素の領域をブロック自身の中でコピーします。
     *
     * インデックスは0ベースであり、`Array.prototype.copyWithin()` のセマンティクスに従います：
     * `target` は宛先位置を特定し、`start` はソースの開始位置を特定し、
     * `length` はコピーする最大要素数を特定します。
     *
     * 負のインデックスはブロックの容量の末尾から解釈されます。この正規化の後、インデックスは
     * 物理的容量にクランプされます。コピーされる量も、実際に占有されている要素と
     * `target` から利用可能なスペースによって制限されます。
     *
     * この操作は重複する領域をサポートしており、宛先の範囲が以前の占有数を超える場合に
     * ブロックの占有数を増やすことができます。
     *
     * @param {number} handler - ブロックのハンドル。
     * @param {number} target - 宛先の開始インデックス。
     * @param {number} start - ソースの開始インデックス。
     * @param {number} length - コピーする最大要素数。
     * @returns {Uint8Array} 操作後の `dataBus`。
     * @throws {Error} ハンドルが無効、破損している場合、またはブロックが withView() によって借用されている場合。
     */
    copyWithin(handler: number, target: number, start: number, length: number): Uint8Array;
    /**
     * `source` の占有要素を `target` の末尾に追加します。
     *
     * コピーされる量は、ソース内の占有要素数と、宛先の容量に残っている空きスペースによって制限されます。
     *
     * この操作は、`target` と `source` が同じブロックを参照することをサポートしています。
     * その場合、コピーはブロック自身の領域上で実行され、`copyWithin()` の重複セマンティクスを保持します。
     *
     * @param {number} target - 要素を受け取るブロックのハンドル。
     * @param {number} source - 要素が追加される元となるブロックのハンドル。
     * @returns {number} 実際に追加された要素数。
     * @throws {Error} ハンドルが無効、破損している場合、
     * またはコピー先ブロックが withView() によって借用されている場合。
     */
    append(target: number, source: number): number;
    /**
     * ブロックの独立したコピーを作成します。
     *
     * 新しいブロックは、元のブロックと同じ物理的容量と占有数を持ちます。
     * 現在占有されていない位置を含む、予約された領域内のすべてのバイトがコピーされます。
     *
     * 新しいブロックには新しいハンドルが割り当てられ、通常の割り当ておよび
     * 再利用のルールの対象となり続けます。
     *
     * @param {number} handler - クローンを作成するブロックのハンドル。
     * @returns {number} 新しいブロックのハンドル。
     * @throws {Error} ハンドルが無効または破損している場合。
     */
    clone(handler: number): number;
    /**
     * 2つのブロックに関連付けられたデータ領域をスワップ（交換）します。
     *
     * この操作は、ヘッダー間で領域のアドレス、容量、および占有数を交換します。
     * ハンドルは変更されません：操作後も、各ハンドルは自身のヘッダーを識別し続けますが、
     * そのヘッダーは以前もう一方のブロックに属していた領域を記述するようになります。
     *
     * `dataBus` 内のデータは一切コピーされず、2つのヘッダーのメタデータのみが変更されます。
     *
     * @param {number} source - 1つ目のブロックのハンドル。
     * @param {number} target - 2つ目のブロックのハンドル。
     * @returns {void}
     * @throws {Error} ハンドルが無効、破損している場合、
     * またはいずれかのブロックが withView() によって借用されている場合。
     */
    swap(source: number, target: number): void;
    /**
     * メモリブロックのコンテンツとメタデータをシリアライズします。
     *
     * このメソッドは `pick()` を介してブロックの占有データを抽出し、
     * 容量およびワード型の情報とともにデータエンベロープにグループ化し、
     * CBORフォーマットを使用してエンコードします。
     *
     * @param {number} handler - シリアライズするブロックのハンドル。
     * @returns {Uint8Array} ブロックのシリアライズされたデータを格納するバッファ。
     * @throws {Error} ハンドルが無効または破損している場合。
     */
    dump(handler: number): Uint8Array;
    /**
     * シリアライズされたデータからメモリブロックを復元します。
     *
     * CBORエンベロープをデコードし、シリアライズされたデータのワード型が
     * 現在のアロケータインスタンスと互換性があるかどうかを検証し、
     * コンテンツを格納するために必要な容量を持つ新しいブロックを割り当てます。
     * その後、元のデータと占有数が新しいブロックに復元されます。
     *
     * @param {Uint8Array|ArrayBuffer} serialized - シリアライズされたデータを格納するバッファ。
     * @returns {number} 再作成された新しいブロックのハンドル。
     * @throws {Error} デコードされたデータのワード型がアロケータの設定と異なる場合。
     */
    load(serialized: Uint8Array | ArrayBuffer): number;
    /**
     * 専用アダプターを通じてデータを読み込みます。
     *
     * アダプターはこのインスタンスを受け取り、その公開 API を使用して
     * 必要なブロックを割り当て、データを書き込みます。データの構成と
     * 解釈はアダプターのみが担当し、Balloc は処理を委譲して生成された
     * ハンドラーを返します。
     *
     * この操作は同期的に実行されます。アダプターは戻る前にデータの
     * 取り込みを完了し、読み込みに失敗した場合は自身の割り当てを
     * 元に戻す責任を負います。
     *
     * @param {FormatAdapter} adapter - load(allocator) を実装するアダプター。
     * @returns {number} アダプターが返すハンドラー。
     * @throws {TypeError} アダプターが load() メソッドを実装していない場合。
     * @throws {Error} アダプターが指定されたインフラストラクチャを拒否した場合。
     */
    loadData(adapter: FormatAdapter): number;
    /**
     * 借用中のブロックに対する変更操作を禁止します。
     *
     * 指定されたアドレスに関連付けられたヘッダー内の VIEW_LOCK フラグを確認します。
     *
     * @param {number} headerAddress - controlBus 内のヘッダーのアドレス。
     * @returns {void}
     * @throws {Error} ブロックが withView() によって借用されている場合。
     * @private
     * @deprecated
    */
    private assertNotBorrowed;
    /**
     * いずれかのセグメントが借用されている間、dataBus を置き換える
     * または再マッピングする操作を禁止します。
     *
     * @returns {void}
     * @throws {Error} withView() によって借用されているブロックが存在する場合。
     * @private
     */
    private assertNoActiveViews;
    /**
     * [内部利用]
     * ハンドルに関連付けられたメタデータをデコードします。
     *
     * ハンドルは世代とヘッダーアドレスに分割されます。次に、ヘッダーに格納されているクッキーが
     * 再計算されて組み合わせが検証され、この検証が成功した後にのみメタデータが読み取られます。
     *
     * デコードされたフィールドは `out` オブジェクトに書き込まれ、この関数自身によって返されます。
     * 新しい割り当てを回避するために、このオブジェクトは呼び出し間で再利用できます。
     *
     * @param {number} handler - デコードおよび検証するハンドル。
     * @param {Metadata} out - デコードされたメタデータを受け取るオブジェクト。
     * @returns {Metadata} `out` で提供されたものと同じ参照。
     * @throws {Error} ヘッダーのクッキーがハンドルと一致しない場合、
     * またはハンドルが有効なヘッダーを特定できない場合。
     * @private
     */
    private extractMetadata;
    /**
     * [内部利用]
     * ヘッダーの検証用クッキーを計算します。
     *
     * クッキーは、高速ハッシュ（fast hash）を使用してヘッダーアドレスと
     * 11個の世代ビットから導出されます。
     * 結果は8ビットに縮小されます。
     *
     * 値ゼロは無効なヘッダーインジケータとして予約されているため、
     * 計算結果がゼロになった場合、このメソッドは `1` を返します。
     *
     * クッキーは暗号化メカニズムを構成するものではありません。その目的は、
     * アロケータのメモリ管理モデル内において、無効、失効（stale）、または
     * 破損したハンドルを検出することです。
     *
     * @param {number} addr - ヘッダーのアドレス。
     * @param {number} gen - ハンドルに関連付けられた世代。下位11ビットのみが考慮されます。
     * @returns {number} [1, 255] の範囲の8ビットクッキー。
     * @private
     */
    private bakeCookie;
    /**
     * 再利用リストに現在格納されている領域の数を返します。
     *
     * 各領域は、`dataBus` のトップに直接戻すことができなかった解放済みブロックに
     * 対応しており、将来の同一容量の割り当てによる再利用のために利用可能な状態を維持します。
     *
     * @returns {number} `recycle` に保持されている空き領域の数。
     */
    recycleCount(): number;
    /**
     * 再利用リストに現在格納されている領域に属するバイトの総数を返します。
     *
     * この値は、各空き領域の容量に、その容量に対して登録されている領域の数を
     * 乗算したものを合計して計算されます。
     *
     * @returns {number} 再利用可能な領域によって占有されているバイト数。
     */
    get recycleBytes(): number;
    /**
     * 現在再利用可能ではない領域に属する、割り当てられたバイト数を返します。
     *
     * この値は、`dataPointer` の総進捗から、`recycle` に保持されている空き領域に
     * 属するバイトを減算して取得されます。
     *
     * @returns {number} `dataBus` によってすでに使用されている領域内における、
     * 再利用不可領域に関連付けられたバイト数。
     */
    get allocatedBytes(): number;
    /**
     * `dataBus` のトップでまだ使用されていないバイト数を返します。
     *
     * このスペースは、`dataPointer` と、バッファ用に現在予約されている容量の
     * 終端の間の領域に対応します。
     *
     * @returns {number} `dataPointer` の後に利用可能なバイト数。
     */
    get unallocatedBytes(): number;
    /**
     * 再利用可能なメモリと使用済みヒープ領域の比率を返します。
     *
     * この指標は、`recycle` に保持されている空き領域を断片化とみな軸とし、
     * `dataPointer` を分母として使用します。ヒープによってバイトが使用されていない場合、
     * 結果はゼロになります。
     *
     * この値は `dataBus` の全容量の割合を表すものではなく、バンプポインタによって
     * すでに走査された領域内における再利用可能なバイトの比率を具体的に表します。
     *
     * @returns {number} 通常の稼働条件下における [0, 1] の範囲の断片化率。
     */
    get fragmentationRatio(): number;
}
