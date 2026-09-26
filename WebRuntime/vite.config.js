import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';

export default defineConfig({
  base:'/web/',
  build:{rollupOptions:{input:{
    main:fileURLToPath(new URL('./index.html',import.meta.url)),
    citizens:fileURLToPath(new URL('./citizens.html',import.meta.url))
  }}}
});
