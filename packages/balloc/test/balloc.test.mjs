import { describe, it, expect, vi } from "vitest";
import Balloc from "../src/pt/balloc.mjs";

describe("Balloc", () => {
    describe("loadData", () => {
        it("delegates data ingestion to the adapter and returns its handler", () => {
            const memory = new Balloc(64, "8u");
            const adapter = {
                load(allocator) {
                    const handler = allocator.alloc(4);
                    allocator.put(handler, [10, 20, 30]);
                    return handler;
                }
            };

            const handler = memory.loadData(adapter);

            expect(memory.pick(handler)).toEqual(new Uint8Array([10, 20, 30]));
            expect(memory.occupied(handler)).toBe(3);
        });

        it("passes the current allocator instance to the adapter", () => {
            const memory = new Balloc();
            const load = vi.fn(() => 123);

            expect(memory.loadData({ load })).toBe(123);
            expect(load).toHaveBeenCalledOnce();
            expect(load).toHaveBeenCalledWith(memory);
        });

        it("rejects adapters that do not implement load()", () => {
            const memory = new Balloc();

            for (const adapter of [null, undefined, {}, { load: 1 }]) {
                expect(() => memory.loadData(adapter)).toThrow(TypeError);
            }
        });
    });

    describe("constructor", () => {
        it.each([2, 4, 8, 16, 32, 64, 128, 256])("reserva exatamente %i bytes quando size é potência de dois", (size) => {
            const memory = new Balloc(size, "8u", 16);
            expect(memory.dataBus.byteLength).toBe(size);
        });

        it.each([16, 32, 64, 128, 256])("reserva exatamente %i bytes para metadataSize", (size) => {
            const memory = new Balloc(64, "8u", size);
            expect(memory.controlBus.byteLength).toBe(size);
        });

        it.each([0, 1, -1, 2.5, NaN, Infinity, 0x80000001])("rejeita size inválido: %s", (size) => {
            expect(() => new Balloc(size)).toThrow(RangeError);
        });

        it.each(["8u", "16u", "32u", "64u", "8i", "16i", "32i", "64i", "32f", "64f"])("aceita bucketSize %s", (type) => {
            expect(() => new Balloc(64, type)).not.toThrow();
        });

        it.each(["8f", "16x", "32", "128u", "", null, undefined])("rejeita bucketSize inválido: %s", (type) => {
            if (type === undefined) return;
            expect(() => new Balloc(64, type)).toThrow(RangeError);
        });

        it.each([0, 1, 2, 8, 15, 2.5, NaN, Infinity])("rejeita metadataSize inválido: %s", (size) => {
            expect(() => new Balloc(64, "8u", size)).toThrow(RangeError);
        });
    });

    describe("alloc / capacidade", () => {
        it.each([
            [2, 2], [3, 4], [4, 4], [5, 8], [7, 8],
            [8, 8], [9, 16], [15, 16], [16, 16], [17, 32]
        ])("alloc(%i) deve reservar %i slots", (requested, capacity) => {
            const memory = new Balloc(64, "8u");
            const handler = memory.alloc(requested);
            expect(memory.length(handler)).toBe(capacity);
            expect(memory.occupied(handler)).toBe(0);
            expect(memory.byteSize(handler)).toBe(capacity);
        });

        it("converte capacidade de elementos para bytes conforme bucketSize", () => {
            const memory = new Balloc(64, "32u");
            const handler = memory.alloc(5);
            expect(memory.length(handler)).toBe(8);
            expect(memory.byteSize(handler)).toBe(32);
        });

        it("rejeita tamanhos inválidos", () => {
            const memory = new Balloc();
            for (const size of [0, 1, -1, 2.5, NaN, Infinity, 0x80000001]) {
                expect(() => memory.alloc(size)).toThrow(RangeError);
            }
        });

        it("cresce o dataBus quando a capacidade disponível é insuficiente", () => {
            const memory = new Balloc(16, "8u");
            const first = memory.alloc(16);
            const second = memory.alloc(16);
            expect(memory.length(first)).toBe(16);
            expect(memory.length(second)).toBe(16);
            expect(memory.dataBus.byteLength).toBeGreaterThanOrEqual(32);
        });

        it("mantém handlers distintos para blocos simultaneamente vivos", () => {
            const memory = new Balloc();
            const handlers = Array.from({ length: 32 }, () => memory.alloc(2));
            expect(new Set(handlers).size).toBe(handlers.length);
        });
    });

    describe("Stack", () => {
        it("push, peek e pop respeitam LIFO e ocupação", () => {
            const memory = new Balloc(64, "32u");
            const handler = memory.alloc(4);

            expect(memory.pop(handler)).toBeUndefined();
            expect(memory.peek(handler)).toBeUndefined();
            expect(memory.push(handler, 10)).toBe(true);
            expect(memory.push(handler, 20)).toBe(true);
            expect(memory.push(handler, 30)).toBe(true);
            expect(memory.occupied(handler)).toBe(3);
            expect(memory.peek(handler)).toBe(30);
            expect(memory.occupied(handler)).toBe(3);
            expect(memory.pop(handler)).toBe(30);
            expect(memory.pop(handler)).toBe(20);
            expect(memory.pop(handler)).toBe(10);
            expect(memory.pop(handler)).toBeUndefined();
            expect(memory.occupied(handler)).toBe(0);
        });

        it("não insere elementos quando o bloco está cheio", () => {
            const memory = new Balloc(64, "32u");
            const handler = memory.alloc(2);

            expect(memory.push(handler, 1)).toBe(true);
            expect(memory.push(handler, 2)).toBe(true);
            expect(memory.push(handler, 3)).toBe(false);
            expect(memory.pick(handler)).toEqual(new Uint32Array([1, 2]));
            expect(memory.occupied(handler)).toBe(2);
        });
    });

    describe("Queue", () => {
        it("nudge, head e pull respeitam FIFO", () => {
            const memory = new Balloc(64, "32u");
            const handler = memory.alloc(8);

            expect(memory.pull(handler)).toBeUndefined();
            expect(memory.head(handler)).toBeUndefined();
            expect(memory.nudge(handler, 30)).toBe(true);
            expect(memory.nudge(handler, 20)).toBe(true);
            expect(memory.nudge(handler, 10)).toBe(true);
            expect(memory.head(handler)).toBe(10);
            expect(memory.pull(handler)).toBe(10);
            expect(memory.pull(handler)).toBe(20);
            expect(memory.pull(handler)).toBe(30);
            expect(memory.pull(handler)).toBeUndefined();
            expect(memory.occupied(handler)).toBe(0);
        });

        it("não altera a fila quando está cheia", () => {
            const memory = new Balloc(64, "8u");
            const handler = memory.alloc(2);

            expect(memory.nudge(handler, 1)).toBe(true);
            expect(memory.nudge(handler, 2)).toBe(true);
            expect(memory.nudge(handler, 3)).toBe(false);
            expect(memory.pick(handler)).toEqual(new Uint8Array([2, 1]));
        });
    });

    describe("acesso ao conteúdo", () => {
        it("put e pick preservam conteúdo e tipo da TypedArray", () => {
            const memory = new Balloc(64, "32u");
            const handler = memory.alloc(8);

            memory.put(handler, [10, 20, 30]);
            expect(memory.pick(handler)).toBeInstanceOf(Uint32Array);
            expect(memory.pick(handler)).toEqual(new Uint32Array([10, 20, 30]));
            expect(memory.occupied(handler)).toBe(3);
        });

        it("put aceita TypedArray e limita a cópia à capacidade", () => {
            const memory = new Balloc(64, "8u");
            const handler = memory.alloc(4);

            memory.put(handler, new Uint8Array([1, 2, 3, 4, 5, 6]));
            expect(memory.pick(handler)).toEqual(new Uint8Array([1, 2, 3, 4]));
            expect(memory.occupied(handler)).toBe(4);
        });

        it("put não reduz a ocupação ao receber uma sequência menor", () => {
            const memory = new Balloc(64, "8u");
            const handler = memory.alloc(8);

            memory.put(handler, [1, 2, 3, 4]);
            memory.put(handler, [9]);
            expect(memory.pick(handler)).toEqual(new Uint8Array([9, 2, 3, 4]));
            expect(memory.occupied(handler)).toBe(4);
        });

        it("put rejeita dados que não sejam Array ou TypedArray", () => {
            const memory = new Balloc();
            const handler = memory.alloc(4);

            for (const value of [null, undefined, 10, "abc", {}, new DataView(new ArrayBuffer(8))]) {
                expect(() => memory.put(handler, value)).toThrow(TypeError);
            }
        });

        it("get, set e has operam somente sobre elementos ocupados", () => {
            const memory = new Balloc(64, "32u");
            const handler = memory.alloc(8);

            memory.put(handler, [10, 20, 30]);
            expect(memory.get(handler, 0)).toBe(10);
            expect(memory.get(handler, 2)).toBe(30);
            expect(memory.get(handler, 3)).toBeUndefined();
            expect(memory.set(handler, 1, 99)).toBe(true);
            expect(memory.set(handler, 3, 40)).toBe(false);
            expect(memory.get(handler, 1)).toBe(99);
            expect(memory.has(handler, 99)).toBe(true);
            expect(memory.has(handler, 20)).toBe(false);
            expect(memory.has(handler, 0)).toBe(false);
            expect(memory.occupied(handler)).toBe(3);
        });

        it("clear zera a ocupação sem alterar a capacidade", () => {
            const memory = new Balloc(64, "8u");
            const handler = memory.alloc(8);

            memory.put(handler, [1, 2, 3, 4]);
            const capacity = memory.length(handler);
            memory.clear(handler);

            expect(memory.length(handler)).toBe(capacity);
            expect(memory.occupied(handler)).toBe(0);
            expect(memory.pick(handler)).toEqual(new Uint8Array());
        });

        it("clear aceita valor de preenchimento", () => {
            const memory = new Balloc(64, "8u");
            const handler = memory.alloc(4);

            memory.clear(handler, 7);
            expect(memory.occupied(handler)).toBe(0);
            expect(memory.dataBus.slice(0, 4)).toEqual(new Uint8Array([7, 7, 7, 7]));
        });

        it("fill preenche intervalo [start, end) e atualiza ocupação", () => {
            const memory = new Balloc(64, "8u");
            const handler = memory.alloc(8);

            memory.fill(handler, 5, 2, 6);
            expect(memory.occupied(handler)).toBe(6);
            expect(memory.pick(handler)).toEqual(new Uint8Array([0, 0, 5, 5, 5, 5]));
        });

        it("fill rejeita intervalos fora da capacidade", () => {
            const memory = new Balloc(64, "8u");
            const handler = memory.alloc(8);

            for (const [start, end] of [[-1, 2], [0, 9], [5, 4], [0, -1], [9, 9]]) {
                expect(() => memory.fill(handler, 1, start, end)).toThrow(RangeError);
            }
        });

        it("fillAll ocupa e preenche toda a capacidade", () => {
            const memory = new Balloc(64, "16u");
            const handler = memory.alloc(4);

            memory.fillAll(handler, 1234);
            expect(memory.occupied(handler)).toBe(memory.length(handler));
            expect(memory.pick(handler)).toEqual(new Uint16Array([1234, 1234, 1234, 1234]));
        });
    });

    describe("operações entre blocos", () => {
        it("copy limita a transferência à capacidade do destino", () => {
            const memory = new Balloc(128, "8u");
            const source = memory.alloc(8);
            const target = memory.alloc(2);

            memory.put(source, [1, 2, 3, 4, 5, 6]);
            memory.copy(source, target);

            expect(memory.pick(target)).toEqual(new Uint8Array([1, 2]));
            expect(memory.occupied(target)).toBe(2);
        });

        it("copy respeita o limite explícito de slots", () => {
            const memory = new Balloc(128, "8u");
            const source = memory.alloc(8);
            const target = memory.alloc(8);

            memory.put(source, [1, 2, 3, 4]);
            memory.copy(source, target, 2);

            expect(memory.pick(target)).toEqual(new Uint8Array([1, 2]));
            expect(memory.occupied(target)).toBe(2);
        });

        it("append acrescenta elementos sem sobrescrever o destino", () => {
            const memory = new Balloc(128, "8u");
            const target = memory.alloc(8);
            const source = memory.alloc(8);

            memory.put(target, [1, 2]);
            memory.put(source, [3, 4, 5]);

            expect(memory.append(target, source)).toBe(3);
            expect(memory.pick(target)).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
            expect(memory.occupied(target)).toBe(5);
        });

        it("append limita a quantidade ao espaço restante", () => {
            const memory = new Balloc(128, "8u");
            const target = memory.alloc(4);
            const source = memory.alloc(8);

            memory.fillAll(target, 1);
            memory.put(source, [2, 3, 4]);

            expect(memory.append(target, source)).toBe(0);
            expect(memory.pick(target)).toEqual(new Uint8Array([1, 1, 1, 1]));
        });

        it("copyWithin trata regiões sobrepostas", () => {
            const memory = new Balloc(128, "8u");
            const handler = memory.alloc(8);

            memory.put(handler, [1, 2, 3, 4, 5]);
            memory.copyWithin(handler, 1, 0, 4);

            expect(memory.pick(handler)).toEqual(new Uint8Array([1, 1, 2, 3, 4]));
        });

        it("clone cria bloco independente com mesma capacidade e conteúdo", () => {
            const memory = new Balloc(128, "32u");
            const original = memory.alloc(8);

            memory.put(original, [10, 20, 30]);
            const clone = memory.clone(original);

            expect(clone).not.toBe(original);
            expect(memory.length(clone)).toBe(memory.length(original));
            expect(memory.occupied(clone)).toBe(memory.occupied(original));
            expect(memory.pick(clone)).toEqual(memory.pick(original));

            memory.set(clone, 0, 99);
            expect(memory.get(original, 0)).toBe(10);
            expect(memory.get(clone, 0)).toBe(99);
        });

        it("swap troca conteúdo, capacidade e ocupação entre handlers", () => {
            const memory = new Balloc(128, "8u");
            const a = memory.alloc(4);
            const b = memory.alloc(8);

            memory.put(a, [1, 2]);
            memory.put(b, [7, 8, 9, 10]);

            const aCapacity = memory.length(a);
            const bCapacity = memory.length(b);

            memory.swap(a, b);

            expect(memory.length(a)).toBe(bCapacity);
            expect(memory.length(b)).toBe(aCapacity);
            expect(memory.pick(a)).toEqual(new Uint8Array([7, 8, 9, 10]));
            expect(memory.pick(b)).toEqual(new Uint8Array([1, 2]));
        });
    });

    describe("shrink", () => {
        it("reduz um bloco no topo sem reciclar a cauda", () => {
            const memory = new Balloc(64, "8u");
            const handler = memory.alloc(16);
            memory.put(handler, [10, 20, 30]);

            memory.shrink(handler);

            expect(memory.length(handler)).toBe(4);
            expect(memory.occupied(handler)).toBe(3);
            expect(memory.pick(handler)).toEqual(new Uint8Array([10, 20, 30]));
            expect(memory.dataPointer).toBe(4);
            expect(memory.recycleBytes).toBe(0);
        });

        it("decompõe a cauda de um bloco não localizado no topo em regiões recicláveis", () => {
            const memory = new Balloc(64, "8u");
            const handler = memory.alloc(16);
            const other = memory.alloc(2);
            memory.put(handler, [10, 20, 30]);
            memory.put(other, [90]);

            memory.shrink(handler);

            expect(memory.length(handler)).toBe(4);
            expect(memory.occupied(handler)).toBe(3);
            expect(memory.pick(handler)).toEqual(new Uint8Array([10, 20, 30]));
            expect(memory.pick(other)).toEqual(new Uint8Array([90]));
            expect(memory.recycle.get(4)[0]).toBe(1);
            expect(memory.recycle.get(8)[0]).toBe(1);

            const eight = memory.alloc(8);
            const four = memory.alloc(4);
            memory.withView(eight, view => expect(view.byteOffset).toBe(8));
            memory.withView(four, view => expect(view.byteOffset).toBe(4));
        });

        it("preserva alinhamento em bytes para buckets maiores que um byte", () => {
            const memory = new Balloc(256, "32u");
            const handler = memory.alloc(16);
            memory.alloc(2);
            memory.put(handler, [10, 20, 30]);

            memory.shrink(handler);

            const eight = memory.alloc(8);
            const four = memory.alloc(4);
            memory.withView(eight, view => {
                expect(view.byteOffset).toBe(32);
                expect(view).toBeInstanceOf(Uint32Array);
            });
            memory.withView(four, view => {
                expect(view.byteOffset).toBe(16);
                expect(view).toBeInstanceOf(Uint32Array);
            });
        });

        it("usa capacidade mínima de dois slots para blocos vazios ou com um elemento", () => {
            const memory = new Balloc(64, "8u");
            const empty = memory.alloc(16);
            const single = memory.alloc(8);
            memory.push(single, 7);

            memory.shrink(empty);
            memory.shrink(single);

            expect(memory.length(empty)).toBe(2);
            expect(memory.length(single)).toBe(2);
            expect(memory.pick(single)).toEqual(new Uint8Array([7]));
        });

        it("não altera blocos que já possuem capacidade suficiente", () => {
            const memory = new Balloc(64, "8u");
            const handler = memory.alloc(4);
            memory.put(handler, [1, 2, 3]);

            memory.shrink(handler);

            expect(memory.length(handler)).toBe(4);
            expect(memory.recycleBytes).toBe(0);
        });

        it("preserva handler e endereço do bloco", () => {
            const memory = new Balloc(64, "32u");
            const handler = memory.alloc(16);
            memory.put(handler, [10, 20, 30]);
            let originalAddress;

            memory.withView(handler, view => { originalAddress = view.byteOffset; });
            memory.shrink(handler);

            expect(memory.length(handler)).toBe(4);
            memory.withView(handler, view => expect(view.byteOffset).toBe(originalAddress));
            expect(memory.pick(handler)).toEqual(new Uint32Array([10, 20, 30]));
        });

        it("bloqueia a contração do próprio bloco enquanto está emprestado", () => {
            const memory = new Balloc(64, "8u");
            const handler = memory.alloc(16);
            memory.put(handler, [1, 2, 3]);

            expect(() => memory.withView(handler, () => memory.shrink(handler))).toThrow(/borrowed/i);
            expect(memory.length(handler)).toBe(16);
            memory.shrink(handler);
            expect(memory.length(handler)).toBe(4);
        });

        it("permite contrair um bloco enquanto outro bloco possui view ativa", () => {
            const memory = new Balloc(64, "8u");
            const borrowed = memory.alloc(2);
            const target = memory.alloc(16);
            memory.put(target, [1, 2, 3]);

            memory.withView(borrowed, () => memory.shrink(target));

            expect(memory.length(target)).toBe(4);
            expect(memory.pick(target)).toEqual(new Uint8Array([1, 2, 3]));
        });

        it("rejeita handlers inválidos", () => {
            const memory = new Balloc(64, "8u");
            const handler = memory.alloc(16);
            memory.free(handler);

            expect(() => memory.shrink(handler)).toThrow();
        });
    });

    describe("realloc", () => {
        it("duplica a capacidade e preserva os elementos ocupados", () => {
            const memory = new Balloc(128, "32u");
            const handler = memory.alloc(4);

            memory.put(handler, [11, 22, 33, 44]);
            const previousCapacity = memory.length(handler);

            memory.realloc(handler);

            expect(memory.length(handler)).toBe(previousCapacity * 2);
            expect(memory.occupied(handler)).toBe(4);
            expect(memory.pick(handler)).toEqual(new Uint32Array([11, 22, 33, 44]));
        });

        it("mantém o handler válido após expansão", () => {
            const memory = new Balloc(128, "8u");
            const handler = memory.alloc(4);

            memory.put(handler, [1, 2, 3]);
            memory.realloc(handler);

            expect(memory.get(handler, 0)).toBe(1);
            expect(memory.get(handler, 1)).toBe(2);
            expect(memory.get(handler, 2)).toBe(3);
        });
    });

    describe("free / reciclagem / gc", () => {
        it("free invalida o handler", () => {
            const memory = new Balloc(128, "8u");
            const handler = memory.alloc(8);

            memory.put(handler, [1, 2, 3]);
            memory.free(handler);

            expect(() => memory.get(handler, 0)).toThrow();
            expect(() => memory.occupied(handler)).toThrow();
        });

        it("reutiliza região liberada com capacidade correspondente", () => {
            const memory = new Balloc(128, "8u");
            const first = memory.alloc(8);
            const second = memory.alloc(8);

            memory.free(first);
            const recycled = memory.alloc(8);

            expect(memory.length(recycled)).toBe(8);
            expect(memory.recycleCount()).toBe(0);
            expect(() => memory.get(second, 0)).not.toThrow();
        });

        it("gc preserva handlers, conteúdo, capacidade e ocupação dos blocos vivos", () => {
            const memory = new Balloc(256, "32u");
            const a = memory.alloc(8);
            const b = memory.alloc(8);
            const c = memory.alloc(8);

            memory.put(a, [1, 2, 3]);
            memory.put(b, [4, 5, 6, 7]);
            memory.put(c, [8, 9]);

            const before = [a, b, c].map(handler => ({
                values: memory.pick(handler),
                length: memory.length(handler),
                occupied: memory.occupied(handler)
            }));

            memory.free(b);
            memory.gc();

            for (const [index, handler] of [a, c].entries()) {
                const expected = before[index === 0 ? 0 : 2];
                expect(memory.pick(handler)).toEqual(expected.values);
                expect(memory.length(handler)).toBe(expected.length);
                expect(memory.occupied(handler)).toBe(expected.occupied);
            }

            expect(() => memory.get(b, 0)).toThrow();
            expect(memory.recycleCount()).toBe(0);
            expect(memory.recycleBytes).toBe(0);
        });

        it("rejeita handler já liberado", () => {
            const memory = new Balloc();
            const handler = memory.alloc(4);

            memory.free(handler);
            expect(() => memory.free(handler)).toThrow();
        });
    });

    describe("serialização", () => {
        it("dump e load preservam tipo, ocupação e conteúdo", () => {
            const sourceMemory = new Balloc(128, "32u");
            const source = sourceMemory.alloc(8);

            sourceMemory.put(source, [100, 200, 300, 400]);
            const serialized = sourceMemory.dump(source);

            expect(serialized).toBeInstanceOf(Uint8Array);

            const targetMemory = new Balloc(128, "32u");
            const restored = targetMemory.load(serialized);

            expect(targetMemory.pick(restored)).toEqual(new Uint32Array([100, 200, 300, 400]));
            expect(targetMemory.occupied(restored)).toBe(4);
            expect(targetMemory.length(restored)).toBe(8);
        });

        it("load rejeita dados serializados com bucket incompatível", () => {
            const sourceMemory = new Balloc(128, "32u");
            const source = sourceMemory.alloc(4);
            sourceMemory.put(source, [1, 2, 3]);

            const serialized = sourceMemory.dump(source);
            const targetMemory = new Balloc(128, "8u");

            expect(() => targetMemory.load(serialized)).toThrow();
        });
    });

    describe("diagnóstico", () => {
        it("inicia com heap vazio e sem fragmentação", () => {
            const memory = new Balloc(64, "8u");

            expect(memory.recycleCount()).toBe(0);
            expect(memory.recycleBytes).toBe(0);
            expect(memory.allocatedBytes).toBe(0);
            expect(memory.unallocatedBytes).toBe(memory.size);
            expect(memory.fragmentationRatio).toBe(0);
        });

        it("mantém consistência entre bytes alocados, recicláveis e ponteiro", () => {
            const memory = new Balloc(128, "8u");
            const a = memory.alloc(8);
            const b = memory.alloc(8);

            memory.free(a);

            expect(memory.recycleBytes).toBe(8);
            expect(memory.allocatedBytes).toBe(memory.dataPointer - memory.recycleBytes);
            expect(memory.unallocatedBytes).toBe(memory.size - memory.dataPointer);
            expect(memory.fragmentationRatio).toBe(memory.recycleBytes / memory.dataPointer);

            memory.free(b);
            expect(memory.recycleBytes).toBe(8);
            expect(memory.dataPointer).toBe(8);
            expect(memory.allocatedBytes).toBe(0);
            expect(memory.recycleCount()).toBe(1);
        });
    });


    describe("busca", () => {
        it("indexOf localiza a primeira ocorrência entre os elementos ocupados", () => {
            const memory = new Balloc(64, "8u");
            const handler = memory.alloc(8);

            memory.put(handler, [10, 20, 10, 30]);

            expect(memory.indexOf(handler, 10)).toBe(0);
            expect(memory.indexOf(handler, 20)).toBe(1);
            expect(memory.indexOf(handler, 10, 1)).toBe(2);
            expect(memory.indexOf(handler, 30)).toBe(3);
            expect(memory.indexOf(handler, 99)).toBe(-1);
        });

        it("indexOf respeita fromIndex e a semântica de índices negativos", () => {
            const memory = new Balloc(64, "8u");
            const handler = memory.alloc(8);

            memory.put(handler, [10, 20, 10, 30]);

            expect(memory.indexOf(handler, 10, 2)).toBe(2);
            expect(memory.indexOf(handler, 10, 3)).toBe(-1);
            expect(memory.indexOf(handler, 10, -2)).toBe(2);
            expect(memory.indexOf(handler, 10, -1)).toBe(-1);
            expect(memory.indexOf(handler, 10, 8)).toBe(-1);
        });

        it("indexOf ignora posições não ocupadas", () => {
            const memory = new Balloc(64, "8u");
            const handler = memory.alloc(8);

            memory.put(handler, [10, 20, 30]);
            memory.dataBus[7] = 99;

            expect(memory.indexOf(handler, 99)).toBe(-1);
            expect(memory.indexOf(handler, 30)).toBe(2);
        });

        it("indexOf retorna -1 quando o bloco está vazio", () => {
            const memory = new Balloc(64, "8u");
            const handler = memory.alloc(4);

            expect(memory.indexOf(handler, 10)).toBe(-1);
        });

        it("lastIndexOf localiza a última ocorrência entre os elementos ocupados", () => {
            const memory = new Balloc(64, "8u");
            const handler = memory.alloc(8);

            memory.put(handler, [10, 20, 10, 30, 10]);

            expect(memory.lastIndexOf(handler, 10)).toBe(4);
            expect(memory.lastIndexOf(handler, 20)).toBe(1);
            expect(memory.lastIndexOf(handler, 30)).toBe(3);
            expect(memory.lastIndexOf(handler, 99)).toBe(-1);
        });

        it("lastIndexOf respeita fromIndex e a semântica de índices negativos", () => {
            const memory = new Balloc(64, "8u");
            const handler = memory.alloc(8);

            memory.put(handler, [10, 20, 10, 30, 10]);

            expect(memory.lastIndexOf(handler, 10, 3)).toBe(2);
            expect(memory.lastIndexOf(handler, 10, 1)).toBe(0);
            expect(memory.lastIndexOf(handler, 10, -2)).toBe(2);
            expect(memory.lastIndexOf(handler, 10, -3)).toBe(2);
            expect(memory.lastIndexOf(handler, 10, -5)).toBe(0);
            expect(memory.lastIndexOf(handler, 10, -6)).toBe(-1);
        });

        it("lastIndexOf ignora posições não ocupadas", () => {
            const memory = new Balloc(64, "8u");
            const handler = memory.alloc(8);

            memory.put(handler, [10, 20, 30]);
            memory.dataBus[7] = 99;

            expect(memory.lastIndexOf(handler, 99)).toBe(-1);
            expect(memory.lastIndexOf(handler, 30)).toBe(2);
        });

        it("lastIndexOf retorna -1 quando o bloco está vazio", () => {
            const memory = new Balloc(64, "8u");
            const handler = memory.alloc(4);

            expect(memory.lastIndexOf(handler, 10)).toBe(-1);
        });

        it("indexOf e lastIndexOf preservam a semântica de BigInt", () => {
            const memory = new Balloc(64, "64u");
            const handler = memory.alloc(8);

            memory.put(handler, [10n, 20n, 10n, 30n]);

            expect(memory.indexOf(handler, 10n)).toBe(0);
            expect(memory.indexOf(handler, 10n, 1)).toBe(2);
            expect(memory.lastIndexOf(handler, 10n)).toBe(2);
            expect(memory.lastIndexOf(handler, 10n, 1)).toBe(0);
            expect(memory.indexOf(handler, 10)).toBe(-1);
        });

        it("indexOf e lastIndexOf rejeitam handlers inválidos", () => {
            const memory = new Balloc(64, "8u");
            const handler = memory.alloc(4);

            memory.free(handler);

            expect(() => memory.indexOf(handler, 10)).toThrow();
            expect(() => memory.lastIndexOf(handler, 10)).toThrow();
        });
    });

    describe("isFull", () => {
        it("retorna false para blocos vazios e parcialmente ocupados", () => {
            const memory = new Balloc(64, "8u");
            const handler = memory.alloc(4);

            expect(memory.isFull(handler)).toBe(false);

            memory.push(handler, 10);
            expect(memory.isFull(handler)).toBe(false);

            memory.push(handler, 20);
            expect(memory.isFull(handler)).toBe(false);
        });

        it("retorna true quando todos os slots estão ocupados", () => {
            const memory = new Balloc(64, "8u");
            const handler = memory.alloc(4);

            memory.fillAll(handler, 7);

            expect(memory.occupied(handler)).toBe(memory.length(handler));
            expect(memory.isFull(handler)).toBe(true);
        });

        it("retorna false novamente após a remoção de um elemento", () => {
            const memory = new Balloc(64, "8u");
            const handler = memory.alloc(4);

            memory.fillAll(handler, 7);
            expect(memory.isFull(handler)).toBe(true);

            memory.pop(handler);

            expect(memory.isFull(handler)).toBe(false);
        });

        it("retorna false após limpar um bloco cheio", () => {
            const memory = new Balloc(64, "8u");
            const handler = memory.alloc(4);

            memory.fillAll(handler, 7);
            expect(memory.isFull(handler)).toBe(true);

            memory.clear(handler);

            expect(memory.occupied(handler)).toBe(0);
            expect(memory.isFull(handler)).toBe(false);
        });

        it("acompanha a capacidade após realloc", () => {
            const memory = new Balloc(64, "8u");
            const handler = memory.alloc(2);

            memory.fillAll(handler, 7);
            expect(memory.isFull(handler)).toBe(true);

            memory.realloc(handler);

            expect(memory.length(handler)).toBe(4);
            expect(memory.occupied(handler)).toBe(2);
            expect(memory.isFull(handler)).toBe(false);
        });

        it("rejeita handlers inválidos", () => {
            const memory = new Balloc(64, "8u");
            const handler = memory.alloc(4);

            memory.free(handler);

            expect(() => memory.isFull(handler)).toThrow();
        });
    });


    describe("withView", () => {
        it("retorna uma TypedArray nativa com acesso direto ao dataBus", () => {
            const memory = new Balloc(64, "32u");
            const handler = memory.alloc(8);

            memory.put(handler, [10, 20, 30]);

            memory.withView(handler, view => {
                expect(view).toBeInstanceOf(Uint32Array);
                expect(view.buffer).toBe(memory.dataBus.buffer);
                expect(view.length).toBe(3);
                expect(view).toEqual(new Uint32Array([10, 20, 30]));
            });
        });

        it("modificações na view são refletidas diretamente no bloco", () => {
            const memory = new Balloc(64, "32u");
            const handler = memory.alloc(8);

            memory.put(handler, [10, 20, 30]);

            memory.withView(handler, view => {
                view[0] = 100;
                view[1] = 200;
            });

            expect(memory.pick(handler)).toEqual(new Uint32Array([100, 200, 30]));
        });

        it("modificações no bloco são visíveis pela view", () => {
            const memory = new Balloc(64, "32u");
            const handler = memory.alloc(8);

            memory.put(handler, [10, 20, 30]);

            memory.withView(handler, view => {
                expect(view[1]).toBe(memory.get(handler, 1));
            });
        });

        it("retorna o resultado produzido pelo callback", () => {
            const memory = new Balloc(64, "32u");
            const handler = memory.alloc(4);

            memory.put(handler, [10, 20, 30]);

            const result = memory.withView(handler, view => view.reduce((a, b) => a + b, 0));

            expect(result).toBe(60);
        });

        it("rejeita callbacks que não sejam funções", () => {
            const memory = new Balloc();
            const handler = memory.alloc(4);

            expect(() => memory.withView(handler, null)).toThrow(TypeError);
            expect(() => memory.withView(handler, undefined)).toThrow(TypeError);
            expect(() => memory.withView(handler, 123)).toThrow(TypeError);
        });

        it("rejeita empréstimo aninhado do mesmo segmento", () => {
            const memory = new Balloc(64, "8u");
            const handler = memory.alloc(8);

            expect(() => memory.withView(handler, () => {
                memory.withView(handler, () => { });
            })).toThrow(/borrowed/i);
        });

        it("permite empréstimos simultâneos de segmentos diferentes", () => {
            const memory = new Balloc(128, "8u");
            const first = memory.alloc(8);
            const second = memory.alloc(8);

            memory.put(first, [10, 20]);
            memory.put(second, [30, 40]);

            memory.withView(first, viewA => {
                memory.withView(second, viewB => {
                    viewA[0] = 100;
                    viewB[0] = 200;
                });
            });

            expect(memory.pick(first)).toEqual(new Uint8Array([100, 20]));
            expect(memory.pick(second)).toEqual(new Uint8Array([200, 40]));
        });

        it("libera o empréstimo quando o callback lança uma exceção", () => {
            const memory = new Balloc(64, "8u");
            const handler = memory.alloc(8);

            memory.put(handler, [10, 20]);

            expect(() => memory.withView(handler, () => {
                throw new Error("callback failure");
            })).toThrow("callback failure");

            expect(() => memory.set(handler, 0, 99)).not.toThrow();
            expect(memory.get(handler, 0)).toBe(99);
        });

        it("libera o empréstimo após execução normal", () => {
            const memory = new Balloc(64, "8u");
            const handler = memory.alloc(8);

            memory.put(handler, [10, 20]);

            memory.withView(handler, view => {
                view[0] = 99;
            });

            expect(() => memory.withView(handler, () => { })).not.toThrow();
            expect(() => memory.set(handler, 1, 88)).not.toThrow();
        });

        it.each([
            ["push", (m, h) => m.push(h, 1)],
            ["pop", (m, h) => m.pop(h)],
            ["nudge", (m, h) => m.nudge(h, 1)],
            ["pull", (m, h) => m.pull(h)],
            ["set", (m, h) => m.set(h, 0, 1)],
            ["put", (m, h) => m.put(h, [1])],
            ["clear", (m, h) => m.clear(h)],
            ["fill", (m, h) => m.fill(h, 1)],
            ["fillAll", (m, h) => m.fillAll(h, 1)],
            ["copyWithin", (m, h) => m.copyWithin(h, 0, 0, 1)],
            ["free", (m, h) => m.free(h)],
            ["realloc", (m, h) => m.realloc(h)]
        ])("bloqueia %s durante o empréstimo", (_, operation) => {
            const memory = new Balloc(128, "8u");
            const handler = memory.alloc(8);

            memory.put(handler, [10, 20]);

            expect(() => memory.withView(handler, () => {
                operation(memory, handler);
            })).toThrow(/borrowed/i);

            expect(memory.pick(handler)).toEqual(new Uint8Array([10, 20]));
        });

        it.each([
            ["gc", memory => memory.gc()],
            ["grow", memory => memory.grow()]
        ])("bloqueia %s enquanto existe uma view ativa", (_, operation) => {
            const memory = new Balloc(64, "8u");
            const handler = memory.alloc(8);

            expect(() => memory.withView(handler, () => {
                operation(memory);
            })).toThrow(/borrowed/i);
        });

        it("permite leitura do segmento durante o empréstimo", () => {
            const memory = new Balloc(64, "8u");
            const handler = memory.alloc(8);

            memory.put(handler, [10, 20, 30]);

            memory.withView(handler, view => {
                expect(memory.get(handler, 0)).toBe(view[0]);
                expect(memory.occupied(handler)).toBe(3);
                expect(memory.length(handler)).toBe(8);
                expect(memory.pick(handler)).toEqual(new Uint8Array([10, 20, 30]));
            });
        });

        it("mantém o armazenamento estável durante empréstimos de outros segmentos", () => {
            const memory = new Balloc(128, "8u");
            const first = memory.alloc(8);
            const second = memory.alloc(8);

            memory.put(first, [10, 20]);
            memory.put(second, [30, 40]);

            memory.withView(first, view => {
                const buffer = view.buffer;
                const address = view.byteOffset;

                memory.withView(second, other => {
                    other[0] = 99;
                });

                expect(view.buffer).toBe(buffer);
                expect(view.byteOffset).toBe(address);
                expect(view).toEqual(new Uint8Array([10, 20]));
            });
        });


            it("empresta múltiplos segmentos simultaneamente", () => {
            const memory = new Balloc(128, "32u");
            const a = memory.alloc(4);
            const b = memory.alloc(8);
            const c = memory.alloc(2);

            memory.put(a, [10, 20]);
            memory.put(b, [30, 40, 50]);
            memory.put(c, [60]);

            const result = memory.withView(a, b, c, (viewA, viewB, viewC) => {
                expect(viewA).toBeInstanceOf(Uint32Array);
                expect(viewB).toBeInstanceOf(Uint32Array);
                expect(viewC).toBeInstanceOf(Uint32Array);

                expect(viewA).toEqual(new Uint32Array([10, 20]));
                expect(viewB).toEqual(new Uint32Array([30, 40, 50]));
                expect(viewC).toEqual(new Uint32Array([60]));

                viewA[0] = 100;
                viewB[1] = 200;
                viewC[0] = 300;

                return viewA[0] + viewB[1] + viewC[0];
            });

            expect(result).toBe(600);
            expect(memory.pick(a)).toEqual(new Uint32Array([100, 20]));
            expect(memory.pick(b)).toEqual(new Uint32Array([30, 200, 50]));
            expect(memory.pick(c)).toEqual(new Uint32Array([300]));
        });

        it("rejeita handlers duplicados", () => {
            const memory = new Balloc(64, "8u");
            const handler = memory.alloc(8);

            expect(() => memory.withView(handler, handler, () => { })).toThrow(/duplicate handler/i);

            expect(() => memory.set(handler, 0, 10)).not.toThrow();
            expect(() => memory.withView(handler, () => { })).not.toThrow();
        });

        it("não deixa locks residuais quando um handler é inválido", () => {
            const memory = new Balloc(64, "8u");
            const valid = memory.alloc(8);
            const invalid = memory.alloc(8);

            memory.free(invalid);

            expect(() => memory.withView(valid, invalid, () => { })).toThrow();

            expect(() => memory.set(valid, 0, 10)).not.toThrow();
            expect(() => memory.withView(valid, () => { })).not.toThrow();
        });

        it("não altera locks quando um dos handlers já está emprestado", () => {
            const memory = new Balloc(128, "8u");
            const a = memory.alloc(8);
            const b = memory.alloc(8);

            memory.withView(a, () => {
                expect(() => memory.withView(b, a, () => { })).toThrow(/borrowed/i);

                expect(() => memory.set(b, 0, 10)).not.toThrow();
                expect(() => memory.withView(b, () => { })).not.toThrow();
            });

            expect(() => memory.set(a, 0, 20)).not.toThrow();
        });

        it("libera todos os locks quando o callback lança uma exceção", () => {
            const memory = new Balloc(128, "8u");
            const a = memory.alloc(8);
            const b = memory.alloc(8);

            memory.put(a, [10, 20]);
            memory.put(b, [30, 40]);

            expect(() => memory.withView(a, b, () => {
                throw new Error("callback failure");
            })).toThrow("callback failure");

            expect(() => memory.set(a, 0, 99)).not.toThrow();
            expect(() => memory.set(b, 0, 88)).not.toThrow();

            expect(memory.get(a, 0)).toBe(99);
            expect(memory.get(b, 0)).toBe(88);
        });

        it("bloqueia operações nos dois segmentos durante o empréstimo", () => {
            const memory = new Balloc(128, "8u");
            const a = memory.alloc(8);
            const b = memory.alloc(8);

            memory.put(a, [10, 20]);
            memory.put(b, [30, 40]);

            expect(() => memory.withView(a, b, () => {
                expect(() => memory.set(a, 0, 99)).toThrow(/borrowed/i);
                expect(() => memory.set(b, 0, 99)).toThrow(/borrowed/i);
                expect(() => memory.free(a)).toThrow(/borrowed/i);
                expect(() => memory.realloc(b)).toThrow(/borrowed/i);
            })).not.toThrow();

            expect(memory.pick(a)).toEqual(new Uint8Array([10, 20]));
            expect(memory.pick(b)).toEqual(new Uint8Array([30, 40]));
        });

        it("rejeita chamadas sem handlers ou callback", () => {
            const memory = new Balloc(64, "8u");
            const handler = memory.alloc(8);

            expect(() => memory.withView()).toThrow(TypeError);
            expect(() => memory.withView(handler)).toThrow(TypeError);
            expect(() => memory.withView(handler, null)).toThrow(TypeError);
            expect(() => memory.withView(handler, 123)).toThrow(TypeError);

            expect(() => memory.withView(handler, () => { })).not.toThrow();
        });

    });
});
