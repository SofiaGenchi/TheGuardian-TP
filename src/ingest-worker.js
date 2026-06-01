const { parentPort, workerData } = require("node:worker_threads");
const { MESSAGE_TYPES } = require("./messages");

// Recibe la memoria compartida y la convierte en un array de enteros.
const counter = new Int32Array(workerData.sharedBuffer);


//Simula un cálculo pesado. Lo importante es que este cálculo no corre en la API principal, corre en el Worker Thread.
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

  //Ejecuta el cálculo pesado.
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
