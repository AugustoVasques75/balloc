export type BucketType = '8u' | '16u' | '32u' | '64u' | '8i' | '16i' | '32i' | '64i' | '16f' | '32f' | '64f';
export type Metadata = {
    /**
     * - メモリブロックの容量（バイト単位）。
     */
    byteCapacity: number;
    /**
     * - 2のべき乗として表現されたメモリブロックの容量。
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
};
/**
 * ReBump GCを備えたEchoスタックデュアルバスバンプアロケータ。
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
     * `Balloc`メモリアロケータのインスタンスを作成します。
     *
     * アロケータは2つの独立したバッファを維持します:
     * - `dataBus`: 割り当てられたブロックのデータを格納します。
     * - `controlBus`: ヘッダーおよびその他の制御メタデータを格納します。
     *
     * 各ブロックは固定サイズのヘッダー（`HEADER_SIZE`）を持ち、
     * 11ビットの世代と32ビットのヘッダーアドレスで構成される
     * 43ビットの論理ハンドルによって外部から識別されます。
     *
     * 各ブロックの容量は、設定されたバケット幅を考慮して、
     * 要素数における次の2のべき乗に切り上げられます。
     *
     * @param {number} [size=65535] - `dataBus`の初期容量（バイト単位）。
     * [2, 0x80000000]の範囲内の安全な整数である必要があります。
     * @param {BucketType} [bucketSize="32u"] - バケットの型およびサイズの識別子
     * （例: Uint32の場合は'32u'、Float64の場合は'64f'、Int8の場合は'8i'）。
     * @param {number} [metadataSize=1024] - `controlBus`の初期容量（バイト単位）。
     * [HEADER_SIZE, 0x80000000]の範囲内の安全な整数である必要があります。
     *
     * @throws {RangeError} `size`が許容範囲外の場合。
     * @throws {RangeError} `bucketSize`が有効なバケット識別子ではない場合。
     * @throws {RangeError} `metadataSize`が許容範囲外の場合。
     */
    constructor(size?: number, bucketSize?: BucketType, metadataSize?: number);
    /**
     * 新しいメモリブロックを割り当てます。
     *
     * 要求された容量は、`size`要素を収容できる最小の2のべき乗に変換されます。
     * ブロックは、対応する容量を持つ再利用可能な領域のリストから優先的に取得されます。
     * 互換性のある領域が存在しない場合、ブロックは`dataBus`の先頭に予約されます。
     *
     * 次に、制御領域からヘッダーが取得されます。
     * 事前に解放されたヘッダーは内部の再利用スタックを介して再利用でき、
     * そうでない場合は必要に応じて`controlBus`が拡張されます。
     *
     * ヘッダーには、アドレス、容量、初期占有数（ゼロ）、および検証用クッキーが格納されます。
     * 返される値は、割り当て世代とヘッダーアドレスをエンコードします:
     *
     *     [11ビットの世代][32ビットのヘッダーアドレス]
     *
     * @param {number} [size=16] - ブロックが収容すべき最小要素数。
     * [2, 0x80000000]の範囲内の安全な整数である必要があります。
     * @returns {number} 割り当てられたブロックを識別するハンドル。
     * @throws {RangeError} `size`が許容範囲外の場合。
     */
    alloc(size?: number): number;
    /**
     * ブロックの容量を次の2のべき乗に拡張します。
     *
     * ブロックが`dataBus`の現在のトップに位置している場合、
     * 拡張はインプレースで実行されます：容量と`dataPointer`のみが更新されます。
     *
     * ブロックの背後に別の領域が存在する場合、2倍の容量を持つ新しい領域が
     * 再利用可能領域から取得されるか、あるいは`dataBus`のトップに割り当てられます。
     * その後、現在占有されている要素が新しい領域にコピーされ、
     * 古い領域は再利用リストに戻されます。
     *
     * ヘッダーが保持され、内部に記録されているアドレスと容量のみが更新されるため、
     * ハンドルは有効なまま維持されます。
     *
     * @param {number} handler - 拡張するブロックのハンドル。
     * @returns {void}
     * @throws {Error} ハンドルが無効または破損している場合。
     * @throws {AggregateError} 容量がサポートされている最大制限に達した場合。
     */
    realloc(handler: number): void;
    /**
     * メモリブロックを解放します。
     *
     * ブロックのヘッダーはそのクッキーをゼロにすることで無効化され、
     * そのアドレスは後で再利用するために登録されます。
     * データ領域も再利用システムに返却されますが、
     * ブロックが`dataBus`の正確なトップにある場合は例外です。
     * その場合、再利用リストのエントリを作成することなく、
     * 単に`dataPointer`が巻き戻されて領域が破棄されます。
     *
     * @param {number} handler - 解放するブロックのハンドル。
     * @returns {void}
     * @throws {Error} ハンドルが無効または破損している場合。
     */
    free(handler: number): void;
    /**
     * [内部利用]
     * 空き領域を再利用リストに挿入します。
     *
     * リストはバイト単位の容量ごとに整理されます。
     * 各容量に対して格納される値は`Uint32Array`であり、
     * そのインデックス0の位置には登録されたアドレスの数が格納され、
     * それ以降の位置には空き領域のアドレスが格納されます:
     *
     *     [count, address1, address2, ...]
     *
     * ページが一杯になると、そのバッファは現在の容量の2倍に拡張されます。
     *
     * @param {number} capacity - 空き領域の容量（バイト単位）。
     * @param {number} address - `dataBus`内における領域の開始アドレス。
     * @returns {void}
     * @private
     */
    private recyclePush;
    /**
     * [内部利用]
     * 再利用リストから空き領域を削除します。
     *
     * 要求された正確な容量によって検索が行われます。
     * 対応するページが存在する場合、登録されている最後のアドレスがページから削除されて返され、
     * LIFOスタックとしての再利用が実現されます。
     *
     * @param {number} capacity - 希望する容量（バイト単位）。
     * @returns {number} 再利用可能な領域の開始アドレス、
     * または要求された容量の領域が存在しない場合は`UNKNOWN`。
     * @private
     */
    private recyclePop;
    /**
     * ReBumpアルゴリズムを使用して`dataBus`をコンパクションします。
     *
     * `controlBus`に登録されているヘッダーを順次走査し、
     * まだ有効な領域を新しい`dataBus`にコピーすることで、
     * それらの間に存在する空きスペースを排除します。
     * 生存している各ブロックのアドレスは、それぞれのヘッダー内で更新されます。
     *
     * `controlBus`内でのブロックの順序は保持されます。
     * 各ブロックの内部データも、予約された容量や現在の占有数を含めて完全に保持されます。
     *
     * コンパクションの完了時:
     * - すべての再利用可能な領域が排除されます。
     * - `dataPointer`は最後の生存ブロックの直後のバイトを指すようになります。
     * - `dataBus`はアクティブなブロックのための連続したヒープを表現するようになります。
     *
     * 制御の複雑さはO(n)です（`n`は走査されたヘッダーの数）。
     * メモリ移動の実効コストは、生存ブロックに属するバイトのボリュームにも依存します。
     *
     * @returns {void}
     */
    gc(): void;
    /**
     * [!!! 内部利用、コード内で直接使用しないでください !!!]
     * `dataBus`の容量を現在の2倍に拡張します。
     *
     * 基底のバッファは既存のデータを保持したまま、より大きな`ArrayBuffer`に転送されます。
     * バッファに関連付けられているすべてのビューは、新しいストレージを参照するように再作成されます。
     *
     * @returns {void}
     * @throws {RangeError} `dataBus`の容量がサポートされている最大制限を超えた場合。
     * @private
     */
    private grow;
    /**
     * [!!! 内部利用、コード内で直接使用しないでください !!!]
     * `controlBus`の容量を現在の2倍に拡張します。
     *
     * 基底のバッファは既存のヘッダーを保持したまま、より大きな`ArrayBuffer`に転送されます。
     * 新しいストレージを参照するために`controlAdapter`が再作成されます。
     *
     * @returns {void}
     * @throws {RangeError} `controlBus`の現在の容量がサポートされている最大制限を超えた場合。
     * @private
     */
    private headerGrow;
    /**
     * ブロックの占有シーケンスの末尾に要素を追加します。
     *
     * 要素は、最後に占有された要素の直後の最初の空き位置に書き込まれます。
     * ブロックの占有数は、容量内に利用可能な空きスペースがある場合にのみインクリメントされます。
     *
     * @param {number} handler - ブロックのハンドル。
     * @param {number} value - 挿入する値。
     * @returns {boolean} 値が挿入された場合は`true`、
     * ブロックに利用可能な空きスペースがない場合は`false`。
     * @throws {Error} ハンドルが無効または破損している場合。
     */
    push(handler: number, value: number): boolean;
    /**
     * ブロックから最後に占有された要素を削除し、それを返します。
     *
     * 削除する要素を読み取る前に占有数がデクリメントされます。
     * 対応するバイトはクリアされず割り当てられた領域に残りますが、
     * 占有シーケンスの一部からは外れます。
     *
     * @param {number} handler - ブロックのハンドル。
     * @returns {number|undefined} 削除された値、またはブロックが空の場合は`undefined`。
     * @throws {Error} ハンドルが無効または破損している場合。
     */
    pop(handler: number): number | undefined;
    /**
     * 最後に占有された要素を削除せずに返します。
     *
     * @param {number} handler - ブロックのハンドル。
     * @returns {number|undefined} 最後に占有された値、またはブロックが空の場合は`undefined`。
     * @throws {Error} ハンドルが無効または破損している場合。
     */
    peek(handler: number): number | undefined;
    /**
     * 占有シーケンスの先頭に要素を挿入します。
     *
     * 現在占有されている要素が1つ前方にシフトされ、先頭の位置に`value`が書き込まれます。
     * この操作には、ブロックの容量内に空き位置が必要です。
     *
     * データのシフトが必要となるため、操作のコストは占有されている要素数に比例します。
     *
     * @param {number} handler - ブロックのハンドル。
     * @param {number} value - 挿入する値。
     * @returns {boolean} 値が挿入された場合は`true`、ブロックが一杯の場合は`false`。
     * @throws {Error} ハンドルが無効または破損している場合。
     */
    nudge(handler: number, value: number): boolean;
    /**
     * ブロックから最初に占有された要素を削除し、それを返します。
     *
     * 残りの要素は占有領域の先頭に向かって1つずつシフトされます。
     * ブロックの物理的な容量は変更されません。
     *
     * 操作のコストは、シフトされる要素数に比例します。
     *
     * @param {number} handler - ブロックのハンドル。
     * @returns {number|undefined} 削除された最初の値、またはブロックが空の場合は`undefined`。
     * @throws {Error} ハンドルが無効または破損している場合。
     */
    pull(handler: number): number | undefined;
    /**
     * 最初に占有された要素を削除せずに返します。
     *
     * @param {number} handler - ブロックのハンドル。
     * @returns {number|undefined} 最初に占有された値、またはブロックが空の場合は`undefined`。
     * @throws {Error} ハンドルが無効または破損している場合。
     */
    head(handler: number): number | undefined;
    /**
     * ブロックの占有要素の中に特定の値が存在するかどうかを検証します。
     *
     * 検索は補助的な`TypedArray`に対して直接実行され、
     * 予約された物理容量全体ではなく、現在占有されている範囲のみを対象とします。
     *
     * @param {number} handler - ブロックのハンドル。
     * @param {number} value - 検索する値。
     * @returns {boolean} 占有要素の中に`value`が存在する場合は`true`、
     * それ以外の場合は`false`。
     * @throws {Error} ハンドルが無効または破損している場合。
     */
    has(handler: number, value: number): boolean;
    /**
    * 0から始まるインデックスを指定して、占有されている要素を返します。
    *
    * 範囲外のインデックス（`[0, occupied)`外）はエラーとはみなされず、
    * `undefined`を返します。
    *
    * @param {number} handler - ブロックのハンドル。
    * @param {number} index - 要素の0から始まるインデックス。
    * @returns {number|undefined} インデックスに格納されている値、
    * またはインデックスが占有領域外の場合は`undefined`。
    * @throws {Error} ハンドルが無効または破損している場合。
    */
    get(handler: number, index: number): number | undefined;
    /**
     * 占有されているインデックスに格納されている値を置き換えます。
     *
     * この操作によってブロックの占有数は変更されません。
     * 範囲外のインデックス（`[0, occupied)`外）は無視され、`false`を返します。
     *
     * @param {number} handler - ブロックのハンドル。
     * @param {number} index - 要素の0から始まるインデックス。
     * @param {number} value - 新しい値。
     * @returns {boolean} 値が書き込まれた場合は`true`、
     * インデックスが占有領域外の場合は`false`。
     * @throws {Error} ハンドルが無効または破損している場合。
     */
    set(handler: number, index: number, value: number): boolean;
    /**
     * ブロックの占有数をゼロにし、物理容量全体を同じ値で埋めます。
     *
     * 埋め込みは現在占有されている要素だけでなく、利用可能なすべてのスロットを対象とします。
     * 操作後、埋め込みに使用された値に関係なく、ブロックは空であるとみなされます。
     *
     * @param {number} handler - ブロックのハンドル。
     * @param {number} [value=0] - すべてのスロットを埋めるために使用する値。
     * @returns {void}
     * @throws {Error} ハンドルが無効または破損している場合。
     */
    clear(handler: number, value?: number): void;
    /**
     * ブロックのスロットの指定範囲を指定された値で埋めます。
     *
     * 範囲には0から始まるインデックスを使用し、`[start, end)`の規約に従います。
     * つまり、`start`は包括的であり、`end`は排他的です。
     * `end`が指定されていない場合、ブロックの物理容量の末尾まで埋められます。
     *
     * 埋められた範囲が以前の占有数を超える場合も含め、
     * ブロックの占有数は`end`に変更されます。
     *
     * @param {number} handler - ブロックのハンドル。
     * @param {number} value - 埋め込みに使用する値。
     * @param {number} [start=0] - 開始インデックス（包括的）。
     * @param {number|null} [end=null] - 終了インデックス（排他的）。
     * 省略された場合、または`null`の場合、ブロックの全容量を使用します。
     * @returns {void}
     * @throws {Error} ハンドルが無効または破損している場合。
     * @throws {RangeError} `start`または`end`が容量の制限外である場合、
     * または`start > end`である場合。
     */
    fill(handler: number, value: number, start?: number, end?: number | null): void;
    /**
     * ブロックのすべての物理スロットを指定された値で埋め、
     * 容量全体を占有状態としてマークします。
     *
     * `clear()`とは異なり、この操作結果のブロックは完全に占有された状態になります。
     *
     * @param {number} handler - ブロックのハンドル。
     * @param {number} value - 埋め込みに使用する値。
     * @returns {void}
     * @throws {Error} ハンドルが無効または破損している場合。
     */
    fillAll(handler: number, value: number): void;
    /**
     * `Array`または`TypedArray`の要素をブロックの先頭にコピーします。
     *
     * コピーされる量はブロックの容量によって制限されます。
     * 占有数は、以前の占有数と実際にコピーされた量のうち大きい方に更新されます。
     * そのため、より小さなシーケンスを受け取った場合でも、
     * `put()`の呼び出しによって既存の占有数が減少することはありません。
     *
     * `Array`の場合、収まる最初の要素のみがコピーされます。
     * `TypedArray`の場合、中間的なコピーを行わずに元のサブ配列が使用されます。
     *
     * @param {number} handler - ブロックのハンドル。
     * @param {Array|TypedArray} data - コピーする値のシーケンス。
     * @returns {void}
     * @throws {Error} ハンドルが無効または破損している場合。
     * @throws {TypeError} `data`が`Array`でも`TypedArray`でもない場合。
     */
    put(handler: number, data: any[] | TypedArray): void;
    /**
    * ブロックによって現在占有されている要素のコピーを返します。
    *
    * 結果は`bucketSize`で設定された型と同じ`TypedArray`になります。
    * 占有されていない物理容量は結果に含まれません。
    *
    * この操作は内部ストレージを直接公開しません。
    * メソッドは`TypedArray.prototype.slice()`を使用し、
    * 独立したストレージを持つ新しいビューを生成します。
    *
    * @param {number} handler - ブロックのハンドル。
    * @returns {TypedArray} ブロックによって占有されている要素のコピー。
    * ブロックが空の場合は、設定された型の空の`TypedArray`を返します。
    * @throws {Error} ハンドルが無効または破損している場合。
    */
    pick(handler: number): TypedArray;
    /**
     * ブロックの物理容量をバイト単位で返します。
     *
     * 容量は、現在占有されている要素の数に関係なく、
     * ブロック内のすべてのスロットに予約されたスペースに対応します。
     *
     * @param {number} handler - ブロックのハンドル。
     * @returns {number} ブロックの物理容量（バイト単位）。
     * @throws {Error} ハンドルが無効または破損している場合。
     */
    byteSize(handler: number): number;
    /**
     * ブロック内で現在占有されている要素の数を返します。
     *
     * @param {number} handler - ブロックのハンドル。
     * @returns {number} 占有されている要素の数。
     * @throws {Error} ハンドルが無効または破損している場合。
     */
    occupied(handler: number): number;
    /**
     * 要素数におけるブロックの容量を返します。
     *
     * この値は現在占有されている数量ではなく、
     * 物理的に予約されたスロットの総数に対応します。
     *
     * @param {number} handler - ブロックのハンドル。
     * @returns {number} ブロック内で利用可能なスロットの総数。
     * @throws {Error} ハンドルが無効または破損している場合。
     */
    length(handler: number): number;
    /**
     * あるブロックから別のブロックへ占有要素をコピーします。
     *
     * コピーは`source`の最初の要素と`destiny`の最初のスロットから開始されます。
     * 実際にコピーされる量は、コピー元の占有要素数、コピー先の物理容量、
     * および`slots`で指定された制限によって制限されます。
     *
     * コピー先の占有数は、必要に応じてコピーされた要素を網羅するように増加します。
     * コピー先の容量は変更されません。
     *
     * この操作は`dataBus`に対して`Uint8Array.prototype.copyWithin()`を使用するため、
     * 返り値はデータバスを表す`Uint8Array`自身になります。
     *
     * @param {number} source - コピー元ブロックのハンドル。
     * @param {number} destiny - コピー先ブロックのハンドル。
     * @param {number} [slots=UNKNOWN] - コピーする最大要素数。
     * `UNKNOWN`は、追加の制限を課さないために使用されるセンチネル値を表します。
     * @returns {Uint8Array} 操作後の`dataBus`。
     * @throws {Error} `source`または`destiny`が無効または破損している場合。
     */
    copy(source: number, destiny: number, slots?: number): Uint8Array;
    /**
     * ブロック内の要素領域をそのブロック内でコピーします。
     *
     * インデックスは0から始まり、`Array.prototype.copyWithin()`のセマンティクスに従います：
     * `target`がコピー先位置を特定し、`start`がコピー元の開始位置を特定し、
     * `length`がコピーする最大要素数を特定します。
     *
     * 負のインデックスはブロック容量の末尾からの相対位置として解釈されます。
     * この正規化の後、インデックスは物理容量内にクランプされます。
     * コピーされる量も、実際に占有されている要素と`target`からの利用可能なスペースによって制限されます。
     *
     * この操作は重複する領域をサポートしており、
     * 宛先範囲が現在の占有数を超える場合はブロックの占有数を増加させることができます。
     *
     * @param {number} handler - ブロックのハンドル。
     * @param {number} target - コピー先の開始インデックス。
     * @param {number} start - コピー元の開始インデックス。
     * @param {number} length - コピーする最大要素数。
     * @returns {Uint8Array} 操作後の`dataBus`。
     * @throws {Error} ハンドルが無効または破損している場合。
     */
    copyWithin(handler: number, target: number, start: number, length: number): Uint8Array;
    /**
     * `source`の占有要素を`target`の末尾に追加します。
     *
     * コピーされる量は、コピー元の占有要素数と、
     * コピー先の容量に残っている空きスペースによって制限されます。
     *
     * この操作は、`target`と`source`が同じブロックを参照する場合をサポートします。
     * その場合、コピーはブロック自身の領域上で実行され、
     * `copyWithin()`の重複セマンティクスを保持します。
     *
     * @param {number} target - 要素を受け取るブロックのハンドル。
     * @param {number} source - 要素を追加する元のブロックのハンドル。
     * @returns {number} 実際に追加された要素の数。
     * @throws {Error} `target`または`source`が無効または破損している場合。
     */
    append(target: number, source: number): number;
    /**
     * ブロックの独立したコピーを作成します。
     *
     * 新しいブロックは、元のブロックと同じ物理容量と占有数を持ちます。
     * 現在占有されていない位置を含め、予約された領域のすべてのバイトがコピーされます。
     *
     * 新しいブロックは新しいハンドルを受け取り、通常の割り当ておよび再利用ルールに従います。
     *
     * @param {number} handler - クローンを作成するブロックのハンドル。
     * @returns {number} 新しいブロックのハンドル。
     * @throws {Error} ハンドルが無効または破損している場合。
     */
    clone(handler: number): number;
    /**
     * 2つのブロックに関連付けられているデータ領域をスワップします。
     *
     * この操作は、ヘッダー間で領域のアドレス、容量、および占有数を交換します。
     * ハンドルは変更されません。操作後も、各ハンドルは自身のヘッダーを識別し続けますが、
     * そのヘッダーは以前はもう一方のブロックに属していた領域を指すようになります。
     *
     * `dataBus`上でのデータのコピーは一切行われず、2つのヘッダーのメタデータのみが変更されます。
     *
     * @param {number} source - 1つ目のブロックのハンドル。
     * @param {number} target - 2つ目のブロックのハンドル。
     * @returns {void}
     * @throws {Error} `source`または`target`が無効または破損している場合。
     */
    swap(source: number, target: number): void;
    /**
     * メモリブロックの内容とメタデータをシリアライズします。
     *
     * このメソッドは`pick()`を介してブロックの占有データを抽出し、
     * 容量および単語型の情報とともにデータエンベロープにまとめて、
     * CBOR形式を使用してエンコードします。
     *
     * @param {number} handler - シリアライズするブロックのハンドル。
     * @returns {Uint8Array} シリアライズされたブロックデータを格納するバッファ。
     * @throws {Error} ハンドルが無効または破損している場合。
     */
    dump(handler: number): Uint8Array;
    /**
     * シリアライズされたデータからメモリブロックを復元します。
     *
     * CBORエンベロープをデコードし、シリアライズされたデータの単語型が
     * 現在のアロケータインスタンスと互換性があるかどうかを検証し、
     * コンテンツを収容するために必要な容量を持つ新しいブロックを割り当てます。
     * その後、元のデータと占有数が新しいブロックに復元されます。
     *
     * @param {Uint8Array|ArrayBuffer} serialized - シリアライズされたデータを格納するバッファ。
     * @returns {number} 再作成された新しいブロックのハンドル。
     * @throws {Error} デコードされたデータの単語型がアロケータで設定されているものと異なる場合。
     */
    load(serialized: Uint8Array | ArrayBuffer): number;
    /**
     * [内部利用]
     * ハンドルに関連付けられたメタデータをデコードします。
     *
     * ハンドルは世代とヘッダーアドレスに分割されます。
     * 次に、ヘッダーに格納されているクッキーが再計算されて組み合わせが検証され、
     * この検証が成功した後にのみメタデータが読み取られます。
     *
     * デコードされたフィールドは関数自身によって返される`out`オブジェクトに書き込まれます。
     * 新しい割り当てを避けるために、オブジェクトは呼び出し間で再利用できます。
     *
     * @param {number} handler - デコードおよび検証するハンドル。
     * @param {Metadata} out - デコードされたメタデータを受け取るオブジェクト。
     * @returns {Metadata} `out`で提供されたものと同じ参照。
     * @throws {Error} ヘッダーのクッキーがハンドルと一致しない場合、
     * またはハンドルが有効なヘッダーを識別しない場合。
     * @private
     */
    private extractMetadata;
    /**
     * [内部利用]
     * ヘッダーの検証用クッキーを計算します。
     *
     * クッキーは、高速ハッシュを介して
     * ヘッダーアドレスと11ビットの世代から導出されます。
     * 結果は8ビットに縮小されます。
     *
     * 値ゼロは無効なヘッダーのインジケータとして予約されているため、
     * 計算結果がゼロになった場合、メソッドは`1`を返します。
     *
     * クッキーは暗号化メカニズムではありません。
     * その目的は、アロケータのメモリ管理モデル内における無効、
     * スネイル、または破損したハンドルを検出することです。
     *
     * @param {number} addr - ヘッダーアドレス。
     * @param {number} gen - ハンドルに関連付けられた世代。
     * 下位11ビットのみが考慮されます。
     * @returns {number} [1, 255]の範囲内の8ビットクッキー。
     * @private
     */
    private bakeCookie;
    /**
     * 再利用リストに現在格納されている領域の数を返します。
     *
     * 各領域は、`dataBus`のトップに直接返却できなかった解放済みブロックに対応し、
     * したがって、将来の同一容量の割り当てによる再利用のために利用可能な状態で維持されます。
     *
     * @returns {number} `recycle`内に保持されている空き領域の数。
     */
    recycleCount(): number;
    /**
     * 再利用リストに現在格納されている領域に属するバイトの総数を返します。
     *
     * この値は、各空き領域の容量に、
     * その容量に対して登録された領域の数を掛け合わせたものを合計して計算されます。
     *
     * @returns {number} 再利用可能な領域によって占有されているバイト数。
     */
    get recycleBytes(): number;
    /**
     * 現在再利用可能ではない領域に属する、割り当てられたバイト数を返します。
     *
     * この値は、`dataPointer`の総進行量から、
     * `recycle`内に保持されている空き領域に属するバイトを差し引くことで得られます。
     *
     * @returns {number} `dataBus`によってすでに使用されている領域内における、
     * 非再利用可能領域に関連付けられたバイト数。
     */
    get allocatedBytes(): number;
    /**
     * `dataBus`のトップでまだ使用されていないバイト数を返します。
     *
     * このスペースは、`dataPointer`とバッファに対して現在予約されている容量の末尾までの領域に対応します。
     *
     * @returns {number} `dataPointer`以降で利用可能なバイト数。
     */
    get unallocatedBytes(): number;
    /**
     * 再利用可能なメモリと使用済みヒープ領域との比率を返します。
     *
     * このメトリックは、`recycle`内に保持されている空き領域を断片化とみな軸とし、
     * `dataPointer`を分母として使用します。
     * ヒープによってバイトがまったく使用されていない場合、結果はゼロになります。
     *
     * この値は`dataBus`の容量全体に対する割合を表すものではなく、
     * バンプポインタによってすでに走査された領域内における再利用可能なバイトの比率を具体的に表します。
     *
     * @returns {number} 通常の動作条件下における[0, 1]の範囲内のフラグメンテーション比率。
     */
    get fragmentationRatio(): number;
}
