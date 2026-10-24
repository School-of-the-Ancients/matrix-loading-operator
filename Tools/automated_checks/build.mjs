// Separate entrypoint: never added to the production Vite inputs.
import {build} from '../../WebRuntime/node_modules/vite/dist/node/index.js';
import {fileURLToPath} from 'node:url';
await build({configFile:false,root:fileURLToPath(new URL('./',import.meta.url)),
  base:'/',logLevel:'warn',build:{outDir:process.argv[2],emptyOutDir:true,
    rollupOptions:{input:{index:fileURLToPath(new URL('./index.html',import.meta.url)),
      rendered:fileURLToPath(new URL('./rendered.html',import.meta.url))}}}});
