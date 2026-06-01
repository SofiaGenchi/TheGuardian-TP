const { MESSAGE_TYPES } = require("../shared/messages");

function createCrashService({ timeoutMs }) {
  const pendingRequests = new Map();
  let nextRequestId = 0;

  function createRequestId() {
    nextRequestId += 1;
    return `${process.pid}-crash-${nextRequestId}`;
  }

  function requestRandomWorkerCrash() {
    if (!process.send) {
      const targetPid = process.pid;

      setTimeout(() => process.exit(1), 100);
      return Promise.resolve({
        message: "Este worker se va a cerrar para probar self-healing",
        requestedByPid: process.pid,
        targetPid,
      });
    }

    return new Promise((resolve, reject) => {
      const requestId = createRequestId();

      const timeout = setTimeout(() => {
        pendingRequests.delete(requestId);
        reject(new Error("Timeout solicitando crash aleatorio"));
      }, timeoutMs);

      pendingRequests.set(requestId, { resolve, reject, timeout });
      process.send({
        type: MESSAGE_TYPES.CRASH_RANDOM_REQUEST,
        requestId,
        requesterPid: process.pid,
      });
    });
  }

  function handleMasterMessage(message) {
    if (!message || message.type !== MESSAGE_TYPES.CRASH_RANDOM_RESPONSE) {
      return;
    }

    const pending = pendingRequests.get(message.requestId);

    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    pendingRequests.delete(message.requestId);

    pending.resolve({
      message: "El master eligio un worker al azar para probar self-healing",
      requestedByPid: process.pid,
      targetPid: message.targetPid,
      workerPids: message.workerPids,
    });
  }

  return {
    handleMasterMessage,
    requestRandomWorkerCrash,
  };
}

module.exports = { createCrashService };
