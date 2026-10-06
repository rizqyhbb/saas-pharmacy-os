import { createApp } from "./app";

const port = Number(process.env.PORT ?? 3101);

createApp().listen(port);
console.log(`apotek-api listening on :${port}`);
