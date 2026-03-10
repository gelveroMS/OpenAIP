


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "app";


ALTER SCHEMA "app" OWNER TO "postgres";


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "vector" WITH SCHEMA "extensions";






CREATE TYPE "public"."aip_chunk_type" AS ENUM (
    'project',
    'section_summary',
    'category_summary',
    'legacy_category_group'
);


ALTER TYPE "public"."aip_chunk_type" OWNER TO "postgres";


CREATE TYPE "public"."aip_status" AS ENUM (
    'draft',
    'pending_review',
    'under_review',
    'for_revision',
    'published'
);


ALTER TYPE "public"."aip_status" OWNER TO "postgres";


CREATE TYPE "public"."feedback_kind" AS ENUM (
    'question',
    'suggestion',
    'concern',
    'lgu_note',
    'ai_finding',
    'commend'
);


ALTER TYPE "public"."feedback_kind" OWNER TO "postgres";


CREATE TYPE "public"."feedback_source" AS ENUM (
    'human',
    'ai'
);


ALTER TYPE "public"."feedback_source" OWNER TO "postgres";


CREATE TYPE "public"."feedback_target_type" AS ENUM (
    'aip',
    'project'
);


ALTER TYPE "public"."feedback_target_type" OWNER TO "postgres";


CREATE TYPE "public"."pipeline_stage" AS ENUM (
    'extract',
    'validate',
    'scale_amounts',
    'summarize',
    'categorize',
    'embed'
);


ALTER TYPE "public"."pipeline_stage" OWNER TO "postgres";


CREATE TYPE "public"."pipeline_status" AS ENUM (
    'queued',
    'running',
    'succeeded',
    'failed'
);


ALTER TYPE "public"."pipeline_status" OWNER TO "postgres";


CREATE TYPE "public"."project_category" AS ENUM (
    'health',
    'infrastructure',
    'other'
);


ALTER TYPE "public"."project_category" OWNER TO "postgres";


CREATE TYPE "public"."review_action" AS ENUM (
    'approve',
    'request_revision',
    'claim_review'
);


ALTER TYPE "public"."review_action" OWNER TO "postgres";


CREATE TYPE "public"."role_type" AS ENUM (
    'citizen',
    'barangay_official',
    'city_official',
    'municipal_official',
    'admin'
);


ALTER TYPE "public"."role_type" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app"."embed_categorize_url"() RETURNS "text"
    LANGUAGE "sql" STABLE
    AS $$
  select value from app.settings where key = 'embed_categorize_url'
$$;


ALTER FUNCTION "app"."embed_categorize_url"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."aips_set_timestamps"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
begin
  new.updated_at = now();

  if tg_op = 'INSERT' then
    if new.status_updated_at is null then
      new.status_updated_at = now();
    end if;

    if new.created_by is null then
      new.created_by = (select auth.uid());
    end if;

    if new.submitted_at is null and new.status in ('pending_review','under_review','for_revision','published') then
      new.submitted_at = now();
    end if;

    if new.status = 'published' and new.published_at is null then
      new.published_at = now();
    end if;

    return new;
  end if;

  -- UPDATE
  if new.status is distinct from old.status then
    new.status_updated_at = now();

    if new.submitted_at is null and new.status in ('pending_review','under_review','for_revision','published') then
      new.submitted_at = now();
    end if;

    if new.status = 'published' and new.published_at is null then
      new.published_at = now();
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."aips_set_timestamps"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."barangay_in_my_city"("p_barangay_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select exists (
    select 1
    from public.barangays b
    where b.id = p_barangay_id
      and b.city_id is not null
      and b.city_id = public.current_city_id()
  );
$$;


