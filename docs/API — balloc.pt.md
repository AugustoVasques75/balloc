Você também pode conseguir essa documentação traduzida em outras linguagens:
| Idioma | Link |
|---|---|
| Árabe | [API — balloc.ar.md](./docs/API%20—%20balloc.ar.md) |
| Chinês | [API — balloc.zh.md](./docs/API%20—%20balloc.zh.md) |
| Espanhol | [API — balloc.es.md](./docs/API%20—%20balloc.es.md) |
| Inglês | [API — balloc.en.md](./docs/API%20—%20balloc.en.md) |
| Japonês | [API — balloc.jp.md](./docs/API%20—%20balloc.jp.md) |
| Português | [API — balloc.pt.md](./docs/API%20—%20balloc.pt.md) |


# Balloc.js


`Balloc` é um alocador de memória baseado em **bump allocation**, com dois barramentos independentes:

- `dataBus` — armazenamento dos dados dos blocos.
- `controlBus` — armazenamento dos headers e metadados.

Os blocos são identificados externamente por um **handler lógico de 43 bits**, composto por uma geração de 11 bits e pelo endereço de seu header em 32 bits. A capacidade física dos blocos é sempre uma potência de dois em número de elementos.

## Ontologia da API

```text
Balloc
├── Instanciamento
│   └── constructor()
│
├── Ciclo de vida dos blocos
│   ├── alloc()
│   ├── realloc()
│   ├── free()
│   └── gc()
│
├── Estruturas lineares
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
├── Acesso ao conteúdo
│   ├── has()
│   ├── get()
│   ├── set()
│   ├── clear()
│   ├── fill()
│   ├── fillAll()
│   ├── put()
│   └── pick()
│
├── Capacidade e ocupação
│   ├── byteSize()
│   ├── occupied()
│   └── length()
│
├── Operações entre blocos
│   ├── copy()
│   ├── copyWithin()
│   ├── append()
│   └── clone()
│   └── swap()
│
├── Serialização
│   ├── dump()
│   └── load()
│
├── Diagnóstico e utilização
│   ├── recycleCount()
│   ├── recycleBytes
│   ├── allocatedBytes
│   ├── unallocatedBytes
│   └── fragmentationRatio
│
└── Uso interno
    ├── Reciclagem
    │   ├── recyclePush()
    │   └── recyclePop()
    │
    ├── Escalonamento
    │   ├── grow()
    │   └── headerGrow()
    │
    └── Utilitários
        ├── extractMetadata()
        └── bakeCookie()
```
---

## Semântica de capacidade

A unidade lógica de capacidade depende de `bucketSize`.

```text
bucketSize = "8i"  ou bucketSize = "8u"                         → 1 byte  por elemento
bucketSize = "16i" ou bucketSize = "16u" ou bucketSize = "16f"  → 2 bytes por elemento
bucketSize = "32i" ou bucketSize = "32u" ou bucketSize = "32f"  → 4 bytes por elemento
bucketSize = "64i" ou bucketSize = "64u" ou bucketSize = "64f"  → 8 bytes por elemento
```

O alocador calcula a capacidade em **elementos** como potência de dois e posteriormente converte essa capacidade para bytes.

Por exemplo, com `bucketSize = "32u"`:

```text
capacity = 8 elementos
wordSize = 4 bytes

byteCapacity = 8 × 4 = 32 bytes
```

A capacidade física e a ocupação são conceitos distintos:

```text
length(handler)    → slots físicos
occupied(handler)  → slots ocupados
byteSize(handler)  → bytes físicos reservados
```


---

# 1. Instanciamento

## `new Balloc(size, bucketSize, metadataSize)`

Cria um novo alocador.

O armazenamento é dividido entre `dataBus`, destinado aos dados dos blocos, e `controlBus`, destinado aos headers. A capacidade inicial de ambos é arredondada conforme a estratégia interna de crescimento.

### Parâmetros

| Parâmetro | Tipo | Padrão | Descrição |
|---|---|---:|---|
| `size` | `number` | `65535` | Capacidade inicial do `dataBus`, em bytes. |
| `bucketSize` | `BucketType` | Tamanho de cada elemento. |
| `metadataSize` | `number` | `1024` | Capacidade inicial do `controlBus`, em bytes. |

`size` deve ser um inteiro seguro no intervalo `[2, 0x80000000]`.

