-- Seed a default admin account: admin@admin.local / 1234
-- Inserted directly via SQL to bypass GoTrue's client-side min-length check.
do $$
declare
  admin_uid uuid;
begin
  select id into admin_uid from auth.users where email = 'admin@admin.local';

  if admin_uid is null then
    admin_uid := gen_random_uuid();
    insert into auth.users (
      id,
      instance_id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      confirmation_token,
      email_change,
      email_change_token_new,
      recovery_token
    ) values (
      admin_uid,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      'admin@admin.local',
      crypt('1234', gen_salt('bf')),
      now(),
      jsonb_build_object('provider','email','providers', jsonb_build_array('email')),
      jsonb_build_object('display_name','admin'),
      now(),
      now(),
      '',
      '',
      '',
      ''
    );

    insert into auth.identities (
      id,
      provider_id,
      user_id,
      identity_data,
      provider,
      last_sign_in_at,
      created_at,
      updated_at
    ) values (
      gen_random_uuid(),
      admin_uid::text,
      admin_uid,
      jsonb_build_object('sub', admin_uid::text, 'email', 'admin@admin.local', 'email_verified', true),
      'email',
      now(),
      now(),
      now()
    );
  end if;

  -- Ensure profile + admin role exist (handle_new_user trigger may or may not have fired).
  insert into public.profiles (id, display_name)
  values (admin_uid, 'admin')
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role)
  values (admin_uid, 'admin'::public.app_role)
  on conflict (user_id, role) do nothing;
end $$;