import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Get current user's profile (auto-creates is handled by trigger)
export const getMyProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  });

// Consume one quota unit. Order: premium → credits → free trial. Throws QUOTA_EXCEEDED otherwise.
export const consumeQuota = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("subscription_status, pay_per_use_credits, total_documents_used")
      .eq("id", userId)
      .single();
    if (error) throw new Error(error.message);

    if (profile.subscription_status === "premium") {
      await supabase
        .from("profiles")
        .update({ total_documents_used: profile.total_documents_used + 1 })
        .eq("id", userId);
      return { ok: true as const, source: "premium" as const };
    }
    if (profile.pay_per_use_credits > 0) {
      await supabase
        .from("profiles")
        .update({
          pay_per_use_credits: profile.pay_per_use_credits - 1,
          total_documents_used: profile.total_documents_used + 1,
        })
        .eq("id", userId);
      return { ok: true as const, source: "credit" as const };
    }
    if (profile.total_documents_used < 1) {
      await supabase
        .from("profiles")
        .update({ total_documents_used: profile.total_documents_used + 1 })
        .eq("id", userId);
      return { ok: true as const, source: "free" as const };
    }
    throw new Error("QUOTA_EXCEEDED");
  });

// MOCK: simulates a successful €1 purchase by adding 1 credit. Replace with Stripe webhook later.
export const mockBuyCredit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: profile } = await supabase
      .from("profiles")
      .select("pay_per_use_credits")
      .eq("id", userId)
      .single();
    const next = (profile?.pay_per_use_credits ?? 0) + 1;
    const { error } = await supabase
      .from("profiles")
      .update({ pay_per_use_credits: next })
      .eq("id", userId);
    if (error) throw new Error(error.message);
    return { credits: next };
  });

// MOCK: simulates a Premium subscription. Replace with Stripe webhook later.
export const mockSubscribe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("profiles")
      .update({ subscription_status: "premium" })
      .eq("id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Save a finished document record
const SaveDocumentSchema = z.object({
  name: z.string().min(1).max(200),
  originalFilePath: z.string().min(1).max(500),
  normalizedPdfPath: z.string().min(1).max(500),
  filledFilePath: z.string().min(1).max(500),
  fields: z.array(z.any()),
});

export const saveDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => SaveDocumentSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("documents")
      .insert({
        user_id: userId,
        name: data.name,
        original_file_path: data.originalFilePath,
        normalized_pdf_path: data.normalizedPdfPath,
        filled_file_path: data.filledFilePath,
        fields_json: data.fields,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const listMyDocuments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("documents")
      .select("id, name, created_at, filled_file_path")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  });
