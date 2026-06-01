const http = require("node:http");
const {
  readIntegerQuery,
  readUrl,
  sendJson,
  sendNotFound,
} = require("./http-utils");
const { createIngestService } = require("./ingest-service");
const { MESSAGE_TYPES } = require("./messages");
const { createStatsService } = require("./stats-service");

function notifyMasterAboutIngest() {
  if (process.send) {
    process.send({ type: MESSAGE_TYPES.INGESTED, count: 1 });
  }
}

function createRequestHandler({ ingestService, statsService }) {
  return async function handleRequest(request, response) {
    const url = readUrl(request);

    try {
      // Ruta obligatoria: responde rapido y no usa el Worker Thread.
      if (url.pathname === "/health") {
        sendJson(response, 200, { status: "ok", pid: process.pid });
        return;
      }

      // Ruta obligatoria: delega el calculo pesado al Worker Thread.
      if (url.pathname === "/ingest") {
        const id = readIntegerQuery(url, "id");

        if (id === null) {
          sendJson(response, 400, {
            error: "El parametro id debe ser un numero entero",
          });
          return;
        }

        const result = await ingestService.ingest(id);
        sendJson(response, 200, result);
        return;
      }

      // Ruta extra para que el script pueda demostrar el contador final.
      if (url.pathname === "/stats") {
        const stats = await statsService.getStats();
        sendJson(response, 200, stats);
        return;
      }

      // Ruta extra para probar el Self-Healing del cluster.
      if (url.pathname === "/crash") {
        sendJson(response, 200, {
          message: "Este worker se va a cerrar para probar self-healing",
          pid: process.pid,
        });
        setTimeout(() => process.exit(1), 100);
        return;
      }

      sendNotFound(response);
    } catch (error) {
      sendJson(response, 500, { error: error.message });
    }
  };
}

function startServer({ port, ingestTimeoutMs, statsTimeoutMs }) {
  const ingestService = createIngestService({
    timeoutMs: ingestTimeoutMs,
    onIngested: notifyMasterAboutIngest,
  });

  const statsService = createStatsService({
    timeoutMs: statsTimeoutMs,
    getLocalCounter: ingestService.getLocalCounter,
  });

  if (process.send) {
    process.on("message", statsService.handleMasterMessage);
  }

  const server = http.createServer(
    createRequestHandler({ ingestService, statsService })
  );

  server.listen(port, () => {
    console.log(`[WORKER ${process.pid}] Servidor escuchando en ${port}`);
  });
}

module.exports = { startServer };
