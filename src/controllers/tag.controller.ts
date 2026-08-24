import { Request, Response } from "express";
import { z } from "zod";
import { catchAsync } from "../utils/catchAsync";
import { ok } from "../utils/apiResponse";
import { ApiError } from "../utils/apiResponse";
import { Tag } from "../models/Tag";
import { Contact } from "../models/Contact";

export const listTags = catchAsync(async (_req: Request, res: Response) => {
  const tags = await Tag.find().sort({ name: 1 });
  return ok(res, tags);
});

const tagSchema = z.object({
  name: z.string().min(1),
  color: z.string().optional(),
});

export const createTag = catchAsync(async (req: Request, res: Response) => {
  const body = tagSchema.parse(req.body);
  const existing = await Tag.findOne({ name: body.name });
  if (existing) throw new ApiError(409, "Tag already exists");
  const tag = await Tag.create({ ...body, createdBy: req.user!.id });
  return ok(res, tag, "Tag created", 201);
});

export const updateTag = catchAsync(async (req: Request, res: Response) => {
  const body = tagSchema.partial().parse(req.body);
  const tag = await Tag.findByIdAndUpdate(req.params.id, { $set: body }, { new: true });
  if (!tag) throw new ApiError(404, "Tag not found");
  return ok(res, tag, "Tag updated");
});

export const deleteTag = catchAsync(async (req: Request, res: Response) => {
  const tag = await Tag.findByIdAndDelete(req.params.id);
  if (!tag) throw new ApiError(404, "Tag not found");
  await Contact.updateMany({ tags: tag._id }, { $pull: { tags: tag._id } });
  return ok(res, null, "Tag deleted");
});
