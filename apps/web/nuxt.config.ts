import { defineNuxtConfig } from "nuxt/config";

export default defineNuxtConfig({
  compatibilityDate: "2024-11-01",
  devtools: { enabled: true },
  modules: ["@pinia/nuxt"],
  css: ["~/assets/css/main.css"],
  runtimeConfig: {
    public: {
      apiBaseUrl: process.env.NUXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000",
      devAdminToken: process.env.NUXT_PUBLIC_DEV_ADMIN_TOKEN ?? "dev-admin-token"
    }
  },
  typescript: {
    strict: true,
    typeCheck: false
  }
});