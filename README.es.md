Puedes obtener esta documentación traducida en otros idiomas:

| Idioma | Enlace |
|---|---|
| Árabe | [README.ar.md](README.ar.md) |
| Chino | [README.zh.md](README.zh.md) |
| Español | [README.es.md](README.es.md) |
| Inglés | [README.en.md](README.en.md) |
| Japonés | [README.jp.md](README.jp.md) |
| Portugués | [README.pt.md](README.pt.md) |

# Balloc.js

## Un asignador de memoria de tipo bump allocation para JavaScript.

**`Balloc`** es un asignador de memoria incremental basado en bump allocation, que mantiene bloques de datos contiguos e identificados mediante handlers numéricos compactos.

## Motivación

El ecosistema JavaScript/Node.js históricamente carece de infraestructura de bajo nivel para el procesamiento eficiente de Big Data, como el parsing, edición e indexación continua de grandes volúmenes de CSV, logs y series temporales. La inmensa mayoría de las bibliotecas de datos disponibles utilizan modelos ingenuos basados en grafos de referencias y asignación dinámica de objetos literales (`new Node()`). Estos enfoques imponen limitaciones graves como:

* Sobrecarga de Heap y GC: la proliferación de millones de objetos individuales satura el grafo de referencias de V8, provocando pausas imprevisibles del Garbage Collector.
* Falta de Control de Layout (AoS vs. SoA): muchas bibliotecas ignoran la organización de datos en Array of Structures (AoS) o Structure of Arrays (SoA), resultando en una alta fragmentación y un aprovechamiento deficiente de la caché L1/L2/L3 de la CPU.
* Ausencia de Primitivas para motores de almacenamiento avanzados: la construcción de estructuras como Log-Structured Merge-trees requiere arenas de escritura mutables de altísimo rendimiento y una posterior inmutabilidad compactada, algo inviable sobre las abstracciones normales de JS.

Balloc nace para llenar este vacío de ingeniería. Fue concebido como un motor fundacional de asignación de memoria y gestión de arenas dinámicas de baja abstracción. Al ofrecer control explícito sobre el layout de memoria contigua vía TypedArrays, Balloc proporciona la base física necesaria para que el ecosistema JavaScript pueda soportar estructuras de datos de clase industrial como LSM-Trees, MemTables, Quotient Filters y procesadores de Big Data, equiparando su eficiencia y previsibilidad a los enfoques nativos en C++, Rust o Go.

## Diseño

Como motor de asignación de memoria de baja abstracción y gestor de arenas dinámicas, **`Balloc`** fue diseñado para integrarse al runtime de JavaScript sin competir con las estructuras de datos nativas de alto nivel (como `Object`, `Map` o `Array`), sino operando en la capa inmediatamente inferior, proporcionando una **gestión de memoria contigua, determinística y de alto rendimiento** sin sobrecargar el *Garbage Collector* del entorno.

El asignador combina tres mecanismos:

```text
                  ┌─────────────────┐
                  │     Balloc      │
                  └────────┬────────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
          ▼                ▼                ▼
     Bump allocation   Recycling       Compaction
          │                │                │
     Asignación rápida Reuso de regiones ReBump / gc()
       secuencial      liberadas
```

* El bump allocator provee asignación secuencial sobre el `dataBus`.
* El sistema de reciclaje permite que regiones previamente liberadas sean reutilizadas cuando su capacidad corresponda a una nueva asignación.
* El `gc()` realiza la compactación explícita cuando el *heap* contiene regiones libres fragmentadas.

Esto proporciona al asignador un modelo de memoria simple, manteniendo al mismo tiempo un control explícito sobre la capacidad, ocupación, reciclaje y compactación, ya que `Balloc` separa el bloque de datos del bloque de metadatos.

```text
                    Balloc
                       │
             ┌─────────┴─────────┐
             │                   │
          dataBus            controlBus
             │                   │
         contenido             headers
```

* El `dataBus` contiene el conjunto de bloques de datos.
* El `controlBus` contiene el conjunto de headers de tamaño fijo, que son los descriptores de los bloques de datos.

Cada bloque se identifica externamente por un handler lógico de 43 bits:

```text
┌───────────────────────┬───────────────────────────────┐
│ generación — 11 bits  │ dirección del header — 32 bits │
└───────────────────────┴───────────────────────────────┘
```

El handler por sí mismo no contiene la dirección directa del bloque de datos. Identifica el encabezado del bloque, el cual a su vez contiene la dirección de los datos, la capacidad y la ocupación del bloque.

La generación es utilizada por el mecanismo de validación de *cookie* del asignador para detectar handlers inválidos, obsoletos o corruptos.

## Instalación

En Node.js instale el siguiente paquete NPM:

```bash
npm install Balloc
```

En Bun instale:

```bash
bun add Balloc
```

En Deno instale:

