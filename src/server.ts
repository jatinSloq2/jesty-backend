import http from "http";
import app from "./app";
import { env } from "./config/env";
import { connectDB } from "./config/db";
import { initSocket } from "./services/socket.service";

async function bootstrap() {
  await connectDB();

  const server = http.createServer(app);
  initSocket(server);

  server.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[jesty-backend] running on http://localhost:${env.PORT}`);
    // eslint-disable-next-line no-console
    console.log(`[jesty-backend] Swagger docs -> http://localhost:${env.PORT}/api-docs`);
  });
}

bootstrap();