`bucketSize` aceita um valor tipo `BucketType` que é uma string no formato`[Tamanho em bytes][tipo de dado]` aceitando somente da tabela: 
| Signed Integer| Unigned Integer| Float |
|---|---|---|
|`8i`|`8u`|  |
|`16i`| `16u`| |
|`32i`| `32u`| `32f`|
|`64i`| `64u`| `64f`|

*O tipo de meia precisão (`16f`), por se tratar de uma adição recente e em fase de consolidação nas especificações e runtimes JavaScript, ainda não tem o suporte garantido dentro de Balloc, mesmo o tipo estando presente na biblioteca a sua disponibilidade uso pode se tornar uma incerteza no seu projeto.*
---

`metadataSize` deve ser um inteiro seguro no intervalo `[16, 0x80000000]`.

### Exceções

- `RangeError` — `size` fora do intervalo.
- `RangeError` — `bucketSize` diferente dos definidos por `BucketType`.
- `RangeError` — `metadataSize` fora do intervalo permitido.

### Exemplo

```js
const { Balloc } = require("Balloc");

const memory = new Balloc();
```

Para utilizar elementos de não sinalizado de 32 bits:

```js
const memory = new Balloc(65535, "32u");
```

O construtor instancia internamente o `TypedArray` correspondente ao `bucketSize`, além dos `DataView`s usados para leitura e escrita.

---

# 2. Ciclo de vida dos blocos

O ciclo fundamental de um bloco é:

```text
alloc()
   │
   ├── operações sobre o bloco
   │
   ├── realloc()
   │
   └── free()
          │
          └── reciclagem
```

A reciclagem permite reutilizar regiões liberadas com capacidade exatamente correspondente à nova alocação.

## `alloc(size = 16)`

Aloca um novo bloco e retorna seu handler.

A capacidade é arredondada para a menor potência de dois que comporte `size` elementos. O bloco é procurado primeiro na lista de regiões recicláveis; inexistindo uma região compatível, o espaço é obtido no topo do `dataBus`.

### Parâmetros

| Parâmetro | Tipo | Padrão | Descrição |
|---|---|---:|---|
| `size` | `number` | `16` | Número mínimo de elementos desejado. |

`size` deve estar no intervalo `[2, 0x80000000]`.

### Retorno

```text
number
```

Handler do bloco.

O handler possui a forma lógica:

```text
[ 11 bits de geração ][ 32 bits de endereço do header ]
```



### Exemplo

```js
const handler = memory.alloc(100);

memory.push(handler, 42);
```

Uma solicitação de 100 elementos não reserva exatamente 100 slots: a capacidade será a próxima potência de dois.

---

## `realloc(handler)`

Aumenta a capacidade do bloco para a próxima potência de dois.

Se o bloco estiver localizado no topo atual do `dataBus`, a expansão ocorre **in-place**. Caso contrário, uma nova região é obtida do sistema de reciclagem ou do topo do heap, os elementos ocupados são copiados e a região anterior é reciclada.

O handler não muda, pois seu header é preservado.

### Parâmetros

| Parâmetro | Tipo | Descrição |
|---|---|---|
| `handler` | `number` | Handler do bloco. |

### Retorno

```text
void
```

### Exceções

- `Error` — handler inválido ou corrompido.
- `AggregateError` — capacidade já atingiu o limite máximo.

### Exemplo

```js
const handler = memory.alloc(8);

memory.realloc(handler);
```

A operação duplica a capacidade física, passando para a próxima potência de dois.

---

## `free(handler)`

Libera um bloco.

O header é invalidado zerando seu cookie. A região de dados é:

- devolvida à reciclagem quando não está no topo do `dataBus`;
- removida diretamente do topo quando é a região mais recente do heap.

### Parâmetros

| Parâmetro | Tipo | Descrição |
|---|---|---|
| `handler` | `number` | Handler do bloco. |

### Retorno

```text
void
```

### Exceções

`Error` quando o handler é inválido ou corrompido.

```js
memory.free(handler);
```

Um handler liberado deixa de ser válido.

---

## `gc()`

Compacta o `dataBus` através do algoritmo **ReBump**.

A operação percorre os headers existentes no `controlBus`, copia somente os blocos ainda válidos para um novo `dataBus` e atualiza seus endereços nos headers. Os espaços livres entre blocos são eliminados.

### Efeitos

