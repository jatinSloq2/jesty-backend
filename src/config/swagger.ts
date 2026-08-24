import swaggerJSDoc from "swagger-jsdoc";
import { env } from "./env";

const options: swaggerJSDoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Jesty API",
      version: "1.0.0",
      description:
        "Jesty - Official WhatsApp Cloud API Inbox. Auth, multi-number WhatsApp integrations, contacts, tags, groups, attributes, conversations, messages, webhook, profile.",
    },
    servers: [
      { url: `http://localhost:${env.PORT}/api`, description: "Local" },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
        serviceToken: {
          type: "apiKey",
          in: "header",
          name: "jesty-backend-service-token",
          description: "Static service-to-service token required on media endpoints (POST /messages/upload, POST /profile/picture), in addition to bearerAuth.",
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: ["./src/routes/*.ts", "./src/models/*.ts"],
};

export const swaggerSpec = swaggerJSDoc(options);
