También puedes conseguir esta documentación traducida a otros idiomas:
| Idioma | Enlace |
|---|---|
| Árabe | [API — balloc.ar.md](./docs/API%20—%20balloc.ar.md) |
| Chino | [API — balloc.zh.md](./docs/API%20—%20balloc.zh.md) |
| Español | [API — balloc.es.md](./docs/API%20—%20balloc.es.md) |
| Inglés | [API — balloc.en.md](./docs/API%20—%20balloc.en.md) |
| Japonés | [API — balloc.jp.md](./docs/API%20—%20balloc.jp.md) |
| Portugués | [API — balloc.pt.md](./docs/API%20—%20balloc.pt.md) |

# Balloc.js

`Balloc` es un asignador de memoria basado en **bump allocation**, con dos buses independientes:

- `dataBus`: almacenamiento de los datos de los bloques.
- `controlBus`: almacenamiento de los headers y metadatos.

Los bloques se identifican externamente mediante un **handler lógico de 43 bits**, compuesto por una generación de 11 bits y la dirección de su header en 32 bits. La capacidad física de los bloques siempre es una potencia de dos en número de elementos.

## Ontología de la API

```text
Balloc
├── Instanciación
│   └── constructor()
│
├── Ciclo de vida de los bloques
│   ├── alloc()
│   ├── realloc()
│   ├── free()
│   └── gc()
│
├── Estructuras lineales
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
├── Acceso al contenido
│   ├── has()
│   ├── get()
│   ├── set()
│   ├── clear()
│   ├── fill()
│   ├── fillAll()
│   ├── put()
│   └── pick()
│
├── Capacidad y ocupación
│   ├── byteSize()
│   ├── occupied()
│   └── length()
│
├── Operaciones entre bloques
│   ├── copy()
│   ├── copyWithin()
│   ├── append()
│   ├── clone()
│   └── swap()
│
├── Serialización
│   ├── dump()
│   └── load()
│
├── Diagnóstico y uso
│   ├── recycleCount()
│   ├── recycleBytes
│   ├── allocatedBytes
│   ├── unallocatedBytes
│   └── fragmentationRatio
│
└── Uso interno
    ├── Reciclaje
    │   ├── recyclePush()
    │   └── recyclePop()
    │
    ├── Escalado
    │   ├── grow()
    │   └── headerGrow()
    │
    └── Utilidades
        ├── extractMetadata()
        └── bakeCookie()
```

---

## Semántica de capacidad

La unidad lógica de capacidad depende de `bucketSize`.

```text
bucketSize = "8i"  o bucketSize = "8u"                         → 1 byte por elemento
bucketSize = "16i" o bucketSize = "16u" o bucketSize = "16f"  → 2 bytes por elemento
bucketSize = "32i" o bucketSize = "32u" o bucketSize = "32f"  → 4 bytes por elemento
bucketSize = "64i" o bucketSize = "64u" o bucketSize = "64f"  → 8 bytes por elemento
```

El asignador calcula la capacidad en **elementos** como una potencia de dos y, posteriormente, convierte esa capacidad a bytes.

Por ejemplo, con `bucketSize = "32u"`:

```text
capacity = 8 elementos
wordSize = 4 bytes

byteCapacity = 8 × 4 = 32 bytes
```

La capacidad física y la ocupación son conceptos distintos:

```text
length(handler)    → slots físicos
occupied(handler)  → slots ocupados
byteSize(handler)  → bytes físicos reservados
```

---

# 1. Instanciación

## `new Balloc(size, bucketSize, metadataSize)`

Crea un nuevo asignador.

El almacenamiento se divide entre `dataBus`, destinado a los datos de los bloques, y `controlBus`, destinado a los headers. La capacidad inicial de ambos se redondea según la estrategia interna de crecimiento.

### Parámetros

| Parámetro | Tipo | Predeterminado | Descripción |
|---|---|---:|---|
| `size` | `number` | `65535` | Capacidad inicial de `dataBus`, en bytes. |
| `bucketSize` | `BucketType` | — | Tamaño de cada elemento. |
| `metadataSize` | `number` | `1024` | Capacidad inicial de `controlBus`, en bytes. |

`size` debe ser un entero seguro dentro del intervalo `[2, 0x80000000]`.

`bucketSize` acepta un valor de tipo `BucketType`, una cadena con el formato `[tamaño en bits][tipo de dato]`, y admite únicamente los valores de la tabla siguiente:

