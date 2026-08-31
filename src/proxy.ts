import type { NextRequest } from "next/server";
import { refreshSession } from "./lib/supabase/proxy";
export function proxy(request: NextRequest) {
  return refreshSession(request);
}
// Translation API is intentionally excluded: this change does not authenticate it.
export const config = {
  matcher: ["/", "/login", "/tools/:path*", "/auth/:path*"],
};
