import { can } from "@drivenx/auth";
import { prisma } from "@drivenx/db";
import { contentDisposition, isAllowedMimeType } from "@drivenx/storage";

import { currentPrincipal } from "@/lib/auth";
import { storage } from "@/lib/storage";

/**
 * Download one document.
 *
 * The bytes are streamed through this handler rather than the caller being redirected to
 * a signed storage URL. A signed URL grants unauthenticated access to whoever holds it,
 * and these are passports and Emirates IDs — a link pasted into a group chat should not
 * be a copy of someone's identity document. Passing through the session costs one hop of
 * bandwidth, bounded by the upload cap.
 *
 * `requirePermission` is not used here: it calls `forbidden()`, which renders a page. A
 * route handler has to answer with a status code, and 401 and 403 are different answers
 * — one means sign in, the other means you are signed in and this is not yours to read.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const principal = await currentPrincipal();
  if (!principal) return new Response(null, { status: 401 });
  if (!can(principal, "document.view")) return new Response(null, { status: 403 });

  const { documentId } = await params;
  const document = await prisma.document.findFirst({
    where: { id: documentId, deletedAt: null },
    select: { fileKey: true, fileName: true, mimeType: true },
  });

  if (!document || !isAllowedMimeType(document.mimeType)) {
    // An unknown stored type is treated as missing rather than served: whatever it is,
    // it did not come through the validator that decides what may be stored.
    return new Response(null, { status: 404 });
  }

  const bytes = await storage().get(document.fileKey);

  return new Response(bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": document.mimeType,
      "Content-Length": String(bytes.byteLength),
      // Built from the sniffed type, so the saved file cannot be given an extension
      // that disagrees with its contents.
      "Content-Disposition": contentDisposition(
        "attachment",
        document.fileName,
        document.mimeType,
      ),
      // These are identity documents; no shared cache should keep a copy.
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
