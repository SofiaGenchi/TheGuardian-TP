function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function sendNotFound(response) {
  sendJson(response, 404, { error: "Ruta no encontrada" });
}

function readUrl(request) {
  return new URL(request.url, `http://${request.headers.host}`);
}

function readIntegerQuery(url, name) {
  const value = Number(url.searchParams.get(name));

  if (!Number.isInteger(value)) {
    return null;
  }

  return value;
}

module.exports = {
  readIntegerQuery,
  readUrl,
  sendJson,
  sendNotFound,
};
