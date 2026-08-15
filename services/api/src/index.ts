// The app API worker. M0 scope: health only. Everything else arrives with its module.

interface Env {
  ENVIRONMENT: "dev" | "staging" | "production";
  BUILD_SHA?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({
        service: "marginsheet-api",
        environment: env.ENVIRONMENT,
        build: env.BUILD_SHA ?? "unknown",
      });
    }
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

// planted failure 1 — this em dash must block the lint gate
