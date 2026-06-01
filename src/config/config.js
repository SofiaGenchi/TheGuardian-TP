const os = require("node:os");
//Importa os para saber cuántos núcleos tiene la máquina.

//Calcula cuántos CPUs hay disponibles.
function getCpuCount() {
  return os.availableParallelism ? os.availableParallelism() : os.cpus().length;
}


//Calcula la mitad de los núcleos, Math.max(1, ...) asegura que al menos haya un worker.
function getWorkerCount() {
  const cpuCount = getCpuCount();

  // Para usar la mitad de los nucleos disponibles.
  return Math.max(1, Math.floor(cpuCount / 2));
}

//Define que la API escucha en el puerto 8080, usa mitad de CPUs y tiene tiempos máximos de espera.
const config = {
  port: Number(process.env.PORT || 8080),
  cpuCount: getCpuCount(),
  workerCount: getWorkerCount(),
  ingestTimeoutMs: 10000,
  statsTimeoutMs: 3000,
};

module.exports = { config };
