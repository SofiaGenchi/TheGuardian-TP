# The Guardian

Trabajo practico de Programacion sobre Redes.

## Como ejecutar

```bash
npm start
```

En otra terminal:

```bash
npm test
```

## Rutas

- `GET /health`: responde rapido con estado y PID.
- `GET /ingest?id=1`: manda una ingesta al Worker Thread.
- `GET /stats`: muestra el contador global usado por el script de prueba.
- `GET /crash`: cierra un worker para probar el self-healing.

## Arquitectura

- `src/index.js`: decide si el proceso es master o worker.
- `src/master.js`: crea el cluster, cuenta ingestas globales y hace self-healing.
- `src/server.js`: define las rutas HTTP.
- `src/ingest-service.js`: administra el Worker Thread y el SharedArrayBuffer.
- `src/ingest-worker.js`: hace el calculo pesado y usa `Atomics.add()`.
- `src/stats-service.js`: pide al master el contador global.
- `src/http-utils.js`: funciones simples para responder JSON y leer parametros.
- `src/config.js`: configuracion del puerto, CPUs y timeouts.
