const http = require("node:http");
//Importa el módulo HTTP nativo de Node para crear la API.

const { createIngestService } = require("../ingest/ingest-service");
const logger = require("../shared/logger");
const { MESSAGE_TYPES } = require("../shared/messages");
const { createStatsService } = require("../stats/stats-service");
const { createRequestHandler } = require("./routes");



//Cuando una ingesta termina, el worker le avisa al master para sumar al contador global.
function notifyMasterAboutIngest() {
  if (process.send) {
    process.send({ type: MESSAGE_TYPES.INGESTED, count: 1, pid: process.pid });
  }
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
    logger.worker(`Worker PID ${process.pid} escuchando en puerto ${port}`);
  });
}

module.exports = { startServer };
