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

// src/pt/balloc.mjs
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
   * Cria uma instância do alocador de memória `Balloc`.
   *
   * O alocador mantém dois buffers independentes:
   * - `dataBus`: armazena os dados dos blocos alocados;
   * - `controlBus`: armazena os headers e demais metadados de controle.
   *
   * Cada bloco possui um header de tamanho fixo (`HEADER_SIZE`) e é
   * identificado externamente por um handler de 43 bits lógicos, composto
   * por uma geração de 11 bits e pelo endereço de seu header em 32 bits.
   *
   * A capacidade de cada bloco é arredondada para a próxima potência de
   * dois em elementos, respeitando a largura do bucket configurado.
   *
   * @param {number} [size=65535] - Capacidade inicial do `dataBus`, em bytes.
   * Deve ser um inteiro seguro no intervalo [2, 0x80000000].
   * @param {BucketType} [bucketSize="32u"] - Identificador do tipo e tamanho do bucket
   * (ex: '32u' para Uint32, '64f' para Float64, '8i' para Int8).
   * @param {number} [metadataSize=1024] - Capacidade inicial do `controlBus`,
   * em bytes. Deve ser um inteiro seguro no intervalo
   * [HEADER_SIZE, 0x80000000].
   *
   * @throws {RangeError} Se `size` estiver fora do intervalo permitido.
   * @throws {RangeError} Se `bucketSize` não for um identificador de bucket válido.
   * @throws {RangeError} Se `metadataSize` estiver fora do intervalo permitido.
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
  // ========== ALOCAÇÃO ==========
  /**
   * Aloca um novo bloco de memória.
   *
   * A capacidade solicitada é convertida para a menor potência de dois que
   * comporte `size` elementos. O bloco é obtido preferencialmente da lista
   * de regiões recicláveis com a capacidade correspondente; caso não exista
   * uma região compatível, o bloco é reservado no topo do `dataBus`.
   *
   * Em seguida, um header é obtido do espaço de controle. Headers previamente
   * liberados podem ser reutilizados por meio da pilha interna de reciclagem;
   * caso contrário, o `controlBus` é expandido quando necessário.
   *
   * O header recebe o endereço, a capacidade, a ocupação inicial (zero) e
   * um cookie de validação. O valor retornado codifica a geração da alocação
   * e o endereço do header:
   *
   *     [11 bits de geração][32 bits de endereço do header]
   *
   * @param {number} [size=16] - Número mínimo de elementos que o bloco deve
   * comportar. Deve ser um inteiro seguro no intervalo [2, 0x80000000].
   * @returns {number} Handler que identifica o bloco alocado.
   * @throws {RangeError} Se `size` estiver fora do intervalo permitido.
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
   * Expande a capacidade de um bloco para a próxima potência de dois.
   *
   * Quando o bloco está localizado no topo atual do `dataBus`, a expansão
   * ocorre in-place: somente sua capacidade e o `dataPointer` são
   * atualizados.
   *
   * Caso exista outra região após o bloco, uma nova região com o dobro da
   * capacidade é obtida do espaço reciclável ou alocada no topo do `dataBus`.
   * Os elementos atualmente ocupados são então copiados para a nova região,
   * e a região anterior é devolvida à lista de reciclagem.
   *
   * O handler permanece válido, pois seu header é preservado e apenas o
   * endereço e a capacidade registrados nele são atualizados.
   *
   * @param {number} handler - Handler do bloco a ser expandido.
   * @returns {void}
   * @throws {Error} Se o handler for inválido ou estiver corrompido.
   * @throws {AggregateError} Se a capacidade já tiver atingido o limite
   * máximo suportado.
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
   * Libera um bloco de memória.
   *
   * O header do bloco é invalidado pelo zeramento de seu cookie e seu
   * endereço é registrado para posterior reutilização. A região de dados
   * também é devolvida ao sistema de reciclagem, exceto quando o bloco está
   * exatamente no topo do `dataBus`; nesse caso, o `dataPointer` é simplesmente
   * retrocedido, eliminando a região sem criar uma entrada na lista de
   * reciclagem.
   *
   * @param {number} handler - Handler do bloco a ser liberado.
   * @returns {void}
   * @throws {Error} Se o handler for inválido ou estiver corrompido.
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
  // ========== RECICLAGEM ==========
  /**
   * [USO INTERNO]
   * Insere uma região livre na lista de reciclagem.
   *
   * A lista é organizada por capacidade em bytes. Para cada capacidade, o
   * valor armazenado é um `Uint32Array` cuja posição zero contém a quantidade
   * de endereços registrados e as posições seguintes contêm os endereços das
   * regiões livres:
   *
   *     [count, address1, address2, ...]
   *
   * Quando a página fica cheia, seu buffer é expandido para o dobro da
   * capacidade atual.
   *
   * @param {number} capacity - Capacidade da região livre, em bytes.
   * @param {number} address - Endereço inicial da região no `dataBus`.
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
   * [USO INTERNO]
   * Remove uma região livre da lista de reciclagem.
   *
   * A busca é feita pela capacidade exata solicitada. Quando existe uma
   * página correspondente, o último endereço registrado é removido da
   * página e retornado, implementando a reciclagem como uma pilha LIFO.
   *
   * @param {number} capacity - Capacidade desejada, em bytes.
   * @returns {number} Endereço inicial de uma região reciclável ou `UNKNOWN`
   * quando não existe uma região com a capacidade solicitada.
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
  // ========== COLETA DE LIXO ==========
  /**
   * Compacta o `dataBus` por meio do algoritmo ReBump.
   *
   * Percorre sequencialmente os headers registrados no `controlBus` e copia
   * as regiões ainda válidas para um novo `dataBus`, eliminando os espaços
   * livres existentes entre elas. O endereço de cada bloco sobrevivente é
   * atualizado no respectivo header.
   *
   * A ordem dos blocos no `controlBus` é preservada. Os dados internos de
   * cada bloco também são preservados integralmente, incluindo sua capacidade
   * reservada e sua ocupação atual.
   *
   * Ao final da compactação:
   * - todas as regiões recicláveis são eliminadas;
   * - `dataPointer` passa a apontar para o primeiro byte após o último bloco
   *   vivo;
   * - o `dataBus` passa a representar um heap contíguo para os blocos ativos.
   *
   * A complexidade de controle é O(n), onde `n` é o número de headers
   * percorridos. O custo efetivo de movimentação de memória também depende
   * do volume de bytes pertencente aos blocos vivos.
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
  // ========== ESCALONAGEM ==========
  /**
   * [!!! USO INTERNO, NÃO USE NO SEU CÓDIGO !!!]
   * Expande o `dataBus` para o dobro de sua capacidade atual.
   *
   * O buffer subjacente é transferido para um `ArrayBuffer` maior, preservando
   * os dados existentes. Todas as views associadas ao buffer são recriadas
   * para referenciar o novo armazenamento.
   *
   * @returns {void}
   * @throws {RangeError} Se a capacidade do `dataBus` já tiver excedido o
   * limite máximo suportado.
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
   * [!!! USO INTERNO, NÃO USE NO SEU CÓDIGO !!!]
   * Expande o `controlBus` para o dobro de sua capacidade atual.
   *
   * O buffer subjacente é transferido para um `ArrayBuffer` maior, preservando
   * os headers existentes. O `controlAdapter` é recriado para referenciar
   * o novo armazenamento.
   *
   * @returns {void}
   * @throws {RangeError} Se a capacidade atual do `controlBus` já tiver
   * excedido o limite máximo suportado.
   * @private
   */
  headerGrow() {
    if (this.controlBus.byteLength > 2147483648) throw new RangeError("Control bus capacity exceeded");
    const newSize = this.controlBus.byteLength * 2 >>> 0;
    const newBuffer = this.controlBus.buffer.transfer(newSize);
    this.controlBus = new Uint8Array(newBuffer);
    this.controlAdapter = new DataView(newBuffer);
  }
  // ========== OPERAÇÕES DE STACK ==========
  /**
   * Adiciona um elemento ao final da sequência ocupada pelo bloco.
   *
   * O elemento é gravado na primeira posição livre após o último elemento
   * ocupado. A ocupação do bloco é incrementada somente quando existe espaço
   * disponível em sua capacidade.
   *
   * @param {number} handler - Handler do bloco.
   * @param {number} value - Valor a ser inserido.
   * @returns {boolean} `true` se o valor foi inserido; `false` se o bloco
   * já estiver sem espaço disponível.
   * @throws {Error} Se o handler for inválido ou estiver corrompido.
   */
  push(handler, value) {
    const meta = this.extractMetadata(handler, this.metadata);
    if ((meta.occupied + 1) * this.wordSize > meta.byteCapacity) return false;
    this.writer(meta.dataAddress + meta.occupied * this.wordSize, value, IS_LITTLE_ENDIAN);
    this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, meta.occupied + 1, IS_LITTLE_ENDIAN);
    return true;
  }
  /**
   * Remove o último elemento ocupado do bloco e o retorna.
   *
   * A ocupação é decrementada antes da leitura do elemento removido. Os
   * bytes correspondentes não são limpos e permanecem na região alocada,
   * mas deixam de fazer parte da sequência ocupada.
   *
   * @param {number} handler - Handler do bloco.
   * @returns {number|undefined} Valor removido ou `undefined` se o bloco
   * estiver vazio.
   * @throws {Error} Se o handler for inválido ou estiver corrompido.
   */
  pop(handler) {
    const meta = this.extractMetadata(handler, this.metadata);
    if (meta.occupied === 0) return void 0;
    this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, meta.occupied - 1, IS_LITTLE_ENDIAN);
    return this.reader(meta.dataAddress + (meta.occupied - 1) * this.wordSize, IS_LITTLE_ENDIAN);
  }
  /**
   * Retorna o último elemento ocupado sem removê-lo.
   *
   * @param {number} handler - Handler do bloco.
   * @returns {number|undefined} Último valor ocupado ou `undefined` se o
   * bloco estiver vazio.
   * @throws {Error} Se o handler for inválido ou estiver corrompido.
   */
  peek(handler) {
    const meta = this.extractMetadata(handler, this.metadata);
    if (meta.occupied === 0) return void 0;
    return this.reader(meta.dataAddress + (meta.occupied - 1) * this.wordSize, IS_LITTLE_ENDIAN);
  }
  // ========== OPERAÇÕES DE QUEUE ==========
  /**
   * Insere um elemento no início da sequência ocupada.
   *
   * Os elementos atualmente ocupados são deslocados uma posição para a
   * frente e `value` é gravado na primeira posição. A operação exige uma
   * posição livre na capacidade do bloco.
   *
   * O custo da operação é proporcional ao número de elementos ocupados,
   * pois os dados precisam ser deslocados.
   *
   * @param {number} handler - Handler do bloco.
   * @param {number} value - Valor a ser inserido.
   * @returns {boolean} `true` se o valor foi inserido; `false` se o bloco
   * estiver cheio.
   * @throws {Error} Se o handler for inválido ou estiver corrompido.
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
   * Remove o primeiro elemento ocupado do bloco e o retorna.
   *
   * Os elementos restantes são deslocados uma posição em direção ao início
   * da região ocupada. A capacidade física do bloco permanece inalterada.
   *
   * O custo da operação é proporcional ao número de elementos deslocados.
   *
   * @param {number} handler - Handler do bloco.
   * @returns {number|undefined} Primeiro valor removido ou `undefined` se o
   * bloco estiver vazio.
   * @throws {Error} Se o handler for inválido ou estiver corrompido.
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
   * Retorna o primeiro elemento ocupado sem removê-lo.
   *
   * @param {number} handler - Handler do bloco.
   * @returns {number|undefined} Primeiro valor ocupado ou `undefined` se o
   * bloco estiver vazio.
   * @throws {Error} Se o handler for inválido ou estiver corrompido.
   */
  head(handler) {
    const meta = this.extractMetadata(handler, this.metadata);
    if (meta.occupied === 0) return void 0;
    return this.reader(meta.dataAddress, IS_LITTLE_ENDIAN);
  }
  // ========== ACESSO ALEATÓRIO ==========
  /**
   * Verifica se um valor está presente entre os elementos ocupados do bloco.
   *
   * A busca é realizada diretamente sobre a `TypedArray` auxiliar e considera
   * somente o intervalo atualmente ocupado, não toda a capacidade física
   * reservada.
   *
   * @param {number} handler - Handler do bloco.
   * @param {number} value - Valor a ser procurado.
   * @returns {boolean} `true` se `value` estiver presente entre os elementos
   * ocupados; caso contrário, `false`.
   * @throws {Error} Se o handler for inválido ou estiver corrompido.
   */
  has(handler, value) {
    const meta = this.extractMetadata(handler, this.metadata);
    if (meta.occupied === 0) return false;
    const rawAddres = meta.dataAddress >>> this.wordShift;
    return this.auxiliary.subarray(rawAddres, rawAddres + meta.occupied).includes(value);
  }
  /**
  * Retorna o elemento ocupado em um índice baseado em zero.
  *
  * Índices fora do intervalo `[0, occupied)` não são considerados erro e
  * resultam em `undefined`.
  *
  * @param {number} handler - Handler do bloco.
  * @param {number} index - Índice baseado em zero do elemento.
  * @returns {number|undefined} Valor armazenado no índice ou `undefined` se
  * o índice estiver fora da região ocupada.
  * @throws {Error} Se o handler for inválido ou estiver corrompido.
  */
  get(handler, index) {
    const meta = this.extractMetadata(handler, this.metadata);
    if (index < 0 || index >= meta.occupied) return void 0;
    return this.reader(meta.dataAddress + index * this.wordSize, IS_LITTLE_ENDIAN);
  }
  /**
   * Substitui o valor armazenado em um índice ocupado.
   *
   * A operação não altera a ocupação do bloco. Índices fora do intervalo
   * `[0, occupied)` são ignorados e resultam em `false`.
   *
   * @param {number} handler - Handler do bloco.
   * @param {number} index - Índice baseado em zero do elemento.
   * @param {number} value - Novo valor.
   * @returns {boolean} `true` se o valor foi gravado; `false` se o índice
   * estiver fora da região ocupada.
   * @throws {Error} Se o handler for inválido ou estiver corrompido.
   */
  set(handler, index, value) {
    const meta = this.extractMetadata(handler, this.metadata);
    if (index < 0 || index >= meta.occupied) return false;
    this.writer(meta.dataAddress + index * this.wordSize, value, IS_LITTLE_ENDIAN);
    return true;
  }
  // ============= MISCELÂNEA ===============
  /**
   * Zera a ocupação do bloco e preenche toda a sua capacidade física com
   * um mesmo valor.
   *
   * O preenchimento abrange todos os slots disponíveis, não apenas os
   * elementos atualmente ocupados. Após a operação, o bloco é considerado
   * vazio independentemente do valor utilizado no preenchimento.
   *
   * @param {number} handler - Handler do bloco.
   * @param {number} [value=0] - Valor utilizado para preencher todos os slots.
   * @returns {void}
   * @throws {Error} Se o handler for inválido ou estiver corrompido.
   */
  clear(handler, value = 0) {
    const meta = this.extractMetadata(handler, this.metadata);
    const slots = meta.byteCapacity / this.wordSize;
    const rawAddress = meta.dataAddress >>> this.wordShift;
    this.auxiliary.fill(value, rawAddress, rawAddress + slots);
    this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, 0, IS_LITTLE_ENDIAN);
  }
  /**
   * Preenche um intervalo de slots do bloco com um valor.
   *
   * O intervalo utiliza índices baseados em zero e segue a convenção
   * `[start, end)`, portanto `start` é inclusivo e `end` é exclusivo.
   * Quando `end` não é informado, o preenchimento se estende até o fim da
   * capacidade física do bloco.
   *
   * A ocupação do bloco passa a ser `end`, inclusive quando o intervalo
   * preenchido se estende além da ocupação anterior.
   *
   * @param {number} handler - Handler do bloco.
   * @param {number} value - Valor utilizado no preenchimento.
   * @param {number} [start=0] - Índice inicial, inclusivo.
   * @param {number|null} [end=null] - Índice final, exclusivo. Quando
   * omitido ou `null`, utiliza a capacidade total do bloco.
   * @returns {void}
   * @throws {Error} Se o handler for inválido ou estiver corrompido.
   * @throws {RangeError} Se `start` ou `end` estiver fora dos limites da
   * capacidade, ou se `start > end`.
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
   * Preenche todos os slots físicos do bloco com um valor e marca toda a
   * capacidade como ocupada.
   *
   * Diferentemente de `clear()`, a operação resulta em um bloco totalmente
   * ocupado.
   *
   * @param {number} handler - Handler do bloco.
   * @param {number} value - Valor utilizado no preenchimento.
   * @returns {void}
   * @throws {Error} Se o handler for inválido ou estiver corrompido.
   */
  fillAll(handler, value) {
    const meta = this.extractMetadata(handler, this.metadata);
    const rawAddress = meta.dataAddress >>> this.wordShift;
    const capacityElements = meta.byteCapacity / this.wordSize;
    this.auxiliary.fill(value, rawAddress, rawAddress + capacityElements);
    this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, capacityElements, IS_LITTLE_ENDIAN);
  }
  /**
   * Copia os elementos de uma `Array` ou `TypedArray` para o início do bloco.
   *
   * A quantidade copiada é limitada pela capacidade do bloco. A ocupação é
   * atualizada para o maior valor entre a ocupação anterior e a quantidade
   * efetivamente copiada; portanto, uma chamada a `put()` não reduz a
   * ocupação existente quando recebe uma sequência menor.
   *
   * Para `Array`, somente os primeiros elementos que couberem são copiados.
   * Para `TypedArray`, é utilizado um subarray da origem sem cópia
   * intermediária.
   *
   * @param {number} handler - Handler do bloco.
   * @param {Array|TypedArray} data - Sequência de valores a copiar.
   * @returns {void}
   * @throws {Error} Se o handler for inválido ou estiver corrompido.
   * @throws {TypeError} Se `data` não for uma `Array` nem uma `TypedArray`.
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
  * Retorna uma cópia dos elementos atualmente ocupados pelo bloco.
  *
  * O resultado é uma `TypedArray` do mesmo tipo configurado por
  * `bucketSize`. A capacidade física não ocupada não é incluída no resultado.
  *
  * A operação não expõe diretamente o armazenamento interno: o método
  * utiliza `TypedArray.prototype.slice()`, produzindo uma nova view com
  * armazenamento independente.
  *
  * @param {number} handler - Handler do bloco.
  * @returns {TypedArray} Cópia dos elementos ocupados pelo bloco. Quando
  * o bloco está vazio, retorna uma `TypedArray` vazia do tipo configurado.
  * @throws {Error} Se o handler for inválido ou estiver corrompido.
  */
  pick(handler) {
    const meta = this.extractMetadata(handler, this.metadata);
    const rawAddress = meta.dataAddress >>> this.wordShift;
    if (meta.occupied === 0) {
      return this.auxiliary.slice(rawAddress, rawAddress);
    }
    return this.auxiliary.slice(rawAddress, rawAddress + meta.occupied);
  }
  // ======== CAPACIDADE EM SLOTS ==========
  /**
   * Retorna a capacidade física do bloco em bytes.
   *
   * A capacidade corresponde ao espaço reservado para todos os slots do
   * bloco, independentemente de quantos elementos estejam atualmente
   * ocupados.
   *
   * @param {number} handler - Handler do bloco.
   * @returns {number} Capacidade física do bloco, em bytes.
   * @throws {Error} Se o handler for inválido ou estiver corrompido.
   */
  byteSize(handler) {
    const meta = this.extractMetadata(handler, this.metadata);
    return meta.byteCapacity;
  }
  /**
   * Retorna a quantidade de elementos atualmente ocupados no bloco.
   *
   * @param {number} handler - Handler do bloco.
   * @returns {number} Número de elementos ocupados.
   * @throws {Error} Se o handler for inválido ou estiver corrompido.
   */
  occupied(handler) {
    const meta = this.extractMetadata(handler, this.metadata);
    return meta.occupied;
  }
  /**
   * Retorna a capacidade do bloco em número de elementos.
   *
   * O valor corresponde à quantidade total de slots fisicamente reservados,
   * e não à quantidade atualmente ocupada.
   *
   * @param {number} handler - Handler do bloco.
   * @returns {number} Número total de slots disponíveis no bloco.
   * @throws {Error} Se o handler for inválido ou estiver corrompido.
   */
  length(handler) {
    const meta = this.extractMetadata(handler, this.metadata);
    return 1 << meta.capacityExponent >>> 0;
  }
  // ==========Operações entre blocos=============
  /**
   * Copia elementos ocupados de um bloco para outro.
   *
   * A cópia começa no primeiro elemento de `source` e no primeiro slot de
   * `destiny`. A quantidade efetivamente copiada é limitada pelo número de
   * elementos ocupados na origem, pela capacidade física do destino e pelo
   * limite especificado em `slots`.
   *
   * A ocupação do destino é elevada, quando necessário, para abranger os
   * elementos copiados. A capacidade do destino não é alterada.
   *
   * A operação utiliza `Uint8Array.prototype.copyWithin()` sobre o `dataBus`,
   * portanto o retorno é o próprio `Uint8Array` que representa o barramento
   * de dados.
   *
   * @param {number} source - Handler do bloco de origem.
   * @param {number} destiny - Handler do bloco de destino.
   * @param {number} [slots=UNKNOWN] - Número máximo de elementos a copiar.
   * `UNKNOWN` representa o valor sentinela utilizado para não impor um
   * limite adicional.
   * @returns {Uint8Array} O `dataBus` após a operação.
   * @throws {Error} Se `source` ou `destiny` for inválido ou estiver corrompido.
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
   * Copia uma região de elementos dentro do próprio bloco.
   *
   * Os índices são baseados em zero e seguem a semântica de
   * `Array.prototype.copyWithin()`: `target` identifica a posição de destino,
   * `start` a posição inicial da origem e `length` a quantidade máxima de
   * elementos a copiar.
   *
   * Índices negativos são interpretados a partir do fim da capacidade do
   * bloco. Após essa normalização, os índices são limitados à capacidade
   * física. A quantidade copiada também é limitada pelos elementos
   * efetivamente ocupados e pelo espaço disponível a partir de `target`.
   *
   * A operação suporta regiões sobrepostas e pode aumentar a ocupação do
   * bloco quando o intervalo de destino ultrapassar a ocupação atual.
   *
   * @param {number} handler - Handler do bloco.
   * @param {number} target - Índice inicial do destino.
   * @param {number} start - Índice inicial da origem.
   * @param {number} length - Número máximo de elementos a copiar.
   * @returns {Uint8Array} O `dataBus` após a operação.
   * @throws {Error} Se o handler for inválido ou estiver corrompido.
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
   * Acrescenta os elementos ocupados de `source` ao final de `target`.
   *
   * A quantidade copiada é limitada pelo número de elementos ocupados na
   * origem e pelo espaço livre restante na capacidade do destino.
   *
   * A operação suporta `target` e `source` referenciando o mesmo bloco.
   * Nesse caso, a cópia é realizada sobre a própria região do bloco e
   * preserva a semântica de sobreposição de `copyWithin()`.
   *
   * @param {number} target - Handler do bloco que receberá os elementos.
   * @param {number} source - Handler do bloco cujos elementos serão
   * acrescentados.
   * @returns {number} Número de elementos efetivamente acrescentados.
   * @throws {Error} Se `target` ou `source` for inválido ou estiver corrompido.
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
   * Cria uma cópia independente de um bloco.
   *
   * O novo bloco possui a mesma capacidade física e a mesma ocupação do
   * bloco original. Todos os bytes da região reservada, incluindo posições
   * atualmente não ocupadas, são copiados.
   *
   * O novo bloco recebe um novo handler e permanece sujeito às regras
   * normais de alocação e reciclagem.
   *
   * @param {number} handler - Handler do bloco a ser clonado.
   * @returns {number} Handler do novo bloco.
   * @throws {Error} Se o handler for inválido ou estiver corrompido.
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
   * Troca as regiões de dados associadas a dois blocos.
   *
   * A operação troca entre os headers os endereços das regiões, suas
   * capacidades e suas ocupações. Os handlers permanecem inalterados:
   * depois da operação, cada handler continua identificando seu próprio
   * header, mas esse header passa a descrever a região que anteriormente
   * pertencia ao outro bloco.
   *
   * Nenhum dado é copiado no `dataBus`; somente os metadados dos dois
   * headers são modificados.
   *
   * @param {number} source - Handler do primeiro bloco.
   * @param {number} target - Handler do segundo bloco.
   * @returns {void}
   * @throws {Error} Se `source` ou `target` for inválido ou estiver corrompido.
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
  // ============= SERIALIZAÇÃO ==============
  /**
   * Serializa o conteúdo e os metadados de um bloco de memória.
   *
   * O método extrai os dados ocupados do bloco por meio de `pick()`,
   * agrupa-os junto com informações de capacidade e tipo de palavra
   * em um envelope de dados e os codifica utilizando o formato CBOR.
   *
   * @param {number} handler - Handler do bloco a ser serializado.
   * @returns {Uint8Array} Um buffer contendo os dados serializados do bloco.
   * @throws {Error} Se o handler for inválido ou estiver corrompido.
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
   * Restaura um bloco de memória a partir de dados serializados.
   *
   * Decodifica o envelope CBOR, valida se o tipo de palavra do dado
   * serializado é compatível com a instância atual do alocador e aloca
   * um novo bloco com a capacidade necessária para acomodar o conteúdo.
   * Em seguida, os dados e a ocupação original são restaurados no novo bloco.
   *
   * @param {Uint8Array|ArrayBuffer} serialized - Buffer contendo os dados serializados.
   * @returns {number} Handler do novo bloco recriado.
   * @throws {Error} Se o tipo de palavra do dado decodificado divergir do configurado no alocador.
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
  // ============= UTILITÁRIOS ==============
  /**
   * [USO INTERNO]
   * Decodifica os metadados associados a um handler.
   *
   * O handler é dividido em geração e endereço do header. O cookie armazenado
   * no header é então recalculado para validar a combinação; somente após
   * essa validação os metadados são lidos.
   *
   * Os campos decodificados são escritos no objeto `out`, que é retornado
   * pela própria função. O objeto pode ser reutilizado entre chamadas para
   * evitar novas alocações.
   *
   * @param {number} handler - Handler a ser decodificado e validado.
   * @param {Metadata} out - Objeto que receberá os metadados decodificados.
   * @returns {Metadata} A mesma referência fornecida em `out`.
   * @throws {Error} Se o cookie do header não corresponder ao handler ou
   * se o handler não identificar um header válido.
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
   * [USO INTERNO]
   * Calcula o cookie de validação de um header.
   *
   * O cookie é derivado do endereço do header e dos 11 bits da geração por
   * meio de fast hash.
   * O resultado é reduzido para 8 bits.
   *
   * O valor zero é reservado como indicador de header inválido; por isso,
   * quando o cálculo produz zero, o método retorna `1`.
   *
   * O cookie não constitui um mecanismo criptográfico. Sua finalidade é
   * detectar handlers inválidos, stale ou corrompidos dentro do modelo de
   * gerenciamento de memória do alocador.
   *
   * @param {number} addr - Endereço do header.
   * @param {number} gen - Geração associada ao handler. Somente os 11 bits
   * menos significativos são considerados.
   * @returns {number} Cookie de 8 bits no intervalo [1, 255].
   * @private
   */
  bakeCookie(addr, gen) {
    return (addr ^ gen & 2047 * 2654435761) & 255 || 1;
  }
  /**
   * Retorna a quantidade de regiões atualmente armazenadas na lista de
   * reciclagem.
   *
   * Cada região corresponde a um bloco liberado que não pôde ser devolvido
   * diretamente ao topo do `dataBus` e, portanto, permanece disponível para
   * reutilização por uma alocação futura de capacidade idêntica.
   *
   * @returns {number} Número de regiões livres mantidas em `recycle`.
   */
  recycleCount() {
    let count = 0;
    for (const [, page] of this.recycle) {
      count += page[0];
    }
    return count;
  }
  /**
   * Retorna o total de bytes pertencentes às regiões atualmente armazenadas
   * na lista de reciclagem.
   *
   * O valor é calculado somando a capacidade de cada região livre multiplicada
   * pela quantidade de regiões registradas para aquela capacidade.
   *
   * @returns {number} Número de bytes ocupados por regiões recicláveis.
   */
  get recycleBytes() {
    let total = 0;
    for (const [capacity, page] of this.recycle) {
      total += page[0] * capacity;
    }
    return total;
  }
  /**
   * Retorna a quantidade de bytes alocados que não pertencem às regiões
   * atualmente recicláveis.
   *
   * O valor é obtido subtraindo do avanço total do `dataPointer` os bytes
   * pertencentes às regiões livres mantidas em `recycle`.
   *
   * @returns {number} Número de bytes associados às regiões não recicláveis
   * dentro da área já utilizada pelo `dataBus`.
   */
  get allocatedBytes() {
    return this.dataPointer - this.recycleBytes;
  }
  /**
   * Retorna a quantidade de bytes ainda não utilizada no topo do `dataBus`.
   *
   * Esse espaço corresponde à região entre `dataPointer` e o final da
   * capacidade atualmente reservada para o buffer.
   *
   * @returns {number} Número de bytes disponíveis após `dataPointer`.
   */
  get unallocatedBytes() {
    return this.size - this.dataPointer;
  }
  /**
   * Retorna a razão entre a memória reciclável e a área de heap utilizada.
   *
   * A métrica considera como fragmentação as regiões livres mantidas em
   * `recycle` e utiliza `dataPointer` como denominador. Quando nenhum byte
   * foi utilizado pelo heap, o resultado é zero.
   *
   * O valor não representa a fração de toda a capacidade do `dataBus`, mas
   * especificamente a proporção de bytes recicláveis dentro da área já
   * percorrida pelo bump pointer.
   *
   * @returns {number} Razão de fragmentação no intervalo [0, 1] em condições
   * normais de operação.
   */
  get fragmentationRatio() {
    if (this.dataPointer === 0) return 0;
    return this.recycleBytes / this.dataPointer;
  }
};
module.exports = { Balloc };
