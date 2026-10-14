-- ==============================================================================
-- CampusFix 2.0 - Standalone Administrator Role Seed Snippet
-- ==============================================================================
-- INSTRUCTIONS FOR ARCHITECT / OPERATOR:
-- 1. In your Supabase Dashboard -> Authentication -> Users:
--    Locate the account intended to serve as the administrator.
-- 2. Confirm both the exact Auth User UUID and the exact registered Email Address.
-- 3. Replace the placeholder values in the constants below.
-- 4. Run this script in the Supabase SQL Editor.
--
-- SAFETY & VALIDATION GUARANTEES:
-- - Rejects empty or NULL expected UUID and email constants.
-- - Validates that the UUID exists in auth.users.
-- - Validates that the email linked to that UUID matches the expected email
--   using `IS DISTINCT FROM` after case-folding and trimming.
-- - If there is ANY identity mismatch or if the user does not exist, the script
--   raises an exception and terminates the transaction without making changes.
-- - Ensures the administrator has an up-to-date row in public.profiles.
-- - Upserts the role to 'admin'::public.app_role in public.user_roles.
-- ==============================================================================

DO $$
DECLARE
  -- ----------------------------------------------------------------------------
  -- REPLACE THESE PLACEHOLDERS WITH YOUR INDEPENDENTLY VERIFIED CREDENTIALS:
  -- ----------------------------------------------------------------------------
  c_target_admin_uuid  CONSTANT UUID := '6f7e153c-8a68-4473-a2e3-de40530a87de'::UUID;
  c_target_admin_email CONSTANT TEXT := 'admin@campus.edu'; -- Replace with verified admin email
  -- ----------------------------------------------------------------------------

  v_actual_email TEXT;
  v_user_exists BOOLEAN;
BEGIN
  -- 1. Input parameter validation: reject empty or NULL expected values
  IF c_target_admin_uuid IS NULL THEN
    RAISE EXCEPTION 'ADMIN SEED ABORTED: c_target_admin_uuid cannot be NULL.';
  END IF;

  IF c_target_admin_email IS NULL OR pg_catalog.trim(c_target_admin_email) = '' THEN
    RAISE EXCEPTION 'ADMIN SEED ABORTED: c_target_admin_email cannot be NULL or empty.';
  END IF;

  -- 2. Verify existence of the user in auth.users
  SELECT EXISTS (
    SELECT 1 FROM auth.users WHERE id = c_target_admin_uuid
  ) INTO v_user_exists;

  IF NOT v_user_exists THEN
    RAISE EXCEPTION 'ADMIN SEED ABORTED: Auth user with UUID % does not exist in auth.users. No role was modified.',
      c_target_admin_uuid;
  END IF;

  -- 3. Retrieve actual email from auth.users
  SELECT email INTO v_actual_email
  FROM auth.users
  WHERE id = c_target_admin_uuid;

  -- 4. Compare actual and expected emails using IS DISTINCT FROM after normalization
  IF pg_catalog.lower(pg_catalog.trim(COALESCE(v_actual_email, ''))) 
     IS DISTINCT FROM 
     pg_catalog.lower(pg_catalog.trim(c_target_admin_email)) THEN
    RAISE EXCEPTION 'ADMIN SEED ABORTED: Identity mismatch! UUID % is associated with email "%", but expected email was "%". No role was modified.',
      c_target_admin_uuid, v_actual_email, c_target_admin_email;
  END IF;

  -- 5. Ensure profile exists and has an administrator display name
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (c_target_admin_uuid, v_actual_email, 'Administrator')
  ON CONFLICT (id) DO UPDATE
  SET
    email = EXCLUDED.email,
    updated_at = pg_catalog.now();

  -- 6. Promote verified account to 'admin' role in public.user_roles
  INSERT INTO public.user_roles (user_id, role)
  VALUES (c_target_admin_uuid, 'admin'::public.app_role)
  ON CONFLICT (user_id) DO UPDATE
  SET role = 'admin'::public.app_role;

  RAISE NOTICE 'SUCCESS: User % (%) has been verified and granted the "admin" role in public.user_roles.',
    c_target_admin_uuid, v_actual_email;
END
$$;
