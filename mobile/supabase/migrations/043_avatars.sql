-- Bucket público para fotos de perfil
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Cualquiera puede leer (para mostrar fotos en grupos)
CREATE POLICY "avatars_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'avatars');

-- Solo el propio usuario puede subir/reemplazar su foto
CREATE POLICY "avatars_insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'avatars'
    AND name = auth.uid()::text || '.jpg'
  );

CREATE POLICY "avatars_update" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'avatars'
    AND name = auth.uid()::text || '.jpg'
  );

-- Actualizar RPC get_group_members para incluir avatar_url
DROP FUNCTION IF EXISTS get_group_members(UUID);
CREATE OR REPLACE FUNCTION get_group_members(p_group_id UUID)
RETURNS TABLE(user_id UUID, role TEXT, permissions JSONB, full_name TEXT, email TEXT, avatar_url TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    fm.user_id,
    fm.role,
    COALESCE(fm.permissions, '{
      "can_view_expenses": true,
      "can_add_expenses": true,
      "can_view_members": true,
      "can_invite": false,
      "can_manage_roles": false
    }'::jsonb) AS permissions,
    COALESCE(NULLIF(trim(p.full_name), ''), '') AS full_name,
    COALESCE(NULLIF(p.email, ''), u.email, '') AS email,
    p.avatar_url
  FROM family_members fm
  LEFT JOIN public.profiles p ON p.id = fm.user_id
  LEFT JOIN auth.users u      ON u.id = fm.user_id
  WHERE fm.group_id = p_group_id
    AND p_group_id IN (
      SELECT group_id FROM family_members WHERE user_id = auth.uid()
    );
$$;
