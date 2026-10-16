Você também pode conseguir essa documentação traduzida em outras linguagens:
| Idioma | Link |
|---|---|
| Árabe | [README.ar.md](README.ar.md) |
| Chinês | [README.zh.md](README.zh.md) |
| Espanhol | [README.es.md](README.es.md) |
| Inglês | [README.en.md](README.en.md) |
| Japonês | [README.jp.md](README.jp.md) |
| Português | [README.pt.md](README.pt.md) |

# Balloc.js

## Um alocador de memória do tipo bump allocation para JavaScript.

**`Balloc`** é um alocador de memória incremental baseado em bump allocation, que mantém blocos de dados contíguos e identificados por meio de handlers numéricos compactos.

## Motivação

O ecossistema JavaScript/Node.js historicamente carece de infraestrutura de baixo nível para processamento eficiente de Big Data como parsing, edição e indexação contínua de grandes volumes de CSV, logs e séries temporais, e a imensa maioria das bibliotecas de dados disponíveis no ecossistema utiliza modelos ingênuos baseados em grafos de referências e alocação dinâmica de objetos literais (`new Node()`). Essas abordagens impõem limitações graves como:   
* Sobrecarga de Heap e GC pois a proliferação de milhões de objetos individuais satura o grafo de referências do V8, causando pausas imprevisíveis do Garbage Collector. 
* Falta de Controle de Layout (AoS vs. SoA) onde bibliotecas ignoram a organização de dados em Array of Structures (AoS) ou Structure of Arrays (SoA), resultando em alta fragmentação e péssimo aproveitamento do cache L1/L2/L3 da CPU.
* Ausência de Primitivas para a construção de motores de armazenamento avançados, como Log-Structured Merge-trees, exige arenas de escrita mutáveis de altíssimo rendimento e subsequente imutabilidade compactada, algo inviável sobre abstrações normais do JS.

O Balloc nasce para preencher essa lacuna de engenharia. Ele foi concebido como um motor fundacional de alocação de memória e gerenciamento de arenas dinâmicas de baixa abstração. Ao oferecer controle explícito sobre o layout de memória contígua via TypedArrays, o Balloc fornece a base física necessária para que o ecossistema JavaScript possa sustentar estruturas de dados de classe industrial como LSM-Trees, MemTables, Quotient Filters e processadores de Big Data, equiparando-se em eficiência e previsibilidade às abordagens nativas em C++, Rust ou Go.   


## Design

Como é um motor de alocação de memória de baixa abstração e gerenciador de arenas dinâmicas, **`Balloc`** foi projetado para se encaixar ao runtime JavaScript não competindo com as estruturas de dados nativas de alto nível do JavaScript (como `Object`, `Map` ou `Array`), mas operando na camada imediatamente inferior fornecendo **gerenciamento de memória contígua, determinística e de alta performance** sem sobrecarregar o *Garbage Collector* do ambiente.

O alocador combina três mecanismos:

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
     Alocação rápida Reuso de regiões ReBump / gc()
       sequencial      liberadas

```

* O bump allocator provê alocação sequencial em cima do `dataBus`.
* O sistema de reciclagem permite que regiões previamente liberadas sejam reutilizadas quando sua capacidade corresponder a uma nova alocação.
* O `gc()` realiza a compactação explícita quando o *heap* contém regiões livres fragmentadas.

Isso proporciona ao alocador um modelo de memória simples mantendo ao mesmo tempo controle explícito sobre capacidade, ocupação, reciclagem e compactação pois `Balloc` separa o bloco de dados do bloco de metadados.

```text
                    Balloc
                       │
             ┌─────────┴─────────┐
             │                   │
          dataBus            controlBus
             │                   │
         conteúdo             headers

```

* O `dataBus` contém o conjunto dos blocos de dados.


* O `controlBus` contém o conjunto de headers de tamanho fixo que são os descritores dos blocos de dados.

Cada bloco é identificado externamente por um handler lógico de 43 bits:

```text
┌───────────────────────┬───────────────────────────────┐
│ geração — 11 bits     │ endereço do header — 32 bits  │
└───────────────────────┴───────────────────────────────┘

```

O handler por si não contém diretamente o endereço do bloco de dados. Ele identifica o cabeçalho do bloco que por sua vez contém o endereço dos dados, a capacidade e a ocupação do bloco.

A geração é utilizada pelo mecanismo de validação de *cookie* do alocador para detectar handlers inválidos, obsoletos ou corrompidos.

## Instalação

No Node.js instale o seguinte pacote NPM:

```bash
npm install Balloc

```

No Bun instale:

```bash
bun add Balloc

```

No Deno instale:

```bash
deno add npm:Balloc

```

Usando Yarn:

```bash
yarn add Balloc

