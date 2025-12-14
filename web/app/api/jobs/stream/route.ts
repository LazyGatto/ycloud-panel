import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@lib/authGuard";
import { listJobStatuses } from "@server/jobManager";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.authed) return auth.response as NextResponse;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (data: string) => {
        try {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          // ignore closed stream
        }
      };
      const tick = () => {
        send(JSON.stringify(listJobStatuses()));
      };
      const interval = setInterval(tick, 3000);
      tick();
      return () => {
        clearInterval(interval);
        try {
          controller.close();
        } catch {
          // ignore
        }
      };
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      Connection: "keep-alive",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
