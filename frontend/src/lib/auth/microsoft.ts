// Microsoft (Entra ID) sign-in with MSAL, using the redirect flow:
//   1. startMicrosoftSignIn() sends the browser to Microsoft's sign-in page.
//   2. Microsoft sends it back to /register, where finishMicrosoftSignIn() reads the ID token
//      and exchanges it with our backend (which verifies it) for our own session token.
// The user never types a name or email; both come from their Microsoft account.
//
// Needs NEXT_PUBLIC_AZURE_CLIENT_ID (and the tenant) in .env.local. Without it, the
// register page falls back to the development sign-in (devSignIn) for local testing.

import { PublicClientApplication } from "@azure/msal-browser";
import type { User } from "@/types";
import { api } from "@/lib/api/client";

const CLIENT_ID = process.env.NEXT_PUBLIC_AZURE_CLIENT_ID ?? "";
const TENANT = process.env.NEXT_PUBLIC_AZURE_TENANT_ID || "organizations";
const SCOPES = ["openid", "profile", "email"];

export const microsoftConfigured = CLIENT_ID !== "";

export interface SignInResult {
  accessToken: string;
  user: User;
}

let msal: Promise<PublicClientApplication> | null = null;

function getMsal(): Promise<PublicClientApplication> {
  msal ??= (async () => {
    const app = new PublicClientApplication({
      auth: {
        clientId: CLIENT_ID,
        authority: `https://login.microsoftonline.com/${TENANT}`,
        redirectUri: `${window.location.origin}/register`,
      },
      cache: { cacheLocation: "sessionStorage" },
    });
    await app.initialize();
    return app;
  })();
  return msal;
}

export async function startMicrosoftSignIn(): Promise<void> {
  const app = await getMsal();
  await app.loginRedirect({ scopes: SCOPES, prompt: "select_account" });
}

let finishing: Promise<SignInResult | null> | null = null;

/** After Microsoft redirects back: our session for the signed-in account, or null if this isn't a sign-in return. */
export function finishMicrosoftSignIn(): Promise<SignInResult | null> {
  // React may run the effect twice in development; handle the redirect only once.
  finishing ??= (async () => {
    const result = await (await getMsal()).handleRedirectPromise();
    if (!result?.idToken) return null;
    return api<SignInResult>("/auth/microsoft", { method: "POST", body: { idToken: result.idToken } });
  })();
  return finishing;
}

/** Development only (no Microsoft app configured): sign in with a typed name + school email. */
export function devSignIn(account: { name: string; email: string }): Promise<SignInResult> {
  return api<SignInResult>("/auth/dev-login", {
    method: "POST",
    body: { name: account.name.trim(), email: account.email.trim() },
  });
}
