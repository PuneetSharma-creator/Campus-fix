// ==============================================================================
// CampusFix 2.0 - Student Portal & Complaint Management (Vanilla JavaScript)
// ==============================================================================
// Interacts with Supabase Auth, trusted get_my_role RPC, authenticated Edge Function
// (analyze-complaint), and queries personal student complaints with strict user_id isolation.
// ==============================================================================

(function () {
  "use strict";

  // 1. DOM Element References
  const authLoading = document.getElementById("auth-loading");
  const studentAppView = document.getElementById("student-app-view");
  const userDisplayEmail = document.getElementById("user-display-email");
  const studentLogoutBtn = document.getElementById("student-logout-btn");
  const complaintsCountBadge = document.getElementById("complaints-count-badge");

  const reportForm = document.getElementById("report-form");
  const reportsList = document.getElementById("reports-list");
  const formMessage = document.getElementById("form-message");
  const submitBtn = document.getElementById("submit-btn");

  const titleInput = document.getElementById("title");
  const categoryInput = document.getElementById("category");
  const locationInput = document.getElementById("location");
  const descriptionInput = document.getElementById("description");

  // Allowed categories consistent with index.html dropdown & Edge Function
  const ALLOWED_CATEGORIES = [
    "Classroom",
    "Hostel",
    "Cleanliness",
    "Wi-Fi / Internet",
    "Library",
    "Cafeteria",
    "Other",
  ];

  // 2. State & Supabase Client
  let supabaseClient = null;
  let currentSession = null;

  function initializeSupabase() {
    if (supabaseClient) {
      return true;
    }

    if (typeof window.CampusFixAuth === "undefined") {
      console.error("CampusFixAuth module not found. Please ensure auth.js is loaded.");
      return false;
    }

    supabaseClient = window.CampusFixAuth.getClient();
    return !!supabaseClient;
  }

  // 3. Helper Functions: Feedback Messages
  function showMessage(text, type = "error") {
    if (!formMessage) return;
    formMessage.textContent = text;
    formMessage.className = `form-message ${type}`;
    formMessage.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function clearMessage() {
    if (!formMessage) return;
    formMessage.textContent = "";
    formMessage.className = "form-message";
  }

  // 4. Helper Functions: Status & Priority CSS Classes
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

  // Helper to sanitize HTML characters
  function escapeHTML(str) {
    if (!str) return "";
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // 5. Helper Function: Create Personal Complaint Card DOM Element
  // Renders the student's personal report with title, description, category, AI priority, and status
  function createComplaintCard(report) {
    const card = document.createElement("div");
    card.className = "report-card";
    if (report.id) {
      card.id = `report-card-${report.id}`;
    }

    // Format created_at timestamp
    let formattedDate = "Just now";
    if (report.created_at) {
      const d = new Date(report.created_at);
      if (!isNaN(d.getTime())) {
        formattedDate = d.toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        });
      }
    }

    const status = report.status || "Pending";
    const statusClass = getStatusClass(status);

    // AI Priority Badge
    const priorityBadge = report.ai_priority
      ? `<span class="priority-badge ${getPriorityClass(report.ai_priority)}">Priority: ${escapeHTML(report.ai_priority)}</span>`
      : "";

    // AI Insights Box (rendered if ai_category or ai_priority is present)
    let aiBox = "";
    if (report.ai_category || report.ai_explanation) {
      aiBox = `
        <div class="ai-analysis-box">
          <div class="ai-analysis-header">
            <span class="ai-tag">✨ AI Insights</span>
            ${report.ai_category ? `<span class="ai-category-suggested">Suggested: <strong>${escapeHTML(report.ai_category)}</strong></span>` : ""}
          </div>
          ${report.ai_explanation ? `<p class="ai-explanation"><strong>Analysis:</strong> ${escapeHTML(report.ai_explanation)}</p>` : ""}
        </div>
      `;
    }

    card.innerHTML = `
      <div class="report-header">
        <h3 class="report-title">${escapeHTML(report.title || "Untitled Issue")}</h3>
        <div class="badges-container">
          <span class="category-badge">${escapeHTML(report.category || "General")}</span>
          ${priorityBadge}
          <span class="status-badge ${statusClass}">Status: ${escapeHTML(status)}</span>
        </div>
      </div>

      <div class="report-location">
        📍 <strong>Location:</strong> ${escapeHTML(report.location || "Not specified")}
      </div>

      ${report.description ? `<p class="report-description">${escapeHTML(report.description)}</p>` : ""}

      ${aiBox}

      <div class="report-date">Submitted: ${escapeHTML(formattedDate)}</div>
    `;

    return card;
  }

  let isNavigating = false;

  // 6. Check Authentication on Student Page
  async function checkStudentAuth() {
    if (isNavigating) return;

    if (!initializeSupabase()) {
      if (authLoading) {
        authLoading.innerHTML = `
          <p>⚠️ <strong>Configuration Error</strong></p>
          <small>Supabase configuration is missing in <code>config.js</code>.</small>
        `;
      }
      return;
    }

    // Wait for session in case OAuth callback just arrived
    const session = await (window.CampusFixAuth.waitForSession
      ? window.CampusFixAuth.waitForSession()
      : window.CampusFixAuth.getSession());

    if (!session || !session.user) {
      // Unauthenticated -> redirect to login.html with student portal selected
      isNavigating = true;
      window.location.href = window.CampusFixAuth.getRedirectUrl("login.html?portal=student");
      return;
    }

    currentSession = session;

    // Check user's assigned role via trusted public.get_my_role()
    const role = await window.CampusFixAuth.getMyRole();

    // STRICT ROLE ROUTING: index.html is ONLY for students
    if (role === "admin") {
      // Administrator belongs on admin.html (never display student dashboard to admins)
      isNavigating = true;
      window.location.href = window.CampusFixAuth.getRedirectUrl("admin.html");
      return;
    }

    if (role !== "student") {
      isNavigating = true;
      window.location.href = window.CampusFixAuth.getRedirectUrl(
        "login.html?portal=student&error=" + encodeURIComponent("Access Denied: Student account privileges required.")
      );
      return;
    }

    // Display student identity in top bar
    if (userDisplayEmail) {
      const displayName =
        session.user.user_metadata?.full_name ||
        session.user.user_metadata?.name ||
        session.user.email;
      userDisplayEmail.textContent = displayName;
      userDisplayEmail.title = session.user.email;
    }

    // Reveal student interface
    if (authLoading) authLoading.classList.add("hidden");
    if (studentAppView) studentAppView.classList.remove("hidden");

    // Fetch personal complaints
    await fetchMyComplaints();
  }

  // 7. SELECT: Fetch Only Authenticated Student's Complaints
  // Filters strictly by user_id = authenticated student's UUID.
  // Never queries complaints_public and never falls back to showing all complaints.
  async function fetchMyComplaints() {
    if (!reportsList || !currentSession || !currentSession.user) return;

    reportsList.innerHTML = '<p class="loading-state">Loading your submitted complaints...</p>';

    try {
      // Query complaints table filtered exclusively to the signed-in user's UUID
      const { data, error } = await supabaseClient
        .from("complaints")
        .select("id, title, category, location, description, status, created_at, ai_category, ai_priority, ai_explanation")
        .eq("user_id", currentSession.user.id)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("My Complaints query error:", error);
        // Do not fall back to showing all complaints. Display a clear error instead.
        reportsList.innerHTML = `
          <div class="empty-state error-state">
            <p>⚠️ <strong>Could not load your complaints</strong></p>
            <p>${escapeHTML(error.message || "Database request failed.")}</p>
          </div>
        `;
        return;
      }

      reportsList.innerHTML = "";

      const count = data ? data.length : 0;
      if (complaintsCountBadge) {
        complaintsCountBadge.textContent = count;
        complaintsCountBadge.classList.remove("hidden");
      }

      if (!data || data.length === 0) {
        reportsList.innerHTML = `
          <div class="empty-state">
            <p>You have not submitted any complaints yet.</p>
            <small>Fill out the form above to report a facilities or classroom issue.</small>
          </div>
        `;
        return;
      }

      data.forEach(function (complaint) {
        const card = createComplaintCard(complaint);
        reportsList.appendChild(card);
      });

    } catch (err) {
      console.error("Error loading complaints:", err);
      reportsList.innerHTML = `
        <div class="empty-state error-state">
          <p>⚠️ Could not connect to the database to load complaints.</p>
        </div>
      `;
    }
  }

  // 8. INSERT: Handle Complaint Form Submission via Authenticated Edge Function
  if (reportForm) {
    reportForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      clearMessage();

      // Ensure active session
      const session = await window.CampusFixAuth.getSession();
      if (!session || !session.user || !session.access_token) {
        showMessage("Your session has expired. Please sign in again.", "error");
        setTimeout(() => {
          window.location.href = window.CampusFixAuth.getRedirectUrl("login.html?portal=student");
        }, 1500);
        return;
      }
      currentSession = session;

      // Read input values
      const title = titleInput ? titleInput.value.trim() : "";
      const category = categoryInput ? categoryInput.value.trim() : "";
      const location = locationInput ? locationInput.value.trim() : "";
      const description = descriptionInput ? descriptionInput.value.trim() : "";

      // Client-side Validation (consistent with Edge Function constraints)
      if (!title || !category || !location || !description) {
        showMessage("Please fill out all four fields (Title, Category, Location, and Description).", "error");
        return;
      }

      if (title.length > 200) {
        showMessage("Title must not exceed 200 characters.", "error");
        return;
      }

      if (location.length > 200) {
        showMessage("Location must not exceed 200 characters.", "error");
        return;
      }

      if (description.length > 5000) {
        showMessage("Description must not exceed 5000 characters.", "error");
        return;
      }

      if (!ALLOWED_CATEGORIES.includes(category)) {
        showMessage(`Invalid category selected. Must be one of: ${ALLOWED_CATEGORIES.join(", ")}.`, "error");
        return;
      }

      // Ensure client is initialized
      if (!supabaseClient && !initializeSupabase()) {
        showMessage("Supabase client is not ready. Please refresh the page.", "error");
        return;
      }

      // Disable button to prevent duplicate submissions
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Analyzing & submitting report...";
      }

      try {
        // Invoke the authenticated Supabase Edge Function:
        // Pass session Bearer token in Authorization header.
        // The Edge Function sets user_id exclusively from verified user.id and status strictly to Pending.
        const { data: response, error: fnError } = await supabaseClient.functions.invoke("analyze-complaint", {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
          body: {
            title: title,
            category: category,
            location: location,
            description: description,
          },
        });

        if (fnError) {
          console.error("Edge function invocation error:", fnError);
          // Check for unauthorized / expired token
          if (fnError.status === 401 || (fnError.message && fnError.message.includes("401"))) {
            showMessage("Unauthorized: Your session expired. Please sign in again.", "error");
            setTimeout(() => {
              window.location.href = window.CampusFixAuth.getRedirectUrl("login.html?portal=student");
            }, 1500);
            return;
          }
          if (fnError.status === 400) {
            showMessage(fnError.message || "Invalid submission. Please check your inputs.", "error");
            return;
          }
          showMessage(fnError.message || "Failed to submit report. Please try again.", "error");
          return;
        }

        // Check for application-level error returned in response body
        if (response && response.error) {
          console.error("Server-side response error:", response.error);
          showMessage(response.error, "error");
          return;
        }

        // Extract the created public complaint representation
        const createdRecord = response && response.data ? response.data : {
          title: title,
          category: category,
          location: location,
          description: description,
          status: "Pending",
          created_at: new Date().toISOString(),
        };

        // Prepend to personal complaints list
        if (reportsList) {
          const emptyState = reportsList.querySelector(".empty-state");
          if (emptyState) {
            emptyState.remove();
          }

          // Combine with client description for immediate personal display
          const cardData = {
            ...createdRecord,
            description: description,
          };
          const newCard = createComplaintCard(cardData);
          reportsList.prepend(newCard);

          if (complaintsCountBadge) {
            const count = parseInt(complaintsCountBadge.textContent, 10) || 0;
            complaintsCountBadge.textContent = count + 1;
            complaintsCountBadge.classList.remove("hidden");
          }
        }

        // Reset the form
        reportForm.reset();

        // Show appropriate confirmation message
        if (response && response.ai_status === "unavailable") {
          showMessage("Report submitted successfully! (AI priority analysis was temporarily unavailable).", "success");
        } else {
          showMessage("Report submitted and analyzed by AI successfully.", "success");
        }

        // Hide success message after 5 seconds
        setTimeout(function () {
          clearMessage();
        }, 5000);

      } catch (err) {
        console.error("Unexpected submission error:", err);
        showMessage("An unexpected network error occurred while submitting. Please check your connection.", "error");
      } finally {
        // Re-enable the submit button
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "Submit Report";
        }
      }
    });
  }

  // 9. Logout Button Handler
  if (studentLogoutBtn) {
    studentLogoutBtn.addEventListener("click", async function () {
      studentLogoutBtn.disabled = true;
      studentLogoutBtn.textContent = "Logging out...";
      await window.CampusFixAuth.signOut("login.html?portal=student");
    });
  }

  // 10. Listen to Auth State Changes (Handles session expiry / token refresh)
  if (initializeSupabase() && supabaseClient) {
    supabaseClient.auth.onAuthStateChange(function (event, session) {
      // Schedule session state updates and redirects safely outside the callback per Supabase guidance
      setTimeout(function () {
        if (isNavigating) return;
        if (event === "SIGNED_OUT" || !session) {
          isNavigating = true;
          window.location.href = window.CampusFixAuth.getRedirectUrl("login.html?portal=student");
        } else if (session) {
          currentSession = session;
        }
      }, 0);
    });
  }

  // 11. Run Authentication Check on Page Load
  checkStudentAuth();

})();