| Entero con signo | Entero sin signo | Flotante |
|---|---|---|
| `8i` | `8u` | |
| `16i` | `16u` | `16f` |
| `32i` | `32u` | `32f` |
| `64i` | `64u` | `64f` |

`metadataSize` debe ser un entero seguro dentro del intervalo `[16, 0x80000000]`.

### Excepciones

- `RangeError`: `size` está fuera del intervalo.
- `RangeError`: `bucketSize` no coincide con ninguno de los valores definidos por `BucketType`.
- `RangeError`: `metadataSize` está fuera del intervalo permitido.

### Ejemplo

```js
const { Balloc } = require("Balloc");

const memory = new Balloc();
```

Para utilizar elementos sin signo de 32 bits:

```js
const memory = new Balloc(65535, "32u");
```

El constructor instancia internamente el `TypedArray` correspondiente a `bucketSize`, además de los `DataView` utilizados para leer y escribir.

---

# 2. Ciclo de vida de los bloques

El ciclo fundamental de un bloque es:

```text
alloc()
   │
   ├── operaciones sobre el bloque
   │
   ├── realloc()
   │
   └── free()
          │
          └── reciclaje
```

El reciclaje permite reutilizar regiones liberadas cuya capacidad coincide exactamente con la de la nueva asignación.

## `alloc(size = 16)`

Asigna un bloque nuevo y devuelve su handler.

La capacidad se redondea a la menor potencia de dos que pueda contener `size` elementos. Primero se busca el bloque en la lista de regiones reciclables; si no existe una región compatible, el espacio se obtiene desde la parte superior de `dataBus`.

### Parámetros

| Parámetro | Tipo | Predeterminado | Descripción |
|---|---|---:|---|
| `size` | `number` | `16` | Número mínimo de elementos solicitado. |

`size` debe estar dentro del intervalo `[2, 0x80000000]`.

### Retorno

```text
number
```

Handler del bloque.

El handler tiene la siguiente forma lógica:

```text
[ 11 bits de generación ][ 32 bits de dirección del header ]
```

### Ejemplo

```js
const handler = memory.alloc(100);

memory.push(handler, 42);
```

Una solicitud de 100 elementos no reserva exactamente 100 slots: la capacidad será la siguiente potencia de dos.

---

## `realloc(handler)`

Aumenta la capacidad del bloque hasta la siguiente potencia de dos.

Si el bloque se encuentra en la parte superior actual de `dataBus`, la expansión se realiza **in-place**. En caso contrario, se obtiene una nueva región del sistema de reciclaje o de la parte superior del heap, se copian los elementos ocupados y se recicla la región anterior.

El handler no cambia, ya que su header se conserva.

### Parámetros

| Parámetro | Tipo | Descripción |
|---|---|---|
| `handler` | `number` | Handler del bloque. |

### Retorno

```text
void
```

### Excepciones

- `Error`: handler no válido o corrupto.
- `AggregateError`: la capacidad ya alcanzó el límite máximo.

### Ejemplo

```js
const handler = memory.alloc(8);

memory.realloc(handler);
```

La operación duplica la capacidad física, llevándola a la siguiente potencia de dos.

---

## `free(handler)`

Libera un bloque.

El header se invalida poniendo su cookie a cero. La región de datos se:

- devuelve al sistema de reciclaje cuando no se encuentra en la parte superior de `dataBus`;
- elimina directamente de la parte superior cuando es la región más reciente del heap.

### Parámetros

| Parámetro | Tipo | Descripción |
|---|---|---|
| `handler` | `number` | Handler del bloque. |

### Retorno

```text
void
```

### Excepciones

`Error` cuando el handler no es válido o está corrupto.

```js
memory.free(handler);
```

Un handler liberado deja de ser válido.

---

## `gc()`

Compacta `dataBus` mediante el algoritmo **ReBump**.

La operación recorre los headers existentes en `controlBus`, copia únicamente los bloques que siguen siendo válidos a un nuevo `dataBus` y actualiza sus direcciones en los headers. Se eliminan los espacios libres entre bloques.

### Efectos

- elimina todas las regiones presentes en `recycle`;
- compacta los bloques vivos;
- conserva el orden de los headers;
- conserva la capacidad física de los bloques;
- conserva la ocupación;
- actualiza las direcciones de los bloques;
- reposiciona `dataPointer` después del último bloque vivo.

