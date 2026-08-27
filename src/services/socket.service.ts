import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import { env } from "../config/env";
import { resolveUser } from "../middleware/auth";

let io: Server | null = null;

export function initSocket(httpServer: HttpServer) {
  io = new Server(httpServer, {
    cors: { origin: env.FRONTEND_ORIGINS, credentials: true },
  });

  // Same access token issued by the auth service on login — verified the
  // same way as HTTP requests (see middleware/auth.ts -> resolveUser).
  io.use((socket: Socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error("Unauthorized"));
    resolveUser(token)
      .then((user) => {
        (socket as any).userId = user.id;
        next();
      })
      .catch(() => next(new Error("Unauthorized")));
  });

  io.on("connection", (socket: Socket) => {
    const userId = (socket as any).userId as string;
    socket.join(`user:${userId}`);

    socket.on("conversation:join", (conversationId: string) => {
      socket.join(`conversation:${conversationId}`);
    });

    socket.on("conversation:leave", (conversationId: string) => {
      socket.leave(`conversation:${conversationId}`);
    });
  });

  return io;
}

export function getIO(): Server {
  if (!io) throw new Error("Socket.io not initialized yet");
  return io;
}

// Emit helpers used by webhook + message controllers
export function emitNewMessage(conversationId: string, message: unknown) {
  io?.to(`conversation:${conversationId}`).emit("message:new", message);
  io?.emit("inbox:update", { conversationId });
}

export function emitMessageStatus(conversationId: string, status: unknown) {
  io?.to(`conversation:${conversationId}`).emit("message:status", status);
}

export function emitMessageReaction(conversationId: string, payload: unknown) {
  io?.to(`conversation:${conversationId}`).emit("message:reaction", payload);
}