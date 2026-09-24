-- Additive follow-up to 035. Existing bookings are NOT emailed by migration.
BEGIN;
ALTER TABLE appointments ADD COLUMN notification_version integer NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX appointments_id_client_unique ON appointments(id,client_id);

CREATE TABLE scheduler_outbox (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL,
  version integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('request_received','owner_alert','confirmation','reminder')),
  snapshot jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','accepted','cancelled','blocked','review')),
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_id uuid,
  lease_until timestamptz,
  prepared_email jsonb,
  first_attempt_at timestamptz,
  provider_id text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(appointment_id,version,kind),
  FOREIGN KEY(appointment_id,client_id) REFERENCES appointments(id,client_id) ON DELETE CASCADE
);
CREATE INDEX scheduler_outbox_dispatch ON scheduler_outbox(available_at,client_id) WHERE status IN ('pending','processing');
ALTER TABLE scheduler_outbox ENABLE ROW LEVEL SECURITY;
-- Prepared bodies include private unsubscribe URLs; only the guarded API reads them.
REVOKE ALL ON scheduler_outbox FROM anon,authenticated;
GRANT ALL ON scheduler_outbox TO service_role;

CREATE FUNCTION version_appointment_notification() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF (NEW.status,NEW.confirmed_date,NEW.confirmed_time,NEW.duration_minutes,NEW.customer_email)
      IS DISTINCT FROM (OLD.status,OLD.confirmed_date,OLD.confirmed_time,OLD.duration_minutes,OLD.customer_email) THEN
    NEW.notification_version := OLD.notification_version + 1;
  ELSE NEW.notification_version := OLD.notification_version;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER appointment_notification_version BEFORE UPDATE ON appointments
FOR EACH ROW EXECUTE FUNCTION version_appointment_notification();

CREATE FUNCTION queue_appointment_notifications() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.customer_email IS NOT NULL THEN
      INSERT INTO scheduler_outbox(client_id,appointment_id,version,kind,snapshot)
        VALUES(NEW.client_id,NEW.id,NEW.notification_version,'request_received',to_jsonb(NEW));
    END IF;
    INSERT INTO scheduler_outbox(client_id,appointment_id,version,kind,snapshot)
      VALUES(NEW.client_id,NEW.id,NEW.notification_version,'owner_alert',to_jsonb(NEW));
  ELSIF NEW.notification_version<>OLD.notification_version THEN
    UPDATE scheduler_outbox SET status='cancelled',last_error='appointment_changed',updated_at=now()
      WHERE appointment_id=NEW.id AND status IN ('pending','blocked');
    IF NEW.status='confirmed' AND NEW.customer_email IS NOT NULL THEN
      INSERT INTO scheduler_outbox(client_id,appointment_id,version,kind,snapshot)
        VALUES(NEW.client_id,NEW.id,NEW.notification_version,'confirmation',to_jsonb(NEW));
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER appointment_notification_enqueue AFTER INSERT OR UPDATE ON appointments
FOR EACH ROW EXECUTE FUNCTION queue_appointment_notifications();