### Retorno

```text
void
```

### Complejidad

El recorrido de los headers es `O(n)`, donde `n` es el número de headers examinados. El costo total también depende del volumen de datos movidos.

```js
memory.gc();
```

`gc()` no modifica los handlers, ya que los headers permanecen en las mismas direcciones; únicamente se compactan las regiones de datos.

---

# 3. Estructuras lineales

Los bloques pueden utilizarse como estructuras lineales con acceso por los extremos.

## 3.1 Stack

### `push(handler, value)`

Añade `value` al final de la secuencia ocupada.

Si no hay espacio disponible, no se inserta ningún elemento y el método devuelve `false`.

```js
memory.push(handler, 10);
memory.push(handler, 20);
memory.push(handler, 30);
```

Retorno:

```text
boolean
```

- `true`: elemento insertado.
- `false`: bloque lleno.

---

### `pop(handler)`

Elimina y devuelve el último elemento ocupado.

La ocupación se decrementa antes de leer el elemento. Los bytes antiguos no se borran.

Retorno:

```text
number | undefined
```

`undefined` indica que el bloque está vacío.

```js
const value = memory.pop(handler);
```

---

### `peek(handler)`

Devuelve el último elemento ocupado sin eliminarlo.

Retorno:

```text
number | undefined
```

---

## 3.2 Queue

### `nudge(handler, value)`

Inserta un elemento al principio de la secuencia ocupada.

Los elementos existentes se desplazan una posición hacia delante. La operación es proporcional al número de elementos ocupados.

Retorno:

```text
boolean
```

- `true`: elemento insertado.
- `false`: bloque lleno.

---

### `pull(handler)`

Elimina y devuelve el primer elemento.

Los elementos restantes se desplazan una posición hacia el principio.

Retorno:

```text
number | undefined
```

---

### `head(handler)`

Devuelve el primer elemento sin eliminarlo.

Retorno:

```text
number | undefined
```

---

# 4. Acceso al contenido

## `has(handler, value)`

Comprueba si `value` se encuentra entre los elementos ocupados.

La búsqueda utiliza el `TypedArray` auxiliar y considera únicamente `[0, occupied)`, ignorando la capacidad física no ocupada.

```js
if (memory.has(handler, 42)) {
    // ...
}
```

Retorno:

```text
boolean
```

---

## `get(handler, index)`

Obtiene el elemento situado en el índice especificado.

El índice está basado en cero. Los índices fuera de `[0, occupied)` devuelven `undefined`.

```js
const value = memory.get(handler, 3);
```

Retorno:

```text
number | undefined
```

---

## `set(handler, index, value)`

Sustituye el elemento de un índice ocupado.

La ocupación no se modifica.

Los índices fuera de `[0, occupied)` se ignoran y hacen que el método devuelva `false`.

```js
memory.set(handler, 3, 99);
```

Retorno:

```text
boolean
```

- `true`: valor escrito.
- `false`: índice no válido para la región ocupada.

---

## `clear(handler, value = 0)`

Pone la ocupación a cero y rellena **todos los slots físicos** del bloque con `value`.

Esto incluye los slots que no formaban parte de la secuencia ocupada.

```js
memory.clear(handler);
```

Después de la operación:

```text
occupied = 0
```

La capacidad física permanece sin cambios.

---

## `fill(handler, value, start = 0, end = null)`

Rellena un intervalo de slots con `value`.

El intervalo sigue la convención:

```text
[start, end)
```

`start` es inclusivo y `end` es exclusivo. Cuando `end` es `null`, el límite es la capacidad física total. La ocupación pasa a ser `end`.

```js
memory.fill(handler, 0, 2, 6);
```

Rellena los índices:

```text
2, 3, 4, 5
```

### Excepciones

`RangeError` cuando:

- `start < 0`;
- `start > capacity`;
- `end < 0`;
- `end > capacity`;
- `start > end`.

---

## `fillAll(handler, value)`

Rellena todos los slots físicos con `value` y marca toda la capacidad como ocupada.

Equivale a rellenar la capacidad completa y, después, establecer:

```text
occupied = capacity
```

A diferencia de `clear()`, el bloque termina completamente ocupado.

```js
memory.fillAll(handler, 0);
```

---

## `put(handler, data)`

Copia un `Array` o `TypedArray` al inicio del bloque.

