import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // O glue do wasm-bindgen (`wasm_vtracer_bg.js`) e ligado ao .wasm na mao dentro do
  // worker; deixar o pre-bundling do Vite mexer nele quebra a resolucao do modulo.
  optimizeDeps: {
    exclude: ['wasm_vtracer'],
  },
  server: {
    host: true,
  }
})
