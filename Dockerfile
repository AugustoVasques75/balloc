ARG NODE_VERSION=16
FROM node:${NODE_VERSION}-alpine

WORKDIR /app

COPY dist/balloc-1.0.0.tgz ./

RUN npm init -y && \
    npm pkg set type="module" && \
    npm install ./balloc-1.0.0.tgz && \
    npm install --save-dev jest

RUN mkdir -p test
COPY test/test.js ./test/
COPY test/test.cjs ./test/
COPY test/balloc.mjs ./test/
COPY test/balloc.cjs ./test/

CMD ["sh", "-c", "node --experimental-vm-modules ./node_modules/jest/bin/jest.js --runTestsByPath test/test.js && ./node_modules/jest/bin/jest.js --runTestsByPath test/test.cjs"]