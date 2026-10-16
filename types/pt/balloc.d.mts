export type BucketType = '8u' | '16u' | '32u' | '64u' | '8i' | '16i' | '32i' | '64i' | '16f' | '32f' | '64f';
export type Metadata = {
    /**
     * - A capacidade em bytes do bloco de memória.
     */
    byteCapacity: number;
    /**
     * - A capacidade do bloco de memória expresso como exponte de base dois.
     */
    capacityExponent: number;
    /**
     * - Endereço do bloco de memória dentro do dataBus.
     */
    dataAddress: number;
    /**
     * - Geração cujo o handler pertence.
     */
    generation: number;
    /**
     * - Endereço do header dentro do controlBus.
     */
    headerAddress: number;
    /**
     * - Número de elementos ocupados no bloco.
     */
    occupied: number;
};
/**
 * Echo Stack Dual Bus Bump Allocator with ReBump GC.
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
    constructor(size?: number, bucketSize?: BucketType, metadataSize?: number);
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
    alloc(size?: number): number;
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
    realloc(handler: number): void;
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
    free(handler: number): void;
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
    private recyclePush;
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
    private recyclePop;
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
    gc(): void;
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
    private grow;
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
    private headerGrow;
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
    push(handler: number, value: number): boolean;
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
    pop(handler: number): number | undefined;
    /**
     * Retorna o último elemento ocupado sem removê-lo.
     *
     * @param {number} handler - Handler do bloco.
     * @returns {number|undefined} Último valor ocupado ou `undefined` se o
     * bloco estiver vazio.
     * @throws {Error} Se o handler for inválido ou estiver corrompido.
     */
    peek(handler: number): number | undefined;
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
    nudge(handler: number, value: number): boolean;
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
    pull(handler: number): number | undefined;
    /**
     * Retorna o primeiro elemento ocupado sem removê-lo.
     *
     * @param {number} handler - Handler do bloco.
     * @returns {number|undefined} Primeiro valor ocupado ou `undefined` se o
     * bloco estiver vazio.
     * @throws {Error} Se o handler for inválido ou estiver corrompido.
     */
    head(handler: number): number | undefined;
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
    has(handler: number, value: number): boolean;
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
    get(handler: number, index: number): number | undefined;
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
    set(handler: number, index: number, value: number): boolean;
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
    clear(handler: number, value?: number): void;
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
    fill(handler: number, value: number, start?: number, end?: number | null): void;
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
    fillAll(handler: number, value: number): void;
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
    put(handler: number, data: any[] | TypedArray): void;
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
    pick(handler: number): TypedArray;
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
    byteSize(handler: number): number;
    /**
     * Retorna a quantidade de elementos atualmente ocupados no bloco.
     *
     * @param {number} handler - Handler do bloco.
     * @returns {number} Número de elementos ocupados.
     * @throws {Error} Se o handler for inválido ou estiver corrompido.
     */
    occupied(handler: number): number;
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
    length(handler: number): number;
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
    copy(source: number, destiny: number, slots?: number): Uint8Array;
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
    copyWithin(handler: number, target: number, start: number, length: number): Uint8Array;
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
    append(target: number, source: number): number;
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
    clone(handler: number): number;
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
    swap(source: number, target: number): void;
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
    dump(handler: number): Uint8Array;
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
    load(serialized: Uint8Array | ArrayBuffer): number;
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
    private extractMetadata;
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
    private bakeCookie;
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
    recycleCount(): number;
    /**
     * Retorna o total de bytes pertencentes às regiões atualmente armazenadas
     * na lista de reciclagem.
     *
     * O valor é calculado somando a capacidade de cada região livre multiplicada
     * pela quantidade de regiões registradas para aquela capacidade.
     *
     * @returns {number} Número de bytes ocupados por regiões recicláveis.
     */
    get recycleBytes(): number;
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
    get allocatedBytes(): number;
    /**
     * Retorna a quantidade de bytes ainda não utilizada no topo do `dataBus`.
     *
     * Esse espaço corresponde à região entre `dataPointer` e o final da
     * capacidade atualmente reservada para o buffer.
     *
     * @returns {number} Número de bytes disponíveis após `dataPointer`.
     */
    get unallocatedBytes(): number;
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
    get fragmentationRatio(): number;
}
