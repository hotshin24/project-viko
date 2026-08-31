import { NextResponse } from "next/server";
import { serverSupabase } from "../../../lib/supabase/server";
import { safeNext } from "../../../lib/auth/policy";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const flowId = url.searchParams.get("sb_flow_id");
  let target = "/login?error=confirmation";
  try {
    const client = await serverSupabase(true);
    if (
      client &&
      code &&
      code.length <= 2048 &&
      (flowId === null || /^[A-Za-z0-9_-]{8,64}$/.test(flowId)) &&
      !url.searchParams.has("error")
    ) {
      const { error } =
        flowId === null
          ? await client.auth.exchangeCodeForSession(code)
          : await client.auth.exchangeCodeForSession(code, { flowId });
      if (!error) {
        const verified = await client.auth.getUser();
        if (!verified.error && verified.data.user)
          target = safeNext(url.searchParams.get("next"));
      }
    }
  } catch {
    /* Never echo provider errors or confirmation codes. */
  }
  // Relative Location preserves the browser's origin, including proxy/local host aliases.
  return new NextResponse(null, {
    status: 303,
    headers: {
      Location: target,
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
