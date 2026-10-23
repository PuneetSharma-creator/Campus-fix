# CampusFix 🛠️

**CampusFix** is a campus complaint-management web app that helps students report maintenance and facility issues and helps administrators review and manage those complaints in one place. AI-assisted analysis can suggest a category, urgency level, and short explanation for a submitted complaint.

🌐 **Live demo:** [campus-fix-black.vercel.app](https://campus-fix-black.vercel.app)  
📦 **Repository:** [PuneetSharma-creator/Campus-fix](https://github.com/PuneetSharma-creator/Campus-fix)

## Features

- **Student portal:** Sign in and submit campus complaints with relevant details.
- **Personal complaint tracking:** Students can view their own complaints and their current status.
- **Admin dashboard:** Authorized administrators can review complaints across the campus and update their status.
- **AI-assisted triage:** A Google Gemini-powered Supabase Edge Function can suggest a complaint category, priority (`Low`, `Medium`, or `High`), and explanation.
- **Input validation:** The server validates complaint fields and checks AI responses against the allowed categories and priority values.
- **Authentication and access control:** Supabase Auth handles user sessions; database Row Level Security (RLS) restricts complaint access by user and administrator role.
- **Cloud deployment:** The static frontend is hosted on Vercel, with Supabase providing authentication, database services, and the Edge Function.

## Technology stack

| Technology | Purpose |
|---|---|
| HTML, CSS, JavaScript | Frontend pages and client-side behavior |
| Supabase Auth | User authentication and sessions |
| Supabase PostgreSQL | Complaint records and role data |
| Supabase Row Level Security | Database access control |
| Supabase Edge Functions | Secure server-side complaint processing and AI requests |
| Google Gemini API | AI-assisted categorization, priority, and explanation |
| Vercel | Frontend hosting and deployment |

## Project structure

```text
Campus-fix/
├── login.html                    # Login/portal entry page
├── index.html                    # Student complaint portal
├── admin.html                    # Administrator dashboard
├── auth.js                       # Authentication/session handling
├── script.js                     # Student complaint UI and interactions
├── style.css                     # Shared frontend styles
├── config.js                     # Public Supabase frontend configuration
└── supabase/
    ├── config.toml               # Supabase CLI/function configuration
    ├── functions/
    │   └── analyze-complaint/
    │       └── index.ts           # Authenticated complaint analysis endpoint
    └── migrations/
        └── 20261022000000_phase3_complaints_rls.sql
                                  # Complaint access-control migration
```

> File names may evolve as the project is developed. Keep the local project structure and deployed Supabase configuration in sync.

## How it works

1. A student signs in through the CampusFix portal.
2. The student submits a complaint describing the issue and its location.
3. The frontend sends the request to the `analyze-complaint` Supabase Edge Function with the student's access token.
4. The function validates the user session on the server, validates the submitted fields, and requests AI-assisted analysis from Gemini.
5. The complaint is stored against the authenticated user's ID, with its initial status set by the server.
6. The student can view their own complaints. Authorized administrators can review campus complaints and update their status.

AI analysis depends on the Gemini API being available. The complaint workflow should handle cases where AI analysis is unavailable without exposing API credentials to the browser.

## Run locally

### 1. Clone the repository

```bash
git clone https://github.com/PuneetSharma-creator/Campus-fix.git
cd Campus-fix
```

### 2. Configure the frontend

Open `config.js` and set the Supabase project URL and **public publishable/anon key** expected by the frontend.

```js
// Example only — use your own Supabase project values.
const CONFIG = {
  SUPABASE_URL: "https://YOUR_PROJECT_REF.supabase.co",
  SUPABASE_ANON_KEY: "YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY"
};
```

Adapt the example to the exact structure already used by your `config.js`; do not replace other required settings accidentally.

The publishable/anon key is intended for frontend use, with access controlled by authentication and RLS. **Never put a Supabase secret/service-role key or a Gemini API key in `config.js` or any browser-delivered file.**

### 3. Serve the frontend

Because the project uses static HTML, CSS, and JavaScript, open the folder with Visual Studio Code and use the Live Server extension, or run a local static server such as:

```bash
python -m http.server 5500
```

Then open `http://localhost:5500/login.html` in your browser. Use the port and URL supplied by whichever development server you choose.

### 4. Configure Supabase Auth

In the Supabase dashboard:

- Enable the authentication provider(s) configured for the application.
- Add your local development URL and deployed site URL to the allowed redirect/site URL settings as appropriate for the chosen provider.
- Ensure the intended administrator account has the administrator role configured in the database.

Authentication provider and email-confirmation settings should match your deployment's security requirements.

### 5. Configure the Edge Function secret

Set the Gemini API key as a **server-side Supabase secret**, either from the Supabase dashboard's Edge Function secrets settings or through the CLI. For example:

```bash
npx supabase secrets set GEMINI_API_KEY=YOUR_GEMINI_API_KEY --project-ref YOUR_PROJECT_REF
```

Use the current secret names expected by `supabase/functions/analyze-complaint/index.ts`. Do not commit actual secret values to Git.

### 6. Link and deploy the Edge Function

Install/use the Supabase CLI, authenticate, and link the project:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase functions deploy analyze-complaint --project-ref YOUR_PROJECT_REF
```

The function performs its own server-side session validation before processing requests. Keep this validation in place even if gateway-level JWT verification is configured differently for the current Supabase signing-key setup.

### 7. Apply database migrations

Review the SQL files in `supabase/migrations/` and apply the intended migrations to your Supabase project using the Supabase SQL Editor or your normal migration workflow. **Back up and verify production data before applying schema or RLS changes.** Do not rerun an already-applied production migration without first checking its effects and idempotency.

## Deployment

- **Frontend:** Connect the GitHub repository to Vercel. Deploy the release branch to **Production**; branch-specific deployments are previews and do not automatically change the production domain.
- **Backend:** Deploy the `analyze-complaint` Edge Function to the correct Supabase project and configure its server-side secrets.
- **Database:** Ensure the production schema, role assignments, grants, and RLS policies match the release being deployed.
- **Auth:** Verify the production site URL and redirect URLs after deployment.

After a release, test both an ordinary student account and an administrator account. Confirm that students can only see their own complaints, administrators can review/manage campus complaints, and unauthenticated requests are rejected.

## Security notes

- Do not commit API keys, access tokens, service-role/secret keys, or `.env` files.
- Do not expose privileged Supabase credentials to client-side code.
- Keep RLS enabled and review policies whenever database tables or roles change.
- The Edge Function must derive `user_id` from the verified session, not from user-submitted request data.
- Validate authorization server-side; hiding admin controls in the UI is not access control.
- Treat AI output as a suggestion and validate its category and priority before saving it.

## Future improvements

Potential next steps include complaint status notifications, image attachments, filtering/search for administrators, analytics for recurring campus issues, and an audit trail for status changes.

## Contributing

1. Create a feature branch.
2. Make a focused change and test both student and administrator flows.
3. Never include secrets or real user credentials in commits.
4. Open a pull request describing the change and any database/configuration updates required.

## License

No license is specified in this repository's README yet. Add a `LICENSE` file and update this section if you intend to distribute the project for reuse.
