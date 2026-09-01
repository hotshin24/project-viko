import Link from "next/link";
import { AuthStatus } from "./auth-status";
import { verifiedEmail } from "../lib/supabase/server";
import { supabaseConfig } from "../lib/supabase/config";

export async function PlatformHeader({
  toolName,
  verifiedEmail: suppliedEmail,
}: {
  toolName?: string;
  verifiedEmail?: string | null;
}) {
  const email =
    suppliedEmail === undefined ? await verifiedEmail() : suppliedEmail;
  return (
    <>
      <a className="skip-link" href="#main">
        본문으로 이동
      </a>
      <header className="topbar">
        <Link className="brand" href="/" aria-label="VIKO Localize 홈">
          VIKO<span>LOCALIZE</span>
        </Link>
        <span className="current-tool">{toolName ?? "도구 둘러보기"}</span>
        <span className="product-direction">
          Foreign Video <span aria-hidden="true">→</span> Natural Korean
          Subtitle
        </span>
        <AuthStatus email={email} configured={!!supabaseConfig()} />
      </header>
    </>
  );
}
