// ============================================================
//  Fonction "stripe-webhook" : Stripe appelle cette adresse après
//  chaque paiement. On vérifie la signature, puis on enregistre
//  l'achat et on ouvre l'accès au cours.
//  Déployer avec : supabase functions deploy stripe-webhook --no-verify-jwt
// ============================================================
import Stripe from "npm:stripe@17.7.0";
import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { httpClient: Stripe.createFetchHttpClient() });
const cryptoProvider = Stripe.createSubtleCryptoProvider();
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

Deno.serve(async (req) => {
  const signature = req.headers.get("Stripe-Signature");
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body, signature!, Deno.env.get("STRIPE_WEBHOOK_SECRET")!, undefined, cryptoProvider,
    );
  } catch (err) {
    console.error("Signature invalide", err);
    return new Response("Signature invalide", { status: 400 });
  }

  try {
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.payment_status !== "paid") return new Response("En attente", { status: 200 });

      const { course_id, user_id, teacher_id } = session.metadata ?? {};
      if (!course_id || !user_id || !teacher_id) return new Response("Métadonnées manquantes", { status: 200 });

      const amount = session.amount_total ?? 0;
      let fee = 0;
      if (session.payment_intent) {
        const pi = await stripe.paymentIntents.retrieve(session.payment_intent as string);
        fee = pi.application_fee_amount ?? 0;
      }
      // Sans Stripe Connect, tout l'argent arrive sur le compte de la plateforme.
      const teacherAmount = fee ? amount - fee : amount;

      const { error: pErr } = await admin.from("purchases").upsert({
        user_id, course_id, teacher_id,
        amount_cents: amount,
        currency: session.currency ?? "eur",
        platform_fee_cents: fee,
        teacher_amount_cents: teacherAmount,
        stripe_session_id: session.id,
        stripe_payment_intent: session.payment_intent as string | null,
        status: "paid",
      }, { onConflict: "stripe_session_id" });
      if (pErr) throw pErr;

      const { error: eErr } = await admin.from("enrollments")
        .upsert({ user_id, course_id, source: "stripe" }, { onConflict: "user_id,course_id", ignoreDuplicates: true });
      if (eErr) throw eErr;
    }

    if (event.type === "charge.refunded") {
      // Remboursement : on marque l'achat et on retire l'accès
      const charge = event.data.object as Stripe.Charge;
      if (charge.amount_refunded < charge.amount) return new Response("Remboursement partiel ignoré", { status: 200 });
      const { data: purchase } = await admin.from("purchases")
        .update({ status: "refunded" })
        .eq("stripe_payment_intent", charge.payment_intent as string)
        .select("user_id, course_id").maybeSingle();
      if (purchase) {
        await admin.from("enrollments").delete()
          .eq("user_id", purchase.user_id).eq("course_id", purchase.course_id).eq("source", "stripe");
      }
    }

    return new Response(JSON.stringify({ received: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    console.error(err);
    // Code 500 : Stripe réessaiera automatiquement plus tard
    return new Response("Erreur", { status: 500 });
  }
});
