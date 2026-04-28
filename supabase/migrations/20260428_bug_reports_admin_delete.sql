-- Adiciona policy DELETE pra admin em bug_reports.
-- Permite que admin exclua reportes definitivamente do banco.
-- (User comum NÃO pode deletar — precisaria policy separada que não criamos.)

drop policy if exists "admin deletes bugs" on public.bug_reports;
create policy "admin deletes bugs"
  on public.bug_reports for delete
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.is_admin = true
    )
  );
