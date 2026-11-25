import ImageDataAdapter from "https://unpkg.com/imagedata-adapter";

const canvas = document.querySelector("#screen");
const status = document.querySelector("#status");
const context = canvas.getContext("webgpu");
if (!navigator.gpu || !context) throw new Error("WebGPU is not available in this browser.");
if (typeof window.Balloc !== "function") throw new Error("Balloc failed to load from the classic script.");

const adapter = await navigator.gpu.requestAdapter();
if (!adapter) throw new Error("No compatible GPU adapter was found.");
const device = await adapter.requestDevice();
const format = navigator.gpu.getPreferredCanvasFormat();
context.configure({ device, format, alphaMode: "opaque" });

const sprite = await createImageBitmap(await (await fetch("./sprites.png")).blob());
const sourceCanvas = document.createElement("canvas");
sourceCanvas.width = sprite.width;
sourceCanvas.height = sprite.height;
const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
sourceContext.drawImage(sprite, 0, 0);
const imageData = sourceContext.getImageData(0, 0, sprite.width, sprite.height);

const allocator = new window.Balloc(65535, "8u");
const imageAdapter = new ImageDataAdapter(imageData);
const spriteHandler = allocator.loadData(imageAdapter);
const { width: textureWidth, height: textureHeight } = imageAdapter.info;

const texture = device.createTexture({
    size: [textureWidth, textureHeight, 1],
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
});

allocator.withView(spriteHandler, pixels => {
    device.queue.writeTexture(
        { texture },
        pixels,
        { offset: 0, bytesPerRow: textureWidth * 4, rowsPerImage: textureHeight },
        [textureWidth, textureHeight, 1]
    );
});

const sampler = device.createSampler({ magFilter: "nearest", minFilter: "nearest" });
const shader = device.createShaderModule({ code: `
struct Scene {
    translation: vec2f,
    _padding: vec2f,
    uvRect: vec4f,
};
@group(0) @binding(0) var spriteTexture: texture_2d<f32>;
@group(0) @binding(1) var spriteSampler: sampler;
@group(0) @binding(2) var<uniform> scene: Scene;

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
};

@vertex
fn vertexMain(@location(0) position: vec2f, @location(1) uv: vec2f) -> VertexOutput {
    var output: VertexOutput;
    output.position = vec4f(position + scene.translation, 0.0, 1.0);
    output.uv = scene.uvRect.xy + uv * scene.uvRect.zw;
    return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
    return textureSample(spriteTexture, spriteSampler, input.uv);
}
` });

const vertices = new Float32Array([
    -0.10125, -0.18, 0, 1,
     0.10125, -0.18, 1, 1,
     0.10125,  0.18, 1, 0,
    -0.10125, -0.18, 0, 1,
     0.10125,  0.18, 1, 0,
    -0.10125,  0.18, 0, 0
]);
const vertexBuffer = device.createBuffer({
    size: vertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
});
device.queue.writeBuffer(vertexBuffer, 0, vertices);

const uniformBuffer = device.createBuffer({
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
});
const bindGroupLayout = device.createBindGroupLayout({
    entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } }
    ]
});
const bindGroup = device.createBindGroup({
    layout: bindGroupLayout,
    entries: [
        { binding: 0, resource: texture.createView() },
        { binding: 1, resource: sampler },
        { binding: 2, resource: { buffer: uniformBuffer } }
    ]
});
const pipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    vertex: {
        module: shader,
        entryPoint: "vertexMain",
        buffers: [{
            arrayStride: 16,
            attributes: [
                { shaderLocation: 0, offset: 0, format: "float32x2" },
                { shaderLocation: 1, offset: 8, format: "float32x2" }
            ]
        }]
    },
    fragment: {
        module: shader,
        entryPoint: "fragmentMain",
        targets: [{
            format,
            blend: {
                color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
                alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" }
            }
        }]
    },
    primitive: { topology: "triangle-list" }
});

const keys = new Set();
const keyMap = new Map([
    ["ArrowUp", "up"], ["w", "up"], ["W", "up"],
    ["ArrowDown", "down"], ["s", "down"], ["S", "down"],
    ["ArrowLeft", "left"], ["a", "left"], ["A", "left"],
    ["ArrowRight", "right"], ["d", "right"], ["D", "right"]
]);
window.addEventListener("keydown", event => {
    if (keyMap.has(event.key)) { event.preventDefault(); keys.add(keyMap.get(event.key)); }
});
window.addEventListener("keyup", event => keys.delete(keyMap.get(event.key)));
window.addEventListener("blur", () => keys.clear());

const frameWidth = 64;
const frameHeight = 64;
const frameCount = Math.floor(textureWidth / frameWidth);
const uniformData = new Float32Array(8);
let x = 0, y = 0, frame = 0, previousTime = 0;

function render(now) {
    const delta = previousTime ? Math.min((now - previousTime) / 1000, 0.05) : 0;
    previousTime = now;
    let dx = Number(keys.has("right")) - Number(keys.has("left"));
    let dy = Number(keys.has("down")) - Number(keys.has("up"));
    const moving = dx !== 0 || dy !== 0;
    if (moving) {
        const length = Math.hypot(dx, dy);
        dx /= length;
        dy /= length;
        x += dx * delta * 0.9;
        y -= dy * delta * 0.9;
        frame = Math.floor(now / 120) % frameCount;
    } else {
        frame = 0;
    }

    x = Math.max(-0.82, Math.min(0.82, x));
    y = Math.max(-0.72, Math.min(0.72, y));
    uniformData[0] = x;
    uniformData[1] = y;
    uniformData[4] = frame * frameWidth / textureWidth;
    uniformData[5] = 0;
    uniformData[6] = frameWidth / textureWidth;
    uniformData[7] = frameHeight / textureHeight;
    device.queue.writeBuffer(uniformBuffer, 0, uniformData);

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
        colorAttachments: [{
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0.055, g: 0.075, b: 0.10, a: 1 },
            loadOp: "clear",
            storeOp: "store"
        }]
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setVertexBuffer(0, vertexBuffer);
    pass.draw(6);
    pass.end();
    device.queue.submit([encoder.finish()]);
    requestAnimationFrame(render);
}

status.textContent = `Ready · ${textureWidth}×${textureHeight} RGBA · ${frameCount} frames`;
requestAnimationFrame(render);
