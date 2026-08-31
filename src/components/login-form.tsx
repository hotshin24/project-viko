"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { submitAuth } from "../lib/auth/browser-actions";
import { AUTH_MESSAGES, safeNext, type AuthMode } from "../lib/auth/policy";
import styles from "./auth.module.css";

export function LoginForm({
  configured,
  next,
  confirmationError,
}: {
  configured: boolean;
  next: string;
  confirmationError: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [feedback, setFeedback] = useState({
    error: confirmationError,
    message: confirmationError ? (AUTH_MESSAGES.confirmation as string) : "",
  });
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked.current || !configured) return;
    locked.current = true;
    setBusy(true);
    setFeedback({ error: false, message: "처리 중…" });
    const result = await submitAuth(
      mode,
      email,
      password,
      next,
      window.location.origin,
    );
    setPassword("");
    if (result.redirect) {
      router.replace(safeNext(result.redirect));
      router.refresh();
    } else setFeedback({ error: result.error, message: result.message ?? "" });
    locked.current = false;
    setBusy(false);
  }
  return (
    <section className={styles.card} aria-label="이메일 인증">
      <h1>{mode === "login" ? "로그인" : "이메일 회원가입"}</h1>
      {!configured && <p role="status">{AUTH_MESSAGES.unavailable}</p>}
      <div className={styles.tabs}>
        <button
          type="button"
          aria-pressed={mode === "login"}
          disabled={busy}
          onClick={() => setMode("login")}
        >
          로그인 모드
        </button>
        <button
          type="button"
          aria-pressed={mode === "signup"}
          disabled={busy}
          onClick={() => setMode("signup")}
        >
          회원가입 모드
        </button>
      </div>
      <form onSubmit={submit} noValidate>
        <label htmlFor="auth-email">이메일</label>
        <input
          id="auth-email"
          type="email"
          autoComplete="email"
          maxLength={254}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={!configured || busy}
          required
        />
        <label htmlFor="auth-password">비밀번호</label>
        <input
          id="auth-password"
          type="password"
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          maxLength={128}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={!configured || busy}
          aria-describedby="password-help"
          required
        />
        <p id="password-help">회원가입 비밀번호는 8~128자입니다.</p>
        <button type="submit" disabled={!configured || busy}>
          {busy ? "처리 중…" : mode === "login" ? "로그인" : "회원가입"}
        </button>
      </form>
      {feedback.message && (
        <p role={feedback.error ? "alert" : "status"}>{feedback.message}</p>
      )}
    </section>
  );
}
