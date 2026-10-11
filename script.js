// =========================================================
// CampusFix - Supabase Integration (Vanilla JavaScript)
// =========================================================

// 1. Select DOM Elements
const reportForm = document.getElementById("report-form");
const reportsList = document.getElementById("reports-list");
const formMessage = document.getElementById("form-message");
const submitBtn = document.getElementById("submit-btn");

const titleInput = document.getElementById("title");
const categoryInput = document.getElementById("category");
const locationInput = document.getElementById("location");
const descriptionInput = document.getElementById("description");

// 2. Initialize the Supabase Client
// We use the official Supabase JavaScript client loaded via CDN (window.supabase)
let supabaseClient = null;

function initializeSupabase() {
  if (typeof window.supabase === "undefined") {
    showMessage("Supabase client library failed to load. Check your internet connection.", "error");
    return false;
  }

  if (
    !CONFIG ||
    !CONFIG.SUPABASE_URL ||
    !CONFIG.SUPABASE_ANON_KEY ||
    CONFIG.SUPABASE_URL.includes("your-project-id") ||
    CONFIG.SUPABASE_ANON_KEY.includes("your-publishable-anon-key")
  ) {
    console.warn("CampusFix: Please configure your Supabase credentials in config.js");
    return false;
  }

  const { createClient } = window.supabase;
  // Ensure the base URL is clean without any trailing slash or /rest/v1 suffix
  const cleanUrl = CONFIG.SUPABASE_URL.trim().replace(/\/rest\/v1\/?$/i, "").replace(/\/+$/, "");
  const cleanKey = CONFIG.SUPABASE_ANON_KEY.trim();
  supabaseClient = createClient(cleanUrl, cleanKey);
  return true;
}

// 3. Helper Functions: Feedback Messages
function showMessage(text, type) {
  if (!formMessage) return;
  formMessage.textContent = text;
  formMessage.className = `form-message ${type}`;
}

function clearMessage() {
  if (!formMessage) return;
  formMessage.textContent = "";
  formMessage.className = "form-message";
}

// 4. Helper Functions: CSS classes for status and priority
function getStatusClass(status) {
  const s = (status || "Pending").toLowerCase();
  if (s === "resolved") return "status-resolved";
  if (s === "in progress") return "status-in-progress";
  return "status-pending";
}

function getPriorityClass(priority) {
  const p = (priority || "").toLowerCase();
  if (p === "high") return "priority-high";
  if (p === "low") return "priority-low";
  return "priority-medium";
}

// 5. Helper Function: Create a Complaint Card DOM Element (Public View)
// Displays only the fields available in the complaints_public view:
// id, title, category, location, status, created_at, ai_category, ai_priority.
// NOTE: description and ai_explanation are omitted from the public board.
function createComplaintCard(report) {
  const card = document.createElement("div");
  card.className = "report-card";
  if (report.id) {
    card.id = `report-card-${report.id}`;
  }

  // Format created_at timestamp if provided by Supabase
  let formattedDate = "Just now";
  if (report.created_at) {
    const d = new Date(report.created_at);
    if (!isNaN(d.getTime())) {
      formattedDate = d.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short"
      });
    }
  }

  const status = report.status || "Pending";
  const statusClass = getStatusClass(status);

  // AI Priority Badge (rendered only if ai_priority is present)
  const priorityBadge = report.ai_priority
    ? `<span class="priority-badge ${getPriorityClass(report.ai_priority)}">Priority: ${escapeHTML(report.ai_priority)}</span>`
    : "";

  // AI Insights Box (rendered only if ai_category is present; ai_explanation is omitted)
  let aiBox = "";
  if (report.ai_category) {
    aiBox = `
      <div class="ai-analysis-box">
        <div class="ai-analysis-header" style="margin-bottom: 0;">
          <span class="ai-tag">✨ AI Insights</span>
          <span class="ai-category-suggested">Suggested Category: <strong>${escapeHTML(report.ai_category)}</strong></span>
        </div>
      </div>
    `;
  }

  card.innerHTML = `
    <div class="report-header">
      <h3 class="report-title">${escapeHTML(report.title || "")}</h3>
      <div class="badges-container">
        <span class="category-badge">${escapeHTML(report.category || "General")}</span>
        ${priorityBadge}
        <span class="status-badge ${statusClass}">Status: ${escapeHTML(status)}</span>
      </div>
    </div>

    <div class="report-location">
      📍 <strong>Location:</strong> ${escapeHTML(report.location || "Not specified")}
    </div>

    ${aiBox}

    <div class="report-date">Reported: ${escapeHTML(formattedDate)}</div>
  `;

  return card;
}