ALTER FUNCTION "public"."barangay_in_my_city"("p_barangay_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."barangay_in_my_municipality"("p_barangay_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select exists (
    select 1
    from public.barangays b
    where b.id = p_barangay_id
      and b.municipality_id is not null
      and b.municipality_id = public.current_municipality_id()
  );
$$;


ALTER FUNCTION "public"."barangay_in_my_municipality"("p_barangay_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_access_chat_session"("p_session_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select exists (
    select 1
    from public.chat_sessions s
    where s.id = p_session_id
      and public.is_active_auth()
      and (
        public.is_admin()
        or s.user_id = public.current_user_id()
      )
  );
$$;


ALTER FUNCTION "public"."can_access_chat_session"("p_session_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_citizen_write_aip_feedback"("p_aip_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select exists (
    select 1
    from public.aips a
    where a.id = p_aip_id
      and public.is_active_auth()
      and public.is_citizen()
      and a.status = 'published'
      and public.can_read_aip(a.id)
  );
$$;


ALTER FUNCTION "public"."can_citizen_write_aip_feedback"("p_aip_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_citizen_write_project_feedback"("p_project_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select exists (
    select 1
    from public.projects pr
    join public.aips a on a.id = pr.aip_id
    where pr.id = p_project_id
      and public.is_active_auth()
      and public.is_citizen()
      and a.status = 'published'
      and public.can_read_aip(a.id)
  );
$$;


ALTER FUNCTION "public"."can_citizen_write_project_feedback"("p_project_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_edit_aip"("p_aip_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select exists (
    select 1
    from public.aips a
    where a.id = p_aip_id
      and (
        public.is_admin()
        or (
          public.is_active_auth()
          and a.status in ('draft','for_revision')
          and (
            (
              public.is_barangay_official()
              and a.barangay_id is not null
              and a.barangay_id = public.current_barangay_id()
              and public.can_manage_barangay_aip(a.id)
            )
            or
            (public.is_city_official() and a.city_id is not null and a.city_id = public.current_city_id())
            or
            (public.is_municipal_official() and a.municipality_id is not null and a.municipality_id = public.current_municipality_id())
          )
        )
      )
  );
$$;


ALTER FUNCTION "public"."can_edit_aip"("p_aip_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_edit_project"("p_project_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select exists (
    select 1
    from public.projects pr
    where pr.id = p_project_id
      and public.can_edit_aip(pr.aip_id)
  );
$$;


ALTER FUNCTION "public"."can_edit_project"("p_project_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_manage_barangay_aip"("p_aip_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select exists (
    select 1
    from public.aips a
    left join lateral (
      select uf.uploaded_by
      from public.uploaded_files uf
      where uf.aip_id = a.id
        and uf.is_current = true
      order by uf.created_at desc, uf.id desc
      limit 1
    ) current_file on true
    where a.id = p_aip_id
      and a.barangay_id is not null
      and public.is_active_auth()
      and public.is_barangay_official()
      and a.barangay_id = public.current_barangay_id()
      and coalesce(current_file.uploaded_by, a.created_by) = public.current_user_id()
  );
$$;


ALTER FUNCTION "public"."can_manage_barangay_aip"("p_aip_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_owner_write_aip_feedback"("p_aip_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select exists (
    select 1
    from public.aips a
    where a.id = p_aip_id
      and public.is_active_auth()
      and (
        public.is_admin()

        or (
          public.is_barangay_official()
          and a.barangay_id is not null
          and a.barangay_id = public.current_barangay_id()
        )
        or (
          public.is_city_official()
          and a.city_id is not null
          and a.city_id = public.current_city_id()
        )
        or (
          public.is_municipal_official()
          and a.municipality_id is not null
          and a.municipality_id = public.current_municipality_id()
        )
      )
  );
$$;


ALTER FUNCTION "public"."can_owner_write_aip_feedback"("p_aip_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_owner_write_project_feedback"("p_project_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select exists (
    select 1
    from public.projects pr
    join public.aips a on a.id = pr.aip_id
    where pr.id = p_project_id
      and public.is_active_auth()
      and (
        public.is_admin()

        or (
          public.is_barangay_official()
          and a.barangay_id is not null
          and a.barangay_id = public.current_barangay_id()
        )
        or (
          public.is_city_official()
          and a.city_id is not null
          and a.city_id = public.current_city_id()
        )
        or (
          public.is_municipal_official()
          and a.municipality_id is not null
          and a.municipality_id = public.current_municipality_id()
        )
      )
  );
$$;


ALTER FUNCTION "public"."can_owner_write_project_feedback"("p_project_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_public_read_aip_feedback"("p_aip_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select exists (
    select 1
    from public.aips a
    where a.id = p_aip_id
      and a.status = 'published'
      and public.can_read_aip(a.id)
  );
$$;


ALTER FUNCTION "public"."can_public_read_aip_feedback"("p_aip_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_public_read_project_feedback"("p_project_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select exists (
    select 1
    from public.projects pr
    join public.aips a on a.id = pr.aip_id
    where pr.id = p_project_id
      and a.status = 'published'
      and public.can_read_aip(a.id)
  );
$$;


ALTER FUNCTION "public"."can_public_read_project_feedback"("p_project_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_read_aip"("p_aip_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select exists (
    select 1
    from public.aips a
    where a.id = p_aip_id
      and (
        a.status <> 'draft'
        or (
          public.is_active_auth()
          and (
            public.is_admin()
            or (
              public.is_barangay_official()
              and a.barangay_id is not null
              and a.barangay_id = public.current_barangay_id()
            )
            or (
              public.is_city_official()
              and a.city_id is not null
              and a.city_id = public.current_city_id()
            )
            or (
              public.is_municipal_official()
              and a.municipality_id is not null
              and a.municipality_id = public.current_municipality_id()
            )
          )
        )
      )
  );
$$;


ALTER FUNCTION "public"."can_read_aip"("p_aip_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_read_project"("p_project_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select exists (
    select 1
    from public.projects pr
    where pr.id = p_project_id
      and public.can_read_aip(pr.aip_id)
  );
$$;


ALTER FUNCTION "public"."can_read_project"("p_project_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_read_published_project_update"("p_project_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select exists (
    select 1
    from public.projects pr
    join public.aips a on a.id = pr.aip_id
    where pr.id = p_project_id
      and a.status = 'published'
      and public.can_read_aip(a.id)
  );
$$;


ALTER FUNCTION "public"."can_read_published_project_update"("p_project_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_reviewer_write_aip_feedback"("p_aip_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select exists (
    select 1
    from public.aips a
    where a.id = p_aip_id
      and public.is_active_auth()
      and a.status <> 'draft'
      and (
        (
          public.is_city_official()
          and (
            (a.city_id is not null and a.city_id = public.current_city_id())
            or (a.barangay_id is not null and public.barangay_in_my_city(a.barangay_id))
          )
        )
        or (
          public.is_municipal_official()
          and (
            (a.municipality_id is not null and a.municipality_id = public.current_municipality_id())
            or (a.barangay_id is not null and public.barangay_in_my_municipality(a.barangay_id))
          )
        )
      )
  );
$$;


ALTER FUNCTION "public"."can_reviewer_write_aip_feedback"("p_aip_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_upload_aip_pdf"("p_aip_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select exists (
    select 1
    from public.aips a
    where a.id = p_aip_id
      and (
        public.is_admin()
        or (
          a.status in ('draft','for_revision')
          and (
            (
              public.is_barangay_official()
              and a.barangay_id is not null
              and a.barangay_id = public.current_barangay_id()
              and public.can_manage_barangay_aip(a.id)
            )
            or
            (public.is_city_official() and a.city_id is not null and a.city_id = public.current_city_id())
            or
            (public.is_municipal_official() and a.municipality_id is not null and a.municipality_id = public.current_municipality_id())
          )
        )
      )
  );
$$;


ALTER FUNCTION "public"."can_upload_aip_pdf"("p_aip_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_write_published_aip"("p_aip_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select exists (
    select 1
    from public.aips a
    where a.id = p_aip_id
      and a.status = 'published'
      and public.is_active_auth()
      and (
        public.is_admin()
        or (
          public.is_barangay_official()
          and a.barangay_id is not null
          and a.barangay_id = public.current_barangay_id()
        )
        or (
          public.is_city_official()
          and a.city_id is not null
          and a.city_id = public.current_city_id()
        )
      )
  );
$$;


ALTER FUNCTION "public"."can_write_published_aip"("p_aip_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_write_published_project"("p_project_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select exists (
    select 1
    from public.projects pr
    where pr.id = p_project_id
      and public.can_write_published_aip(pr.aip_id)
  );
$$;


ALTER FUNCTION "public"."can_write_published_project"("p_project_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_write_published_project_update"("p_project_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select public.can_write_published_project(p_project_id);
$$;


ALTER FUNCTION "public"."can_write_published_project_update"("p_project_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."chat_sessions_touch_last_message_at"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
begin
  update public.chat_sessions
     set last_message_at = greatest(coalesce(last_message_at, new.created_at), new.created_at),
         updated_at = now()
   where id = new.session_id;
  return new;
end;
$$;


ALTER FUNCTION "public"."chat_sessions_touch_last_message_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_aip_review"("p_aip_id" "uuid") RETURNS TABLE("aip_id" "uuid", "reviewer_id" "uuid", "status" "public"."aip_status")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_aip public.aips%rowtype;
  v_latest record;
  v_actor_id uuid;
  v_has_latest boolean := false;
begin
  if p_aip_id is null then
    raise exception 'AIP id is required.';
  end if;

  if not public.is_active_auth() then
    raise exception 'Unauthorized.';
  end if;

  if not (public.is_admin() or public.is_city_official()) then
    raise exception 'Unauthorized.';
  end if;

  v_actor_id := public.current_user_id();
  if v_actor_id is null then
    raise exception 'Unauthorized.';
  end if;

  select *
    into v_aip
  from public.aips
  where id = p_aip_id
  for update;

  if not found then
    raise exception 'AIP not found.';
  end if;

  if v_aip.barangay_id is null then
    raise exception 'AIP is not a barangay submission.';
  end if;

  if v_aip.status not in ('pending_review', 'under_review') then
    raise exception 'AIP is not available for review claim.';
  end if;

  if not public.is_admin() and not public.barangay_in_my_city(v_aip.barangay_id) then
    raise exception 'AIP is outside jurisdiction.';
  end if;

  select r.aip_id, r.reviewer_id, r.action, r.created_at, r.id
    into v_latest
  from public.aip_reviews r
  where r.aip_id = p_aip_id
  order by r.created_at desc, r.id desc
  limit 1;
  v_has_latest := found;

  if v_has_latest
     and v_latest.action = 'claim_review'
     and v_latest.reviewer_id <> v_actor_id
     and not public.is_admin() then
    raise exception 'This AIP is assigned to another reviewer.';
  end if;

  if v_aip.status = 'pending_review' then
    update public.aips
    set status = 'under_review'
    where id = v_aip.id;
    v_aip.status := 'under_review';
  end if;

  if not v_has_latest
     or v_latest.action <> 'claim_review'
     or v_latest.reviewer_id <> v_actor_id then
    insert into public.aip_reviews (aip_id, action, note, reviewer_id)
    values (v_aip.id, 'claim_review', null, v_actor_id);
  end if;

  return query
  select v_aip.id, v_actor_id, v_aip.status;
end;
$$;


ALTER FUNCTION "public"."claim_aip_review"("p_aip_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compare_fiscal_year_totals"("p_year_a" integer, "p_year_b" integer, "p_barangay_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("year_a_total" numeric, "year_b_total" numeric, "delta" numeric)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  with filtered as (
    select
      li.fiscal_year,
      coalesce(li.total, 0) as total_value
    from public.aip_line_items li
    join public.aips a on a.id = li.aip_id
    where a.status = 'published'
      and li.fiscal_year in (p_year_a, p_year_b)
      and (p_barangay_id is null or li.barangay_id = p_barangay_id)
  ),
  aggregated as (
    select
      coalesce(sum(case when fiscal_year = p_year_a then total_value else 0 end), 0) as year_a_total,
      coalesce(sum(case when fiscal_year = p_year_b then total_value else 0 end), 0) as year_b_total
    from filtered
  )
  select
    aggregated.year_a_total,
    aggregated.year_b_total,
    aggregated.year_b_total - aggregated.year_a_total as delta
  from aggregated;
$$;


ALTER FUNCTION "public"."compare_fiscal_year_totals"("p_year_a" integer, "p_year_b" integer, "p_barangay_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compare_fiscal_year_totals_for_barangays"("p_year_a" integer, "p_year_b" integer, "p_barangay_ids" "uuid"[] DEFAULT NULL::"uuid"[]) RETURNS TABLE("year_a_total" numeric, "year_b_total" numeric, "delta" numeric)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  with filtered as (
    select
      li.fiscal_year,
      coalesce(li.total, 0) as total_value
    from public.aip_line_items li
    join public.aips a on a.id = li.aip_id
    where a.status = 'published'
      and li.fiscal_year in (p_year_a, p_year_b)
      and (
        p_barangay_ids is null
        or cardinality(p_barangay_ids) = 0
        or li.barangay_id = any(p_barangay_ids)
      )
  ),
  aggregated as (
    select
      coalesce(sum(case when fiscal_year = p_year_a then total_value else 0 end), 0) as year_a_total,
      coalesce(sum(case when fiscal_year = p_year_b then total_value else 0 end), 0) as year_b_total
    from filtered
  )
  select
    aggregated.year_a_total,
    aggregated.year_b_total,
    aggregated.year_b_total - aggregated.year_a_total as delta
  from aggregated;
$$;


ALTER FUNCTION "public"."compare_fiscal_year_totals_for_barangays"("p_year_a" integer, "p_year_b" integer, "p_barangay_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."consume_chat_quota"("p_user_id" "uuid", "p_per_hour" integer DEFAULT 20, "p_per_day" integer DEFAULT 200, "p_route" "text" DEFAULT 'barangay_chat_message'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_now timestamptz := now();
  v_hour_count int := 0;
  v_day_count int := 0;
  v_remaining_hour int := 0;
  v_remaining_day int := 0;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  if p_per_hour < 1 or p_per_hour > 100000 then
    raise exception 'p_per_hour must be between 1 and 100000';
  end if;

  if p_per_day < 1 or p_per_day > 100000 then
    raise exception 'p_per_day must be between 1 and 100000';
  end if;

  select count(*)::int
    into v_hour_count
  from public.chat_rate_events
  where user_id = p_user_id
    and event_status = 'accepted'
    and created_at >= v_now - interval '1 hour';

  select count(*)::int
    into v_day_count
  from public.chat_rate_events
  where user_id = p_user_id
    and event_status = 'accepted'
    and created_at >= date_trunc('day', v_now);

  if v_hour_count >= p_per_hour then
    insert into public.chat_rate_events (user_id, route, event_status)
    values (p_user_id, coalesce(nullif(trim(p_route), ''), 'barangay_chat_message'), 'rejected_hour');

    return jsonb_build_object(
      'allowed', false,
      'reason', 'hour_limit',
      'remaining_hour', 0,
      'remaining_day', greatest(0, p_per_day - v_day_count)
    );
  end if;

  if v_day_count >= p_per_day then
    insert into public.chat_rate_events (user_id, route, event_status)
    values (p_user_id, coalesce(nullif(trim(p_route), ''), 'barangay_chat_message'), 'rejected_day');

    return jsonb_build_object(
      'allowed', false,
      'reason', 'day_limit',
      'remaining_hour', greatest(0, p_per_hour - v_hour_count),
      'remaining_day', 0
    );
  end if;

  insert into public.chat_rate_events (user_id, route, event_status)
  values (p_user_id, coalesce(nullif(trim(p_route), ''), 'barangay_chat_message'), 'accepted');

  v_remaining_hour := greatest(0, p_per_hour - (v_hour_count + 1));
  v_remaining_day := greatest(0, p_per_day - (v_day_count + 1));

  return jsonb_build_object(
    'allowed', true,
    'reason', 'ok',
    'remaining_hour', v_remaining_hour,
    'remaining_day', v_remaining_day
  );
end;
$$;


ALTER FUNCTION "public"."consume_chat_quota"("p_user_id" "uuid", "p_per_hour" integer, "p_per_day" integer, "p_route" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_auth_role"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select (select auth.role());
$$;


ALTER FUNCTION "public"."current_auth_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_barangay_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select p.barangay_id
  from public.profiles p
  where p.id = (select auth.uid());
$$;


ALTER FUNCTION "public"."current_barangay_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_city_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select p.city_id
  from public.profiles p
  where p.id = (select auth.uid());
$$;


ALTER FUNCTION "public"."current_city_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_municipality_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select p.municipality_id
  from public.profiles p
  where p.id = (select auth.uid());
$$;


ALTER FUNCTION "public"."current_municipality_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_role"() RETURNS "public"."role_type"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select p.role
  from public.profiles p
  where p.id = (select auth.uid());
$$;


ALTER FUNCTION "public"."current_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_role_code"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select p.role::text
  from public.profiles p
  where p.id = public.current_user_id();
$$;


ALTER FUNCTION "public"."current_role_code"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_user_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select (select auth.uid());
$$;


ALTER FUNCTION "public"."current_user_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."dispatch_embed_categorize_for_aip"("p_aip_id" "uuid") RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
declare
  v_aip public.aips%rowtype;
  v_url text := nullif(current_setting('app.embed_categorize_url', true), '');
  v_secret text := null;
  v_audience text := nullif(current_setting('app.embed_categorize_audience', true), '');
  v_scope_type text := 'unknown';
  v_scope_id uuid := null;
  v_job_request_id uuid := extensions.gen_random_uuid();
  v_job_ts text := floor(extract(epoch from clock_timestamp()))::bigint::text;
  v_job_nonce text := extensions.gen_random_uuid()::text;
  v_payload jsonb;
  v_payload_text text;
  v_job_sig text;
  v_http_request_id bigint := null;
begin
  -- Hosted-safe fallback: app.settings + app.embed_categorize_url()
  if v_url is null then
    begin
      select nullif(app.embed_categorize_url(), '') into v_url;
    exception
      when undefined_function or invalid_schema_name then
        v_url := null;
      when others then
        v_url := null;
    end;
  end if;

  if v_audience is null then
    begin
      select nullif(s.value, '')
      into v_audience
      from app.settings s
      where s.key = 'embed_categorize_audience'
      limit 1;
    exception
      when undefined_table or invalid_schema_name then
        v_audience := null;
      when others then
        v_audience := null;
    end;
  end if;

  if v_audience is null or btrim(v_audience) = '' then
    v_audience := 'embed-categorize-dispatcher';
  end if;

  select *
  into v_aip
  from public.aips
  where id = p_aip_id;

  if not found then
    raise warning 'dispatch_embed_categorize_for_aip aip % not found', p_aip_id;
    return null;
  end if;

  begin
    select ds.decrypted_secret
    into v_secret
    from vault.decrypted_secrets ds
    where ds.name = 'embed_categorize_job_secret'
    order by ds.created_at desc nulls last
    limit 1;
  exception
    when others then
      v_secret := null;
  end;

  if v_secret is null or btrim(v_secret) = '' then
    v_secret := current_setting('app.embed_categorize_secret', true);
  end if;

  if v_aip.barangay_id is not null then
    v_scope_type := 'barangay';
    v_scope_id := v_aip.barangay_id;
  elsif v_aip.city_id is not null then
    v_scope_type := 'city';
    v_scope_id := v_aip.city_id;
  elsif v_aip.municipality_id is not null then
    v_scope_type := 'municipality';
    v_scope_id := v_aip.municipality_id;
  end if;

  if v_url is null or btrim(v_url) = '' then
    raise warning 'dispatch_embed_categorize_for_aip missing app.embed_categorize_url/app.embed_categorize_url() for aip %', p_aip_id;
    return null;
  end if;

  if v_secret is null or btrim(v_secret) = '' then
    raise warning 'dispatch_embed_categorize_for_aip missing secret for aip %', p_aip_id;
    return null;
  end if;

  v_payload := jsonb_build_object(
    'aip_id', v_aip.id,
    'request_id', v_job_request_id::text,
    'published_at', v_aip.published_at,
    'fiscal_year', v_aip.fiscal_year,
    'scope_type', v_scope_type,
    'scope_id', v_scope_id,
    'barangay_id', v_aip.barangay_id,
    'city_id', v_aip.city_id,
    'municipality_id', v_aip.municipality_id
  );

  -- Keep canonical payload identical to function-side verifier.
  v_payload_text := v_payload::text;
  v_job_sig := encode(
    extensions.hmac(
      convert_to(v_audience || '|' || v_job_ts || '|' || v_job_nonce || '|' || v_payload_text, 'utf8'),
      convert_to(v_secret, 'utf8'),
      'sha256'
    ),
    'hex'
  );

  v_http_request_id := net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Job-Ts', v_job_ts,
      'X-Job-Nonce', v_job_nonce,
      'X-Job-Sig', v_job_sig
    ),
    body := v_payload
  );

  raise log
    'dispatch_embed_categorize_for_aip queued aip %, request_id %, net_http_request_id %',
    p_aip_id,
    v_job_request_id,
    v_http_request_id;
  return v_http_request_id;
exception
  when others then
    raise warning 'dispatch_embed_categorize_for_aip failed for aip %: %', p_aip_id, sqlerrm;
    return null;
end;
$$;


ALTER FUNCTION "public"."dispatch_embed_categorize_for_aip"("p_aip_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."emit_admin_pipeline_job_failed"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_should_emit boolean := false;
  v_title text;
  v_message text;
  v_dedupe_key text;
  v_action_url text := '/admin/aip-monitoring';
  v_metadata jsonb;
begin
  if tg_op = 'INSERT' then
    v_should_emit := (new.status = 'failed');
  elsif tg_op = 'UPDATE' then
    v_should_emit := (new.status = 'failed' and old.status is distinct from new.status);
  end if;

  if not v_should_emit then
    return new;
  end if;

  v_title := 'AIP pipeline job failed';
  v_message := format(
    'Run %s failed during %s. Review monitoring for details.',
    new.id,
    coalesce(new.stage::text, 'unknown stage')
  );

  v_dedupe_key := format(
    'PIPELINE_JOB_FAILED:system:%s:%s',
    new.id,
    'status->failed'
  );

  v_metadata := jsonb_build_object(
    'run_id', new.id,
    'aip_id', new.aip_id,
    'stage', new.stage,
    'status', new.status,
    'error_code', new.error_code,
    'error_message', new.error_message,
    'trigger_op', tg_op,
    'triggered_at', now()
  );

  insert into public.notifications (
    recipient_user_id,
    recipient_role,
    scope_type,
    event_type,
    entity_type,
    entity_id,
    title,
    message,
    action_url,
    metadata,
    dedupe_key
  )
  select
    p.id,
    p.role::text,
    'admin',
    'PIPELINE_JOB_FAILED',
    'system',
    new.id,
    v_title,
    v_message,
    v_action_url,
    v_metadata,
    v_dedupe_key
  from public.profiles p
  where p.role = 'admin'::public.role_type
    and p.is_active = true
  on conflict (recipient_user_id, dedupe_key) do nothing;

  insert into public.email_outbox (
    recipient_user_id,
    to_email,
    template_key,
    subject,
    payload,
    status,
    dedupe_key
  )
  select
    p.id,
    p.email,
    'PIPELINE_JOB_FAILED',
    v_title,
    jsonb_build_object(
      'title', v_title,
      'message', v_message,
      'action_url', v_action_url,
      'event_type', 'PIPELINE_JOB_FAILED',
      'metadata', v_metadata
    ),
    'queued',
    v_dedupe_key
  from public.profiles p
  where p.role = 'admin'::public.role_type
    and p.is_active = true
    and p.email is not null
    and length(trim(p.email)) > 0
  on conflict (to_email, dedupe_key) do nothing;

  return new;
end;
$$;


ALTER FUNCTION "public"."emit_admin_pipeline_job_failed"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."emit_uploader_extraction_terminal_notifications"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_should_emit boolean := false;
  v_is_embed boolean := false;
  v_recipient_user_id uuid := null;
  v_profile record;
  v_aip record;
  v_event_type text;
  v_template_key text;
  v_title text;
  v_message text;
  v_subject text;
  v_scope_type text := 'city';
  v_action_url text := '/notifications';
  v_lgu_name text := null;
  v_barangay_name text := null;
  v_city_name text := null;
  v_entity_label text := 'AIP';
  v_occurred_at timestamptz := coalesce(new.finished_at, now());
  v_error_line text := null;
  v_excerpt text := null;
  v_dedupe_key text;
  v_in_app_enabled boolean := true;
  v_email_enabled boolean := true;
  v_metadata jsonb;
  v_template_data jsonb;
begin
  if tg_op = 'INSERT' then
    v_should_emit := (new.status in ('succeeded', 'failed'));
  elsif tg_op = 'UPDATE' then
    v_should_emit := (new.status in ('succeeded', 'failed') and old.status is distinct from new.status);
  end if;

  if not v_should_emit then
    return new;
  end if;

  v_is_embed := (new.stage = 'embed');

  select
    a.id,
    a.status,
    a.created_by,
    a.fiscal_year,
    a.barangay_id,
    a.city_id,
    a.municipality_id
  into v_aip
  from public.aips a
  where a.id = new.aip_id
  limit 1;

  if not found then
    return new;
  end if;

  if v_is_embed and v_aip.status <> 'published' then
    return new;
  end if;

  v_recipient_user_id := new.created_by;

  if v_is_embed and v_recipient_user_id is null then
    select uf.uploaded_by
    into v_recipient_user_id
    from public.uploaded_files uf
    where uf.aip_id = new.aip_id
      and uf.is_current = true
    order by uf.created_at desc, uf.id desc
    limit 1;

    if v_recipient_user_id is null then
      v_recipient_user_id := v_aip.created_by;
    end if;
  end if;

  if v_recipient_user_id is null then
    return new;
  end if;

  select
    p.id,
    p.role::text as role,
    p.email,
    p.is_active
  into v_profile
  from public.profiles p
  where p.id = v_recipient_user_id
  limit 1;

  if v_is_embed and (not found or coalesce(v_profile.is_active, false) = false) then
    v_recipient_user_id := null;

    select uf.uploaded_by
    into v_recipient_user_id
    from public.uploaded_files uf
    where uf.aip_id = new.aip_id
      and uf.is_current = true
      and uf.uploaded_by is not null
    order by uf.created_at desc, uf.id desc
    limit 1;

    if v_recipient_user_id is null then
      v_recipient_user_id := v_aip.created_by;
    end if;

    if v_recipient_user_id is null then
      return new;
    end if;

    select
      p.id,
      p.role::text as role,
      p.email,
      p.is_active
    into v_profile
    from public.profiles p
    where p.id = v_recipient_user_id
    limit 1;
  end if;

  if not found or coalesce(v_profile.is_active, false) = false then
    return new;
  end if;

  if v_aip.barangay_id is not null then
    select b.name into v_lgu_name from public.barangays b where b.id = v_aip.barangay_id limit 1;
    v_barangay_name := v_lgu_name;
  elsif v_aip.city_id is not null then
    select c.name into v_lgu_name from public.cities c where c.id = v_aip.city_id limit 1;
    v_city_name := v_lgu_name;
  elsif v_aip.municipality_id is not null then
    select m.name into v_lgu_name from public.municipalities m where m.id = v_aip.municipality_id limit 1;
  end if;

  if v_aip.fiscal_year is not null then
    v_entity_label := format('AIP FY %s', v_aip.fiscal_year);
  end if;

  if v_profile.role = 'barangay_official' then
    v_scope_type := 'barangay';
    v_action_url := format('/barangay/aips/%s?run=%s', new.aip_id, new.id);
  elsif v_profile.role in ('city_official', 'municipal_official') then
    v_scope_type := 'city';
    v_action_url := format('/city/aips/%s?run=%s', new.aip_id, new.id);
  elsif v_profile.role = 'admin' then
    v_scope_type := 'admin';
    v_action_url := format('/admin/aip-monitoring?run=%s', new.id);
  else
    v_scope_type := 'citizen';
    v_action_url := '/notifications';
  end if;

  if new.status = 'succeeded' then
    if v_is_embed then
      if v_scope_type = 'barangay' then
        v_action_url := format('/barangay/aips/%s', new.aip_id);
      elsif v_scope_type = 'city' then
        v_action_url := format('/city/aips/%s', new.aip_id);
      elsif v_scope_type = 'admin' then
        v_action_url := '/admin/aip-monitoring';
      else
        v_action_url := '/notifications';
      end if;

      v_event_type := 'AIP_EMBED_SUCCEEDED';
      v_template_key := 'aip_embed_succeeded';
      v_title := 'AIP embedding completed';
      v_message := 'Search indexing completed successfully for your published AIP.';
      v_subject := 'OpenAIP - AIP search indexing completed';
      v_excerpt := 'Search indexing completed successfully.';
      v_dedupe_key := format(
        'AIP_EMBED_SUCCEEDED:aip:%s:run:%s:status->succeeded',
        new.aip_id,
        new.id
      );
    else
      v_event_type := 'AIP_EXTRACTION_SUCCEEDED';
      v_template_key := 'aip_extraction_succeeded';
      v_title := 'AIP processing completed';
      v_message := 'Your AIP upload was processed successfully.';
      v_subject := 'OpenAIP - AIP upload processing completed';
      v_excerpt := 'Extraction and validation completed successfully.';
      v_dedupe_key := format(
        'AIP_EXTRACTION_SUCCEEDED:aip:%s:run:%s:status->succeeded',
        new.aip_id,
        new.id
      );
    end if;
  else
    v_error_line := split_part(coalesce(new.error_message, ''), E'\n', 1);
    v_error_line := trim(regexp_replace(v_error_line, '[[:space:]]+', ' ', 'g'));
    if v_error_line = '' then
      v_error_line := null;
    end if;
    if v_error_line is not null and length(v_error_line) > 120 then
      v_error_line := rtrim(substr(v_error_line, 1, 117)) || '...';
    end if;
    v_excerpt := coalesce(v_error_line, 'No error details were provided.');

    if v_is_embed then
      if v_scope_type = 'barangay' then
        v_action_url := format('/barangay/aips/%s', new.aip_id);
      elsif v_scope_type = 'city' then
        v_action_url := format('/city/aips/%s', new.aip_id);
      elsif v_scope_type = 'admin' then
        v_action_url := '/admin/aip-monitoring';
      else
        v_action_url := '/notifications';
      end if;

      v_event_type := 'AIP_EMBED_FAILED';
      v_template_key := 'aip_embed_failed';
      v_title := 'AIP embedding failed';
      v_message := 'AIP search indexing failed. Please review and retry.';
      v_subject := 'OpenAIP - AIP search indexing failed';
      v_dedupe_key := format(
        'AIP_EMBED_FAILED:aip:%s:run:%s:status->failed',
        new.aip_id,
        new.id
      );
    else
      v_event_type := 'AIP_EXTRACTION_FAILED';
      v_template_key := 'aip_extraction_failed';
      v_title := 'AIP processing failed';
      v_message := 'AIP processing failed. Please review and retry.';
      v_subject := 'OpenAIP - AIP upload processing failed';
      v_dedupe_key := format(
        'AIP_EXTRACTION_FAILED:aip:%s:run:%s:status->failed',
        new.aip_id,
        new.id
      );
    end if;
  end if;

  select
    np.in_app_enabled,
    np.email_enabled
  into
    v_in_app_enabled,
    v_email_enabled
  from public.notification_preferences np
  where np.user_id = v_profile.id
    and np.event_type = v_event_type
  limit 1;

  if not found then
    v_in_app_enabled := true;
    v_email_enabled := true;
  end if;

  v_metadata := jsonb_strip_nulls(
    jsonb_build_object(
      'aip_id', new.aip_id,
      'run_id', new.id,
      'stage', new.stage,
      'status', new.status,
      'error_code', new.error_code,
      'error_message', new.error_message,
      'fiscal_year', v_aip.fiscal_year,
      'lgu_name', v_lgu_name,
      'barangay_name', v_barangay_name,
      'city_name', v_city_name,
      'scope_type', v_scope_type,
      'entity_type', 'aip',
      'entity_label', v_entity_label,
      'occurred_at', v_occurred_at,
      'excerpt', v_excerpt,
      'action_url', v_action_url
    )
  );

  v_template_data := jsonb_strip_nulls(
    jsonb_build_object(
      'app_name', 'OpenAIP',
      'event_type', v_event_type,
      'scope_type', v_scope_type,
      'entity_type', 'aip',
      'entity_id', new.aip_id,
      'aip_id', new.aip_id,
      'run_id', new.id,
      'stage', new.stage,
      'status', new.status,
      'error_code', new.error_code,
      'error_message', new.error_message,
      'fiscal_year', v_aip.fiscal_year,
      'lgu_name', v_lgu_name,
      'barangay_name', v_barangay_name,
      'city_name', v_city_name,
      'entity_label', v_entity_label,
      'occurred_at', v_occurred_at,
      'excerpt', v_excerpt,
      'action_url', v_action_url
    )
  );

  if coalesce(v_in_app_enabled, true) then
    insert into public.notifications (
      recipient_user_id,
      recipient_role,
      scope_type,
      event_type,
      entity_type,
      entity_id,
      title,
      message,
      action_url,
      metadata,
      dedupe_key
    )
    values (
      v_profile.id,
      v_profile.role,
      v_scope_type,
      v_event_type,
      'aip',
      new.aip_id,
      v_title,
      v_message,
      v_action_url,
      v_metadata,
      v_dedupe_key
    )
    on conflict (recipient_user_id, dedupe_key) do nothing;
  end if;

  if coalesce(v_email_enabled, true)
     and v_profile.email is not null
     and length(trim(v_profile.email)) > 0 then
    insert into public.email_outbox (
      recipient_user_id,
      to_email,
      template_key,
      subject,
      payload,
      status,
      dedupe_key
    )
    values (
      v_profile.id,
      v_profile.email,
      v_template_key,
      v_subject,
      jsonb_build_object(
        'title', v_title,
        'message', v_message,
        'action_url', v_action_url,
        'notification_ref', v_dedupe_key,
        'event_type', v_event_type,
        'scope_type', v_scope_type,
        'entity_type', 'aip',
        'entity_id', new.aip_id,
        'template_data', v_template_data,
        'metadata', v_metadata
      ),
      'queued',
      v_dedupe_key
    )
    on conflict (to_email, dedupe_key) do nothing;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."emit_uploader_extraction_terminal_notifications"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_city_region_consistency"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_region_id uuid;
begin
  if new.province_id is null then
    return new;
  end if;

  select p.region_id
    into v_region_id
  from public.provinces p
  where p.id = new.province_id;

  if v_region_id is null then
    raise exception 'cities.province_id must reference an existing province';
  end if;

  if new.region_id <> v_region_id then
    raise exception 'cities.region_id must match the region of its province';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."enforce_city_region_consistency"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_profile_update_rules"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_uid uuid;
  v_is_admin boolean;
begin
  v_uid := (select auth.uid());
  v_is_admin := (public.current_role() = 'admin'::public.role_type);

  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if v_is_admin then
    return new;
  end if;

  if old.id <> v_uid then
    raise exception 'Not permitted';
  end if;

  if new.role is distinct from old.role then
    raise exception 'role is admin-managed';
  end if;

  if new.email is distinct from old.email then
    raise exception 'email is admin-managed';
  end if;

  if new.is_active is distinct from old.is_active then
    raise exception 'is_active is admin-managed';
  end if;

  -- Citizen self-service scope update:
  -- app writes barangay scope and keeps city/municipality null for citizen profiles.
  if old.role = 'citizen'::public.role_type then
    if new.city_id is not null or new.municipality_id is not null then
      raise exception 'scope is admin-managed';
    end if;
    return new;
  end if;

  if new.barangay_id is distinct from old.barangay_id
     or new.city_id is distinct from old.city_id
     or new.municipality_id is distinct from old.municipality_id then
    raise exception 'scope is admin-managed';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."enforce_profile_update_rules"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."extraction_artifacts_delete_storage_object"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'storage'
    AS $$
declare
  v_storage_path text;
  v_bucket_id text;
begin
  if old.artifact_json is null or jsonb_typeof(old.artifact_json) <> 'object' then
    return old;
  end if;

  v_storage_path := nullif(btrim(old.artifact_json ->> 'storage_path'), '');
  if v_storage_path is null then
    return old;
  end if;

  v_bucket_id := coalesce(
    nullif(btrim(old.artifact_json ->> 'storage_bucket'), ''),
    nullif(btrim(old.artifact_json ->> 'storage_bucket_id'), ''),
    nullif(btrim(old.artifact_json ->> 'bucket_id'), ''),
    nullif(btrim(old.artifact_json ->> 'bucket'), ''),
    'aip-artifacts'
  );

  begin
    delete from storage.objects
    where bucket_id = v_bucket_id
      and name = v_storage_path;
  exception
    when others then
      if position('Direct deletion from storage tables is not allowed' in sqlerrm) > 0 then
        null;
      else
        raise;
      end if;
  end;

  return old;
end;
$$;


ALTER FUNCTION "public"."extraction_artifacts_delete_storage_object"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."feedback_enforce_parent_target"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  p record;
begin
  if new.parent_feedback_id is null then
    return new;
  end if;

  select target_type, aip_id, project_id
    into p
  from public.feedback
  where id = new.parent_feedback_id;

  if not found then
    raise exception 'parent_feedback_id does not exist';
  end if;

  if new.target_type is distinct from p.target_type
     or new.aip_id is distinct from p.aip_id
     or new.project_id is distinct from p.project_id then
    raise exception 'reply feedback must match parent target';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."feedback_enforce_parent_target"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_top_projects"("p_limit" integer DEFAULT 10, "p_fiscal_year" integer DEFAULT NULL::integer, "p_barangay_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("line_item_id" "uuid", "aip_id" "uuid", "fiscal_year" integer, "barangay_id" "uuid", "aip_ref_code" "text", "program_project_title" "text", "fund_source" "text", "start_date" "date", "end_date" "date", "total" numeric, "page_no" integer, "row_no" integer, "table_no" integer)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select
    li.id as line_item_id,
    li.aip_id,
    li.fiscal_year,
    li.barangay_id,
    li.aip_ref_code,
    li.program_project_title,
    li.fund_source,
    li.start_date,
    li.end_date,
    li.total,
    li.page_no,
    li.row_no,
    li.table_no
  from public.aip_line_items li
  join public.aips a on a.id = li.aip_id
  where a.status = 'published'
    and li.total is not null
    and (p_fiscal_year is null or li.fiscal_year = p_fiscal_year)
    and (p_barangay_id is null or li.barangay_id = p_barangay_id)
  order by li.total desc nulls last
  limit greatest(1, least(coalesce(p_limit, 10), 50));
$$;


ALTER FUNCTION "public"."get_top_projects"("p_limit" integer, "p_fiscal_year" integer, "p_barangay_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_top_projects_for_barangays"("p_limit" integer DEFAULT 10, "p_fiscal_year" integer DEFAULT NULL::integer, "p_barangay_ids" "uuid"[] DEFAULT NULL::"uuid"[]) RETURNS TABLE("line_item_id" "uuid", "aip_id" "uuid", "fiscal_year" integer, "barangay_id" "uuid", "aip_ref_code" "text", "program_project_title" "text", "fund_source" "text", "start_date" "date", "end_date" "date", "total" numeric, "page_no" integer, "row_no" integer, "table_no" integer)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select
    li.id as line_item_id,
    li.aip_id,
    li.fiscal_year,
    li.barangay_id,
    li.aip_ref_code,
    li.program_project_title,
    li.fund_source,
    li.start_date,
    li.end_date,
    li.total,
    li.page_no,
    li.row_no,
    li.table_no
  from public.aip_line_items li
  join public.aips a on a.id = li.aip_id
  where a.status = 'published'
    and li.total is not null
    and (p_fiscal_year is null or li.fiscal_year = p_fiscal_year)
    and (
      p_barangay_ids is null
      or cardinality(p_barangay_ids) = 0
      or li.barangay_id = any(p_barangay_ids)
    )
  order by li.total desc nulls last
  limit greatest(1, least(coalesce(p_limit, 10), 50));
$$;


ALTER FUNCTION "public"."get_top_projects_for_barangays"("p_limit" integer, "p_fiscal_year" integer, "p_barangay_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_totals_by_fund_source"("p_fiscal_year" integer DEFAULT NULL::integer, "p_barangay_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("fund_source" "text", "fund_total" numeric, "count_items" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select
    coalesce(nullif(trim(li.fund_source), ''), 'Unspecified') as fund_source,
    sum(coalesce(li.total, 0)) as fund_total,
    count(*) as count_items
  from public.aip_line_items li
  join public.aips a on a.id = li.aip_id
  where a.status = 'published'
    and (p_fiscal_year is null or li.fiscal_year = p_fiscal_year)
    and (p_barangay_id is null or li.barangay_id = p_barangay_id)
  group by coalesce(nullif(trim(li.fund_source), ''), 'Unspecified')
  order by fund_total desc, fund_source asc;
$$;


ALTER FUNCTION "public"."get_totals_by_fund_source"("p_fiscal_year" integer, "p_barangay_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_totals_by_fund_source_for_barangays"("p_fiscal_year" integer DEFAULT NULL::integer, "p_barangay_ids" "uuid"[] DEFAULT NULL::"uuid"[]) RETURNS TABLE("fund_source" "text", "fund_total" numeric, "count_items" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select
    coalesce(nullif(trim(li.fund_source), ''), 'Unspecified') as fund_source,
    sum(coalesce(li.total, 0)) as fund_total,
    count(*) as count_items
  from public.aip_line_items li
  join public.aips a on a.id = li.aip_id
  where a.status = 'published'
    and (p_fiscal_year is null or li.fiscal_year = p_fiscal_year)
    and (
      p_barangay_ids is null
      or cardinality(p_barangay_ids) = 0
      or li.barangay_id = any(p_barangay_ids)
    )
  group by coalesce(nullif(trim(li.fund_source), ''), 'Unspecified')
  order by fund_total desc, fund_source asc;
$$;


ALTER FUNCTION "public"."get_totals_by_fund_source_for_barangays"("p_fiscal_year" integer, "p_barangay_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_totals_by_sector"("p_fiscal_year" integer DEFAULT NULL::integer, "p_barangay_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("sector_code" "text", "sector_name" "text", "sector_total" numeric, "count_items" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select
    li.sector_code,
    li.sector_name,
    sum(coalesce(li.total, 0)) as sector_total,
    count(*) as count_items
  from public.aip_line_items li
  join public.aips a on a.id = li.aip_id
  where a.status = 'published'
    and (p_fiscal_year is null or li.fiscal_year = p_fiscal_year)
    and (p_barangay_id is null or li.barangay_id = p_barangay_id)
  group by li.sector_code, li.sector_name
  order by sector_total desc, li.sector_name asc nulls last;
$$;


ALTER FUNCTION "public"."get_totals_by_sector"("p_fiscal_year" integer, "p_barangay_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_totals_by_sector_for_barangays"("p_fiscal_year" integer DEFAULT NULL::integer, "p_barangay_ids" "uuid"[] DEFAULT NULL::"uuid"[]) RETURNS TABLE("sector_code" "text", "sector_name" "text", "sector_total" numeric, "count_items" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select
    li.sector_code,
    li.sector_name,
    sum(coalesce(li.total, 0)) as sector_total,
    count(*) as count_items
  from public.aip_line_items li
  join public.aips a on a.id = li.aip_id
  where a.status = 'published'
    and (p_fiscal_year is null or li.fiscal_year = p_fiscal_year)
    and (
      p_barangay_ids is null
      or cardinality(p_barangay_ids) = 0
      or li.barangay_id = any(p_barangay_ids)
    )
  group by li.sector_code, li.sector_name
  order by sector_total desc, li.sector_name asc nulls last;
$$;


ALTER FUNCTION "public"."get_totals_by_sector_for_barangays"("p_fiscal_year" integer, "p_barangay_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."inspect_required_db_hardening"() RETURNS TABLE("check_key" "text", "object_type" "text", "object_name" "text", "is_present" boolean, "expectation" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  with fn_oids as (
    select
      to_regprocedure('public.can_manage_barangay_aip(uuid)') as can_manage_oid,
      to_regprocedure('public.can_edit_aip(uuid)') as can_edit_oid,
      to_regprocedure('public.can_upload_aip_pdf(uuid)') as can_upload_oid,
      to_regprocedure('public.consume_chat_quota(uuid,integer,integer,text)') as consume_quota_oid
  ),
  fn_src as (
    select
      lower(coalesce(edit_proc.prosrc, '')) as can_edit_src,
      lower(coalesce(upload_proc.prosrc, '')) as can_upload_src
    from fn_oids f
    left join pg_proc edit_proc
      on edit_proc.oid = f.can_edit_oid
    left join pg_proc upload_proc
      on upload_proc.oid = f.can_upload_oid
  ),
  aip_policy as (
    select
      lower(coalesce(pg_get_expr(pol.polqual, pol.polrelid), '')) as policy_using,
      lower(coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '')) as policy_with_check
    from pg_policy pol
    join pg_class cls
      on cls.oid = pol.polrelid
    join pg_namespace nsp
      on nsp.oid = cls.relnamespace
    where nsp.nspname = 'public'
      and cls.relname = 'aips'
      and pol.polname = 'aips_update_policy'
    limit 1
  ),
  uploaded_files_policy as (
    select
      lower(coalesce(pg_get_expr(pol.polqual, pol.polrelid), '')) as policy_using
    from pg_policy pol
    join pg_class cls
      on cls.oid = pol.polrelid
    join pg_namespace nsp
      on nsp.oid = cls.relnamespace
    where nsp.nspname = 'public'
      and cls.relname = 'uploaded_files'
      and pol.polname = 'uploaded_files_select_policy'
    limit 1
  ),
  chat_rate_status_constraint as (
    select exists (
      select 1
      from pg_constraint con
      join pg_class cls
        on cls.oid = con.conrelid
      join pg_namespace nsp
        on nsp.oid = cls.relnamespace
      where nsp.nspname = 'public'
        and cls.relname = 'chat_rate_events'
        and con.conname = 'chat_rate_events_event_status_check'
    ) as constraint_exists
  )
  select
    'can_manage_barangay_aip_exists'::text as check_key,
    'function'::text as object_type,
    'public.can_manage_barangay_aip(uuid)'::text as object_name,
    (select can_manage_oid is not null from fn_oids) as is_present,
    'Function exists for barangay uploader workflow lock.'::text as expectation
  union all
  select
    'can_edit_aip_uses_uploader_lock',
    'function_definition',
    'public.can_edit_aip(uuid)',
    (select can_edit_src like '%public.can_manage_barangay_aip(a.id)%' from fn_src),
    'Function definition must call public.can_manage_barangay_aip(a.id).'
  union all
  select
    'can_upload_aip_pdf_uses_uploader_lock',
    'function_definition',
    'public.can_upload_aip_pdf(uuid)',
    (select can_upload_src like '%public.can_manage_barangay_aip(a.id)%' from fn_src),
    'Function definition must call public.can_manage_barangay_aip(a.id).'
  union all
  select
    'aips_update_policy_uses_uploader_lock',
    'policy_definition',
    'public.aips.aips_update_policy',
    (
      select
        policy_using like '%can_manage_barangay_aip(%'
        and policy_with_check like '%can_manage_barangay_aip(%'
      from aip_policy
    ),
    'RLS policy using/with check must require public.can_manage_barangay_aip(id).'
  union all
  select
    'uploaded_files_select_policy_uses_can_read_aip',
    'policy_definition',
    'public.uploaded_files.uploaded_files_select_policy',
    (
      select policy_using like '%can_read_aip(%'
      from uploaded_files_policy
    ),
    'RLS policy must use public.can_read_aip(a.id) for draft read path.'
  union all
  select
    'chat_rate_events_status_constraint_exists',
    'constraint',
    'public.chat_rate_events.chat_rate_events_event_status_check',
    (select constraint_exists from chat_rate_status_constraint),
    'Constraint must exist for accepted/rejected_minute/rejected_hour/rejected_day statuses.'
  union all
  select
    'consume_chat_quota_exists',
    'function',
    'public.consume_chat_quota(uuid, int, int, text)',
    (select consume_quota_oid is not null from fn_oids),
    'Function must exist for chat quota enforcement.'
  ;
$$;


ALTER FUNCTION "public"."inspect_required_db_hardening"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_active_auth"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select (select auth.uid()) is not null;
$$;


ALTER FUNCTION "public"."is_active_auth"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select public.current_role() = 'admin'::public.role_type;
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_barangay_official"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select public.current_role() = 'barangay_official'::public.role_type;
$$;


ALTER FUNCTION "public"."is_barangay_official"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_citizen"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select public.current_role() = 'citizen'::public.role_type;
$$;


ALTER FUNCTION "public"."is_citizen"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_city_official"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select public.current_role() = 'city_official'::public.role_type;
$$;


ALTER FUNCTION "public"."is_city_official"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_municipal_official"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select public.current_role() = 'municipal_official'::public.role_type;
$$;


ALTER FUNCTION "public"."is_municipal_official"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_activity"("p_action" "text", "p_entity_table" "text" DEFAULT NULL::"text", "p_entity_id" "uuid" DEFAULT NULL::"uuid", "p_region_id" "uuid" DEFAULT NULL::"uuid", "p_province_id" "uuid" DEFAULT NULL::"uuid", "p_city_id" "uuid" DEFAULT NULL::"uuid", "p_municipality_id" "uuid" DEFAULT NULL::"uuid", "p_barangay_id" "uuid" DEFAULT NULL::"uuid", "p_metadata" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_id uuid;
  v_actor uuid;
  v_actor_role text;
begin
  if p_action is null or length(p_action) = 0 or length(p_action) > 80 then
    raise exception 'invalid action (1..80 chars required)';
  end if;

  if p_entity_table is not null and length(p_entity_table) > 80 then
    raise exception 'invalid entity_table (<= 80 chars)';
  end if;

  v_actor := public.current_user_id();
  v_actor_role := public.current_role_code();

  if not public.is_active_auth() then
    raise exception 'not authorized';
  end if;

  if not (
    public.is_admin()
    or public.is_barangay_official()
    or public.is_city_official()
    or public.is_municipal_official()
    or (
      public.is_citizen()
      and p_entity_table = 'feedback'
      and p_action in ('feedback_created', 'feedback_updated', 'feedback_deleted')
    )
  ) then
    raise exception 'not authorized';
  end if;

  insert into public.activity_log (
    actor_id,
    actor_role,
    action,
    entity_table,
    entity_id,
    region_id,
    province_id,
    city_id,
    municipality_id,
    barangay_id,
    metadata
  ) values (
    v_actor,
    v_actor_role,
    p_action,
    p_entity_table,
    p_entity_id,
    p_region_id,
    p_province_id,
    p_city_id,
    p_municipality_id,
    p_barangay_id,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$$;


ALTER FUNCTION "public"."log_activity"("p_action" "text", "p_entity_table" "text", "p_entity_id" "uuid", "p_region_id" "uuid", "p_province_id" "uuid", "p_city_id" "uuid", "p_municipality_id" "uuid", "p_barangay_id" "uuid", "p_metadata" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."match_aip_line_items"("p_query_embedding" "extensions"."vector", "p_match_count" integer DEFAULT 20, "p_fiscal_year" integer DEFAULT NULL::integer, "p_barangay_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("line_item_id" "uuid", "aip_id" "uuid", "fiscal_year" integer, "barangay_id" "uuid", "aip_ref_code" "text", "program_project_title" "text", "page_no" integer, "row_no" integer, "table_no" integer, "distance" double precision, "score" double precision)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
  select
    li.id as line_item_id,
    li.aip_id,
    li.fiscal_year,
    li.barangay_id,
    li.aip_ref_code,
    li.program_project_title,
    li.page_no,
    li.row_no,
    li.table_no,
    (e.embedding OPERATOR(extensions.<->) p_query_embedding) as distance,
    1.0 / (1.0 + (e.embedding OPERATOR(extensions.<->) p_query_embedding)) as score
  from public.aip_line_items li
  join public.aip_line_item_embeddings e on e.line_item_id = li.id
  join public.aips a on a.id = li.aip_id
  where a.status = 'published'
    and (p_fiscal_year is null or li.fiscal_year = p_fiscal_year)
    and (p_barangay_id is null or li.barangay_id = p_barangay_id)
  order by e.embedding OPERATOR(extensions.<->) p_query_embedding asc
  limit greatest(1, least(coalesce(p_match_count, 20), 80));
$$;


ALTER FUNCTION "public"."match_aip_line_items"("p_query_embedding" "extensions"."vector", "p_match_count" integer, "p_fiscal_year" integer, "p_barangay_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."match_artifact_chunks"("query_embedding" "extensions"."vector", "match_count" integer DEFAULT 5, "filter_artifact_type" "text" DEFAULT 'categorize'::"text") RETURNS TABLE("artifact_id" "uuid", "chunk_index" integer, "content" "text", "distance" double precision)
    LANGUAGE "sql" STABLE
    AS $$
  select
    ac.artifact_id,
    ac.chunk_index,
    ac.content,
    (ac.embedding <=> query_embedding) as distance
  from public.artifact_chunks ac
  where (filter_artifact_type is null or filter_artifact_type = '' or ac.artifact_type = filter_artifact_type)
  order by ac.embedding <=> query_embedding
  limit greatest(match_count, 1);
$$;


ALTER FUNCTION "public"."match_artifact_chunks"("query_embedding" "extensions"."vector", "match_count" integer, "filter_artifact_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."match_published_aip_chunks"("query_embedding" "extensions"."vector", "match_count" integer DEFAULT 8, "min_similarity" double precision DEFAULT 0.0, "scope_mode" "text" DEFAULT 'global'::"text", "own_barangay_id" "uuid" DEFAULT NULL::"uuid", "scope_targets" "jsonb" DEFAULT '[]'::"jsonb") RETURNS TABLE("source_id" "text", "chunk_id" "uuid", "content" "text", "similarity" double precision, "aip_id" "uuid", "fiscal_year" integer, "published_at" timestamp with time zone, "scope_type" "text", "scope_id" "uuid", "scope_name" "text", "metadata" "jsonb")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
with params as (
  select
    greatest(1, least(coalesce(match_count, 8), 30)) as k,
    coalesce(min_similarity, 0.0) as sim_floor,
    lower(coalesce(scope_mode, 'global')) as mode
),
targets as (
  select
    lower(nullif(item ->> 'scope_type', '')) as scope_type,
    nullif(item ->> 'scope_id', '')::uuid as scope_id
  from jsonb_array_elements(coalesce(scope_targets, '[]'::jsonb)) item
  where nullif(item ->> 'scope_id', '') is not null
),
rows_scoped as (
  select
    c.id as chunk_id,
    c.chunk_text as content,
    c.metadata,
    a.id as aip_id,
    a.fiscal_year,
    a.published_at,
    case
      when a.barangay_id is not null then 'barangay'
      when a.city_id is not null then 'city'
      when a.municipality_id is not null then 'municipality'
      else 'unknown'
    end as scope_type,
    case
      when a.barangay_id is not null then a.barangay_id
      when a.city_id is not null then a.city_id
      when a.municipality_id is not null then a.municipality_id
      else null
    end as scope_id,
    coalesce(b.name, ci.name, m.name, 'Unknown Scope') as scope_name,
    1 - (e.embedding OPERATOR(extensions.<=>) query_embedding) as similarity
  from public.aip_chunks c
  join public.aip_chunk_embeddings e on e.chunk_id = c.id
  join public.aips a on a.id = c.aip_id
  left join public.barangays b on b.id = a.barangay_id
  left join public.cities ci on ci.id = a.city_id
  left join public.municipalities m on m.id = a.municipality_id
  cross join params p
  where a.status = 'published'
    and (
      p.mode = 'global'
      or (
        p.mode = 'own_barangay'
        and own_barangay_id is not null
        and a.barangay_id = own_barangay_id
      )
      or (
        p.mode = 'named_scopes'
        and exists (
          select 1
          from targets t
          where
            (t.scope_type = 'barangay' and a.barangay_id = t.scope_id)
            or (t.scope_type = 'city' and a.city_id = t.scope_id)
            or (t.scope_type = 'municipality' and a.municipality_id = t.scope_id)
        )
      )
    )
),
ranked as (
  select *
  from rows_scoped
  where similarity >= (select sim_floor from params)
  order by similarity desc, chunk_id
  limit (select k from params)
)
select
  'S' || row_number() over (order by similarity desc, chunk_id) as source_id,
  chunk_id,
  content,
  similarity,
  aip_id,
  fiscal_year,
  published_at,
  scope_type,
  scope_id,
  scope_name,
  metadata
from ranked;
$$;


ALTER FUNCTION "public"."match_published_aip_chunks"("query_embedding" "extensions"."vector", "match_count" integer, "min_similarity" double precision, "scope_mode" "text", "own_barangay_id" "uuid", "scope_targets" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."match_published_aip_project_chunks_v2"("query_embedding" "extensions"."vector", "match_count" integer DEFAULT 4, "min_similarity" double precision DEFAULT 0.0, "scope_mode" "text" DEFAULT 'global'::"text", "own_barangay_id" "uuid" DEFAULT NULL::"uuid", "scope_targets" "jsonb" DEFAULT '[]'::"jsonb", "filter_fiscal_year" integer DEFAULT NULL::integer, "filter_scope_type" "text" DEFAULT NULL::"text", "filter_scope_name" "text" DEFAULT NULL::"text", "filter_document_type" "text" DEFAULT NULL::"text", "filter_publication_status" "text" DEFAULT 'published'::"text", "filter_office_name" "text" DEFAULT NULL::"text", "filter_theme_tags" "text"[] DEFAULT NULL::"text"[], "filter_sector_tags" "text"[] DEFAULT NULL::"text"[], "include_summary_chunks" boolean DEFAULT false) RETURNS TABLE("source_id" "text", "chunk_id" "uuid", "content" "text", "similarity" double precision, "aip_id" "uuid", "fiscal_year" integer, "published_at" timestamp with time zone, "scope_type" "text", "scope_id" "uuid", "scope_name" "text", "chunk_type" "text", "document_type" "text", "publication_status" "text", "office_name" "text", "project_ref_code" "text", "source_page" integer, "theme_tags" "text"[], "sector_tags" "text"[], "metadata" "jsonb")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
with params as (
  select
    greatest(1, least(coalesce(match_count, 4), 30)) as k,
    coalesce(min_similarity, 0.0) as sim_floor,
    lower(coalesce(scope_mode, 'global')) as mode,
    filter_fiscal_year as filter_fiscal_year,
    lower(nullif(trim(filter_scope_type), '')) as filter_scope_type,
    lower(nullif(trim(filter_scope_name), '')) as filter_scope_name,
    lower(nullif(trim(filter_document_type), '')) as filter_document_type,
    lower(coalesce(nullif(trim(filter_publication_status), ''), 'published')) as filter_publication_status,
    lower(nullif(trim(filter_office_name), '')) as filter_office_name,
    (
      select array_agg(lower(trim(tag)))
      from unnest(filter_theme_tags) tag
      where trim(tag) <> ''
    ) as filter_theme_tags,
    (
      select array_agg(lower(trim(tag)))
      from unnest(filter_sector_tags) tag
      where trim(tag) <> ''
    ) as filter_sector_tags,
    coalesce(include_summary_chunks, false) as include_summary_chunks
),
targets as (
  select
    lower(nullif(item ->> 'scope_type', '')) as scope_type,
    nullif(item ->> 'scope_id', '')::uuid as scope_id
  from jsonb_array_elements(coalesce(scope_targets, '[]'::jsonb)) item
  where nullif(item ->> 'scope_id', '') is not null
),
rows_scoped as (
  select
    c.id as chunk_id,
    c.chunk_text as content,
    c.metadata,
    c.chunk_type::text as chunk_type,
    c.document_type,
    c.publication_status,
    c.office_name,
    c.project_ref_code,
    c.source_page,
    c.theme_tags,
    c.sector_tags,
    a.id as aip_id,
    coalesce(c.fiscal_year, a.fiscal_year) as fiscal_year,
    a.published_at,
    coalesce(
      nullif(c.scope_type, ''),
      case
        when a.barangay_id is not null then 'barangay'
        when a.city_id is not null then 'city'
        when a.municipality_id is not null then 'municipality'
        else 'unknown'
      end
    ) as scope_type,
    case
      when a.barangay_id is not null then a.barangay_id
      when a.city_id is not null then a.city_id
      when a.municipality_id is not null then a.municipality_id
      else null
    end as scope_id,
    coalesce(nullif(c.scope_name, ''), b.name, ci.name, m.name, 'Unknown Scope') as scope_name,
    1 - (e.embedding operator(extensions.<=>) query_embedding) as similarity
  from public.aip_chunks c
  join public.aip_chunk_embeddings e on e.chunk_id = c.id
  join public.aips a on a.id = c.aip_id
  left join public.barangays b on b.id = a.barangay_id
  left join public.cities ci on ci.id = a.city_id
  left join public.municipalities m on m.id = a.municipality_id
  cross join params p
  where
    lower(coalesce(a.status::text, nullif(c.publication_status, ''), 'published')) = p.filter_publication_status
    and (
      c.chunk_type = 'project'::public.aip_chunk_type
      or (
        p.include_summary_chunks
        and c.chunk_type in ('section_summary'::public.aip_chunk_type, 'category_summary'::public.aip_chunk_type)
      )
    )
    and (
      p.mode = 'global'
      or (
        p.mode = 'own_barangay'
        and own_barangay_id is not null
        and a.barangay_id = own_barangay_id
      )
      or (
        p.mode = 'named_scopes'
        and exists (
          select 1
          from targets t
          where
            (t.scope_type = 'barangay' and a.barangay_id = t.scope_id)
            or (t.scope_type = 'city' and a.city_id = t.scope_id)
            or (t.scope_type = 'municipality' and a.municipality_id = t.scope_id)
        )
      )
    )
    and (
      p.filter_fiscal_year is null
      or coalesce(c.fiscal_year, a.fiscal_year) = p.filter_fiscal_year
    )
    and (
      p.filter_scope_type is null
      or lower(
        coalesce(
          nullif(c.scope_type, ''),
          case
            when a.barangay_id is not null then 'barangay'
            when a.city_id is not null then 'city'
            when a.municipality_id is not null then 'municipality'
            else 'unknown'
          end
        )
      ) = p.filter_scope_type
    )
    and (
      p.filter_scope_name is null
      or lower(coalesce(nullif(c.scope_name, ''), b.name, ci.name, m.name, 'Unknown Scope')) = p.filter_scope_name
    )
    and (
      p.filter_document_type is null
      or lower(coalesce(nullif(c.document_type, ''), 'AIP')) = p.filter_document_type
    )
    and (
      p.filter_office_name is null
      or lower(coalesce(c.office_name, '')) = p.filter_office_name
    )
    and (
      p.filter_theme_tags is null
      or cardinality(p.filter_theme_tags) = 0
      or coalesce(c.theme_tags, '{}'::text[]) && p.filter_theme_tags
    )
    and (
      p.filter_sector_tags is null
      or cardinality(p.filter_sector_tags) = 0
      or coalesce(c.sector_tags, '{}'::text[]) && p.filter_sector_tags
    )
),
ranked as (
  select *
  from rows_scoped
  where similarity >= (select sim_floor from params)
  order by similarity desc, chunk_id
  limit (select k from params)
)
select
  'S' || row_number() over (order by similarity desc, chunk_id) as source_id,
  chunk_id,
  content,
  similarity,
  aip_id,
  fiscal_year,
  published_at,
  scope_type,
  scope_id,
  scope_name,
  chunk_type,
  document_type,
  publication_status,
  office_name,
  project_ref_code,
  source_page,
  theme_tags,
  sector_tags,
  metadata
from ranked;
$$;


ALTER FUNCTION "public"."match_published_aip_project_chunks_v2"("query_embedding" "extensions"."vector", "match_count" integer, "min_similarity" double precision, "scope_mode" "text", "own_barangay_id" "uuid", "scope_targets" "jsonb", "filter_fiscal_year" integer, "filter_scope_type" "text", "filter_scope_name" "text", "filter_document_type" "text", "filter_publication_status" "text", "filter_office_name" "text", "filter_theme_tags" "text"[], "filter_sector_tags" "text"[], "include_summary_chunks" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notifications_guard_read_update"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.recipient_user_id is distinct from old.recipient_user_id
     or new.recipient_role is distinct from old.recipient_role
     or new.scope_type is distinct from old.scope_type
     or new.event_type is distinct from old.event_type
     or new.entity_type is distinct from old.entity_type
     or new.entity_id is distinct from old.entity_id
     or new.title is distinct from old.title
     or new.message is distinct from old.message
     or new.action_url is distinct from old.action_url
     or new.metadata is distinct from old.metadata
     or new.created_at is distinct from old.created_at
     or new.dedupe_key is distinct from old.dedupe_key then
    raise exception 'Only read_at can be updated.';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."notifications_guard_read_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."now_utc"() RETURNS timestamp with time zone
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select now();
$$;


ALTER FUNCTION "public"."now_utc"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."on_aip_published_embed_categorize"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
begin
  if tg_op = 'UPDATE'
     and old.status is distinct from new.status
     and new.status = 'published' then
    begin
      perform public.dispatch_embed_categorize_for_aip(new.id);
    exception
      when others then
        raise warning 'on_aip_published_embed_categorize dispatch failed for aip %: %', new.id, sqlerrm;
    end;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."on_aip_published_embed_categorize"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_last_active_admin_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_active_admin_count bigint;
begin
  -- UPDATE path:
  -- Block if this row is currently an active admin and update would remove that.
  if tg_op = 'UPDATE' then
    if old.role = 'admin'::public.role_type and old.is_active = true then
      if not (new.role = 'admin'::public.role_type and new.is_active = true) then
        select count(*)::bigint
          into v_active_admin_count
        from public.profiles p
        where p.role = 'admin'::public.role_type
          and p.is_active = true;

        if v_active_admin_count <= 1 then
          raise exception 'Cannot modify the last active admin account.';
        end if;
      end if;
    end if;
    return new;
  end if;

  -- DELETE path:
  -- Block deleting the last active admin.
  if tg_op = 'DELETE' then
    if old.role = 'admin'::public.role_type and old.is_active = true then
      select count(*)::bigint
        into v_active_admin_count
      from public.profiles p
      where p.role = 'admin'::public.role_type
        and p.is_active = true;

      if v_active_admin_count <= 1 then
        raise exception 'Cannot delete the last active admin account.';
      end if;
    end if;
    return old;
  end if;

  return coalesce(new, old);
end;
$$;


ALTER FUNCTION "public"."prevent_last_active_admin_mutation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."project_update_media_delete_storage_object"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'storage'
    AS $$
declare
  v_bucket_id text;
  v_object_name text;
begin
  v_bucket_id := nullif(btrim(old.bucket_id), '');
  v_object_name := nullif(btrim(old.object_name), '');

  if v_bucket_id is not null and v_object_name is not null then
    begin
      delete from storage.objects
      where bucket_id = v_bucket_id
        and name = v_object_name;
    exception
      when others then
        if position('Direct deletion from storage tables is not allowed' in sqlerrm) > 0 then
          null;
        else
          raise;
        end if;
    end;
  end if;

  return old;
end;
$$;


ALTER FUNCTION "public"."project_update_media_delete_storage_object"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."projects_delete_cover_image_object"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'storage'
    AS $$
declare
  v_old_path text;
  v_new_path text;
  v_bucket_id text;
begin
  v_old_path := nullif(btrim(old.image_url), '');
  if tg_op = 'UPDATE' then
    v_new_path := nullif(btrim(new.image_url), '');
  else
    v_new_path := null;
  end if;
  v_bucket_id := coalesce(
    nullif(current_setting('app.settings.project_media_bucket', true), ''),
    'project-media'
  );

  if v_old_path is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' and v_old_path = v_new_path then
    return new;
  end if;

  begin
    delete from storage.objects
    where bucket_id = v_bucket_id
      and name = v_old_path;
  exception
    when others then
      if position('Direct deletion from storage tables is not allowed' in sqlerrm) > 0 then
        null;
      else
        raise;
      end if;
  end;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."projects_delete_cover_image_object"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."purge_activity_log_older_than"("p_days" integer) RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_deleted bigint;
begin
  if p_days is null or p_days < 1 or p_days > 3650 then
    raise exception 'p_days must be between 1 and 3650';
  end if;

  -- Only admin/officials can call; prefer service role in practice
  if not public.is_active_auth() then
    raise exception 'not authorized';
  end if;

  if not (public.is_admin()) then
    raise exception 'not authorized';
  end if;

  delete from public.activity_log
  where created_at < now() - make_interval(days => p_days);

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;


ALTER FUNCTION "public"."purge_activity_log_older_than"("p_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."purge_chat_data_older_than"("p_days" integer DEFAULT 90) RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_deleted bigint;
begin
  if p_days < 1 or p_days > 3650 then
    raise exception 'p_days must be between 1 and 3650';
  end if;

  delete from public.chat_sessions
  where updated_at < now() - make_interval(days => p_days);

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;


ALTER FUNCTION "public"."purge_chat_data_older_than"("p_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_aip_reviews_activity_log_crud"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_actor_id uuid;
  v_actor_role text;
  v_actor_name text;
  v_action text;
  v_details text;
  v_review_id uuid;
  v_review_action text;
  v_reviewer_id uuid;
  v_note text;
  v_aip_id uuid;
  v_aip_status text;
  v_barangay_id uuid;
  v_city_id uuid;
  v_municipality_id uuid;
begin
  v_actor_id := public.current_user_id();
  v_actor_role := public.current_role_code();

  if v_actor_id is null or v_actor_role is null or v_actor_role <> 'city_official' then
    return coalesce(new, old);
  end if;

  select nullif(trim(p.full_name), '')
    into v_actor_name
  from public.profiles p
  where p.id = v_actor_id;

  if tg_op = 'INSERT' then
    v_action := 'aip_review_record_created';
    v_review_id := new.id;
    v_aip_id := new.aip_id;
    v_review_action := new.action::text;
    v_reviewer_id := new.reviewer_id;
    v_note := new.note;
  elsif tg_op = 'UPDATE' then
    v_action := 'aip_review_record_updated';
    v_review_id := new.id;
    v_aip_id := new.aip_id;
    v_review_action := new.action::text;
    v_reviewer_id := new.reviewer_id;
    v_note := new.note;
  else
    v_action := 'aip_review_record_deleted';
    v_review_id := old.id;
    v_aip_id := old.aip_id;
    v_review_action := old.action::text;
    v_reviewer_id := old.reviewer_id;
    v_note := old.note;
  end if;

  if v_aip_id is not null then
    select a.status::text, a.barangay_id, a.city_id, a.municipality_id
      into v_aip_status, v_barangay_id, v_city_id, v_municipality_id
    from public.aips a
    where a.id = v_aip_id;

    if v_city_id is null and v_barangay_id is not null then
      select b.city_id
        into v_city_id
      from public.barangays b
      where b.id = v_barangay_id;
    end if;
  end if;

  if v_city_id is null then
    v_city_id := public.current_city_id();
  end if;

  if v_action = 'aip_review_record_created' then
    v_details := format('Created AIP review record (%s).', coalesce(v_review_action, 'unknown'));
  elsif v_action = 'aip_review_record_updated' then
    v_details := format('Updated AIP review record (%s).', coalesce(v_review_action, 'unknown'));
  else
    v_details := format('Deleted AIP review record (%s).', coalesce(v_review_action, 'unknown'));
  end if;

  perform public.log_activity(
    p_action => v_action,
    p_entity_table => 'aip_reviews',
    p_entity_id => v_review_id,
    p_region_id => null,
    p_province_id => null,
    p_city_id => v_city_id,
    p_municipality_id => v_municipality_id,
    p_barangay_id => v_barangay_id,
    p_metadata => jsonb_build_object(
      'source', 'crud',
      'actor_name', coalesce(v_actor_name, 'Unknown'),
      'actor_position', 'City Official',
      'details', v_details,
      'aip_id', v_aip_id,
      'aip_status', v_aip_status,
      'review_action', v_review_action,
      'reviewer_id', v_reviewer_id,
      'note', v_note
    )
  );

  return coalesce(new, old);
end;
$$;


ALTER FUNCTION "public"."trg_aip_reviews_activity_log_crud"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_aips_activity_log_crud"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_actor_id uuid;
  v_actor_role text;
  v_actor_name text;
  v_actor_position text;
  v_action text;
  v_details text;
  v_entity_id uuid;
  v_fiscal_year int;
  v_status text;
  v_previous_status text;
  v_barangay_id uuid;
  v_city_id uuid;
  v_municipality_id uuid;
begin
  v_actor_id := public.current_user_id();
  v_actor_role := public.current_role_code();

  if v_actor_id is null
     or v_actor_role is null
     or v_actor_role not in ('barangay_official', 'city_official') then
    return coalesce(new, old);
  end if;

  v_actor_position :=
    case
      when v_actor_role = 'city_official' then 'City Official'
      else 'Barangay Official'
    end;

  select nullif(trim(p.full_name), '')
    into v_actor_name
  from public.profiles p
  where p.id = v_actor_id;

  if tg_op = 'INSERT' then
    v_action := 'aip_created';
    v_entity_id := new.id;
    v_fiscal_year := new.fiscal_year;
    v_status := new.status::text;
    v_previous_status := null;
    v_barangay_id := new.barangay_id;
    v_city_id := new.city_id;
    v_municipality_id := new.municipality_id;
    v_details := format('Created AIP record for fiscal year %s.', coalesce(new.fiscal_year::text, 'unknown'));
  elsif tg_op = 'UPDATE' then
    v_action := 'aip_updated';
    v_entity_id := new.id;
    v_fiscal_year := new.fiscal_year;
    v_status := new.status::text;
    v_previous_status := old.status::text;
    v_barangay_id := new.barangay_id;
    v_city_id := new.city_id;
    v_municipality_id := new.municipality_id;

    if new.status is distinct from old.status then
      v_details := format(
        'Updated AIP record for fiscal year %s (status: %s -> %s).',
        coalesce(new.fiscal_year::text, 'unknown'),
        coalesce(old.status::text, 'unknown'),
        coalesce(new.status::text, 'unknown')
      );
    else
      v_details := format('Updated AIP record for fiscal year %s.', coalesce(new.fiscal_year::text, 'unknown'));
    end if;
  else
    v_action := 'aip_deleted';
    v_entity_id := old.id;
    v_fiscal_year := old.fiscal_year;
    v_status := old.status::text;
    v_previous_status := null;
    v_barangay_id := old.barangay_id;
    v_city_id := old.city_id;
    v_municipality_id := old.municipality_id;
    v_details := format('Deleted AIP record for fiscal year %s.', coalesce(old.fiscal_year::text, 'unknown'));
  end if;

  if v_actor_role = 'city_official' and v_city_id is null then
    v_city_id := public.current_city_id();
  end if;

  perform public.log_activity(
    p_action => v_action,
    p_entity_table => 'aips',
    p_entity_id => v_entity_id,
    p_region_id => null,
    p_province_id => null,
    p_city_id => v_city_id,
    p_municipality_id => v_municipality_id,
    p_barangay_id => v_barangay_id,
    p_metadata => jsonb_build_object(
      'source', 'crud',
      'actor_name', coalesce(v_actor_name, 'Unknown'),
      'actor_position', v_actor_position,
      'details', v_details,
      'fiscal_year', v_fiscal_year,
      'status', v_status,
      'previous_status', v_previous_status
    )
  );

  return coalesce(new, old);
end;
$$;


ALTER FUNCTION "public"."trg_aips_activity_log_crud"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_feedback_activity_log_crud"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_actor_id uuid;
  v_actor_role text;
  v_actor_name text;
  v_actor_position text;
  v_action text;
  v_details text;
  v_feedback_id uuid;
  v_target_type text;
  v_kind text;
  v_parent_feedback_id uuid;
  v_aip_id uuid;
  v_project_id uuid;
  v_barangay_id uuid;
  v_city_id uuid;
  v_municipality_id uuid;
begin
  v_actor_id := public.current_user_id();
  v_actor_role := public.current_role_code();

  if v_actor_id is null
     or v_actor_role is null
     or v_actor_role not in ('barangay_official', 'city_official', 'municipal_official', 'citizen') then
    return coalesce(new, old);
  end if;

  v_actor_position :=
    case
      when v_actor_role = 'city_official' then 'City Official'
      when v_actor_role = 'municipal_official' then 'Municipal Official'
      when v_actor_role = 'citizen' then 'Citizen'
      else 'Barangay Official'
    end;

  select nullif(trim(p.full_name), '')
    into v_actor_name
  from public.profiles p
  where p.id = v_actor_id;

  if tg_op = 'INSERT' then
    v_action := 'feedback_created';
    v_feedback_id := new.id;
    v_target_type := new.target_type::text;
    v_kind := new.kind::text;
    v_parent_feedback_id := new.parent_feedback_id;
    v_aip_id := new.aip_id;
    v_project_id := new.project_id;
  elsif tg_op = 'UPDATE' then
    v_action := 'feedback_updated';
    v_feedback_id := new.id;
    v_target_type := new.target_type::text;
    v_kind := new.kind::text;
    v_parent_feedback_id := new.parent_feedback_id;
    v_aip_id := new.aip_id;
    v_project_id := new.project_id;
  else
    v_action := 'feedback_deleted';
    v_feedback_id := old.id;
    v_target_type := old.target_type::text;
    v_kind := old.kind::text;
    v_parent_feedback_id := old.parent_feedback_id;
    v_aip_id := old.aip_id;
    v_project_id := old.project_id;
  end if;

  if v_target_type = 'project' and v_project_id is not null then
    select p.aip_id into v_aip_id
    from public.projects p
    where p.id = v_project_id;
  end if;

  if v_aip_id is not null then
    select a.barangay_id, a.city_id, a.municipality_id
      into v_barangay_id, v_city_id, v_municipality_id
    from public.aips a
    where a.id = v_aip_id;
  end if;

  if v_actor_role = 'city_official' and v_city_id is null then
    v_city_id := public.current_city_id();
  end if;
  if v_actor_role = 'municipal_official' and v_municipality_id is null then
    v_municipality_id := public.current_municipality_id();
  end if;
  if v_actor_role = 'citizen' and v_barangay_id is null then
    v_barangay_id := public.current_barangay_id();
  end if;

  if v_action = 'feedback_created' then
    if v_parent_feedback_id is null then
      v_details := format('Created feedback entry (%s).', coalesce(v_kind, 'unknown'));
    else
      v_details := format('Created feedback reply (%s).', coalesce(v_kind, 'unknown'));
    end if;
  elsif v_action = 'feedback_updated' then
    v_details := format('Updated feedback entry (%s).', coalesce(v_kind, 'unknown'));
  else
    v_details := format('Deleted feedback entry (%s).', coalesce(v_kind, 'unknown'));
  end if;

  perform public.log_activity(
    p_action => v_action,
    p_entity_table => 'feedback',
    p_entity_id => v_feedback_id,
    p_region_id => null,
    p_province_id => null,
    p_city_id => v_city_id,
    p_municipality_id => v_municipality_id,
    p_barangay_id => v_barangay_id,
    p_metadata => jsonb_build_object(
      'source', 'crud',
      'actor_name', coalesce(v_actor_name, 'Unknown'),
      'actor_position', v_actor_position,
      'details', v_details,
      'target_type', v_target_type,
      'feedback_kind', v_kind,
      'parent_feedback_id', v_parent_feedback_id,
      'aip_id', v_aip_id,
      'project_id', v_project_id
    )
  );

  return coalesce(new, old);
end;
$$;


ALTER FUNCTION "public"."trg_feedback_activity_log_crud"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_projects_activity_log_crud"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_actor_id uuid;
  v_actor_role text;
  v_actor_name text;
  v_actor_position text;
  v_action text;
  v_details text;
  v_project_id uuid;
  v_aip_id uuid;
  v_aip_ref_code text;
  v_category text;
  v_barangay_id uuid;
  v_city_id uuid;
  v_municipality_id uuid;
begin
  v_actor_id := public.current_user_id();
  v_actor_role := public.current_role_code();

  if v_actor_id is null
     or v_actor_role is null
     or v_actor_role not in ('barangay_official', 'city_official') then
    return coalesce(new, old);
  end if;

  v_actor_position :=
    case
      when v_actor_role = 'city_official' then 'City Official'
      else 'Barangay Official'
    end;

  select nullif(trim(p.full_name), '')
    into v_actor_name
  from public.profiles p
  where p.id = v_actor_id;

  if tg_op = 'INSERT' then
    v_action := 'project_record_created';
    v_project_id := new.id;
    v_aip_id := new.aip_id;
    v_aip_ref_code := new.aip_ref_code;
    v_category := new.category::text;
    v_details := format('Created project record %s.', coalesce(new.aip_ref_code, new.id::text));
  elsif tg_op = 'UPDATE' then
    v_action := 'project_record_updated';
    v_project_id := new.id;
    v_aip_id := new.aip_id;
    v_aip_ref_code := new.aip_ref_code;
    v_category := new.category::text;
    v_details := format('Updated project record %s.', coalesce(new.aip_ref_code, new.id::text));
  else
    v_action := 'project_record_deleted';
    v_project_id := old.id;
    v_aip_id := old.aip_id;
    v_aip_ref_code := old.aip_ref_code;
    v_category := old.category::text;
    v_details := format('Deleted project record %s.', coalesce(old.aip_ref_code, old.id::text));
  end if;

  select a.barangay_id, a.city_id, a.municipality_id
    into v_barangay_id, v_city_id, v_municipality_id
  from public.aips a
  where a.id = v_aip_id;

  if v_actor_role = 'city_official' and v_city_id is null then
    v_city_id := public.current_city_id();
  end if;

  perform public.log_activity(
    p_action => v_action,
    p_entity_table => 'projects',
    p_entity_id => v_project_id,
    p_region_id => null,
    p_province_id => null,
    p_city_id => v_city_id,
    p_municipality_id => v_municipality_id,
    p_barangay_id => v_barangay_id,
    p_metadata => jsonb_build_object(
      'source', 'crud',
      'actor_name', coalesce(v_actor_name, 'Unknown'),
      'actor_position', v_actor_position,
      'details', v_details,
      'aip_id', v_aip_id,
      'aip_ref_code', v_aip_ref_code,
      'project_category', v_category
    )
  );

  return coalesce(new, old);
end;
$$;


ALTER FUNCTION "public"."trg_projects_activity_log_crud"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."uploaded_files_delete_storage_object"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'storage'
    AS $$
declare
  v_bucket_id text;
  v_object_name text;
begin
  v_bucket_id := nullif(btrim(old.bucket_id), '');
  v_object_name := nullif(btrim(old.object_name), '');

  if v_bucket_id is not null and v_object_name is not null then
    begin
      delete from storage.objects
      where bucket_id = v_bucket_id
        and name = v_object_name;
    exception
      when others then
        if position('Direct deletion from storage tables is not allowed' in sqlerrm) > 0 then
          null;
        else
          raise;
        end if;
    end;
  end if;

  return old;
end;
$$;


ALTER FUNCTION "public"."uploaded_files_delete_storage_object"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."uploaded_files_set_single_current"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
begin
  if new.is_current then
    update public.uploaded_files uf
      set is_current = false
    where uf.aip_id = new.aip_id
      and uf.id <> new.id
      and uf.is_current = true;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."uploaded_files_set_single_current"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "app"."settings" (
    "key" "text" NOT NULL,
    "value" "text" NOT NULL
);


ALTER TABLE "app"."settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."activity_log" (
    "id" "uuid" DEFAULT "extensions"."gen_random_uuid"() NOT NULL,
    "actor_id" "uuid",
    "actor_role" "text",
    "action" "text" NOT NULL,
    "entity_table" "text",
    "entity_id" "uuid",
    "region_id" "uuid",
    "province_id" "uuid",
    "city_id" "uuid",
    "municipality_id" "uuid",
    "barangay_id" "uuid",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "activity_log_action_check" CHECK (("length"("action") <= 80)),
    CONSTRAINT "activity_log_entity_table_check" CHECK ((("entity_table" IS NULL) OR ("length"("entity_table") <= 80)))
);


ALTER TABLE "public"."activity_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."aip_chunk_embeddings" (
    "id" "uuid" DEFAULT "extensions"."gen_random_uuid"() NOT NULL,
    "chunk_id" "uuid" NOT NULL,
    "aip_id" "uuid" NOT NULL,
    "embedding" "extensions"."vector"(3072) NOT NULL,
    "embedding_model" "text" DEFAULT 'text-embedding-3-large'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."aip_chunk_embeddings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."aip_chunks" (
    "id" "uuid" DEFAULT "extensions"."gen_random_uuid"() NOT NULL,
    "aip_id" "uuid" NOT NULL,
    "uploaded_file_id" "uuid",
    "run_id" "uuid",
    "chunk_index" integer NOT NULL,
    "chunk_text" "text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "chunk_type" "public"."aip_chunk_type" DEFAULT 'legacy_category_group'::"public"."aip_chunk_type" NOT NULL,
    "ingestion_version" smallint DEFAULT 1 NOT NULL,
    "document_type" "text" DEFAULT 'AIP'::"text" NOT NULL,
    "publication_status" "text" DEFAULT 'published'::"text" NOT NULL,
    "fiscal_year" integer,
    "scope_type" "text",
    "scope_name" "text",
    "office_name" "text",
    "project_ref_code" "text",
    "source_page" integer,
    "theme_tags" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "sector_tags" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    CONSTRAINT "aip_chunks_chunk_index_check" CHECK (("chunk_index" >= 0)),
    CONSTRAINT "aip_chunks_ingestion_version_check" CHECK (("ingestion_version" >= 1))
);


ALTER TABLE "public"."aip_chunks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."aip_line_item_embeddings" (
    "line_item_id" "uuid" NOT NULL,
    "embedding" "extensions"."vector"(3072) NOT NULL,
    "model" "text" DEFAULT 'text-embedding-3-large'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."aip_line_item_embeddings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."aip_line_items" (
    "id" "uuid" DEFAULT "extensions"."gen_random_uuid"() NOT NULL,
    "aip_id" "uuid" NOT NULL,
    "fiscal_year" integer NOT NULL,
    "barangay_id" "uuid",
    "aip_ref_code" "text",
    "sector_code" "text",
    "sector_name" "text",
    "program_project_title" "text" NOT NULL,
    "implementing_agency" "text",
    "start_date" "date",
    "end_date" "date",
    "fund_source" "text",
    "ps" numeric,
    "mooe" numeric,
    "co" numeric,
    "fe" numeric,
    "total" numeric,
    "expected_output" "text",
    "page_no" integer,
    "row_no" integer,
    "table_no" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."aip_line_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."aip_reviews" (
    "id" "uuid" DEFAULT "extensions"."gen_random_uuid"() NOT NULL,
    "aip_id" "uuid" NOT NULL,
    "action" "public"."review_action" NOT NULL,
    "note" "text",
    "reviewer_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "aip_reviews_note_check" CHECK ((("note" IS NULL) OR ("length"("note") <= 4000)))
);


ALTER TABLE "public"."aip_reviews" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."aip_totals" (
    "id" "uuid" DEFAULT "extensions"."gen_random_uuid"() NOT NULL,
    "aip_id" "uuid" NOT NULL,
    "fiscal_year" integer NOT NULL,
    "barangay_id" "uuid",
    "city_id" "uuid",
    "municipality_id" "uuid",
    "total_investment_program" numeric NOT NULL,
    "currency" "text" DEFAULT 'PHP'::"text" NOT NULL,
    "page_no" integer,
    "evidence_text" "text" NOT NULL,
    "source_label" "text" DEFAULT 'pdf_total_line'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_aip_totals_exactly_one_scope" CHECK (((((("barangay_id" IS NOT NULL))::integer + (("city_id" IS NOT NULL))::integer) + (("municipality_id" IS NOT NULL))::integer) = 1))
);


ALTER TABLE "public"."aip_totals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."aip_upload_validation_logs" (
    "id" "uuid" DEFAULT "extensions"."gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "lgu_id" "uuid",
    "lgu_level" "text",
    "selected_year" integer,
    "detected_year" integer,
    "detected_lgu_name" "text",
    "detected_lgu_level" "text",
    "file_name" "text",
    "sanitized_file_name" "text",
    "file_size" bigint,
    "file_hash_sha256" "text",
    "page_count" integer,
    "storage_path" "text",
    "status" "text" NOT NULL,
    "rejection_code" "text",
    "rejection_details_json" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "aip_upload_validation_logs_detected_lgu_level_check" CHECK (("detected_lgu_level" = ANY (ARRAY['barangay'::"text", 'city'::"text"]))),
    CONSTRAINT "aip_upload_validation_logs_detected_year_check" CHECK ((("detected_year" >= 2000) AND ("detected_year" <= 2100))),
    CONSTRAINT "aip_upload_validation_logs_file_hash_sha256_check" CHECK ((("file_hash_sha256" IS NULL) OR ("file_hash_sha256" ~ '^[0-9a-f]{64}$'::"text"))),
    CONSTRAINT "aip_upload_validation_logs_file_size_check" CHECK ((("file_size" IS NULL) OR ("file_size" >= 0))),
    CONSTRAINT "aip_upload_validation_logs_lgu_level_check" CHECK (("lgu_level" = ANY (ARRAY['barangay'::"text", 'city'::"text"]))),
    CONSTRAINT "aip_upload_validation_logs_page_count_check" CHECK ((("page_count" IS NULL) OR ("page_count" >= 0))),
    CONSTRAINT "aip_upload_validation_logs_selected_year_check" CHECK ((("selected_year" >= 2000) AND ("selected_year" <= 2100))),
    CONSTRAINT "aip_upload_validation_logs_status_check" CHECK (("status" = ANY (ARRAY['accepted'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."aip_upload_validation_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."aips" (
    "id" "uuid" DEFAULT "extensions"."gen_random_uuid"() NOT NULL,
    "fiscal_year" integer NOT NULL,
    "barangay_id" "uuid",
    "city_id" "uuid",
    "municipality_id" "uuid",
    "status" "public"."aip_status" DEFAULT 'draft'::"public"."aip_status" NOT NULL,
    "status_updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "submitted_at" timestamp with time zone,
    "published_at" timestamp with time zone,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "aips_fiscal_year_check" CHECK ((("fiscal_year" >= 2000) AND ("fiscal_year" <= 2100))),
    CONSTRAINT "chk_aips_exactly_one_scope" CHECK (((("barangay_id" IS NOT NULL) AND ("city_id" IS NULL) AND ("municipality_id" IS NULL)) OR (("barangay_id" IS NULL) AND ("city_id" IS NOT NULL) AND ("municipality_id" IS NULL)) OR (("barangay_id" IS NULL) AND ("city_id" IS NULL) AND ("municipality_id" IS NOT NULL)))),
    CONSTRAINT "chk_aips_published_at" CHECK ((("status" <> 'published'::"public"."aip_status") OR ("published_at" IS NOT NULL)))
);


ALTER TABLE "public"."aips" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."barangays" (
    "id" "uuid" DEFAULT "extensions"."gen_random_uuid"() NOT NULL,
    "city_id" "uuid",
    "municipality_id" "uuid",
    "psgc_code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_barangay_parent_xor" CHECK (((("city_id" IS NOT NULL) AND ("municipality_id" IS NULL)) OR (("city_id" IS NULL) AND ("municipality_id" IS NOT NULL)))),
    CONSTRAINT "chk_barangays_psgc" CHECK (("psgc_code" ~ '^[0-9]{9}$'::"text"))
);


ALTER TABLE "public"."barangays" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chat_messages" (
    "id" "uuid" DEFAULT "extensions"."gen_random_uuid"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "content" "text" NOT NULL,
    "citations" "jsonb",
    "retrieval_meta" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chat_messages_content_check" CHECK (("length"("content") <= 12000)),
    CONSTRAINT "chat_messages_role_check" CHECK (("role" = ANY (ARRAY['user'::"text", 'assistant'::"text", 'system'::"text"]))),
    CONSTRAINT "chk_chat_messages_assistant_citations_required" CHECK ((("role" <> 'assistant'::"text") OR (("citations" IS NOT NULL) AND ("jsonb_typeof"("citations") = 'array'::"text") AND ("jsonb_array_length"("citations") > 0))))
);


ALTER TABLE "public"."chat_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chat_rate_events" (
    "id" "uuid" DEFAULT "extensions"."gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "route" "text" DEFAULT 'barangay_chat_message'::"text" NOT NULL,
    "event_status" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chat_rate_events_event_status_check" CHECK (("event_status" = ANY (ARRAY['accepted'::"text", 'rejected_minute'::"text", 'rejected_hour'::"text", 'rejected_day'::"text"])))
);


ALTER TABLE "public"."chat_rate_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chat_sessions" (
    "id" "uuid" DEFAULT "extensions"."gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "title" "text",
    "context" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "last_message_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chat_sessions_title_check" CHECK ((("title" IS NULL) OR ("length"("title") <= 200)))
);


ALTER TABLE "public"."chat_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cities" (
    "id" "uuid" DEFAULT "extensions"."gen_random_uuid"() NOT NULL,
    "region_id" "uuid" NOT NULL,
    "province_id" "uuid",
    "psgc_code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "is_independent" boolean DEFAULT false NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_cities_psgc" CHECK (("psgc_code" ~ '^[0-9]{6}$'::"text")),
    CONSTRAINT "chk_city_independent_consistency" CHECK (((("province_id" IS NULL) AND ("is_independent" = true)) OR ("province_id" IS NOT NULL)))
);


ALTER TABLE "public"."cities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."email_outbox" (
    "id" "uuid" DEFAULT "extensions"."gen_random_uuid"() NOT NULL,
    "recipient_user_id" "uuid",
    "to_email" "text" NOT NULL,
    "template_key" "text" NOT NULL,
    "subject" "text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "attempt_count" integer DEFAULT 0 NOT NULL,
    "last_error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sent_at" timestamp with time zone,
    "dedupe_key" "text" NOT NULL,
    CONSTRAINT "email_outbox_attempt_count_check" CHECK (("attempt_count" >= 0)),
    CONSTRAINT "email_outbox_status_check" CHECK (("status" = ANY (ARRAY['queued'::"text", 'sent'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."email_outbox" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."extraction_artifacts" (
    "id" "uuid" DEFAULT "extensions"."gen_random_uuid"() NOT NULL,
    "run_id" "uuid" NOT NULL,
    "aip_id" "uuid" NOT NULL,
    "artifact_type" "public"."pipeline_stage" NOT NULL,
    "artifact_json" "jsonb",
    "artifact_text" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."extraction_artifacts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."extraction_runs" (
    "id" "uuid" DEFAULT "extensions"."gen_random_uuid"() NOT NULL,
    "aip_id" "uuid" NOT NULL,
    "uploaded_file_id" "uuid",
    "stage" "public"."pipeline_stage" DEFAULT 'extract'::"public"."pipeline_stage" NOT NULL,
    "status" "public"."pipeline_status" DEFAULT 'queued'::"public"."pipeline_status" NOT NULL,
    "model_name" "text",
    "model_version" "text",
    "temperature" numeric,
    "prompt_version" "text",
    "started_at" timestamp with time zone,
    "finished_at" timestamp with time zone,
    "error_code" "text",
    "error_message" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "overall_progress_pct" smallint,
    "stage_progress_pct" smallint,
    "progress_message" "text",
    "progress_updated_at" timestamp with time zone,
    "retry_of_run_id" "uuid",
    "resume_from_stage" "public"."pipeline_stage",
    CONSTRAINT "chk_extraction_runs_time_order" CHECK ((("started_at" IS NULL) OR ("finished_at" IS NULL) OR ("finished_at" >= "started_at"))),
    CONSTRAINT "extraction_runs_overall_progress_pct_range_chk" CHECK ((("overall_progress_pct" IS NULL) OR (("overall_progress_pct" >= 0) AND ("overall_progress_pct" <= 100)))),
    CONSTRAINT "extraction_runs_resume_from_stage_requires_retry_chk" CHECK ((("resume_from_stage" IS NULL) OR ("retry_of_run_id" IS NOT NULL))),
    CONSTRAINT "extraction_runs_stage_progress_pct_range_chk" CHECK ((("stage_progress_pct" IS NULL) OR (("stage_progress_pct" >= 0) AND ("stage_progress_pct" <= 100)))),
    CONSTRAINT "extraction_runs_temperature_check" CHECK ((("temperature" IS NULL) OR (("temperature" >= (0)::numeric) AND ("temperature" <= (2)::numeric))))
);


ALTER TABLE "public"."extraction_runs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."feedback" (
    "id" "uuid" DEFAULT "extensions"."gen_random_uuid"() NOT NULL,
    "target_type" "public"."feedback_target_type" NOT NULL,
    "aip_id" "uuid",
    "project_id" "uuid",
    "parent_feedback_id" "uuid",
    "source" "public"."feedback_source" DEFAULT 'human'::"public"."feedback_source" NOT NULL,
    "kind" "public"."feedback_kind" DEFAULT 'suggestion'::"public"."feedback_kind" NOT NULL,
    "extraction_run_id" "uuid",
    "extraction_artifact_id" "uuid",
    "field_key" "text",
    "severity" integer,
    "body" "text" NOT NULL,
    "is_public" boolean DEFAULT true NOT NULL,
    "author_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_feedback_ai_author" CHECK (((("source" = 'ai'::"public"."feedback_source") AND ("author_id" IS NULL)) OR (("source" = 'human'::"public"."feedback_source") AND ("author_id" IS NOT NULL)))),
    CONSTRAINT "chk_feedback_target_xor" CHECK (((("target_type" = 'aip'::"public"."feedback_target_type") AND ("aip_id" IS NOT NULL) AND ("project_id" IS NULL)) OR (("target_type" = 'project'::"public"."feedback_target_type") AND ("project_id" IS NOT NULL) AND ("aip_id" IS NULL)))),
    CONSTRAINT "feedback_body_check" CHECK (("length"("body") <= 4000)),
    CONSTRAINT "feedback_severity_check" CHECK ((("severity" IS NULL) OR (("severity" >= 1) AND ("severity" <= 5))))
);


ALTER TABLE "public"."feedback" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."health_project_details" (
    "project_id" "uuid" NOT NULL,
    "program_name" "text" NOT NULL,
    "description" "text",
    "target_participants" "text",
    "total_target_participants" integer,
    "updated_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "health_project_details_total_target_participants_check" CHECK ((("total_target_participants" IS NULL) OR ("total_target_participants" >= 0)))
);


ALTER TABLE "public"."health_project_details" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."infrastructure_project_details" (
    "project_id" "uuid" NOT NULL,
    "project_name" "text" NOT NULL,
    "contractor_name" "text",
    "contract_cost" numeric(18,2),
    "start_date" "date",
    "target_completion_date" "date",
    "updated_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_infra_dates_valid" CHECK ((("start_date" IS NULL) OR ("target_completion_date" IS NULL) OR ("target_completion_date" >= "start_date"))),
    CONSTRAINT "infrastructure_project_details_contract_cost_check" CHECK ((("contract_cost" IS NULL) OR ("contract_cost" >= (0)::numeric)))
);


ALTER TABLE "public"."infrastructure_project_details" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."municipalities" (
    "id" "uuid" DEFAULT "extensions"."gen_random_uuid"() NOT NULL,
    "province_id" "uuid" NOT NULL,
    "psgc_code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_municipalities_psgc" CHECK (("psgc_code" ~ '^[0-9]{6}$'::"text"))
);


ALTER TABLE "public"."municipalities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notification_preferences" (
    "user_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "in_app_enabled" boolean DEFAULT true NOT NULL,
    "email_enabled" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."notification_preferences" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "extensions"."gen_random_uuid"() NOT NULL,
    "recipient_user_id" "uuid" NOT NULL,
    "recipient_role" "text" NOT NULL,
    "scope_type" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "entity_type" "text" NOT NULL,
    "entity_id" "uuid",
    "title" "text" NOT NULL,
    "message" "text" NOT NULL,
    "action_url" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "read_at" timestamp with time zone,
    "dedupe_key" "text" NOT NULL,
    CONSTRAINT "notifications_entity_type_check" CHECK (("entity_type" = ANY (ARRAY['aip'::"text", 'project'::"text", 'feedback'::"text", 'project_update'::"text", 'system'::"text"]))),
    CONSTRAINT "notifications_scope_type_check" CHECK (("scope_type" = ANY (ARRAY['barangay'::"text", 'city'::"text", 'citizen'::"text", 'admin'::"text"])))
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "role" "public"."role_type" DEFAULT 'citizen'::"public"."role_type" NOT NULL,
    "full_name" "text",
    "email" "text",
    "barangay_id" "uuid",
    "city_id" "uuid",
    "municipality_id" "uuid",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_profiles_scope_binding" CHECK (((("role" = 'admin'::"public"."role_type") AND ("barangay_id" IS NULL) AND ("city_id" IS NULL) AND ("municipality_id" IS NULL)) OR (("role" = 'city_official'::"public"."role_type") AND ("city_id" IS NOT NULL) AND ("barangay_id" IS NULL) AND ("municipality_id" IS NULL)) OR (("role" = 'municipal_official'::"public"."role_type") AND ("municipality_id" IS NOT NULL) AND ("barangay_id" IS NULL) AND ("city_id" IS NULL)) OR (("role" = ANY (ARRAY['citizen'::"public"."role_type", 'barangay_official'::"public"."role_type"])) AND ("barangay_id" IS NOT NULL) AND ("city_id" IS NULL) AND ("municipality_id" IS NULL))))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."project_update_media" (
    "id" "uuid" DEFAULT "extensions"."gen_random_uuid"() NOT NULL,
    "update_id" "uuid" NOT NULL,
    "project_id" "uuid" NOT NULL,
    "bucket_id" "text" DEFAULT 'project-media'::"text" NOT NULL,
    "object_name" "text" NOT NULL,
    "mime_type" "text" NOT NULL,
    "size_bytes" bigint,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "project_update_media_size_bytes_check" CHECK ((("size_bytes" IS NULL) OR ("size_bytes" >= 0)))
);


ALTER TABLE "public"."project_update_media" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."project_updates" (
    "id" "uuid" DEFAULT "extensions"."gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "aip_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text" NOT NULL,
    "progress_percent" integer DEFAULT 0 NOT NULL,
    "attendance_count" integer,
    "posted_by" "uuid" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "hidden_reason" "text",
    "hidden_violation_category" "text",
    "hidden_at" timestamp with time zone,
    "hidden_by" "uuid",
    CONSTRAINT "chk_project_updates_status" CHECK (("status" = ANY (ARRAY['active'::"text", 'hidden'::"text"]))),
    CONSTRAINT "project_updates_attendance_count_check" CHECK ((("attendance_count" IS NULL) OR ("attendance_count" >= 0))),
    CONSTRAINT "project_updates_progress_percent_check" CHECK ((("progress_percent" >= 0) AND ("progress_percent" <= 100)))
);


ALTER TABLE "public"."project_updates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."projects" (
    "id" "uuid" DEFAULT "extensions"."gen_random_uuid"() NOT NULL,
    "aip_id" "uuid" NOT NULL,
    "extraction_artifact_id" "uuid",
    "aip_ref_code" "text",
    "program_project_description" "text" NOT NULL,
    "implementing_agency" "text",
    "start_date" "text",
    "completion_date" "text",
    "expected_output" "text",
    "source_of_funds" "text",
    "personal_services" numeric(18,2),
    "maintenance_and_other_operating_expenses" numeric(18,2),
    "capital_outlay" numeric(18,2),
    "total" numeric(18,2),
    "climate_change_adaptation" "text",
    "climate_change_mitigation" "text",
    "cc_topology_code" "text",
    "errors" "jsonb",
    "category" "public"."project_category" DEFAULT 'other'::"public"."project_category" NOT NULL,
    "is_human_edited" boolean DEFAULT false NOT NULL,
    "edited_by" "uuid",
    "edited_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "financial_expenses" numeric(18,2),
    "prm_ncr_lgu_rm_objective_results_indicator" "text",
    "status" "text" DEFAULT 'proposed'::"text" NOT NULL,
    "image_url" "text",
    "project_key" "text" NOT NULL,
    "sector_code" "text" GENERATED ALWAYS AS (
CASE
    WHEN (("aip_ref_code" IS NOT NULL) AND ("left"("aip_ref_code", 4) = ANY (ARRAY['1000'::"text", '3000'::"text", '8000'::"text", '9000'::"text"]))) THEN "left"("aip_ref_code", 4)
    ELSE NULL::"text"
END) STORED,
    CONSTRAINT "chk_projects_edit_consistency" CHECK (((("is_human_edited" = false) AND ("edited_by" IS NULL) AND ("edited_at" IS NULL)) OR (("is_human_edited" = true) AND ("edited_by" IS NOT NULL) AND ("edited_at" IS NOT NULL)))),
    CONSTRAINT "chk_projects_financial_expenses_non_negative" CHECK ((("financial_expenses" IS NULL) OR ("financial_expenses" >= (0)::numeric))),
    CONSTRAINT "chk_projects_status" CHECK (("status" = ANY (ARRAY['proposed'::"text", 'ongoing'::"text", 'completed'::"text", 'on_hold'::"text"]))),
    CONSTRAINT "projects_capital_outlay_check" CHECK ((("capital_outlay" IS NULL) OR ("capital_outlay" >= (0)::numeric))),
    CONSTRAINT "projects_maintenance_and_other_operating_expenses_check" CHECK ((("maintenance_and_other_operating_expenses" IS NULL) OR ("maintenance_and_other_operating_expenses" >= (0)::numeric))),
    CONSTRAINT "projects_personal_services_check" CHECK ((("personal_services" IS NULL) OR ("personal_services" >= (0)::numeric))),
    CONSTRAINT "projects_total_check" CHECK ((("total" IS NULL) OR ("total" >= (0)::numeric)))
);


ALTER TABLE "public"."projects" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."provinces" (
    "id" "uuid" DEFAULT "extensions"."gen_random_uuid"() NOT NULL,
    "region_id" "uuid" NOT NULL,
    "psgc_code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_provinces_psgc" CHECK (("psgc_code" ~ '^[0-9]{4}$'::"text"))
);


ALTER TABLE "public"."provinces" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."regions" (
    "id" "uuid" DEFAULT "extensions"."gen_random_uuid"() NOT NULL,
    "psgc_code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_regions_psgc" CHECK (("psgc_code" ~ '^[0-9]{2}$'::"text"))
);


ALTER TABLE "public"."regions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sectors" (
    "code" "text" NOT NULL,
    "label" "text" NOT NULL
);


ALTER TABLE "public"."sectors" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."uploaded_files" (
    "id" "uuid" DEFAULT "extensions"."gen_random_uuid"() NOT NULL,
    "aip_id" "uuid" NOT NULL,
    "bucket_id" "text" DEFAULT 'aip-pdfs'::"text" NOT NULL,
    "object_name" "text" NOT NULL,
    "original_file_name" "text",
    "mime_type" "text" DEFAULT 'application/pdf'::"text" NOT NULL,
    "size_bytes" bigint,
    "sha256_hex" "text",
    "is_current" boolean DEFAULT true NOT NULL,
    "uploaded_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_uploaded_files_bucket" CHECK (("bucket_id" = 'aip-pdfs'::"text")),
    CONSTRAINT "chk_uploaded_files_pdf" CHECK ((("mime_type" = 'application/pdf'::"text") AND ("lower"("right"("object_name", 4)) = '.pdf'::"text"))),
    CONSTRAINT "uploaded_files_sha256_hex_check" CHECK ((("sha256_hex" IS NULL) OR ("sha256_hex" ~ '^[0-9a-f]{64}$'::"text"))),
    CONSTRAINT "uploaded_files_size_bytes_check" CHECK ((("size_bytes" IS NULL) OR ("size_bytes" >= 0)))
);


ALTER TABLE "public"."uploaded_files" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_aip_public_status" WITH ("security_invoker"='true', "security_barrier"='true') AS
 SELECT "a"."id",
    "a"."fiscal_year",
    "a"."status",
    "a"."status_updated_at",
    "a"."submitted_at",
    "a"."published_at",
    "a"."created_at",
    "a"."barangay_id",
    "a"."city_id",
    "a"."municipality_id",
        CASE
            WHEN ("a"."barangay_id" IS NOT NULL) THEN 'barangay'::"text"
            WHEN ("a"."city_id" IS NOT NULL) THEN 'city'::"text"
            WHEN ("a"."municipality_id" IS NOT NULL) THEN 'municipality'::"text"
            ELSE 'unknown'::"text"
        END AS "scope_type",
    COALESCE("b"."name", "c"."name", "m"."name") AS "scope_name"
   FROM ((("public"."aips" "a"
     LEFT JOIN "public"."barangays" "b" ON (("b"."id" = "a"."barangay_id")))
     LEFT JOIN "public"."cities" "c" ON (("c"."id" = "a"."city_id")))
     LEFT JOIN "public"."municipalities" "m" ON (("m"."id" = "a"."municipality_id")))
  WHERE ("a"."status" <> 'draft'::"public"."aip_status");


ALTER VIEW "public"."v_aip_public_status" OWNER TO "postgres";


ALTER TABLE ONLY "app"."settings"
    ADD CONSTRAINT "settings_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."activity_log"
    ADD CONSTRAINT "activity_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."aip_chunk_embeddings"
    ADD CONSTRAINT "aip_chunk_embeddings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."aip_chunks"
    ADD CONSTRAINT "aip_chunks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."aip_line_item_embeddings"
    ADD CONSTRAINT "aip_line_item_embeddings_pkey" PRIMARY KEY ("line_item_id");



ALTER TABLE ONLY "public"."aip_line_items"
    ADD CONSTRAINT "aip_line_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."aip_reviews"
    ADD CONSTRAINT "aip_reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."aip_totals"
    ADD CONSTRAINT "aip_totals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."aip_upload_validation_logs"
    ADD CONSTRAINT "aip_upload_validation_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."aips"
    ADD CONSTRAINT "aips_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."barangays"
    ADD CONSTRAINT "barangays_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."barangays"
    ADD CONSTRAINT "barangays_psgc_code_key" UNIQUE ("psgc_code");



ALTER TABLE ONLY "public"."chat_messages"
    ADD CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chat_rate_events"
    ADD CONSTRAINT "chat_rate_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chat_sessions"
    ADD CONSTRAINT "chat_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cities"
    ADD CONSTRAINT "cities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cities"
    ADD CONSTRAINT "cities_psgc_code_key" UNIQUE ("psgc_code");



ALTER TABLE ONLY "public"."email_outbox"
    ADD CONSTRAINT "email_outbox_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."extraction_artifacts"
    ADD CONSTRAINT "extraction_artifacts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."extraction_runs"
    ADD CONSTRAINT "extraction_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."feedback"
    ADD CONSTRAINT "feedback_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."health_project_details"
    ADD CONSTRAINT "health_project_details_pkey" PRIMARY KEY ("project_id");



ALTER TABLE ONLY "public"."infrastructure_project_details"
    ADD CONSTRAINT "infrastructure_project_details_pkey" PRIMARY KEY ("project_id");



ALTER TABLE ONLY "public"."municipalities"
    ADD CONSTRAINT "municipalities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."municipalities"
    ADD CONSTRAINT "municipalities_psgc_code_key" UNIQUE ("psgc_code");



ALTER TABLE ONLY "public"."notification_preferences"
    ADD CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id", "event_type");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_update_media"
    ADD CONSTRAINT "project_update_media_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_updates"
    ADD CONSTRAINT "project_updates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."provinces"
    ADD CONSTRAINT "provinces_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."provinces"
    ADD CONSTRAINT "provinces_psgc_code_key" UNIQUE ("psgc_code");



ALTER TABLE ONLY "public"."regions"
    ADD CONSTRAINT "regions_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."regions"
    ADD CONSTRAINT "regions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."regions"
    ADD CONSTRAINT "regions_psgc_code_key" UNIQUE ("psgc_code");



ALTER TABLE ONLY "public"."sectors"
    ADD CONSTRAINT "sectors_pkey" PRIMARY KEY ("code");



ALTER TABLE ONLY "public"."uploaded_files"
    ADD CONSTRAINT "uploaded_files_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."aip_chunks"
    ADD CONSTRAINT "uq_aip_chunks_unique_per_run" UNIQUE ("aip_id", "run_id", "chunk_index");



ALTER TABLE ONLY "public"."aip_totals"
    ADD CONSTRAINT "uq_aip_totals_aip_source" UNIQUE ("aip_id", "source_label");



ALTER TABLE ONLY "public"."barangays"
    ADD CONSTRAINT "uq_barangay_parent_name" UNIQUE ("city_id", "municipality_id", "name");



ALTER TABLE ONLY "public"."aip_chunk_embeddings"
    ADD CONSTRAINT "uq_chunk_embeddings_chunk" UNIQUE ("chunk_id");



ALTER TABLE ONLY "public"."municipalities"
    ADD CONSTRAINT "uq_municipalities_province_name" UNIQUE ("province_id", "name");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "uq_projects_key" UNIQUE ("aip_id", "project_key");



ALTER TABLE ONLY "public"."provinces"
    ADD CONSTRAINT "uq_provinces_region_name" UNIQUE ("region_id", "name");



CREATE INDEX "idx_activity_log_actor_id" ON "public"."activity_log" USING "btree" ("actor_id");



CREATE INDEX "idx_activity_log_barangay_id" ON "public"."activity_log" USING "btree" ("barangay_id") WHERE ("barangay_id" IS NOT NULL);



CREATE INDEX "idx_activity_log_city_id" ON "public"."activity_log" USING "btree" ("city_id") WHERE ("city_id" IS NOT NULL);



CREATE INDEX "idx_activity_log_created_at" ON "public"."activity_log" USING "btree" ("created_at");



CREATE INDEX "idx_activity_log_entity" ON "public"."activity_log" USING "btree" ("entity_table", "entity_id");



CREATE INDEX "idx_activity_log_municipality_id" ON "public"."activity_log" USING "btree" ("municipality_id") WHERE ("municipality_id" IS NOT NULL);



CREATE INDEX "idx_aip_chunk_embeddings_aip_id" ON "public"."aip_chunk_embeddings" USING "btree" ("aip_id");



CREATE INDEX "idx_aip_chunks_aip_id" ON "public"."aip_chunks" USING "btree" ("aip_id");



CREATE INDEX "idx_aip_chunks_doc_office_v2" ON "public"."aip_chunks" USING "btree" ("document_type", "office_name");



CREATE INDEX "idx_aip_chunks_prefilter_v2" ON "public"."aip_chunks" USING "btree" ("chunk_type", "publication_status", "fiscal_year", "scope_type", "scope_name");



CREATE INDEX "idx_aip_chunks_project_ref_code" ON "public"."aip_chunks" USING "btree" ("project_ref_code") WHERE ("project_ref_code" IS NOT NULL);



CREATE INDEX "idx_aip_chunks_run_id" ON "public"."aip_chunks" USING "btree" ("run_id");



CREATE INDEX "idx_aip_chunks_sector_tags" ON "public"."aip_chunks" USING "gin" ("sector_tags");



CREATE INDEX "idx_aip_chunks_theme_tags" ON "public"."aip_chunks" USING "gin" ("theme_tags");



CREATE INDEX "idx_aip_line_items_aip_id" ON "public"."aip_line_items" USING "btree" ("aip_id");



CREATE INDEX "idx_aip_line_items_barangay_fiscal_year" ON "public"."aip_line_items" USING "btree" ("barangay_id", "fiscal_year");



CREATE INDEX "idx_aip_line_items_fiscal_year" ON "public"."aip_line_items" USING "btree" ("fiscal_year");



CREATE INDEX "idx_aip_line_items_title" ON "public"."aip_line_items" USING "btree" ("program_project_title");



CREATE INDEX "idx_aip_reviews_aip_id" ON "public"."aip_reviews" USING "btree" ("aip_id");



CREATE INDEX "idx_aip_reviews_created_at" ON "public"."aip_reviews" USING "btree" ("created_at");



CREATE INDEX "idx_aip_reviews_reviewer_id" ON "public"."aip_reviews" USING "btree" ("reviewer_id");



CREATE INDEX "idx_aip_totals_aip_id" ON "public"."aip_totals" USING "btree" ("aip_id");



CREATE INDEX "idx_aip_totals_scope_fiscal" ON "public"."aip_totals" USING "btree" ("barangay_id", "city_id", "municipality_id", "fiscal_year");



CREATE INDEX "idx_aip_upload_validation_logs_hash" ON "public"."aip_upload_validation_logs" USING "btree" ("file_hash_sha256");



CREATE INDEX "idx_aip_upload_validation_logs_lgu_year" ON "public"."aip_upload_validation_logs" USING "btree" ("lgu_id", "lgu_level", "selected_year");



CREATE INDEX "idx_aip_upload_validation_logs_status_created_at" ON "public"."aip_upload_validation_logs" USING "btree" ("status", "created_at" DESC);



CREATE INDEX "idx_aip_upload_validation_logs_user_created_at" ON "public"."aip_upload_validation_logs" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_aips_barangay_id" ON "public"."aips" USING "btree" ("barangay_id");



CREATE INDEX "idx_aips_barangay_scope_order" ON "public"."aips" USING "btree" ("barangay_id", "fiscal_year" DESC, "created_at" DESC, "id" DESC) WHERE ("barangay_id" IS NOT NULL);



CREATE INDEX "idx_aips_city_id" ON "public"."aips" USING "btree" ("city_id");



CREATE INDEX "idx_aips_city_scope_order" ON "public"."aips" USING "btree" ("city_id", "fiscal_year" DESC, "created_at" DESC, "id" DESC) WHERE ("city_id" IS NOT NULL);



CREATE INDEX "idx_aips_created_at" ON "public"."aips" USING "btree" ("created_at");



CREATE INDEX "idx_aips_fiscal_year" ON "public"."aips" USING "btree" ("fiscal_year");



CREATE INDEX "idx_aips_municipality_id" ON "public"."aips" USING "btree" ("municipality_id");



CREATE INDEX "idx_aips_municipality_scope_order" ON "public"."aips" USING "btree" ("municipality_id", "fiscal_year" DESC, "created_at" DESC, "id" DESC) WHERE ("municipality_id" IS NOT NULL);



CREATE INDEX "idx_aips_published_fiscal_year" ON "public"."aips" USING "btree" ("fiscal_year") WHERE ("status" = 'published'::"public"."aip_status");



CREATE INDEX "idx_aips_status" ON "public"."aips" USING "btree" ("status");



CREATE INDEX "idx_aips_status_updated_at" ON "public"."aips" USING "btree" ("status_updated_at");



CREATE INDEX "idx_barangays_city_id" ON "public"."barangays" USING "btree" ("city_id");



CREATE INDEX "idx_barangays_municipality_id" ON "public"."barangays" USING "btree" ("municipality_id");



CREATE INDEX "idx_chat_messages_created_at" ON "public"."chat_messages" USING "btree" ("created_at");



CREATE INDEX "idx_chat_messages_session_id" ON "public"."chat_messages" USING "btree" ("session_id");



CREATE INDEX "idx_chat_rate_events_created_at" ON "public"."chat_rate_events" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_chat_rate_events_user_created_at" ON "public"."chat_rate_events" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_chat_sessions_created_at" ON "public"."chat_sessions" USING "btree" ("created_at");



CREATE INDEX "idx_chat_sessions_last_message_at" ON "public"."chat_sessions" USING "btree" ("last_message_at");



CREATE INDEX "idx_chat_sessions_user_id" ON "public"."chat_sessions" USING "btree" ("user_id");



CREATE INDEX "idx_cities_province_id" ON "public"."cities" USING "btree" ("province_id");



CREATE INDEX "idx_cities_region_id" ON "public"."cities" USING "btree" ("region_id");



CREATE INDEX "idx_email_outbox_created" ON "public"."email_outbox" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_email_outbox_queue" ON "public"."email_outbox" USING "btree" ("status", "attempt_count", "created_at");



CREATE INDEX "idx_extraction_artifacts_aip_id" ON "public"."extraction_artifacts" USING "btree" ("aip_id");



CREATE INDEX "idx_extraction_artifacts_run_id" ON "public"."extraction_artifacts" USING "btree" ("run_id");



CREATE INDEX "idx_extraction_artifacts_type" ON "public"."extraction_artifacts" USING "btree" ("artifact_type");



CREATE INDEX "idx_extraction_runs_aip_id" ON "public"."extraction_runs" USING "btree" ("aip_id");



CREATE INDEX "idx_extraction_runs_created_at" ON "public"."extraction_runs" USING "btree" ("created_at");



CREATE INDEX "idx_extraction_runs_retry_of_run_id" ON "public"."extraction_runs" USING "btree" ("retry_of_run_id");



CREATE INDEX "idx_extraction_runs_stage" ON "public"."extraction_runs" USING "btree" ("stage");



CREATE INDEX "idx_extraction_runs_status" ON "public"."extraction_runs" USING "btree" ("status");



CREATE INDEX "idx_extraction_runs_uploaded_file_id" ON "public"."extraction_runs" USING "btree" ("uploaded_file_id");



CREATE INDEX "idx_feedback_aip_created_id" ON "public"."feedback" USING "btree" ("aip_id", "created_at", "id") WHERE (("target_type" = 'aip'::"public"."feedback_target_type") AND ("aip_id" IS NOT NULL));



CREATE INDEX "idx_feedback_aip_id" ON "public"."feedback" USING "btree" ("aip_id") WHERE ("aip_id" IS NOT NULL);



CREATE INDEX "idx_feedback_created_at" ON "public"."feedback" USING "btree" ("created_at");



CREATE INDEX "idx_feedback_kind" ON "public"."feedback" USING "btree" ("kind");



CREATE INDEX "idx_feedback_parent" ON "public"."feedback" USING "btree" ("parent_feedback_id") WHERE ("parent_feedback_id" IS NOT NULL);



CREATE INDEX "idx_feedback_parent_created_id" ON "public"."feedback" USING "btree" ("parent_feedback_id", "created_at", "id") WHERE ("parent_feedback_id" IS NOT NULL);



CREATE INDEX "idx_feedback_project_created_id" ON "public"."feedback" USING "btree" ("project_id", "created_at", "id") WHERE (("target_type" = 'project'::"public"."feedback_target_type") AND ("project_id" IS NOT NULL));



CREATE INDEX "idx_feedback_project_id" ON "public"."feedback" USING "btree" ("project_id") WHERE ("project_id" IS NOT NULL);



CREATE INDEX "idx_feedback_roots_aip_kind_updated" ON "public"."feedback" USING "btree" ("aip_id", "kind", "updated_at" DESC, "id") WHERE (("target_type" = 'aip'::"public"."feedback_target_type") AND ("parent_feedback_id" IS NULL) AND ("aip_id" IS NOT NULL));



CREATE INDEX "idx_feedback_roots_project_kind_updated" ON "public"."feedback" USING "btree" ("project_id", "kind", "updated_at" DESC, "id") WHERE (("target_type" = 'project'::"public"."feedback_target_type") AND ("parent_feedback_id" IS NULL) AND ("project_id" IS NOT NULL));



CREATE INDEX "idx_health_details_updated_at" ON "public"."health_project_details" USING "btree" ("updated_at");



CREATE INDEX "idx_infra_details_updated_at" ON "public"."infrastructure_project_details" USING "btree" ("updated_at");



CREATE INDEX "idx_municipalities_province_id" ON "public"."municipalities" USING "btree" ("province_id");



CREATE INDEX "idx_notifications_entity" ON "public"."notifications" USING "btree" ("entity_type", "entity_id");



CREATE INDEX "idx_notifications_event_type" ON "public"."notifications" USING "btree" ("event_type");



CREATE INDEX "idx_notifications_recipient_created" ON "public"."notifications" USING "btree" ("recipient_user_id", "created_at" DESC);



CREATE INDEX "idx_notifications_unread" ON "public"."notifications" USING "btree" ("recipient_user_id", "created_at" DESC) WHERE ("read_at" IS NULL);



CREATE INDEX "idx_profiles_barangay_id" ON "public"."profiles" USING "btree" ("barangay_id");



CREATE INDEX "idx_profiles_city_id" ON "public"."profiles" USING "btree" ("city_id");



CREATE INDEX "idx_profiles_municipality_id" ON "public"."profiles" USING "btree" ("municipality_id");



CREATE INDEX "idx_profiles_role" ON "public"."profiles" USING "btree" ("role");



CREATE INDEX "idx_project_update_media_project_id" ON "public"."project_update_media" USING "btree" ("project_id");



CREATE INDEX "idx_project_update_media_update_created_id" ON "public"."project_update_media" USING "btree" ("update_id", "created_at", "id");



CREATE INDEX "idx_project_update_media_update_id" ON "public"."project_update_media" USING "btree" ("update_id");



CREATE INDEX "idx_project_updates_aip_id" ON "public"."project_updates" USING "btree" ("aip_id");



CREATE INDEX "idx_project_updates_created_at" ON "public"."project_updates" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_project_updates_hidden_at" ON "public"."project_updates" USING "btree" ("hidden_at" DESC) WHERE ("hidden_at" IS NOT NULL);



CREATE INDEX "idx_project_updates_hidden_by" ON "public"."project_updates" USING "btree" ("hidden_by") WHERE ("hidden_by" IS NOT NULL);



CREATE INDEX "idx_project_updates_project_id" ON "public"."project_updates" USING "btree" ("project_id");



CREATE INDEX "idx_project_updates_project_status_created_id" ON "public"."project_updates" USING "btree" ("project_id", "status", "created_at" DESC, "id");



CREATE INDEX "idx_projects_aip_created_id" ON "public"."projects" USING "btree" ("aip_id", "created_at" DESC, "id");



CREATE INDEX "idx_projects_aip_id" ON "public"."projects" USING "btree" ("aip_id");



CREATE INDEX "idx_projects_aip_id_id" ON "public"."projects" USING "btree" ("aip_id", "id");



CREATE INDEX "idx_projects_category" ON "public"."projects" USING "btree" ("category");



CREATE INDEX "idx_projects_created_at" ON "public"."projects" USING "btree" ("created_at");



CREATE INDEX "idx_projects_extraction_artifact" ON "public"."projects" USING "btree" ("extraction_artifact_id");



CREATE INDEX "idx_projects_human_edited" ON "public"."projects" USING "btree" ("is_human_edited");



CREATE INDEX "idx_projects_image_url_not_null" ON "public"."projects" USING "btree" ("image_url") WHERE ("image_url" IS NOT NULL);



CREATE INDEX "idx_projects_ref_aip_created_id" ON "public"."projects" USING "btree" ("aip_ref_code", "aip_id", "created_at" DESC, "id" DESC);



CREATE INDEX "idx_projects_sector" ON "public"."projects" USING "btree" ("sector_code");



CREATE INDEX "idx_projects_status" ON "public"."projects" USING "btree" ("status");



CREATE INDEX "idx_projects_total" ON "public"."projects" USING "btree" ("total");



CREATE INDEX "idx_provinces_region_id" ON "public"."provinces" USING "btree" ("region_id");



CREATE INDEX "idx_uploaded_files_aip_id" ON "public"."uploaded_files" USING "btree" ("aip_id");



CREATE INDEX "idx_uploaded_files_created_at" ON "public"."uploaded_files" USING "btree" ("created_at");



CREATE INDEX "idx_uploaded_files_sha256_hex" ON "public"."uploaded_files" USING "btree" ("sha256_hex");



CREATE INDEX "idx_uploaded_files_uploaded_by" ON "public"."uploaded_files" USING "btree" ("uploaded_by");



CREATE UNIQUE INDEX "uq_aip_line_items_aip_provenance" ON "public"."aip_line_items" USING "btree" ("aip_id", "page_no", "row_no", "table_no") WHERE (("aip_ref_code" IS NULL) AND ("page_no" IS NOT NULL) AND ("row_no" IS NOT NULL) AND ("table_no" IS NOT NULL));



CREATE UNIQUE INDEX "uq_aip_line_items_aip_ref" ON "public"."aip_line_items" USING "btree" ("aip_id", "aip_ref_code") WHERE ("aip_ref_code" IS NOT NULL);



CREATE UNIQUE INDEX "uq_aips_barangay_year" ON "public"."aips" USING "btree" ("barangay_id", "fiscal_year") WHERE ("barangay_id" IS NOT NULL);



CREATE UNIQUE INDEX "uq_aips_city_year" ON "public"."aips" USING "btree" ("city_id", "fiscal_year") WHERE ("city_id" IS NOT NULL);



CREATE UNIQUE INDEX "uq_aips_municipality_year" ON "public"."aips" USING "btree" ("municipality_id", "fiscal_year") WHERE ("municipality_id" IS NOT NULL);



CREATE UNIQUE INDEX "uq_email_outbox_email_dedupe" ON "public"."email_outbox" USING "btree" ("to_email", "dedupe_key");



CREATE UNIQUE INDEX "uq_notifications_recipient_dedupe" ON "public"."notifications" USING "btree" ("recipient_user_id", "dedupe_key");



CREATE UNIQUE INDEX "uq_profiles_email_lower" ON "public"."profiles" USING "btree" ("lower"("email")) WHERE ("email" IS NOT NULL);



CREATE UNIQUE INDEX "uq_project_update_media_bucket_object" ON "public"."project_update_media" USING "btree" ("bucket_id", "object_name");



CREATE UNIQUE INDEX "uq_uploaded_files_bucket_object" ON "public"."uploaded_files" USING "btree" ("bucket_id", "object_name");



CREATE UNIQUE INDEX "uq_uploaded_files_current_per_aip" ON "public"."uploaded_files" USING "btree" ("aip_id") WHERE ("is_current" = true);



CREATE OR REPLACE TRIGGER "trg_aip_published_embed_categorize" AFTER UPDATE OF "status" ON "public"."aips" FOR EACH ROW EXECUTE FUNCTION "public"."on_aip_published_embed_categorize"();



CREATE OR REPLACE TRIGGER "trg_aip_reviews_activity_log_crud" AFTER INSERT OR DELETE OR UPDATE ON "public"."aip_reviews" FOR EACH ROW EXECUTE FUNCTION "public"."trg_aip_reviews_activity_log_crud"();



CREATE OR REPLACE TRIGGER "trg_aips_activity_log_crud" AFTER INSERT OR DELETE OR UPDATE ON "public"."aips" FOR EACH ROW EXECUTE FUNCTION "public"."trg_aips_activity_log_crud"();



CREATE OR REPLACE TRIGGER "trg_aips_set_timestamps" BEFORE INSERT OR UPDATE ON "public"."aips" FOR EACH ROW EXECUTE FUNCTION "public"."aips_set_timestamps"();



CREATE OR REPLACE TRIGGER "trg_chat_messages_touch_session" AFTER INSERT ON "public"."chat_messages" FOR EACH ROW EXECUTE FUNCTION "public"."chat_sessions_touch_last_message_at"();



CREATE OR REPLACE TRIGGER "trg_chat_sessions_set_updated_at" BEFORE UPDATE ON "public"."chat_sessions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_cities_region_consistency" BEFORE INSERT OR UPDATE OF "region_id", "province_id" ON "public"."cities" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_city_region_consistency"();



CREATE OR REPLACE TRIGGER "trg_extraction_artifacts_delete_storage_object" AFTER DELETE ON "public"."extraction_artifacts" FOR EACH ROW EXECUTE FUNCTION "public"."extraction_artifacts_delete_storage_object"();



CREATE OR REPLACE TRIGGER "trg_extraction_runs_emit_admin_pipeline_failed" AFTER INSERT OR UPDATE OF "status" ON "public"."extraction_runs" FOR EACH ROW EXECUTE FUNCTION "public"."emit_admin_pipeline_job_failed"();



CREATE OR REPLACE TRIGGER "trg_extraction_runs_emit_uploader_terminal_notifications" AFTER INSERT OR UPDATE OF "status" ON "public"."extraction_runs" FOR EACH ROW EXECUTE FUNCTION "public"."emit_uploader_extraction_terminal_notifications"();



CREATE OR REPLACE TRIGGER "trg_feedback_activity_log_crud" AFTER INSERT OR DELETE OR UPDATE ON "public"."feedback" FOR EACH ROW EXECUTE FUNCTION "public"."trg_feedback_activity_log_crud"();



CREATE OR REPLACE TRIGGER "trg_feedback_enforce_parent_target" BEFORE INSERT OR UPDATE OF "parent_feedback_id", "target_type", "aip_id", "project_id" ON "public"."feedback" FOR EACH ROW EXECUTE FUNCTION "public"."feedback_enforce_parent_target"();



CREATE OR REPLACE TRIGGER "trg_feedback_set_updated_at" BEFORE UPDATE ON "public"."feedback" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_health_project_details_set_updated_at" BEFORE UPDATE ON "public"."health_project_details" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_infra_project_details_set_updated_at" BEFORE UPDATE ON "public"."infrastructure_project_details" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_notification_preferences_set_updated_at" BEFORE UPDATE ON "public"."notification_preferences" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_notifications_guard_read_update" BEFORE UPDATE ON "public"."notifications" FOR EACH ROW EXECUTE FUNCTION "public"."notifications_guard_read_update"();



CREATE OR REPLACE TRIGGER "trg_profiles_enforce_update_rules" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_profile_update_rules"();



CREATE OR REPLACE TRIGGER "trg_profiles_prevent_last_active_admin_delete" BEFORE DELETE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_last_active_admin_mutation"();



CREATE OR REPLACE TRIGGER "trg_profiles_prevent_last_active_admin_update" BEFORE UPDATE OF "role", "is_active" ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_last_active_admin_mutation"();



CREATE OR REPLACE TRIGGER "trg_profiles_set_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_project_update_media_delete_storage_object" AFTER DELETE ON "public"."project_update_media" FOR EACH ROW EXECUTE FUNCTION "public"."project_update_media_delete_storage_object"();



CREATE OR REPLACE TRIGGER "trg_project_updates_set_updated_at" BEFORE UPDATE ON "public"."project_updates" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_projects_activity_log_crud" AFTER INSERT OR DELETE OR UPDATE ON "public"."projects" FOR EACH ROW EXECUTE FUNCTION "public"."trg_projects_activity_log_crud"();



CREATE OR REPLACE TRIGGER "trg_projects_delete_cover_image_on_delete" AFTER DELETE ON "public"."projects" FOR EACH ROW EXECUTE FUNCTION "public"."projects_delete_cover_image_object"();



CREATE OR REPLACE TRIGGER "trg_projects_delete_cover_image_on_update" AFTER UPDATE OF "image_url" ON "public"."projects" FOR EACH ROW EXECUTE FUNCTION "public"."projects_delete_cover_image_object"();



CREATE OR REPLACE TRIGGER "trg_projects_set_updated_at" BEFORE UPDATE ON "public"."projects" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_uploaded_files_delete_storage_object" AFTER DELETE ON "public"."uploaded_files" FOR EACH ROW EXECUTE FUNCTION "public"."uploaded_files_delete_storage_object"();



CREATE OR REPLACE TRIGGER "trg_uploaded_files_single_current" AFTER INSERT OR UPDATE OF "is_current" ON "public"."uploaded_files" FOR EACH ROW EXECUTE FUNCTION "public"."uploaded_files_set_single_current"();



ALTER TABLE ONLY "public"."activity_log"
    ADD CONSTRAINT "activity_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."activity_log"
    ADD CONSTRAINT "activity_log_barangay_id_fkey" FOREIGN KEY ("barangay_id") REFERENCES "public"."barangays"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."activity_log"
    ADD CONSTRAINT "activity_log_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."activity_log"
    ADD CONSTRAINT "activity_log_municipality_id_fkey" FOREIGN KEY ("municipality_id") REFERENCES "public"."municipalities"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."activity_log"
    ADD CONSTRAINT "activity_log_province_id_fkey" FOREIGN KEY ("province_id") REFERENCES "public"."provinces"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."activity_log"
    ADD CONSTRAINT "activity_log_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."aip_chunk_embeddings"
    ADD CONSTRAINT "aip_chunk_embeddings_aip_id_fkey" FOREIGN KEY ("aip_id") REFERENCES "public"."aips"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."aip_chunk_embeddings"
    ADD CONSTRAINT "aip_chunk_embeddings_chunk_id_fkey" FOREIGN KEY ("chunk_id") REFERENCES "public"."aip_chunks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."aip_chunks"
    ADD CONSTRAINT "aip_chunks_aip_id_fkey" FOREIGN KEY ("aip_id") REFERENCES "public"."aips"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."aip_chunks"
    ADD CONSTRAINT "aip_chunks_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "public"."extraction_runs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."aip_chunks"
    ADD CONSTRAINT "aip_chunks_uploaded_file_id_fkey" FOREIGN KEY ("uploaded_file_id") REFERENCES "public"."uploaded_files"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."aip_line_item_embeddings"
    ADD CONSTRAINT "aip_line_item_embeddings_line_item_id_fkey" FOREIGN KEY ("line_item_id") REFERENCES "public"."aip_line_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."aip_line_items"
    ADD CONSTRAINT "aip_line_items_aip_id_fkey" FOREIGN KEY ("aip_id") REFERENCES "public"."aips"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."aip_line_items"
    ADD CONSTRAINT "aip_line_items_barangay_id_fkey" FOREIGN KEY ("barangay_id") REFERENCES "public"."barangays"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."aip_reviews"
    ADD CONSTRAINT "aip_reviews_aip_id_fkey" FOREIGN KEY ("aip_id") REFERENCES "public"."aips"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."aip_reviews"
    ADD CONSTRAINT "aip_reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."aip_totals"
    ADD CONSTRAINT "aip_totals_aip_id_fkey" FOREIGN KEY ("aip_id") REFERENCES "public"."aips"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."aip_totals"
    ADD CONSTRAINT "aip_totals_barangay_id_fkey" FOREIGN KEY ("barangay_id") REFERENCES "public"."barangays"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."aip_totals"
    ADD CONSTRAINT "aip_totals_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."aip_totals"
    ADD CONSTRAINT "aip_totals_municipality_id_fkey" FOREIGN KEY ("municipality_id") REFERENCES "public"."municipalities"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."aip_upload_validation_logs"
    ADD CONSTRAINT "aip_upload_validation_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."aips"
    ADD CONSTRAINT "aips_barangay_id_fkey" FOREIGN KEY ("barangay_id") REFERENCES "public"."barangays"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."aips"
    ADD CONSTRAINT "aips_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."aips"
    ADD CONSTRAINT "aips_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."aips"
    ADD CONSTRAINT "aips_municipality_id_fkey" FOREIGN KEY ("municipality_id") REFERENCES "public"."municipalities"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."barangays"
    ADD CONSTRAINT "barangays_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."barangays"
    ADD CONSTRAINT "barangays_municipality_id_fkey" FOREIGN KEY ("municipality_id") REFERENCES "public"."municipalities"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."chat_messages"
    ADD CONSTRAINT "chat_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chat_rate_events"
    ADD CONSTRAINT "chat_rate_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chat_sessions"
    ADD CONSTRAINT "chat_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cities"
    ADD CONSTRAINT "cities_province_id_fkey" FOREIGN KEY ("province_id") REFERENCES "public"."provinces"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."cities"
    ADD CONSTRAINT "cities_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."email_outbox"
    ADD CONSTRAINT "email_outbox_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."extraction_artifacts"
    ADD CONSTRAINT "extraction_artifacts_aip_id_fkey" FOREIGN KEY ("aip_id") REFERENCES "public"."aips"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."extraction_artifacts"
    ADD CONSTRAINT "extraction_artifacts_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "public"."extraction_runs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."extraction_runs"
    ADD CONSTRAINT "extraction_runs_aip_id_fkey" FOREIGN KEY ("aip_id") REFERENCES "public"."aips"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."extraction_runs"
    ADD CONSTRAINT "extraction_runs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."extraction_runs"
    ADD CONSTRAINT "extraction_runs_retry_of_run_id_fkey" FOREIGN KEY ("retry_of_run_id") REFERENCES "public"."extraction_runs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."extraction_runs"
    ADD CONSTRAINT "extraction_runs_uploaded_file_id_fkey" FOREIGN KEY ("uploaded_file_id") REFERENCES "public"."uploaded_files"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."feedback"
    ADD CONSTRAINT "feedback_aip_id_fkey" FOREIGN KEY ("aip_id") REFERENCES "public"."aips"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."feedback"
    ADD CONSTRAINT "feedback_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."feedback"
    ADD CONSTRAINT "feedback_extraction_artifact_id_fkey" FOREIGN KEY ("extraction_artifact_id") REFERENCES "public"."extraction_artifacts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."feedback"
    ADD CONSTRAINT "feedback_extraction_run_id_fkey" FOREIGN KEY ("extraction_run_id") REFERENCES "public"."extraction_runs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."feedback"
    ADD CONSTRAINT "feedback_parent_feedback_id_fkey" FOREIGN KEY ("parent_feedback_id") REFERENCES "public"."feedback"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."feedback"
    ADD CONSTRAINT "feedback_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "fk_projects_sector" FOREIGN KEY ("sector_code") REFERENCES "public"."sectors"("code");



ALTER TABLE ONLY "public"."health_project_details"
    ADD CONSTRAINT "health_project_details_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."health_project_details"
    ADD CONSTRAINT "health_project_details_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."infrastructure_project_details"
    ADD CONSTRAINT "infrastructure_project_details_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."infrastructure_project_details"
    ADD CONSTRAINT "infrastructure_project_details_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."municipalities"
    ADD CONSTRAINT "municipalities_province_id_fkey" FOREIGN KEY ("province_id") REFERENCES "public"."provinces"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."notification_preferences"
    ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_barangay_id_fkey" FOREIGN KEY ("barangay_id") REFERENCES "public"."barangays"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_municipality_id_fkey" FOREIGN KEY ("municipality_id") REFERENCES "public"."municipalities"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."project_update_media"
    ADD CONSTRAINT "project_update_media_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_update_media"
    ADD CONSTRAINT "project_update_media_update_id_fkey" FOREIGN KEY ("update_id") REFERENCES "public"."project_updates"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_updates"
    ADD CONSTRAINT "project_updates_aip_id_fkey" FOREIGN KEY ("aip_id") REFERENCES "public"."aips"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_updates"
    ADD CONSTRAINT "project_updates_hidden_by_fkey" FOREIGN KEY ("hidden_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."project_updates"
    ADD CONSTRAINT "project_updates_posted_by_fkey" FOREIGN KEY ("posted_by") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."project_updates"
    ADD CONSTRAINT "project_updates_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_aip_id_fkey" FOREIGN KEY ("aip_id") REFERENCES "public"."aips"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_edited_by_fkey" FOREIGN KEY ("edited_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_extraction_artifact_id_fkey" FOREIGN KEY ("extraction_artifact_id") REFERENCES "public"."extraction_artifacts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."provinces"
    ADD CONSTRAINT "provinces_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."uploaded_files"
    ADD CONSTRAINT "uploaded_files_aip_id_fkey" FOREIGN KEY ("aip_id") REFERENCES "public"."aips"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."uploaded_files"
    ADD CONSTRAINT "uploaded_files_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE "public"."activity_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "activity_log_select_policy" ON "public"."activity_log" FOR SELECT TO "authenticated" USING (("public"."is_active_auth"() AND ("public"."is_admin"() OR ("public"."is_barangay_official"() AND ("actor_role" = 'barangay_official'::"text") AND ("barangay_id" IS NOT NULL) AND ("barangay_id" = "public"."current_barangay_id"())) OR ("public"."is_city_official"() AND ("actor_role" = 'city_official'::"text") AND ("city_id" IS NOT NULL) AND ("city_id" = "public"."current_city_id"())) OR ("public"."is_municipal_official"() AND ("actor_id" = "public"."current_user_id"())))));



ALTER TABLE "public"."aip_chunk_embeddings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."aip_chunks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."aip_line_item_embeddings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."aip_line_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "aip_line_items_select_policy" ON "public"."aip_line_items" FOR SELECT TO "authenticated" USING (("public"."is_active_auth"() AND "public"."can_read_aip"("aip_id")));



ALTER TABLE "public"."aip_reviews" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "aip_reviews_delete_policy" ON "public"."aip_reviews" FOR DELETE TO "authenticated" USING (("public"."is_active_auth"() AND "public"."is_admin"()));



CREATE POLICY "aip_reviews_insert_policy" ON "public"."aip_reviews" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_active_auth"() AND ("reviewer_id" = "public"."current_user_id"()) AND (EXISTS ( SELECT 1
   FROM "public"."aips" "a"
  WHERE (("a"."id" = "aip_reviews"."aip_id") AND ("a"."status" <> 'draft'::"public"."aip_status") AND ("public"."is_admin"() OR ("public"."is_city_official"() AND ((("a"."city_id" IS NOT NULL) AND ("a"."city_id" = "public"."current_city_id"())) OR (("a"."barangay_id" IS NOT NULL) AND "public"."barangay_in_my_city"("a"."barangay_id")))) OR ("public"."is_municipal_official"() AND ((("a"."municipality_id" IS NOT NULL) AND ("a"."municipality_id" = "public"."current_municipality_id"())) OR (("a"."barangay_id" IS NOT NULL) AND "public"."barangay_in_my_municipality"("a"."barangay_id"))))))))));



CREATE POLICY "aip_reviews_select_policy" ON "public"."aip_reviews" FOR SELECT TO "authenticated", "anon" USING ("public"."can_read_aip"("aip_id"));



CREATE POLICY "aip_reviews_update_policy" ON "public"."aip_reviews" FOR UPDATE TO "authenticated" USING (("public"."is_active_auth"() AND "public"."is_admin"())) WITH CHECK (("public"."is_active_auth"() AND "public"."is_admin"()));



ALTER TABLE "public"."aip_totals" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "aip_totals_select_policy" ON "public"."aip_totals" FOR SELECT TO "authenticated" USING ("public"."is_active_auth"());



ALTER TABLE "public"."aip_upload_validation_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "aip_upload_validation_logs_select_policy" ON "public"."aip_upload_validation_logs" FOR SELECT TO "authenticated" USING (("public"."is_active_auth"() AND "public"."is_admin"()));



ALTER TABLE "public"."aips" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "aips_delete_policy" ON "public"."aips" FOR DELETE TO "authenticated" USING (("public"."is_active_auth"() AND "public"."is_admin"()));



CREATE POLICY "aips_insert_policy" ON "public"."aips" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_active_auth"() AND ("public"."is_admin"() OR ("public"."is_barangay_official"() AND ("barangay_id" IS NOT NULL) AND ("barangay_id" = "public"."current_barangay_id"()) AND ("city_id" IS NULL) AND ("municipality_id" IS NULL)) OR ("public"."is_city_official"() AND ("city_id" IS NOT NULL) AND ("city_id" = "public"."current_city_id"()) AND ("barangay_id" IS NULL) AND ("municipality_id" IS NULL)) OR ("public"."is_municipal_official"() AND ("municipality_id" IS NOT NULL) AND ("municipality_id" = "public"."current_municipality_id"()) AND ("barangay_id" IS NULL) AND ("city_id" IS NULL)))));



CREATE POLICY "aips_select_policy" ON "public"."aips" FOR SELECT TO "authenticated", "anon" USING ((("status" <> 'draft'::"public"."aip_status") OR ("public"."is_active_auth"() AND ("status" = 'draft'::"public"."aip_status") AND ("public"."is_admin"() OR ("public"."is_barangay_official"() AND ("barangay_id" IS NOT NULL) AND ("barangay_id" = "public"."current_barangay_id"())) OR ("public"."is_city_official"() AND ("city_id" IS NOT NULL) AND ("city_id" = "public"."current_city_id"())) OR ("public"."is_municipal_official"() AND ("municipality_id" IS NOT NULL) AND ("municipality_id" = "public"."current_municipality_id"()))))));



CREATE POLICY "aips_update_policy" ON "public"."aips" FOR UPDATE TO "authenticated" USING (("public"."is_active_auth"() AND ("public"."is_admin"() OR ("public"."is_barangay_official"() AND ("barangay_id" IS NOT NULL) AND ("barangay_id" = "public"."current_barangay_id"()) AND "public"."can_manage_barangay_aip"("id")) OR ("public"."is_city_official"() AND ("city_id" IS NOT NULL) AND ("city_id" = "public"."current_city_id"())) OR ("public"."is_municipal_official"() AND ("municipality_id" IS NOT NULL) AND ("municipality_id" = "public"."current_municipality_id"())) OR ("public"."is_city_official"() AND ("barangay_id" IS NOT NULL) AND "public"."barangay_in_my_city"("barangay_id")) OR ("public"."is_municipal_official"() AND ("barangay_id" IS NOT NULL) AND "public"."barangay_in_my_municipality"("barangay_id"))))) WITH CHECK (("public"."is_active_auth"() AND ("public"."is_admin"() OR ("public"."is_barangay_official"() AND ("barangay_id" IS NOT NULL) AND ("barangay_id" = "public"."current_barangay_id"()) AND ("city_id" IS NULL) AND ("municipality_id" IS NULL) AND "public"."can_manage_barangay_aip"("id")) OR ("public"."is_city_official"() AND ("city_id" IS NOT NULL) AND ("city_id" = "public"."current_city_id"()) AND ("barangay_id" IS NULL) AND ("municipality_id" IS NULL)) OR ("public"."is_municipal_official"() AND ("municipality_id" IS NOT NULL) AND ("municipality_id" = "public"."current_municipality_id"()) AND ("barangay_id" IS NULL) AND ("city_id" IS NULL)) OR ("public"."is_city_official"() AND ("barangay_id" IS NOT NULL) AND "public"."barangay_in_my_city"("barangay_id") AND ("city_id" IS NULL) AND ("municipality_id" IS NULL)) OR ("public"."is_municipal_official"() AND ("barangay_id" IS NOT NULL) AND "public"."barangay_in_my_municipality"("barangay_id") AND ("city_id" IS NULL) AND ("municipality_id" IS NULL)))));



ALTER TABLE "public"."barangays" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "barangays_admin_delete" ON "public"."barangays" FOR DELETE TO "authenticated" USING (("public"."is_active_auth"() AND "public"."is_admin"()));



CREATE POLICY "barangays_admin_insert" ON "public"."barangays" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_active_auth"() AND "public"."is_admin"()));



CREATE POLICY "barangays_admin_update" ON "public"."barangays" FOR UPDATE TO "authenticated" USING (("public"."is_active_auth"() AND "public"."is_admin"())) WITH CHECK (("public"."is_active_auth"() AND "public"."is_admin"()));



CREATE POLICY "barangays_select_policy" ON "public"."barangays" FOR SELECT TO "authenticated", "anon" USING ((("is_active" = true) OR ("public"."is_active_auth"() AND "public"."is_admin"())));



ALTER TABLE "public"."chat_messages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "chat_messages_insert_policy" ON "public"."chat_messages" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_active_auth"() AND "public"."can_access_chat_session"("session_id") AND ("role" = 'user'::"text")));



CREATE POLICY "chat_messages_select_policy" ON "public"."chat_messages" FOR SELECT TO "authenticated" USING (("public"."is_active_auth"() AND "public"."can_access_chat_session"("session_id")));



ALTER TABLE "public"."chat_rate_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "chat_rate_events_select_admin_only" ON "public"."chat_rate_events" FOR SELECT TO "authenticated" USING (("public"."is_active_auth"() AND "public"."is_admin"()));



ALTER TABLE "public"."chat_sessions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "chat_sessions_delete_policy" ON "public"."chat_sessions" FOR DELETE TO "authenticated" USING (("public"."is_active_auth"() AND ("public"."is_admin"() OR ("user_id" = "public"."current_user_id"()))));



CREATE POLICY "chat_sessions_insert_policy" ON "public"."chat_sessions" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_active_auth"() AND ("user_id" = "public"."current_user_id"())));



CREATE POLICY "chat_sessions_select_policy" ON "public"."chat_sessions" FOR SELECT TO "authenticated" USING (("public"."is_active_auth"() AND ("public"."is_admin"() OR ("user_id" = "public"."current_user_id"()))));



CREATE POLICY "chat_sessions_update_policy" ON "public"."chat_sessions" FOR UPDATE TO "authenticated" USING (("public"."is_active_auth"() AND ("public"."is_admin"() OR ("user_id" = "public"."current_user_id"())))) WITH CHECK (("public"."is_active_auth"() AND ("public"."is_admin"() OR ("user_id" = "public"."current_user_id"()))));



ALTER TABLE "public"."cities" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cities_admin_delete" ON "public"."cities" FOR DELETE TO "authenticated" USING (("public"."is_active_auth"() AND "public"."is_admin"()));



CREATE POLICY "cities_admin_insert" ON "public"."cities" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_active_auth"() AND "public"."is_admin"()));



CREATE POLICY "cities_admin_update" ON "public"."cities" FOR UPDATE TO "authenticated" USING (("public"."is_active_auth"() AND "public"."is_admin"())) WITH CHECK (("public"."is_active_auth"() AND "public"."is_admin"()));



CREATE POLICY "cities_select_policy" ON "public"."cities" FOR SELECT TO "authenticated", "anon" USING ((("is_active" = true) OR ("public"."is_active_auth"() AND "public"."is_admin"())));



ALTER TABLE "public"."email_outbox" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."extraction_artifacts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "extraction_artifacts_select_policy" ON "public"."extraction_artifacts" FOR SELECT TO "authenticated", "anon" USING ((EXISTS ( SELECT 1
   FROM "public"."aips" "a"
  WHERE (("a"."id" = "extraction_artifacts"."aip_id") AND ((("a"."status" <> 'draft'::"public"."aip_status") AND ("extraction_artifacts"."artifact_type" = ANY (ARRAY['summarize'::"public"."pipeline_stage", 'categorize'::"public"."pipeline_stage"]))) OR ("public"."is_active_auth"() AND ("public"."is_admin"() OR ("public"."is_barangay_official"() AND ("a"."barangay_id" IS NOT NULL) AND ("a"."barangay_id" = "public"."current_barangay_id"())) OR ("public"."is_city_official"() AND ("a"."city_id" IS NOT NULL) AND ("a"."city_id" = "public"."current_city_id"())) OR ("public"."is_municipal_official"() AND ("a"."municipality_id" IS NOT NULL) AND ("a"."municipality_id" = "public"."current_municipality_id"())))))))));



ALTER TABLE "public"."extraction_runs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "extraction_runs_select_policy" ON "public"."extraction_runs" FOR SELECT TO "authenticated", "anon" USING ("public"."can_read_aip"("aip_id"));



ALTER TABLE "public"."feedback" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "feedback_delete_policy" ON "public"."feedback" FOR DELETE TO "authenticated" USING (("public"."is_active_auth"() AND ("public"."is_admin"() OR (("source" = 'human'::"public"."feedback_source") AND ("author_id" = "public"."current_user_id"())))));



CREATE POLICY "feedback_insert_policy" ON "public"."feedback" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_active_auth"() AND ("source" = 'human'::"public"."feedback_source") AND ("author_id" = "public"."current_user_id"()) AND ((("target_type" = 'aip'::"public"."feedback_target_type") AND ("aip_id" IS NOT NULL) AND ("public"."is_admin"() OR ("public"."is_citizen"() AND "public"."can_citizen_write_aip_feedback"("aip_id") AND ("kind" = ANY (ARRAY['question'::"public"."feedback_kind", 'suggestion'::"public"."feedback_kind", 'concern'::"public"."feedback_kind", 'commend'::"public"."feedback_kind"]))) OR (("public"."can_owner_write_aip_feedback"("aip_id") OR "public"."can_reviewer_write_aip_feedback"("aip_id")) AND ("kind" = 'lgu_note'::"public"."feedback_kind")))) OR (("target_type" = 'project'::"public"."feedback_target_type") AND ("project_id" IS NOT NULL) AND ("public"."is_admin"() OR ("public"."is_citizen"() AND "public"."can_citizen_write_project_feedback"("project_id") AND ("kind" = ANY (ARRAY['question'::"public"."feedback_kind", 'suggestion'::"public"."feedback_kind", 'concern'::"public"."feedback_kind", 'commend'::"public"."feedback_kind"]))) OR ("public"."can_owner_write_project_feedback"("project_id") AND ("kind" = 'lgu_note'::"public"."feedback_kind")))))));



CREATE POLICY "feedback_select_policy" ON "public"."feedback" FOR SELECT TO "authenticated", "anon" USING (((("is_public" = true) AND ((("target_type" = 'aip'::"public"."feedback_target_type") AND ("aip_id" IS NOT NULL) AND "public"."can_public_read_aip_feedback"("aip_id")) OR (("target_type" = 'project'::"public"."feedback_target_type") AND ("project_id" IS NOT NULL) AND "public"."can_public_read_project_feedback"("project_id")))) OR ("public"."is_active_auth"() AND ("public"."is_admin"() OR (("target_type" = 'aip'::"public"."feedback_target_type") AND ("aip_id" IS NOT NULL) AND "public"."can_read_aip"("aip_id")) OR (("target_type" = 'project'::"public"."feedback_target_type") AND ("project_id" IS NOT NULL) AND "public"."can_read_project"("project_id"))))));



CREATE POLICY "feedback_update_policy" ON "public"."feedback" FOR UPDATE TO "authenticated" USING (("public"."is_active_auth"() AND ("public"."is_admin"() OR ("author_id" = "public"."current_user_id"())))) WITH CHECK (("public"."is_active_auth"() AND ("public"."is_admin"() OR (("author_id" = "public"."current_user_id"()) AND ("source" = 'human'::"public"."feedback_source") AND ((("target_type" = 'aip'::"public"."feedback_target_type") AND ("aip_id" IS NOT NULL) AND (("public"."is_citizen"() AND "public"."can_citizen_write_aip_feedback"("aip_id") AND ("kind" = ANY (ARRAY['question'::"public"."feedback_kind", 'suggestion'::"public"."feedback_kind", 'concern'::"public"."feedback_kind", 'commend'::"public"."feedback_kind"]))) OR (("public"."can_owner_write_aip_feedback"("aip_id") OR "public"."can_reviewer_write_aip_feedback"("aip_id")) AND ("kind" = 'lgu_note'::"public"."feedback_kind")))) OR (("target_type" = 'project'::"public"."feedback_target_type") AND ("project_id" IS NOT NULL) AND (("public"."is_citizen"() AND "public"."can_citizen_write_project_feedback"("project_id") AND ("kind" = ANY (ARRAY['question'::"public"."feedback_kind", 'suggestion'::"public"."feedback_kind", 'concern'::"public"."feedback_kind", 'commend'::"public"."feedback_kind"]))) OR ("public"."can_owner_write_project_feedback"("project_id") AND ("kind" = 'lgu_note'::"public"."feedback_kind")))))))));



CREATE POLICY "health_details_delete_policy" ON "public"."health_project_details" FOR DELETE TO "authenticated" USING (("public"."is_active_auth"() AND "public"."can_edit_project"("project_id")));



CREATE POLICY "health_details_insert_policy" ON "public"."health_project_details" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_active_auth"() AND ("public"."can_edit_project"("project_id") OR "public"."can_write_published_project"("project_id")) AND (("updated_by" IS NULL) OR ("updated_by" = "public"."current_user_id"()))));



CREATE POLICY "health_details_select_policy" ON "public"."health_project_details" FOR SELECT TO "authenticated", "anon" USING ("public"."can_read_project"("project_id"));



CREATE POLICY "health_details_update_policy" ON "public"."health_project_details" FOR UPDATE TO "authenticated" USING (("public"."is_active_auth"() AND ("public"."can_edit_project"("project_id") OR "public"."can_write_published_project"("project_id")))) WITH CHECK (("public"."is_active_auth"() AND ("public"."can_edit_project"("project_id") OR "public"."can_write_published_project"("project_id"))));



ALTER TABLE "public"."health_project_details" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "infra_details_delete_policy" ON "public"."infrastructure_project_details" FOR DELETE TO "authenticated" USING (("public"."is_active_auth"() AND "public"."can_edit_project"("project_id")));



CREATE POLICY "infra_details_insert_policy" ON "public"."infrastructure_project_details" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_active_auth"() AND ("public"."can_edit_project"("project_id") OR "public"."can_write_published_project"("project_id")) AND (("updated_by" IS NULL) OR ("updated_by" = "public"."current_user_id"()))));



CREATE POLICY "infra_details_select_policy" ON "public"."infrastructure_project_details" FOR SELECT TO "authenticated", "anon" USING ("public"."can_read_project"("project_id"));



CREATE POLICY "infra_details_update_policy" ON "public"."infrastructure_project_details" FOR UPDATE TO "authenticated" USING (("public"."is_active_auth"() AND ("public"."can_edit_project"("project_id") OR "public"."can_write_published_project"("project_id")))) WITH CHECK (("public"."is_active_auth"() AND ("public"."can_edit_project"("project_id") OR "public"."can_write_published_project"("project_id"))));



ALTER TABLE "public"."infrastructure_project_details" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."municipalities" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "municipalities_admin_delete" ON "public"."municipalities" FOR DELETE TO "authenticated" USING (("public"."is_active_auth"() AND "public"."is_admin"()));



CREATE POLICY "municipalities_admin_insert" ON "public"."municipalities" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_active_auth"() AND "public"."is_admin"()));



CREATE POLICY "municipalities_admin_update" ON "public"."municipalities" FOR UPDATE TO "authenticated" USING (("public"."is_active_auth"() AND "public"."is_admin"())) WITH CHECK (("public"."is_active_auth"() AND "public"."is_admin"()));



CREATE POLICY "municipalities_select_policy" ON "public"."municipalities" FOR SELECT TO "authenticated", "anon" USING ((("is_active" = true) OR ("public"."is_active_auth"() AND "public"."is_admin"())));



ALTER TABLE "public"."notification_preferences" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notification_preferences_insert_self" ON "public"."notification_preferences" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_active_auth"() AND ("auth"."uid"() = "user_id")));



CREATE POLICY "notification_preferences_select_self" ON "public"."notification_preferences" FOR SELECT TO "authenticated" USING (("public"."is_active_auth"() AND ("auth"."uid"() = "user_id")));



CREATE POLICY "notification_preferences_update_self" ON "public"."notification_preferences" FOR UPDATE TO "authenticated" USING (("public"."is_active_auth"() AND ("auth"."uid"() = "user_id"))) WITH CHECK (("public"."is_active_auth"() AND ("auth"."uid"() = "user_id")));



ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notifications_select_self" ON "public"."notifications" FOR SELECT TO "authenticated" USING (("public"."is_active_auth"() AND ("auth"."uid"() = "recipient_user_id")));



CREATE POLICY "notifications_update_self" ON "public"."notifications" FOR UPDATE TO "authenticated" USING (("public"."is_active_auth"() AND ("auth"."uid"() = "recipient_user_id"))) WITH CHECK (("public"."is_active_auth"() AND ("auth"."uid"() = "recipient_user_id")));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_delete_admin_only" ON "public"."profiles" FOR DELETE TO "authenticated" USING (("public"."is_active_auth"() AND "public"."is_admin"()));



CREATE POLICY "profiles_insert_admin_or_citizen_self" ON "public"."profiles" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_active_auth"() AND ("public"."is_admin"() OR (("id" = "public"."current_user_id"()) AND ("role" = 'citizen'::"public"."role_type") AND ("barangay_id" IS NOT NULL) AND ("city_id" IS NULL) AND ("municipality_id" IS NULL)))));



CREATE POLICY "profiles_select_self_or_admin" ON "public"."profiles" FOR SELECT TO "authenticated" USING (("public"."is_active_auth"() AND (("id" = "public"."current_user_id"()) OR "public"."is_admin"())));



CREATE POLICY "profiles_update_self_or_admin" ON "public"."profiles" FOR UPDATE TO "authenticated" USING (("public"."is_active_auth"() AND (("id" = "public"."current_user_id"()) OR "public"."is_admin"()))) WITH CHECK (("public"."is_active_auth"() AND (("id" = "public"."current_user_id"()) OR "public"."is_admin"())));



ALTER TABLE "public"."project_update_media" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "project_update_media_delete_policy" ON "public"."project_update_media" FOR DELETE TO "authenticated" USING ("public"."can_write_published_project_update"("project_id"));



CREATE POLICY "project_update_media_insert_policy" ON "public"."project_update_media" FOR INSERT TO "authenticated" WITH CHECK ("public"."can_write_published_project_update"("project_id"));



CREATE POLICY "project_update_media_select_policy" ON "public"."project_update_media" FOR SELECT TO "authenticated", "anon" USING ("public"."can_read_published_project_update"("project_id"));



CREATE POLICY "project_update_media_update_policy" ON "public"."project_update_media" FOR UPDATE TO "authenticated" USING ("public"."can_write_published_project_update"("project_id")) WITH CHECK ("public"."can_write_published_project_update"("project_id"));



ALTER TABLE "public"."project_updates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "project_updates_delete_policy" ON "public"."project_updates" FOR DELETE TO "authenticated" USING ("public"."can_write_published_project_update"("project_id"));



CREATE POLICY "project_updates_insert_policy" ON "public"."project_updates" FOR INSERT TO "authenticated" WITH CHECK (("public"."can_write_published_project_update"("project_id") AND ("posted_by" = "public"."current_user_id"())));



CREATE POLICY "project_updates_select_policy" ON "public"."project_updates" FOR SELECT TO "authenticated", "anon" USING ("public"."can_read_published_project_update"("project_id"));



CREATE POLICY "project_updates_update_policy" ON "public"."project_updates" FOR UPDATE TO "authenticated" USING ("public"."can_write_published_project_update"("project_id")) WITH CHECK ("public"."can_write_published_project_update"("project_id"));



ALTER TABLE "public"."projects" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "projects_delete_policy" ON "public"."projects" FOR DELETE TO "authenticated" USING (("public"."is_active_auth"() AND "public"."can_edit_aip"("aip_id")));



CREATE POLICY "projects_insert_policy" ON "public"."projects" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_active_auth"() AND "public"."can_edit_aip"("aip_id")));



CREATE POLICY "projects_select_policy" ON "public"."projects" FOR SELECT TO "authenticated", "anon" USING ("public"."can_read_aip"("aip_id"));



CREATE POLICY "projects_update_policy" ON "public"."projects" FOR UPDATE TO "authenticated" USING (("public"."is_active_auth"() AND ("public"."can_edit_aip"("aip_id") OR "public"."can_write_published_aip"("aip_id")))) WITH CHECK (("public"."is_active_auth"() AND ("public"."can_edit_aip"("aip_id") OR "public"."can_write_published_aip"("aip_id"))));



ALTER TABLE "public"."provinces" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "provinces_admin_delete" ON "public"."provinces" FOR DELETE TO "authenticated" USING (("public"."is_active_auth"() AND "public"."is_admin"()));



CREATE POLICY "provinces_admin_insert" ON "public"."provinces" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_active_auth"() AND "public"."is_admin"()));



CREATE POLICY "provinces_admin_update" ON "public"."provinces" FOR UPDATE TO "authenticated" USING (("public"."is_active_auth"() AND "public"."is_admin"())) WITH CHECK (("public"."is_active_auth"() AND "public"."is_admin"()));



CREATE POLICY "provinces_select_policy" ON "public"."provinces" FOR SELECT TO "authenticated", "anon" USING ((("is_active" = true) OR ("public"."is_active_auth"() AND "public"."is_admin"())));



ALTER TABLE "public"."regions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "regions_admin_delete" ON "public"."regions" FOR DELETE TO "authenticated" USING (("public"."is_active_auth"() AND "public"."is_admin"()));



CREATE POLICY "regions_admin_insert" ON "public"."regions" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_active_auth"() AND "public"."is_admin"()));



CREATE POLICY "regions_admin_update" ON "public"."regions" FOR UPDATE TO "authenticated" USING (("public"."is_active_auth"() AND "public"."is_admin"())) WITH CHECK (("public"."is_active_auth"() AND "public"."is_admin"()));



CREATE POLICY "regions_select_policy" ON "public"."regions" FOR SELECT TO "authenticated", "anon" USING ((("is_active" = true) OR ("public"."is_active_auth"() AND "public"."is_admin"())));



ALTER TABLE "public"."sectors" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sectors_delete_admin" ON "public"."sectors" FOR DELETE TO "authenticated" USING (("public"."is_active_auth"() AND "public"."is_admin"()));



CREATE POLICY "sectors_insert_admin" ON "public"."sectors" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_active_auth"() AND "public"."is_admin"()));



CREATE POLICY "sectors_select_public" ON "public"."sectors" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "sectors_update_admin" ON "public"."sectors" FOR UPDATE TO "authenticated" USING (("public"."is_active_auth"() AND "public"."is_admin"())) WITH CHECK (("public"."is_active_auth"() AND "public"."is_admin"()));



ALTER TABLE "public"."uploaded_files" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "uploaded_files_delete_policy" ON "public"."uploaded_files" FOR DELETE TO "authenticated" USING (("public"."is_active_auth"() AND "public"."is_admin"()));



CREATE POLICY "uploaded_files_insert_policy" ON "public"."uploaded_files" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_active_auth"() AND ("uploaded_by" = "public"."current_user_id"()) AND ("bucket_id" = 'aip-pdfs'::"text") AND "public"."can_upload_aip_pdf"("aip_id")));



CREATE POLICY "uploaded_files_select_policy" ON "public"."uploaded_files" FOR SELECT TO "authenticated", "anon" USING ((EXISTS ( SELECT 1
   FROM "public"."aips" "a"
  WHERE (("a"."id" = "uploaded_files"."aip_id") AND (("a"."status" <> 'draft'::"public"."aip_status") OR ("public"."is_active_auth"() AND "public"."can_read_aip"("a"."id")))))));



CREATE POLICY "uploaded_files_update_policy" ON "public"."uploaded_files" FOR UPDATE TO "authenticated" USING (("public"."is_active_auth"() AND "public"."is_admin"())) WITH CHECK (("public"."is_active_auth"() AND "public"."is_admin"()));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."extraction_runs";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."notifications";



GRANT USAGE ON SCHEMA "app" TO "service_role";









REVOKE USAGE ON SCHEMA "public" FROM PUBLIC;
GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";




































































































































































































































































































































































































































































































































GRANT ALL ON FUNCTION "public"."aips_set_timestamps"() TO "anon";
GRANT ALL ON FUNCTION "public"."aips_set_timestamps"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."aips_set_timestamps"() TO "service_role";



GRANT ALL ON FUNCTION "public"."barangay_in_my_city"("p_barangay_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."barangay_in_my_city"("p_barangay_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."barangay_in_my_city"("p_barangay_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."barangay_in_my_municipality"("p_barangay_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."barangay_in_my_municipality"("p_barangay_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."barangay_in_my_municipality"("p_barangay_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_access_chat_session"("p_session_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_access_chat_session"("p_session_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_access_chat_session"("p_session_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_citizen_write_aip_feedback"("p_aip_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_citizen_write_aip_feedback"("p_aip_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_citizen_write_aip_feedback"("p_aip_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_citizen_write_project_feedback"("p_project_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_citizen_write_project_feedback"("p_project_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_citizen_write_project_feedback"("p_project_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_edit_aip"("p_aip_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_edit_aip"("p_aip_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_edit_aip"("p_aip_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_edit_project"("p_project_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_edit_project"("p_project_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_edit_project"("p_project_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_manage_barangay_aip"("p_aip_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_manage_barangay_aip"("p_aip_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_manage_barangay_aip"("p_aip_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_owner_write_aip_feedback"("p_aip_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_owner_write_aip_feedback"("p_aip_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_owner_write_aip_feedback"("p_aip_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_owner_write_project_feedback"("p_project_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_owner_write_project_feedback"("p_project_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_owner_write_project_feedback"("p_project_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_public_read_aip_feedback"("p_aip_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_public_read_aip_feedback"("p_aip_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_public_read_aip_feedback"("p_aip_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_public_read_project_feedback"("p_project_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_public_read_project_feedback"("p_project_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_public_read_project_feedback"("p_project_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_read_aip"("p_aip_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_read_aip"("p_aip_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_read_aip"("p_aip_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_read_project"("p_project_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_read_project"("p_project_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_read_project"("p_project_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_read_published_project_update"("p_project_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_read_published_project_update"("p_project_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_read_published_project_update"("p_project_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_reviewer_write_aip_feedback"("p_aip_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_reviewer_write_aip_feedback"("p_aip_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_reviewer_write_aip_feedback"("p_aip_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_upload_aip_pdf"("p_aip_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_upload_aip_pdf"("p_aip_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_upload_aip_pdf"("p_aip_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_write_published_aip"("p_aip_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_write_published_aip"("p_aip_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_write_published_aip"("p_aip_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_write_published_project"("p_project_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_write_published_project"("p_project_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_write_published_project"("p_project_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_write_published_project_update"("p_project_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_write_published_project_update"("p_project_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_write_published_project_update"("p_project_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."chat_sessions_touch_last_message_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."chat_sessions_touch_last_message_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."chat_sessions_touch_last_message_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."claim_aip_review"("p_aip_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."claim_aip_review"("p_aip_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_aip_review"("p_aip_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."compare_fiscal_year_totals"("p_year_a" integer, "p_year_b" integer, "p_barangay_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compare_fiscal_year_totals"("p_year_a" integer, "p_year_b" integer, "p_barangay_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."compare_fiscal_year_totals"("p_year_a" integer, "p_year_b" integer, "p_barangay_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."compare_fiscal_year_totals_for_barangays"("p_year_a" integer, "p_year_b" integer, "p_barangay_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compare_fiscal_year_totals_for_barangays"("p_year_a" integer, "p_year_b" integer, "p_barangay_ids" "uuid"[]) TO "service_role";
GRANT ALL ON FUNCTION "public"."compare_fiscal_year_totals_for_barangays"("p_year_a" integer, "p_year_b" integer, "p_barangay_ids" "uuid"[]) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."consume_chat_quota"("p_user_id" "uuid", "p_per_hour" integer, "p_per_day" integer, "p_route" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."consume_chat_quota"("p_user_id" "uuid", "p_per_hour" integer, "p_per_day" integer, "p_route" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."current_auth_role"() TO "anon";
GRANT ALL ON FUNCTION "public"."current_auth_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_auth_role"() TO "service_role";



GRANT ALL ON FUNCTION "public"."current_barangay_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."current_barangay_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_barangay_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."current_city_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."current_city_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_city_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."current_municipality_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."current_municipality_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_municipality_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."current_role"() TO "anon";
GRANT ALL ON FUNCTION "public"."current_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_role"() TO "service_role";



GRANT ALL ON FUNCTION "public"."current_role_code"() TO "anon";
GRANT ALL ON FUNCTION "public"."current_role_code"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_role_code"() TO "service_role";



GRANT ALL ON FUNCTION "public"."current_user_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."current_user_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_user_id"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."dispatch_embed_categorize_for_aip"("p_aip_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."dispatch_embed_categorize_for_aip"("p_aip_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."emit_admin_pipeline_job_failed"() TO "anon";
GRANT ALL ON FUNCTION "public"."emit_admin_pipeline_job_failed"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."emit_admin_pipeline_job_failed"() TO "service_role";



GRANT ALL ON FUNCTION "public"."emit_uploader_extraction_terminal_notifications"() TO "anon";
GRANT ALL ON FUNCTION "public"."emit_uploader_extraction_terminal_notifications"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."emit_uploader_extraction_terminal_notifications"() TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_city_region_consistency"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_city_region_consistency"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_city_region_consistency"() TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_profile_update_rules"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_profile_update_rules"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_profile_update_rules"() TO "service_role";



GRANT ALL ON FUNCTION "public"."extraction_artifacts_delete_storage_object"() TO "anon";
GRANT ALL ON FUNCTION "public"."extraction_artifacts_delete_storage_object"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."extraction_artifacts_delete_storage_object"() TO "service_role";



GRANT ALL ON FUNCTION "public"."feedback_enforce_parent_target"() TO "anon";
GRANT ALL ON FUNCTION "public"."feedback_enforce_parent_target"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."feedback_enforce_parent_target"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_top_projects"("p_limit" integer, "p_fiscal_year" integer, "p_barangay_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_top_projects"("p_limit" integer, "p_fiscal_year" integer, "p_barangay_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."get_top_projects"("p_limit" integer, "p_fiscal_year" integer, "p_barangay_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_top_projects_for_barangays"("p_limit" integer, "p_fiscal_year" integer, "p_barangay_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_top_projects_for_barangays"("p_limit" integer, "p_fiscal_year" integer, "p_barangay_ids" "uuid"[]) TO "service_role";
GRANT ALL ON FUNCTION "public"."get_top_projects_for_barangays"("p_limit" integer, "p_fiscal_year" integer, "p_barangay_ids" "uuid"[]) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_totals_by_fund_source"("p_fiscal_year" integer, "p_barangay_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_totals_by_fund_source"("p_fiscal_year" integer, "p_barangay_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."get_totals_by_fund_source"("p_fiscal_year" integer, "p_barangay_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_totals_by_fund_source_for_barangays"("p_fiscal_year" integer, "p_barangay_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_totals_by_fund_source_for_barangays"("p_fiscal_year" integer, "p_barangay_ids" "uuid"[]) TO "service_role";
GRANT ALL ON FUNCTION "public"."get_totals_by_fund_source_for_barangays"("p_fiscal_year" integer, "p_barangay_ids" "uuid"[]) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_totals_by_sector"("p_fiscal_year" integer, "p_barangay_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_totals_by_sector"("p_fiscal_year" integer, "p_barangay_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."get_totals_by_sector"("p_fiscal_year" integer, "p_barangay_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_totals_by_sector_for_barangays"("p_fiscal_year" integer, "p_barangay_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_totals_by_sector_for_barangays"("p_fiscal_year" integer, "p_barangay_ids" "uuid"[]) TO "service_role";
GRANT ALL ON FUNCTION "public"."get_totals_by_sector_for_barangays"("p_fiscal_year" integer, "p_barangay_ids" "uuid"[]) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."inspect_required_db_hardening"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."inspect_required_db_hardening"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_active_auth"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_active_auth"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_active_auth"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_barangay_official"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_barangay_official"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_barangay_official"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_citizen"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_citizen"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_citizen"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_city_official"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_city_official"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_city_official"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_municipal_official"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_municipal_official"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_municipal_official"() TO "service_role";



GRANT ALL ON FUNCTION "public"."log_activity"("p_action" "text", "p_entity_table" "text", "p_entity_id" "uuid", "p_region_id" "uuid", "p_province_id" "uuid", "p_city_id" "uuid", "p_municipality_id" "uuid", "p_barangay_id" "uuid", "p_metadata" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."log_activity"("p_action" "text", "p_entity_table" "text", "p_entity_id" "uuid", "p_region_id" "uuid", "p_province_id" "uuid", "p_city_id" "uuid", "p_municipality_id" "uuid", "p_barangay_id" "uuid", "p_metadata" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_activity"("p_action" "text", "p_entity_table" "text", "p_entity_id" "uuid", "p_region_id" "uuid", "p_province_id" "uuid", "p_city_id" "uuid", "p_municipality_id" "uuid", "p_barangay_id" "uuid", "p_metadata" "jsonb") TO "service_role";















GRANT ALL ON FUNCTION "public"."notifications_guard_read_update"() TO "anon";
GRANT ALL ON FUNCTION "public"."notifications_guard_read_update"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."notifications_guard_read_update"() TO "service_role";



GRANT ALL ON FUNCTION "public"."now_utc"() TO "anon";
GRANT ALL ON FUNCTION "public"."now_utc"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."now_utc"() TO "service_role";



GRANT ALL ON FUNCTION "public"."on_aip_published_embed_categorize"() TO "anon";
GRANT ALL ON FUNCTION "public"."on_aip_published_embed_categorize"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."on_aip_published_embed_categorize"() TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_last_active_admin_mutation"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_last_active_admin_mutation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_last_active_admin_mutation"() TO "service_role";



GRANT ALL ON FUNCTION "public"."project_update_media_delete_storage_object"() TO "anon";
GRANT ALL ON FUNCTION "public"."project_update_media_delete_storage_object"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."project_update_media_delete_storage_object"() TO "service_role";



GRANT ALL ON FUNCTION "public"."projects_delete_cover_image_object"() TO "anon";
GRANT ALL ON FUNCTION "public"."projects_delete_cover_image_object"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."projects_delete_cover_image_object"() TO "service_role";



GRANT ALL ON FUNCTION "public"."purge_activity_log_older_than"("p_days" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."purge_activity_log_older_than"("p_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."purge_activity_log_older_than"("p_days" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."purge_chat_data_older_than"("p_days" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."purge_chat_data_older_than"("p_days" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_aip_reviews_activity_log_crud"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_aip_reviews_activity_log_crud"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_aip_reviews_activity_log_crud"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_aips_activity_log_crud"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_aips_activity_log_crud"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_aips_activity_log_crud"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_feedback_activity_log_crud"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_feedback_activity_log_crud"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_feedback_activity_log_crud"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_projects_activity_log_crud"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_projects_activity_log_crud"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_projects_activity_log_crud"() TO "service_role";



GRANT ALL ON FUNCTION "public"."uploaded_files_delete_storage_object"() TO "anon";
GRANT ALL ON FUNCTION "public"."uploaded_files_delete_storage_object"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."uploaded_files_delete_storage_object"() TO "service_role";



GRANT ALL ON FUNCTION "public"."uploaded_files_set_single_current"() TO "anon";
GRANT ALL ON FUNCTION "public"."uploaded_files_set_single_current"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."uploaded_files_set_single_current"() TO "service_role";
























GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "app"."settings" TO "service_role";















GRANT ALL ON TABLE "public"."activity_log" TO "anon";
GRANT ALL ON TABLE "public"."activity_log" TO "authenticated";
GRANT ALL ON TABLE "public"."activity_log" TO "service_role";



GRANT ALL ON TABLE "public"."aip_chunk_embeddings" TO "anon";
GRANT ALL ON TABLE "public"."aip_chunk_embeddings" TO "authenticated";
GRANT ALL ON TABLE "public"."aip_chunk_embeddings" TO "service_role";



GRANT ALL ON TABLE "public"."aip_chunks" TO "anon";
GRANT ALL ON TABLE "public"."aip_chunks" TO "authenticated";
GRANT ALL ON TABLE "public"."aip_chunks" TO "service_role";



GRANT ALL ON TABLE "public"."aip_line_item_embeddings" TO "anon";
GRANT ALL ON TABLE "public"."aip_line_item_embeddings" TO "authenticated";
GRANT ALL ON TABLE "public"."aip_line_item_embeddings" TO "service_role";



GRANT ALL ON TABLE "public"."aip_line_items" TO "anon";
GRANT ALL ON TABLE "public"."aip_line_items" TO "authenticated";
GRANT ALL ON TABLE "public"."aip_line_items" TO "service_role";



GRANT ALL ON TABLE "public"."aip_reviews" TO "anon";
GRANT ALL ON TABLE "public"."aip_reviews" TO "authenticated";
GRANT ALL ON TABLE "public"."aip_reviews" TO "service_role";



GRANT ALL ON TABLE "public"."aip_totals" TO "anon";
GRANT ALL ON TABLE "public"."aip_totals" TO "authenticated";
GRANT ALL ON TABLE "public"."aip_totals" TO "service_role";



GRANT ALL ON TABLE "public"."aip_upload_validation_logs" TO "service_role";
GRANT SELECT ON TABLE "public"."aip_upload_validation_logs" TO "authenticated";



GRANT ALL ON TABLE "public"."aips" TO "anon";
GRANT ALL ON TABLE "public"."aips" TO "authenticated";
GRANT ALL ON TABLE "public"."aips" TO "service_role";



GRANT ALL ON TABLE "public"."barangays" TO "anon";
GRANT ALL ON TABLE "public"."barangays" TO "authenticated";
GRANT ALL ON TABLE "public"."barangays" TO "service_role";



GRANT ALL ON TABLE "public"."chat_messages" TO "anon";
GRANT ALL ON TABLE "public"."chat_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."chat_messages" TO "service_role";



GRANT ALL ON TABLE "public"."chat_rate_events" TO "anon";
GRANT ALL ON TABLE "public"."chat_rate_events" TO "authenticated";
GRANT ALL ON TABLE "public"."chat_rate_events" TO "service_role";



GRANT ALL ON TABLE "public"."chat_sessions" TO "anon";
GRANT ALL ON TABLE "public"."chat_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."chat_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."cities" TO "anon";
GRANT ALL ON TABLE "public"."cities" TO "authenticated";
GRANT ALL ON TABLE "public"."cities" TO "service_role";



GRANT ALL ON TABLE "public"."email_outbox" TO "service_role";



GRANT ALL ON TABLE "public"."extraction_artifacts" TO "anon";
GRANT ALL ON TABLE "public"."extraction_artifacts" TO "authenticated";
GRANT ALL ON TABLE "public"."extraction_artifacts" TO "service_role";



GRANT ALL ON TABLE "public"."extraction_runs" TO "anon";
GRANT ALL ON TABLE "public"."extraction_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."extraction_runs" TO "service_role";



GRANT ALL ON TABLE "public"."feedback" TO "anon";
GRANT ALL ON TABLE "public"."feedback" TO "authenticated";
GRANT ALL ON TABLE "public"."feedback" TO "service_role";



GRANT ALL ON TABLE "public"."health_project_details" TO "anon";
GRANT ALL ON TABLE "public"."health_project_details" TO "authenticated";
GRANT ALL ON TABLE "public"."health_project_details" TO "service_role";



GRANT ALL ON TABLE "public"."infrastructure_project_details" TO "anon";
GRANT ALL ON TABLE "public"."infrastructure_project_details" TO "authenticated";
GRANT ALL ON TABLE "public"."infrastructure_project_details" TO "service_role";



GRANT ALL ON TABLE "public"."municipalities" TO "anon";
GRANT ALL ON TABLE "public"."municipalities" TO "authenticated";
GRANT ALL ON TABLE "public"."municipalities" TO "service_role";



GRANT ALL ON TABLE "public"."notification_preferences" TO "anon";
GRANT ALL ON TABLE "public"."notification_preferences" TO "authenticated";
GRANT ALL ON TABLE "public"."notification_preferences" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "anon";
GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."project_update_media" TO "anon";
GRANT ALL ON TABLE "public"."project_update_media" TO "authenticated";
GRANT ALL ON TABLE "public"."project_update_media" TO "service_role";



GRANT ALL ON TABLE "public"."project_updates" TO "anon";
GRANT ALL ON TABLE "public"."project_updates" TO "authenticated";
GRANT ALL ON TABLE "public"."project_updates" TO "service_role";



GRANT ALL ON TABLE "public"."projects" TO "anon";
GRANT ALL ON TABLE "public"."projects" TO "authenticated";
GRANT ALL ON TABLE "public"."projects" TO "service_role";



GRANT ALL ON TABLE "public"."provinces" TO "anon";
GRANT ALL ON TABLE "public"."provinces" TO "authenticated";
GRANT ALL ON TABLE "public"."provinces" TO "service_role";



GRANT ALL ON TABLE "public"."regions" TO "anon";
GRANT ALL ON TABLE "public"."regions" TO "authenticated";
GRANT ALL ON TABLE "public"."regions" TO "service_role";



GRANT ALL ON TABLE "public"."sectors" TO "anon";
GRANT ALL ON TABLE "public"."sectors" TO "authenticated";
GRANT ALL ON TABLE "public"."sectors" TO "service_role";



GRANT ALL ON TABLE "public"."uploaded_files" TO "anon";
GRANT ALL ON TABLE "public"."uploaded_files" TO "authenticated";
GRANT ALL ON TABLE "public"."uploaded_files" TO "service_role";



GRANT ALL ON TABLE "public"."v_aip_public_status" TO "anon";
GRANT ALL ON TABLE "public"."v_aip_public_status" TO "authenticated";
GRANT ALL ON TABLE "public"."v_aip_public_status" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































