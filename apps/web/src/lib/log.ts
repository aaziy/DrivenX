import { cache } from "react";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";

import { isUserFacingError, logger, newErrorReference } from "@drivenx/logger";

/**
 * A logger bound to the current request id.
 *
 * `cache` keeps it to one header read per request, and means every line from a single
 * request shares a correlation id without any call site passing one around.
 */
export const requestLogger = cache(async () => {
  const headerList = await headers();
  return logger.child({ requestId: headerList.get("x-request-id") ?? "unknown" });
});

/**
 * Turn a thrown value into a message that is safe to show.
 *
 * A `UserFacingError` was written for a user, in their language, and is shown verbatim.
 * Anything else — a Prisma constraint violation, a null dereference — is logged in full
 * and replaced with a reference code. Rendering the real message would put schema
 * names, file paths and constraint text on screen for whoever is standing there.
 */
export async function toUserMessage(actionName: string, error: unknown): Promise<string> {
  if (isUserFacingError(error)) return error.message;

  const reference = newErrorReference();
  const log = await requestLogger();
  log.error(`action failed: ${actionName}`, error, { action: actionName, reference });

  const t = await getTranslations("errors");
  return t("generic", { reference });
}