// 6. SELECT: Fetch existing public complaints from Supabase on page load
async function fetchComplaints() {
  if (!reportsList) return;

  reportsList.innerHTML = '<p class="loading-state">Loading recent reports from database...</p>';

  if (!initializeSupabase()) {
    reportsList.innerHTML = `
      <div class="empty-state">
        <p>⚠️ <strong>Supabase credentials needed</strong></p>
        <p>Open <code>config.js</code> and enter your Supabase Project URL and Anon Key.</p>
      </div>
    `;
    return;
  }

  try {
    // Query the public view "complaints_public" and sort newest first
    const { data, error } = await supabaseClient
      .from("complaints_public")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Supabase SELECT error:", error);
      reportsList.innerHTML = `
        <div class="empty-state error-state">
          <p>Failed to load complaints from database.</p>
          <small>${escapeHTML(error.message)}</small>
        </div>
      `;
      return;
    }

    // Clear loading message
    reportsList.innerHTML = "";

    if (!data || data.length === 0) {
      reportsList.innerHTML = `
        <div class="empty-state">
          <p>No complaints reported yet. Be the first to submit an issue!</p>
        </div>
      `;
      return;
    }

    // Display each complaint in the list
    data.forEach(function (complaint) {
      const card = createComplaintCard(complaint);
      reportsList.appendChild(card);
    });

  } catch (err) {
    console.error("Network or unexpected error:", err);
    reportsList.innerHTML = `
      <div class="empty-state error-state">
        <p>Could not connect to the database. Check your internet connection.</p>
      </div>
    `;
  }
}

// 7. INSERT: Handle Form Submission
if (reportForm) {
  reportForm.addEventListener("submit", async function (event) {
    // Prevent default page reload
    event.preventDefault();
    clearMessage();

    // Read input values
    const title = titleInput ? titleInput.value.trim() : "";
    const category = categoryInput ? categoryInput.value : "";
    const location = locationInput ? locationInput.value.trim() : "";
    const description = descriptionInput ? descriptionInput.value.trim() : "";

    // Validation: ensure all fields are filled
    if (!title || !category || !location || !description) {
      showMessage("Please fill out all fields before submitting.", "error");
      return;
    }

    // Ensure Supabase client is initialized
    if (!supabaseClient && !initializeSupabase()) {
      showMessage("Please configure your Supabase URL and Anon Key in config.js first.", "error");
      return;
    }

    // Disable button to prevent duplicate submissions
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Analyzing complaint with AI...";
    }

    let aiCategory = null;
    let aiPriority = null;
    let aiExplanation = null;
    let aiAnalysisFailed = false;

    // 1. Invoke existing Supabase Edge Function: analyze-complaint
    try {
      const { data: aiData, error: aiError } = await supabaseClient.functions.invoke("analyze-complaint", {
        body: { description: description }
      });

      if (aiError || !aiData) {
        console.warn("AI analysis failed or returned error:", aiError);
        aiAnalysisFailed = true;
      } else {
        let parsedAi = aiData;
        if (typeof parsedAi === "string") {
          try {
            parsedAi = JSON.parse(parsedAi);
          } catch (parseErr) {
            console.warn("Could not parse AI response as JSON:", parseErr);
          }
        }
        aiCategory = parsedAi?.category || null;
        aiPriority = parsedAi?.priority || null;
        aiExplanation = parsedAi?.explanation || null;
      }
    } catch (aiErr) {
      console.warn("AI analysis request exception/timeout:", aiErr);
      aiAnalysisFailed = true;
    }

    if (submitBtn) {
      submitBtn.textContent = "Saving to database...";
    }

    try {
      // 2. Insert new row into "complaints" table preserving user's category and saving AI fields
      const { data, error } = await supabaseClient
        .from("complaints")
        .insert([
          {
            title: title,
            category: category, // Preserves the student's selected category
            location: location,
            description: description,
            status: "Pending", // Default status as requested
            ai_category: aiCategory,
            ai_priority: aiPriority,
            ai_explanation: aiExplanation
          }
        ])
        .select(); // .select() returns the newly created row from the database

      if (error) {
        console.error("Supabase INSERT error:", error);
        showMessage(`Database Error: ${error.message}`, "error");
        return;
      }

      // If an empty state was visible, remove it
      if (reportsList) {
        const emptyState = reportsList.querySelector(".empty-state");
        if (emptyState) {
          emptyState.remove();
        }

        // Display the newly created complaint at the TOP of the list
        // Conforms to public view fields only
        const createdReport = (data && data[0]) ? data[0] : {
          title: title,
          category: category,
          location: location,
          status: "Pending",
          ai_category: aiCategory,
          ai_priority: aiPriority,
          created_at: new Date().toISOString()
        };

        const newCard = createComplaintCard(createdReport);
        reportsList.prepend(newCard);
      }

      // Reset the form
      reportForm.reset();

      // Show appropriate confirmation message
      if (aiAnalysisFailed) {
        showMessage("Report submitted successfully (AI analysis was temporarily unavailable).", "success");
      } else {
        showMessage("Report submitted and analyzed by AI successfully.", "success");
      }

      // Hide success message after 4 seconds
      setTimeout(function () {
        clearMessage();
      }, 4000);

    } catch (err) {
      console.error("Unexpected submission error:", err);
      showMessage("An unexpected network error occurred while submitting.", "error");
    } finally {
      // Re-enable the submit button
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Submit Report";
      }
    }
  });
}

// Helper to sanitize HTML characters
function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// Fetch complaints from Supabase when the page loads (only on student complaint page)
if (reportsList) {
  fetchComplaints();
}
