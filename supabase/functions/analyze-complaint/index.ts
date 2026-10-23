import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// CORS headers for browser invocations
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Permitted complaint categories consistent with index.html
const ALLOWED_CATEGORIES = [
  "Classroom",
  "Hostel",
  "Cleanliness",
  "Wi-Fi / Internet",
  "Library",
  "Cafeteria",
  "Other",
] as const;

type AllowedCategory = typeof ALLOWED_CATEGORIES[number];

// Permitted AI priority values
const VALID_AI_PRIORITIES = ["Low", "Medium", "High"] as const;
type AiPriority = typeof VALID_AI_PRIORITIES[number];

// Interface for strictly validated AI analysis result
interface AiAnalysisResult {
  category: AllowedCategory;
  priority: AiPriority;
  explanation: string;
}

// Safely validate and normalize priority to Low, Medium, or High
function parseAiPriority(val: unknown): AiPriority | null {
  if (typeof val !== "string") return null;
  const trimmed = val.trim();
  const matched = VALID_AI_PRIORITIES.find(
    (p) => p.toLowerCase() === trimmed.toLowerCase()
  );
  return matched ?? null;
}

// Case-insensitive lookup matching allowed category values from index.html (including option label aliases)
function matchAllowedCategory(val: string): AllowedCategory | null {
  const trimmed = val.trim().toLowerCase();
  const directMatch = ALLOWED_CATEGORIES.find(
    (c) => c.toLowerCase() === trimmed
  );
  if (directMatch) return directMatch;

  // Handle label aliases from index.html options
  if (trimmed === "classroom & labs" || trimmed === "classroom and labs" || trimmed === "labs") {
    return "Classroom";
  }
  if (trimmed === "hostel & accommodation" || trimmed === "hostel and accommodation" || trimmed === "accommodation") {
    return "Hostel";
  }
  if (trimmed === "cleanliness & sanitation" || trimmed === "cleanliness and sanitation" || trimmed === "sanitation") {
    return "Cleanliness";
  }
  if (
    trimmed === "wi-fi & network" ||
    trimmed === "wi-fi and network" ||
    trimmed === "wifi" ||
    trimmed === "network" ||
    trimmed === "wi-fi" ||
    trimmed === "wifi / internet"
  ) {
    return "Wi-Fi / Internet";
  }
  if (trimmed === "cafeteria / canteen" || trimmed === "cafeteria and canteen" || trimmed === "canteen") {
    return "Cafeteria";
  }
  if (trimmed === "other issues") {
    return "Other";
  }

  return null;
}

// Model fallback cascade: primary model followed by fallback models
const GEMINI_MODELS = [
  "gemini-3.5-flash-lite", // Primary: fast and lightweight
  "gemini-3.6-flash",      // Fallback 1: if primary fails with 429/500/502/503/timeout
  "gemini-3.8-flash",      // Fallback 2: final fallback model
];

// Timeout per model attempt to prevent hanging requests (6 seconds)
const MODEL_REQUEST_TIMEOUT_MS = 6000;

// Execute an individual Gemini model request with strict timeout and safe error logging
async function callGeminiModel(
  model: string,
  prompt: string,
  apiKey: string
): Promise<AiAnalysisResult | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), MODEL_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      // Log model name and HTTP status code without exposing API key or URL
      console.warn(`[AI Analysis] Model '${model}' failed with HTTP status ${response.status}`);
      return null;
    }

    const result = await response.json();
    const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text || typeof text !== "string" || !text.trim()) {
      console.warn(`[AI Analysis] Model '${model}' returned an empty response`);
      return null;
    }

    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(text);
    } catch (_err) {
      // Attempt recovery if markdown code block or embedded JSON
      const clean = text.replace(/```(?:json)?\s*|```/gi, "").trim();
      try {
        parsed = JSON.parse(clean);
      } catch (_err2) {
        const startIdx = text.indexOf("{");
        const endIdx = text.lastIndexOf("}");
        if (startIdx !== -1 && endIdx > startIdx) {
          try {
            parsed = JSON.parse(text.substring(startIdx, endIdx + 1));
          } catch (_err3) {
            console.warn(`[AI Analysis] Model '${model}' returned unparseable JSON text`);
            return null;
          }
        } else {
          console.warn(`[AI Analysis] Model '${model}' returned malformed JSON text`);
          return null;
        }
      }
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      console.warn(`[AI Analysis] Model '${model}' response was not a JSON object`);
      return null;
    }

    const rawCategory = typeof parsed.category === "string" ? parsed.category.trim() : "";
    const matchedCategory = rawCategory ? matchAllowedCategory(rawCategory) : null;
    const matchedPriority = parseAiPriority(parsed.priority);
    const explanation = typeof parsed.explanation === "string" ? parsed.explanation.trim() : "";

    // Validate ALL fields: if any field is missing or invalid, reject this model's output so fallback cascade can try next model
    if (!matchedCategory || !matchedPriority || !explanation) {
      console.warn(
        `[AI Analysis] Model '${model}' returned incomplete or invalid output (category: "${rawCategory}" -> ${matchedCategory}, priority: "${parsed.priority}" -> ${matchedPriority}, explanation: ${explanation ? "present" : "missing"}). Trying next fallback model.`
      );
      return null;
    }

    return {
      category: matchedCategory,
      priority: matchedPriority,
      explanation,
    };
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      console.warn(`[AI Analysis] Model '${model}' request timed out after ${MODEL_REQUEST_TIMEOUT_MS}ms`);
    } else {
      console.warn(
        `[AI Analysis] Model '${model}' request failed:`,
        err instanceof Error ? err.message : "Network/execution error"
      );
    }
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Call Gemini API with automatic fallback cascade
async function analyzeComplaintWithGemini(
  description: string,
  apiKey: string
): Promise<AiAnalysisResult> {
  const prompt = `You are an AI assistant for a campus maintenance and facilities management system.
Analyze this student complaint description:
"${description}"

Determine:
1. "category": The single best maintenance category from this EXACT list: "Classroom", "Hostel", "Cleanliness", "Wi-Fi / Internet", "Library", "Cafeteria", "Other".
2. "priority": Urgency level ("Low", "Medium", or "High").
3. "explanation": A concise 1-2 sentence explanation of your classification and urgency reasoning.

Return ONLY a valid JSON object matching this schema:
{
  "category": "Classroom" | "Hostel" | "Cleanliness" | "Wi-Fi / Internet" | "Library" | "Cafeteria" | "Other",
  "priority": "Low" | "Medium" | "High",
  "explanation": "string"
}`;

  for (const model of GEMINI_MODELS) {
    const result = await callGeminiModel(model, prompt, apiKey);
    if (result) {
      return result;
    }
  }

  throw new Error("All configured Gemini models failed or returned invalid/incomplete output.");
}