La cantidad copiada está limitada por la capacidad del bloque. La ocupación pasa a ser el mayor valor entre la ocupación anterior y la cantidad copiada efectivamente. Por tanto, `put()` no reduce la ocupación existente cuando recibe una secuencia más corta.

```js
memory.put(handler, [10, 20, 30, 40]);
```

También acepta `TypedArray`:

```js
memory.put(handler, new Uint32Array([10, 20, 30]));
```

### Tipos aceptados

```text
Array
TypedArray
```

### Excepciones

`TypeError` cuando `data` no es un `Array` ni un `TypedArray`.

---

## `pick(handler)`

Devuelve una copia de los elementos ocupados actualmente.

El tipo del `TypedArray` devuelto corresponde al `bucketSize` configurado en el asignador. No se incluye la capacidad física no ocupada.

```js
const values = memory.pick(handler);
```

El resultado tiene un almacenamiento independiente de `dataBus`.

Por ejemplo, para un asignador con `bucketSize = "32u"`, el tipo `Uint32Array` almacenará el resultado.

---

# 5. Capacidad y ocupación

## `byteSize(handler)`

Devuelve la capacidad física del bloque en bytes.

No representa la cantidad de bytes ocupados actualmente por los elementos; representa el espacio reservado para todos los slots del bloque.

```js
const bytes = memory.byteSize(handler);
```

---

## `occupied(handler)`

Devuelve el número de elementos ocupados actualmente.

```js
const count = memory.occupied(handler);
```

---

## `length(handler)`

Devuelve el número total de slots físicos disponibles.

La capacidad es independiente de la ocupación:

```text
length >= occupied
```

```js
const capacity = memory.length(handler);
```

---

# 6. Operaciones entre bloques

## `copy(source, destiny, slots = UNKNOWN)`

Copia los elementos ocupados de `source` al inicio de `destiny`.

La cantidad copiada está limitada por:

1. la ocupación de `source`;
2. la capacidad de `destiny`;
3. `slots`.

La ocupación de `destiny` aumenta cuando es necesario, pero su capacidad no cambia.

```js
memory.copy(source, destiny);
```

Límite explícito:

```js
memory.copy(source, destiny, 8);
```

### Retorno

```text
Uint8Array
```

Es el propio `dataBus` después de la operación.

---

## `copyWithin(handler, target, start, length)`

Copia una región dentro del propio bloque.

La semántica sigue el concepto de `Array.prototype.copyWithin()`, pero se aplica a la capacidad física del bloque y está limitada por la ocupación disponible en el origen.

```js
memory.copyWithin(handler, 4, 0, 4);
```

Los índices negativos se interpretan con respecto al final de la capacidad.

La operación:

- admite regiones superpuestas;
- limita los índices a la capacidad;
- limita la lectura a la región ocupada;
- limita la escritura a la capacidad;
- puede aumentar `occupied`.

Retorno:

```text
Uint8Array
```

Es `dataBus`.

---

## `append(target, source)`

Añade los elementos ocupados de `source` al final de los elementos ocupados de `target`.

La cantidad está limitada por la ocupación del origen y por el espacio disponible en el destino.

```js
const count = memory.append(target, source);
```

### Retorno

```text
number
```

Número de elementos añadidos efectivamente.

La operación también admite:

```js
memory.append(handler, handler);
```

cuando `target` y `source` son el mismo bloque.

---

## `clone(handler)`

Crea una copia independiente del bloque.

El clon tiene:

- la misma capacidad física;
- la misma ocupación;
- los mismos bytes en toda la región reservada;
- un handler nuevo.

```js
const copy = memory.clone(handler);
```

También se copia el contenido no ocupado.

---

## `swap(source, target)`

Intercambia las regiones de datos asociadas a dos handlers.

La operación intercambia en los headers:

- dirección;
- capacidad;
- ocupación.

No se copia ningún byte en `dataBus`. Los handlers siguen apuntando a sus respectivos headers.

```js
memory.swap(a, b);
```

Conceptualmente:

```text
antes:

handler A → región A
handler B → región B

después:

handler A → región B
handler B → región A
```

---

# 7. Serialización

Métodos especializados para exportar e importar el estado de los bloques mediante el formato CBOR.

## `dump(handler)`

Serializa el contenido de un bloque de memoria identificado por `handler`.

El método extrae los datos ocupados del bloque y los agrupa con información sobre la capacidad y el tipo de palabra en un contenedor de datos, que después codifica mediante el formato CBOR.

