const cluster = require("node:cluster");
const logger = require("../shared/logger");
const { MESSAGE_TYPES } = require("../shared/messages");

function getActiveWorkerPids() {
  return Object.values(cluster.workers)
    .map((worker) => worker.process.pid)
    .filter(Boolean);
}

function createAtomicCounter() {
  const sharedBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  return new Int32Array(sharedBuffer);
}

//Crea el estado del master. Guarda el total de ingestas en un contador atomico.
function createMasterState(workerCount) {
  return {
    ingestsByWorker: {},
    totalIngestedCounter: createAtomicCounter(),
    workerCount,
  };
}

function getTotalIngested(state) {
  return Atomics.load(state.totalIngestedCounter, 0);
}

function handleWorkerMessage(worker, state, message) {
  if (!message || typeof message !== "object") {
    return;
  }

  // Cada worker avisa al master cuando termino una ingesta.
  // El master suma al contador global con Atomics para mantener el total exacto.
  if (message.type === MESSAGE_TYPES.INGESTED) {
    const pid = String(message.pid || worker.process.pid);
    const count = Number(message.count);

    if (!Number.isInteger(count) || count <= 0) {
      return;
    }

    Atomics.add(state.totalIngestedCounter, 0, count);
    state.ingestsByWorker[pid] = (state.ingestsByWorker[pid] || 0) + count;
    return;
  }

  // Esta respuesta permite que /stats muestre el total global.
  //Cuando un worker pide estadísticas, el master responde con el total global, cantidad de workers y PIDs activos.
  if (message.type === MESSAGE_TYPES.STATS_REQUEST) {
    worker.send({
      type: MESSAGE_TYPES.STATS_RESPONSE,
      requestId: message.requestId,
      ingestsByWorker: state.ingestsByWorker,
      totalIngested: getTotalIngested(state),
      workerCount: state.workerCount,
      workerPids: getActiveWorkerPids(),
    });
  }
}


//Crea un nuevo worker del cluster. Cada worker va a levantar la API en el puerto 8080.
function forkWorker({ port, state }) {
  const worker = cluster.fork({ PORT: port });


  //El master escucha mensajes de los workers. Los workers le avisan cuando terminaron una ingesta.
  worker.on("message", (message) => {
    handleWorkerMessage(worker, state, message);
  });
}

function startMaster({ port, cpuCount, workerCount }) {
  const state = createMasterState(workerCount);

  // Fuerza round-robin: cada conexion nueva se reparte entre workers.
  cluster.schedulingPolicy = cluster.SCHED_RR;

  logger.master(`PID ${process.pid}`);
  logger.master(`CPUs detectadas: ${cpuCount}`);
  logger.master(`Levantando ${workerCount} workers`);


  // Levanta la mitad de los núcleos como workers.
  for (let i = 0; i < workerCount; i += 1) {
    forkWorker({ port, state });
  }

  cluster.on("online", (worker) => {
    logger.master(`Worker ${worker.process.pid} está online y listo.`);
  });

  // Self-Healing: si un worker muere, el master crea otro enseguida.
  // Esto es el self-healing. Si un worker muere, el master crea otro inmediatamente.
  cluster.on("exit", (worker, code, signal) => {
    logger.warn(`Worker ${worker.process.pid} ha muerto. Levantando uno nuevo para mantener la API ...`);
    forkWorker({ port, state });
  });
}

module.exports = { startMaster };
