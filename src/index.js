const cluster = require("node:cluster");
//Importa cluster, que permite crear varios procesos Node. 


const { config } = require("./config/config");
//Trae la configuración: puerto, cantidad de CPUs, cantidad de workers y timeouts.

const { startMaster } = require("./cluster/master");
const { startServer } = require("./http/server");
//Trae dos funciones: una para iniciar el master y otra para iniciar el servidor HTTP.



//Si este proceso es el principal, no levanta la API. Se encarga de crear y controlar workers.
if (cluster.isPrimary) {
  // El proceso principal administra el cluster.
  startMaster(config);
} else {
  // Cada worker del cluster levanta la API HTTP.
  startServer(config);
  //Si este proceso es un worker del cluster, levanta el servidor HTTP.
}