### Retorno

```text
Uint8Array
```

Un búfer que contiene los datos serializados del bloque.

### Excepciones

`Error`: el handler no es válido o está corrupto.

---

## `load(serialized)`

Restaura un bloque de memoria a partir de datos serializados.

Decodifica el contenedor CBOR recibido en `serialized`, valida que el tipo de palabra de los datos serializados sea compatible con la instancia actual del asignador y asigna un bloque nuevo con la capacidad necesaria para alojar el contenido. A continuación, restaura los datos y la ocupación originales en el nuevo bloque.

### Retorno

```text
number
```

Handler del nuevo bloque recreado.

### Excepciones

`Error`: el tipo de palabra de los datos decodificados difiere del configurado en el asignador.

---

# 8. Diagnóstico y uso

## `recycleCount()`

Devuelve el número de regiones almacenadas actualmente en el sistema de reciclaje.

Una región corresponde a un área liberada que no pudo eliminarse directamente desde la parte superior de `dataBus`.

```js
const count = memory.recycleCount();
```

---

## `recycleBytes`

Getter que devuelve el total de bytes pertenecientes a las regiones actualmente reciclables.

```js
const bytes = memory.recycleBytes;
```

El valor se calcula como:

```text
Σ(capacity × cantidad_de_regiones)
```

---

## `allocatedBytes`

Getter que devuelve los bytes asociados a las regiones que no están actualmente en la lista de reciclaje.

Se calcula mediante:

```text
dataPointer - recycleBytes
```

```js
const bytes = memory.allocatedBytes;
```

---

## `unallocatedBytes`

Getter que devuelve el espacio que sigue disponible en la parte superior de `dataBus`.

Es la región comprendida entre `dataPointer` y el final de la capacidad reservada:

```text
size - dataPointer
```

```js
const bytes = memory.unallocatedBytes;
```

---

## `fragmentationRatio`

Getter que calcula la proporción entre los bytes reciclables y el área del heap ya recorrida por el bump pointer.

```text
recycleBytes / dataPointer
```

Cuando `dataPointer` es cero, el resultado es `0`.

El valor mide la fragmentación **dentro del área del heap ya utilizada**, no con respecto a la capacidad total de `dataBus`.

---

# 9. Uso interno

Los métodos de esta sección forman parte de la implementación de `Balloc` y no constituyen la interfaz destinada al código consumidor.

```text
Uso interno
├── Reciclaje
│   ├── recyclePush()
│   └── recyclePop()
│
├── Escalado
│   ├── grow()
│   └── headerGrow()
│
└── Validación / metadatos
    ├── extractMetadata()
    └── bakeCookie()
```

## 9.1 Reciclaje

### `recyclePush(capacity, address)`

**Privado.**

Inserta una región libre en la lista de reciclaje asociada a su capacidad en bytes.

Cada capacidad tiene una página representada por un `Uint32Array`:

```text
[count, address1, address2, ...]
```

La estructura funciona como una pila LIFO. Cuando la página se llena, su búfer se amplía al doble.

---

### `recyclePop(capacity)`

**Privado.**

Elimina y devuelve una región reciclable de capacidad exacta.

La eliminación se realiza desde el final de la página, lo que caracteriza un comportamiento LIFO.

Devuelve:

```text
address
```

o bien:

```js
UNKNOWN // 0xFFFFFFFF
```

cuando no existe una región disponible para esa capacidad.

---

## 9.2 Escalado

### `grow()`

**Privado. No utilizar directamente.**

Duplica la capacidad de `dataBus`.

El `ArrayBuffer` subyacente se transfiere a un búfer mayor y se vuelven a crear las vistas asociadas.

Se activa automáticamente cuando una nueva región no cabe en el espacio restante de `dataBus`.

---

### `headerGrow()`

**Privado. No utilizar directamente.**

Duplica la capacidad de `controlBus`.

Los headers existentes se conservan durante la transferencia del `ArrayBuffer`, y `controlAdapter` se vuelve a crear sobre el nuevo almacenamiento.

Se activa automáticamente cuando no hay espacio para un nuevo header.

---

## 9.3 Validación y metadatos

### `extractMetadata(handler, out)`

**Privado.**

Decodifica y valida un handler.

El método extrae:

```text
generation
headerAddress
dataAddress
capacityExponent
byteCapacity
occupied
```

