import { NextResponse, type NextRequest } from "next/server";

/**
 * Request correlation (P0-13).
 *
 * Stamps every request with an id, echoed back on the response. Logs, audit rows and
 * the reference shown to a user on an error all carry it, so "something broke at about
 * 3pm" becomes a single grep.
 *
 * An inbound `x-request-id` is honoured so a trace survives a proxy or load balancer
 * in front of the app, which is what makes the id useful once this is behind one.
 */
export function middleware(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();

  const headers = new Headers(request.headers);
  headers.set("x-request-id", requestId);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set("x-request-id", requestId);
  return response;
}

export const config = {
  // Static assets do not need correlation and would triple log volume for nothing.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
