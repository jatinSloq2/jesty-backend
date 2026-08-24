import { Request, Response } from "express";
import { z } from "zod";
import { catchAsync } from "../utils/catchAsync";
import { ok } from "../utils/apiResponse";
import { ApiError } from "../utils/apiResponse";
import { Attribute } from "../models/Attribute";

export const listAttributes = catchAsync(async (_req: Request, res: Response) => {
  const attributes = await Attribute.find().sort({ label: 1 });
  return ok(res, attributes);
});

const attributeSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(["text", "number", "date", "boolean", "list"]).default("text"),
  options: z.array(z.string()).optional(),
});

export const createAttribute = catchAsync(async (req: Request, res: Response) => {
  const body = attributeSchema.parse(req.body);
  const existing = await Attribute.findOne({ key: body.key.toLowerCase() });
  if (existing) throw new ApiError(409, "Attribute key already exists");
  const attribute = await Attribute.create({ ...body, key: body.key.toLowerCase(), createdBy: req.user!.id });
  return ok(res, attribute, "Attribute created", 201);
});

export const updateAttribute = catchAsync(async (req: Request, res: Response) => {
  const body = attributeSchema.partial().parse(req.body);
  const attribute = await Attribute.findByIdAndUpdate(req.params.id, { $set: body }, { new: true });
  if (!attribute) throw new ApiError(404, "Attribute not found");
  return ok(res, attribute, "Attribute updated");
});

export const deleteAttribute = catchAsync(async (req: Request, res: Response) => {
  const attribute = await Attribute.findByIdAndDelete(req.params.id);
  if (!attribute) throw new ApiError(404, "Attribute not found");
  return ok(res, null, "Attribute deleted");
});
