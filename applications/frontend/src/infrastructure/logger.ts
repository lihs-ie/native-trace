import { type Logger } from "../usecase/port/logger";

export const createStructuredLogger = (nodeEnv: string): Logger => ({
  debug: (message, context) => {
    if (nodeEnv !== "production") {
      console.debug(JSON.stringify({ level: "debug", message, ...context }));
    }
  },
  info: (message, context) => {
    console.info(JSON.stringify({ level: "info", message, ...context }));
  },
  warn: (message, context) => {
    console.warn(JSON.stringify({ level: "warn", message, ...context }));
  },
  error: (message, error, context) => {
    const sanitizedError =
      error instanceof Error
        ? { name: error.name, message: error.message }
        : { message: String(error) };
    console.error(JSON.stringify({ level: "error", message, error: sanitizedError, ...context }));
  },
});
