import { PlatformHeader } from "../../components/platform-header";
import { LoginForm } from "../../components/login-form";
import { supabaseConfig } from "../../lib/supabase/config";
import { safeNext } from "../../lib/auth/policy";
export const metadata = { title: "로그인 · VIKO Localize" };
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    next?: string | string[];
    error?: string | string[];
  }>;
}) {
  const params = await searchParams;
  return (
    <>
      <PlatformHeader toolName="계정" />
      <main id="main" tabIndex={-1}>
        <LoginForm
          configured={!!supabaseConfig()}
          next={safeNext(params.next)}
          confirmationError={params.error === "confirmation"}
        />
      </main>
    </>
  );
}
