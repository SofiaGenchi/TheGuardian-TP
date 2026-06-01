# The Guardian

The Guardian es un micro-orquestador de ingesta y monitoreo reactivo hecho con Node.js.

El proyecto usa `cluster` para levantar varios procesos HTTP, `worker_threads` para ejecutar trabajo pesado sin bloquear la API, `SharedArrayBuffer` y `Atomics` para mantener contadores seguros, y un mecanismo de self-healing para reiniciar workers cuando alguno se cae.

## Objetivo del TP

Demostrar una API capaz de:

- responder rapido a chequeos de salud;
- procesar muchas ingestas concurrentes;
- delegar calculos pesados a un Worker Thread;
- mantener estadisticas globales del cluster con un contador atomico;
- detectar la caida de un worker y crear uno nuevo automaticamente.

## Arquitectura

El sistema esta dividido en tres niveles:

- **Master process**: crea los workers del cluster, escucha sus mensajes, mantiene el contador global con `SharedArrayBuffer` + `Atomics` y reinicia workers caidos.
- **Cluster workers**: levantan la API HTTP en el puerto configurado y atienden las rutas.
- **Worker Thread de ingesta**: ejecuta el calculo pesado de cada `/ingest` para que el worker HTTP no quede bloqueado, e incrementa el contador local con `Atomics.add`.

Por defecto, el master levanta la mitad de los nucleos disponibles como workers. Si un worker muere, el master lo reemplaza automaticamente.

## Requisitos

- Node.js 18 o superior.
- npm.

No hay dependencias externas: el proyecto usa modulos nativos de Node.js.

## Comandos

Levantar la API:

```bash
npm start
```

Ejecutar la prueba de carga:

```bash
npm test
```

## Variables de entorno

La API se puede configurar con:

```bash
PORT=8080 npm start
```

El test permite cambiar la URL base y la cantidad de peticiones concurrentes:

```bash
BASE_URL=http://127.0.0.1:8080 TOTAL_REQUESTS=500 npm test
```

## Endpoints

| Metodo | Endpoint | Descripcion |
| --- | --- | --- |
| `GET` | `/health` | Responde rapido con el estado de la API y el PID del worker que atendio la request. |
| `GET` | `/ingest?id=1` | Procesa una ingesta delegando el calculo pesado al Worker Thread. |
| `GET` | `/stats` | Devuelve estadisticas globales del cluster y contadores por worker. |
| `GET` | `/crash` | Le pide al master que elija un worker activo al azar y lo cierre para demostrar self-healing. |

Ejemplos:

```bash
curl http://127.0.0.1:8080/health
curl "http://127.0.0.1:8080/ingest?id=1"
curl http://127.0.0.1:8080/stats
curl http://127.0.0.1:8080/crash
```

## Prueba de carga

El comando `npm test` realiza una prueba end-to-end contra la API levantada:

- envia 500 requests concurrentes a `/ingest`;
- monitorea `/health` durante la carga;
- mide latencias de `/ingest` y `/health`;
- consulta `/stats` al final;
- verifica que el contador global atomico coincida con la cantidad de ingestas exitosas.

Para correrla:

1. En una terminal, levantar el servidor:

```bash
npm start
```

2. En otra terminal, ejecutar:

```bash
npm test
```

## Demo del TP

### Arranque del cluster

Al ejecutar `npm start`, el proceso master muestra su PID, la cantidad de CPUs detectadas y los workers levantados:

![Salida de npm start](docs/images/npm-start.png)

### Self-healing

Para probar el reinicio automatico de workers, se puede pedir un crash controlado:

```bash
curl http://127.0.0.1:8080/crash
```

Respuesta del endpoint. El campo `targetPid` indica que worker eligio el master al azar:

```json
{
  "message": "El master eligio un worker al azar para probar self-healing",
  "requestedByPid": 3306,
  "targetPid": 3297,
  "workerPids": [3297, 3306, 3308, 3309, 3310]
}
```

El master detecta la caida del worker elegido y crea uno nuevo:

![Self-healing en workers](docs/images/self-healing-workers.png)

### Resultado del test

Al ejecutar `npm test`, se valida que las ingestas concurrentes sean procesadas correctamente:

![Salida de npm test](docs/images/npm-test.png)

## Estructura del proyecto

```text
src/
  cluster/       Logica del proceso master y self-healing
  config/        Configuracion de puerto, CPUs y timeouts
  http/          Servidor HTTP, rutas y utilidades de respuesta
  ingest/        Servicio de ingesta y Worker Thread
  shared/        Mensajes y logger compartidos
  stats/         Consulta de estadisticas globales
test/
  test.js        Prueba de carga y verificacion end-to-end
docs/images/     Capturas usadas en la demo
```

## Troubleshooting

- Si el puerto `8080` esta ocupado, usar otro puerto: `PORT=3000 npm start`.
- Si `npm test` falla por conexion rechazada, verificar que `npm start` siga corriendo.
- Si se ejecuta `/crash`, es esperado que muera un worker elegido al azar y aparezca otro PID en la salida del master.
