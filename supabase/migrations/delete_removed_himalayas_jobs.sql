-- Remove vagas marcadas como removidas (Himalayas neutralizado)
DELETE FROM public.jobs
WHERE application_link LIKE 'https://removed.invalid/%';
