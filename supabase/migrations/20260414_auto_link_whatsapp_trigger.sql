-- Trigger server-side: quando phone_number é setado em profiles,
-- automaticamente cria pending_whatsapp_link para o usuário.
-- Isso garante que o fluxo funcione MESMO se o frontend estiver stale,
-- não chamar link-init, ou se a Evolution API falhar.
--
-- Fluxo:
-- 1. Admin ativa conta OU Kirvano webhook cria perfil
-- 2. Usuário salva phone no MeuPerfil
-- 3. Este trigger dispara: cria pending_link de 24h + ativa agente
-- 4. Primeira msg do usuario no WhatsApp -> webhook linka o LID via pending

CREATE OR REPLACE FUNCTION public.auto_link_whatsapp_on_phone_set()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Só dispara quando phone_number é setado (não-null) e diferente do antigo,
  -- perfil está ativo e ainda não tem whatsapp_lid
  IF NEW.phone_number IS NOT NULL
     AND NEW.phone_number <> COALESCE(OLD.phone_number, '')
     AND NEW.account_status = 'active'
     AND NEW.whatsapp_lid IS NULL
  THEN
    -- Cria/atualiza pending_link com janela de 24h
    INSERT INTO public.pending_whatsapp_links (user_id, phone_number, push_name_hint, expires_at, created_at)
    VALUES (
      NEW.id,
      REGEXP_REPLACE(NEW.phone_number, '\D', '', 'g'),
      NEW.display_name,
      NOW() + INTERVAL '24 hours',
      NOW()
    )
    ON CONFLICT (user_id) DO UPDATE SET
      phone_number = EXCLUDED.phone_number,
      push_name_hint = EXCLUDED.push_name_hint,
      expires_at = EXCLUDED.expires_at,
      created_at = EXCLUDED.created_at;

    -- Garante que o agente esteja ativo
    UPDATE public.agent_configs
    SET is_active = true
    WHERE user_id = NEW.id AND is_active = false;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_link_whatsapp_on_phone_set ON public.profiles;

CREATE TRIGGER trg_auto_link_whatsapp_on_phone_set
  AFTER INSERT OR UPDATE OF phone_number ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_link_whatsapp_on_phone_set();

-- Também dispara quando account_status vira 'active' E usuario ja tem phone_number.
-- Cobre caso: admin aprova plano DEPOIS do user ja ter salvo o numero.
CREATE OR REPLACE FUNCTION public.auto_link_whatsapp_on_activation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.account_status = 'active'
     AND COALESCE(OLD.account_status, '') <> 'active'
     AND NEW.phone_number IS NOT NULL
     AND NEW.whatsapp_lid IS NULL
  THEN
    INSERT INTO public.pending_whatsapp_links (user_id, phone_number, push_name_hint, expires_at, created_at)
    VALUES (
      NEW.id,
      REGEXP_REPLACE(NEW.phone_number, '\D', '', 'g'),
      NEW.display_name,
      NOW() + INTERVAL '24 hours',
      NOW()
    )
    ON CONFLICT (user_id) DO UPDATE SET
      phone_number = EXCLUDED.phone_number,
      push_name_hint = EXCLUDED.push_name_hint,
      expires_at = EXCLUDED.expires_at,
      created_at = EXCLUDED.created_at;

    UPDATE public.agent_configs
    SET is_active = true
    WHERE user_id = NEW.id AND is_active = false;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_link_whatsapp_on_activation ON public.profiles;

CREATE TRIGGER trg_auto_link_whatsapp_on_activation
  AFTER UPDATE OF account_status ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_link_whatsapp_on_activation();