- elimina todas as regiões presentes em `recycle`;
- compacta os blocos vivos;
- preserva a ordem dos headers;
- preserva a capacidade física dos blocos;
- preserva a ocupação;
- atualiza os endereços dos blocos;
- reposiciona `dataPointer` após o último bloco vivo.

### Retorno

```text
void
```

### Complexidade

O percurso dos headers é `O(n)`, onde `n` é o número de headers examinados. O custo total também depende do volume de dados movimentado.

```js
memory.gc();
```

O `gc()` não altera os handlers, pois os headers permanecem nos mesmos endereços; somente as regiões de dados são compactadas.

---

# 3. Estruturas lineares

Os blocos podem ser utilizados como estruturas lineares de acesso pelas extremidades.

## 3.1 Stack

### `push(handler, value)`

Adiciona `value` ao final da sequência ocupada.

Se não houver espaço disponível, nenhum elemento é inserido e o método retorna `false`.

```js
memory.push(handler, 10);
memory.push(handler, 20);
memory.push(handler, 30);
```

Retorno:

```text
boolean
```

- `true` — elemento inserido.
- `false` — bloco cheio.

---

### `pop(handler)`

Remove e retorna o último elemento ocupado.

A ocupação é decrementada antes da leitura do elemento. Os bytes antigos não são apagados.

Retorno:

```text
number | undefined
```

`undefined` indica bloco vazio.

```js
const value = memory.pop(handler);
```

---

### `peek(handler)`

Retorna o último elemento ocupado sem removê-lo.

Retorno:

```text
number | undefined
```



---

## 3.2 Queue

### `nudge(handler, value)`

Insere um elemento no início da sequência ocupada.

Os elementos existentes são deslocados uma posição para frente. A operação é proporcional ao número de elementos ocupados.

Retorno:

```text
boolean
```

- `true` — elemento inserido.
- `false` — bloco cheio.

---

### `pull(handler)`

Remove e retorna o primeiro elemento.

Os elementos restantes são deslocados uma posição em direção ao início.

Retorno:

```text
number | undefined
```

---

### `head(handler)`

Retorna o primeiro elemento sem removê-lo.

Retorno:

```text
number | undefined
```



---

# 4. Acesso ao conteúdo

## `has(handler, value)`

Verifica se `value` está entre os elementos ocupados.

A pesquisa utiliza a `TypedArray` auxiliar e considera somente `[0, occupied)`, ignorando a capacidade física não ocupada.

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

Obtém o elemento no índice especificado.

O índice é baseado em zero. Índices fora de `[0, occupied)` retornam `undefined`.

```js
const value = memory.get(handler, 3);
```

Retorno:

```text
number | undefined
```

---

## `set(handler, index, value)`

Substitui o elemento de um índice ocupado.

A ocupação não é modificada.

Índices fora de `[0, occupied)` são ignorados e fazem o método retornar `false`.

```js
memory.set(handler, 3, 99);
```

Retorno:

```text
boolean
```

- `true` — valor gravado.
- `false` — índice inválido para a região ocupada.

---

## `clear(handler, value = 0)`

Zera a ocupação e preenche **todos os slots físicos** do bloco com `value`.

Isso inclui slots que não faziam parte da sequência ocupada.

```js
memory.clear(handler);
```

Após a operação:

```text
occupied = 0
```

A capacidade física permanece inalterada.

---

## `fill(handler, value, start = 0, end = null)`

Preenche um intervalo de slots com `value`.

O intervalo segue a convenção:

```text
[start, end)
```

`start` é inclusivo e `end` é exclusivo. Quando `end` é `null`, o limite é a capacidade física total. A ocupação passa a ser `end`.

```js
memory.fill(handler, 0, 2, 6);
```

Preenche:

```text
2, 3, 4, 5
```

### Exceções

`RangeError` quando:

- `start < 0`;
- `start > capacity`;
- `end < 0`;
- `end > capacity`;
- `start > end`.

---

## `fillAll(handler, value)`

Preenche todos os slots físicos com `value` e marca toda a capacidade como ocupada.

É equivalente ao preenchimento da capacidade inteira seguido da definição de:

```text
occupied = capacity
```

Diferentemente de `clear()`, o bloco termina completamente ocupado.

```js
memory.fillAll(handler, 0);
```

---

## `put(handler, data)`

Copia uma `Array` ou `TypedArray` para o início do bloco.

