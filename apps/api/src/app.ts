import { Elysia } from "elysia";

/**
 * The app is built separately from `listen()` so tests can drive it through
 * `app.handle(request)` without opening a port.
 */
export const createApp = () =>
  new Elysia().get("/health", () => ({ status: "ok", service: "apotek-api" }));
