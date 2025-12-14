import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@lib/authGuard";
import { loadConfig } from "@server/configStore";
import { listJobStatuses, startJob, stopJob, pauseJob } from "@server/jobManager";

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.authed) return auth.response as NextResponse;
  const cfg = await loadConfig();
  const statuses = listJobStatuses();
  const map = new Map(statuses.map((s) => [s.id, s]));
  const full = cfg.jobs.map((j) => map.get(j.id) ?? { id: j.id, status: "idle" });
  return NextResponse.json({ jobs: cfg.jobs, statuses: full });
}

export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.authed) return auth.response as NextResponse;
  const { jobId, action } = await req.json();
  const cfg = await loadConfig();
  const job = cfg.jobs.find((j) => j.id === jobId);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  if (action === "start" || action === "resume") {
    startJob(job, cfg);
  } else if (action === "stop") {
    stopJob(jobId);
  } else if (action === "pause") {
    pauseJob(jobId);
  } else {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, statuses: listJobStatuses() });
}
