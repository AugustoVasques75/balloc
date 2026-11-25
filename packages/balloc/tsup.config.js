import { defineConfig } from 'tsup';

const languages = ['en', 'ar', 'es', 'jp', 'pt', 'zh'];

export default defineConfig(
  languages.flatMap((lang) => [
    // Build CJS para Node/Deno/Bun
    {
      entry: {
        [`${lang}/balloc`]: `src/${lang}/balloc.mjs`
      },
      outDir: 'src',
      format: ['cjs'],
      platform: "neutral",
      minify: false,
      outExtension() {
        return { js: '.cjs' };
      },
      clean: false,
      sourcemap: false,
      footer: {
        js: 'module.exports = { Balloc };'
      }
    },
    // Build IIFE para Navegador / CDN
    {
      entry: {
        [`${lang}/balloc`]: `src/${lang}/balloc.mjs`
      },
      outDir: 'src',
      format: ['iife'],
      platform: 'browser', 
      globalName: 'BallocModule',
      footer: {
        js: 'if (typeof window !== "undefined") { window.Balloc = BallocModule.default || BallocModule; }'
      },
      noExternal: ['cbor-x'],
      define: {
        'process.env.CBOR_NATIVE_ACCELERATION_DISABLED': 'true', 
        'process.env.PREBUILDS_ONLY': 'false',
        'module.createRequire': 'undefined' 
      },
      minify: false,
      keepNames: true,
      outExtension() {
        return { js: '.js' };
      },
      clean: false,
      sourcemap: false,
      esbuildOptions(options) {
        options.minifyIdentifiers = false;
        options.minifySyntax = true;
        options.minifyWhitespace = true;
      },
    }
  ])
);