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
      submitBtn.textContent = "Analyzing & submitting report...";
    }

    try {
      // Invoke the secure Supabase Edge Function:
      // Handles Gemini analysis and server-side database insertion using service-role credentials.
      // Eliminates frontend table permissions issues without exposing private complaint fields.
      const { data: response, error: fnError } = await supabaseClient.functions.invoke("analyze-complaint", {
        body: {
          title: title,
          category: category,
          location: location,
          description: description
        }
      });

      if (fnError) {
        console.error("Submission error:", fnError);
        showMessage(fnError.message || "Failed to submit report. Please try again.", "error");
        return;
      }

      // Check for application-level error returned in response payload
      if (response && response.error) {
        console.error("Server error:", response.error);
        showMessage(response.error, "error");
        return;
      }

      // Extract the created public report representation
      const createdReport = (response && response.data) ? response.data : {
        title: title,
        category: category,
        location: location,
        status: "Pending",
        created_at: new Date().toISOString()
      };

      // If an empty state was visible, remove it
      if (reportsList) {
        const emptyState = reportsList.querySelector(".empty-state");
        if (emptyState) {
          emptyState.remove();
        }

        // Display the newly created complaint at the TOP of the public list
        const newCard = createComplaintCard(createdReport);
        reportsList.prepend(newCard);
      }

      // Reset the form
      reportForm.reset();

      // Show appropriate confirmation message
      if (response && response.ai_status === "unavailable") {
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
