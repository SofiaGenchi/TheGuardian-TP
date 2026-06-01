const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:8080";
const TOTAL_REQUESTS = Number(process.env.TOTAL_REQUESTS || 500);
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
  const response = await fetch(url);
  const body = await response.json();

  if (!response.ok) {
    throw new Error(body.error || `Error HTTP ${response.status}`);
  }

  return body;
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
  const finalStats = await waitForFinalCounter();

  console.log("\nResultado final");
  console.log(`Ingestas aceptadas: ${accepted}/${TOTAL_REQUESTS}`);
  console.log(`Contador global final: ${finalStats.totalIngested}`);
  console.log(`Workers del cluster: ${finalStats.workerCount}`);
  console.log(`PIDs activos: ${finalStats.workerPids.join(", ")}`);
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
