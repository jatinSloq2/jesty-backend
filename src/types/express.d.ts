declare global {
  namespace Express {
    interface Request {
      // The authenticated user — populated by middleware/auth.ts after
      // verifying the JWT Jesty itself issued (see services/auth.service.ts).
      // `id` is the user's _id in the Users collection on the second/shared
      // Mongo connection (models/User.ts) — the source of truth.
      // `assignedPhoneNumberIds` is resolved from that user's connected,
      // active WhatsApp Integration documents (models/Integration.ts).
      user?: {
        id: string;
        email: string;
        role: "user" | "admin";
        assignedPhoneNumberIds: string[];
      };
    }
  }
}

export {};
