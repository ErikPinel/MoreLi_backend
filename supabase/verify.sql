select
  (
    select count(*)
    from information_schema.tables
    where table_schema = 'public'
      and table_name in (
        'profiles',
        'teacher_profiles',
        'subjects',
        'levels',
        'cities',
        'teacher_subjects',
        'teacher_levels',
        'teacher_service_areas',
        'teacher_availability',
        'student_requests',
        'matches',
        'inquiries',
        'reviews',
        'favorites',
        'notifications'
      )
  ) as application_table_count,
  (
    select count(*)
    from pg_type
    where typnamespace = 'public'::regnamespace
      and typname in (
        'user_role',
        'teacher_profile_status',
        'verification_status',
        'request_status',
        'match_status',
        'inquiry_status',
        'review_status',
        'notification_type'
      )
  ) as application_enum_count,
  (
    select count(*)
    from storage.buckets
    where id in ('teacher-avatars', 'teacher-gallery')
      and public = false
  ) as private_bucket_count,
  (
    select count(*)
    from pg_class
    where relnamespace = 'public'::regnamespace
      and relname in (
        'profiles',
        'teacher_profiles',
        'subjects',
        'levels',
        'cities',
        'teacher_subjects',
        'teacher_levels',
        'teacher_service_areas',
        'teacher_availability',
        'student_requests',
        'matches',
        'inquiries',
        'reviews',
        'favorites',
        'notifications'
      )
      and relrowsecurity
  ) as rls_table_count,
  (
    select count(*)
    from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee in ('anon', 'authenticated')
      and table_name in (
        'profiles',
        'teacher_profiles',
        'subjects',
        'levels',
        'cities',
        'teacher_subjects',
        'teacher_levels',
        'teacher_service_areas',
        'teacher_availability',
        'student_requests',
        'matches',
        'inquiries',
        'reviews',
        'favorites',
        'notifications'
      )
  ) as browser_role_grant_count,
  (
    select count(*)
    from pg_trigger
    where tgname = 'on_auth_user_created'
      and not tgisinternal
  ) as auth_trigger_count,
  (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'reviews'
      and column_name = 'inquiry_id'
  ) as review_inquiry_column_count,
  (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and (
        (table_name = 'student_requests' and column_name = 'desired_start_at')
        or (
          table_name = 'teacher_profiles'
          and column_name in ('claimed_at', 'terms_accepted_at')
        )
      )
  ) as lifecycle_column_count,
  (
    select count(*)
    from information_schema.routines
    where routine_schema = 'public'
      and routine_name in (
        'create_inquiry',
        'create_teacher_draft',
        'expire_stale_inquiries',
        'mark_inquiry_viewed',
        'moderate_review',
        'moderate_teacher',
        'persist_matches',
        'approve_teacher_review',
        'replace_professions',
        'replace_teacher_availability',
        'replace_teacher_levels',
        'replace_teacher_service_areas',
        'replace_teacher_subjects',
        'respond_to_inquiry',
        'search_teacher_candidates',
        'submit_teacher_for_review',
        'submit_verified_review'
      )
  ) as business_function_count,
  (
    select count(*)
    from pg_trigger
    where tgname in (
      'teacher_availability_prevent_overlap',
      'reviews_refresh_teacher_aggregates',
      'teacher_profiles_integrity',
      'profiles_teacher_integrity',
      'teacher_subjects_integrity',
      'teacher_levels_integrity',
      'teacher_service_areas_integrity',
      'teacher_availability_integrity',
      'teacher_avatar_integrity'
    )
      and not tgisinternal
  ) as business_trigger_count,
  (
    select count(*)
    from information_schema.routine_privileges
    where specific_schema = 'public'
      and grantee in ('PUBLIC', 'anon', 'authenticated')
      and privilege_type = 'EXECUTE'
      and routine_name in (
        'create_inquiry',
        'create_teacher_draft',
        'expire_stale_inquiries',
        'mark_inquiry_viewed',
        'moderate_review',
        'moderate_teacher',
        'persist_matches',
        'approve_teacher_review',
        'replace_professions',
        'replace_teacher_availability',
        'replace_teacher_levels',
        'replace_teacher_service_areas',
        'replace_teacher_subjects',
        'respond_to_inquiry',
        'search_teacher_candidates',
        'submit_teacher_for_review',
        'submit_verified_review'
      )
  ) as browser_role_function_grant_count,
  (
    select count(*)
    from supabase_migrations.schema_migrations
    where version in (
      '202609110001',
      '20260911230000',
      '20260911231500',
      '20260911233000',
      '20260911234500',
      '20260912000000',
      '20260912001500',
      '20260912003000',
      '20260912004500',
      '20260912010000',
      '20260912011500',
      '20260912143000',
      '20260912180000',
      '20260912181000',
      '20260912183000',
      '20260912190000',
      '20260912191000'
    )
  ) as migration_count,
  (select count(*) from public.subjects) as subject_count,
  (select count(*) from public.levels) as level_count,
  (select count(*) from public.cities) as city_count;