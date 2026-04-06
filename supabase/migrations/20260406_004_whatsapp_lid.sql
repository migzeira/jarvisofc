-- Adiciona suporte a WhatsApp LID (novo formato de privacidade)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS whatsapp_lid TEXT,
  ADD COLUMN IF NOT EXISTS link_code TEXT,
  ADD COLUMN IF NOT EXISTS link_code_expires_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_whatsapp_lid
  ON profiles(whatsapp_lid) WHERE whatsapp_lid IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_link_code
  ON profiles(link_code) WHERE link_code IS NOT NULL;
