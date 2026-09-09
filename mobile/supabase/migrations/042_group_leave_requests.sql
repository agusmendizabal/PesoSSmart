-- Solicitudes de salida para grupos familiares
-- Un miembro no-admin de un grupo familiar debe pedir permiso al admin para salir.

CREATE TABLE IF NOT EXISTS group_leave_requests (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id   uuid        NOT NULL REFERENCES family_groups(id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES profiles(id)     ON DELETE CASCADE,
  status     text        NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, user_id)
);

ALTER TABLE group_leave_requests ENABLE ROW LEVEL SECURITY;

-- El propio miembro puede ver su solicitud
CREATE POLICY "glr_member_select" ON group_leave_requests
  FOR SELECT USING (auth.uid() = user_id);

-- El admin del grupo puede ver todas las solicitudes de su grupo
CREATE POLICY "glr_admin_select" ON group_leave_requests
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM family_members fm
      WHERE fm.group_id = group_leave_requests.group_id
        AND fm.user_id  = auth.uid()
        AND fm.role IN ('admin', 'parent', 'partner')
    )
  );

-- El miembro puede crear su propia solicitud
CREATE POLICY "glr_insert" ON group_leave_requests
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- El miembro puede cancelar su propia solicitud; el admin puede aprobar/rechazar (borrando el registro)
CREATE POLICY "glr_delete" ON group_leave_requests
  FOR DELETE USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM family_members fm
      WHERE fm.group_id = group_leave_requests.group_id
        AND fm.user_id  = auth.uid()
        AND fm.role IN ('admin', 'parent', 'partner')
    )
  );
