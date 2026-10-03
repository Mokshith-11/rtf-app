export default {
  async fetch(request: Request, env: { ASSETS: { fetch: (req: Request) => Promise<Response> } }): Promise<Response> {
    const url = new URL(request.url);

    // Forward all API requests directly to the live backend
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      const backendUrl = new URL(url.pathname + url.search, "https://rtf-61dr.onrender.com");
      const requestHeaders = new Headers(request.headers);
      
      const modifiedRequest = new Request(backendUrl.toString(), {
        method: request.method,
        headers: requestHeaders,
        body: request.body,
        redirect: "follow",
        duplex: request.body ? "half" : undefined
      } as RequestInit);

      return fetch(modifiedRequest);
    }

    // Serve all frontend assets through Cloudflare's global edge network
    return env.ASSETS.fetch(request);
  }
};
