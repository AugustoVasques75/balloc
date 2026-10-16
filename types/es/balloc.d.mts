export type BucketType = '8u' | '16u' | '32u' | '64u' | '8i' | '16i' | '32i' | '64i' | '16f' | '32f' | '64f';
export type Metadata = {
    /**
     * - Capacidad del bloque de memoria en bytes.
     */
    byteCapacity: number;
    /**
     * - Capacidad del bloque de memoria expresada como exponente de base dos.
     */
    capacityExponent: number;
    /**
     * - Dirección del bloque de memoria dentro del dataBus.
     */
    dataAddress: number;
    /**
     * - Generación a la que pertenece el identificador.
     */
    generation: number;
    /**
     * - Dirección de la cabecera dentro del controlBus.
     */
    headerAddress: number;
    /**
     * - Número de elementos ocupados en el bloque.
     */
    occupied: number;
};
/**
 * Asignador de tipo Bump de doble bus con pila Echo y GC ReBump.
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
     * Crea una instancia del asignador de memoria `Balloc`.
     *
     * El asignador mantiene dos bústeres independientes:
     * - `dataBus`: almacena los datos de los bloques asignados;
     * - `controlBus`: almacena las cabeceras y otros metadatos de control.
     *
     * Cada bloque posee una cabecera de tamaño fijo (`HEADER_SIZE`) y se
     * identifica externamente mediante un identificador lógico de 43 bits, compuesto
     * por una generación de 11 bits y la dirección de su cabecera en 32 bits.
     *
     * La capacidad de cada bloque se redondea hacia arriba a la siguiente potencia de
     * dos en elementos, respetando el ancho del bucket configurado.
     *
     * @param {number} [size=65535] - Capacidad inicial del `dataBus`, en bytes.
     * Debe ser un entero seguro en el rango [2, 0x80000000].
     * @param {BucketType} [bucketSize="32u"] - Identificador del tipo y tamaño del bucket
     * (ej.: '32u' para Uint32, '64f' para Float64, '8i' para Int8).
     * @param {number} [metadataSize=1024] - Capacidad inicial del `controlBus`,
     * en bytes. Debe ser un entero seguro en el rango
     * [HEADER_SIZE, 0x80000000].
     *
     * @throws {RangeError} Si `size` se encuentra fuera del rango permitido.
     * @throws {RangeError} Si `bucketSize` no es un identificador de bucket válido.
     * @throws {RangeError} Si `metadataSize` se encuentra fuera del rango permitido.
     */
    constructor(size?: number, bucketSize?: BucketType, metadataSize?: number);
    /**
     * Asigna un nuevo bloque de memoria.
     *
     * La capacidad solicitada se convierte a la potencia de dos más pequeña que
     * admita `size` elementos. El bloque se obtiene preferentemente de la lista
     * de regiones reciclables con la capacidad correspondiente; si no existe
     * una región compatible, el bloque se reserva en la parte superior del `dataBus`.
     *
     * A continuación, se obtiene una cabecera del espacio de control. Las cabeceras
     * liberadas previamente pueden reutilizarse mediante la pila interna de reciclaje;
     * de lo contrario, el `controlBus` se expande cuando es necesario.
     *
     * La cabecera recibe la dirección, la capacidad, la ocupación inicial (cero) y
     * un cookie de validación. El valor devuelto codifica la generación de la asignación
     * y la dirección de la cabecera:
     *
     *     [11 bits de generación][32 bits de dirección de cabecera]
     *
     * @param {number} [size=16] - Número mínimo de elementos que el bloque debe
     * alojar. Debe ser un entero seguro en el rango [2, 0x80000000].
     * @returns {number} Identificador que identifica el bloque asignado.
     * @throws {RangeError} Si `size` se encuentra fuera del rango permitido.
     */
    alloc(size?: number): number;
    /**
     * Expande la capacidad de un bloque a la siguiente potencia de dos.
     *
     * Cuando el bloque se encuentra en la parte superior actual del `dataBus`, la expansión
     * se realiza in situ: solo se actualizan su capacidad y el `dataPointer`.
     *
     * En caso de existir otra región después del bloque, se obtiene una nueva región con el doble
     * de capacidad del espacio reciclable o se asigna en la parte superior del `dataBus`.
     * Los elementos ocupados actualmente se copian a la nueva región,
     * y la región anterior se devuelve a la lista de reciclaje.
     *
     * El identificador permanece válido, ya que su cabecera se conserva y solo se
     * actualizan la dirección y la capacidad registradas en él.
     *
     * @param {number} handler - Identificador del bloque a expandir.
     * @returns {void}
     * @throws {Error} Si el identificador es inválido o está corrupto.
     * @throws {AggregateError} Si la capacidad ha alcanzado su límite
     * máximo soportado.
     */
    realloc(handler: number): void;
    /**
     * Libera un bloque de memoria.
     *
     * La cabecera del bloque se invalida poniendo su cookie a cero y su
     * dirección se registra para su reutilización posterior. La región de datos
     * también se devuelve al sistema de reciclaje, excepto cuando el bloque está
     * exactamente en la parte superior del `dataBus`; en ese caso, el `dataPointer` simplemente
     * retrocede, eliminando la región sin crear una entrada en la lista de
     * reciclaje.
     *
     * @param {number} handler - Identificador del bloque a liberar.
     * @returns {void}
     * @throws {Error} Si el identificador es inválido o está corrupto.
     */
    free(handler: number): void;
    /**
     * [USO INTERNO]
     * Inserta una región libre en la lista de reciclaje.
     *
     * La lista se organiza por capacidad en bytes. Para cada capacidad, el
     * valor almacenado es un `Uint32Array` cuya posición cero contiene la cantidad
     * de direcciones registradas y las posiciones siguientes contienen las direcciones
     * de las regiones libres:
     *
     *     [count, address1, address2, ...]
     *
     * Cuando la página se llena, su búster se expande al doble de la
     * capacidad actual.
     *
     * @param {number} capacity - Capacidad de la región libre, en bytes.
     * @param {number} address - Dirección inicial de la región en el `dataBus`.
     * @returns {void}
     * @private
     */
    private recyclePush;
    /**
     * [USO INTERNO]
     * Elimina una región libre de la lista de reciclaje.
     *
     * La búsqueda se realiza por la capacidad exacta solicitada. Cuando existe una
     * página correspondiente, la última dirección registrada se elimina de la
     * página y se devuelve, implementando el reciclaje como una pila LIFO.
     *
     * @param {number} capacity - Capacidad deseada, en bytes.
     * @returns {number} Dirección inicial de una región reciclable o `UNKNOWN`
     * cuando no existe una región con la capacidad solicitada.
     * @private
     */
    private recyclePop;
    /**
     * Compacta el `dataBus` mediante el algoritmo ReBump.
     *
     * Recorre secuencialmente las cabeceras registradas en el `controlBus` y copia
     * las regiones que aún son válidas a un nuevo `dataBus`, eliminando los espacios
     * libres existentes entre ellas. La dirección de cada bloque superviviente se
     * actualiza en su respectiva cabecera.
     *
     * Se preserva el orden de los bloques en el `controlBus`. Los datos internos de
     * cada bloque también se conservan íntegramente, incluyendo su capacidad
     * reservada y su ocupación actual.
     *
     * Al finalizar la compactación:
     * - se eliminan todas las regiones reciclables;
     * - `dataPointer` apunta al primer byte después del último bloque
     *   activo;
     * - el `dataBus` pasa a representar un montón contiguo para los bloques activos.
     *
     * La complejidad de control es O(n), donde `n` es el número de cabeceras
     * recorridas. El coste efectivo del movimiento de memoria también depende
     * del volumen de bytes pertenecientes a los bloques activos.
     *
     * @returns {void}
     */
    gc(): void;
    /**
     * [!!! USO INTERNO, NO USAR EN TU CÓDIGO !!!]
     * Expande el `dataBus` al doble de su capacidad actual.
     *
     * El búster subyacente se transfiere a un `ArrayBuffer` mayor, preservando
     * los datos existentes. Todas las vistas asociadas al búster se recrean
     * para hacer referencia al nuevo almacenamiento.
     *
     * @returns {void}
     * @throws {RangeError} Si la capacidad del `dataBus` ha excedido el
     * límite máximo soportado.
     * @private
     */
    private grow;
    /**
     * [!!! USO INTERNO, NO USAR EN TU CÓDIGO !!!]
     * Expande el `controlBus` al doble de su capacidad actual.
     *
     * El búster subyacente se transfiere a un `ArrayBuffer` mayor, preservando
     * las cabeceras existentes. El `controlAdapter` se recrea para hacer referencia
     * al nuevo almacenamiento.
     *
     * @returns {void}
     * @throws {RangeError} Si la capacidad actual del `controlBus` ha
     * excedido el límite máximo soportado.
     * @private
     */
    private headerGrow;
    /**
     * Añade un elemento al final de la secuencia ocupada por el bloque.
     *
     * El elemento se graba en la primera posición libre tras el último elemento
     * ocupado. La ocupación del bloque se incrementa solo cuando existe espacio
     * disponible en su capacidad.
     *
     * @param {number} handler - Identificador del bloque.
     * @param {number} value - Valor a insertar.
     * @returns {boolean} `true` si el valor fue insertado; `false` si el bloque
     * ya no dispone de espacio libre.
     * @throws {Error} Si el identificador es inválido o está corrupto.
     */
    push(handler: number, value: number): boolean;
    /**
     * Elimina el último elemento ocupado del bloque y lo devuelve.
     *
     * La ocupación se decrementa antes de leer el elemento eliminado. Los
     * bytes correspondientes no se limpian y permanecen en la región asignada,
     * pero dejan de formar parte de la secuencia ocupada.
     *
     * @param {number} handler - Identificador del bloque.
     * @returns {number|undefined} Valor eliminado o `undefined` si el bloque
     * está vacío.
     * @throws {Error} Si el identificador es inválido o está corrupto.
     */
    pop(handler: number): number | undefined;
    /**
     * Devuelve el último elemento ocupado sin eliminarlo.
     *
     * @param {number} handler - Identificador del bloque.
     * @returns {number|undefined} Último valor ocupado o `undefined` si el
     * bloque está vacío.
     * @throws {Error} Si el identificador es inválido o está corrupto.
     */
    peek(handler: number): number | undefined;
    /**
     * Inserta un elemento al inicio de la secuencia ocupada.
     *
     * Los elementos ocupados actualmente se desplazan una posición hacia
     * adelante y `value` se graba en la primera posición. La operación exige una
     * posición libre en la capacidad del bloque.
     *
     * El coste de la operación es proporcional al número de elementos ocupados,
     * ya que los datos deben desplazarse.
     *
     * @param {number} handler - Identificador del bloque.
     * @param {number} value - Valor a insertar.
     * @returns {boolean} `true` si el valor fue insertado; `false` si el bloque
     * está lleno.
     * @throws {Error} Si el identificador es inválido o está corrupto.
     */
    nudge(handler: number, value: number): boolean;
    /**
     * Elimina el primer elemento ocupado del bloque y lo devuelve.
     *
     * Los elementos restantes se desplazan una posición hacia el inicio
     * de la región ocupada. La capacidad física del bloque permanece inalterada.
     *
     * El coste de la operación es proporcional al número de elementos desplazados.
     *
     * @param {number} handler - Identificador del bloque.
     * @returns {number|undefined} Primer valor eliminado o `undefined` si el
     * bloque está vacío.
     * @throws {Error} Si el identificador es inválido o está corrupto.
     */
    pull(handler: number): number | undefined;
    /**
     * Devuelve el primer elemento ocupado sin eliminarlo.
     *
     * @param {number} handler - Identificador del bloque.
     * @returns {number|undefined} Primer valor ocupado o `undefined` si el
     * bloque está vacío.
     * @throws {Error} Si el identificador es inválido o está corrupto.
     */
    head(handler: number): number | undefined;
    /**
     * Comprueba si un valor está presente entre los elementos ocupados del bloque.
     *
     * La búsqueda se realiza directamente sobre el `TypedArray` auxiliar y considera
     * únicamente el intervalo ocupado actualmente, no toda la capacidad física
     * reservada.
     *
     * @param {number} handler - Identificador del bloque.
     * @param {number} value - Valor a buscar.
     * @returns {boolean} `true` si `value` está presente entre los elementos
     * ocupados; de lo contrario, `false`.
     * @throws {Error} Si el identificador es inválido o está corrupto.
     */
    has(handler: number, value: number): boolean;
    /**
    * Devuelve el elemento ocupado en un índice basado en cero.
    *
    * Los índices fuera del rango `[0, occupied)` no se consideran un error y
    * dan como resultado `undefined`.
    *
    * @param {number} handler - Identificador del bloque.
    * @param {number} index - Índice basado en cero del elemento.
    * @returns {number|undefined} Valor almacenado en el índice o `undefined` si
    * el índice está fuera de la región ocupada.
    * @throws {Error} Si el identificador es inválido o está corrupto.
    */
    get(handler: number, index: number): number | undefined;
    /**
     * Sustituye el valor almacenado en un índice ocupado.
     *
     * La operación no altera la ocupación del bloque. Los índices fuera del rango
     * `[0, occupied)` se ignoran y dan como resultado `false`.
     *
     * @param {number} handler - Identificador del bloque.
     * @param {number} index - Índice basado en cero del elemento.
     * @param {number} value - Nuevo valor.
     * @returns {boolean} `true` si el valor fue grabado; `false` si el índice
     * está fuera de la región ocupada.
     * @throws {Error} Si el identificador es inválido o está corrupto.
     */
    set(handler: number, index: number, value: number): boolean;
    /**
     * Pone a cero la ocupación del bloque y llena toda su capacidad física con
     * un mismo valor.
     *
     * El relleno abarca todas las ranuras disponibles, no solo los
     * elementos ocupados actualmente. Tras la operación, el bloque se considera
     * vacío independientemente del valor utilizado en el relleno.
     *
     * @param {number} handler - Identificador del bloque.
     * @param {number} [value=0] - Valor utilizado para rellenar todas las ranuras.
     * @returns {void}
     * @throws {Error} Si el identificador es inválido o está corrupto.
     */
    clear(handler: number, value?: number): void;
    /**
     * Rellena un intervalo de ranuras del bloque con un valor.
     *
     * El intervalo utiliza índices basados en cero y sigue la convención
     * `[start, end)`, por lo que `start` es inclusivo y `end` es exclusivo.
     * Cuando no se proporciona `end`, el relleno se extiende hasta el final de la
     * capacidad física del bloque.
     *
     * La ocupación del bloque pasa a ser `end`, incluso cuando el intervalo
     * rellenado se extiende más allá de la ocupación anterior.
     *
     * @param {number} handler - Identificador del bloque.
     * @param {number} value - Valor utilizado en el relleno.
     * @param {number} [start=0] - Índice inicial, inclusivo.
     * @param {number|null} [end=null] - Índice final, exclusivo. Cuando se
     * omite o es `null`, utiliza la capacidad total del bloque.
     * @returns {void}
     * @throws {Error} Si el identificador es inválido o está corrupto.
     * @throws {RangeError} Si `start` o `end` están fuera de los límites de
     * capacidad, o si `start > end`.
     */
    fill(handler: number, value: number, start?: number, end?: number | null): void;
    /**
     * Rellena todas las ranuras físicas del bloque con un valor y marca toda la
     * capacidad como ocupada.
     *
     * A diferencia de `clear()`, la operación da como resultado un bloque totalmente
     * ocupado.
     *
     * @param {number} handler - Identificador del bloque.
     * @param {number} value - Valor utilizado en el relleno.
     * @returns {void}
     * @throws {Error} Si el identificador es inválido o está corrupto.
     */
    fillAll(handler: number, value: number): void;
    /**
     * Copia los elementos de un `Array` o `TypedArray` al inicio del bloque.
     *
     * La cantidad copiada está limitada por la capacidad del bloque. La ocupación se
     * actualiza al mayor valor entre la ocupación anterior y la cantidad
     * copiada efectivamente; por lo tanto, una llamada a `put()` no reduce la
     * ocupación existente cuando recibe una secuencia menor.
     *
     * Para `Array`, solo se copian los primeros elementos que quepan.
     * Para `TypedArray`, se utiliza un subarreglo del origen sin copia
     * intermedia.
     *
     * @param {number} handler - Identificador del bloque.
     * @param {Array|TypedArray} data - Secuencia de valores a copiar.
     * @returns {void}
     * @throws {Error} Si el identificador es inválido o está corrupto.
     * @throws {TypeError} Si `data` no es ni un `Array` ni un `TypedArray`.
     */
    put(handler: number, data: any[] | TypedArray): void;
    /**
    * Devuelve una copia de los elementos ocupados actualmente por el bloque.
    *
    * El resultado es un `TypedArray` del mismo tipo configurado por
    * `bucketSize`. La capacidad física no ocupada no se incluye en el resultado.
    *
    * La operación no expone directamente el almacenamiento interno: el método
    * utiliza `TypedArray.prototype.slice()`, produciendo una nueva vista con
    * almacenamiento independiente.
    *
    * @param {number} handler - Identificador del bloque.
    * @returns {TypedArray} Copia de los elementos ocupados por el bloque. Cuando
    * el bloque está vacío, devuelve un `TypedArray` vacío del tipo configurado.
    * @throws {Error} Si el identificador es inválido o está corrupto.
    */
    pick(handler: number): TypedArray;
    /**
     * Devuelve la capacidad física del bloque en bytes.
     *
     * La capacidad corresponde al espacio reservado para todas las ranuras del
     * bloque, independientemente de cuántos elementos estén ocupados actualmente.
     *
     * @param {number} handler - Identificador del bloque.
     * @returns {number} Capacidad física del bloque, en bytes.
     * @throws {Error} Si el identificador es inválido o está corrupto.
     */
    byteSize(handler: number): number;
    /**
     * Devuelve la cantidad de elementos ocupados actualmente en el bloque.
     *
     * @param {number} handler - Identificador del bloque.
     * @returns {number} Número de elementos ocupados.
     * @throws {Error} Si el identificador es inválido o está corrupto.
     */
    occupied(handler: number): number;
    /**
     * Devuelve la capacidad del bloque en número de elementos.
     *
     * El valor corresponde a la cantidad total de ranuras reservadas físicamente,
     * y no a la cantidad ocupada actualmente.
     *
     * @param {number} handler - Identificador del bloque.
     * @returns {number} Número total de ranuras disponibles en el bloque.
     * @throws {Error} Si el identificador es inválido o está corrupto.
     */
    length(handler: number): number;
    /**
     * Copia elementos ocupados de un bloque a otro.
     *
     * La copia comienza en el primer elemento de `source` y la primera ranura de
     * `destiny`. La cantidad copiada de forma efectiva está limitada por el número de
     * elementos ocupados en el origen, la capacidad física del destino y el límite
     * especificado en `slots`.
     *
     * La ocupación del destino se incrementa, cuando es necesario, para abarcar los
     * elementos copiados. La capacidad del destino no se altera.
     *
     * La operación utiliza `Uint8Array.prototype.copyWithin()` sobre el `dataBus`,
     * por lo tanto el valor devuelto es el propio `Uint8Array` que representa el bus de datos.
     *
     * @param {number} source - Identificador del bloque de origen.
     * @param {number} destiny - Identificador del bloque de destino.
     * @param {number} [slots=UNKNOWN] - Número máximo de elementos a copiar.
     * `UNKNOWN` representa el valor centinela utilizado para no imponer un
     * límite adicional.
     * @returns {Uint8Array} El `dataBus` después de la operación.
     * @throws {Error} Si `source` o `destiny` son inválidos o están corruptos.
     */
    copy(source: number, destiny: number, slots?: number): Uint8Array;
    /**
     * Copia una región de elementos dentro del propio bloque.
     *
     * Los índices están basados en cero y siguen la semántica de
     * `Array.prototype.copyWithin()`: `target` identifica la posición de destino,
     * `start` la posición inicial del origen y `length` la cantidad máxima de
     * elementos a copiar.
     *
     * Los índices negativos se interpretan a partir del final de la capacidad del
     * bloque. Tras dicha normalización, los índices se limitan a la capacidad
     * física. La cantidad copiada también se ve limitada por los elementos
     * ocupados efectivamente y el espacio disponible a partir de `target`.
     *
     * La operación admite regiones superpuestas y puede incrementar la ocupación del
     * bloque cuando el intervalo de destino supera la ocupación actual.
     *
     * @param {number} handler - Identificador del bloque.
     * @param {number} target - Índice inicial del destino.
     * @param {number} start - Índice inicial del origen.
     * @param {number} length - Número máximo de elementos a copiar.
     * @returns {Uint8Array} El `dataBus` después de la operación.
     * @throws {Error} Si el identificador es inválido o está corrupto.
     */
    copyWithin(handler: number, target: number, start: number, length: number): Uint8Array;
    /**
     * Añade los elementos ocupados de `source` al final de `target`.
     *
     * La cantidad copiada está limitada por el número de elementos ocupados en el
     * origen y el espacio libre restante en la capacidad del destino.
     *
     * La operación admite que `target` y `source` hagan referencia al mismo bloque.
     * En ese caso, la copia se realiza sobre la propia región del bloque y
     * preserva la semántica de superposición de `copyWithin()`.
     *
     * @param {number} target - Identificador del bloque que recibirá los elementos.
     * @param {number} source - Identificador del bloque cuyos elementos serán
     * añadidos.
     * @returns {number} Número de elementos añadidos efectivamente.
     * @throws {Error} Si `target` o `source` son inválidos o están corruptos.
     */
    append(target: number, source: number): number;
    /**
     * Crea una copia independiente de un bloque.
     *
     * El nuevo bloque posee la misma capacidad física y la misma ocupación del
     * bloque original. Se copian todos los bytes de la región reservada, incluyendo
     * las posiciones no ocupadas actualmente.
     *
     * El nuevo bloque recibe un nuevo identificador y permanece sujeto a las reglas
     * normales de asignación y reciclaje.
     *
     * @param {number} handler - Identificador del bloque a clonar.
     * @returns {number} Identificador del nuevo bloque.
     * @throws {Error} Si el identificador es inválido o está corrupto.
     */
    clone(handler: number): number;
    /**
     * Intercambia las regiones de datos asociadas a dos bloques.
     *
     * La operación intercambia entre las cabeceras las direcciones de las regiones, sus
     * capacidades y sus ocupaciones. Los identificadores permanecen inalterados:
     * después de la operación, cada identificador continúa identificando su propia
     * cabecera, pero dicha cabecera pasa a describir la región que pertenecía
     * anteriormente al otro bloque.
     *
     * No se copia ningún dato en el `dataBus`; solo se modifican los metadatos de ambas
     * cabeceras.
     *
     * @param {number} source - Identificador del primer bloque.
     * @param {number} target - Identificador del segundo bloque.
     * @returns {void}
     * @throws {Error} Si `source` o `target` son inválidos o están corruptos.
     */
    swap(source: number, target: number): void;
    /**
     * Serializa el contenido y los metadatos de un bloque de memoria.
     *
     * El método extrae los datos ocupados del bloque mediante `pick()`,
     * los agrupa junto con la información de capacidad y tipo de palabra
     * en un sobre de datos y los codifica utilizando el formato CBOR.
     *
     * @param {number} handler - Identificador del bloque a serializar.
     * @returns {Uint8Array} Un búster que contiene los datos serializados del bloque.
     * @throws {Error} Si el identificador es inválido o está corrupto.
     */
    dump(handler: number): Uint8Array;
    /**
     * Restaura un bloque de memoria a partir de datos serializados.
     *
     * Decodifica el sobre CBOR, valida si el tipo de palabra del dato
     * serializado es compatible con la instancia actual del asignador y asigna
     * un nuevo bloque con la capacidad necesaria para alojar el contenido.
     * A continuación, se restauran los datos y la ocupación original en el nuevo bloque.
     *
     * @param {Uint8Array|ArrayBuffer} serialized - Búster que contiene los datos serializados.
     * @returns {number} Identificador del nuevo bloque recreado.
     * @throws {Error} Si el tipo de palabra del dato decodificado difiere del configurado en el asignador.
     */
    load(serialized: Uint8Array | ArrayBuffer): number;
    /**
     * [USO INTERNO]
     * Decodifica los metadatos asociados a un identificador.
     *
     * El identificador se divide en generación y dirección de la cabecera. El cookie almacenado
     * en la cabecera se recalcula para validar la combinación; solo tras
     * dicha validación se leen los metadatos.
     *
     * Los campos decodificados se escriben en el objeto `out`, el cual es devuelto
     * por la propia función. El objeto se puede reutilizar entre llamadas para
     * evitar nuevas asignaciones.
     *
     * @param {number} handler - Identificador a decodificar y validar.
     * @param {Metadata} out - Objeto que recibirá los metadatos decodificados.
     * @returns {Metadata} La misma referencia proporcionada en `out`.
     * @throws {Error} Si el cookie de la cabecera no coincide con el identificador o
     * si el identificador no identifica una cabecera válida.
     * @private
     */
    private extractMetadata;
    /**
     * [USO INTERNO]
     * Calcula el cookie de validación de una cabecera.
     *
     * El cookie se deriva de la dirección de la cabecera y de los 11 bits de la generación mediante
     * un hash rápido.
     * El resultado se reduce a 8 bits.
     *
     * El valor cero se reserva como indicador de cabecera inválida; por este motivo,
     * cuando el cálculo produce cero, el método devuelve `1`.
     *
     * El cookie no constituye un mecanismo criptográfico. Su finalidad es
     * detectar identificadores inválidos, obsoletos o corruptos dentro del modelo de
     * gestión de memoria del asignador.
     *
     * @param {number} addr - Dirección de la cabecera.
     * @param {number} gen - Generación asociada al identificador. Solo se consideran los 11 bits
     * menos significativos.
     * @returns {number} Cookie de 8 bits en el rango [1, 255].
     * @private
     */
    private bakeCookie;
    /**
     * Devuelve la cantidad de regiones almacenadas actualmente en la lista de
     * reciclaje.
     *
     * Cada región corresponde a un bloque liberado que no pudo devolverse
     * directamente a la parte superior del `dataBus` y, por tanto, permanece disponible para
     * su reutilización en una asignación futura de capacidad idéntica.
     *
     * @returns {number} Número de regiones libres mantenidas en `recycle`.
     */
    recycleCount(): number;
    /**
     * Devuelve el total de bytes pertenecientes a las regiones almacenadas
     * actualmente en la lista de reciclaje.
     *
     * El valor se calcula sumando la capacidad de cada región libre multiplicada
     * por la cantidad de regiones registradas para dicha capacidad.
     *
     * @returns {number} Número de bytes ocupados por regiones reciclables.
     */
    get recycleBytes(): number;
    /**
     * Devuelve la cantidad de bytes asignados que no pertenecen a las regiones
     * reciclables actualmente.
     *
     * El valor se obtiene restando del avance total del `dataPointer` los bytes
     * pertenecientes a las regiones libres mantenidas en `recycle`.
     *
     * @returns {number} Número de bytes asociados a regiones no reciclables
     * dentro del área ya utilizada por el `dataBus`.
     */
    get allocatedBytes(): number;
    /**
     * Devuelve la cantidad de bytes que aún no se han utilizado en la parte superior del `dataBus`.
     *
     * Este espacio corresponde a la región comprendida entre `dataPointer` y el final de la
     * capacidad reservada actualmente para el búster.
     *
     * @returns {number} Número de bytes disponibles después de `dataPointer`.
     */
    get unallocatedBytes(): number;
    /**
     * Devuelve la razón entre la memoria reciclable y el área de montón utilizada.
     *
     * La métrica considera como fragmentación las regiones libres mantenidas en
     * `recycle` y utiliza `dataPointer` como denominador. Cuando no se ha utilizado
     * ningún byte por el montón, el resultado es cero.
     *
     * El valor no representa la fracción de toda la capacidad del `dataBus`, sino
     * específicamente la proporción de bytes reciclables dentro del área ya
     * recorrida por el puntero de tipo bump.
     *
     * @returns {number} Razón de fragmentación en el rango [0, 1] bajo condiciones
     * normales de operación.
     */
    get fragmentationRatio(): number;
}
