import Balloc from "../../src/en/Balloc.mjs";

// --- Suas classes e funções de Hash / AMQ ---

function hash32(str) {
    const buf = Buffer.from(str, "utf8");
    let x = 0;

    for (let i = 0; i < buf.length; i++) {
        x = Math.imul(x, 131) ^ buf[i];
    }

    x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
    x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);

    return (x ^ (x >>> 16)) >>> 0;
}

class BallocIndexedAMQ {
    constructor(allocator = new Balloc(65535, `32u`), qBits = 16) {
        if (!Number.isInteger(qBits) || qBits < 0 || qBits > 32) {
            throw new RangeError("qBits must be an integer in [0, 32]");
        }

        this.mem = allocator;
        this.qBits = qBits;
        this.buckets = new Map();
        this.usedCount = 0;
    }

    _split(hash) {
        if (this.qBits === 0) return { q: 0, r: hash };
        if (this.qBits === 32) return { q: hash, r: 0 };

        const rBits = 32 - this.qBits;
        const rMask = 2 ** rBits - 1;

        return {
            q: hash >>> rBits,
            r: hash & rMask
        };
    }

    _find(handler, r) {
        let lo = 0;
        let hi = this.mem.occupied(handler);

        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            const value = this.mem.get(handler, mid);

            if (value < r) lo = mid + 1;
            else hi = mid;
        }

        return lo;
    }

    _insert(handler, r) {
        const occupied = this.mem.occupied(handler);
        const pos = this._find(handler, r);

        if (pos < occupied && this.mem.get(handler, pos) === r) {
            return false;
        }

        if (occupied === this.mem.length(handler)) {
            this.mem.realloc(handler);
        }

        this.mem.push(handler, r);

        for (let i = occupied; i > pos; i--) {
            this.mem.set(
                handler,
                i,
                this.mem.get(handler, i - 1)
            );
        }

        this.mem.set(handler, pos, r);

        return true;
    }

    _remove(handler, r) {
        const occupied = this.mem.occupied(handler);
        const pos = this._find(handler, r);

        if (pos === occupied || this.mem.get(handler, pos) !== r) {
            return false;
        }

        for (let i = pos; i < occupied - 1; i++) {
            this.mem.set(
                handler,
                i,
                this.mem.get(handler, i + 1)
            );
        }

        this.mem.pop(handler);

        return true;
    }

    insertHashed(q, r) {
        let handler = this.buckets.get(q);

        if (handler === undefined) {
            handler = this.mem.alloc(2);
            this.mem.push(handler, r);
            this.buckets.set(q, handler);
            this.usedCount++;
            return true;
        }

        if (!this._insert(handler, r)) {
            return false;
        }

        this.usedCount++;
        return true;
    }

    lookupHashed(q, r) {
        const handler = this.buckets.get(q);

        if (handler === undefined) {
            return false;
        }

        const pos = this._find(handler, r);

        return (
            pos < this.mem.occupied(handler) &&
            this.mem.get(handler, pos) === r
        );
    }

    removeHashed(q, r) {
        const handler = this.buckets.get(q);

        if (handler === undefined || !this._remove(handler, r)) {
            return false;
        }

        this.usedCount--;

        if (this.mem.occupied(handler) === 0) {
            this.mem.free(handler);
            this.buckets.delete(q);
        }

        return true;
    }

    destroy() {
        for (const handler of this.buckets.values()) {
            this.mem.free(handler);
        }

        this.buckets.clear();
        this.usedCount = 0;
    }
}

class StringAMQ {
    constructor(amq) {
        this.amq = amq;
    }

    _hash(str) {
        return this.amq._split(hash32(str));
    }

    insert(str) {
        const { q, r } = this._hash(str);
        return this.amq.insertHashed(q, r);
    }

    lookup(str) {
        const { q, r } = this._hash(str);
        return this.amq.lookupHashed(q, r);
    }

    remove(str) {
        const { q, r } = this._hash(str);
        return this.amq.removeHashed(q, r);
    }
}

// --- Funções auxiliares para raspagem de texto e execução do teste ---

async function fetchAndExtractWords(pageTitle) {
    // API oficial da Wikipedia para obter apenas o texto puro do artigo
    const endpoint = `https://pt.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&titles=${encodeURIComponent(pageTitle)}&format=json&origin=*`;

    const response = await fetch(endpoint, {
        headers: { 'User-Agent': 'AMQTestBot/1.0' }
    });

    if (!response.ok) {
        throw new Error(`Falha ao consultar a API para o título: ${pageTitle}`);
    }

    const data = await response.json();
    const pages = data.query.pages;
    const pageId = Object.keys(pages)[0];
    
    if (pageId === "-1") {
        throw new Error(`Página não encontrada: ${pageTitle}`);
    }

    const plainText = pages[pageId].extract;

    // Normalização e extração das palavras
    const words = plainText
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // Remove acentos
        .match(/\b[a-z0-9]{3,}\b/g) || [];

    return Array.from(new Set(words));
}

async function runTest() {
    const urlFonte = "Estrutura_de_dados";
    const urlTeste = "Algoritmo";

    console.log(`[1/4] Baixando e extraindo palavras de: ${urlFonte}`);
    const palavrasFonte = await fetchAndExtractWords(urlFonte);
    console.log(`Palavras únicas encontradas na página fonte: ${palavrasFonte.length}`);

    // Instancia o alocador e o filtro AMQ
    const allocator = new Balloc(1048576, `32u`); // 1MB de capacidade inicial
    const baseAMQ = new BallocIndexedAMQ(allocator, 16);
    const filter = new StringAMQ(baseAMQ);

    console.log(`[2/4] Inserindo palavras no filtro AMQ...`);
    let inseridas = 0;
    for (const word of palavrasFonte) {
        if (filter.insert(word)) {
            inseridas++;
        }
    }
    console.log(`Palavras salvas com sucesso no filtro: ${inseridas}`);

    console.log(`[3/4] Baixando página de comparação: ${urlTeste}`);
    const palavrasTeste = await fetchAndExtractWords(urlTeste);
    console.log(`Palavras únicas na página de teste: ${palavrasTeste.length}`);

    console.log(`[4/4] Executando teste de perticência (Lookup)...`);
    let presentes = 0;
    let ausentes = 0;

    for (const word of palavrasTeste) {
        if (filter.lookup(word)) {
            presentes++;
        } else {
            ausentes++;
        }
    }

    console.log("\n=== RESULTADOS ===");
    console.log(`Total de palavras testadas: ${palavrasTeste.length}`);
    console.log(`Palavras encontradas no filtro (Pertinentes): ${presentes} (${((presentes / palavrasTeste.length) * 100).toFixed(2)}%)`);
    console.log(`Palavras não encontradas no filtro: ${ausentes} (${((ausentes / palavrasTeste.length) * 100).toFixed(2)}%)`);

    // Limpeza de memória do Balloc
    baseAMQ.destroy();
}

runTest().catch(console.error);
