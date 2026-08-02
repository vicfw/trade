export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  devtools: { enabled: true },
  typescript: {
    strict: true,
    typeCheck: false,
  },
  runtimeConfig: {
    public: {
      wsUrl: "ws://localhost:3001/ws/btc",
      apiUrl: "http://localhost:3001",
    },
  },
  build: {
    transpile: ["@trade/shared"],
  },
})