La validez del handler se comprueba recalculando el cookie almacenado en el header. El objeto `out` es reutilizable, lo que permite evitar nuevas asignaciones.

Firma:

```js
extractMetadata(handler, out)
```

Retorno:

```text
Metadata
```

El retorno es la propia referencia proporcionada en `out`.

---

### `bakeCookie(addr, gen)`

**Privado.**

Calcula el cookie de validación utilizado para comprobar los handlers.

El cookie combina:

- la dirección del header;
- los 11 bits inferiores de la generación.

El resultado se reduce a 8 bits. El valor `0` está reservado para indicar un header no válido, por lo que el método sustituye `0` por `1`.

El cookie no es criptográfico. Su función es detectar handlers no válidos, obsoletos (`stale`) o corruptos dentro del modelo de gestión del asignador.

---

# 10. Modelo de almacenamiento

Cada bloque tiene un header fijo de **16 bytes**:

```text
offset  tamaño  campo
──────  ───────  ─────────────
0       4 bytes  address
4       4 bytes  occupied
8       1 byte   capacity
9       1 byte   cookie
10      6 bytes  reserved
```

Los campos relevantes son:

### `address`

Dirección inicial de la región de datos dentro de `dataBus`.

### `occupied`

Número de elementos ocupados actualmente.

### `capacity`

Exponente de la potencia de dos que representa la capacidad física:

```text
capacityElements = 2 ** capacity
```

La capacidad en bytes es:

```text
capacityBytes = 2 ** capacity × wordSize
```

### `cookie`

Valor de validación asociado a la dirección del header y a la generación del handler.

---

# 11. Handlers

El handler es el identificador externo utilizado por prácticamente todas las operaciones sobre bloques.

Su composición lógica es:

```text
┌───────────────────────┬───────────────────────────────┐
│ generación — 11 bits  │ dirección del header — 32 bits│
└───────────────────────┴───────────────────────────────┘
```

La parte inferior corresponde directamente a la dirección del header; la parte superior representa la generación.

La generación participa en la validación mediante cookie. En consecuencia, un handler no válido o cuyo header haya sido invalidado provoca un error en las operaciones que lo utilizan.

---

# 12. Resumen de la API pública

| Categoría | Método / propiedad | Retorno |
|---|---|---|
| Instanciación | `constructor()` | `Balloc` |
| Ciclo de vida | `alloc()` | `number` |
| Ciclo de vida | `realloc()` | `void` |
| Ciclo de vida | `free()` | `void` |
| Ciclo de vida | `gc()` | `void` |
| Stack | `push()` | `boolean` |
| Stack | `pop()` | `number \| undefined` |
| Stack | `peek()` | `number \| undefined` |
| Queue | `nudge()` | `boolean` |
| Queue | `pull()` | `number \| undefined` |
| Queue | `head()` | `number \| undefined` |
| Acceso | `has()` | `boolean` |
| Acceso | `get()` | `number \| undefined` |
| Acceso | `set()` | `boolean` |
| Acceso | `clear()` | `void` |
| Acceso | `fill()` | `void` |
| Acceso | `fillAll()` | `void` |
| Acceso | `put()` | `void` |
| Acceso | `pick()` | `TypedArray` |
| Capacidad | `byteSize()` | `number` |
| Capacidad | `occupied()` | `number` |
| Capacidad | `length()` | `number` |
| Bloques | `copy()` | `Uint8Array` |
| Bloques | `copyWithin()` | `Uint8Array` |
| Bloques | `append()` | `number` |
| Bloques | `clone()` | `number` |
| Bloques | `swap()` | `void` |
| Serialización | `dump()` | `Uint8Array` |
| Serialización | `load()` | `number` |
| Diagnóstico | `recycleCount()` | `number` |
| Diagnóstico | `recycleBytes` | `number` |
| Diagnóstico | `allocatedBytes` | `number` |
| Diagnóstico | `unallocatedBytes` | `number` |
| Diagnóstico | `fragmentationRatio` | `number` |

## Métodos internos

| Grupo | Método | Visibilidad |
|---|---|---|
| Reciclaje | `recyclePush()` | privado |
| Reciclaje | `recyclePop()` | privado |
| Escalado | `grow()` | privado |
| Escalado | `headerGrow()` | privado |
| Metadatos | `extractMetadata()` | privado |
| Validación | `bakeCookie()` | privado |
