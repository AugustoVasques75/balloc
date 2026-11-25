# WebGPU sprite animation

This sample demonstrates the complete ingestion and rendering path:

1. Load the local PNG sprite sheet and decode it into an ImageBitmap.
2. Draw the bitmap to a canvas and extract its pixels as ImageData.
3. Pass the ImageData to ImageDataAdapter.
4. Ingest the pixels into a Balloc instance configured with an 8u bucket.
5. Borrow the block with withView() and upload the borrowed Uint8Array directly to a WebGPU texture.
6. Render a two-triangle textured quad. Arrow keys or WASD move it; while moving, the shader samples successive frame rectangles from the sprite sheet.

The sprite sheet is a 256 × 64 PNG containing four 64 × 64 frames.

## Run

Serve the repository root over HTTP (WebGPU requires a secure context; localhost is considered secure):

```sh
npx http-server .
```

Open:

```text
http://localhost:8080/packages/imagedata-adapter/samples/animate/
```

The sample loads the browser-compatible classic build from packages/balloc/src/pt/balloc.js and imports the adapter source directly from this package. A browser with WebGPU support is required.

## Memory view lifetime

withView() provides a temporary view into Balloc's backing storage. The callback is deliberately synchronous: queue.writeTexture() is called inside it, and the view is not retained after the callback returns. This keeps the block borrowed only for the duration of the upload call.
