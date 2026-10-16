const  {Balloc}  = require('./balloc.cjs');



describe('Balloc - Testes Cegos da API', () => {

    console.log("====> Iniciando testes na suite CJS <====");

    let memory;

    beforeEach(() => {
        memory = new Balloc(65535, '32u');
    });

    describe('1. Instanciamento', () => {
        test('deve instanciar com os valores padrão corretos', () => {
            const defaultMemory = new Balloc();
            expect(defaultMemory).toBeInstanceOf(Balloc);
        });

        test('deve lançar RangeError para tamanhos inválidos no construtor', () => {
            expect(() => new Balloc(1, '32u')).toThrow(RangeError);
            expect(() => new Balloc(65535, 'tipo_invalido')).toThrow(RangeError);
            expect(() => new Balloc(65535, '32u', 5)).toThrow(RangeError);
        });
    });

    describe('2. Ciclo de vida dos blocos', () => {
        test('deve alocar um bloco e retornar um handler numérico', () => {
            const handler = memory.alloc(16);
            expect(typeof handler).toBe('number');
            expect(memory.length(handler)).toBeGreaterThanOrEqual(16);
        });

        test('deve liberar um bloco corretamente usando free', () => {
            const handler = memory.alloc(16);
            memory.free(handler);
            expect(() => memory.occupied(handler)).toThrow(Error);
        });
    });

    describe('3. Estruturas lineares (Stack)', () => {
        test('deve permitir operações de push, peek e pop', () => {
            const handler = memory.alloc(8);

            expect(memory.push(handler, 10)).toBe(true);
            expect(memory.push(handler, 20)).toBe(true);

            expect(memory.peek(handler)).toBe(20);
            expect(memory.occupied(handler)).toBe(2);

            expect(memory.pop(handler)).toBe(20);
            expect(memory.pop(handler)).toBe(10);
            expect(memory.pop(handler)).toBeUndefined();
        });
    });

    describe('3.2 Estruturas lineares (Queue)', () => {
        test('deve permitir operações de nudge, head e pull', () => {
            const handler = memory.alloc(8);

            expect(memory.nudge(handler, 10)).toBe(true);
            expect(memory.nudge(handler, 20)).toBe(true); // Fica [20, 10]

            expect(memory.head(handler)).toBe(20);
            expect(memory.occupied(handler)).toBe(2);

            expect(memory.pull(handler)).toBe(20);
            expect(memory.pull(handler)).toBe(10);
            expect(memory.pull(handler)).toBeUndefined();
        });
    });

    describe('4. Acesso ao conteúdo', () => {
        test('deve manipular get, set, has e clear', () => {
            const handler = memory.alloc(4);

            memory.push(handler, 100);
            memory.push(handler, 200);

            expect(memory.has(handler, 100)).toBe(true);
            expect(memory.has(handler, 999)).toBe(false);

            expect(memory.get(handler, 0)).toBe(100);
            expect(memory.set(handler, 0, 150)).toBe(true);
            expect(memory.get(handler, 0)).toBe(150);

            memory.clear(handler);
            expect(memory.occupied(handler)).toBe(0);
        });

        test('deve preencher e recuperar dados com put e pick', () => {
            const handler = memory.alloc(4);
            memory.put(handler, [1, 2, 3]);

            expect(memory.occupied(handler)).toBe(3);
            const values = memory.pick(handler);
            expect(values).toBeInstanceOf(Uint32Array);
            expect(Array.from(values)).toEqual([1, 2, 3]);
        });
    });

    describe('5. Capacidade e ocupação', () => {
        test('deve retornar corretamente byteSize, occupied e length', () => {
            const handler = memory.alloc(8);
            expect(memory.length(handler)).toBeGreaterThanOrEqual(8);
            expect(memory.byteSize(handler)).toBe(memory.length(handler) * 4);
            expect(memory.occupied(handler)).toBe(0);
        });
    });

    describe('6. Operações entre blocos', () => {
        test('deve clonar e trocar blocos com clone e swap', () => {
            const source = memory.alloc(4);
            memory.push(source, 42);

            const cloneHandler = memory.clone(source);
            expect(memory.occupied(cloneHandler)).toBe(1);
            expect(memory.get(cloneHandler, 0)).toBe(42);

            const target = memory.alloc(4);
            memory.swap(source, target);
            expect(memory.get(target, 0)).toBe(42);
        });
    });

    describe('7. Serialização', () => {
       test('deve serializar e desserializar um bloco usando dump e load', () => {
            const handler = memory.alloc(4);
            memory.push(handler, 77);
            memory.push(handler, 78);

            const serialized = memory.dump(handler);
            expect(serialized).toBeInstanceOf(Uint8Array);

            const restoredHandler = memory.load(serialized);
            expect(memory.get(restoredHandler, 0)).toBe(77);
            expect(memory.get(restoredHandler, 1)).toBe(78);
            expect(memory.occupied(restoredHandler)).toBe(2);
        });
    });

    describe('8. Diagnóstico e utilização', () => {
        test('deve expor métricas de diagnóstico corretamente', () => {
            expect(memory.recycleCount()).toBe(0);
            expect(memory.recycleBytes).toBe(0);
            expect(typeof memory.allocatedBytes).toBe('number');
            expect(typeof memory.unallocatedBytes).toBe('number');
            expect(typeof memory.fragmentationRatio).toBe('number');
        });
    });


    describe("Balloc - Testes Abrangentes de Serialização (dump/load)", () => {
        const bucketTypes = [
            "8i", "8u",
            "16i", "16u",
            "32i", "32u", "32f",
            "64i", "64u", "64f"
        ];

        for (const bucketSize of bucketTypes) {
            test(`Deve serializar e desserializar corretamente blocos do tipo ${bucketSize}`, () => {
                const memory = new Balloc(65535, bucketSize);
                const handler = memory.alloc(16);

                let testValues;
                if (bucketSize === "64f") {
                    testValues = [1.5, -2.25, 3.14159, 0.0, 42.42];
                } else if (bucketSize === "64i" || bucketSize === "64u") {
                    testValues = bucketSize === "64i"
                        ? [100n, -9007199254740991n, 9007199254740991n, 0n, 42n]
                        : [100n, 9007199254740991n, 0n, 123456789n, 42n];
                } else if (bucketSize.includes("f")) {
                    testValues = [1.5, -2.25, 3.14159, 0.0, 42.42];
                } else if (bucketSize.startsWith("8")) {
                    testValues = [10, 127, -128, 0, 50];
                } else if (bucketSize.startsWith("16")) {
                    testValues = [1000, -32768, 32767, 0, 255];
                } else {
                    testValues = [100000, -2147483648, 2147483647, 0, 123456];
                }

                memory.put(handler, testValues);

                const serialized = memory.dump(handler);
                const newHandler = memory.load(serialized);

                expect(memory.occupied(newHandler)).toBe(memory.occupied(handler));
                expect(memory.byteSize(newHandler)).toBe(memory.byteSize(handler));

                const originalData = memory.pick(handler);
                const restoredData = memory.pick(newHandler);

                for (let i = 0; i < testValues.length; i++) {
                    if (bucketSize === "64i" || bucketSize === "64u") {
                        expect(restoredData[i]).toBe(originalData[i]);
                    } else {
                        expect(restoredData[i]).toBeCloseTo(originalData[i], 5);
                    }
                }
            });
        }

        test("Deve lançar erro ao tentar carregar dados em um alocador com bucketSize divergente", () => {
            const memory32 = new Balloc(65535, "32u");
            const handler = memory32.alloc(8);
            memory32.put(handler, [42]);

            const serialized = memory32.dump(handler);

            const memory16 = new Balloc(65535, "16u");

            expect(() => {
                memory16.load(serialized);
            }).toThrow();
        });

        test("Deve lançar erro ao tentar executar dump em um handler inválido ou corrompido", () => {
            const memory = new Balloc(65535, "32u");

            expect(() => {
                memory.dump(999999);
            }).toThrow();
        });
    });


});