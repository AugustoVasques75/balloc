# imagedata-adapter

Adaptador síncrono de `ImageData` para [Balloc](https://www.npmjs.com/package/balloc).

## Instalação

```sh
npm install balloc imagedata-adapter
```

## Uso

A primeira versão aceita uma instância `ImageData` já decodificada, armazena os canais RGBA sem conversão e exige um Balloc configurado com bucket `8u`.

```js
import Balloc from "balloc";
import ImageDataAdapter from "imagedata-adapter";

const allocator = new Balloc(65535, "8u");
const adapter = new ImageDataAdapter(imageData);
const handler = allocator.loadData(adapter);

console.log(allocator.pick(handler));
console.log(adapter.info);
```

## Recorte

O segundo argumento é opcional e define a região em pixels. Campos omitidos usam a origem `(0, 0)` e as dimensões da imagem.

```js
const adapter = new ImageDataAdapter(imageData, { x: 10, y: 20, width: 64, height: 32 });
const handler = allocator.loadData(adapter);
```

A região deve ser um retângulo inteiro, positivo e contido na imagem. Os canais permanecem na ordem RGBA original.

## Metadados

Após uma carga bem-sucedida:

- `adapter.handler`: handler numérico retornado por `load()`.
- `adapter.info`: dimensões, formato `rgba8unorm`, bytes por pixel, tipo de amostra e atributos de suporte descritos para esse formato.

O adaptador não decodifica URLs nem fontes assíncronas. Formatos diferentes de RGBA8 não são convertidos nesta versão. Se a ingestão falhar depois da alocação, o adaptador libera o bloco antes de propagar o erro.
