const cluster = require("node:cluster");
const { MESSAGE_TYPES } = require("./messages");

function getActiveWorkerPids() {
  return Object.values(cluster.workers)
    .map((worker) => worker.process.pid)
    .filter(Boolean);
}

function createMasterState(workerCount) {
  return {
    totalIngested: 0,
    workerCount,
  };
}

function handleWorkerMessage(worker, state, message) {
  if (!message || typeof message !== "object") {
    return;
  }

  // Cada worker avisa al master cuando termino una ingesta.
  if (message.type === MESSAGE_TYPES.INGESTED) {
    state.totalIngested += message.count;
    return;
  }

  // Esta respuesta permite que /stats muestre el total global.
  if (message.type === MESSAGE_TYPES.STATS_REQUEST) {
    worker.send({
      type: MESSAGE_TYPES.STATS_RESPONSE,
      requestId: message.requestId,
      totalIngested: state.totalIngested,
      workerCount: state.workerCount,
      workerPids: getActiveWorkerPids(),
    });
  }
}

function forkWorker({ port, state }) {
  const worker = cluster.fork({ PORT: port });

  worker.on("message", (message) => {
    handleWorkerMessage(worker, state, message);
  });
}

function startMaster({ port, cpuCount, workerCount }) {
  const state = createMasterState(workerCount);

  console.log(`[MASTER] PID ${process.pid}`);
  console.log(`[MASTER] CPUs detectadas: ${cpuCount}`);
  console.log(`[MASTER] Levantando ${workerCount} workers`);

  for (let i = 0; i < workerCount; i += 1) {
    forkWorker({ port, state });
  }

  // Self-Healing: si un worker muere, el master crea otro enseguida.
  cluster.on("exit", (worker, code, signal) => {
    console.log(
      `[MASTER] Worker ${worker.process.pid} murio. code=${code} signal=${signal}`
    );
    console.log("[MASTER] Creando reemplazo...");
    forkWorker({ port, state });
  });
}

module.exports = { startMaster };
