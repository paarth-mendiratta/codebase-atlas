import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getUserAnalyses } from "@/lib/db";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ analyses: [] });
    }

    const analyses = getUserAnalyses(session.user.id, 10);

    const formatted = analyses.map((a) => {
      let files = [];
      let edges = [];
      try {
        files = JSON.parse(a.files_json);
        edges = JSON.parse(a.edges_json);
      } catch {
        // Fallback empty
      }

      return {
        id: a.id,
        repoUrl: a.repo_url,
        createdAt: a.created_at,
        files,
        edges,
      };
    });

    return NextResponse.json({ analyses: formatted });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch analysis history.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
