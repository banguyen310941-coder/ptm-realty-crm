-- PTM CRM · Neon pg_cron housekeeping scheduler · 2026-09-14
-- Endpoint prerequisite (Neon compute settings):
--   cron.database_name = neondb
--   preload library: pg_cron
-- After changing preload settings, restart the compute once before this migration.

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'ptm-crm-housekeeping',
  '*/5 * * * *',
  'select public.crm_housekeeping_cron_v1();'
);

INSERT INTO public.crm_schema_migrations(version,note)
VALUES (
  '20260914_neon_pg_cron_housekeeping',
  'Enable pg_cron and schedule CRM housekeeping every five minutes inside Neon.'
)
ON CONFLICT(version) DO NOTHING;
