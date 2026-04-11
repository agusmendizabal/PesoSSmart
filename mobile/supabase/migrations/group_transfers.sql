-- ══════════════════════════════════════════════════════════════
--  GRUPO FAMILIAR / PAREJA — Extensión v2
--  - owner_id en family_groups
--  - roles expandidos (guardian, other_adult)
--  - group_transfers: movimientos internos entre miembros
--  - UPDATE policies para grupos
-- ══════════════════════════════════════════════════════════════

-- 1. Owner del grupo (quién lo creó / admin)
ALTER TABLE family_groups
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- 2. Roles expandidos: parent, child, partner, guardian, other_adult
ALTER TABLE family_members
  DROP CONSTRAINT IF EXISTS family_members_role_check;

ALTER TABLE family_members
  ADD CONSTRAINT family_members_role_check
  CHECK (role IN ('parent', 'child', 'partner', 'guardian', 'other_adult'));

-- 3. Tabla de transferencias internas (padre → hijo, pareja → pareja, etc.)
CREATE TABLE IF NOT EXISTS group_transfers (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id        uuid        NOT NULL REFERENCES family_groups(id) ON DELETE CASCADE,
  from_user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  to_user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount          numeric     NOT NULL CHECK (amount > 0),
  currency        text        NOT NULL DEFAULT 'ARS',
  note            text,
  transfer_date   date        NOT NULL DEFAULT CURRENT_DATE,
  created_at      timestamptz DEFAULT now(),
  CHECK (from_user_id != to_user_id)
);

CREATE INDEX IF NOT EXISTS idx_group_transfers_group    ON group_transfers(group_id);
CREATE INDEX IF NOT EXISTS idx_group_transfers_from     ON group_transfers(from_user_id);
CREATE INDEX IF NOT EXISTS idx_group_transfers_to       ON group_transfers(to_user_id);
CREATE INDEX IF NOT EXISTS idx_group_transfers_date     ON group_transfers(transfer_date DESC);

-- 4. RLS para group_transfers
ALTER TABLE group_transfers ENABLE ROW LEVEL SECURITY;

-- Miembros del grupo pueden ver sus propias transferencias (enviadas o recibidas)
CREATE POLICY "group_transfers_select" ON group_transfers
  FOR SELECT USING (
    group_id IN (SELECT group_id FROM family_members WHERE user_id = auth.uid())
    AND (from_user_id = auth.uid() OR to_user_id = auth.uid()
      OR group_id IN (
        SELECT group_id FROM family_members
        WHERE user_id = auth.uid() AND role IN ('parent', 'guardian', 'other_adult')
      )
    )
  );

-- Solo miembros del grupo pueden crear transferencias y deben ser el remitente
CREATE POLICY "group_transfers_insert" ON group_transfers
  FOR INSERT WITH CHECK (
    from_user_id = auth.uid()
    AND group_id IN (SELECT group_id FROM family_members WHERE user_id = auth.uid())
    AND to_user_id IN (SELECT user_id FROM family_members WHERE group_id = group_transfers.group_id)
  );

-- Solo el remitente puede eliminar (dentro de 24h si queremos, por ahora libre)
CREATE POLICY "group_transfers_delete" ON group_transfers
  FOR DELETE USING (from_user_id = auth.uid());

-- 5. UPDATE policy para family_groups (owner puede renombrar)
CREATE POLICY "family_groups_update" ON family_groups
  FOR UPDATE USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- 6. UPDATE policy para family_members (el propio usuario puede cambiar su rol)
CREATE POLICY "family_members_update" ON family_members
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 7. Índice para invite_code (búsqueda rápida al unirse)
CREATE INDEX IF NOT EXISTS idx_family_groups_invite_code ON family_groups(invite_code);
