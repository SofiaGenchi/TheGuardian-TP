const cluster = require("node:cluster");
const { config } = require("./config");
const { startMaster } = require("./master");
const { startServer } = require("./server");

if (cluster.isPrimary) {
  // El proceso principal administra el cluster.
  startMaster(config);
} else {
  // Cada worker del cluster levanta la API HTTP.
  startServer(config);
}
