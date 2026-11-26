// ============================================================
//  Fonctions communes à toutes les pages
// ============================================================
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm";
import { CONFIG } from "./config.js";

export const isConfigured =
  CONFIG.SUPABASE_URL.startsWith("https://") &&
  !CONFIG.SUPABASE_URL.includes("VOTRE-PROJET") &&
  !CONFIG.SUPABASE_ANON_KEY.includes("VOTRE_CLE");

export const supabase = isConfigured
  ? createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY)
  : null;

export const $ = (sel, root = document) => root.querySelector(sel);

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

export function formatPrice(cents, currency = "eur") {
  if (!cents) return "Gratuit";
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: currency.toUpperCase() })
    .format(cents / 100);
}

export function slugify(text) {
  return String(text)
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

export function param(name) {
  return new URLSearchParams(location.search).get(name);
}

export function showNotice(el, message, type = "") {
  el.className = "notice " + type;
  el.textContent = message;
  el.classList.remove("hidden");
}

// ---------- Utilisateur ----------
export async function getUser() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}

export async function getProfile(userId) {
  if (!supabase || !userId) return null;
  const { data } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  return data;
}

export function isTeacher(profile) {
  return profile && (profile.role === "teacher" || profile.role === "admin");
}

// Redirige vers la connexion si l'utilisateur n'est pas connecté
export async function requireUser() {
  const user = await getUser();
  if (!user) {
    location.href = "connexion.html?retour=" + encodeURIComponent(location.pathname.split("/").pop() + location.search);
    return null;
  }
  return user;
}

// ---------- En-tête (menu) et pied de page ----------
export async function renderLayout() {
  document.querySelectorAll("[data-site-name]").forEach((el) => (el.textContent = CONFIG.SITE_NAME));
  document.querySelectorAll("[data-year]").forEach((el) => (el.textContent = new Date().getFullYear()));

  const nav = $("#nav");
  if (!nav) return { user: null, profile: null };

  if (!isConfigured) {
    nav.innerHTML = `<a href="index.html#cours">Catalogue</a>`;
    const banner = document.createElement("div");
    banner.className = "notice warn container";
    banner.style.marginTop = "16px";
    banner.textContent =
      "Configuration manquante : ouvrez assets/config.js et collez l'URL et la clé « anon » de votre projet Supabase (voir LISEZMOI.md).";
    document.querySelector("main")?.prepend(banner);
    return { user: null, profile: null };
  }

  const user = await getUser();
  const profile = user ? await getProfile(user.id) : null;

  let html = `<a href="index.html#cours">Catalogue</a>`;
  if (user) {
    html += `<a href="mes-cours.html">Mes cours</a>`;
    if (isTeacher(profile)) html += `<a href="enseignant.html">Espace enseignant</a>`;
    html += `<a href="#" id="logout">Déconnexion</a>`;
  } else {
    html += `<a href="connexion.html" class="btn btn-small">Connexion</a>`;
  }
  nav.innerHTML = html;

  $("#logout")?.addEventListener("click", async (e) => {
    e.preventDefault();
    await supabase.auth.signOut();
    location.href = "index.html";
  });

  return { user, profile };
}

// ---------- Cartes de cours ----------
export function courseCard(course) {
  const cover = course.cover_url
    ? `<img class="course-cover" src="${escapeHtml(course.cover_url)}" alt="" loading="lazy">`
    : `<div class="course-cover"></div>`;
  const teacher = course.teacher?.full_name ? `Par ${escapeHtml(course.teacher.full_name)}` : "";
  return `
    <a class="course-card" href="cours.html?c=${encodeURIComponent(course.slug)}">
      ${cover}
      <div class="course-body">
        <h3>${escapeHtml(course.title)}</h3>
        <div class="teacher">${teacher}</div>
        <p class="muted" style="margin:0">${escapeHtml(course.subtitle || "")}</p>
        <div class="price">${formatPrice(course.price_cents, course.currency)}</div>
      </div>
    </a>`;
}

// ---------- Vidéos (YouTube, Vimeo, Bunny Stream, autre lien) ----------
export function detectProvider(url) {
  const u = String(url || "").toLowerCase();
  if (u.includes("youtube.com") || u.includes("youtu.be")) return "youtube";
  if (u.includes("vimeo.com")) return "vimeo";
  if (u.includes("mediadelivery.net") || u.includes("b-cdn.net")) return "bunny";
  return "other";
}

export function toEmbedUrl(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return null; }
  const host = parsed.hostname.replace(/^www\.|^m\./, "");

  // YouTube : watch?v=ID, youtu.be/ID, /embed/ID, /shorts/ID, /live/ID
  if (host === "youtu.be") return `https://www.youtube-nocookie.com/embed/${parsed.pathname.slice(1)}?rel=0`;
  if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
    const v = parsed.searchParams.get("v");
    if (v) return `https://www.youtube-nocookie.com/embed/${v}?rel=0`;
    const m = parsed.pathname.match(/\/(embed|shorts|live)\/([^/?]+)/);
    if (m) return `https://www.youtube-nocookie.com/embed/${m[2]}?rel=0`;
  }

  // Vimeo : vimeo.com/ID ou vimeo.com/ID/HASH (vidéo non répertoriée)
  if (host === "player.vimeo.com") return url;
  if (host === "vimeo.com") {
    const m = parsed.pathname.match(/\/(\d+)(?:\/([a-z0-9]+))?/i);
    if (m) return `https://player.vimeo.com/video/${m[1]}${m[2] ? "?h=" + m[2] : ""}`;
  }

  // Bunny Stream : lien iframe.mediadelivery.net/embed/... ou /play/...
  if (host === "iframe.mediadelivery.net") return url.replace("/play/", "/embed/");

  return null; // autre lien : géré à part
}

export function videoPlayerHtml(url) {
  const embed = toEmbedUrl(url);
  if (embed) {
    return `<div class="video-wrap"><iframe src="${escapeHtml(embed)}" title="Vidéo de la leçon"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
      allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`;
  }
  if (/\.(mp4|webm|ogg)(\?|$)/i.test(url)) {
    return `<div class="video-wrap"><video src="${escapeHtml(url)}" controls controlsList="nodownload" preload="metadata"></video></div>`;
  }
  return `<div class="card"><p>Cette leçon est disponible sur un lien externe :</p>
    <a class="btn" href="${escapeHtml(url)}" target="_blank" rel="noopener">Ouvrir la vidéo</a></div>`;
}
