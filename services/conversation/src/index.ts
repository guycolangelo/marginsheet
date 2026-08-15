// The conversation service worker (the brains). M0 scope: health only.
// Phase B (M10 onward) builds the machine; nothing composes or sends from here yet.

interface Env {
  ENVIRONMENT: "dev" | "staging" | "production";
  BUILD_SHA?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({
        service: "marginsheet-conversation",
        environment: env.ENVIRONMENT,
        build: env.BUILD_SHA ?? "unknown",
      });
    }
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