CREATE FUNCTION claim_scheduler_delivery(p_client_id uuid,p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE item scheduler_outbox; booking appointments;
BEGIN
  SELECT * INTO item FROM scheduler_outbox WHERE id=p_id AND client_id=p_client_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF item.status NOT IN ('pending','processing') OR item.available_at>now()
    OR (item.status='processing' AND item.lease_until>now()) THEN RETURN NULL; END IF;
  -- Resend remembers an idempotency key for 24h. Stop before that expires.
  IF item.first_attempt_at<now()-interval '23 hours' OR item.attempts>=6 THEN
    UPDATE scheduler_outbox SET status='review',last_error='reconciliation_required',lease_id=NULL,lease_until=NULL,updated_at=now() WHERE id=p_id;
    RETURN NULL;
  END IF;
  SELECT * INTO booking FROM appointments WHERE id=item.appointment_id AND client_id=p_client_id;
  IF booking.status IN ('cancelled','completed') OR booking.notification_version<>item.version OR
    (item.kind='reminder' AND booking.confirmed_date<>((now() AT TIME ZONE (item.snapshot->>'timezone'))::date+1)) OR
    (item.kind IN ('confirmation','reminder') AND booking.status<>'confirmed') THEN
    UPDATE scheduler_outbox SET status='cancelled',last_error='appointment_changed',lease_id=NULL,lease_until=NULL,updated_at=now() WHERE id=p_id;
    RETURN NULL;
  END IF;
  UPDATE scheduler_outbox SET status='processing',lease_id=uuid_generate_v4(),lease_until=now()+interval '2 minutes',
    attempts=attempts+1,updated_at=now() WHERE id=p_id RETURNING * INTO item;
  RETURN to_jsonb(item);
END $$;

CREATE FUNCTION prepare_scheduler_delivery(p_client_id uuid,p_id uuid,p_lease uuid,p_email jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE item scheduler_outbox;
BEGIN
  IF p_email IS NULL OR jsonb_typeof(p_email)<>'object' OR octet_length(p_email::text)>100000 THEN RAISE EXCEPTION 'Invalid email'; END IF;
  UPDATE scheduler_outbox SET prepared_email=coalesce(prepared_email,p_email),updated_at=now()
    WHERE id=p_id AND client_id=p_client_id AND status='processing' AND lease_id=p_lease AND lease_until>now()
    RETURNING * INTO item;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN item.prepared_email;
END $$;

CREATE FUNCTION begin_scheduler_send(p_client_id uuid,p_id uuid,p_lease uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  UPDATE scheduler_outbox o SET first_attempt_at=coalesce(o.first_attempt_at,now()),updated_at=now()
    FROM appointments a WHERE o.id=p_id AND o.client_id=p_client_id AND o.status='processing'
      AND o.lease_id=p_lease AND o.lease_until>now() AND o.prepared_email IS NOT NULL
      AND (o.first_attempt_at IS NULL OR o.first_attempt_at>now()-interval '23 hours')
      AND a.id=o.appointment_id AND a.client_id=o.client_id AND a.status NOT IN ('cancelled','completed')
      AND a.notification_version=o.version
      AND (o.kind<>'reminder' OR a.confirmed_date=((now() AT TIME ZONE (o.snapshot->>'timezone'))::date+1))
      AND (o.kind NOT IN ('confirmation','reminder') OR a.status='confirmed');
  RETURN FOUND;
END $$;

CREATE FUNCTION finish_scheduler_delivery(p_client_id uuid,p_id uuid,p_lease uuid,p_status text,p_provider_id text DEFAULT NULL,p_error text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE item scheduler_outbox;
BEGIN
  IF p_status NOT IN ('accepted','pending','blocked','review','cancelled') OR
    (p_status='accepted' AND coalesce(length(p_provider_id),0)=0) THEN RAISE EXCEPTION 'Invalid delivery result'; END IF;
  UPDATE scheduler_outbox SET status=p_status,provider_id=p_provider_id,last_error=left(p_error,120),
    available_at=now()+make_interval(secs=>least(1800,60*(2^attempts)::integer)),
    lease_id=NULL,lease_until=NULL,updated_at=now()
    WHERE id=p_id AND client_id=p_client_id AND status='processing' AND lease_id=p_lease
      AND (p_status<>'accepted' OR first_attempt_at IS NOT NULL)
    RETURNING * INTO item;
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_status='accepted' AND item.kind='reminder' THEN
    UPDATE appointments SET reminder_sent=true WHERE id=item.appointment_id AND client_id=p_client_id
      AND notification_version=item.version AND status='confirmed';
  END IF;
  RETURN true;
END $$;

CREATE FUNCTION retry_scheduler_delivery(p_client_id uuid,p_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  -- Never reset an ambiguous provider attempt or extend its retry window.
  UPDATE scheduler_outbox SET status='review',last_error='reconciliation_required',updated_at=now()
    WHERE id=p_id AND client_id=p_client_id AND status IN ('blocked','pending') AND first_attempt_at IS NOT NULL
      AND (first_attempt_at<=now()-interval '23 hours' OR attempts>=6);
  UPDATE scheduler_outbox SET status='pending',available_at=now(),attempts=CASE WHEN first_attempt_at IS NULL THEN 0 ELSE attempts END,
    last_error=NULL,updated_at=now() WHERE id=p_id AND client_id=p_client_id
    AND (status IN ('blocked','pending') OR (status='review' AND first_attempt_at IS NULL))
    AND (first_attempt_at IS NULL OR (first_attempt_at>now()-interval '23 hours' AND attempts<6));
  RETURN FOUND;
END $$;

CREATE FUNCTION scheduler_delivery_candidates(p_limit integer DEFAULT 10) RETURNS TABLE(id uuid,client_id uuid)
LANGUAGE sql SECURITY INVOKER SET search_path=public AS $$
  SELECT ranked.id,ranked.client_id FROM (
    SELECT o.id,o.client_id,o.available_at,row_number() OVER(PARTITION BY o.client_id ORDER BY o.available_at,o.created_at) AS tenant_position
    FROM scheduler_outbox o WHERE o.status IN ('pending','processing') AND o.available_at<=now()
      AND (o.lease_until IS NULL OR o.lease_until<=now())
  ) ranked ORDER BY ranked.tenant_position,ranked.available_at LIMIT greatest(1,least(p_limit,20));
$$;

CREATE FUNCTION queue_scheduler_reminders() RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE queued integer;
BEGIN
  INSERT INTO scheduler_outbox(client_id,appointment_id,version,kind,snapshot)
    SELECT a.client_id,a.id,a.notification_version,'reminder',to_jsonb(a)||jsonb_build_object('timezone',c.timezone)
    FROM appointments a JOIN clients c ON c.id=a.client_id JOIN pg_timezone_names tz ON tz.name=c.timezone
    WHERE a.status='confirmed' AND NOT a.reminder_sent AND a.customer_email IS NOT NULL
      AND a.confirmed_date=((now() AT TIME ZONE tz.name)::date+1)
      AND a.confirmed_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      AND NOT EXISTS(SELECT 1 FROM scheduler_outbox o WHERE o.appointment_id=a.id AND o.version=a.notification_version AND o.kind='reminder')
    ORDER BY a.confirmed_date,a.id LIMIT 100
    ON CONFLICT(appointment_id,version,kind) DO NOTHING;
  GET DIAGNOSTICS queued=ROW_COUNT;
  RETURN queued;
END $$;

ALTER TABLE scheduler_outbox ADD COLUMN reconciled_by uuid;
CREATE FUNCTION reconcile_scheduler_delivery(p_client_id uuid,p_id uuid,p_user_id uuid,p_provider_id text) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE item scheduler_outbox;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM clients WHERE id=p_client_id AND user_id=p_user_id)
    OR coalesce(length(p_provider_id),0)=0 THEN RETURN false; END IF;
  UPDATE scheduler_outbox SET status='accepted',provider_id=p_provider_id,reconciled_by=p_user_id,
    last_error=NULL,lease_id=NULL,lease_until=NULL,updated_at=now()
    WHERE id=p_id AND client_id=p_client_id AND first_attempt_at IS NOT NULL
      AND status IN ('review','blocked','pending') RETURNING * INTO item;
  IF NOT FOUND THEN RETURN false; END IF;
  IF item.kind='reminder' THEN
    UPDATE appointments SET reminder_sent=true WHERE id=item.appointment_id AND client_id=p_client_id
      AND notification_version=item.version AND status='confirmed';
  END IF;
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION queue_scheduler_reminders(),reconcile_scheduler_delivery(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION queue_scheduler_reminders(),reconcile_scheduler_delivery(uuid,uuid,uuid,text) TO service_role;

REVOKE ALL ON FUNCTION version_appointment_notification(),queue_appointment_notifications(),claim_scheduler_delivery(uuid,uuid),
  prepare_scheduler_delivery(uuid,uuid,uuid,jsonb),begin_scheduler_send(uuid,uuid,uuid),
  finish_scheduler_delivery(uuid,uuid,uuid,text,text,text),retry_scheduler_delivery(uuid,uuid),scheduler_delivery_candidates(integer)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION version_appointment_notification(),queue_appointment_notifications(),claim_scheduler_delivery(uuid,uuid),
  prepare_scheduler_delivery(uuid,uuid,uuid,jsonb),begin_scheduler_send(uuid,uuid,uuid),
  finish_scheduler_delivery(uuid,uuid,uuid,text,text,text),retry_scheduler_delivery(uuid,uuid),scheduler_delivery_candidates(integer)
TO service_role;
COMMIT;
