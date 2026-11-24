import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const cases = [
    ['8u', Uint8Array, [0, 127, 200, 255]],
    ['16u', Uint16Array, [0x1234, 0xabcd, 0, 65535]],
    ['32u', Uint32Array, [0x12345678, 0x89abcdef, 0, 0xffffffff]],
    ['64u', BigUint64Array, [0x0123456789abcdefn, 0xfedcba9876543210n]],
    ['8i', Int8Array, [-128, -1, 0, 127]],
    ['16i', Int16Array, [-32768, -12345, 0, 32767]],
    ['32i', Int32Array, [-2147483648, -123456789, 0, 2147483647]],
    ['64i', BigInt64Array, [-9223372036854775808n, -1n, 0n, 9223372036854775807n]],
    ['32f', Float32Array, [Math.PI, -123.5, 0, 1e-30]],
    ['64f', Float64Array, [Math.PI, -123.5, 0, 1e-200]]
];

const dir = './interop-data';

const languages = ['en', 'ar', 'es', 'jp', 'pt', 'zh'];

for (const lang of languages) {
    const module = await import(`../src/${lang}/balloc.mjs`);
    const Balloc = module.default;

    for (const [type, TypedArray, values] of cases) {
        const memory = new Balloc(65535, type);
        const file = join(dir, `${type}.${lang}`);

        const serialized = readFileSync(file);
        const handler = memory.load(serialized);

        const actual = Array.from(memory.pick(handler));
        const expected = Array.from(new TypedArray(values));

        assert.deepStrictEqual(actual, expected, `"${lang}/balloc.mjs" module failed in type ´${type}´ validation.`);

        console.log(`Type '${type}' was successfully validated with "${lang}/balloc.mjs".`);
    }
}

console.log('All reading tests were passed.');