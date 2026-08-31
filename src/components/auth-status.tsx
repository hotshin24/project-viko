"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { browserSupabase } from "../lib/supabase/browser";
import { logout } from "../lib/auth/browser-actions";
import styles from "./auth.module.css";

export function AuthStatus({
  email,
  configured,
}: {
  email: string | null;
  configured: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!configured) return;
    const client = browserSupabase();
    const listener = client?.auth.onAuthStateChange((event) => {
      if (
        event === "SIGNED_IN" ||
        event === "SIGNED_OUT" ||
        event === "TOKEN_REFRESHED"
      )
        router.refresh();
    });
    return () => listener?.data.subscription.unsubscribe();
  }, [configured, router]);
  async function signOut() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const message = await logout();
    if (message) {
      setError(message);
      setBusy(false);
    } else {
      router.replace("/");
      router.refresh();
      setBusy(false);
    }
  }
  return (
    <div className={styles.status}>
      {email ? (
        <>
          <span className={styles.email} title={email}>
            {email}
          </span>
          <button type="button" disabled={busy} onClick={signOut}>
            {busy ? "로그아웃 중…" : "로그아웃"}
          </button>
        </>
      ) : (
        <Link href="/login">로그인</Link>
      )}
      {error && <span role="alert">{error}</span>}
    </div>
  );
}
