-- Adiciona coluna `color` em public.categories pra suportar categorias
-- customizadas com identidade visual (emoji + cor) no painel.
-- Categorias defaults (is_default=true) ficam sem cor inicial — o frontend
-- usa o mapa de cores fixo já definido no Financas.tsx pra elas.

alter table public.categories
  add column if not exists color text;

-- Notas:
-- - Não tem restrição de formato pra `color` (frontend valida que é uma das
--   ~10 cores da paleta). Salvar texto livre permite expandir paleta futuramente.
-- - Categorias custom existentes ficam com color=null e o frontend aplica
--   uma cor default ao renderizar (graceful degradation).
