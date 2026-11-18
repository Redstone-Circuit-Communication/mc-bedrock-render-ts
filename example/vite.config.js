import { fileURLToPath } from 'node:url';
export default {
  base: './',
  resolve: { dedupe: ['three'] },
  optimizeDeps: { exclude: ['@rsw/mc-bedrock-render-ts'] },
  server: { fs: { allow: ['..'] } },
  build: { rolldownOptions: { input: {
    studio: fileURLToPath(new URL('./index.html', import.meta.url)),
    minimal: fileURLToPath(new URL('./minimal.html', import.meta.url)),
  } } },
};
