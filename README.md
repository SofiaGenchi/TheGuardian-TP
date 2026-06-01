# The Guardian

## Comandos para mostrar el TP

Terminal 1:

```bash
npm start
```

Salida esperada:

![Salida de npm start](docs/images/npm-start.png)

Terminal 2:

```bash
npm test
```

Salida esperada:

![Salida de npm test](docs/images/npm-test.png)

Para self-healing:

```bash
curl http://127.0.0.1:8080/crash
```

Respuesta del comando:

![Respuesta de curl crash](docs/images/curl-crash.png)

El master detecta la caída y crea un nuevo worker:

![Self-healing en workers](docs/images/self-healing-workers.png)
