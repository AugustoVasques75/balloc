```markdown
# Cross-Architecture Interoperability Tests (Endianness)

This suite validates the integrity of serialization and deserialization of memory blocks managed by **Balloc**, ensuring portability between hardware architectures with different endianness orientations.

The goal is to ensure that data blocks allocated, manipulated, and persisted on one architecture can be transferred and consumed with full fidelity on another, preserving structural accuracy and data types.

## Supported Types

- **Unsigned integers:** `8u`, `16u`, `32u`, `64u` 
- **Signed integers:** `8i`, `16i`, `32i`, `64i`
- **Floating-point:** `32f`, `64f`

The test suite covers standard integer and floating-point types stably supported by the bus ecosystem. The half-precision type (`16f`), being a recent addition currently consolidating in JavaScript specifications and runtimes, is excluded from automated cross-interoperability tests.

---

## Project Structure

- `writer.js` — Producer script responsible for allocating data via `Balloc`, populating it, and serializing it.
- `reader.js` — Consumer script responsible for loading the serialized files, restoring the blocks, and validating data integrity.
- `interop-data/` — Generated directory containing the binary artifacts resulting from execution.
- `README.md` — Guidance documentation for the test suite.

---

## Execution Instructions

To validate the real-world interoperability scenario between machines with different endianness types, follow the workflow:

### Step 1: Environment Setup
Copy this test folder to both machines with distinct architectures and access the directory on each of them.

### Step 2: On the Source Machine (Generation)
Run the producer script to allocate data in memory and persist the artifacts:

```bash
node ./writer.js

```

### Step 3: Transfer

Exclusively copy the generated `./interop-data` subfolder from the source to the target environment.

### Step 4: On the Target Machine (Consumption and Validation)

Run the consumer script to import the binary data into `Balloc` and validate integrity:

```bash
node ./reader.js

```

If the process completes without exceptions, the interoperability and architecture independence of the allocation mechanism will be confirmed.

```

```