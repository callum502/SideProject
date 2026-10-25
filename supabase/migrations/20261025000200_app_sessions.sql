BEGIN;
-- Signed-in sessions, so they survive server restarts and deploys and can be shared by more than one server.
-- The server keys each row by a hash of the session cookie and encrypts its Supabase tokens with a key derived from
-- the cookie (session-store.mjs), so the table alone cannot be used to sign in as anyone.
CREATE TABLE private.app_sessions (
 id text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{64}$'),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 payload text NOT NULL CHECK (length(payload) <= 16384),
 expires_at timestamptz NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX app_sessions_user_idx ON private.app_sessions(user_id);
CREATE INDEX app_sessions_expiry_idx ON private.app_sessions(expires_at);
ALTER TABLE private.app_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.app_sessions FROM PUBLIC,anon,authenticated;

-- Called at sign-in with the new access token. Also clears expired sessions, and keeps at most 50 per account.
CREATE FUNCTION public.create_app_session(session_id text,payload text,expires_at timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Log in first' USING ERRCODE='42501'; END IF;
 IF expires_at > now() + interval '25 hours' THEN RAISE EXCEPTION 'Invalid session expiry' USING ERRCODE='22023'; END IF;
 DELETE FROM private.app_sessions s WHERE s.expires_at <= now();
 DELETE FROM private.app_sessions s WHERE s.id IN (
  SELECT old.id FROM private.app_sessions old WHERE old.user_id=auth.uid() ORDER BY old.updated_at DESC OFFSET 49
 );
 INSERT INTO private.app_sessions(id,user_id,payload,expires_at)
 VALUES(create_app_session.session_id,auth.uid(),create_app_session.payload,create_app_session.expires_at);
END $$;

-- Reading a session needs its ID, which only the cookie's holder can compute; the payload is still encrypted.
CREATE FUNCTION public.read_app_session(session_id text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT s.payload FROM private.app_sessions s WHERE s.id=read_app_session.session_id AND s.expires_at > now()
$$;

-- Saves refreshed tokens. Only the session's own account can change it.
CREATE FUNCTION public.update_app_session(session_id text,payload text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 UPDATE private.app_sessions s SET payload=update_app_session.payload,updated_at=now()
 WHERE s.id=update_app_session.session_id AND s.user_id=auth.uid() AND s.expires_at > now()
$$;

-- Logging out may happen after the access token expired, so this needs only the session ID.
CREATE FUNCTION public.delete_app_session(session_id text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 DELETE FROM private.app_sessions s WHERE s.id=delete_app_session.session_id
$$;

REVOKE ALL ON FUNCTION public.create_app_session(text,text,timestamptz),public.read_app_session(text),
 public.update_app_session(text,text),public.delete_app_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_app_session(text,text,timestamptz),public.update_app_session(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.read_app_session(text),public.delete_app_session(text) TO anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
