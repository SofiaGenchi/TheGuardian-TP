const path = require("node:path");
const { Worker } = require("node:worker_threads");
//Importa Worker, que permite crear hilos dentro de un proceso.

const logger = require("../shared/logger");
const { MESSAGE_TYPES } = require("../shared/messages");

function createSharedCounter() {
  // Crea memoria compartida de 4 bytes.
  const sharedBuffer = new SharedArrayBuffer(4);
  const counter = new Int32Array(sharedBuffer);

  return { sharedBuffer, counter };
}

function createIngestService({ timeoutMs, onIngested }) {
  const { sharedBuffer, counter } = createSharedCounter();
  const pendingRequests = new Map();

  let nextRequestId = 0;
  let ingestThread = null;

  function getLocalCounter() {
    return Atomics.load(counter, 0);
  }

  function createRequestId() {
    nextRequestId += 1;
    return `${process.pid}-${nextRequestId}`;
  }

  function removePendingRequest(requestId) {
    const pending = pendingRequests.get(requestId);

    if (!pending) {
      return null;
    }

    clearTimeout(pending.timeout);
    pendingRequests.delete(requestId);
    return pending;
  }

  function handleDoneMessage(message) {
    const pending = removePendingRequest(message.requestId);

    if (!pending) {
      return;
    }

    onIngested();

    pending.resolve({
      accepted: true,
      id: message.id,
      pid: process.pid,
      localCounter: message.localCounter,
      checksum: message.checksum,
    });
  }

  function startThread() {
    ingestThread = new Worker(path.join(__dirname, "ingest-worker.js"), {
      workerData: { sharedBuffer },
    });

    ingestThread.on("message", (message) => {
      if (message && message.type === MESSAGE_TYPES.INGEST_DONE) {
        handleDoneMessage(message);
      }
    });

    ingestThread.on("error", (error) => {
      logger.error(`[WORKER ${process.pid}] Error en Worker Thread`, error);
    });

    ingestThread.on("exit", (code) => {
      if (code !== 0) {
        logger.error(`[WORKER ${process.pid}] Worker Thread finalizo: ${code}`);
      }
    });
  }

  function ingest(id) {
    return new Promise((resolve, reject) => {
      const requestId = createRequestId();

      const timeout = setTimeout(() => {
        pendingRequests.delete(requestId);
        reject(new Error("Timeout procesando la ingesta"));
      }, timeoutMs);

      pendingRequests.set(requestId, { resolve, reject, timeout });

      ingestThread.postMessage({
        type: "ingest",
        requestId,
        id,
      });
    });
  }

  startThread();

  return {
    getLocalCounter,
    ingest,
  };
}

module.exports = { createIngestService };
