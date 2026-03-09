begin;

do $$
begin
  if exists (select 1 from pg_type where typname = 'pipeline_stage')
     and not exists (
       select 1
       from pg_enum e
       join pg_type t on t.oid = e.enumtypid
       where t.typname = 'pipeline_stage'
         and e.enumlabel = 'scale_amounts'
     ) then
    alter type public.pipeline_stage add value 'scale_amounts' before 'summarize';
  end if;
end
$$;

commit;
