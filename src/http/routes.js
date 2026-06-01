const {
  readIntegerQuery,
  readUrl,
  sendJson,
  sendNotFound,
} = require("./http-utils");

function createRequestHandler({ crashService, ingestService, statsService }) {
  return async function handleRequest(request, response) {
    const url = readUrl(request);

    try {
      // Ruta obligatoria: responde rapido y no usa el Worker Thread.
      //Esta es la ruta /health. Responde rápido con estado ok y el PID del proceso.
      //Esto demuestra que la API sigue viva y no está bloqueada.
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
      // Ruta extra para probar self-healing. El master elige un worker al azar,
      // lo cierra a propósito y crea otro.
      if (url.pathname === "/crash") {
        const result = await crashService.requestRandomWorkerCrash();
        sendJson(response, 200, result);
        return;
      }

      sendNotFound(response);
    } catch (error) {
      sendJson(response, 500, { error: error.message });
    }
  };
}

module.exports = { createRequestHandler };
