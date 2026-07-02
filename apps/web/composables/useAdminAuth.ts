import { useRuntimeConfig } from "#app";
import {
  createAuth0Client,
  type Auth0Client,
  type User
} from "@auth0/auth0-spa-js";
import { computed, ref, shallowRef } from "vue";

export function useAdminAuth() {
  const config = useRuntimeConfig();
  const authMode = String(config.public.authMode ?? "development");
  const domain = String(config.public.auth0Domain ?? "");
  const clientId = String(config.public.auth0ClientId ?? "");
  const audience = String(config.public.auth0Audience ?? "");
  const client = shallowRef<Auth0Client | null>(null);
  const ready = ref(false);
  const authenticated = ref(authMode !== "auth0");
  const accessToken = ref("");
  const user = ref<User | null>(null);
  const error = ref<string | null>(null);

  const configured = computed(
    () => authMode !== "auth0" || Boolean(domain && clientId && audience)
  );
  const credential = computed(() =>
    accessToken.value
      ? "Bearer " + accessToken.value
      : String(config.public.devAdminToken ?? "")
  );

  async function initialize(): Promise<void> {
    if (ready.value) return;
    if (authMode !== "auth0") {
      ready.value = true;
      return;
    }

    if (!configured.value) {
      error.value = "Auth0 is enabled but its public client configuration is incomplete.";
      ready.value = true;
      return;
    }

    try {
      const auth0 = await createAuth0Client({
        domain,
        clientId,
        authorizationParams: {
          audience,
          redirect_uri: window.location.origin
        }
      });
      client.value = auth0;

      const search = new URLSearchParams(window.location.search);
      if (search.has("code") && search.has("state")) {
        await auth0.handleRedirectCallback();
        window.history.replaceState({}, document.title, window.location.pathname);
      }

      authenticated.value = await auth0.isAuthenticated();
      if (authenticated.value) {
        accessToken.value = await auth0.getTokenSilently();
        user.value = (await auth0.getUser()) ?? null;
      }
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : "Unable to initialize Auth0";
      authenticated.value = false;
    } finally {
      ready.value = true;
    }
  }

  async function login(): Promise<void> {
    if (!client.value) await initialize();
    await client.value?.loginWithRedirect({
      appState: { returnTo: window.location.pathname }
    });
  }

  async function logout(): Promise<void> {
    await client.value?.logout({
      logoutParams: { returnTo: window.location.origin }
    });
  }

  return {
    authMode,
    ready,
    configured,
    authenticated,
    credential,
    user,
    error,
    initialize,
    login,
    logout
  };
}
