const { parentPort, workerData } = require("node:worker_threads");
const { MESSAGE_TYPES } = require("./messages");

// Este contador vive en memoria compartida entre los dos hilos.
const counter = new Int32Array(workerData.sharedBuffer);

function heavyMath(id) {
  let result = 0;

  // Simula procesamiento matematico pesado sin bloquear la API HTTP.
  for (let i = 0; i < 120000; i += 1) {
    result += Math.sqrt((id + i) % 10000);
  }

  return Number(result.toFixed(2));
}

parentPort.on("message", (message) => {
  if (!message || message.type !== "ingest") {
    return;
  }

  const checksum = heavyMath(message.id);

  // Atomics.add evita carreras al incrementar la memoria compartida.
  const localCounter = Atomics.add(counter, 0, 1) + 1;

  parentPort.postMessage({
    type: MESSAGE_TYPES.INGEST_DONE,
    requestId: message.requestId,
    id: message.id,
    localCounter,
    checksum,
  });
});
