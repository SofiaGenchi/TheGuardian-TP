const COLORS = {
  blue: "\x1b[36m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  reset: "\x1b[0m",
  yellow: "\x1b[33m",
};

function colorize(color, message) {
  return `${COLORS[color]}${message}${COLORS.reset}`;
}

function master(message) {
  console.log(colorize("blue", `[MASTER] ${message}`));
}

function worker(message) {
  console.log(colorize("green", `[WORKER ${process.pid}] ${message}`));
}

function warn(message) {
  console.log(colorize("yellow", `[WARN] ${message}`));
}

function error(message, details) {
  console.error(colorize("red", `[ERROR] ${message}`));

  if (details) {
    console.error(details);
  }
}

module.exports = {
  error,
  master,
  warn,
  worker,
};
