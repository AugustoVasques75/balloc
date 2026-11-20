import { encode, decode } from 'cbor-x';

/**
 * Indicador de valor inválido o desconocido.
 */
const UNKNOWN = 0xFFFFFFFF >>> 0;

/**
 * Tamaños y tipos de búfer (bucket) válidos. 
 * Solo se admiten tamaños de 8, 16, 32 y 64 bits para tipos enteros, y 
 * solo tamaños de 16, 32 y 64 bits para flotantes.
 * Tipos de datos admitidos:
 * u = entero sin signo (unsigned integer)
 * i = entero con signo (signed integer)
 * f = flotante (float)
 * 
 * Sintaxis del identificador de bucket:
 * 
 * [Tamaño en bits][tipo de dato]
 * 
 * Ejemplos:
 * Un bucket entero sin signo de 32 bits: 32u
 * Un bucket entero con signo de 64 bits: 64i
 * 
 */
const BUCKET_MAPPING = Object.freeze({
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

/**
 * Tipos de bucket admitidos por el asignador:
 * - Enteros sin signo: '8u', '16u', '32u', '64u'
 * - Enteros con signo: '8i', '16i', '32i', '64i'
 * - Coma flotante: '16f', '32f', '64f'
 *
 * @typedef {'8u'|'16u'|'32u'|'64u'|'8i'|'16i'|'32i'|'64i'|'16f'|'32f'|'64f'} BucketType
 */

/**
 * Indicador de orden de bytes (endianness) del sistema.
 *
 * Detecta si el sistema es Little Endian, lo que afecta
 * el orden de los bytes en las operaciones de DataView.
 */
const IS_LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;


/**
 * Formato de los metadatos.
 *
 * [32bits address][32bits occupied][8bits capacity][8bits cookie][8bits flags][40bits reserved]
 *
 *
 * Total: 16 bytes
 */
const HEADER_SIZE = 16 >>> 0;
const ADDRESS_OFFSET = 0 >>> 0;
const OCCUPIED_OFFSET = 4 >>> 0;
const CAPACITY_OFFSET = 8 >>> 0;
const COOKIE_OFFSET = 9 >>> 0;
const FLAGS_OFFSET = 10 >>> 0;

/**
 * Indicadores (Flags):
 * bit 0: VIEW_LOCK
 */
const VIEW_LOCK = 1 >>> 0;


const ROTATE_32BITS = 4294967296;
const CLAMP_11BITS = 0x7FF >>> 0;

/**
 * Estructura que contiene los metadatos codificados en un descriptor (handle).
 * 
 * @typedef {Object} Metadata
 * @property {number} byteCapacity - Capacidad en bytes del bloque de memoria.
 * @property {number} capacityExponent - Capacidad del bloque de memoria expresada como exponente de base dos.
 * @property {number} dataAddress - Dirección del bloque de memoria dentro del bus de datos (`dataBus`).
 * @property {number} generation - Generación a la que pertenece el descriptor.
 * @property {number} headerAddress - Dirección de la cabecera (header) dentro del bus de control (`controlBus`).
 * @property {number} occupied - Número de elementos ocupados en el bloque.
 * @property {number} borrowed - Indicador de si el bloque ha sido prestado por withView().
 */

/**
 * Comprueba si un valor es una instancia de TypedArray.
 * 
 * @param {any} val - Valor a comprobar.
 * @returns {boolean} `true` si el valor es un TypedArray; de lo contrario, `false`.
 */
const isTypedArray = (val) => ArrayBuffer.isView(val) && !(val instanceof DataView);

/**
 * Asignador tipo Bump de doble bus con pila de eco y recolección de basura ReBump.
 */
export default class Balloc {

    /**
     * Crea una instancia del asignador de memoria `Balloc`.
     *
     * El asignador mantiene dos búferes independientes:
     * - `dataBus`: almacena los datos de los bloques asignados;
     * - `controlBus`: almacena las cabeceras y demás metadatos de control.
     *
     * Cada bloque posee una cabecera de tamaño fijo (`HEADER_SIZE`) y se
     * identifica externamente mediante un descriptor (handle) lógico de 43 bits, compuesto
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
    constructor(size = 65535, bucketSize = "32u", metadataSize = 1024) {

        if (!Number.isSafeInteger(size) || size < 2 || size > 0x80000000) throw new RangeError(`Parameter size must be in range [2, 0x80000000] but size is ${size}`);


        if (!BUCKET_MAPPING[bucketSize]) {
            throw new RangeError(`bucketSize must be in ([ 8 || 16 || 32 || 64][ u || i ]) || ([ 16 || 32 || 64][ f ]) but I found ${bucketSize}`);
        }

        if (!Number.isSafeInteger(metadataSize) || metadataSize < HEADER_SIZE || metadataSize > 0x80000000) throw new RangeError(`Parameter metadataSize must be in range [HEADER_SIZE, 0x80000000] but metadataSize is ${metadataSize}`);

        this.wordType = bucketSize;
        this.bucketType = BUCKET_MAPPING[bucketSize].type;
        this.bucketSize = BUCKET_MAPPING[bucketSize].bits >>> 0;
        this.bucketArray = globalThis[`${this.bucketType}Array`];
        this.wordSize = this.bucketSize >>> 3;
        this.wordShift = this.bucketSize >>> 4;
        this.size = Math.max(1 << (32 - Math.clz32(size - 1)) >>> 0, this.wordSize);
        this.headerSize = 1 << (32 - Math.clz32(metadataSize - 1)) >>> 0;
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
        this.recycle = new Map();

        /** @type {Metadata} */
        this.metadata = {
            generation: 0 >>> 0,
            headerAddress: 0 >>> 0,
            dataAddress: 0 >>> 0,
            capacityExponent: 0 >>> 0,
            byteCapacity: 0 >>> 0,
            occupied: 0 >>> 0,
        };

    }

    // ========== ASIGNACIÓN (ALLOCATION) ==========

    /**
     * Asigna un nuevo bloque de memoria.
     *
     * La capacidad solicitada se convierte a la menor potencia de dos que
     * pueda alojar `size` elementos. El bloque se obtiene preferentemente de la lista
     * de regiones reciclables con la capacidad correspondiente; si no existe
     * una región compatible, el bloque se reserva en la cima del `dataBus`.
     *
     * A continuación, se obtiene una cabecera del espacio de control. Las cabeceras previamente
     * liberadas se pueden reutilizar mediante la pila interna de reciclaje;
     * de lo contrario, el `controlBus` se expande cuando es necesario.
     *
     * La cabecera recibe la dirección, la capacidad, la ocupación inicial (cero) y
     * una cookie de validación. El valor devuelto codifica la generación de la asignación
     * y la dirección de la cabecera:
     *
     *     [11 bits de generación][32 bits de dirección de cabecera]
     *
     * @param {number} [size=16] - Número mínimo de elementos que el bloque debe
     * poder alojar. Debe ser un entero seguro en el rango [2, 0x80000000].
     * @returns {number} Descriptor (handle) que identifica el bloque asignado.
     * @throws {RangeError} Si `size` se encuentra fuera del rango permitido.
     * @throws {Error} Si es necesario expandir el `dataBus` mientras haya
     * algún bloque prestado mediante `withView()`.
     */
    alloc(size = 16) {
        if (!Number.isSafeInteger(size) || size < 2 || size > 0x80000000) throw new RangeError(`Parameter size must be in range [2, 0x80000000] but size is ${size}`);

        const capacity = (32 - Math.clz32(size - 1));
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
        this.controlBus[headerAddress + FLAGS_OFFSET] = 0;

        return (this.generation & CLAMP_11BITS) * ROTATE_32BITS + headerAddress;
    }

    /**
     * Amplía la capacidad de un bloque a la siguiente potencia de dos.
     *
     * Cuando el bloque se encuentra en la cima actual del `dataBus`, la ampliación
     * se realiza in situ (in-place): solo se actualizan su capacidad y el puntero `dataPointer`.
     *
     * Si existe otra región después del bloque, se obtiene una nueva región con el doble de
     * capacidad del espacio reciclable o se asigna en la cima del `dataBus`.
     * Los elementos actualmente ocupados se copian entonces a la nueva región,
     * y la región anterior se devuelve a la lista de reciclaje.
     *
     * El descriptor permanece válido, ya que su cabecera se conserva y solo se actualizan
     * la dirección y la capacidad registradas en ella.
     *
     * @param {number} handler - Descriptor del bloque a ampliar.
     * @returns {void}
     * @throws {Error} Si el descriptor no es válido, está corrupto o el bloque
     * está prestado mediante `withView()`. También se produce si la ampliación requiere
     * reasignar el `dataBus` mientras otro bloque está prestado.
     * @throws {AggregateError} Si la capacidad ha alcanzado el límite
     * máximo soportado.
     */
    realloc(handler) {

        const generation = (handler / ROTATE_32BITS) & CLAMP_11BITS;
        const headerAddress = handler >>> 0;
        const dataAddress = this.controlAdapter.getUint32(headerAddress + ADDRESS_OFFSET, IS_LITTLE_ENDIAN);
        const occupied = this.controlAdapter.getUint32(headerAddress + OCCUPIED_OFFSET, IS_LITTLE_ENDIAN);
        const capacity = this.controlAdapter.getUint8(headerAddress + CAPACITY_OFFSET);
        const cookie = this.controlAdapter.getUint8(headerAddress + COOKIE_OFFSET);

        if (cookie !== this.bakeCookie(headerAddress, generation)) {
            throw new Error("Invalid or corrupted handle");
        }

        this.assertNotBorrowed(headerAddress);

        if (capacity >= 31) throw new AggregateError([new Error("Can´t reallocate handler."), new RangeError("Capacity has reached its limit.")], "Internal Error.");

        const newCapacity = capacity + 1;
        const newBlockSize = (1 << newCapacity >>> 0) * this.wordSize;
        const oldBlockSize = (1 << capacity >>> 0) * this.wordSize;

        if (dataAddress + oldBlockSize === this.dataPointer) {
            while (dataAddress + newBlockSize > this.size) this.grow();

            this.controlAdapter.setUint8(headerAddress + CAPACITY_OFFSET, newCapacity);
            this.dataPointer = dataAddress + newBlockSize;
            return;
        }

        let newAddress = this.recyclePop(newBlockSize);

        if (newAddress === UNKNOWN) {
            while (this.dataPointer + newBlockSize > this.size) this.grow();

            newAddress = this.dataPointer;
            this.dataPointer += newBlockSize;
        }

        this.dataBus.copyWithin(newAddress, dataAddress, dataAddress + occupied * this.wordSize);

        this.controlAdapter.setUint32(headerAddress + ADDRESS_OFFSET, newAddress, IS_LITTLE_ENDIAN);
        this.controlAdapter.setUint8(headerAddress + CAPACITY_OFFSET, newCapacity);

        this.recyclePush(oldBlockSize, dataAddress);
    }

    /**
     * Reduce un bloque a la menor capacidad potencia de dos que pueda contener
     * sus elementos ocupados, preservando su dirección y su handler.
     *
     * Si el bloque está en la parte superior de dataBus, dataPointer retrocede.
     * De lo contrario, la cola liberada se divide en regiones de potencias
     * de dos y cada región se devuelve a la lista de reciclaje.
     *
     * @param {number} handler - Handler del bloque que se va a reducir.
     * @returns {void}
     * @throws {Error} Si el handler no es válido, está dañado o está prestado
     * mediante withView().
     */
    shrink(handler) {
        const meta = this.extractMetadata(handler, this.metadata);
        this.assertNotBorrowed(meta.headerAddress);

        const newCapacity = Math.max(1, 32 - Math.clz32(Math.max(2, meta.occupied) - 1));
        if (newCapacity >= meta.capacityExponent) return;

        const oldBlockSize = meta.byteCapacity;
        const newBlockSize = (2 ** newCapacity) * this.wordSize;
        const oldEnd = meta.dataAddress + oldBlockSize;

        this.controlAdapter.setUint8(meta.headerAddress + CAPACITY_OFFSET, newCapacity);

        if (oldEnd === this.dataPointer) {
            this.dataPointer = meta.dataAddress + newBlockSize;
            return;
        }

        let address = meta.dataAddress + newBlockSize;
        for (let exponent = newCapacity; exponent < meta.capacityExponent; exponent++) {
            const segmentSize = (2 ** exponent) * this.wordSize;
            this.recyclePush(segmentSize, address);
            address += segmentSize;
        }
    }

    free(handler) {

        const generation = (handler / ROTATE_32BITS) & CLAMP_11BITS;
        const headerAddress = handler >>> 0;
        const dataAddress = this.controlAdapter.getUint32(headerAddress + ADDRESS_OFFSET, IS_LITTLE_ENDIAN);
        const capacity = this.controlAdapter.getUint8(headerAddress + CAPACITY_OFFSET);
        const cookie = this.controlAdapter.getUint8(headerAddress + COOKIE_OFFSET);

        if (cookie !== this.bakeCookie(headerAddress, generation)) {
            throw new Error("Invalid or corrupted handle");
        }

        this.assertNotBorrowed(headerAddress);

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
    // ========== RECICLAJE (RECYCLING) ==========

    /**
     * [USO INTERNO]
     * Inserta una región libre en la lista de reciclaje.
     *
     * La lista se organiza por capacidad en bytes. Para cada capacidad, el
     * valor almacenado es un `Uint32Array` cuya posición cero contiene la cantidad
     * de direcciones registradas y las posiciones subsiguientes contienen las direcciones de
     * las regiones libres:
     *
     *     [count, address1, address2, ...]
     *
     * Cuando la página se llena, su búfer se expande al doble de su
     * capacidad actual.
     *
     * @param {number} capacity - Capacidad de la región libre, en bytes.
     * @param {number} address - Dirección inicial de la región en el `dataBus`.
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
     * Elimina una región libre de la lista de reciclaje.
     *
     * La búsqueda se realiza por la capacidad exacta solicitada. Cuando existe una
     * página correspondiente, se elimina de ella la última dirección registrada y se devuelve,
     * implementando el reciclaje como una pila LIFO.
     *
     * @param {number} capacity - Capacidad deseada, en bytes.
     * @returns {number} Dirección inicial de una región reciclable o `UNKNOWN`
     * cuando no existe una región con la capacidad solicitada.
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

    // ========== RECOLECCIÓN DE BASURA (GARBAGE COLLECTION) ==========

    /**
     * Compacta el `dataBus` mediante el algoritmo ReBump.
     *
     * Recorre secuencialmente las cabeceras registradas en el `controlBus` y copia
     * las regiones aún válidas a un nuevo `dataBus`, eliminando los espacios
     * libres existentes entre ellas. La dirección de cada bloque superviviente se
     * actualiza en su cabecera respectiva.
     *
     * Se preserva el orden de los bloques en el `controlBus`. Los datos internos de
     * cada bloque también se conservan íntegramente, incluyendo su capacidad
     * reservada y su ocupación actual.
     *
     * Al finalizar la compactación:
     * - se eliminan todas las regiones reciclables;
     * - el puntero `dataPointer` apunta al primer byte posterior al último bloque
     *   activo;
     * - el `dataBus` pasa a representar un montón (heap) contiguo para los bloques activos.
     *
     * La complejidad de control es O(n), donde `n` es el número de cabeceras
     * recorridas. El coste efectivo de movimiento de memoria también depende
     * del volumen de bytes pertenecientes a los bloques vivos.
     *
     * @returns {void}
     * @throws {Error} Si hay algún bloque prestado mediante `withView()`.
     */
    gc() {
        this.assertNoActiveViews();

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

    // ========== ESCALADO (SCALING) ==========

    /**
     * [!!! USO INTERNO, NO UTILIZAR EN SU CÓDIGO !!!]
     * Amplía el `dataBus` al doble de su capacidad actual.
     *
     * El búfer subyacente se transfiere a un `ArrayBuffer` mayor, preservando
     * los datos existentes. Todas las vistas asociadas al búfer se recrean
     * para hacer referencia al nuevo almacenamiento.
     *
     * @returns {void}
     * @throws {Error} Si hay algún bloque prestado mediante `withView()`.
     * @throws {RangeError} Si la capacidad del `dataBus` ya ha excedido el
     * límite máximo soportado.
     * @private
     */
    grow() {
        this.assertNoActiveViews();

        if (this.size > 0x80000000) throw new RangeError("Data bus capacity exceeded");

        const newSize = (this.size * 2) >>> 0;
        const newBuffer = this.dataBus.buffer.transfer(newSize);

        this.size = newSize;
        this.dataBus = new Uint8Array(newBuffer);
        this.dataAdapter = new DataView(newBuffer);
        this.writer = this.dataAdapter[`set${this.bucketType}`].bind(this.dataAdapter);
        this.reader = this.dataAdapter[`get${this.bucketType}`].bind(this.dataAdapter);
        this.auxiliary = new this.bucketArray(newBuffer);
    }

    /**
     * [!!! USO INTERNO, NO UTILIZAR EN SU CÓDIGO !!!]
     * Amplía el `controlBus` al doble de su capacidad actual.
     *
     * El búfer subyacente se transfiere a un `ArrayBuffer` mayor, preservando
     * las cabeceras existentes. El `controlAdapter` se recrea para hacer referencia
     * al nuevo almacenamiento.
     *
     * @returns {void}
     * @throws {RangeError} Si la capacidad actual del `controlBus` ya ha
     * excedido el límite máximo soportado.
     * @private
     */
    headerGrow() {
        if (this.controlBus.byteLength > 0x80000000) throw new RangeError("Control bus capacity exceeded");
        const newSize = (this.controlBus.byteLength * 2) >>> 0;
        const newBuffer = this.controlBus.buffer.transfer(newSize);

        this.controlBus = new Uint8Array(newBuffer);
        this.controlAdapter = new DataView(newBuffer);
    }

    // ========== OPERACIONES DE PILA (STACK OPERATIONS) ==========

    /**
     * Añade un elemento al final de la secuencia ocupada por el bloque.
     *
     * El elemento se escribe en la primera posición libre tras el último elemento
     * ocupado. La ocupación del bloque se incrementa únicamente cuando hay espacio
     * disponible dentro de su capacidad.
     *
     * @param {number} value - Valor que se va a insertar.
     * @returns {boolean} `true` si el valor fue insertado; `false` si el bloque
     * ya no dispone de espacio libre.
     * @throws {Error} Si el descriptor no es válido, está corrupto o el bloque está prestado mediante `withView()`.
     * 
     */
    push(handler, value) {
        const meta = this.extractMetadata(handler, this.metadata);
        this.assertNotBorrowed(meta.headerAddress);

        if ((meta.occupied + 1) * this.wordSize > meta.byteCapacity) return false;

        this.writer(meta.dataAddress + meta.occupied * this.wordSize, value, IS_LITTLE_ENDIAN);
        this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, meta.occupied + 1, IS_LITTLE_ENDIAN);

        return true;
    }

    /**
     * Elimina el último elemento ocupado del bloque y lo devuelve.
     *
     * La ocupación se decrementa antes de leer el elemento eliminado. Los
     * bytes correspondientes no se limpian y permanecen en la región asignada,
     * pero dejan de formar parte de la secuencia ocupada.
     *
     * @param {number} handler - Descriptor del bloque.
     * @returns {number|undefined} Valor eliminado o `undefined` si el bloque
     * está vacío.
     * @throws {Error} Si el descriptor no es válido, está corrupto o el bloque está prestado mediante `withView()`.
     */
    pop(handler) {
        const meta = this.extractMetadata(handler, this.metadata);
        this.assertNotBorrowed(meta.headerAddress);

        if (meta.occupied === 0) return undefined;

        this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, meta.occupied - 1, IS_LITTLE_ENDIAN);
        return this.reader(meta.dataAddress + (meta.occupied - 1) * this.wordSize, IS_LITTLE_ENDIAN);
    }

    /**
     * Devuelve el último elemento ocupado sin eliminarlo.
     *
     * @param {number} handler - Descriptor del bloque.
     * @returns {number|undefined} Último valor ocupado o `undefined` si el
     * bloque está vacío.
     * @throws {Error} Si el descriptor no es válido o está corrupto.
     */
    peek(handler) {
        const meta = this.extractMetadata(handler, this.metadata);

        if (meta.occupied === 0) return undefined;

        return this.reader(meta.dataAddress + (meta.occupied - 1) * this.wordSize, IS_LITTLE_ENDIAN);
    }

    // ========== OPERACIONES DE COLA (QUEUE OPERATIONS) ==========

    /**
     * Inserta un elemento al principio de la secuencia ocupada.
     *
     * Los elementos actualmente ocupados se desplazan una posición hacia adelante
     * y `value` se escribe en la primera posición. La operación requiere una
     * posición libre en la capacidad del bloque.
     *
     * El coste de la operación es proporcional al número de elementos ocupados,
     * ya que es necesario desplazar los datos.
     *
     * @param {number} handler - Descriptor del bloque.
     * @param {number} value - Valor que se va a insertar.
     * @returns {boolean} `true` si el valor fue insertado; `false` si el bloque
     * está lleno.
     * @throws {Error} Si el descriptor no es válido, está corrupto o el bloque está prestado mediante `withView()`.
     */
    nudge(handler, value) {
        const meta = this.extractMetadata(handler, this.metadata);
        this.assertNotBorrowed(meta.headerAddress);

        if ((meta.occupied + 1) * this.wordSize > meta.byteCapacity) return false;

        this.dataBus.copyWithin(meta.dataAddress + this.wordSize, meta.dataAddress, meta.dataAddress + meta.occupied * this.wordSize);
        this.writer(meta.dataAddress, value, IS_LITTLE_ENDIAN);
        this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, meta.occupied + 1, IS_LITTLE_ENDIAN);

        return true;
    }

    /**
     * Elimina el primer elemento ocupado del bloque y lo devuelve.
     *
     * Los elementos restantes se desplazan una posición hacia el principio
     * de la región ocupada. La capacidad física del bloque permanece inalterada.
     *
     * El coste de la operación es proporcional al número de elementos desplazados.
     *
     * @param {number} handler - Descriptor del bloque.
     * @returns {number|undefined} Primer valor eliminado o `undefined` si el
     * bloque está vacío.
     * @throws {Error} Si el descriptor no es válido, está corrupto o el bloque está prestado mediante `withView()`.
     */
    pull(handler) {
        const meta = this.extractMetadata(handler, this.metadata);
        this.assertNotBorrowed(meta.headerAddress);

        if (meta.occupied === 0) return undefined;

        const result = this.reader(meta.dataAddress, IS_LITTLE_ENDIAN);
        this.dataBus.copyWithin(meta.dataAddress, meta.dataAddress + this.wordSize, meta.dataAddress + meta.occupied * this.wordSize);
        this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, meta.occupied - 1, IS_LITTLE_ENDIAN);

        return result;
    }

    /**
     * Devuelve el primer elemento ocupado sin eliminarlo.
     *
     * @param {number} handler - Descriptor del bloque.
     * @returns {number|undefined} Primer valor ocupado o `undefined` si el
     * bloque está vacío.
     * @throws {Error} Si el descriptor no es válido o está corrupto.
     */
    head(handler) {
        const meta = this.extractMetadata(handler, this.metadata);

        if (meta.occupied === 0) return undefined;

        return this.reader(meta.dataAddress, IS_LITTLE_ENDIAN);
    }

    // ========== ACCESO ALEATORIO (RANDOM ACCESS) ==========

    /**
     * Comprueba si un valor está presente entre los elementos ocupados del bloque.
     *
     * La búsqueda se realiza directamente sobre el `TypedArray` auxiliar y considera
     * únicamente el rango actualmente ocupado, no toda la capacidad física reservada.
     *
     * @param {number} handler - Descriptor del bloque.
     * @param {number} value - Valor que se busca.
     * @returns {boolean} `true` si `value` está presente entre los elementos
     * ocupados; de lo contrario, `false`.
     * @throws {Error} Si el descriptor no es válido o está corrupto.
     */
    has(handler, value) {
        const meta = this.extractMetadata(handler, this.metadata);

        if (meta.occupied === 0) return false;

        const rawAddres = meta.dataAddress >>> this.wordShift;

        return this.auxiliary.subarray(rawAddres, rawAddres + meta.occupied).includes(value);
    }

    /**
     * Localiza la primera ocurrencia de un elemento en la secuencia ocupada del bloque.
     *
     * La búsqueda se realiza en orden ascendente de índices, utilizando la operación
     * `indexOf` del TypedArray subyacente. La exploración considera exclusivamente
     * los elementos ocupados, ignorando la capacidad no utilizada del bloque.
     *
     * La posición de inicio de la búsqueda se puede especificar mediante `fromIndex`,
     * siguiendo las reglas de indexación de TypedArray.
     *
     * @param {number} handler - Descriptor del bloque.
     * @param {number|bigint} searchElement - Elemento que se va a localizar.
     * @param {number} [fromIndex=0] - Índice a partir del cual se iniciará la búsqueda.
     * @returns {number} Índice de la primera ocurrencia o `-1` si el
     * elemento no se encuentra o si el bloque está vacío.
     * @throws {Error} Si el descriptor no es válido o está corrupto.
     */
    indexOf(handler, searchElement, fromIndex = 0) {
        const meta = this.extractMetadata(handler, this.metadata);

        if (meta.occupied === 0) return -1;

        const rawAddres = meta.dataAddress >>> this.wordShift;

        return this.auxiliary.subarray(rawAddres, rawAddres + meta.occupied).indexOf(searchElement, fromIndex);
    }

    /**
     * Localiza la última ocurrencia de un elemento en la secuencia ocupada del bloque.
     *
     * La búsqueda se realiza en orden descendente de índices, utilizando la operación
     * `lastIndexOf` del TypedArray subyacente. La exploración considera exclusivamente
     * los elementos ocupados, ignorando la capacidad no utilizada del bloque.
     *
     * La posición de inicio de la búsqueda se puede especificar mediante `fromIndex`,
     * siguiendo las reglas de indexación de TypedArray. Por defecto, la búsqueda comienza
     * en el último elemento ocupado.
     *
     * @param {number} handler - Descriptor del bloque.
     * @param {number|bigint} searchElement - Elemento que se va a localizar.
     * @param {number} [fromIndex=-1] - Índice a partir del cual se iniciará la búsqueda.
     * @returns {number} Índice de la última ocurrencia o `-1` si el
     * elemento no se encuentra o si el bloque está vacío.
     * @throws {Error} Si el descriptor no es válido o está corrupto.
     */
    lastIndexOf(handler, searchElement, fromIndex = -1) {
        const meta = this.extractMetadata(handler, this.metadata);

        if (meta.occupied === 0) return -1;

        const rawAddres = meta.dataAddress >>> this.wordShift;

        return this.auxiliary.subarray(rawAddres, rawAddres + meta.occupied).lastIndexOf(searchElement, fromIndex);
    }


    /**
    * Devuelve el elemento ocupado en un índice basado en cero.
    *
    * Los índices fuera del rango `[0, occupied)` no se consideran un error y
    * devuelven `undefined`.
    *
    * @param {number} handler - Descriptor del bloque.
    * @param {number} index - Índice basado en cero del elemento.
    * @returns {number|undefined} Valor almacenado en el índice o `undefined` si
    * el índice está fuera de la región ocupada.
    * @throws {Error} Si el descriptor no es válido o está corrupto.
    */
    get(handler, index) {

        const meta = this.extractMetadata(handler, this.metadata);

        if (index < 0 || index >= meta.occupied) return undefined;

        return this.reader(meta.dataAddress + index * this.wordSize, IS_LITTLE_ENDIAN);
    }

    /**
     * Reemplaza el valor almacenado en un índice ocupado.
     *
     * La operación no altera la ocupación del bloque. Los índices fuera del rango
     * `[0, occupied)` se ignoran y devuelven `false`.
     *
     * @param {number} handler - Descriptor del bloque.
     * @param {number} index - Índice basado en cero del elemento.
     * @param {number} value - Nuevo valor.
     * @returns {boolean} `true` si el valor fue escrito; `false` si el índice
     * está fuera de la región ocupada.
     * @throws {Error} Si el descriptor no es válido, está corrupto o el bloque está prestado mediante `withView()`.
     */
    set(handler, index, value) {
        const meta = this.extractMetadata(handler, this.metadata);
        this.assertNotBorrowed(meta.headerAddress);

        if (index < 0 || index >= meta.occupied) return false;

        this.writer(meta.dataAddress + index * this.wordSize, value, IS_LITTLE_ENDIAN);
        return true;
    }

    // ============= MISCELÁNEA (MISCELLANEOUS) ==============

    /**
     * Pone a cero la ocupación del bloque y rellena toda su capacidad física con
     * un mismo valor.
     *
     * El rellenado abarca todas las ranuras (slots) disponibles, no solo los
     * elementos actualmente ocupados. Tras la operación, el bloque se considera
     * vacío independientemente del valor utilizado para el rellenado.
     *
     * @param {number} handler - Descriptor del bloque.
     * @param {number} [value=0] - Valor utilizado para rellenar todas las ranuras.
     * @returns {void}
     * @throws {Error} Si el descriptor no es válido, está corrupto o el bloque está prestado mediante `withView()`.
     */
    clear(handler, value = 0) {
        const meta = this.extractMetadata(handler, this.metadata);
        this.assertNotBorrowed(meta.headerAddress);

        const slots = meta.byteCapacity / this.wordSize;
        const rawAddress = meta.dataAddress >>> this.wordShift;

        this.auxiliary.fill(value, rawAddress, rawAddress + slots);
        this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, 0, IS_LITTLE_ENDIAN);
    }


    /**
     * Rellena un intervalo de ranuras del bloque con un valor.
     *
     * El intervalo utiliza índices basados en cero y sigue la convención
     * `[start, end)`, por lo que `start` es inclusivo y `end` es exclusivo.
     * Cuando no se especifica `end`, el rellenado se extiende hasta el final de la
     * capacidad física del bloque.
     *
     * La ocupación del bloque pasa a ser `end`, incluso cuando el intervalo
     * rellenado se extiende más allá de la ocupación anterior.
     *
     * @param {number} handler - Descriptor del bloque.
     * @param {number} value - Valor utilizado en el rellenado.
     * @param {number} [start=0] - Índice inicial, inclusivo.
     * @param {number|null} [end=null] - Índice final, exclusivo. Cuando
     * se omite o es `null`, utiliza la capacidad total del bloque.
     * @returns {void}
     * @throws {Error} Si el descriptor no es válido, está corrupto o el bloque está prestado mediante `withView()`.
     * @throws {RangeError} Si `start` o `end` están fuera de los límites de la
     * capacidad, o si `start > end`.
     */
    fill(handler, value, start = 0, end = null) {
        const meta = this.extractMetadata(handler, this.metadata);
        this.assertNotBorrowed(meta.headerAddress);

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
     * Rellena todas las ranuras físicas del bloque con un valor y marca toda la
     * capacidad como ocupada.
     *
     * A diferencia de `clear()`, la operación da como resultado un bloque totalmente
     * ocupado.
     *
     * @param {number} handler - Descriptor del bloque.
     * @param {number} value - Valor utilizado en el rellenado.
     * @returns {void}
     * @throws {Error} Si el descriptor no es válido, está corrupto o el bloque está prestado mediante `withView()`.
     */
    fillAll(handler, value) {
        const meta = this.extractMetadata(handler, this.metadata);
        this.assertNotBorrowed(meta.headerAddress);

        const rawAddress = meta.dataAddress >>> this.wordShift;
        const capacityElements = meta.byteCapacity / this.wordSize;

        this.auxiliary.fill(value, rawAddress, rawAddress + capacityElements);
        this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, capacityElements, IS_LITTLE_ENDIAN);
    }

    /**
     * Copia los elementos de un `Array` o `TypedArray` al principio del bloque.
     *
     * La cantidad copiada está limitada por la capacidad del bloque. La ocupación se
     * actualiza al mayor valor entre la ocupación anterior y la cantidad
     * efectivamente copiada; por lo tanto, una llamada a `put()` no reduce la
     * ocupación existente cuando recibe una secuencia más pequeña.
     *
     * Para `Array`, solo se copian los primeros elementos que quepan.
     * Para `TypedArray`, se utiliza un subarreglo (subarray) de la fuente sin copia
     * intermedia.
     *
     * @param {number} handler - Descriptor del bloque.
     * @param {Array|TypedArray} data - Secuencia de valores que se van a copiar.
     * @returns {void}
     * @throws {Error} Si el descriptor no es válido, está corrupto o el bloque está prestado mediante `withView()`.
     * @throws {TypeError} Si `data` no es ni un `Array` ni un `TypedArray`.
     */
    put(handler, data) {
        const meta = this.extractMetadata(handler, this.metadata);
        this.assertNotBorrowed(meta.headerAddress);

        const rawAddress = meta.dataAddress >>> this.wordShift;
        const length = Math.min(1 << meta.capacityExponent >>> 0, data.length);

        if (Array.isArray(data)) {
            this.auxiliary.set(data.slice(0, length), rawAddress);
        } else if (isTypedArray(data)) {
            this.auxiliary.set(data.subarray(0, length), rawAddress);
        } else {
            const actual = data?.constructor?.name ?? (data === null ? 'null' : typeof data);
            throw new TypeError(`data must be Array or TypedArray, but ${actual} was given.`);
        }

        this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, Math.max(length, meta.occupied), IS_LITTLE_ENDIAN);
    }

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
    * @param {number} handler - Descriptor del bloque.
    * @returns {TypedArray} Copia de los elementos ocupados por el bloque. Cuando
    * el bloque está vacío, devuelve un `TypedArray` vacío del tipo configurado.
    * @throws {Error} Si el descriptor no es válido o está corrupto.
    */
    pick(handler) {
        const meta = this.extractMetadata(handler, this.metadata);

        const rawAddress = meta.dataAddress >>> this.wordShift;

        if (meta.occupied === 0) {
            return this.auxiliary.slice(rawAddress, rawAddress);
        }

        return this.auxiliary.slice(rawAddress, rawAddress + meta.occupied);
    }

    /**
     * Ejecuta una retrollamada (callback) sobre una vista directa de la región ocupada por el bloque.
     *
     * La vista comparte el almacenamiento interno de Balloc y no realiza copias.
     * El bloque queda protegido frente a operaciones incompatibles durante la ejecución de la retrollamada.
     *
     * La retrollamada debe ser síncrona. La vista recibida no debe almacenarse,
     * devolverse ni utilizarse una vez finalizada la retrollamada. Esta restricción
     * también se aplica a las subvistas derivadas de la vista original.
     *
     * @param {number} handler - Descriptor del bloque.
     * @param {...(number|Function)} args - Uno o más descriptores de bloque, seguidos de la retrollamada.
     * @returns {*} Valor devuelto por la retrollamada.
     * @throws {TypeError} Si no se proporciona ningún descriptor o la retrollamada no es una función.
     * @throws {Error} Si algún descriptor no es válido, está duplicado o ya está prestado.
     */
    withView(...args) {
        if (args.length < 2) throw new TypeError("At least one handler and one callback are required");
        const lastIndex = args.length - 1;
        const callback = args[lastIndex];
        if (typeof callback !== "function") throw new TypeError("callback must be a function");

        const lookup = Object.create(null);
        const views = [];

        try {
            for(let i = 0; i < lastIndex; i++) {
                const metadata = this.extractMetadata(args[i], {});

                
                if (Object.hasOwn(lookup, metadata.headerAddress)) throw new Error("Duplicate handler");
                if (metadata.borrowed) throw new Error("Block is already borrowed"); 
                
                this.controlBus[metadata.headerAddress + FLAGS_OFFSET] |= VIEW_LOCK;

                const rawAddress = metadata.dataAddress >>> this.wordShift;
                lookup[metadata.headerAddress] = metadata.headerAddress;     
                views.push(this.auxiliary.subarray(rawAddress, rawAddress + metadata.occupied))
            }
            return callback(...views);
        } finally {
            for (const key in lookup) {
                this.controlBus[lookup[key] + FLAGS_OFFSET] &= ~VIEW_LOCK;
            }
        }
    }

    // ======== CAPACIDAD EN RANURAS (CAPACITY IN SLOTS) ==========

    /**
     * Devuelve la capacidad física del bloque en bytes.
     *
     * La capacidad corresponde al espacio reservado para todas las ranuras del
     * bloque, independientemente de cuántos elementos estén ocupados actualmente.
     *
     * @param {number} handler - Descriptor del bloque.
     * @returns {number} Capacidad física del bloque, en bytes.
     * @throws {Error} Si el descriptor no es válido o está corrupto.
     */
    byteSize(handler) {
        const meta = this.extractMetadata(handler, this.metadata);
        return meta.byteCapacity;
    }

    /**
     * Devuelve la cantidad de elementos ocupados actualmente en el bloque.
     *
     * @param {number} handler - Descriptor del bloque.
     * @returns {number} Número de elementos ocupados.
     * @throws {Error} Si el descriptor no es válido o está corrupto.
     */
    occupied(handler) {
        const meta = this.extractMetadata(handler, this.metadata);
        return meta.occupied;

    }

    /**
     * Devuelve la capacidad del bloque en número de elementos.
     *
     * El valor corresponde a la cantidad total de ranuras reservadas físicamente,
     * y no a la cantidad ocupada actualmente.
     *
     * @param {number} handler - Descriptor del bloque.
     * @returns {number} Número total de ranuras disponibles en el bloque.
     * @throws {Error} Si el descriptor no es válido o está corrupto.
     */
    length(handler) {
        const meta = this.extractMetadata(handler, this.metadata);
        return 1 << meta.capacityExponent >>> 0;
    }

    /**
     * Comprueba si el bloque de memoria ha alcanzado su capacidad de asignación.
     *
     * Un bloque se considera lleno cuando la cantidad de elementos ocupados
     * es igual a su capacidad total asignada, sin quedar posiciones disponibles
     * para almacenar nuevos elementos.
     *
     * @param {number} handler - Descriptor del bloque.
     * @returns {boolean} `true` si el bloque está lleno; de lo contrario, `false`.
     * @throws {Error} Si el descriptor no es válido o está corrupto.
     */
    isFull(handler) {
        const meta = this.extractMetadata(handler, this.metadata);
        return (1 << meta.capacityExponent >>> 0) - meta.occupied === 0;
    }

    // ========== Operaciones entre bloques (Operations between blocks) =============

    /**
    * Copia elementos ocupados de un bloque a otro.
    *
    * La copia comienza en el primer elemento de la fuente (`source`) y en la primera ranura del
    * destino (`destination`). La cantidad efectivamente copiada está limitada por el número de
    * elementos ocupados en la fuente, la capacidad física del destino y el
    * límite especificado en `slots`.
    *
    * La ocupación del destino se incrementa, cuando es necesario, para abarcar los
    * elementos copiados. La capacidad del destino no se altera.
    *
    * La operación utiliza `Uint8Array.prototype.copyWithin()` sobre el `dataBus`,
    * por lo que el valor devuelto es el propio `Uint8Array` que representa el bus de datos.
    *
    * @param {number} source - Descriptor del bloque de origen.
    * @param {number} destination - Descriptor del bloque de destino.
    * @param {number} [slots=UNKNOWN] - Número máximo de elementos que se van a copiar.
    * `UNKNOWN` representa el valor centinela utilizado para no imponer un
    * límite adicional.
    * @returns {Uint8Array} El `dataBus` tras la operación.
    * @throws {Error} Si los descriptores no son válidos, están corruptos
    * o el bloque de destino está prestado mediante `withView()`.
    */
    copy(source, destination, slots = UNKNOWN) {
        /** @type {Metadata} */
        const metaA = {};
        /** @type {Metadata} */
        const metaB = {};

        this.extractMetadata(source, metaA);
        this.extractMetadata(destination, metaB);
        this.assertNotBorrowed(metaB.headerAddress);

        const maxSlotsDest = Math.floor(metaB.byteCapacity / this.wordSize);
        const slotsToCopy = Math.min(metaA.occupied, maxSlotsDest, slots);
        const newOccupied = Math.max(metaB.occupied, slotsToCopy);

        this.controlAdapter.setUint32(metaB.headerAddress + OCCUPIED_OFFSET, newOccupied, IS_LITTLE_ENDIAN);
        return this.dataBus.copyWithin(metaB.dataAddress, metaA.dataAddress, metaA.dataAddress + slotsToCopy * this.wordSize);
    }

    /**
     * Copia una región de elementos dentro del propio bloque.
     *
     * Los índices están basados en cero y siguen la semántica de
     * `Array.prototype.copyWithin()`: `target` identifica la posición de destino,
     * `start` la posición inicial de origen y `length` la cantidad máxima de
     * elementos que se van a copiar.
     *
     * Los índices negativos se interpretan a partir del final de la capacidad del
     * bloque. Tras dicha normalización, los índices se limitan a la capacidad
     * física. La cantidad copiada también está limitada por los elementos
     * ocupados efectivamente y por el espacio disponible a partir de `target`.
     *
     * La operación admite regiones solapadas y puede incrementar la ocupación del
     * bloque cuando el intervalo de destino supera la ocupación actual.
     *
     * @param {number} handler - Descriptor del bloque.
     * @param {number} target - Índice inicial de destino.
     * @param {number} start - Índice inicial de origen.
     * @param {number} length - Número máximo de elementos que se van a copiar.
     * @returns {Uint8Array} El `dataBus` tras la operación.
     * @throws {Error} Si el descriptor no es válido, está corrupto o el bloque está prestado mediante `withView()`.
     */
    copyWithin(handler, target, start, length) {
        const meta = this.extractMetadata(handler, this.metadata);
        this.assertNotBorrowed(meta.headerAddress);

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
     * Añade los elementos ocupados de `source` al final de `target`.
     *
     * La cantidad copiada está limitada por el número de elementos ocupados en la
     * fuente y el espacio libre restante en la capacidad del destino.
     *
     * La operación permite que `target` y `source` hagan referencia al mismo bloque.
     * En ese caso, la copia se realiza sobre la propia región del bloque y
     * preserva la semántica de solapamiento de `copyWithin()`.
     *
     * @param {number} target - Descriptor del bloque que recibirá los elementos.
     * @param {number} source - Descriptor del bloque cuyos elementos se van a
     * añadir.
     * @returns {number} Número de elementos añadidos efectivamente.
     * @throws {Error} Si los descriptores no son válidos, están corruptos
     * o el bloque de destino está prestado mediante `withView()`.
     */
    append(target, source) {
        const metaTarget = {};
        const metaSource = {};

        this.extractMetadata(target, metaTarget);
        this.extractMetadata(source, metaSource);
        this.assertNotBorrowed(metaTarget.headerAddress);

        const available = metaTarget.byteCapacity / this.wordSize - metaTarget.occupied;
        const count = Math.min(available, metaSource.occupied);

        if (count === 0) return 0;

        const targetAddress = metaTarget.dataAddress + metaTarget.occupied * this.wordSize;
        const sourceAddress = metaSource.dataAddress;

        this.dataBus.copyWithin(targetAddress, sourceAddress, sourceAddress + count * this.wordSize);

        this.controlAdapter.setUint32(metaTarget.headerAddress + OCCUPIED_OFFSET, metaTarget.occupied + count, IS_LITTLE_ENDIAN);

        return count;
    }

    /**
     * Crea una copia independiente de un bloque.
     *
     * El nuevo bloque posee la misma capacidad física y la misma ocupación que el
     * bloque original. Se copian todos los bytes de la región reservada, incluidas las posiciones
     * no ocupadas actualmente.
     *
     * El nuevo bloque recibe un nuevo descriptor y sigue sujeto a las reglas
     * normales de asignación y reciclaje.
     *
     * @param {number} handler - Descriptor del bloque que se va a clonar.
     * @returns {number} Descriptor del nuevo bloque.
     * @throws {Error} Si el descriptor no es válido o está corrupto.
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
     * Intercambia las regiones de datos asociadas a dos bloques.
     *
     * La operación intercambia entre las cabeceras las direcciones de las regiones, sus
     * capacidades y sus ocupaciones. Los descriptores permanecen inalterados:
     * tras la operación, cada descriptor sigue identificando su propia
     * cabecera, pero dicha cabecera pasa a describir la región que anteriormente
     * pertenecía al otro bloque.
     *
     * No se copian datos en el `dataBus`; solo se modifican los metadatos de ambas
     * cabeceras.
     *
     * @param {number} source - Descriptor del primer bloque.
     * @param {number} target - Descriptor del segundo bloque.
     * @returns {void}
     * @throws {Error} Si los descriptores no son válidos, están corruptos
     * o cualquiera de los bloques está prestado mediante `withView()`.
     */
    swap(source, target) {
        /** @type {Metadata} */
        const metaA = {};
        /** @type {Metadata} */
        const metaB = {};

        this.extractMetadata(source, metaA);
        this.extractMetadata(target, metaB);

        this.assertNotBorrowed(metaA.headerAddress);
        this.assertNotBorrowed(metaB.headerAddress);

        this.controlAdapter.setUint32(metaA.headerAddress + ADDRESS_OFFSET, metaB.dataAddress, IS_LITTLE_ENDIAN);
        this.controlAdapter.setUint32(metaB.headerAddress + ADDRESS_OFFSET, metaA.dataAddress, IS_LITTLE_ENDIAN);

        this.controlAdapter.setUint8(metaA.headerAddress + CAPACITY_OFFSET, metaB.capacityExponent);
        this.controlAdapter.setUint8(metaB.headerAddress + CAPACITY_OFFSET, metaA.capacityExponent);

        this.controlAdapter.setUint32(metaA.headerAddress + OCCUPIED_OFFSET, metaB.occupied, IS_LITTLE_ENDIAN);
        this.controlAdapter.setUint32(metaB.headerAddress + OCCUPIED_OFFSET, metaA.occupied, IS_LITTLE_ENDIAN);
    }


    // ============= SERIALIZACIÓN (SERIALIZATION) ==============

    /**
     * Serializa el contenido y los metadatos de un bloque de memoria.
     *
     * El método extrae los datos ocupados del bloque mediante `pick()`,
     * los agrupa junto con la información de capacidad y el tipo de palabra
     * en un sobre de datos y los codifica utilizando el formato CBOR.
     *
     * @param {number} handler - Descriptor del bloque que se va a serializar.
     * @returns {Uint8Array} Un búfer que contiene los datos serializados del bloque.
     * @throws {Error} Si el descriptor no es válido o está corrupto.
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

        return encode({
            v: 1,
            wordType: this.wordType,
            capacity,
            occupied: meta.occupied,
            le: IS_LITTLE_ENDIAN,
            payload
        });
    }

    /**
     * Restaura un bloque de memoria a partir de datos serializados.
     *
     * Decodifica el sobre CBOR, valida si el tipo de palabra del dato
     * serializado es compatible con la instancia actual del asignador y asigna
     * un nuevo bloque con la capacidad necesaria para alojar el contenido.
     * A continuación, se restauran los datos y la ocupación original en el nuevo bloque.
     *
     * @param {Uint8Array|ArrayBuffer} serialized - Búfer que contiene los datos serializados.
     * @returns {number} Descriptor del nuevo bloque recreado.
     * @throws {Error} Si el tipo de palabra del dato decodificado difiere del configurado en el asignador.
     */
    load(serialized) {
        if (!(serialized instanceof ArrayBuffer) && !(serialized instanceof Uint8Array)) {
            throw new TypeError("serialized must be an ArrayBuffer or Uint8Array");
        }

        const envelope = decode(serialized);

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

    // ============= UTILIDADES (UTILITIES) ==============

    /**
     * Impide operaciones de modificación sobre un bloque prestado.
     *
     * Comprueba la bandera `VIEW_LOCK` en la cabecera asociada a la dirección proporcionada.
     *
     * @param {number} headerAddress - Dirección de la cabecera en el `controlBus`.
     * @returns {void}
     * @throws {Error} Si el bloque está prestado mediante `withView()`.
     * @private
     */
    assertNotBorrowed(headerAddress) {
        if (this.controlBus[headerAddress + FLAGS_OFFSET] & VIEW_LOCK) {
            throw new Error("Block is borrowed");
        }
    }

    /**
     * Impide operaciones que reemplazan o reasignan el `dataBus`
     * mientras exista algún segmento prestado.
     *
     * @returns {void}
     * @throws {Error} Si existe algún bloque prestado mediante `withView()`.
     * @private
     */
    assertNoActiveViews() {
        for (let i = 0; i < this.controlPointer; i += HEADER_SIZE) {
            if (this.controlBus[i + COOKIE_OFFSET] === 0) continue;
            if (this.controlBus[i + FLAGS_OFFSET] & VIEW_LOCK) {
                throw new Error("Cannot remap memory while a block is borrowed");
            }
        }
    }

    /**
     * [USO INTERNO]
     * Decodifica los metadatos asociados a un descriptor.
     *
     * El descriptor se divide en generación y dirección de la cabecera. La cookie almacenada
     * en la cabecera se recalcula para validar la combinación; solo tras
     * dicha validación se leen los metadatos.
     *
     * Los campos decodificados se escriben en el objeto `out`, que es devuelto
     * por la propia función. El objeto se puede reutilizar entre llamadas para
     * evitar nuevas asignaciones.
     *
     * @param {number} handler - Descriptor que se va a decodificar y validar.
     * @param {Metadata} out - Objeto que recibirá los metadatos decodificados.
     * @returns {Metadata} La misma referencia proporcionada en `out`.
     * @throws {Error} Si la cookie de la cabecera no coincide con el descriptor o
     * si el descriptor no identifica una cabecera válida.
     * @private
     */
    extractMetadata(handler, out) {
        out.generation = (handler / ROTATE_32BITS) & CLAMP_11BITS;
        out.headerAddress = handler >>> 0;

        const cookie = this.controlAdapter.getUint8(out.headerAddress + COOKIE_OFFSET);


        if (cookie !== this.bakeCookie(out.headerAddress, out.generation)) {
            throw new Error("Invalid or corrupted handle");
        }

        out.dataAddress = this.controlAdapter.getUint32(out.headerAddress + ADDRESS_OFFSET, IS_LITTLE_ENDIAN);
        out.capacityExponent = this.controlAdapter.getUint8(out.headerAddress + CAPACITY_OFFSET);
        out.byteCapacity = (1 << out.capacityExponent >>> 0) * this.wordSize;
        out.occupied = this.controlAdapter.getUint32(out.headerAddress + OCCUPIED_OFFSET, IS_LITTLE_ENDIAN);
        out.borrowed = this.controlAdapter.getUint32(out.headerAddress + FLAGS_OFFSET, IS_LITTLE_ENDIAN) & VIEW_LOCK;

        return out;
    }

    /**
     * [USO INTERNO]
     * Calcula la cookie de validación de una cabecera.
     *
     * La cookie se deriva de la dirección de la cabecera y de los 11 bits de la generación mediante
     * un hash rápido (fast hash).
     * El resultado se reduce a 8 bits.
     *
     * El valor cero se reserva como indicador de cabecera inválida; por tanto,
     * cuando el cálculo produce cero, el método devuelve `1`.
     *
     * La cookie no constituye un mecanismo criptográfico. Su finalidad es
     * detectar descriptores inválidos, obsoletos (stale) o corruptos dentro del modelo de
     * gestión de memoria del asignador.
     *
     * @param {number} addr - Dirección de la cabecera.
     * @param {number} gen - Generación asociada al descriptor. Solo se consideran los 11 bits
     * menos significativos.
     * @returns {number} Cookie de 8 bits en el rango [1, 255].
     * @private
     */
    bakeCookie(addr, gen) {
        return (addr ^ (gen & 0x7FF * 0x9e3779b1)) & 0xff || 1;
    }

    /**
     * Devuelve la cantidad de regiones almacenadas actualmente en la lista de
     * reciclaje.
     *
     * Cada región corresponde a un bloque liberado que no pudo devolverse
     * directamente a la cima del `dataBus` y, por tanto, permanece disponible para
     * su reutilización en una futura asignación de capacidad idéntica.
     *
     * @returns {number} Número de regiones libres mantenidas en `recycle`.
     */
    recycleCount() {
        let count = 0;

        for (const [, page] of this.recycle) {
            count += page[0];
        }

        return count;
    }

    /**
     * Devuelve el total de bytes pertenecientes a las regiones almacenadas actualmente
     * en la lista de reciclaje.
     *
     * El valor se calcula sumando la capacidad de cada región libre multiplicada
     * por la cantidad de regiones registradas para dicha capacidad.
     *
     * @returns {number} Número de bytes ocupados por regiones reciclables.
     */
    get recycleBytes() {
        let total = 0;

        for (const [capacity, page] of this.recycle) {
            total += page[0] * capacity;
        }

        return total;
    }

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
    get allocatedBytes() {
        return this.dataPointer - this.recycleBytes;
    }

    /**
     * Devuelve la cantidad de bytes aún no utilizada en la cima del `dataBus`.
     *
     * Dicho espacio corresponde a la región situada entre `dataPointer` y el final de la
     * capacidad reservada actualmente para el búfer.
     *
     * @returns {number} Número de bytes disponibles después de `dataPointer`.
     */
    get unallocatedBytes() {
        return this.size - this.dataPointer;
    }

    /**
     * Devuelve la razón entre la memoria reciclable y el área de montón (heap) utilizada.
     *
     * La métrica considera como fragmentación las regiones libres mantenidas en
     * `recycle` y utiliza `dataPointer` como denominador. Cuando ningún byte
     * ha sido utilizado por el montón, el resultado es cero.
     *
     * El valor no representa la fracción de toda la capacidad del `dataBus`, sino
     * específicamente la proporción de bytes reciclables dentro del área ya
     * recorrida por el puntero bump (bump pointer).
     *
     * @returns {number} Razón de fragmentación en el rango [0, 1] en condiciones
     * normales de operación.
     */
    get fragmentationRatio() {
        if (this.dataPointer === 0) return 0;
        return this.recycleBytes / this.dataPointer;
    }

}