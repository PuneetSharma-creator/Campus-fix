// ==============================================================================
// CampusFix 2.0 - Central Authentication & Session Management Module
// ==============================================================================
// Reusable, secure frontend authentication helper using official Supabase JS SDK.
// Provides session verification, trusted database role inspection (get_my_role),
// email/password signup & sign-in, Google OAuth, password reset, and dynamic redirect URLs.
// ==============================================================================

(function () {
  "use strict";

  let clientInstance = null;

  /**
   * Initializes and returns the shared singleton Supabase client instance.
   * Ensures no duplicate client instances are created across pages.
   */
  function getClient() {
    if (clientInstance) {
      return clientInstance;
    }

    if (typeof window.supabase === "undefined") {
      console.error("CampusFixAuth: Supabase JavaScript library (@supabase/supabase-js) is not loaded.");
      return null;
    }

    if (
      typeof CONFIG === "undefined" ||
      !CONFIG.SUPABASE_URL ||
      !CONFIG.SUPABASE_ANON_KEY ||
      CONFIG.SUPABASE_URL.includes("your-project-id") ||
      CONFIG.SUPABASE_ANON_KEY.includes("your-publishable-anon-key")
    ) {
      console.warn("CampusFixAuth: Supabase credentials are missing or unconfigured in config.js.");
      return null;
    }

    const cleanUrl = CONFIG.SUPABASE_URL.trim().replace(/\/rest\/v1\/?$/i, "").replace(/\/+$/, "");
    const cleanKey = CONFIG.SUPABASE_ANON_KEY.trim();

    clientInstance = window.supabase.createClient(cleanUrl, cleanKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });

    return clientInstance;
  }

  /**
   * Generates dynamic absolute redirect URLs based on current host & path.
   * Works consistently on localhost (custom ports) and deployed paths (e.g. GitHub Pages).
   */
  function getRedirectUrl(targetPage = "login.html") {
    const origin = window.location.origin;
    const pathname = window.location.pathname.replace(/[^/]*$/, "");
    return `${origin}${pathname}${targetPage}`;
  }

  /**
   * Retrieves the preserved portal selection ('student' or 'admin').
   * Checks URL query params first, then falls back to sessionStorage and localStorage.
   */
  function getSelectedPortal() {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const param = (urlParams.get("portal") || "").toLowerCase();
      if (param === "admin" || param === "student") {
        return param;
      }
      const stored = (
        sessionStorage.getItem("campusfix_selected_portal") ||
        localStorage.getItem("campusfix_selected_portal") ||
        ""
      ).toLowerCase();
      if (stored === "admin" || stored === "student") {
        return stored;
      }
    } catch (err) {
      console.warn("CampusFixAuth: Error reading portal selection:", err);
    }
    return "student";
  }

  /**
   * Persists the user's selected portal in both sessionStorage and localStorage.
   */
  function setSelectedPortal(portal) {
    const p = (portal || "student").toLowerCase();
    try {
      sessionStorage.setItem("campusfix_selected_portal", p);
      localStorage.setItem("campusfix_selected_portal", p);
    } catch (err) {
      console.warn("CampusFixAuth: Error saving portal selection:", err);
    }
  }

  /**
   * Clears the stored portal selection.
   */
  function clearSelectedPortal() {
    try {
      sessionStorage.removeItem("campusfix_selected_portal");
      localStorage.removeItem("campusfix_selected_portal");
    } catch (err) {
      console.warn("CampusFixAuth: Error clearing portal selection:", err);
    }
  }

  /**
   * Retrieves the current authenticated session, if one exists in storage.
   */
  async function getSession() {
    const client = getClient();
    if (!client) return null;
    try {
      const { data: { session }, error } = await client.auth.getSession();
      if (error) {
        console.warn("CampusFixAuth: Session retrieval error:", error.message);
        return null;
      }
      return session;
    } catch (err) {
      console.error("CampusFixAuth: Unexpected error getting session:", err);
      return null;
    }
  }

  /**
   * Waits for the Supabase session to be restored.
   * If an OAuth callback has just occurred (URL hash contains access_token or query contains code),
   * this waits for Supabase's asynchronous token exchange without hanging or blocking inside callbacks.
   */
  async function waitForSession(timeoutMs = 6000) {
    const client = getClient();
    if (!client) return null;

    // Check immediate session
    const immediate = await getSession();
    if (immediate && immediate.user) {
      return immediate;
    }

    // Check if OAuth callback params exist in URL
    const hasAuthParams =
      window.location.hash.includes("access_token") ||
      window.location.search.includes("code=") ||
      window.location.hash.includes("error");

    if (!hasAuthParams) {
      return null;
    }

    // Wait for onAuthStateChange to deliver the restored session safely outside the callback
    return new Promise((resolve) => {
      let resolved = false;
      let subscription = null;

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          if (subscription && typeof subscription.unsubscribe === "function") {
            try { subscription.unsubscribe(); } catch (_) {}
          }
          setTimeout(() => {
            getSession().then((fallback) => resolve(fallback)).catch(() => resolve(null));
          }, 0);
        }
      }, timeoutMs);

      const subResult = client.auth.onAuthStateChange((event, session) => {
        if (!resolved && session && session.user) {
          resolved = true;
          clearTimeout(timer);
          // Safely defer resolution and unsubscribe outside the callback execution stack
          // following current Supabase guidance to avoid SDK lock contention
          setTimeout(() => {
            const sub = subscription || (subResult && subResult.data && subResult.data.subscription);
            if (sub && typeof sub.unsubscribe === "function") {
              try { sub.unsubscribe(); } catch (_) {}
            }
            resolve(session);
          }, 0);
        }
      });

      subscription = (subResult && subResult.data && subResult.data.subscription) || null;
    });
  }

  /**
   * Retrieves the trusted role of the current user from the server-side RPC get_my_role().
   * Returns 'admin' or 'student' ONLY when that exact role is returned by the trusted RPC.
   * Returns null for missing, unexpected, or failed role results. Never silently defaults to 'student'.
   */
  async function getMyRole() {
    const client = getClient();
    if (!client) return null;

    // Verify session exists before calling RPC
    const session = await getSession();
    if (!session || !session.user) {
      return null;
    }

    try {
      const { data, error } = await client.rpc("get_my_role");
      if (error) {
        console.warn("CampusFixAuth: public.get_my_role() RPC error:", error.message);
        return null;
      }

      if (data === "admin" || data === "student") {
        return data;
      }

      console.warn("CampusFixAuth: get_my_role returned unexpected or non-role value:", data);
      return null;
    } catch (err) {
      console.error("CampusFixAuth: Failed to invoke get_my_role:", err);
      return null;
    }
  }

  /**
   * Signs in with email and password using Supabase Auth.
   */
  async function signInWithPassword(email, password) {
    const client = getClient();
    if (!client) throw new Error("Supabase client is not initialized. Check config.js.");
    return await client.auth.signInWithPassword({
      email: email.trim(),
      password: password,
    });
  }

  /**
   * Registers a new student account using Supabase Auth.
   * Attaches student metadata (full_name, student_id) handled by the Stage 1 database trigger.
   */
  async function signUp(email, password, metadata = {}) {
    const client = getClient();
    if (!client) throw new Error("Supabase client is not initialized. Check config.js.");
    return await client.auth.signUp({
      email: email.trim(),
      password: password,
      options: {
        data: metadata,
        emailRedirectTo: getRedirectUrl("login.html"),
      },
    });
  }

  /**
   * Initiates Google OAuth authentication via Supabase.
   * Preserves selected portal in storage and redirects back to login.html to verify role and perform trusted routing.
   */
  async function signInWithGoogle(portal = "student") {
    const client = getClient();
    if (!client) throw new Error("Supabase client is not initialized. Check config.js.");

    // Preserve the chosen portal in storage across Google OAuth redirects
    setSelectedPortal(portal);

    const redirectTo = getRedirectUrl(`login.html?portal=${encodeURIComponent(portal)}`);
    return await client.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: redirectTo,
        queryParams: {
          access_type: "offline",
          prompt: "consent",
        },
      },
    });
  }

  /**
   * Sends a password reset email via Supabase Auth.
   */
  async function resetPassword(email) {
    const client = getClient();
    if (!client) throw new Error("Supabase client is not initialized. Check config.js.");
    const redirectTo = getRedirectUrl("login.html");
    return await client.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: redirectTo,
    });
  }

  /**
   * Signs out current user and redirects to the specified page (defaults to login.html).
   */
  async function signOut(targetPage = "login.html") {
    const client = getClient();
    if (client) {
      try {
        await client.auth.signOut();
      } catch (err) {
        console.warn("CampusFixAuth: Sign out error:", err);
      }
    }
    clearSelectedPortal();
    window.location.href = getRedirectUrl(targetPage);
  }

  // Expose CampusFixAuth to global window scope
  window.CampusFixAuth = {
    getClient,
    getRedirectUrl,
    getSelectedPortal,
    setSelectedPortal,
    clearSelectedPortal,
    getSession,
    waitForSession,
    getMyRole,
    signInWithPassword,
    signUp,
    signInWithGoogle,
    resetPassword,
    signOut,
  };
})();