```bash
deno add npm:Balloc
```

Usando Yarn:

```bash
yarn add Balloc
```

En HTML use el CDN unpkg:

```text
[https://unpkg.com/Balloc](https://unpkg.com/Balloc)
```

O sus versiones con docstrings localizadas:

```
Árabe:    [https://unpkg.com/Balloc/src/ar/Balloc.mjs](https://unpkg.com/Balloc/src/ar/Balloc.mjs)
Inglés:   [https://unpkg.com/Balloc/src/en/Balloc.mjs](https://unpkg.com/Balloc/src/en/Balloc.mjs)
Español: [https://unpkg.com/Balloc/src/es/Balloc.mjs](https://unpkg.com/Balloc/src/es/Balloc.mjs)
Japonés:  [https://unpkg.com/Balloc/src/jp/Balloc.mjs](https://unpkg.com/Balloc/src/jp/Balloc.mjs)
Chino:   [https://unpkg.com/Balloc/src/zh/Balloc.mjs](https://unpkg.com/Balloc/src/zh/Balloc.mjs)
```

O utilice el CDN jsDelivr:

```text
[https://cdn.jsdelivr.net/npm/Balloc](https://cdn.jsdelivr.net/npm/Balloc)
```

CDNs con soporte de localización:

```
Árabe:    [https://cdn.jsdelivr.net/npm/Balloc/src/ar/Balloc.mjs](https://cdn.jsdelivr.net/npm/Balloc/src/ar/Balloc.mjs)
Inglés:   [https://cdn.jsdelivr.net/npm/Balloc/src/en/Balloc.mjs](https://cdn.jsdelivr.net/npm/Balloc/src/en/Balloc.mjs)
Español: [https://cdn.jsdelivr.net/npm/Balloc/src/es/Balloc.mjs](https://cdn.jsdelivr.net/npm/Balloc/src/es/Balloc.mjs)
Japonés:  [https://cdn.jsdelivr.net/npm/Balloc/src/jp/Balloc.mjs](https://cdn.jsdelivr.net/npm/Balloc/src/jp/Balloc.mjs)
Chino:   [https://cdn.jsdelivr.net/npm/Balloc/src/zh/Balloc.mjs](https://cdn.jsdelivr.net/npm/Balloc/src/zh/Balloc.mjs)
```

## Uso básico

ESM:

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

CJS:

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

## Primeros pasos

El constructor es:

```js
new Balloc(size, bucketSize, metadataSize)
```

| Parámetro | Tipo | Default | Descripción |
| --- | --- | --- | --- |
| `size` | `number` | `65535` | Capacidad inicial del `dataBus` en bytes |
| `bucketSize` | `BucketType` | `32u` | Tamaño de un elemento en bits |
| `metadataSize` | `number` | `1024` | Capacidad inicial del `controlBus` en bytes |

Ejemplo:

```js
const memory = new Balloc();
```

Para enteros unsigned de 32 bits:

```js
const memory = new Balloc(65535, "32u");
```

`size` debe ser un entero en el rango `[2, 0x80000000]`.

`bucketSize` debe ser un `BucketType`, que es un string en formato `[Tamaño en bits][tipo de dato]` con los siguientes valores aceptados:

| Signed Integer | Unsigned Integer | Float |
| --- | --- | --- |
| `8i` | `8u` |  |
| `16i` | `16u` |  |
| `32i` | `32u` | `32f` |
| `64i` | `64u` | `64f` |

*El tipo de media precisión (`16f`), al ser una adición reciente en fase de consolidación en las especificaciones y runtimes de JavaScript, aún no tiene soporte garantizado en Balloc; aunque el tipo esté presente en la biblioteca, su disponibilidad de uso puede ser incierta en su proyecto.*

`metadataSize` debe ser un entero en el rango `[16, 0x80000000]`.

El tamaño de asignación de un bloque se redondea a la menor potencia de dos capaz de alojar el número de elementos solicitados.

Por ejemplo:

```js
const handler = memory.alloc(100);
```

no crea necesariamente un bloque con exactamente 100 slots físicos. El asignador reserva una capacidad que sea una potencia de dos.

Conceptualmente:

```text
solicitados: 100 elementos
capacidad:   128 elementos
```

La capacidad física y la ocupación lógica son distintas:

```text
length(handler)     → capacidad física
occupied(handler)   → elementos ocupados
byteSize(handler)   → bytes físicos reservados
```

Esta distinción permite que un bloque contenga menos elementos ocupados que su capacidad física.

## API

El ciclo de vida fundamental de un bloque es:

```text
alloc()
   │
   ├── acceso / modificación
   │
   ├── realloc()
   │
   └── free()
          │
          └── recycle
```

Balloc ofrece varios modelos de visión de datos sobre un bloque:

* Pila (Stack)
* Cola (Queue)
* Array / Acceso Aleatorio

