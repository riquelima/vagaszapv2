-- Remove vagas com application_link corrompido (formato gh-XXXXX ou vz-XXXXX)
-- Esses foram gerados pelo bulk_seed quando o id interno foi usado como link.
DELETE FROM public.jobs
WHERE application_link NOT LIKE 'http%';
