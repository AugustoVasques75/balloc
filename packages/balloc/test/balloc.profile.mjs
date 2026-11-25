
import { performance } from "node:perf_hooks";
import Balloc from "../src/pt/balloc.mjs";

const SIZES = [4, 16, 64, 256, 1024, 16384, 65536, 131072, 262144, 524288, 1048576];
const TARGET_ELEMENTS = 262144;
const WARMUP_ROUNDS = 2;
const SAMPLE_ROUNDS = 7;
const WORD_SIZE = 4;

const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];

function measure(fn, passes, elements) {
    for (let i = 0; i < WARMUP_ROUNDS; i++) fn(passes);

    const samples = [];
    for (let i = 0; i < SAMPLE_ROUNDS; i++) {
        const start = performance.now();
        fn(passes);
        samples.push(performance.now() - start);
    }

    const elapsed = median(samples) / 1000;
    const operations = passes * elements;
    return {
        nsPerElement: elapsed * 1e9 / operations,
        mibPerSecond: operations * WORD_SIZE / elapsed / (1024 * 1024)
    };
}

function createFixture(elements) {
    const memory = new Balloc(Math.max(1024, elements * WORD_SIZE * 2), "32u");
    const handler = memory.alloc(elements);
    const seed = new Uint32Array(elements);

    for (let i = 0; i < elements; i++) seed[i] = i;
    memory.put(handler, seed);

    const meta = memory.extractMetadata(handler, {});
    const start = meta.dataAddress >>> memory.wordShift;
    const directView = memory.auxiliary.subarray(start, start + meta.occupied);

    return { memory, handler, directView };
}

function runRead(fixture, passes, method) {
    const { memory, handler, directView } = fixture;
    let checksum = 0;

    for (let pass = 0; pass < passes; pass++) {
        if (method === "get") {
            for (let i = 0; i < directView.length; i++) checksum += memory.get(handler, i);
        } else if (method === "withView") {
            checksum += memory.withView(handler, (view) => {
                let sum = 0;
                for (let i = 0; i < view.length; i++) sum += view[i];
                return sum;
            });
        } else {
            for (let i = 0; i < directView.length; i++) checksum += directView[i];
        }
    }

    return checksum;
}

function runWrite(fixture, passes, method) {
    const { memory, handler, directView } = fixture;

    for (let pass = 0; pass < passes; pass++) {
        if (method === "set") {
            for (let i = 0; i < directView.length; i++) {
                memory.set(handler, i, (directView[i] + 1) >>> 0);
            }
        } else if (method === "withView") {
            memory.withView(handler, (view) => {
                for (let i = 0; i < view.length; i++) view[i] = (view[i] + 1) >>> 0;
            });
        } else {
            for (let i = 0; i < directView.length; i++) {
                directView[i] = (directView[i] + 1) >>> 0;
            }
        }
    }
}


const line = "─".repeat(91);

function report(size, mode, results) {
    const baseline = results.direct.nsPerElement;
    const title = mode === "read" ? "READ" : "WRITE";

    console.log(`\n${line}`);
    console.log(`  ${title}  |  ${size.toLocaleString("en-US")} elements`);
    console.log(line);
    console.log("  METHOD       ns/element       MiB/s       vs. direct");
    console.log(`  ${"-".repeat(59)}`);

    for (const [method, result] of Object.entries(results)) {
        const relative = baseline / result.nsPerElement;
        const name = method.padEnd(12);
        const ns = result.nsPerElement.toFixed(2).padStart(10);
        const throughput = result.mibPerSecond.toFixed(2).padStart(12);
        const ratio = `${relative.toFixed(2)}x`.padStart(14);

        console.log(`  ${name}${ns}${throughput}${ratio}`);
    }

    const conventional = mode === "read" ? results.get : results.set;
    const gain = conventional.nsPerElement / results.withView.nsPerElement;

    console.log(`\n  withView gain: ${gain.toFixed(2)}x over ${mode === "read" ? "get" : "set"}`);
}


//console.log("elements\tmode\tmethod\tns/element\tMiB/s\tvs-direct");

for (const elements of SIZES) {
    const fixture = createFixture(elements);
    const passes = Math.max(1, Math.ceil(TARGET_ELEMENTS / elements));

    const reads = {
        get: measure((n) => runRead(fixture, n, "get"), passes, elements),
        withView: measure((n) => runRead(fixture, n, "withView"), passes, elements),
        direct: measure((n) => runRead(fixture, n, "direct"), passes, elements)
    };

    report(elements, "read", reads);

    const writes = {
        set: measure((n) => runWrite(fixture, n, "set"), passes, elements),
        withView: measure((n) => runWrite(fixture, n, "withView"), passes, elements),
        direct: measure((n) => runWrite(fixture, n, "direct"), passes, elements)
    };

    report(elements, "write", writes);
}
