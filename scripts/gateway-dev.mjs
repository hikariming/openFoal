import { startGatewayServer } from "../apps/gateway/dist/index.js";

process.env.OPENFOAL_CORE_ENGINE = process.env.OPENFOAL_CORE_ENGINE ?? "pi";
process.env.OPENFOAL_PI_STREAM_MODE = process.env.OPENFOAL_PI_STREAM_MODE ?? "real";

const host = process.env.OPENFOAL_GATEWAY_HOST ?? "127.0.0.1";
const port = Number(process.env.OPENFOAL_GATEWAY_PORT ?? "8787");
const sqlitePath = process.env.OPENFOAL_GATEWAY_SQLITE_PATH;

const server = await startGatewayServer({
  host,
  port,
  sqlitePath
});

console.log(`[gateway] listening on http://${server.host}:${server.port}`);
console.log(`[gateway] health: http://${server.host}:${server.port}/health`);
console.log(`[gateway] rpc:    http://${server.host}:${server.port}/rpc`);
console.log(`[gateway] core:   engine=${process.env.OPENFOAL_CORE_ENGINE}, stream=${process.env.OPENFOAL_PI_STREAM_MODE}`);

const shutdown = async () => {
  await server.close();
  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
