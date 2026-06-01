const { MESSAGE_TYPES } = require("../shared/messages");

function createStatsService({ timeoutMs, getLocalCounter }) {
  const pendingRequests = new Map();
  let nextRequestId = 0;

  function createRequestId() {
    nextRequestId += 1;
    return `${process.pid}-stats-${nextRequestId}`;
  }

  function getStatsFromMaster() {
    return new Promise((resolve, reject) => {
      const requestId = createRequestId();

      const timeout = setTimeout(() => {
        pendingRequests.delete(requestId);
        reject(new Error("Timeout consultando stats"));
      }, timeoutMs);

      pendingRequests.set(requestId, { resolve, reject, timeout });
      process.send({ type: MESSAGE_TYPES.STATS_REQUEST, requestId });
    });
  }

  function handleMasterMessage(message) {
    if (!message || message.type !== MESSAGE_TYPES.STATS_RESPONSE) {
      return;
    }

    const pending = pendingRequests.get(message.requestId);

    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    pendingRequests.delete(message.requestId);

    pending.resolve({
      status: "ok",
      pid: process.pid,
      localCounter: getLocalCounter(),
      totalIngested: message.totalIngested,
      workerCount: message.workerCount,
      workerPids: message.workerPids,
    });
  }

  function getStats() {
    if (!process.send) {
      const localCounter = getLocalCounter();

      return Promise.resolve({
        status: "ok",
        pid: process.pid,
        localCounter,
        totalIngested: localCounter,
        workerCount: 1,
        workerPids: [process.pid],
      });
    }

    return getStatsFromMaster();
  }

  return {
    getStats,
    handleMasterMessage,
  };
}

module.exports = { createStatsService };
