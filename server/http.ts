// node:http in front of a web-standard handler: IncomingMessage in as a Request, the Response streamed back out.
import { createServer, type Server } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export function serve(handler: (req: Request) => Promise<Response>): Server {
  return createServer(async (req, res) => {
    try {
      const headers = new Headers();
      for (let i = 0; i < req.rawHeaders.length; i += 2) headers.append(req.rawHeaders[i], req.rawHeaders[i + 1]);
      const method = req.method ?? "GET";
      const body = method === "GET" || method === "HEAD" ? undefined : (Readable.toWeb(req) as ReadableStream<Uint8Array>);
      const request = new Request(`http://${req.headers.host ?? "localhost"}${req.url ?? "/"}`, { method, headers, body, duplex: "half" });
      const response = await handler(request);
      res.writeHead(response.status, [...response.headers].flat());
      if (response.body) await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), res);
      else res.end();
    } catch (e) {
      console.error(e);
      if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" }).end('{"detail":"Server error"}');
      else res.destroy();
    }
  });
}
