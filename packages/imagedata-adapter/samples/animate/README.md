# WebGPU sprite animation

This sample demonstrates the complete ingestion and rendering path:

1. Load the local SVG sprite sheet and rasterize it into an `ImageData`.
2. Pass the `ImageData` to `ImageDataAdapter`.
3. Ingest the pixels into a `Balloc` instance configured with an `8u` bucket.
4. Borrow the block with `withView()` and upload the borrowed `Uint8Array` directly to a WebGPU texture.
5. Render a two-triangle textured quad. Arrow keys or WASD move it; while moving, the shader samples successive frame rectangles from the sprite sheet.

## Run

Serve the repository over HTTP (WebGPU requires a secure context; `localhost` is considered secure):

```sh
npx http-server .
```

Open:

```
http://localhost:8080/packages/imagedata-adapter/samples/animate/
```

The sample imports the published `balloc@1.4.0` build from esm.sh and imports the adapter source directly from this package. A browser with WebGPU support is required.

## Memory view lifetime

`withView()` provides a temporary view into Balloc's backing storage. The callback is deliberately synchronous: `queue.writeTexture()` is called inside it, and the view is not retained after the callback returns. This keeps the block borrowed only for the duration of the upload call.
