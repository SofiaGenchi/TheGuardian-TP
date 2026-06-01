const os = require("node:os");

function getCpuCount() {
  return os.availableParallelism ? os.availableParallelism() : os.cpus().length;
}

function getWorkerCount() {
  const cpuCount = getCpuCount();

  // El TP pide usar la mitad de los nucleos disponibles.
  return Math.max(1, Math.floor(cpuCount / 2));
}

const config = {
  port: Number(process.env.PORT || 8080),
  cpuCount: getCpuCount(),
  workerCount: getWorkerCount(),
  ingestTimeoutMs: 10000,
  statsTimeoutMs: 3000,
};

module.exports = { config };
