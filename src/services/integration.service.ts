import { Integration } from "../models/Integration";
import { env } from "../config/env";
import { ApiError } from "../utils/apiResponse";

// ---------------------------------------------------------------------------
// Everything WhatsApp-integration-related reads from the Integration
// collection on the second (shared) Mongo connection — see models/Integration.ts.
// A single Jesty login (User) can own several `channel: "whatsapp"`
// Integration documents, i.e. several connected WhatsApp numbers.
// ---------------------------------------------------------------------------

// The list of phone_number_ids the given user is allowed to see/act on —
// every active WhatsApp Integration document they own. Used by requireAuth
// to populate req.user.assignedPhoneNumberIds.
export async function getAssignedPhoneNumberIds(userId: string): Promise<string[]> {
  const rows = await Integration.find({ user: userId, channel: "whatsapp", isActive: true }).select(
    "whatsapp.phoneNumberId"
  );
  return rows.map((r) => r.whatsapp?.phoneNumberId).filter((id): id is string => !!id);
}

export interface ResolvedWhatsappCredentials {
  accessToken: string;
  phoneNumberId: string;
  wabaId?: string;
  appId?: string;
}

// Every outbound Meta API call (send message, upload media, business profile)
// is scoped to a specific phone_number_id — this resolves which connected
// number's credentials to use. Falls back to the single-tenant env vars so
// the app still works before any Integration has been connected.
export async function getWhatsappCredentialsByPhoneNumberId(
  phoneNumberId: string
): Promise<ResolvedWhatsappCredentials> {
  const integration = await Integration.findOne({
    channel: "whatsapp",
    isActive: true,
    "whatsapp.phoneNumberId": phoneNumberId,
  });

  if (integration?.whatsapp?.accessToken) {
    return {
      accessToken: integration.whatsapp.accessToken,
      phoneNumberId,
      wabaId: integration.whatsapp.wabaId,
      appId: integration.whatsapp.appId,
    };
  }

  if (env.WHATSAPP_ACCESS_TOKEN && phoneNumberId === env.WHATSAPP_PHONE_NUMBER_ID) {
    return {
      accessToken: env.WHATSAPP_ACCESS_TOKEN,
      phoneNumberId,
      wabaId: env.WHATSAPP_BUSINESS_ACCOUNT_ID,
    };
  }

  throw new ApiError(404, `No connected WhatsApp number found for phone number id "${phoneNumberId}"`);
}

// Used by profile.controller.ts when no phoneNumberId is given on the
// request — falls back to the caller's default (or only) connected number.
export async function getDefaultWhatsappCredentials(userId: string): Promise<ResolvedWhatsappCredentials> {
  const integration =
    (await Integration.findOne({ user: userId, channel: "whatsapp", isActive: true, isDefault: true })) ||
    (await Integration.findOne({ user: userId, channel: "whatsapp", isActive: true }));

  if (integration?.whatsapp?.accessToken && integration.whatsapp.phoneNumberId) {
    return {
      accessToken: integration.whatsapp.accessToken,
      phoneNumberId: integration.whatsapp.phoneNumberId,
      wabaId: integration.whatsapp.wabaId,
      appId: integration.whatsapp.appId,
    };
  }

  if (env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID) {
    return {
      accessToken: env.WHATSAPP_ACCESS_TOKEN,
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
      wabaId: env.WHATSAPP_BUSINESS_ACCOUNT_ID,
    };
  }

  throw new ApiError(
    404,
    "No connected WhatsApp number found. Connect one via POST /api/integrations/whatsapp, or pass phoneNumberId explicitly."
  );
}
