# Plateforme de cours en ligne — guide d'installation

Site de cours vidéo (style Udemy) : les enseignants publient des cours à partir de liens YouTube, Vimeo ou Bunny Stream, les élèves créent un compte et achètent les cours avec Stripe.

Version 1 : vous êtes le seul enseignant, mais tout est prévu pour en accueillir d'autres plus tard (chaque cours appartient à un enseignant, et les reversements Stripe Connect sont déjà préparés).

## Comment ça marche

| Élément | Rôle | Coût |
|---|---|---|
| **GitHub Pages** | héberge les pages du site (HTML/CSS) | gratuit |
| **Supabase** | comptes élèves, base de données des cours, sécurité | gratuit pour démarrer |
| **Stripe** | paiement des cours | commission Stripe par vente |

La sécurité est gérée **dans la base de données** : le lien d'une vidéo payante n'est envoyé qu'aux élèves qui ont acheté le cours. Le prix est relu côté serveur au moment du paiement, donc personne ne peut le modifier dans son navigateur.

## Fichiers

```
index.html            Accueil + catalogue
cours.html            Page d'un cours (programme, bouton Acheter)
lecon.html            Lecteur vidéo d'une leçon
connexion.html        Connexion / inscription / mot de passe oublié
mes-cours.html        Cours achetés par l'élève
enseignant.html       Espace enseignant (créer cours et leçons, statistiques)
merci.html            Page après paiement
mentions-legales.html À compléter (obligatoire pour vendre)
assets/style.css      Design (couleurs dans :root)
assets/config.js      ⚠️ À remplir avec vos clés Supabase
assets/app.js         Fonctions communes
supabase/schema.sql   Base de données + règles de sécurité
supabase/functions/   Paiement Stripe (2 fonctions serveur)
```

---

## Étape 1 — Mettre le site sur GitHub ✅ (déjà fait)

Le dépôt est `amouloken/plateforme-cours` et GitHub Pages est activé : le site est en ligne sur `https://amouloken.github.io/plateforme-cours/`.

Un bandeau jaune s'affiche tant que Supabase n'est pas configuré : c'est normal.

## Étape 2 — Créer la base de données Supabase

1. Créez un compte sur [supabase.com](https://supabase.com), puis **New project** (région : Europe, par exemple Paris ou Francfort). Notez le mot de passe de la base.
2. Menu **SQL Editor > New query** : collez tout le contenu de `supabase/schema.sql` et cliquez **Run**. Le message attendu est « Success. No rows returned ».
3. Menu **Project Settings > API** : copiez la **Project URL** et la clé **anon public**.
4. Sur GitHub, ouvrez `assets/config.js`, cliquez sur le crayon ✏️, collez ces deux valeurs, changez le nom du site si vous voulez, puis **Commit changes**.
   - ⚠️ Ne collez jamais la clé `service_role` dans ce fichier.
5. Menu **Authentication > URL Configuration** :
   - **Site URL** : `https://amouloken.github.io/plateforme-cours/`
   - **Redirect URLs** : ajoutez `https://amouloken.github.io/plateforme-cours/**`

## Étape 3 — Devenir enseignant

1. Sur votre site, cliquez **Connexion > Créer un compte** et inscrivez-vous (confirmez l'e-mail reçu).
2. Dans Supabase, **SQL Editor**, exécutez (avec votre e-mail) :
   ```sql
   update public.profiles set role = 'admin'
     where id = (select id from auth.users where email = 'votre-email@exemple.com');
   ```
3. Rechargez le site : le menu **Espace enseignant** apparaît. Vous pouvez créer votre premier cours et ses leçons.

À ce stade, les cours **gratuits** fonctionnent déjà de bout en bout.

## Étape 4 — Activer le paiement Stripe

Commencez en **mode test** de Stripe (interrupteur « Test mode »), puis refaites cette étape avec les clés réelles quand tout marche.

### 4a. Créer les deux fonctions dans Supabase
Menu **Edge Functions > Deploy a new function > Via Editor** :

1. Nom **`create-checkout`** : collez le contenu de `supabase/functions/create-checkout/index.ts`, puis **Deploy**.
2. Nom **`stripe-webhook`** : collez le contenu de `supabase/functions/stripe-webhook/index.ts`, puis **Deploy**.
   Ensuite, dans les réglages (*Details / Settings*) de `stripe-webhook`, **désactivez « Verify JWT »** (Stripe ne peut pas se connecter comme un utilisateur ; la sécurité vient de la signature Stripe).

### 4b. Créer le webhook dans Stripe
1. Stripe > **Développeurs > Webhooks > Ajouter une destination**.
2. URL : `https://VOTRE-PROJET.supabase.co/functions/v1/stripe-webhook`
3. Événements : `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.refunded`.
4. Copiez le **secret de signature** (il commence par `whsec_`).

### 4c. Ajouter les secrets dans Supabase
Menu **Edge Functions > Secrets**, ajoutez :

| Nom | Valeur |
|---|---|
| `STRIPE_SECRET_KEY` | votre clé secrète Stripe (`sk_test_...` puis `sk_live_...`) |
| `STRIPE_WEBHOOK_SECRET` | le `whsec_...` de l'étape 4b |
| `SITE_URL` | `https://amouloken.github.io/plateforme-cours` (sans `/` final) |
| `PLATFORM_FEE_PERCENT` | `20` (commission sur les ventes des futurs enseignants ; sans effet tant que vous êtes seul) |

`SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` sont fournis automatiquement par Supabase.

### 4d. Tester
Achetez un de vos cours avec la carte de test `4242 4242 4242 4242` (date future, n'importe quel code). Vous arrivez sur la page Merci, puis le cours apparaît dans **Mes cours**, et l'achat dans les statistiques de l'Espace enseignant.

---

## Bien protéger vos vidéos

- **YouTube « non répertorié »** : simple et gratuit, mais **pas vraiment protégé**. Toute personne qui a le lien peut regarder ou le partager. Bien pour les aperçus gratuits.
- **Vimeo (offre payante)** : dans les réglages de confidentialité, choisissez « Masquer de Vimeo » et limitez l'intégration à `amouloken.github.io`. La vidéo ne se lit alors que sur votre site.
- **Bunny Stream** : très bon rapport qualité/prix ; activez la liste de domaines autorisés.

Le site reconnaît automatiquement les liens YouTube, Vimeo (y compris non répertoriés), Bunny Stream et les fichiers `.mp4`.

## Ajouter d'autres enseignants (plus tard)

Déjà prêt dans la base :
- chaque cours a un `teacher_id`, et un enseignant ne voit et ne modifie que ses propres cours ;
- la table `purchases` enregistre pour chaque vente la part plateforme et la part enseignant ;
- la table `teacher_payout_accounts` stocke le compte Stripe Connect de chaque enseignant. Dès qu'un enseignant y a un compte actif, la fonction de paiement lui reverse automatiquement sa part et garde votre commission.

Pour donner le rôle enseignant à quelqu'un :
```sql
update public.profiles set role = 'teacher'
  where id = (select id from auth.users where email = 'email-du-prof@exemple.com');
```
Reste à faire le jour venu : une page d'inscription des enseignants à Stripe Connect (onboarding). On pourra l'ajouter ensemble.

## Personnaliser

- **Couleurs** : `assets/style.css`, variables `--primary`, `--text`, `--muted` en haut du fichier.
- **Textes de l'accueil et « À propos »** : `index.html`.
- **Mentions légales et CGV** : `mentions-legales.html` (obligatoire avant de vendre).
