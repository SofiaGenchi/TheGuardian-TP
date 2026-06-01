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
    try {
      const stats = await getJson(`${BASE_URL}/stats`);

      if (stats.totalIngested === TOTAL_REQUESTS) {
        return stats;
      }
    } catch (err) {
      // Ignorar errores temporales como ECONNREFUSED mientras los workers reinician
    }

    await sleep(100);
  }

  return getJson(`${BASE_URL}/stats`);
}


//Consulta /health repetidas veces mientras ocurre la ráfaga de ingestas. Esto demuestra que /health sigue respondiendo.
async function runHealthMonitor(latencies, isRunning) {
  while (isRunning()) {
    const start = performance.now();
    try {
      const health = await getJson(`${BASE_URL}/health`);
      const elapsed = performance.now() - start;

      latencies.push(elapsed);
      console.log(
        `/health -> ${elapsed.toFixed(2)} ms | status=${health.status} pid=${health.pid}`
      );
    } catch (err) {
      console.log(`/health -> falló temporalmente (${err.code || err.message})`);
    }

    await sleep(HEALTH_INTERVAL_MS);
  }
}


//Manda las 500 peticiones concurrentes a /ingest.
//Promise.all hace que salgan todas juntas, no una por una.
async function runIngestBurst() {
  const start = performance.now();

  const results = await Promise.all(
    Array.from({ length: TOTAL_REQUESTS }, async (_, index) => {
      const reqStart = performance.now();
      try {
        const response = await getJson(`${BASE_URL}/ingest?id=${index + 1}`);
        return { success: true, response, elapsed: performance.now() - reqStart };
      } catch (error) {
        return { success: false, error, elapsed: performance.now() - reqStart };
      }
    })
  );

  return {
    elapsed: performance.now() - start,
    results,
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
  const { elapsed, results: ingestResults } = await runIngestBurst();
  await sleep(HEALTH_COOLDOWN_MS);

  keepCheckingHealth = false;
  await healthLoop;

  const successfulResponses = ingestResults.filter(r => r.success).map(r => r.response);
  const failedRequests = ingestResults.filter(r => !r.success);
  const latencies = ingestResults.map(r => r.elapsed);

  const accepted = successfulResponses.filter((response) => response.accepted).length;
  const testDistribution = countByPid(successfulResponses);
  const finalStats = await waitForFinalCounter();
  
  // Colores ANSI
  const colors = {
    reset: "\x1b[0m",
    cyan: "\x1b[36m",
    green: "\x1b[32m",
    red: "\x1b[31m",
    yellow: "\x1b[33m",
    bold: "\x1b[1m"
  };

  const masterLoads = Object.values(finalStats.ingestsByWorker);
  const minLoad = masterLoads.length > 0 ? Math.min(...masterLoads) : 0;
  const maxLoad = masterLoads.length > 0 ? Math.max(...masterLoads) : 0;

  console.log(`\n${colors.cyan}${colors.bold}--- RESULTADO FINAL DEL TEST ---${colors.reset}`);
  console.log(`Peticiones totales enviadas: ${TOTAL_REQUESTS}`);
  console.log(`Ingestas exitosas (HTTP 200): ${colors.green}${successfulResponses.length}${colors.reset}`);
  console.log(`Peticiones fallidas (Errores): ${failedRequests.length > 0 ? colors.red : colors.green}${failedRequests.length}${colors.reset}`);
  if (failedRequests.length > 0) {
    console.log(`${colors.red}-> Detalle del primer error: ${failedRequests[0].error.message}${colors.reset}`);
  }
  
  console.log(`\n${colors.cyan}${colors.bold}--- ESTADÍSTICAS DEL CLUSTER ---${colors.reset}`);
  console.log(`Contador global final: ${colors.green}${finalStats.totalIngested}${colors.reset}`);
  console.log(`Workers activos en el cluster: ${colors.yellow}${finalStats.workerCount}${colors.reset}`);
  console.log(`PIDs de los workers: ${finalStats.workerPids.join(", ")}`);
  
  console.log(`\n${colors.cyan}${colors.bold}--- DISTRIBUCIÓN DE CARGA ---${colors.reset}`);
  console.log(`Distribución vista por el cliente: ${formatDistribution(testDistribution)}`);
  console.log(
    `Distribución reportada por el master: ${formatDistribution(finalStats.ingestsByWorker)}`
  );
  console.log(`Balanceo: Min=${minLoad} / Max=${maxLoad} (Diferencia de ${maxLoad - minLoad} peticiones)`);

  console.log(`\n${colors.cyan}${colors.bold}--- RENDIMIENTO Y LATENCIAS ---${colors.reset}`);
  console.log(`Tiempo total de la ráfaga: ${colors.yellow}${elapsed.toFixed(2)} ms${colors.reset}`);
  console.log(`Latencia promedio por petición (ingest): ${average(latencies).toFixed(2)} ms`);
  console.log(`Latencia máxima por petición (ingest): ${Math.max(...latencies).toFixed(2)} ms`);
  console.log(`Latencia mínima por petición (ingest): ${Math.min(...latencies).toFixed(2)} ms`);

  if (healthLatencies.length > 0) {
    console.log(
      `/health promedio: ${colors.yellow}${average(healthLatencies).toFixed(2)} ms${colors.reset} | maximo: ${Math.max(
        ...healthLatencies
      ).toFixed(2)} ms`
    );
  }

  if (accepted !== TOTAL_REQUESTS || finalStats.totalIngested !== TOTAL_REQUESTS || failedRequests.length > 0) {
    console.log(`\n${colors.red}⚠️ ALERTA: El test finalizó con inconsistencias o errores.${colors.reset}`);
    process.exitCode = 1;
  } else {
    console.log(`\n${colors.green}${colors.bold}✅ Test completado con éxito. Todas las ingestas fueron procesadas.${colors.reset}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
