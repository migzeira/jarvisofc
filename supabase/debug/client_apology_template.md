# Mensagem de desculpa pro cliente que recebeu spam

**Contexto:** cliente 5527999949998 (ES) recebeu "Testando" de hora em hora por 15+ horas
**Causa:** ele provavelmente criou um lembrete teste tipo "me lembra de teste a cada hora" pra ver como funciona, esqueceu de cancelar, e o sistema não tinha proteção contra recorrência hourly.

---

## Versão curta (WhatsApp, primeira mensagem)

> Oi [NOME], aqui é o Miguel da Jarvis. Tudo bem?
>
> Olha, vi aqui no sistema que você recebeu várias mensagens "Testando" do Jarvis nas últimas horas — acabei de descobrir e quero pedir desculpa. Você criou um lembrete de teste e o sistema não te avisou que era recorrente, então ficou disparando de hora em hora. Já cancelei tudo, não vai mais incomodar.
>
> Pra compensar o transtorno, te dei mais 30 dias grátis no Jarvis. Já tá ativo. 🎁
>
> Posso te ajudar a configurar um lembrete de verdade agora? Me diz o que você queria lembrar.

---

## Versão longa (caso ele tenha reclamado feio ou cancelado)

> [NOME], aqui é o Miguel — fundador do Hey Jarvis. Quero te pedir desculpa pessoalmente.
>
> Aconteceu o seguinte: você criou um lembrete pra testar como funciona, e o sistema interpretou como "envia esse lembrete a cada 1 hora pra sempre". Pior: não te avisou claramente que era recorrente nem te deu botão fácil pra cancelar. Por isso você recebeu "Testando" 15+ horas seguidas. Foi falha minha — falha do sistema, mas no fim do dia falha minha por não ter testado esse cenário antes.
>
> O que já fiz nas últimas horas:
> 1. Cancelei o lembrete que tava te enchendo
> 2. Adicionei uma confirmação obrigatória: agora se alguém pede lembrete "a cada hora", o Jarvis mostra "Vou te enviar 24 mensagens por dia, tem certeza?" antes de criar
> 3. Adicionei um botão "Cancelar série inteira" no dashboard (era difícil cancelar antes)
> 4. Adicionei uma proteção que mata qualquer série hourly que envie 24+ mensagens iguais em 36h
>
> Te dei 30 dias grátis pra compensar. Sem catch, sem precisar fazer nada — já tá no seu perfil.
>
> Se você quiser cancelar tudo mesmo assim eu entendo, é só responder "cancela conta" que eu apago. Mas se topar dar mais uma chance, posso te configurar pessoalmente um lembrete de verdade agora — me diz o que você queria lembrar e eu te ajudo aqui no chat.
>
> Mais uma vez: desculpa de verdade. Bug feio.

---

## Como executar

1. Roda `identify_spam_victim.sql` no Supabase pra pegar o nome/email do cliente
2. Escolhe versão curta ou longa baseado em quanto incômodo ele teve (conta de msgs enviadas)
3. Substitui `[NOME]` pelo display_name
4. Descomenta o UPDATE do gesto de boa-fé no SQL (estende trial 30 dias)
5. Manda do SEU WhatsApp pessoal (não do Jarvis) — mais autêntico
6. Se ele responder, segue a conversa humana. Se não responder em 24h, deixa quieto.

## NÃO fazer

- ❌ Mandar do número do Jarvis (parece automatizado)
- ❌ Pedir feedback sobre o produto na mesma mensagem (foco é o pedido de desculpa)
- ❌ Tentar vender upgrade
- ❌ Culpar "uma falha técnica" — assume o erro
