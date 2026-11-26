-- ============================================================
--  Plateforme de cours — schéma de base de données Supabase
--  À coller dans Supabase > SQL Editor > New query > Run
--  Pensé pour plusieurs enseignants dès le départ.
-- ============================================================

-- ---------- 1. Profils (un par compte) ----------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text,
  bio         text,
  avatar_url  text,
  role        text not null default 'student' check (role in ('student', 'teacher', 'admin')),
  created_at  timestamptz not null default now()
);

-- Crée automatiquement le profil à l'inscription
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- 2. Comptes de versement des enseignants (Stripe Connect, pour plus tard) ----------
create table public.teacher_payout_accounts (
  teacher_id          uuid primary key references public.profiles (id) on delete cascade,
  stripe_account_id   text unique,
  charges_enabled     boolean not null default false,
  payouts_enabled     boolean not null default false,
  commission_percent  numeric(5,2),          -- commission propre à cet enseignant (sinon valeur par défaut)
  updated_at          timestamptz not null default now()
);

-- ---------- 3. Cours ----------
create table public.courses (
  id            uuid primary key default gen_random_uuid(),
  teacher_id    uuid not null references public.profiles (id) on delete restrict,
  slug          text not null unique check (slug ~ '^[a-z0-9-]+$'),
  title         text not null,
  subtitle      text,
  description   text,
  cover_url     text,
  price_cents   integer not null default 0 check (price_cents >= 0),
  currency      text not null default 'eur',
  is_published  boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on public.courses (teacher_id);

-- ---------- 4. Leçons (titres visibles publiquement = programme du cours) ----------
create table public.lessons (
  id               uuid primary key default gen_random_uuid(),
  course_id        uuid not null references public.courses (id) on delete cascade,
  title            text not null,
  position         integer not null default 1,
  duration_min     integer,
  is_free_preview  boolean not null default false,
  notes            text,
  created_at       timestamptz not null default now()
);
create index on public.lessons (course_id, position);

-- ---------- 5. Liens vidéo (table séparée et protégée) ----------
create table public.lesson_videos (
  lesson_id   uuid primary key references public.lessons (id) on delete cascade,
  video_url   text not null
);

-- ---------- 6. Inscriptions (accès d'un élève à un cours) ----------
create table public.enrollments (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  course_id   uuid not null references public.courses (id) on delete restrict,
  source      text not null default 'stripe' check (source in ('stripe', 'free', 'manual')),
  created_at  timestamptz not null default now(),
  unique (user_id, course_id)
);
create index on public.enrollments (course_id);

-- ---------- 7. Achats (historique des paiements, prêt pour les reversements) ----------
create table public.purchases (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references public.profiles (id) on delete restrict,
  course_id              uuid not null references public.courses (id) on delete restrict,
  teacher_id             uuid not null references public.profiles (id) on delete restrict,
  amount_cents           integer not null,
  currency               text not null default 'eur',
  platform_fee_cents     integer not null default 0,   -- part de la plateforme
  teacher_amount_cents   integer not null default 0,   -- part de l'enseignant
  stripe_session_id      text unique,
  stripe_payment_intent  text,
  status                 text not null default 'paid' check (status in ('paid', 'refunded')),
  created_at             timestamptz not null default now()
);
create index on public.purchases (teacher_id);
create index on public.purchases (user_id);

-- ---------- 8. Progression des élèves ----------
create table public.lesson_progress (
  user_id       uuid not null references public.profiles (id) on delete cascade,
  lesson_id     uuid not null references public.lessons (id) on delete cascade,
  completed_at  timestamptz not null default now(),
  primary key (user_id, lesson_id)
);

-- ---------- updated_at automatique ----------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger courses_touch before update on public.courses
  for each row execute function public.touch_updated_at();

-- ============================================================
--  Fonctions d'aide pour les règles de sécurité
-- ============================================================
create or replace function public.is_teacher()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role in ('teacher', 'admin'));
$$;

create or replace function public.owns_course(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from courses where id = cid and teacher_id = auth.uid());
$$;

create or replace function public.is_enrolled(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from enrollments where course_id = cid and user_id = auth.uid());
$$;

create or replace function public.course_is_visible(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from courses where id = cid and (is_published or teacher_id = auth.uid()));
$$;

-- ============================================================
--  Sécurité au niveau des lignes (RLS)
-- ============================================================
alter table public.profiles                enable row level security;
alter table public.teacher_payout_accounts enable row level security;
alter table public.courses                 enable row level security;
alter table public.lessons                 enable row level security;
alter table public.lesson_videos           enable row level security;
alter table public.enrollments             enable row level security;
alter table public.purchases               enable row level security;
alter table public.lesson_progress         enable row level security;

-- Profils : chacun voit le sien ; les profils enseignants sont publics (nom affiché sur les cours)
create policy "profil: lecture" on public.profiles for select
  using (id = auth.uid() or role in ('teacher', 'admin'));
-- Chacun modifie son profil, mais PAS son rôle (voir les droits par colonne plus bas)
create policy "profil: modification" on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.profiles from anon, authenticated;
grant update (full_name, bio, avatar_url) on public.profiles to authenticated;

-- Comptes de versement : visibles uniquement par l'enseignant concerné (écriture par le serveur)
create policy "versement: lecture" on public.teacher_payout_accounts for select
  using (teacher_id = auth.uid());

-- Cours : publiés visibles par tous ; l'enseignant gère les siens
create policy "cours: lecture" on public.courses for select
  using (is_published or teacher_id = auth.uid());
create policy "cours: création" on public.courses for insert
  with check (teacher_id = auth.uid() and public.is_teacher());
create policy "cours: modification" on public.courses for update
  using (teacher_id = auth.uid()) with check (teacher_id = auth.uid() and public.is_teacher());
create policy "cours: suppression" on public.courses for delete
  using (teacher_id = auth.uid());

-- Leçons : titres visibles si le cours est visible ; gestion par l'enseignant propriétaire
create policy "leçons: lecture" on public.lessons for select
  using (public.course_is_visible(course_id));
create policy "leçons: création" on public.lessons for insert
  with check (public.owns_course(course_id));
create policy "leçons: modification" on public.lessons for update
  using (public.owns_course(course_id)) with check (public.owns_course(course_id));
create policy "leçons: suppression" on public.lessons for delete
  using (public.owns_course(course_id));

-- Vidéos : LE point clé. Le lien n'est envoyé qu'aux élèves inscrits,
-- pour les aperçus gratuits, ou à l'enseignant propriétaire.
create policy "vidéos: lecture" on public.lesson_videos for select
  using (exists (
    select 1 from public.lessons l
    where l.id = lesson_id
      and (public.owns_course(l.course_id)
           or (l.is_free_preview and public.course_is_visible(l.course_id))
           or public.is_enrolled(l.course_id))
  ));
create policy "vidéos: création" on public.lesson_videos for insert
  with check (exists (select 1 from public.lessons l where l.id = lesson_id and public.owns_course(l.course_id)));
create policy "vidéos: modification" on public.lesson_videos for update
  using (exists (select 1 from public.lessons l where l.id = lesson_id and public.owns_course(l.course_id)))
  with check (exists (select 1 from public.lessons l where l.id = lesson_id and public.owns_course(l.course_id)));
create policy "vidéos: suppression" on public.lesson_videos for delete
  using (exists (select 1 from public.lessons l where l.id = lesson_id and public.owns_course(l.course_id)));

-- Inscriptions : l'élève voit les siennes, l'enseignant voit celles de ses cours.
-- Un élève peut s'inscrire lui-même UNIQUEMENT à un cours gratuit et publié.
-- Les inscriptions payantes sont créées par le webhook Stripe (clé serveur).
create policy "inscriptions: lecture" on public.enrollments for select
  using (user_id = auth.uid() or public.owns_course(course_id));
create policy "inscriptions: cours gratuit" on public.enrollments for insert
  with check (
    user_id = auth.uid() and source = 'free'
    and exists (select 1 from public.courses c where c.id = course_id and c.is_published and c.price_cents = 0)
  );

-- Achats : lecture seule (élève acheteur ou enseignant vendeur). Écriture par le webhook uniquement.
create policy "achats: lecture" on public.purchases for select
  using (user_id = auth.uid() or teacher_id = auth.uid());

-- Progression : chacun gère la sienne, seulement sur les leçons auxquelles il a accès
create policy "progression: lecture" on public.lesson_progress for select
  using (user_id = auth.uid());
create policy "progression: ajout" on public.lesson_progress for insert
  with check (user_id = auth.uid() and exists (
    select 1 from public.lessons l where l.id = lesson_id
      and (public.is_enrolled(l.course_id) or l.is_free_preview or public.owns_course(l.course_id))));
create policy "progression: modification" on public.lesson_progress for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "progression: suppression" on public.lesson_progress for delete
  using (user_id = auth.uid());

-- ============================================================
--  APRÈS votre inscription sur le site : devenir enseignant
--  Remplacez l'e-mail puis exécutez cette ligne seule.
-- ============================================================
-- update public.profiles set role = 'admin'
--   where id = (select id from auth.users where email = 'votre-email@exemple.com');
