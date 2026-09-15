import { buildServer } from "./server.js";

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || "0.0.0.0";

async function main() {
  const server = await buildServer({ logger: true });

  try {
    await server.listen({ port, host });
    console.log(`🚀 AI Prompt Registry API listening on http://${host}:${port}`);
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }

  // Graceful shutdown
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
  for (const signal of signals) {
    process.on(signal, async () => {
      console.log(`Received ${signal}, shutting down gracefully...`);
      await server.close();
      process.exit(0);
    });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export * from "./server.js";
export * from "./storage/index.js";
