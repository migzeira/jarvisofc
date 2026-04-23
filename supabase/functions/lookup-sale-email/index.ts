/**
 * lookup-sale-email
 *
 * Endpoint publico (sem JWT) chamado pela /obrigado quando a Kirvano redireciona
 * com ?ref={sale_id}. Retorna SOMENTE o email do cliente daquela venda, nada mais.
 *
 * Por que existe:
 *   A Kirvano nao suporta placeholders tipo {customer.email} na thank-you URL.
 *   Ela so injeta automaticamente ?kirvano_upsell=<token>&ref=<sale_id>.
 *   O webhook ja salva o email em kirvano_events (transaction_id = sale_id),
 *   entao a pagina /obrigado lookupa por ref e mostra o email da compra.
 *
 * Seguranca:
 *   - sale_id eh gerado pela Kirvano (8 chars aleatorios), dificil de enumerar
 *   - Retorna APENAS email (nada de name/phone/doc/plan)
 *   - Sem JWT pra nao obrigar login na /obrigado (cliente ainda nao tem conta)
 *   - Rate limit natural do Supabase + 8 chars de entropia = baixo risco
 *
 * Race condition:
 *   Webhook roda em paralelo com o redirect. Cliente pode chegar antes do
 *   evento estar gravado. Frontend lida com isso via polling (retry a cada ~1s).
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") ?? "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type": "application/json",
  };
}

serve(async (req) => {
  const CORS = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405, headers: CORS,
    });
  }

  const url = new URL(req.url);
  const ref = (url.searchParams.get("ref") ?? "").trim();

  // Validacao minima — sale_id Kirvano eh alfanumerico 6-16 chars
  if (!ref || !/^[A-Za-z0-9]{4,24}$/.test(ref)) {
    return new Response(JSON.stringify({ error: "invalid_ref" }), {
      status: 400, headers: CORS,
    });
  }

  try {
    // Procura em transaction_id OU subscription_id (webhook grava sale_id em ambos)
    const { data, error } = await supabase
      .from("kirvano_events")
      .select("customer_email, status, created_at")
      .or(`transaction_id.eq.${ref},subscription_id.eq.${ref}`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("[lookup-sale-email] db error:", error.message);
      return new Response(JSON.stringify({ error: "db_error" }), {
        status: 500, headers: CORS,
      });
    }

    if (!data?.customer_email) {
      // Nao achou ainda — frontend vai fazer retry (webhook pode ainda estar processando)
      return new Response(JSON.stringify({ error: "not_found" }), {
        status: 404, headers: CORS,
      });
    }

    return new Response(JSON.stringify({ email: data.customer_email }), {
      status: 200, headers: CORS,
    });
  } catch (err: any) {
    console.error("[lookup-sale-email] unexpected:", err?.message ?? err);
    return new Response(JSON.stringify({ error: "internal" }), {
      status: 500, headers: CORS,
    });
  }
});
