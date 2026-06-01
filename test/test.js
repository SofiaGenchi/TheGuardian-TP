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
  console.log(`Iniciando prueba: Enviando ${TOTAL_REQUESTS} peticiones concurrentes a ${BASE_URL}/ingest...`);

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
  
  console.log(`\nEsperando 3 segundos para que finalicen los Worker Threads para chequear el contador...`);
  await sleep(3000); // 3 segundos de espera obligatoria por requerimiento de la consola
  const finalStats = await waitForFinalCounter();
  
  // Colores ANSI
  const colors = {
    reset: "\x1b[0m",
    cyan: "\x1b[36m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    bold: "\x1b[1m"
  };

  console.log(`\n${colors.cyan}${colors.bold}--RESULTADOS DE LA PRUEBA--${colors.reset}`);
  console.log(`Peticiones /ingest completadas: ${colors.green}${successfulResponses.length}${colors.reset}`);
  console.log(`tiempo total de ejecucion: ${colors.yellow}${elapsed.toFixed(2)} ms${colors.reset}`);
  if (healthLatencies.length > 0) {
    console.log(`latencia media de /health: ${colors.yellow}${average(healthLatencies).toFixed(2)} ms${colors.reset}`);
  } else {
    console.log(`latencia media de /health: ${colors.yellow}0.00 ms${colors.reset}`);
  }

  console.log(`\n${colors.cyan}${colors.bold}--CONTADORES POR WORKER${colors.reset}`);
  Object.entries(finalStats.ingestsByWorker).forEach(([pid, count]) => {
    console.log(`worker PID ${pid} : proceso ${colors.green}${count}${colors.reset} peticiones`);
  });

  console.log(`\n${colors.bold}TOTAL PROCESADO EN TODOS LOS WORKERS: ${colors.green}${finalStats.totalIngested}${colors.reset}`);

  if (successfulResponses.length !== TOTAL_REQUESTS || finalStats.totalIngested !== TOTAL_REQUESTS || failedRequests.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
