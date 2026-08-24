import { Request, Response } from "express";
import { z } from "zod";
import { catchAsync } from "../utils/catchAsync";
import { ok, paginated } from "../utils/apiResponse";
import { ApiError } from "../utils/apiResponse";
import { Contact } from "../models/Contact";

// GET /api/contacts?search=&tag=&group=&page=&limit=
export const listContacts = catchAsync(async (req: Request, res: Response) => {
  const page = parseInt((req.query.page as string) || "1", 10);
  const limit = parseInt((req.query.limit as string) || "20", 10);
  const { search, tag, group } = req.query as { search?: string; tag?: string; group?: string };

  const filter: Record<string, unknown> = {};
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: "i" } },
      { phoneNumber: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
      { waId: { $regex: search, $options: "i" } },
    ];
  }
  if (tag) filter.tags = tag;
  if (group) filter.groups = group;

  const [items, total] = await Promise.all([
    Contact.find(filter)
      .populate("tags", "name color")
      .populate("groups", "name")
      .sort({ updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Contact.countDocuments(filter),
  ]);

  return paginated(res, items, page, limit, total);
});

// GET /api/contacts/:id
export const getContact = catchAsync(async (req: Request, res: Response) => {
  const contact = await Contact.findById(req.params.id).populate("tags", "name color").populate("groups", "name");
  if (!contact) throw new ApiError(404, "Contact not found");
  return ok(res, contact);
});

const upsertSchema = z.object({
  waId: z.string().min(5),
  name: z.string().min(1),
  phoneNumber: z.string().min(5),
  email: z.string().email().optional(),
  avatarUrl: z.string().url().optional(),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
  groups: z.array(z.string()).optional(),
  attributes: z.record(z.string()).optional(),
});

// POST /api/contacts
export const createContact = catchAsync(async (req: Request, res: Response) => {
  const body = upsertSchema.parse(req.body);
  const existing = await Contact.findOne({ waId: body.waId });
  if (existing) throw new ApiError(409, "Contact with this WhatsApp ID already exists");
  const contact = await Contact.create(body);
  return ok(res, contact, "Contact created", 201);
});

// PATCH /api/contacts/:id
export const updateContact = catchAsync(async (req: Request, res: Response) => {
  const body = upsertSchema.partial().parse(req.body);
  const contact = await Contact.findByIdAndUpdate(req.params.id, { $set: body }, { new: true });
  if (!contact) throw new ApiError(404, "Contact not found");
  return ok(res, contact, "Contact updated");
});

// DELETE /api/contacts/:id
export const deleteContact = catchAsync(async (req: Request, res: Response) => {
  const contact = await Contact.findByIdAndDelete(req.params.id);
  if (!contact) throw new ApiError(404, "Contact not found");
  return ok(res, null, "Contact deleted");
});

// POST /api/contacts/:id/block  { block: boolean }
export const setBlocked = catchAsync(async (req: Request, res: Response) => {
  const { block } = z.object({ block: z.boolean() }).parse(req.body);
  const contact = await Contact.findByIdAndUpdate(req.params.id, { $set: { isBlocked: block } }, { new: true });
  if (!contact) throw new ApiError(404, "Contact not found");
  return ok(res, contact, block ? "Contact blocked" : "Contact unblocked");
});
