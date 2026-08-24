import { Request, Response } from "express";
import { catchAsync } from "../utils/catchAsync";
import { ok, paginated } from "../utils/apiResponse";
import { ApiError } from "../utils/apiResponse";
import { Conversation } from "../models/Conversation";
import { isWithinServiceWindow } from "../services/whatsapp.service";

// GET /api/conversations?search=&status=&phoneNumberId=&page=&limit=
// This is the inbox list (WhatsApp-style chat list). `phoneNumberId` is the
// "channel selector" — pass one of req.user.assignedPhoneNumberIds to scope
// the inbox to a single connected WhatsApp number; omit it to see every
// number's conversations together. No per-agent assignment filtering beyond
// that for now — every user sees every conversation on the WhatsApp numbers
// they have access to (assignedPhoneNumberIds).
export const listConversations = catchAsync(async (req: Request, res: Response) => {
  const page = parseInt((req.query.page as string) || "1", 10);
  const limit = parseInt((req.query.limit as string) || "30", 10);
  const { status, search, phoneNumberId } = req.query as {
    status?: string;
    search?: string;
    phoneNumberId?: string;
  };

  if (phoneNumberId && !req.user!.assignedPhoneNumberIds.includes(phoneNumberId)) {
    throw new ApiError(403, "You don't have access to that WhatsApp number");
  }

  const filter: Record<string, unknown> = {
    phoneNumberId: phoneNumberId ? phoneNumberId : { $in: req.user!.assignedPhoneNumberIds },
  };
  if (status) filter.status = status;

  let query = Conversation.find(filter)
    .populate("contact", "name phoneNumber avatarUrl waId isBlocked")
    .sort({ lastMessageAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit);

  const [items, total] = await Promise.all([query, Conversation.countDocuments(filter)]);

  let results = items;
  if (search) {
    const s = search.toLowerCase();
    results = items.filter((c: any) =>
      c.contact?.name?.toLowerCase().includes(s) || c.contact?.phoneNumber?.includes(s)
    );
  }

  const withWindow = results.map((c) => ({
    ...c.toObject(),
    canSendFreeform: isWithinServiceWindow(c.lastCustomerMessageAt),
  }));

  return paginated(res, withWindow, page, limit, total);
});

// GET /api/conversations/:id
export const getConversation = catchAsync(async (req: Request, res: Response) => {
  const conversation = await Conversation.findById(req.params.id).populate(
    "contact",
    "name phoneNumber avatarUrl waId isBlocked tags"
  );
  if (!conversation) throw new ApiError(404, "Conversation not found");
  return ok(res, {
    ...conversation.toObject(),
    canSendFreeform: isWithinServiceWindow(conversation.lastCustomerMessageAt),
  });
});

// PATCH /api/conversations/:id  { status }
export const updateConversation = catchAsync(async (req: Request, res: Response) => {
  const { status } = req.body as { status?: string };
  const update: Record<string, unknown> = {};
  if (status) update.status = status;

  const conversation = await Conversation.findByIdAndUpdate(req.params.id, { $set: update }, { new: true });
  if (!conversation) throw new ApiError(404, "Conversation not found");
  return ok(res, conversation, "Conversation updated");
});

// POST /api/conversations/:id/read
export const markConversationRead = catchAsync(async (req: Request, res: Response) => {
  const conversation = await Conversation.findByIdAndUpdate(
    req.params.id,
    { $set: { unreadCount: 0 } },
    { new: true }
  );
  if (!conversation) throw new ApiError(404, "Conversation not found");
  return ok(res, conversation);
});
