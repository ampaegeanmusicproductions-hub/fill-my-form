import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildServerFnError, logServerFnStep, type ServerFnResult } from "@/lib/server-fn-utils.server";

// Get current user's profile (auto-creates is handled by trigger)
export const getMyProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const fn = "getMyProfile";
    let step = "load-profile";
    try {
      const { supabase, userId } = context;
      logServerFnStep(fn, step, { userId });
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return { ok: true, data } satisfies ServerFnResult<typeof data>;
    } catch (error) {
      return buildServerFnError<typeof context extends never ? never : unknown>(fn, error, {
        step,
        defaultMessage: "Δεν ήταν δυνατή η φόρτωση του προφίλ.",
      });
    }
  });

// Consume one quota unit. Order: premium → credits → free trial. Throws QUOTA_EXCEEDED otherwise.
export const consumeQuota = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const fn = "consumeQuota";
    let step = "load-profile";
    try {
      const { supabase, userId } = context;
      logServerFnStep(fn, step, { userId });
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("subscription_status, pay_per_use_credits, total_documents_used")
        .eq("id", userId)
        .single();
      if (error) throw new Error(error.message);

      step = "consume";
      logServerFnStep(fn, step, profile);

      if (profile.subscription_status === "premium") {
        await supabase
          .from("profiles")
          .update({ total_documents_used: profile.total_documents_used + 1 })
          .eq("id", userId);
        return { ok: true, data: { source: "premium" as const } };
      }
      if (profile.pay_per_use_credits > 0) {
        await supabase
          .from("profiles")
          .update({
            pay_per_use_credits: profile.pay_per_use_credits - 1,
            total_documents_used: profile.total_documents_used + 1,
          })
          .eq("id", userId);
        return { ok: true, data: { source: "credit" as const } };
      }
      if (profile.total_documents_used < 1) {
        await supabase
          .from("profiles")
          .update({ total_documents_used: profile.total_documents_used + 1 })
          .eq("id", userId);
        return { ok: true, data: { source: "free" as const } };
      }
      throw new Error("QUOTA_EXCEEDED");
    } catch (error) {
      return buildServerFnError(fn, error, {
        step,
        defaultMessage: "Δεν ήταν δυνατός ο έλεγχος του ορίου χρήσης.",
      });
    }
  });

// MOCK: simulates a successful €1 purchase by adding 1 credit. Replace with Stripe webhook later.
export const mockBuyCredit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const fn = "mockBuyCredit";
    let step = "load-profile";
    try {
      const { supabase, userId } = context;
      logServerFnStep(fn, step, { userId });
      const { data: profile } = await supabase
        .from("profiles")
        .select("pay_per_use_credits")
        .eq("id", userId)
        .single();
      const next = (profile?.pay_per_use_credits ?? 0) + 1;
      step = "update-profile";
      const { error } = await supabase
        .from("profiles")
        .update({ pay_per_use_credits: next })
        .eq("id", userId);
      if (error) throw new Error(error.message);
      return { ok: true, data: { credits: next } };
    } catch (error) {
      return buildServerFnError(fn, error, {
        step,
        defaultMessage: "Δεν ήταν δυνατή η προσθήκη credit.",
      });
    }
  });

// MOCK: simulates a Premium subscription. Replace with Stripe webhook later.
export const mockSubscribe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const fn = "mockSubscribe";
    let step = "update-profile";
    try {
      const { supabase, userId } = context;
      logServerFnStep(fn, step, { userId });
      const { error } = await supabase
        .from("profiles")
        .update({ subscription_status: "premium" })
        .eq("id", userId);
      if (error) throw new Error(error.message);
      return { ok: true, data: { ok: true } };
    } catch (error) {
      return buildServerFnError(fn, error, {
        step,
        defaultMessage: "Δεν ήταν δυνατή η ενεργοποίηση της συνδρομής.",
      });
    }
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
    const fn = "saveDocument";
    let step = "insert-document";
    try {
      const { supabase, userId } = context;
      logServerFnStep(fn, step, { userId, name: data.name });
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
      return { ok: true, data: row };
    } catch (error) {
      return buildServerFnError(fn, error, {
        step,
        defaultMessage: "Δεν ήταν δυνατή η αποθήκευση του εγγράφου.",
      });
    }
  });

const ProfileUpdateSchema = z.object({
  full_name: z.string().trim().max(200).optional().nullable(),
  father_name: z.string().trim().max(200).optional().nullable(),
  mother_name: z.string().trim().max(200).optional().nullable(),
  afm: z.string().trim().max(20).optional().nullable(),
  amka: z.string().trim().max(20).optional().nullable(),
  id_number: z.string().trim().max(30).optional().nullable(),
  address_street: z.string().trim().max(200).optional().nullable(),
  address_number: z.string().trim().max(20).optional().nullable(),
  address_postal: z.string().trim().max(10).optional().nullable(),
  address_city: z.string().trim().max(100).optional().nullable(),
  address_region: z.string().trim().max(100).optional().nullable(),
  phone: z.string().trim().max(30).optional().nullable(),
  birth_date: z.string().trim().max(20).optional().nullable(),
  birth_place: z.string().trim().max(200).optional().nullable(),
});

export const updateMyProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => ProfileUpdateSchema.parse(input))
  .handler(async ({ data, context }) => {
    const fn = "updateMyProfile";
    let step = "prepare-patch";
    try {
      const { supabase, userId } = context;
      const patch: Record<string, string | null> = {};
      for (const [k, v] of Object.entries(data)) {
        patch[k] = v === "" || v == null ? null : (v as string);
      }
      step = "update-profile";
      logServerFnStep(fn, step, { userId, keys: Object.keys(patch) });
      const { error } = await supabase.from("profiles").update(patch as never).eq("id", userId);
      if (error) throw new Error(error.message);
      return { ok: true, data: { ok: true } };
    } catch (error) {
      return buildServerFnError(fn, error, {
        step,
        defaultMessage: "Δεν ήταν δυνατή η αποθήκευση του προφίλ.",
      });
    }
  });

export const listMyDocuments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const fn = "listMyDocuments";
    let step = "list-documents";
    try {
      const { supabase, userId } = context;
      logServerFnStep(fn, step, { userId });
      const { data, error } = await supabase
        .from("documents")
        .select("id, name, created_at, filled_file_path")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);
      return { ok: true, data: data ?? [] };
    } catch (error) {
      return buildServerFnError(fn, error, {
        step,
        defaultMessage: "Δεν ήταν δυνατή η φόρτωση των εγγράφων.",
      });
    }
  });