A quantidade copiada é limitada à capacidade do bloco. A ocupação torna-se o maior valor entre a ocupação anterior e a quantidade efetivamente copiada. Portanto, `put()` não reduz a ocupação existente quando recebe uma sequência menor.

```js
memory.put(handler, [10, 20, 30, 40]);
```

Também aceita `TypedArray`:

```js
memory.put(handler, new Uint32Array([10, 20, 30]));
```

### Tipos aceitos

```text
Array
TypedArray
```

### Exceções

`TypeError` quando `data` não é `Array` nem `TypedArray`.

---

## `pick(handler)`

Retorna uma cópia dos elementos atualmente ocupados.

O tipo da `TypedArray` retornada corresponde ao `bucketSize` configurado no alocador. A capacidade física não ocupada não é incluída.

```js
const values = memory.pick(handler);
```

O resultado possui armazenamento independente do `dataBus`.

Para um alocador `bucketSize = "32u"`, por exemplo, o tipo `Uint32Array` armazenará o resultado.

---

# 5. Capacidade e ocupação

## `byteSize(handler)`

Retorna a capacidade física do bloco em bytes.

Não representa a quantidade de bytes atualmente ocupados por elementos; representa o espaço reservado para todos os slots do bloco.

```js
const bytes = memory.byteSize(handler);
```

---

## `occupied(handler)`

Retorna o número de elementos atualmente ocupados.

```js
const count = memory.occupied(handler);
```

---

## `length(handler)`

Retorna a quantidade total de slots físicos disponíveis.

A capacidade é independente da ocupação:

```text
length >= occupied
```



```js
const capacity = memory.length(handler);
```

---

# 6. Operações entre blocos

## `copy(source, destiny, slots = UNKNOWN)`

Copia os elementos ocupados de `source` para o início de `destiny`.

A quantidade copiada é limitada por:

1. ocupação de `source`;
2. capacidade de `destiny`;
3. `slots`.

A ocupação de `destiny` é aumentada quando necessário, mas sua capacidade não é alterada.

```js
memory.copy(source, destiny);
```

Limitação explícita:

```js
memory.copy(source, destiny, 8);
```

### Retorno

```text
Uint8Array
```

É o próprio `dataBus` após a operação.

---

## `copyWithin(handler, target, start, length)`

Copia uma região dentro do próprio bloco.

A semântica segue o conceito de `Array.prototype.copyWithin()`, mas é aplicada sobre a capacidade física do bloco e limitada pela ocupação disponível na origem.

```js
memory.copyWithin(handler, 4, 0, 4);
```

Os índices negativos são interpretados relativamente ao final da capacidade.

A operação:

- suporta regiões sobrepostas;
- limita os índices à capacidade;
- limita a leitura à região ocupada;
- limita a escrita à capacidade;
- pode aumentar `occupied`.

Retorno:

```text
Uint8Array
```

É o `dataBus`.

---

## `append(target, source)`

Acrescenta os elementos ocupados de `source` ao final dos elementos ocupados de `target`.

A quantidade é limitada pela ocupação da origem e pelo espaço disponível no destino.

```js
const count = memory.append(target, source);
```

### Retorno

```text
number
```

Número de elementos efetivamente acrescentados.

A operação também aceita:

```js
memory.append(handler, handler);
```

quando `target` e `source` são o mesmo bloco.

---

## `clone(handler)`

Cria uma cópia independente do bloco.

O clone possui:

- mesma capacidade física;
- mesma ocupação;
- mesmos bytes de toda a região reservada;
- novo handler.



```js
const copy = memory.clone(handler);
```

O conteúdo não ocupado também é copiado.

---

## `swap(source, target)`

Troca as regiões de dados associadas a dois handlers.

A operação troca nos headers:

- endereço;
- capacidade;
- ocupação.

Nenhum byte é copiado no `dataBus`. Os handlers continuam apontando para seus respectivos headers.

```js
memory.swap(a, b);
```

Em termos conceituais:

```text
antes:

handler A → região A
handler B → região B

depois:

handler A → região B
handler B → região A
```

---

# 7. Serialização

Métodos especializados ao suporte a exportação e importação do estado dos blocos utilizando o formato CBOR.

## `dump(handler)`

Serializa o conteúdo de um bloco de memória identificado por `handler`.

O método extrai os dados ocupados do bloco e os agrupa junto com informações de capacidade e tipo de palavra em um envelope de dados e os codifica utilizando o formato CBOR.


### Retorno

```text
Uint8Array

```

