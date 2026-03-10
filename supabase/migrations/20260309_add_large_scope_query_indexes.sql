create index if not exists idx_aips_barangay_scope_order
  on public.aips (barangay_id, fiscal_year desc, created_at desc, id desc)
  where barangay_id is not null;

create index if not exists idx_aips_city_scope_order
  on public.aips (city_id, fiscal_year desc, created_at desc, id desc)
  where city_id is not null;

create index if not exists idx_aips_municipality_scope_order
  on public.aips (municipality_id, fiscal_year desc, created_at desc, id desc)
  where municipality_id is not null;

create index if not exists idx_feedback_aip_created_id
  on public.feedback (aip_id, created_at, id)
  where target_type = 'aip' and aip_id is not null;

create index if not exists idx_feedback_parent_created_id
  on public.feedback (parent_feedback_id, created_at, id)
  where parent_feedback_id is not null;

create index if not exists idx_feedback_project_created_id
  on public.feedback (project_id, created_at, id)
  where target_type = 'project' and project_id is not null;

create index if not exists idx_feedback_roots_aip_kind_updated
  on public.feedback (aip_id, kind, updated_at desc, id)
  where target_type = 'aip' and parent_feedback_id is null and aip_id is not null;

create index if not exists idx_feedback_roots_project_kind_updated
  on public.feedback (project_id, kind, updated_at desc, id)
  where target_type = 'project' and parent_feedback_id is null and project_id is not null;

create index if not exists idx_project_update_media_update_created_id
  on public.project_update_media (update_id, created_at, id);

create index if not exists idx_project_updates_project_status_created_id
  on public.project_updates (project_id, status, created_at desc, id);

create index if not exists idx_projects_aip_created_id
  on public.projects (aip_id, created_at desc, id);

create index if not exists idx_projects_aip_id_id
  on public.projects (aip_id, id);

create index if not exists idx_projects_ref_aip_created_id
  on public.projects (aip_ref_code, aip_id, created_at desc, id desc);
