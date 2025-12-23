import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "../../../../lib/authGuard";
import { listLogs } from "../../../../../server/jobManager";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.authed) return auth.response as NextResponse;

  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get("jobId") ?? undefined;
  let lastId = Number(searchParams.get("after") ?? "0");
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: string) => {
        try {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          // stream closed; ignore
        }
      };
      const tick = () => {
        const logs = listLogs(jobId, 100).filter((l) => l.id > lastId);
        if (logs.length > 0) {
          lastId = Math.max(...logs.map((l) => l.id));
          send(JSON.stringify(logs.reverse()));
        } else {
          send(JSON.stringify([]));
        }
      };
      const interval = setInterval(tick, 2000);
      tick();
      try {
        controller.enqueue(encoder.encode(": keep-alive\n\n"));
      } catch {
        // ignore
      }
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
