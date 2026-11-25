# imagedata-adapter

A synchronous `ImageData` format adapter for [Balloc](https://www.npmjs.com/package/balloc). It copies RGBA pixel data into a Balloc memory block and exposes image metadata for downstream consumers such as WebGPU applications.

## Installation

```sh
npm install balloc imagedata-adapter
```

The adapter declares `balloc` as a package dependency. Install both packages when using the adapter directly.

## Requirements and supported format

The initial release accepts an already-decoded `ImageData` instance whose `data` property is a `Uint8ClampedArray`. It preserves the source RGBA byte order and supports only the `rgba8unorm` format.

The target allocator must use the `8u` bucket:

```js
import Balloc from "balloc";
import ImageDataAdapter from "imagedata-adapter";

const allocator = new Balloc(65535, "8u");
const adapter = new ImageDataAdapter(imageData);
const handler = allocator.loadData(adapter);

console.log(allocator.pick(handler));
console.log(adapter.info);
```

The adapter does not decode image URLs, files, or other asynchronous sources. Decode the image and obtain an `ImageData` instance before constructing the adapter. No pixel-format conversion is performed.

## Cropping

The optional second constructor argument selects a rectangular region in source-image pixel coordinates. Omitted values default to the full image bounds.

```js
const adapter = new ImageDataAdapter(imageData, {
    x: 10,
    y: 20,
    width: 64,
    height: 32
});

const handler = allocator.loadData(adapter);
```

The region must have non-negative integer coordinates, positive integer dimensions, and fit entirely within the source image. Cropped rows are copied into a contiguous RGBA byte sequence.

## API

### `new ImageDataAdapter(imageData, region?)`

- `imageData`: an `ImageData` instance with positive integer dimensions and RGBA data stored in a `Uint8ClampedArray`.
- `region`: optional rectangle with `x`, `y`, `width`, and `height` fields.

Invalid source data raises a `TypeError`. An invalid or out-of-bounds region raises a `RangeError`.

### `adapter.load(allocator)`

Copies the selected pixels into a newly allocated Balloc block and returns its numeric handler. This method is normally called through `allocator.loadData(adapter)`.

The allocator must be configured with bucket type `8u`; otherwise, loading raises a `TypeError`. If writing the pixel data fails after allocation, the adapter attempts to free the allocated block before rethrowing the original error.

### Metadata

After a successful load:

- `adapter.handler`: numeric handler returned by `load()`.
- `adapter.info`: immutable metadata object containing:
  - `width`, `height`: dimensions of the selected region.
  - `format`: `"rgba8unorm"`.
  - `bytesPerPixel`: `4`.
  - `sampleType`: `"float"`.
  - `renderable`, `multisample`, `storage`: format capability indicators.

The metadata describes the pixel format; actual GPU usage remains subject to the capabilities and validation rules of the target graphics API and device.

## WebGPU animation sample

The [animate sample](./samples/animate/) demonstrates image decoding, `ImageData` extraction, adapter ingestion, borrowing the Balloc block with `withView()`, uploading the bytes to a WebGPU texture, alpha blending, and sprite animation.

Run it from the repository root using a local HTTP server:

```sh
npx http-server .
```

Then open:

```text
http://localhost:8080/packages/imagedata-adapter/samples/animate/
```

The sample requires a browser with WebGPU support. It loads the browser-compatible classic Balloc build from `packages/balloc/src/pt/balloc.js` and imports the adapter source directly.

## License

MIT