```

Em HTML use CDN unpkg:

```text
[https://unpkg.com/Balloc](https://unpkg.com/Balloc)

```

Ou suas versões com docstring localizadas para algumas línguas:

```
Árabe:    [https://unpkg.com/Balloc/src/ar/Balloc.mjs](https://unpkg.com/Balloc/src/ar/Balloc.mjs)
Inglês:   [https://unpkg.com/Balloc/src/en/Balloc.mjs](https://unpkg.com/Balloc/src/en/Balloc.mjs)
Espanhol: [https://unpkg.com/Balloc/src/es/Balloc.mjs](https://unpkg.com/Balloc/src/es/Balloc.mjs)
Japonês:  [https://unpkg.com/Balloc/src/jp/Balloc.mjs](https://unpkg.com/Balloc/src/jp/Balloc.mjs)
Chinês:   [https://unpkg.com/Balloc/src/zh/Balloc.mjs](https://unpkg.com/Balloc/src/zh/Balloc.mjs)

```

Ou ainda utilize o CDN jsDelivr:

```text
[https://cdn.jsdelivr.net/npm/Balloc](https://cdn.jsdelivr.net/npm/Balloc)

```

CDNs com suporte a localização:

```
Árabe:    [https://cdn.jsdelivr.net/npm/Balloc/src/ar/Balloc.mjs](https://cdn.jsdelivr.net/npm/Balloc/src/ar/Balloc.mjs)
Inglês:   [https://cdn.jsdelivr.net/npm/Balloc/src/en/Balloc.mjs](https://cdn.jsdelivr.net/npm/Balloc/src/en/Balloc.mjs)
Espanhol: [https://cdn.jsdelivr.net/npm/Balloc/src/es/Balloc.mjs](https://cdn.jsdelivr.net/npm/Balloc/src/es/Balloc.mjs)
Japonês:  [https://cdn.jsdelivr.net/npm/Balloc/src/jp/Balloc.mjs](https://cdn.jsdelivr.net/npm/Balloc/src/jp/Balloc.mjs)
Chinês:   [https://cdn.jsdelivr.net/npm/Balloc/src/zh/Balloc.mjs](https://cdn.jsdelivr.net/npm/Balloc/src/zh/Balloc.mjs)

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

## Primeiros passos

O constructor é:

```js
new Balloc(size, bucketSize, metadataSize)

```

| Parâmetro | Tipo | Default | Descrição |
| --- | --- | --- | --- |
| `size` | `number` | `65535` | Capacidade inicial do `dataBus` em bytes |
| `bucketSize` | `BucketType` | `32u` | Tamanho de um elemento em bits |
| `metadataSize` | `number` | `1024` | Capacidade inicial do `controlBus` em bytes |

Exemplo:

```js
const memory = new Balloc();

```

Para elementos unsigned integer de 32-bit:

```js
const memory = new Balloc(65535, "32u");

```

`size` deve ser um inteiro no intervalo `[2, 0x80000000]`.

`bucketSize` deve ser um `BucketType` que é uma string no formato `[Tamanho em bits][tipo de dado]` com os seguintes valores aceitos:

| Signed Integer | Unsigned Integer | Float |
| --- | --- | --- |
| `8i` | `8u` |  |
| `16i` | `16u` |  |
| `32i` | `32u` | `32f` |
| `64i` | `64u` | `64f` |

*O tipo de meia precisão (`16f`), por se tratar de uma adição recente e em fase de consolidação nas especificações e runtimes JavaScript, ainda não tem o suporte garantido dentro de Balloc, mesmo o tipo estando presente na biblioteca a sua disponibilidade de uso pode se tornar uma incerteza no seu projeto.*

`metadataSize` deve ser um inteiro no intervalo `[16, 0x80000000]`.

O tamanho de alocação de um bloco é arredondado para a menor potência de dois capaz de acomodar o número de elementos solicitados.

Por exemplo:

```js
const handler = memory.alloc(100);

```

não cria necessariamente um bloco com exatamente 100 slots físicos. O alocador reserva uma capacidade que seja uma potência de dois.

Conceitualmente:

```text
solicitados: 100 elements
capacidade:  128 elements

```

A capacidade física e a ocupação lógica são distintas:

```text
length(handler)     → capacidade física
occupied(handler)   → elementos ocupados
byteSize(handler)   → bytes físicos reservados

```

Essa distinção proporciona que um bloco contenha menos elementos ocupados do que sua capacidade física.

## API

O ciclo de vida fundamental de um bloco é:

```text
alloc()
   │
   ├── acesso / modificação
   │
   ├── realloc()
   │
   └── free()
          │
          └── recycle

```

Balloc oferece alguns modelos de visão de dados sobre um bloco:

* Pilha (Stack)


* Fila (Queue)


* Array / Acesso Aleatório


A documentação completa da API está disponível na pasta [`./docs`](./docs) e pode ser encontrada traduzida em vários idiomas:

| Idioma | Link |
|---|---|
| Árabe | [./docs/API — balloc.ar.md](./docs/API%20—%20balloc.ar.md) |
| Chinês | [./docs/API — balloc.zh.md](./docs/API%20—%20balloc.zh.md) |
| Espanhol | [./docs/API — balloc.es.md](./docs/API%20—%20balloc.es.md) |
| Inglês | [./docs/API — balloc.en.md](./docs/API%20—%20balloc.en.md) |
| Japonês | [./docs/API — balloc.ja.md](./docs/API%20—%20balloc.ja.md) |
| Português | [./docs/API — balloc.pt.md](./docs/API%20—%20balloc.pt.md) |


Os métodos da API estão agrupados por afinidade e os grupos são:

* Ciclo de vida 
* Operações sobre pilhas
* Operações sobre filas
* Operações sobre arrays
* Intercâmbio entre blocos
* Serialização
* Diagnósticos
* Funções internas

Segue um resumo desses agrupamentos:

### Ciclo de vida

| API | Descrição |
| --- | --- |
| `alloc()` | Alocar um bloco |
| `realloc()` | Aumentar a capacidade do bloco |
| `free()` | Liberar um bloco |
| `gc()` | Compactar o heap de dados |

### Operações sobre pilhas

| API | Descrição |
| --- | --- |
| `push()` | Adicionar um elemento |
| `pop()` | Remover o último elemento |
| `peek()` | Ler o último elemento |

### Operações sobre filas

| API | Descrição |
| --- | --- |
| `nudge()` | Inserir no início |
| `pull()` | Remover o primeiro elemento |
| `head()` | Ler o primeiro elemento |

### Operações sobre arrays

| API | Descrição |
| --- | --- |
| `has()` | Buscar por um valor |
| `get()` | Ler um elemento |
| `set()` | Escrever um elemento |
| `clear()` | Limpar a ocupação e preencher o bloco |
| `fill()` | Preencher um intervalo |
| `fillAll()` | Preencher e ocupar todo o bloco |
| `put()` | Copiar um array para um bloco |
| `pick()` | Copiar elementos ocupados para fora de um bloco |

### Intercâmbio entre blocos

| API | Descrição |
| --- | --- |
| `copy()` | Copiar entre blocos |
| `copyWithin()` | Copiar dentro de um bloco |
| `append()` | Anexar um bloco a outro |
| `clone()` | Criar uma cópia independente do bloco |
| `swap()` | Trocar regiões de blocos |

### Serialização

| API | Descrição |
| --- | --- |
| `dump()` | Serializar o conteúdo do bloco em CBOR |
| `load()` | Restaurar um bloco a partir de dados serializados |

### Diagnósticos

| API | Descrição |
| --- | --- |
| `byteSize()` | Tamanho físico do bloco em bytes |
| `occupied()` | Contagem de elementos ocupados |
| `length()` | Capacidade física de elementos |
| `recycleCount()` | Número de regiões recicláveis |
| `recycleBytes` | Bytes atualmente recicláveis |
| `allocatedBytes` | Bytes associados a regiões não recicladas |
| `unallocatedBytes` | Espaço restante após o ponteiro do bump |
| `fragmentationRatio` | Bytes reciclados / área de heap usada |

### Funções internas

São um caso especial de API utilizada primariamente dentro do próprio alocador e normalmente não recomendadas para uso no código do dia a dia, pois podem causar efeitos colaterais não documentados. Seu uso destina-se a extensões e modificações da biblioteca onde é fundamental o entendimento e a compreensão total do código-fonte de Balloc.

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

`recyclePush()` insere um bloco livre na lista de reciclagem.

`recyclePop()` remove um bloco livre da lista de reciclagem e o retorna.

`grow()` expande o `dataBus` quando a região atual não consegue atender mais alocações.

`headerGrow()` expande o `controlBus` quando headers adicionais são necessários.

`extractMetadata()` decodifica e valida um handler e extrai seus metadados associados.

`bakeCookie()` calcula um cookie de validação usado pelo mecanismo de validação de handlers.

## 💖 Doações / Apoio

Se você gosta deste projeto e quer apoiar o seu desenvolvimento:

| QR Code Pix | Chave Copia e Cola / Aleatória |
| :---: | :--- |
| ![Pix QR Code](./img/pix.png) | **Chave Aleatória:**<br>`e87d773a-0b97-4410-8fc3-f7ec04cce6a2` |

## Licença

[MIT](./LICENSE)
