import { Response } from "express";

export class ApiError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function ok(res: Response, data: unknown, message = "OK", statusCode = 200) {
  return res.status(statusCode).json({ success: true, message, data });
}

export function paginated(
  res: Response,
  data: unknown[],
  page: number,
  limit: number,
  total: number,
  message = "OK"
) {
  return res.status(200).json({
    success: true,
    message,
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  });
}