La documentación completa de la API está disponible en la carpeta [`./docs`](./docs) y puede encontrarse traducida en varios idiomas:

| Idioma | Enlace |
|---|---|
| Árabe | [./docs/API — balloc.ar.md](./docs/API%20—%20balloc.ar.md) |
| Chino | [./docs/API — balloc.zh.md](./docs/API%20—%20balloc.zh.md) |
| Español | [./docs/API — balloc.es.md](./docs/API%20—%20balloc.es.md) |
| Inglés | [./docs/API — balloc.en.md](./docs/API%20—%20balloc.en.md) |
| Japonés | [./docs/API — balloc.ja.md](./docs/API%20—%20balloc.ja.md) |
| Portugués | [./docs/API — balloc.pt.md](./docs/API%20—%20balloc.pt.md) |

Los métodos de la API están agrupados por afinidad:

* Ciclo de vida
* Operaciones sobre pilas
* Operaciones sobre colas
* Operaciones sobre arrays
* Intercambio entre bloques
* Serialización
* Diagnósticos
* Funciones internas

A continuación, un resumen de estos grupos:

### Ciclo de vida

| API | Descripción |
| --- | --- |
| `alloc()` | Asignar un bloque |
| `realloc()` | Aumentar la capacidad del bloque |
| `free()` | Liberar un bloque |
| `gc()` | Compactar el heap de datos |

### Operaciones sobre pilas

| API | Descripción |
| --- | --- |
| `push()` | Añadir un elemento |
| `pop()` | Eliminar el último elemento |
| `peek()` | Leer el último elemento |

### Operaciones sobre colas

| API | Descripción |
| --- | --- |
| `nudge()` | Insertar al inicio |
| `pull()` | Eliminar el primer elemento |
| `head()` | Leer el primer elemento |

### Operaciones sobre arrays

| API | Descripción |
| --- | --- |
| `has()` | Buscar un valor |
| `get()` | Leer un elemento |
| `set()` | Escribir un elemento |
| `clear()` | Limpiar la ocupación y resetear el bloque |
| `fill()` | Rellenar un intervalo |
| `fillAll()` | Rellenar y ocupar todo el bloque |
| `put()` | Copiar un array a un bloque |
| `pick()` | Copiar elementos ocupados fuera de un bloque |

### Intercambio entre bloques

| API | Descripción |
| --- | --- |
| `copy()` | Copiar entre bloques |
| `copyWithin()` | Copiar dentro de un bloque |
| `append()` | Anexar un bloque a otro |
| `clone()` | Crear una copia independiente del bloque |
| `swap()` | Intercambiar regiones de bloques |

### Serialización

| API | Descripción |
| --- | --- |
| `dump()` | Serializar el contenido del bloque en CBOR |
| `load()` | Restaurar un bloque a partir de datos serializados |

### Diagnósticos

| API | Descripción |
| --- | --- |
| `byteSize()` | Tamaño físico del bloque en bytes |
| `occupied()` | Recuento de elementos ocupados |
| `length()` | Capacidad física de elementos |
| `recycleCount()` | Número de regiones reciclables |
| `recycleBytes` | Bytes actualmente reciclables |
| `allocatedBytes` | Bytes asociados a regiones no recicladas |
| `unallocatedBytes` | Espacio restante tras el puntero de bump |
| `fragmentationRatio` | Bytes reciclados / área de heap usada |

### Funciones internas

Son un caso especial de API utilizada primariamente dentro del propio asignador y normalmente no se recomiendan para el uso diario, ya que pueden causar efectos secundarios no documentados. Su uso está destinado a extensiones y modificaciones de la biblioteca donde sea fundamental la comprensión total del código fuente de Balloc.

```text
Recirculation
├── recyclePush()
└── recyclePop()

Growth
├── grow()
└── headerGrow()

Validation / metadata
├── extractMetadata()
└── bakeCookie()
```

`recyclePush()` inserta un bloque libre en la lista de reciclaje.

`recyclePop()` elimina un bloque libre de la lista de reciclaje y lo retorna.

`grow()` expande el `dataBus` cuando la región actual no puede satisfacer más asignaciones.

`headerGrow()` expande el `controlBus` cuando se requieren headers adicionales.

`extractMetadata()` decodifica y valida un handler y extrae sus metadatos asociados.

`bakeCookie()` calcula un cookie de validación usado por el mecanismo de validación de handlers.

## 💖 Donaciones / Apoyo

Si te gusta este proyecto y quieres apoyar su desarrollo:

| QR Code Pix | Clave Copia y Pega / Aleatoria |
| :---: | :--- |
| ![Pix QR Code](./img/pix.png) | **Clave Aleatoria:**<br>`e87d773a-0b97-4410-8fc3-f7ec04cce6a2` |

## Licencia

[MIT](./LICENSE)