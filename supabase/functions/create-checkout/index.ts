// ============================================================
//  Fonction "create-checkout" : crée une session de paiement Stripe
//  pour un cours. Appelée par le site quand un élève clique "Acheter".
//  Le prix est lu dans la base (jamais envoyé par le navigateur).
// ============================================================
import Stripe from "npm:stripe@17.7.0";
import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { httpClient: Stripe.createFetchHttpClient() });
const SITE_URL = Deno.env.get("SITE_URL")!; // ex : https://amouloken.github.io/plateforme-cours
const PLATFORM_FEE_PERCENT = Number(Deno.env.get("PLATFORM_FEE_PERCENT") ?? "20");

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);

  try {
    // 1. Qui est connecté ?
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ error: "Connexion requise" }, 401);

    // 2. Quel cours ?
    const { course_id } = await req.json();
    const { data: course } = await admin
      .from("courses")
      .select("id, slug, title, subtitle, cover_url, price_cents, currency, teacher_id, is_published")
      .eq("id", course_id)
      .maybeSingle();
    if (!course || !course.is_published) return json({ error: "Cours introuvable" }, 404);
    if (course.price_cents < 50) return json({ error: "Ce cours est gratuit" }, 400);

    // 3. Déjà inscrit ?
    const { data: existing } = await admin
      .from("enrollments").select("id").eq("user_id", user.id).eq("course_id", course.id).maybeSingle();
    if (existing) return json({ url: `${SITE_URL}/cours.html?c=${course.slug}` });

    // 4. Multi-enseignants (plus tard) : si l'enseignant a un compte Stripe Connect actif,
    //    sa part lui est versée automatiquement, la plateforme garde sa commission.
    const { data: payout } = await admin
      .from("teacher_payout_accounts")
      .select("stripe_account_id, charges_enabled, commission_percent")
      .eq("teacher_id", course.teacher_id)
      .maybeSingle();

    const feePercent = payout?.commission_percent ?? PLATFORM_FEE_PERCENT;
    const paymentIntentData: Stripe.Checkout.SessionCreateParams.PaymentIntentData = {
      metadata: { course_id: course.id, user_id: user.id },
    };
    if (payout?.stripe_account_id && payout.charges_enabled) {
      paymentIntentData.application_fee_amount = Math.round(course.price_cents * Number(feePercent) / 100);
      paymentIntentData.transfer_data = { destination: payout.stripe_account_id };
    }

    // 5. Création de la session Stripe Checkout
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: user.email,
      client_reference_id: user.id,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: course.currency,
          unit_amount: course.price_cents,
          product_data: {
            name: course.title,
            ...(course.subtitle ? { description: course.subtitle } : {}),
            ...(course.cover_url ? { images: [course.cover_url] } : {}),
          },
        },
      }],
      metadata: { course_id: course.id, user_id: user.id, teacher_id: course.teacher_id },
      payment_intent_data: paymentIntentData,
      success_url: `${SITE_URL}/merci.html?c=${course.slug}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/cours.html?c=${course.slug}`,
      locale: "fr",
    });

    return json({ url: session.url });
  } catch (err) {
    console.error(err);
    return json({ error: "Erreur serveur" }, 500);
  }
});
