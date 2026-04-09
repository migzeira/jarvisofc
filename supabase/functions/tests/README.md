# Testes Unitários — Minha Maya

## Executar
```bash
deno test --allow-env supabase/functions/tests/
```

## Cobertura
- `classify_intent_test.ts` — testa `classifyIntent` (20+ intents), `parseMinutes`, `isReminderDecline`, `isReminderAtTime`, `isReminderAccept`
