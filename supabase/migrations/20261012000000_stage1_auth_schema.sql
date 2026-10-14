-- ==============================================================================
-- CampusFix 2.0 - Stage 1 Migration: Authentication, Profiles & RBAC Foundation
-- ==============================================================================
-- Scope & Architectural Intent:
--   1. Create enum public.app_role ('student', 'admin').
--   2. Create public.profiles for user account metadata (supports Email & Google OAuth).
--   3. Create public.user_roles for tamper-proof server-controlled RBAC.
--   4. Implement secure helper functions (is_admin, get_my_role) with empty search_path.
--   5. Create updated_at trigger for public.profiles.
--   6. Create automated auth.users trigger to auto-provision profile and default 'student' role.
--   7. Configure explicit table-level and column-level privileges (counteracting broad defaults).
--   8. Add nullable user_id column and performance indexes to public.complaints.
--   9. Backfill existing auth.users (if any) with default 'student' role.
--
-- Safety Guarantees:
--   - Additive only: No existing complaint rows, columns, or live policies are modified or dropped.
--   - 18 legacy complaints remain untouched with user_id = NULL.
--   - Current admin login and existing live policies remain fully functional.
--   - No automatic admin role promotion in this file (handled in a separate verified snippet).
--   - All SECURITY DEFINER functions use SET search_path = '' and fully qualified names.
--   - Table privileges from PUBLIC, anon, and authenticated explicitly revoked prior to selective grant.
--   - Column-level UPDATE restricted strictly to (full_name, avatar_url).
--   - Isolated trigger naming: campusfix_on_auth_user_created.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Role Enum Definition
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_type t
    JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'app_role' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.app_role AS ENUM ('student', 'admin');
  END IF;
END
$$;

-- ------------------------------------------------------------------------------
-- 2. Public Profiles Table
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  student_id TEXT, -- Optional campus identifier; not used for login/authentication
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- 3. Public User Roles Table (Strictly isolated from client mutations)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_roles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL DEFAULT 'student'::public.app_role,
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- 4. Timestamp Maintenance: updated_at Trigger
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = pg_catalog.now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO authenticated, postgres, service_role;

-- CampusFix-specific trigger name: avoids dropping or colliding with unrelated triggers
DROP TRIGGER IF EXISTS campusfix_profiles_updated_at ON public.profiles;
CREATE TRIGGER campusfix_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------------------------
-- 5. Security Functions (SECURITY DEFINER with SET search_path = '')
-- ------------------------------------------------------------------------------

-- Helper: Verify if current session belongs to an administrator
-- Executed as function owner (postgres), querying user_roles directly without RLS recursion.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role = 'admin'::public.app_role
  );
END;
$$;

-- Helper: Safe role inspection endpoint for frontend routing
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role::pg_catalog.text INTO v_role
  FROM public.user_roles
  WHERE user_id = auth.uid();

  RETURN COALESCE(v_role, 'student');
END;
$$;

-- Restrict function execution permissions
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_my_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_role() TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 6. Trigger: Automatic User Provisioning on Sign-up
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_full_name TEXT;
  v_avatar_url TEXT;
BEGIN
  -- Extract display metadata if provided by OAuth or signup
  v_full_name := COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    NULL
  );

  v_avatar_url := COALESCE(
    NEW.raw_user_meta_data->>'avatar_url',
    NEW.raw_user_meta_data->>'picture',
    NULL
  );

  -- 1. Create or synchronize profile
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    v_full_name,
    v_avatar_url
  )
  ON CONFLICT (id) DO UPDATE
  SET
    email = EXCLUDED.email,
    full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
    avatar_url = COALESCE(EXCLUDED.avatar_url, public.profiles.avatar_url),
    updated_at = pg_catalog.now();

  -- 2. Explicitly assign student role (hardcoded enum value; completely ignores client-supplied metadata)
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'student'::public.app_role)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- Protect the trigger function from direct execution by clients
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO postgres, service_role;

-- CampusFix-specific trigger name: avoids collision with generic triggers
DROP TRIGGER IF EXISTS campusfix_on_auth_user_created ON auth.users;
CREATE TRIGGER campusfix_on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ------------------------------------------------------------------------------
-- 7. Explicit Table Privileges & Column-Level Access Control
-- ------------------------------------------------------------------------------

-- Step 7a: Revoke default broad privileges inherited from public schema defaults
REVOKE ALL ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.user_roles FROM PUBLIC, anon, authenticated;

-- Step 7b: Explicitly grant full administrative access to postgres and service_role
GRANT ALL ON TABLE public.profiles TO postgres, service_role;
GRANT ALL ON TABLE public.user_roles TO postgres, service_role;

-- Step 7c: Authenticated Users - Profiles Permissions
-- Grant table-level SELECT (rows are filtered by RLS)
GRANT SELECT ON TABLE public.profiles TO authenticated;

-- Grant UPDATE ONLY on explicitly approved columns
-- Denies client updates to email, id, student_id, created_at, updated_at
GRANT UPDATE (full_name, avatar_url) ON TABLE public.profiles TO authenticated;

-- Step 7d: Authenticated Users - User Roles Permissions
-- Grant table-level SELECT only (rows are filtered by RLS)
GRANT SELECT ON TABLE public.user_roles TO authenticated;

-- Explicitly confirm no client mutation permissions exist on user_roles
REVOKE INSERT, UPDATE, DELETE ON TABLE public.user_roles FROM authenticated;

-- ------------------------------------------------------------------------------
-- 8. Row Level Security Policies for Profiles & User Roles
-- ------------------------------------------------------------------------------

-- Profiles: Authenticated users view their own profile; admins view all profiles
DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
CREATE POLICY "profiles_select"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id OR public.is_admin());

-- Profiles: Authenticated users can update only their own profile row
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- User Roles: Authenticated users see their own assigned role; admins view all
DROP POLICY IF EXISTS "user_roles_select" ON public.user_roles;
CREATE POLICY "user_roles_select"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR public.is_admin());

-- NOTE: No client INSERT, UPDATE, or DELETE policies exist on public.user_roles.

-- ------------------------------------------------------------------------------
-- 9. Additive Column Migration on public.complaints
-- ------------------------------------------------------------------------------
-- Add nullable user_id foreign key (preserves all 18 legacy complaints with user_id = NULL)
ALTER TABLE public.complaints
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- ------------------------------------------------------------------------------
-- 10. Performance Indexes
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_complaints_user_id ON public.complaints(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id_role ON public.user_roles(user_id, role);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);

-- ------------------------------------------------------------------------------
-- 11. Safe Backfill for Pre-existing Auth Users
-- ------------------------------------------------------------------------------
-- Backfill profiles for existing users if any exist in the environment
INSERT INTO public.profiles (id, email, full_name, avatar_url)
SELECT
  u.id,
  COALESCE(u.email, ''),
  COALESCE(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', 'User'),
  COALESCE(u.raw_user_meta_data->>'avatar_url', u.raw_user_meta_data->>'picture', NULL)
FROM auth.users u
ON CONFLICT (id) DO NOTHING;

-- Backfill default student role for existing users
INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'student'::public.app_role
FROM auth.users u
ON CONFLICT (user_id) DO NOTHING;
