"use client";
import { browserSupabase } from "../supabase/browser";
import {
  AUTH_MESSAGES,
  safeNext,
  validCredentials,
  type AuthMode,
} from "./policy";

export async function submitAuth(
  mode: AuthMode,
  email: string,
  password: string,
  next: string,
  origin: string,
) {
  email = email.trim();
  if (!validCredentials(mode, email, password))
    return { error: true, message: AUTH_MESSAGES.input };
  try {
    const client = browserSupabase();
    if (!client) return { error: true, message: AUTH_MESSAGES.unavailable };
    if (mode === "login") {
      const { error } = await client.auth.signInWithPassword({
        email,
        password,
      });
      if (error) return { error: true, message: AUTH_MESSAGES.login };
      return { error: false, redirect: safeNext(next) };
    }
    const callback = new URL("/auth/callback", origin);
    callback.searchParams.set("next", safeNext(next));
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: callback.href },
    });
    if (error) return { error: true, message: AUTH_MESSAGES.signup };
    return data.session
      ? { error: false, redirect: safeNext(next) }
      : { error: false, message: AUTH_MESSAGES.sent };
  } catch {
    return { error: true, message: AUTH_MESSAGES[mode] };
  }
}
export async function logout() {
  try {
    const client = browserSupabase();
    if (!client) return AUTH_MESSAGES.unavailable;
    const { error } = await client.auth.signOut({ scope: "local" });
    return error ? AUTH_MESSAGES.logout : null;
  } catch {
    return AUTH_MESSAGES.logout;
  }
}
