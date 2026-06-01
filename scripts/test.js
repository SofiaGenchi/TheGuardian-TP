const http = require("node:http");
const https = require("node:https");

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:8080";
const TOTAL_REQUESTS = Number(process.env.TOTAL_REQUESTS || 500);
//Define que se van a mandar 500 peticiones,


const HEALTH_INTERVAL_MS = 25;
const HEALTH_WARMUP_MS = 100;
const HEALTH_COOLDOWN_MS = 100;

function average(numbers) {
  return numbers.reduce((total, value) => total + value, 0) / numbers.length;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getJson(url) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === "https:" ? https : http;

    const request = client.request(
      parsedUrl,
      {
        agent: false,
        headers: { Connection: "close" },
        method: "GET",
      },
      (response) => {
        let rawBody = "";

        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          rawBody += chunk;
        });
        response.on("end", () => {
          const body = JSON.parse(rawBody);

          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(body.error || `Error HTTP ${response.statusCode}`));
            return;
          }

          resolve(body);
        });
      }
    );

    request.on("error", reject);
    request.end();
  });
}

function countByPid(responses) {
  return responses.reduce((counter, response) => {
    const pid = String(response.pid);
    counter[pid] = (counter[pid] || 0) + 1;
    return counter;
  }, {});
}

function formatDistribution(distribution) {
  return Object.entries(distribution)
    .sort(([pidA], [pidB]) => Number(pidA) - Number(pidB))
    .map(([pid, count]) => `${pid}: ${count}`)
    .join(" | ");
}

async function waitForFinalCounter() {
  for (let i = 0; i < 20; i += 1) {
    const stats = await getJson(`${BASE_URL}/stats`);

    if (stats.totalIngested === TOTAL_REQUESTS) {
      return stats;
    }

    await sleep(100);
  }

  return getJson(`${BASE_URL}/stats`);
}


//Consulta /health repetidas veces mientras ocurre la ráfaga de ingestas. Esto demuestra que /health sigue respondiendo.
async function runHealthMonitor(latencies, isRunning) {
  while (isRunning()) {
    const start = performance.now();
    const health = await getJson(`${BASE_URL}/health`);
    const elapsed = performance.now() - start;

    latencies.push(elapsed);
    console.log(
      `/health -> ${elapsed.toFixed(2)} ms | status=${health.status} pid=${health.pid}`
    );

    await sleep(HEALTH_INTERVAL_MS);
  }
}


//Manda las 500 peticiones concurrentes a /ingest.
//Promise.all hace que salgan todas juntas, no una por una.
async function runIngestBurst() {
  const start = performance.now();

  const responses = await Promise.all(
    Array.from({ length: TOTAL_REQUESTS }, (_, index) =>
      getJson(`${BASE_URL}/ingest?id=${index + 1}`)
    )
  );

  return {
    elapsed: performance.now() - start,
    responses,
  };
}

async function main() {
  console.log(`Probando ${BASE_URL}`);
  console.log(`Enviando ${TOTAL_REQUESTS} peticiones concurrentes a /ingest`);

  const healthLatencies = [];
  let keepCheckingHealth = true;

  // Mientras corre la rafaga, consultamos /health en paralelo.
  const healthLoop = runHealthMonitor(healthLatencies, () => keepCheckingHealth);

  await sleep(HEALTH_WARMUP_MS);
  const { elapsed, responses: ingestResponses } = await runIngestBurst();
  await sleep(HEALTH_COOLDOWN_MS);

  keepCheckingHealth = false;
  await healthLoop;

  const accepted = ingestResponses.filter((response) => response.accepted).length;
  const testDistribution = countByPid(ingestResponses);
  const finalStats = await waitForFinalCounter();
  //Espera a que el contador final llegue a 500.

  console.log("\nResultado final");
  console.log(`Ingestas aceptadas: ${accepted}/${TOTAL_REQUESTS}`);
  console.log(`Contador global final: ${finalStats.totalIngested}`);
  console.log(`Workers del cluster: ${finalStats.workerCount}`);
  console.log(`PIDs activos: ${finalStats.workerPids.join(", ")}`);
  console.log(`Distribucion segun respuestas: ${formatDistribution(testDistribution)}`);
  console.log(
    `Distribucion segun master: ${formatDistribution(finalStats.ingestsByWorker)}`
  );
  console.log(`Tiempo total de ingesta: ${elapsed.toFixed(2)} ms`);

  if (healthLatencies.length > 0) {
    console.log(
      `/health promedio: ${average(healthLatencies).toFixed(2)} ms | maximo: ${Math.max(
        ...healthLatencies
      ).toFixed(2)} ms`
    );
  }

  if (accepted !== TOTAL_REQUESTS || finalStats.totalIngested !== TOTAL_REQUESTS) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
