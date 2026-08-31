import "express-async-errors";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import swaggerUi from "swagger-ui-express";
import { env } from "./config/env";
import { swaggerSpec } from "./config/swagger";
import routes from "./routes";
import { notFound, errorHandler } from "./middleware/error";

const app = express();

app.use(helmet());
app.use(
  cors({
    // A function (not the plain string this used to be) so more than one
    // allowed origin works — e.g. your production Vercel domain PLUS a
    // Vercel preview URL, both set via a comma-separated FRONTEND_URL (see
    // FRONTEND_ORIGINS in config/env.ts). Requests with no Origin header at
    // all (server-to-server calls, curl, Postman, and — importantly — the
    // React Native mobile app's normal networking stack) are allowed
    // through since there's no browser cookie/CORS risk in that case.
    //
    // Below that: outside production, allow ANY origin. This only matters
    // in dev/staging, where Expo's tooling (Metro, the tunnel/ngrok relay,
    // the in-app JS debugger) sometimes attaches an Origin header that
    // will never match FRONTEND_ORIGINS (e.g. http://localhost:8081 or a
    // *.exp.direct tunnel URL) — none of that exists in production, and
    // the mobile app authenticates with a Bearer token, not a cookie, so
    // there's nothing for a hostile origin to steal here either way.
    origin: (origin, callback) => {
      if (!origin || env.FRONTEND_ORIGINS.includes(origin) || env.NODE_ENV !== "production") {
        callback(null, true);
      } else {
        callback(new Error(`Origin ${origin} not allowed by CORS`));
      }
    },
    credentials: true,
  })
);
app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));
app.use(cookieParser());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/health", (_req, res) => res.json({ status: "ok", service: "jesty-backend" }));

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use("/api", routes);

app.use(notFound);
app.use(errorHandler);

export default app;