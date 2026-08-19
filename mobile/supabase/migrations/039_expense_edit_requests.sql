-- Solicitudes de edición de gastos en grupos familiares
-- Miembros piden al admin modificar un gasto; el admin aprueba o rechaza.

CREATE TABLE IF NOT EXISTS public.expense_edit_requests (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id         UUID        NOT NULL REFERENCES public.family_groups(id) ON DELETE CASCADE,
  expense_id       UUID        NOT NULL REFERENCES public.expenses(id)      ON DELETE CASCADE,
  requester_id     UUID        NOT NULL REFERENCES public.profiles(id)      ON DELETE CASCADE,
  proposed_amount  NUMERIC(12,2),
  proposed_description TEXT,
  reason           TEXT        NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','approved','rejected')),
  reviewed_by      UUID        REFERENCES public.profiles(id),
  reviewed_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.expense_edit_requests ENABLE ROW LEVEL SECURITY;

-- Miembros del grupo pueden insertar solicitudes
CREATE POLICY "members insert edit requests"
ON public.expense_edit_requests FOR INSERT
WITH CHECK (
  auth.uid() = requester_id AND
  EXISTS (
    SELECT 1 FROM public.family_members
    WHERE group_id = expense_edit_requests.group_id
      AND user_id  = auth.uid()
  )
);

-- Miembros del grupo pueden ver solicitudes
CREATE POLICY "members view edit requests"
ON public.expense_edit_requests FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.family_members
    WHERE group_id = expense_edit_requests.group_id
      AND user_id  = auth.uid()
  )
);

-- Admins pueden aprobar/rechazar
CREATE POLICY "admins update edit requests"
ON public.expense_edit_requests FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.family_members
    WHERE group_id = expense_edit_requests.group_id
      AND user_id  = auth.uid()
      AND role IN ('admin','parent','partner')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.family_members
    WHERE group_id = expense_edit_requests.group_id
      AND user_id  = auth.uid()
      AND role IN ('admin','parent','partner')
  )
);
