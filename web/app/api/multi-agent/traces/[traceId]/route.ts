import { getBackendBaseUrl } from "@/lib/server/backend-proxy";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    traceId: string;
  }>;
};

export async function GET(_: Request, context: RouteContext) {
  try {
    const { traceId } = await context.params;
    if (!traceId) {
      return new Response(JSON.stringify({ error: "Missing trace id" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const response = await fetch(
      `${getBackendBaseUrl()}/multi-agent/traces/${encodeURIComponent(traceId)}`,
      {
        headers: { Accept: "application/json" },
      },
    );

    const text = await response.text();
    return new Response(text, {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
