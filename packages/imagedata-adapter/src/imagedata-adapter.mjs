/**
 * Adapts an ImageData instance for synchronous ingestion by Balloc.
 *
 * The initial implementation supports only rgba8unorm data with 8u buckets.
 * Cropping is optional and uses pixel coordinates and dimensions.
 */
export class ImageDataAdapter {
    /**
     * @param {ImageData} imageData - Decoded pixel source.
     * @param {{x?: number, y?: number, width?: number, height?: number}} [region]
     * Region to extract. Defaults to the entire image.
     */
    constructor(imageData, region = {}) {
        if (!imageData || !Number.isSafeInteger(imageData.width) || imageData.width < 1 ||
            !Number.isSafeInteger(imageData.height) || imageData.height < 1 ||
            !(imageData.data instanceof Uint8ClampedArray) ||
            imageData.data.length !== imageData.width * imageData.height * 4) {
            throw new TypeError("imageData must contain valid width, height and Uint8ClampedArray RGBA data");
        }

        const { x = 0, y = 0, width = imageData.width, height = imageData.height } = region;
        if (![x, y, width, height].every(Number.isSafeInteger) || x < 0 || y < 0 || width < 1 || height < 1 ||
            x + width > imageData.width || y + height > imageData.height) {
            throw new RangeError("region must be an integer rectangle inside imageData bounds");
        }

        this.imageData = imageData;
        this.region = Object.freeze({ x, y, width, height });
        this.handler = undefined;
        this.info = undefined;
    }

    /**
     * Copies the pixels into a Balloc block and returns its handler.
     *
     * @param {import("balloc").default} allocator - Balloc instance.
     * @returns {number} Handler for the block containing the sequential RGBA channels.
     * @throws {TypeError} If the allocator is not configured with 8u buckets.
     * @throws {Error} If allocation or ingestion fails.
     */
    load(allocator) {
        if (!allocator || allocator.bucketType !== "Uint8") {
            throw new TypeError("ImageDataAdapter requires a Balloc allocator configured with bucketSize 8u");
        }

        const { x, y, width, height } = this.region;
        const source = this.imageData.data;
        let pixels = source;

        if (x !== 0 || y !== 0 || width !== this.imageData.width || height !== this.imageData.height) {
            pixels = new Uint8Array(width * height * 4);
            const rowBytes = width * 4;
            for (let row = 0; row < height; row++) {
                const start = ((y + row) * this.imageData.width + x) * 4;
                pixels.set(source.subarray(start, start + rowBytes), row * rowBytes);
            }
        }

        const handler = allocator.alloc(width * height * 4);
        try {
            allocator.put(handler, pixels);
        } catch (error) {
            try { allocator.free(handler); } catch {}
            throw error;
        }

        this.handler = handler;
        this.info = Object.freeze({
            width,
            height,
            format: "rgba8unorm",
            bytesPerPixel: 4,
            sampleType: "float",
            renderable: true,
            multisample: true,
            storage: true
        });

        return handler;
    }
}

export default ImageDataAdapter;
