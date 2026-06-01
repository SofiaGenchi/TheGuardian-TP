const http = require("node:http");
const https = require("node:https");

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:8080";
const TOTAL_REQUESTS = Number(process.env.TOTAL_REQUESTS || 500);

const HEALTH_INTERVAL_MS = 25;
const HEALTH_WARMUP_MS = 100;
const HEALTH_COOLDOWN_MS = 100;
const FINAL_COUNTER_WAIT_MS = 3000;

const colors = {
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  reset: "\x1b[0m",
  yellow: "\x1b[33m",
};

function average(numbers) {
  return numbers.reduce((total, value) => total + value, 0) / numbers.length;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function colorText(color, text) {
  return `${colors[color]}${text}${colors.reset}`;
}

function printSection(title) {
  console.log(`\n${colorText("cyan", colors.bold + `--- ${title} ---`)}`);
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

function getLatencyStats(results) {
  const latencies = results.map((result) => result.elapsed);

  return {
    average: average(latencies),
    max: Math.max(...latencies),
    min: Math.min(...latencies),
  };
}

async function waitForFinalCounter() {
  for (let i = 0; i < 20; i += 1) {
    try {
      const stats = await getJson(`${BASE_URL}/stats`);

      if (stats.totalIngested === TOTAL_REQUESTS) {
        return stats;
      }
    } catch (error) {
      // Se ignoran errores temporales si algun worker esta reiniciando.
    }

    await sleep(100);
  }

  return getJson(`${BASE_URL}/stats`);
}

async function runHealthMonitor(latencies, isRunning) {
  while (isRunning()) {
    const start = performance.now();

    try {
      const health = await getJson(`${BASE_URL}/health`);
      const elapsed = performance.now() - start;

      latencies.push(elapsed);
      console.log(
        `/health -> ${elapsed.toFixed(2)} ms | status=${health.status} | pid=${health.pid}`
      );
    } catch (error) {
      console.log(`/health -> Fallo temporal: ${error.code || error.message}`);
    }

    await sleep(HEALTH_INTERVAL_MS);
  }
}

async function runIngestBurst() {
  const start = performance.now();

  const results = await Promise.all(
    Array.from({ length: TOTAL_REQUESTS }, async (_, index) => {
      const requestStart = performance.now();

      try {
        const response = await getJson(`${BASE_URL}/ingest?id=${index + 1}`);

        return {
          elapsed: performance.now() - requestStart,
          response,
          success: true,
        };
      } catch (error) {
        return {
          elapsed: performance.now() - requestStart,
          error,
          success: false,
        };
      }
    })
  );

  return {
    elapsed: performance.now() - start,
    results,
  };
}

function printFinalResults({
  accepted,
  failedRequests,
  finalStats,
  healthLatencies,
  ingestElapsed,
  ingestResults,
  successfulResponses,
}) {
  const ingestLatency = getLatencyStats(ingestResults);
  const healthAverage =
    healthLatencies.length > 0 ? average(healthLatencies).toFixed(2) : "0.00";

  printSection("Resultados de la prueba");
  console.log(`Peticiones totales enviadas: ${TOTAL_REQUESTS}`);
  console.log(`Ingestas exitosas (HTTP 200): ${colorText("green", accepted)}`);
  console.log(`Peticiones fallidas (Errores): ${colorText("green", failedRequests.length)}`);

  printSection("Estadisticas del cluster");
  console.log(`Contador global final: ${colorText("green", finalStats.totalIngested)}`);
  console.log(`Workers activos en el cluster: ${colorText("yellow", finalStats.workerCount)}`);
  console.log(`PIDs de los workers: ${finalStats.workerPids.join(", ")}`);

  printSection("Contadores por worker");
  Object.entries(finalStats.ingestsByWorker)
    .sort(([pidA], [pidB]) => Number(pidA) - Number(pidB))
    .forEach(([pid, count]) => {
      console.log(`Worker PID ${pid}: Procesó ${colorText("green", count)} peticiones`);
    });

  printSection("Rendimiento y latencias");
  console.log(`Tiempo total de la rafaga: ${colorText("yellow", `${ingestElapsed.toFixed(2)} ms`)}`);
  console.log(`Latencia promedio por peticion (/ingest): ${ingestLatency.average.toFixed(2)} ms`);
  console.log(`Latencia maxima por peticion (/ingest): ${ingestLatency.max.toFixed(2)} ms`);
  console.log(`Latencia minima por peticion (/ingest): ${ingestLatency.min.toFixed(2)} ms`);
  console.log(`Latencia promedio de /health: ${colorText("yellow", `${healthAverage} ms`)}`);

  const completed = successfulResponses.length === TOTAL_REQUESTS;
  const exactCounter = finalStats.totalIngested === TOTAL_REQUESTS;
  const noFailures = failedRequests.length === 0;

  if (completed && exactCounter && noFailures) {
    console.log(`\n${colorText("green", "Test completado con exito. Todas las ingestas fueron procesadas.")}`);
    return;
  }

  console.log(colorText("yellow", "\nEl test termino con diferencias. Revisar los valores anteriores."));
  process.exitCode = 1;
}

async function main() {
  console.log(
    `Iniciando prueba: Enviando ${TOTAL_REQUESTS} peticiones concurrentes a ${BASE_URL}/ingest...`
  );

  const healthLatencies = [];
  let keepCheckingHealth = true;

  const healthLoop = runHealthMonitor(healthLatencies, () => keepCheckingHealth);

  await sleep(HEALTH_WARMUP_MS);
  const { elapsed, results: ingestResults } = await runIngestBurst();
  await sleep(HEALTH_COOLDOWN_MS);

  keepCheckingHealth = false;
  await healthLoop;

  const successfulResponses = ingestResults
    .filter((result) => result.success)
    .map((result) => result.response);
  const failedRequests = ingestResults.filter((result) => !result.success);
  const accepted = successfulResponses.filter((response) => response.accepted).length;

  console.log(
    `\nEsperando ${FINAL_COUNTER_WAIT_MS / 1000} segundos para chequear el contador final...`
  );
  await sleep(FINAL_COUNTER_WAIT_MS);

  const finalStats = await waitForFinalCounter();

  printFinalResults({
    accepted,
    failedRequests,
    finalStats,
    healthLatencies,
    ingestElapsed: elapsed,
    ingestResults,
    successfulResponses,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
