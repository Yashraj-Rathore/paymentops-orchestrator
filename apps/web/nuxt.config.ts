import { defineNuxtConfig } from "nuxt/config";

export default defineNuxtConfig({
  compatibilityDate: "2024-11-01",
  devtools: { enabled: true },
  modules: ["@pinia/nuxt"],
  css: ["~/assets/css/main.css"],
  runtimeConfig: {
    public: {
      apiBaseUrl: process.env.NUXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000",
      devAdminToken: process.env.NUXT_PUBLIC_DEV_ADMIN_TOKEN ?? "dev-admin-token",
      authMode: process.env.NUXT_PUBLIC_AUTH_MODE ?? process.env.AUTH_MODE ?? "development",
      auth0Domain: process.env.NUXT_PUBLIC_AUTH0_DOMAIN ?? process.env.AUTH0_DOMAIN ?? "",
      auth0ClientId: process.env.NUXT_PUBLIC_AUTH0_CLIENT_ID ?? "",
      auth0Audience: process.env.NUXT_PUBLIC_AUTH0_AUDIENCE ?? process.env.AUTH0_AUDIENCE ?? ""
    }
  },
  typescript: {
    strict: true,
    typeCheck: false
  }
});