Um buffer contendo os dados serializados do bloco.

### Exceções

`Error` — se o handler for inválido ou estiver corrompido.

---

## `load(serialized)`

Restaura um bloco de memória a partir de dados serializados.

Decodifica o envelope CBOR passado em `serialized`, valida se o tipo de palavra do dado serializado é compatível com a instância atual do alocador e aloca um novo bloco com a capacidade necessária para acomodar o conteúdo. Em seguida, os dados e a ocupação original são restaurados no novo bloco.


### Retorno

```text
number

```

Handler do novo bloco recriado.

### Exceções

`Error` — se o tipo de palavra do dado decodificado divergir do configurado no alocador.

---

# 8. Diagnóstico e utilização

## `recycleCount()`

Retorna a quantidade de regiões atualmente armazenadas no sistema de reciclagem.

Uma região corresponde a uma área liberada que não pôde ser simplesmente removida do topo do `dataBus`.

```js
const count = memory.recycleCount();
```

---

## `recycleBytes`

Getter que retorna o total de bytes pertencentes às regiões atualmente recicláveis.

```js
const bytes = memory.recycleBytes;
```

O valor é calculado como:

```text
Σ(capacity × quantidade_de_regiões)
```



---

## `allocatedBytes`

Getter que retorna os bytes associados às regiões que não estão atualmente na lista de reciclagem.

É calculado por:

```text
dataPointer - recycleBytes
```



```js
const bytes = memory.allocatedBytes;
```

---

## `unallocatedBytes`

Getter que retorna o espaço ainda disponível no topo do `dataBus`.

É a região entre `dataPointer` e o final da capacidade reservada:

```text
size - dataPointer
```



```js
const bytes = memory.unallocatedBytes;
```

---

## `fragmentationRatio`

Getter que calcula a razão entre os bytes recicláveis e a área de heap já percorrida pelo bump pointer.

```text
recycleBytes / dataPointer
```

Quando `dataPointer` é zero, o resultado é `0`.

```js
const ratio = memory.fragmentationRatio;
```

O valor mede a fragmentação **dentro da área já utilizada do heap**, e não em relação à capacidade total do `dataBus`.

---

# 9. Uso interno

Os métodos desta seção fazem parte da implementação de `Balloc` e não constituem a interface destinada ao código consumidor.

```text
Uso interno
├── Reciclagem
│   ├── recyclePush()
│   └── recyclePop()
│
├── Escalonamento
│   ├── grow()
│   └── headerGrow()
│
└── Validação / metadados
    ├── extractMetadata()
    └── bakeCookie()
```

## 9.1 Reciclagem

### `recyclePush(capacity, address)`

**Privado.**

Insere uma região livre na lista de reciclagem associada à sua capacidade em bytes.

Cada capacidade possui uma página representada por `Uint32Array`:

```text
[count, address1, address2, ...]
```

A estrutura funciona como uma pilha LIFO. Quando a página fica cheia, seu buffer é expandido para o dobro.

---

### `recyclePop(capacity)`

**Privado.**

Remove e retorna uma região reciclável de capacidade exata.

A remoção ocorre pelo final da página, caracterizando comportamento LIFO.

Retorna:

```text
address
```

ou:

```js
UNKNOWN // 0xFFFFFFFF
```

quando não existe uma região disponível para aquela capacidade.

---

## 9.2 Escalonamento

### `grow()`

**Privado. Não utilizar diretamente.**

Duplica a capacidade do `dataBus`.

O `ArrayBuffer` subjacente é transferido para um buffer maior e as views associadas são recriadas.

É acionado automaticamente quando uma nova região não cabe no espaço restante do `dataBus`.

---

### `headerGrow()`

**Privado. Não utilizar diretamente.**

Duplica a capacidade do `controlBus`.

Os headers existentes são preservados durante a transferência do `ArrayBuffer`, e o `controlAdapter` é recriado sobre o novo armazenamento.

É acionado automaticamente quando não há espaço para um novo header.

---

## 9.3 Validação e metadados

### `extractMetadata(handler, out)`

**Privado.**

Decodifica e valida um handler.

O método extrai:

```text
generation
headerAddress
dataAddress
capacityExponent
byteCapacity
occupied
```

A validade do handler é verificada recalculando o cookie armazenado no header. O objeto `out` é reutilizável, permitindo evitar novas alocações.

Assinatura:

```js
extractMetadata(handler, out)
```

