import { describe, it, expect, vi } from "vitest";
import Balloc from "balloc";
import ImageDataAdapter from "../src/imagedata-adapter.mjs";

const makeImageData = (width, height, values) => ({
    width,
    height,
    data: new Uint8ClampedArray(values)
});

describe("ImageDataAdapter", () => {
    it("loads RGBA pixels into a Balloc 8u block", () => {
        const allocator = new Balloc(64, "8u");
        const adapter = new ImageDataAdapter(makeImageData(2, 1, [1, 2, 3, 4, 5, 6, 7, 8]));
        const handler = allocator.loadData(adapter);

        expect(allocator.pick(handler)).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
        expect(allocator.occupied(handler)).toBe(8);
        expect(adapter.handler).toBe(handler);
        expect(adapter.info).toMatchObject({ width: 2, height: 1, format: "rgba8unorm", bytesPerPixel: 4 });
    });

    it("loads only the requested region", () => {
        const allocator = new Balloc(64, "8u");
        const imageData = makeImageData(2, 2, [
            1, 2, 3, 4, 5, 6, 7, 8,
            9, 10, 11, 12, 13, 14, 15, 16
        ]);
        const handler = allocator.loadData(new ImageDataAdapter(imageData, { x: 1, y: 0, width: 1, height: 2 }));

        expect(allocator.pick(handler)).toEqual(new Uint8Array([5, 6, 7, 8, 13, 14, 15, 16]));
    });

    it("rejects allocators that do not use 8u buckets", () => {
        const allocator = new Balloc(64, "32u");
        const adapter = new ImageDataAdapter(makeImageData(1, 1, [1, 2, 3, 4]));

        expect(() => allocator.loadData(adapter)).toThrow(TypeError);
    });

    it("rejects invalid source data and regions", () => {
        expect(() => new ImageDataAdapter(null)).toThrow(TypeError);
        expect(() => new ImageDataAdapter({ width: 1, height: 1, data: new Uint8Array(4) })).toThrow(TypeError);
        expect(() => new ImageDataAdapter(makeImageData(2, 2, new Array(16).fill(0)), { x: 1, y: 1, width: 2, height: 2 })).toThrow(RangeError);
    });

    it("releases the allocated block when ingestion fails", () => {
        const allocator = new Balloc(64, "8u");
        const free = vi.spyOn(allocator, "free");
        vi.spyOn(allocator, "put").mockImplementation(() => { throw new Error("write failed"); });
        const adapter = new ImageDataAdapter(makeImageData(1, 1, [1, 2, 3, 4]));

        expect(() => allocator.loadData(adapter)).toThrow("write failed");
        expect(free).toHaveBeenCalledOnce();
    });
});
