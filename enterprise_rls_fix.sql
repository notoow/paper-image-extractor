-- [Enterprise Level RLS Setup]
-- 1. Reset: Disable RLS temporarily to ensure a clean state
ALTER TABLE public.votes DISABLE ROW LEVEL SECURITY;

-- 2. Cleanup: Drop ALL existing policies to prevent "Multiple Permissive Policies" errors
DROP POLICY IF EXISTS "Enable all access for votes" ON public.votes;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.votes;
DROP POLICY IF EXISTS "Enable insert for all users" ON public.votes;
DROP POLICY IF EXISTS "Allow reading votes" ON public.votes;
DROP POLICY IF EXISTS "Allow insert for everyone" ON public.votes;
DROP POLICY IF EXISTS "Allow inserting valid votes" ON public.votes;
-- (Just in case, drop by potential names)

-- 3. Re-enable RLS (Strict Mode)
ALTER TABLE public.votes ENABLE ROW LEVEL SECURITY;

-- 4. Policy: Public Read Access (Optimized for single purpose)
-- Allow anyone to read votes to check for duplicates (Essential for frontend/backend checks)
CREATE POLICY "votes_select_policy"
ON public.votes
FOR SELECT
TO public
USING (true);

-- 5. Policy: Public Insert Access (With Data Validation)
-- Allow insertion only if critical fields are present.
-- prevents empty/spam rows.
CREATE POLICY "votes_insert_policy"
ON public.votes
FOR INSERT
TO public
WITH CHECK (
    image_id IS NOT NULL 
    AND length(coalesce(ip_hash, '')) > 0
);

-- Note: UPDATE and DELETE are implicitly DENIED because no policies exist for them.
-- This is the standard "Append-Only" log pattern used in enterprise audit/voting systems.
