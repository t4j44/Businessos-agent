-- Apply after 022. Additive; existing appointments are not rewritten.
-- Review and run in staging first. RPCs with service privileges are server-only.
BEGIN;

ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS duration_minutes integer NOT NULL DEFAULT 30;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS resource_key text NOT NULL DEFAULT 'primary';
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS confirmed_by uuid;

-- The existing product has one manual calendar per business. resource_key
-- permits separate calendars later without treating the entire business as one
-- provider resource. This does not claim external-calendar synchronization.
CREATE OR REPLACE FUNCTION public.confirm_appointment(
  p_client_id uuid, p_appointment_id uuid, p_date date, p_time text,
  p_duration_minutes integer DEFAULT 30
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  appointment public.appointments;
  proposed_start timestamp;
BEGIN
  IF p_client_id IS NULL OR p_date IS NULL OR p_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     OR p_duration_minutes NOT BETWEEN 5 AND 480 THEN
    RAISE EXCEPTION 'Invalid confirmation input' USING ERRCODE = '22023';
  END IF;
  -- All confirmation writers use this RPC. Serializes the overlap check + write.
  PERFORM pg_advisory_xact_lock(hashtextextended('appointment:' || p_client_id::text, 0));
  SELECT * INTO appointment FROM public.appointments
    WHERE id = p_appointment_id AND client_id = p_client_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome', 'not_found'); END IF;
  IF appointment.status IN ('cancelled', 'completed') THEN
    RETURN jsonb_build_object('outcome', 'invalid_state');
  END IF;
  IF appointment.status = 'confirmed' AND appointment.confirmed_date = p_date
     AND appointment.confirmed_time = p_time AND appointment.duration_minutes = p_duration_minutes THEN
    RETURN jsonb_build_object('outcome', 'unchanged', 'appointment', to_jsonb(appointment));
  END IF;
  proposed_start := p_date + p_time::time;
  IF EXISTS (
    SELECT 1 FROM public.appointments a
    WHERE a.client_id = p_client_id AND a.id <> p_appointment_id
      AND a.resource_key = appointment.resource_key AND a.status = 'confirmed'
      AND (
        -- Legacy free-text confirmed times cannot establish safe availability.
        (coalesce(a.confirmed_date, a.requested_date) = p_date
          AND coalesce(a.confirmed_time, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
        OR CASE WHEN a.confirmed_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
          tsrange(coalesce(a.confirmed_date, a.requested_date) + a.confirmed_time::time,
            coalesce(a.confirmed_date, a.requested_date) + a.confirmed_time::time + make_interval(mins => a.duration_minutes), '[)')
          && tsrange(proposed_start, proposed_start + make_interval(mins => p_duration_minutes), '[)')
        ELSE false END
      )
  ) THEN RETURN jsonb_build_object('outcome', 'conflict'); END IF;
  UPDATE public.appointments SET status = 'confirmed', confirmed_date = p_date,
    confirmed_time = p_time, duration_minutes = p_duration_minutes,
    updated_at = now(), reminder_sent = false
    WHERE id = p_appointment_id AND client_id = p_client_id RETURNING * INTO appointment;
  RETURN jsonb_build_object('outcome', 'confirmed', 'appointment', to_jsonb(appointment));
END;
$$;
REVOKE ALL ON FUNCTION public.confirm_appointment(uuid, uuid, date, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_appointment(uuid, uuid, date, text, integer) TO service_role;
-- Confirmations must go through the authenticated API and its atomic RPC.
REVOKE INSERT, UPDATE, DELETE ON public.appointments FROM anon, authenticated;

COMMIT;
