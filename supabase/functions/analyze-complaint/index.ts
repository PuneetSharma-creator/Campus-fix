import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// CORS headers for browser invocations
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Interface for AI analysis result
interface AiAnalysisResult {
  category: string | null;
  priority: string | null;
  explanation: string | null;
}

// Call Gemini API to classify the complaint
async function analyzeComplaintWithGemini(
  description: string,
  apiKey: string
): Promise<AiAnalysisResult> {
  const prompt = `You are an AI assistant for a campus maintenance and facilities management system.
Analyze this student complaint description:
"${description}"

Determine:
1. "category": The single best maintenance category (e.g. "Classroom", "Hostel", "Cleanliness", "Wi-Fi / Internet", "Library", "Cafeteria", "Electrical & Appliances", "Plumbing", "HVAC", "Other").
2. "priority": Urgency level ("Low", "Medium", or "High").
3. "explanation": A concise 1-2 sentence explanation of your classification and urgency reasoning.

Return ONLY a valid JSON object matching this schema:
{
  "category": "string",
  "priority": "Low" | "Medium" | "High",
  "explanation": "string"
}`;

  // Use Gemini 2.5 Flash / 1.5 Flash via Generative Language REST API
  const model = "gemini-3.8-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errText}`);
  }

  const result = await response.json();
  const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("No response text returned by Gemini");
  }

  const parsed = JSON.parse(text);
  return {
    category: parsed?.category || null,
    priority: parsed?.priority || null,
    explanation: parsed?.explanation || null,
  };
}

Deno.serve(async (req: Request) => {
  // 1. Handle CORS preflight request
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

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
    const body = await req.json();
    const { title, category, location, description } = body;

    // Validate required description field
    if (!description || typeof description !== "string" || !description.trim()) {
      return new Response(
        JSON.stringify({ error: "The 'description' field is required." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 2. Perform Gemini AI analysis
    const geminiApiKey =
      Deno.env.get("GEMINI_API_KEY") ||
      Deno.env.get("GOOGLE_API_KEY") ||
      Deno.env.get("GOOGLE_GENAI_API_KEY") ||
      "";

    let aiCategory: string | null = null;
    let aiPriority: string | null = null;
    let aiExplanation: string | null = null;
    let aiAnalysisFailed = false;

    if (geminiApiKey) {
      try {
        const aiResult = await analyzeComplaintWithGemini(description.trim(), geminiApiKey);
        aiCategory = aiResult.category;
        aiPriority = aiResult.priority;
        aiExplanation = aiResult.explanation;
      } catch (geminiErr) {
        console.warn("Gemini analysis encountered an error:", geminiErr);
        aiAnalysisFailed = true;
      }
    } else {
      console.warn("GEMINI_API_KEY not configured in Supabase Edge Function secrets.");
      aiAnalysisFailed = true;
    }

    // 3. Backward Compatibility:
    // If only description was passed without title/category/location,
    // return only the AI analysis object (preserves legacy behavior).
    if (!title && !category && !location) {
      return new Response(
        JSON.stringify({
          category: aiCategory,
          priority: aiPriority,
          explanation: aiExplanation,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 4. Validate complete submission payload
    if (!title || !category || !location) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: title, category, location, and description are all required." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 5. Initialize Supabase Admin client with Service Role Key (server-side only)
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in Edge Function environment.");
      return new Response(
        JSON.stringify({ error: "Server configuration error: missing database credentials." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    // 6. Insert new complaint record into public.complaints
    // Selects and returns ONLY the safe public fields (omits description & ai_explanation)
    const { data: createdRecord, error: insertError } = await supabaseAdmin
      .from("complaints")
      .insert([
        {
          title: title.trim(),
          category: category,
          location: location.trim(),
          description: description.trim(),
          status: "Pending",
          ai_category: aiCategory,
          ai_priority: aiPriority,
          ai_explanation: aiExplanation,
        },
      ])
      .select("id, title, category, location, status, created_at, ai_category, ai_priority")
      .single();

    if (insertError) {
      console.error("Supabase Admin insert error:", insertError);
      return new Response(
        JSON.stringify({ error: `Database error: ${insertError.message}` }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 7. Return the created public complaint representation
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
    console.error("Unhandled error in analyze-complaint function:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