Retorno:

```text
Metadata
```

O retorno é a própria referência fornecida em `out`.

---

### `bakeCookie(addr, gen)`

**Privado.**

Calcula o cookie de validação utilizado para verificar handlers.

O cookie combina:

- endereço do header;
- os 11 bits inferiores da geração.

O resultado é reduzido para 8 bits. O valor `0` é reservado para indicar header inválido, portanto o método substitui `0` por `1`.

O cookie não é criptográfico. Sua função é detectar handlers inválidos, antigos (`stale`) ou corrompidos dentro do modelo de gerenciamento do alocador.

---

# 10. Modelo de armazenamento

Cada bloco possui um header fixo de **16 bytes**:

```text
offset  tamanho  campo
──────  ───────  ─────────────
0       4 bytes  address
4       4 bytes  occupied
8       1 byte   capacity
9       1 byte   cookie
10      6 bytes  reserved
```



Os campos relevantes são:

### `address`

Endereço inicial da região de dados dentro do `dataBus`.

### `occupied`

Número de elementos atualmente ocupados.

### `capacity`

Expoente da potência de dois que representa a capacidade física:

```text
capacityElements = 2 ** capacity
```

A capacidade em bytes é:

```text
capacityBytes = 2 ** capacity × wordSize
```

### `cookie`

Valor de validação associado ao endereço do header e à geração do handler.

---

# 11. Handlers

O handler é o identificador externo utilizado por praticamente todas as operações sobre blocos.

Sua composição lógica é:

```text
┌───────────────────────┬───────────────────────────────┐
│ geração — 11 bits     │ endereço do header — 32 bits  │
└───────────────────────┴───────────────────────────────┘
```

A parte inferior corresponde diretamente ao endereço do header; a parte superior representa a geração.

A geração participa da validação por cookie. Consequentemente, um handler inválido ou cujo header tenha sido invalidado provoca erro nas operações que o utilizam.

---



# 12. Resumo da API pública

| Categoria | Método / propriedade | Retorno |
| --- | --- | --- |
| Instaciamento | `constructor()` | `Balloc`<br> |
| Ciclo de vida | `alloc()` | `number`<br> |
| Ciclo de vida | `realloc()` | `void`<br> |
| Ciclo de vida | `free()` | `void`<br> |
| Ciclo de vida | `gc()` | `void`<br> |
| Stack | `push()` | `boolean`<br> |
| Stack | `pop()` | `number | undefined`<br> |
| Stack | `peek()` | `number | undefined`<br> |
| Queue | `nudge()` | `boolean`<br> |
| Queue | `pull()` | `number | undefined`<br> |
| Queue | `head()` | `number | undefined`<br> |
| Acesso | `has()` | `boolean`<br> |
| Acesso | `get()` | `number | undefined`<br> |
| Acesso | `set()` | `boolean`<br> |
| Acesso | `clear()` | `void`<br> |
| Acesso | `fill()` | `void`<br> |
| Acesso | `fillAll()` | `void`<br> |
| Acesso | `put()` | `void`<br> |
| Acesso | `pick()` | `TypedArray`<br> |
| Capacidade | `byteSize()` | `number`<br> |
| Capacidade | `occupied()` | `number`<br> |
| Capacidade | `length()` | `number`<br> |
| Blocos | `copy()` | `Uint8Array`<br> |
| Blocos | `copyWithin()` | `Uint8Array`<br> |
| Blocos | `append()` | `number`<br> |
| Blocos | `clone()` | `number`<br> |
| Blocos | `swap()` | `void`<br> |
| Serialização | `dump()` | `Uint8Array`<br> |
| Serialização | `load()` | `number`<br> |
| Diagnóstico | `recycleCount()` | `number`<br> |
| Diagnóstico | `recycleBytes` | `number`<br> |
| Diagnóstico | `allocatedBytes` | `number`<br> |
| Diagnóstico | `unallocatedBytes` | `number`<br> |
| Diagnóstico | `fragmentationRatio` | `number`<br> |

## Métodos internos

| Grupo | Método | Visibilidade |
|---|---|---|
| Reciclagem | `recyclePush()` | privada |
| Reciclagem | `recyclePop()` | privada |
| Escalonamento | `grow()` | privada |
| Escalonamento | `headerGrow()` | privada |
| Metadados | `extractMetadata()` | privada |
| Validação | `bakeCookie()` | privada |


