import { encode, decode } from 'cbor-x';

/**
 * Indicador que representa un valor inválido o desconocido.
 */
const UNKNOWN = 0xFFFFFFFF >>> 0;

/**
 * Tamaños y tipos de bucket válidos. 
 * Solo se admiten tamaños de 8, 16, 32 y 64 bits para tipos enteros y 
 * solo se admiten tamaños de 16, 32 y 64 bits para flotantes.
 * Tipos de datos admitidos:
 * u = entero sin signo
 * i = entero con signo
 * f = flotante
 * 
 * Sintaxis del identificador de bucket:
 * 
 * [Tamaño en bits][tipo de dato]
 * 
 * Ejemplos:
 * Un bucket de enteros sin signo de 32 bits: 32u
 * Un bucket de enteros con signo de 64 bits: 64i
 * 
 */
const BUCKET_MAPPING = Object.freeze({
    "8u":  { type: "Uint8",  bits: 8 },
    "16u": { type: "Uint16",  bits: 16 },
    "32u": { type: "Uint32",  bits: 32 },
    "64u": { type: "BigUint64",  bits: 64 },
    "8i":  { type: "Int8",   bits: 8 },
    "16i": { type: "Int16",   bits: 16 },
    "32i": { type: "Int32",   bits: 32 },
    "64i": { type: "BigInt64",   bits: 64 },
    "16f": { type: "Float16", bits: 16 },
    "32f": { type: "Float32", bits: 32 },
    "64f": { type: "Float64", bits: 64 }
});

/**
 * Tipos de bucket admitidos por el asignador:
 * - Enteros sin signo: '8u', '16u', '32u', '64u'
 * - Enteros con signo: '8i', '16i', '32i', '64i'
 * - Punto flotante: '16f', '32f', '64f'
 *
 * @typedef {'8u'|'16u'|'32u'|'64u'|'8i'|'16i'|'32i'|'64i'|'16f'|'32f'|'64f'} BucketType
 */

/**
 * Indicador de ordenamiento de bytes (endianness) del sistema.
 *
 * Detecta si el sistema es Little Endian, lo cual afecta
 * el orden de los bytes en las operaciones de DataView.
 */
const IS_LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;


/**
 * Formato de los metadatos.
 *  0               4                8               9             10              
 *  [32bits address][32bits occupied][8bits capacity][8bits cookie][48bits reserved]
 * 
 * Total: 4 + 4 + 1 + 1 + 6 = 16 bytes
 */
const HEADER_SIZE = 16 >>> 0;

const ADDRESS_OFFSET  = 0 >>> 0;
const OCCUPIED_OFFSET = 4 >>> 0;
const CAPACITY_OFFSET = 8 >>> 0;
const COOKIE_OFFSET   = 9 >>> 0;


const ROTATE_32BITS = 4294967296;
const CLAMP_11BITS = 0x7FF >>> 0;

/**
 * Estructura que contiene los metadatos codificados dentro de un identificador.
 * 
 * @typedef {Object} Metadata
 * @property {number} byteCapacity - Capacidad del bloque de memoria en bytes.
 * @property {number} capacityExponent - Capacidad del bloque de memoria expresada como exponente de base dos.
 * @property {number} dataAddress - Dirección del bloque de memoria dentro del dataBus.
 * @property {number} generation - Generación a la que pertenece el identificador.
 * @property {number} headerAddress - Dirección de la cabecera dentro del controlBus.
 * @property {number} occupied - Número de elementos ocupados en el bloque.
 */

/**
 * Comprueba si un valor es una instancia de TypedArray.
 * 
 * @param {any} val - Valor a comprobar.
 * @returns {boolean} `true` si el valor es un TypedArray, de lo contrario `false`.
 */
const isTypedArray = (val) => ArrayBuffer.isView(val) && !(val instanceof DataView);

/**
 * Asignador de tipo Bump de doble bus con pila Echo y GC ReBump.
 */
export default class Balloc {

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
        this.size = Math.max(1 << (32 - Math.clz32(size)) >>> 0, this.wordSize);
        this.headerSize = 1 << (32 - Math.clz32(metadataSize)) >>> 0;
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

