import app from "./app";
import { logger } from "./lib/logger";
import { runDbBootstrap } from "./lib/db-bootstrap";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Run idempotent DB migrations before accepting requests.
// Required schema (phase 1) failure is fatal — log and exit so the process
// supervisor restarts with a clear signal rather than silently entering a
// broken state where the app appears alive but can't serve requests safely.
runDbBootstrap()
  .then(() => {
    app.listen(port, (err) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }

      logger.info({ port }, "Server listening");
    });
  })
  .catch((err) => {
    logger.error({ err }, "DB bootstrap failed — refusing to start");
    process.exit(1);
  });
