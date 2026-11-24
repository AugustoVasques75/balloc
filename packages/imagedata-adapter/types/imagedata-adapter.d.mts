import type Balloc from "balloc";

export interface ImageDataInfo {
    width: number;
    height: number;
    format: "rgba8unorm";
    bytesPerPixel: 4;
    sampleType: "float";
    renderable: true;
    multisample: true;
    storage: true;
}

export interface ImageDataRegion {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
}

export declare class ImageDataAdapter {
    constructor(imageData: ImageData, region?: ImageDataRegion);
    readonly imageData: ImageData;
    readonly region: Readonly<Required<ImageDataRegion>>;
    handler: number | undefined;
    info: ImageDataInfo | undefined;
    load(allocator: Balloc): number;
}

export default ImageDataAdapter;
