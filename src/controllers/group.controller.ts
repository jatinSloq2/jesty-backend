import { Request, Response } from "express";
import { z } from "zod";
import { catchAsync } from "../utils/catchAsync";
import { ok } from "../utils/apiResponse";
import { ApiError } from "../utils/apiResponse";
import { Group } from "../models/Group";
import { Contact } from "../models/Contact";

export const listGroups = catchAsync(async (_req: Request, res: Response) => {
  const groups = await Group.find().sort({ name: 1 });
  const withCounts = await Promise.all(
    groups.map(async (g) => ({ ...g.toObject(), contactCount: g.contactIds.length }))
  );
  return ok(res, withCounts);
});

export const getGroup = catchAsync(async (req: Request, res: Response) => {
  const group = await Group.findById(req.params.id).populate("contactIds", "name phoneNumber avatarUrl");
  if (!group) throw new ApiError(404, "Group not found");
  return ok(res, group);
});

const groupSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  contactIds: z.array(z.string()).optional(),
});

export const createGroup = catchAsync(async (req: Request, res: Response) => {
  const body = groupSchema.parse(req.body);
  const existing = await Group.findOne({ name: body.name });
  if (existing) throw new ApiError(409, "Group already exists");
  const group = await Group.create({ ...body, createdBy: req.user!.id });
  return ok(res, group, "Group created", 201);
});

export const updateGroup = catchAsync(async (req: Request, res: Response) => {
  const body = groupSchema.partial().parse(req.body);
  const group = await Group.findByIdAndUpdate(req.params.id, { $set: body }, { new: true });
  if (!group) throw new ApiError(404, "Group not found");
  return ok(res, group, "Group updated");
});

export const deleteGroup = catchAsync(async (req: Request, res: Response) => {
  const group = await Group.findByIdAndDelete(req.params.id);
  if (!group) throw new ApiError(404, "Group not found");
  await Contact.updateMany({ groups: group._id }, { $pull: { groups: group._id } });
  return ok(res, null, "Group deleted");
});

// POST /api/groups/:id/members  { add: string[], remove: string[] }
export const updateMembers = catchAsync(async (req: Request, res: Response) => {
  const { add = [], remove = [] } = z
    .object({ add: z.array(z.string()).optional(), remove: z.array(z.string()).optional() })
    .parse(req.body);

  const group = await Group.findById(req.params.id);
  if (!group) throw new ApiError(404, "Group not found");

  if (add.length) {
    await Group.findByIdAndUpdate(group._id, { $addToSet: { contactIds: { $each: add } } });
    await Contact.updateMany({ _id: { $in: add } }, { $addToSet: { groups: group._id } });
  }
  if (remove.length) {
    await Group.findByIdAndUpdate(group._id, { $pull: { contactIds: { $in: remove } } });
    await Contact.updateMany({ _id: { $in: remove } }, { $pull: { groups: group._id } });
  }

  const updated = await Group.findById(group._id).populate("contactIds", "name phoneNumber avatarUrl");
  return ok(res, updated, "Group members updated");
});