/**
 * Resolves the Supabase Secret Key for admin database operations.
 *
 * Implements Supabase's new API key architecture and preserves backward compatibility:
 * 1. SUPABASE_SECRET_KEYS: JSON dictionary (e.g. {"default": "sb_secret_..."}),
 *    JSON array, or raw secret string injected by modern Supabase runtimes.
 * 2. SUPABASE_SECRET_KEY: Single secret key string (sb_secret_...).
 * 3. SUPABASE_SERVICE_ROLE_KEY: Legacy JWT service_role key for backward compatibility.
 *
 * Security: NEVER logs secret key values to console or error payloads.
 */
function resolveSupabaseSecretKey(): string | null {
  // 1. Check SUPABASE_SECRET_KEYS (new format introduced for Secret API Keys)
  const rawSecretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (rawSecretKeys && rawSecretKeys.trim()) {
    const trimmed = rawSecretKeys.trim();
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object") {
        if (Array.isArray(parsed)) {
          const first = parsed.find((k) => typeof k === "string" && k.trim());
          if (first && typeof first === "string") return first.trim();
        } else {
          const dict = parsed as Record<string, unknown>;
          // Prefer 'default' named key if present
          if (typeof dict.default === "string" && dict.default.trim()) {
            return dict.default.trim();
          }
          // Otherwise pick the first non-empty string value
          for (const val of Object.values(dict)) {
            if (typeof val === "string" && val.trim()) {
              return val.trim();
            }
          }
        }
      }
    } catch {
      // If not valid JSON, treat as raw secret string
      return trimmed;
    }
  }

  // 2. Check SUPABASE_SECRET_KEY (singular new format)
  const singularSecretKey = Deno.env.get("SUPABASE_SECRET_KEY");
  if (singularSecretKey && singularSecretKey.trim()) {
    return singularSecretKey.trim();
  }

  // 3. Fallback to SUPABASE_SERVICE_ROLE_KEY (legacy JWT format for backward compatibility)
  const legacyServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacyServiceRoleKey && legacyServiceRoleKey.trim()) {
    return legacyServiceRoleKey.trim();
  }

  return null;
}

