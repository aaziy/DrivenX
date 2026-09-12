/**
 * Next's hook for errors that escape a server component, route handler or action.
 *
 * Without it these are printed by the framework in its own format and are invisible to
 * a log aggregator. The `digest` is the value Next shows the user in the error
 * boundary, so logging it here is what connects "the screen said DA7F91" to the stack
 * trace that caused it.
 */
export async function onRequestError(
  error: unknown,
  request: { path: string; method: string; headers: Record<string, string | undefined> },
  context: { routerKind: string; routePath: string; routeType: string },
): Promise<void> {
  const { logger } = await import("@drivenx/logger");

  logger.error("unhandled server error", error, {
    requestId: request.headers["x-request-id"],
    method: request.method,
    path: request.path,
    routePath: context.routePath,
    routeType: context.routeType,
    digest: (error as { digest?: string } | null)?.digest,
  });
}