    // ========== ASIGNACIÓN ==========

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
            this.controlPointer+= HEADER_SIZE;
            this.echoPointer+= HEADER_SIZE;
        }

        this.controlAdapter.setUint32(headerAddress + ADDRESS_OFFSET, dataAddress, IS_LITTLE_ENDIAN);
        this.controlAdapter.setUint32(headerAddress + OCCUPIED_OFFSET, 0, IS_LITTLE_ENDIAN);
        this.controlAdapter.setUint8(headerAddress + CAPACITY_OFFSET, capacity);
        this.controlAdapter.setUint8(headerAddress + COOKIE_OFFSET, this.bakeCookie(headerAddress, ++this.generation));

        return (this.generation & CLAMP_11BITS) * ROTATE_32BITS + headerAddress;
    }

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
    realloc(handler) {
        const generation = (handler / ROTATE_32BITS) & CLAMP_11BITS;
        let headerAddress = handler >>> 0;

        const dataAddress = this.controlAdapter.getUint32(headerAddress + ADDRESS_OFFSET, IS_LITTLE_ENDIAN);
        const occupied = this.controlAdapter.getUint32(headerAddress + OCCUPIED_OFFSET, IS_LITTLE_ENDIAN);
        const capacity = this.controlAdapter.getUint8(headerAddress + CAPACITY_OFFSET);
        const cookie = this.controlAdapter.getUint8(headerAddress + COOKIE_OFFSET);


        if (cookie !== this.bakeCookie(headerAddress, generation)) {
            throw new Error("Invalid or corrupted handle");
        }

        if (capacity >= 31) throw new AggregateError([new Error("Can´t reallocate handler.") ,new RangeError("Capacity has reached its limit.")], "Internal Error.");

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
    free(handler) {
        const generation = (handler / ROTATE_32BITS) & CLAMP_11BITS;
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

    // ========== RECICLAJE ==========

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
     * página correspondiente, la última dirección registrada se elimina de la
     * página y se devuelve, implementando el reciclaje como una pila LIFO.
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

    // ========== RECOLECCIÓN DE BASURA ==========
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
    gc() {
        const newDataBus = new Uint8Array(this.dataBus.buffer.byteLength);
        this.recycle.clear();
        this.dataPointer = 0 >>> 0;
        for (let i = 0; i < this.controlPointer; i+= HEADER_SIZE) {
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

    // ========== ESCALADO ==========
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
    grow() {
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
    headerGrow() {
        if (this.controlBus.byteLength > 0x80000000) throw new RangeError("Control bus capacity exceeded");
        const newSize = (this.controlBus.byteLength * 2) >>> 0;
        const newBuffer = this.controlBus.buffer.transfer(newSize);

        this.controlBus = new Uint8Array(newBuffer);
        this.controlAdapter = new DataView(newBuffer);
    }

    // ========== OPERACIONES DE PILA ==========

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
    push(handler, value) {

        const meta = this.extractMetadata(handler, this.metadata);

        if ((meta.occupied + 1) * this.wordSize > meta.byteCapacity) return false;

        this.writer(meta.dataAddress + meta.occupied * this.wordSize , value, IS_LITTLE_ENDIAN);
        this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, meta.occupied + 1,IS_LITTLE_ENDIAN);

        return true;
    }

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
    pop(handler) {
        const meta = this.extractMetadata(handler, this.metadata);

        if (meta.occupied === 0) return undefined;

        this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, meta.occupied - 1,IS_LITTLE_ENDIAN);
        return this.reader(meta.dataAddress + (meta.occupied - 1) * this.wordSize, IS_LITTLE_ENDIAN);
    }

    /**
     * Devuelve el último elemento ocupado sin eliminarlo.
     *
     * @param {number} handler - Identificador del bloque.
     * @returns {number|undefined} Último valor ocupado o `undefined` si el
     * bloque está vacío.
     * @throws {Error} Si el identificador es inválido o está corrupto.
     */
    peek(handler) {
        const meta = this.extractMetadata(handler, this.metadata);

        if (meta.occupied === 0) return undefined;

        return this.reader(meta.dataAddress + (meta.occupied - 1) * this.wordSize, IS_LITTLE_ENDIAN);
    }

    // ========== OPERACIONES DE COLA ==========

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
    nudge(handler, value) {
        const meta = this.extractMetadata(handler, this.metadata);

        if ((meta.occupied + 1) * this.wordSize > meta.byteCapacity) return false;

        this.dataBus.copyWithin(meta.dataAddress + this.wordSize, meta.dataAddress, meta.dataAddress + meta.occupied * this.wordSize);
        this.writer(meta.dataAddress, value, IS_LITTLE_ENDIAN);
        this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, meta.occupied + 1,IS_LITTLE_ENDIAN);

        return true;
    }

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
    pull(handler) {
        const meta = this.extractMetadata(handler, this.metadata);

        if (meta.occupied === 0) return undefined;

        const result = this.reader(meta.dataAddress, IS_LITTLE_ENDIAN);
        this.dataBus.copyWithin(meta.dataAddress, meta.dataAddress + this.wordSize, meta.dataAddress + meta.occupied * this.wordSize);
        this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, meta.occupied - 1, IS_LITTLE_ENDIAN);
        return result;
    }

    /**
     * Devuelve el primer elemento ocupado sin eliminarlo.
     *
     * @param {number} handler - Identificador del bloque.
     * @returns {number|undefined} Primer valor ocupado o `undefined` si el
     * bloque está vacío.
     * @throws {Error} Si el identificador es inválido o está corrupto.
     */
    head(handler) {
        const meta = this.extractMetadata(handler, this.metadata);

        if (meta.occupied === 0) return undefined;

        return this.reader(meta.dataAddress, IS_LITTLE_ENDIAN);    
    }

    // ========== ACCESO ALEATORIO ==========

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
    has(handler, value) {
        const meta = this.extractMetadata(handler, this.metadata);

        if (meta.occupied === 0) return false;

        const rawAddres = meta.dataAddress >>> this.wordShift;

        return this.auxiliary.subarray(rawAddres, rawAddres + meta.occupied).includes(value);
    }

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
    get(handler, index) {

        const meta = this.extractMetadata(handler, this.metadata);

        if (index < 0 || index >= meta.occupied) return undefined;

        return this.reader(meta.dataAddress + index * this.wordSize, IS_LITTLE_ENDIAN);
    }

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
    set(handler, index, value) {
        const meta = this.extractMetadata(handler, this.metadata);

        if (index < 0 || index >= meta.occupied) return false;

        this.writer(meta.dataAddress + index * this.wordSize, value, IS_LITTLE_ENDIAN);
        return true;
    }

    // ============= MISCELÁNEA ===============

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
    clear(handler, value=0) {
        const meta = this.extractMetadata(handler, this.metadata);

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
    fillAll(handler, value) {
        const meta = this.extractMetadata(handler, this.metadata);
        
        const rawAddress = meta.dataAddress >>> this.wordShift;
        const capacityElements = meta.byteCapacity / this.wordSize;

        this.auxiliary.fill(value, rawAddress, rawAddress + capacityElements);
        this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, capacityElements, IS_LITTLE_ENDIAN);
    }

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
            const actual = data?.constructor?.name ?? (data === null ? 'null' : typeof data);
            throw new TypeError(`data must be Array or TypedArray, but ${actual} was given.`);
        }    
        this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, meta.occupied, IS_LITTLE_ENDIAN);
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
     * @param {number} handler - Identificador del bloque.
     * @returns {TypedArray} Copia de los elementos ocupados por el bloque. Cuando
     * el bloque está vacío, devuelve un `TypedArray` vacío del tipo configurado.
     * @throws {Error} Si el identificador es inválido o está corrupto.
     */
    pick(handler) {
        const meta = this.extractMetadata(handler, this.metadata);

        const rawAddress = meta.dataAddress >>> this.wordShift;

        if (meta.occupied === 0) {
            return this.auxiliary.slice(rawAddress, rawAddress); 
        }        

        return this.auxiliary.slice(rawAddress, rawAddress + meta.occupied);
    }

    // ======== CAPACIDAD EN RANURAS ==========

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
    byteSize(handler) {
        const meta = this.extractMetadata(handler, this.metadata);
        return meta.byteCapacity;
    }

    /**
     * Devuelve la cantidad de elementos ocupados actualmente en el bloque.
     *
     * @param {number} handler - Identificador del bloque.
     * @returns {number} Número de elementos ocupados.
     * @throws {Error} Si el identificador es inválido o está corrupto.
     */
    occupied(handler){
        const meta = this.extractMetadata(handler, this.metadata);
        return meta.occupied;

    }

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
    length(handler) {
        const meta = this.extractMetadata(handler, this.metadata);
        return 1 << meta.capacityExponent >>> 0;
    }

    // ========== Operaciones entre bloques=============

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
    copy(source, destiny, slots = UNKNOWN){
        /** @type {Metadata} */
        const metaA = {};
        /** @type {Metadata} */
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
    copyWithin(handler, target, start, length) {
        const meta = this.extractMetadata(handler, this.metadata);
        const slots = Math.floor(meta.byteCapacity / this.wordSize);

        target = Math.trunc(target);
        start = Math.trunc(start);
        length = Math.trunc(length);

        if (target < 0) target += slots;
        if (start < 0) start += slots;

        // Limita los índices dentro de los límites de capacidad
        target = Math.max(0, Math.min(target, slots));
        start = Math.max(0, Math.min(start, slots));

        // Limita la copia al espacio disponible a partir de target 
        // y a los elementos ocupados efectivamente a partir de start
        const maxRead = Math.max(0, meta.occupied - start);
        const maxWrite = slots - target;
        length = Math.max(0, Math.min(length, maxRead, maxWrite));

        if (length === 0) return this.dataBus;

        const targetAddress = meta.dataAddress + target * this.wordSize;
        const sourceAddress = meta.dataAddress + start * this.wordSize;

        // Actualiza la ocupación en caso de que la copia expanda la parte superior ocupada del bloque
        const newOccupied = Math.max(meta.occupied, target + length);
        this.controlAdapter.setUint32(meta.headerAddress + OCCUPIED_OFFSET, newOccupied, IS_LITTLE_ENDIAN);

        return this.dataBus.copyWithin(targetAddress, sourceAddress, sourceAddress + length * this.wordSize);
    }

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
            this.dataBus.copyWithin(targetAddress, sourceAddress,  sourceAddress + count * this.wordSize);
        } else {
            this.dataBus.copyWithin(targetAddress, sourceAddress, sourceAddress + count * this.wordSize);
        }

        this.controlAdapter.setUint32(metaTarget.headerAddress + OCCUPIED_OFFSET, metaTarget.occupied + count, IS_LITTLE_ENDIAN);

        return count;
    }

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
    swap(source, target) {
        /** @type {Metadata} */
        const metaA = {};
        /** @type {Metadata} */
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


    // ============= SERIALIZACIÓN ==============

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
     * @param {Uint8Array|ArrayBuffer} serialized - Búster que contiene los datos serializados.
     * @returns {number} Identificador del nuevo bloque recreado.
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

    // ============= UTILIDADES ==============

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
    extractMetadata(handler, out) {
        out.generation = (handler / ROTATE_32BITS) & CLAMP_11BITS;
        out.headerAddress = handler >>> 0;

        const cookie = this.controlAdapter.getUint8(out.headerAddress + COOKIE_OFFSET);


        if (cookie !== this.bakeCookie(out.headerAddress, out.generation)) {
            throw new Error("Invalid or corrupted handle");
        }

        out.dataAddress = this.controlAdapter.getUint32(out.headerAddress + ADDRESS_OFFSET, IS_LITTLE_ENDIAN);
        out.capacityExponent  = this.controlAdapter.getUint8(out.headerAddress + CAPACITY_OFFSET);
        out.byteCapacity = (1 << out.capacityExponent >>> 0) * this.wordSize;
        out.occupied = this.controlAdapter.getUint32(out.headerAddress + OCCUPIED_OFFSET, IS_LITTLE_ENDIAN);

        return out;
    }


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
    bakeCookie(addr, gen) {
        return (addr ^ (gen & 0x7FF * 0x9e3779b1)) & 0xff || 1;
    }

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
    recycleCount() {
        let count = 0;

        for (const [, page] of this.recycle) {
            count += page[0];
        }

        return count;
    }

    /**
     * Devuelve el total de bytes pertenecientes a las regiones almacenadas
     * actualmente en la lista de reciclaje.
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
     * Devuelve la cantidad de bytes que aún no se han utilizado en la parte superior del `dataBus`.
     *
     * Este espacio corresponde a la región comprendida entre `dataPointer` y el final de la
     * capacidad reservada actualmente para el búster.
     *
     * @returns {number} Número de bytes disponibles después de `dataPointer`.
     */
    get unallocatedBytes() {
        return this.size - this.dataPointer;
    }

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
    get fragmentationRatio() {
        if (this.dataPointer === 0) return 0;
        return this.recycleBytes / this.dataPointer;
    }

}