Deno.serve(async (req: Request) => {
  // 1. Handle CORS preflight request
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // 2. Validate HTTP method
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed. Use POST." }),
      {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  try {
    // 3. Initialize server-side Supabase Admin client with Secret Key
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseSecretKey = resolveSupabaseSecretKey();

    if (!supabaseUrl || !supabaseSecretKey) {
      console.error(
        "Server configuration error: missing SUPABASE_URL or valid secret key (checked SUPABASE_SECRET_KEYS, SUPABASE_SECRET_KEY, and SUPABASE_SERVICE_ROLE_KEY)."
      );
      return new Response(
        JSON.stringify({ error: "Server configuration error: missing database credentials." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseSecretKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    // 4. Extract and validate incoming Authorization Bearer token
    const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
    if (!authHeader || !/^Bearer\s+/i.test(authHeader)) {
      return new Response(
        JSON.stringify({
          error: "Unauthorized: Missing or invalid Authorization header. A valid user session Bearer token is required.",
        }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: Empty Bearer token." }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Validate the token against Supabase Auth (server-side verification)
    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user || !user.id) {
      console.warn("[Auth] Token validation rejected:", authError ? authError.message : "User not found");
      return new Response(
        JSON.stringify({ error: "Unauthorized: Invalid or expired session token." }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 5. Parse and validate request body structure
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch (_parseErr) {
      return new Response(
        JSON.stringify({ error: "Invalid JSON in request body." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return new Response(
        JSON.stringify({ error: "Request body must be a JSON object." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 6. Validate inputs upfront before calling Gemini
    // Enforce string type, non-whitespace text, max lengths, and permitted categories.
    // Client-supplied user_id, status, role, or priority are ignored completely.

    // Validate Title: required non-empty string, max 200 characters
    if (typeof body.title !== "string" || !body.title.trim()) {
      return new Response(
        JSON.stringify({ error: "The 'title' field is required and must contain non-whitespace text." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    const title = body.title.trim();
    if (title.length > 200) {
      return new Response(
        JSON.stringify({ error: "The 'title' field must not exceed 200 characters." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Validate Category: required non-empty string, must match allowed options in index.html
    if (typeof body.category !== "string" || !body.category.trim()) {
      return new Response(
        JSON.stringify({ error: "The 'category' field is required and must contain non-whitespace text." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    const matchedCategory = matchAllowedCategory(body.category.trim());
    if (!matchedCategory) {
      return new Response(
        JSON.stringify({
          error: `Invalid category '${body.category.trim()}'. Permitted categories are: ${ALLOWED_CATEGORIES.join(", ")}.`,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    const category = matchedCategory;

    // Validate Location: required non-empty string, max 200 characters
    if (typeof body.location !== "string" || !body.location.trim()) {
      return new Response(
        JSON.stringify({ error: "The 'location' field is required and must contain non-whitespace text." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    const location = body.location.trim();
    if (location.length > 200) {
      return new Response(
        JSON.stringify({ error: "The 'location' field must not exceed 200 characters." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Validate Description: required non-empty string, max 5000 characters
    if (typeof body.description !== "string" || !body.description.trim()) {
      return new Response(
        JSON.stringify({ error: "The 'description' field is required and must contain non-whitespace text." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    const description = body.description.trim();
    if (description.length > 5000) {
      return new Response(
        JSON.stringify({ error: "The 'description' field must not exceed 5000 characters." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 7. Perform Gemini AI analysis with multi-model fallback
    const geminiApiKey =
      Deno.env.get("GEMINI_API_KEY") ||
      Deno.env.get("GOOGLE_API_KEY") ||
      Deno.env.get("GOOGLE_GENAI_API_KEY") ||
      "";

    let aiCategory: AllowedCategory | null = null;
    let aiPriority: "Low" | "Medium" | "High" | null = null;
    let aiExplanation: string | null = null;
    let aiAnalysisFailed = false;

    if (geminiApiKey) {
      try {
        const aiResult = await analyzeComplaintWithGemini(description, geminiApiKey);
        aiCategory = aiResult.category;
        aiPriority = aiResult.priority;
        aiExplanation = aiResult.explanation;
      } catch (geminiErr) {
        console.warn(
          "[AI Analysis] All fallback models failed or returned invalid output:",
          geminiErr instanceof Error ? geminiErr.message : "AI analysis error"
        );
        aiAnalysisFailed = true;
      }
    } else {
      console.warn("GEMINI_API_KEY not configured in Supabase Edge Function secrets.");
      aiAnalysisFailed = true;
    }

    // Set AI analysis to success only when category, priority, and explanation are all valid.
    // If every model fails or returns invalid output, clear AI fields and set ai_status: "unavailable".
    if (aiAnalysisFailed || !aiCategory || !aiPriority || !aiExplanation) {
      aiAnalysisFailed = true;
      aiCategory = null;
      aiPriority = null;
      aiExplanation = null;
    }

    // 8. Insert new complaint record into public.complaints
    // - user_id is set exclusively from the verified user session (user.id)
    // - status is strictly hardcoded to "Pending"
    // - Priority is determined by AI (not user-selectable)
    // - Selects and returns ONLY safe public fields needed by student UI
    const { data: createdRecord, error: insertError } = await supabaseAdmin
      .from("complaints")
      .insert([
        {
          user_id: user.id,
          title: title,
          category: category,
          location: location,
          description: description,
          status: "Pending",
          ai_category: aiCategory,
          ai_priority: aiPriority,
          ai_explanation: aiExplanation,
        },
      ])
      .select("id, title, category, location, status, created_at, ai_category, ai_priority")
      .single();

    if (insertError) {
      console.error("[Database] Insert error:", insertError.message);
      return new Response(
        JSON.stringify({ error: `Database error: ${insertError.message}` }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 9. Return the created safe complaint representation
    return new Response(
      JSON.stringify({
        success: true,
        data: createdRecord,
        ai_status: aiAnalysisFailed ? "unavailable" : "success",
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error(
      "Unhandled error in analyze-complaint function:",
      err instanceof Error ? err.message : "Unknown error"
    );
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
