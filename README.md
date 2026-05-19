# FitConnect Hub

> PWA fitness mobile-first avec coach IA conversationnel proactif et générateur de trajets de marche personnalisés.

**[Demo live](https://pwa-builder-iyadlhassani.replit.app)** · Repo privé

---

## Présentation

FitConnect est une application fitness conçue pour aller au-delà du simple tracking. Elle combine un coach IA proactif qui s'adapte au contexte de l'utilisateur, un générateur de trajets de marche intelligent basé sur des objectifs caloriques personnalisés, et un suivi nutrition/sport complet.

Développé en solo en 3 semaines (soir + weekend), de l'idéation au déploiement en production.

---

## Stack technique

| Couche | Technologies |
|---|---|
| Frontend | React 18 + Vite, TailwindCSS, Zustand, React Query, Wouter |
| Cartographie | React Leaflet, OpenRouteService API, Nominatim/OSM |
| IA | Anthropic Claude API (claude-sonnet-4-5) |
| Auth & DB | Supabase (PostgreSQL + Auth + Storage + RLS) |
| Backend | Node.js 24, Express 5 (TypeScript, esbuild) |
| Notifications | OneSignal (push web) |
| Météo | OpenWeatherMap API |
| i18n | react-i18next (FR + EN) |
| Déploiement | Replit Deployments (PWA installable iOS/Android) |

---

## Architecture

```
fitconnect/
├── artifacts/
│   ├── fitconnect/          ← React PWA (servi sur /)
│   └── api-server/          ← Express API (servi sur /api)
├── lib/
│   ├── api-spec/            ← OpenAPI spec (source de vérité)
│   ├── api-client-react/    ← Hooks React Query auto-générés
│   ├── api-zod/             ← Validators Zod auto-générés
│   └── db/                  ← Drizzle ORM schema + migrations
└── scripts/
```

Un reverse proxy Replit route les requêtes :
- `/` → React PWA (Vite)
- `/api` → Express API server (port 8080)

---

## Features principales

### Coach IA proactif
- Chat conversationnel avec mémoire persistante (Supabase)
- Check-ins automatiques configurables (matin, midi, soir, nuit)
- Contexte dynamique : suggestions basées sur les logs du jour
- Calcul calorique via formule Mifflin-St Jeor
- Conformité RGPD avec disclaimers médicaux

### Générateur de trajets intelligent
- 3 modes : Loop, A→B avec détour, Custom Route
- Algorithme MET pour calcul calorique personnalisé (poids, vitesse, dénivelé)
- Intégration POIs via Overpass API (parcs, monuments)
- Détection d'objectifs impossibles avec messages diagnostiques
- Recovery automatique sur perte de signal GPS

### Tracking complet
- Nutrition : logging manuel + estimation macros par description texte libre (IA)
- Workouts, poids, eau, sommeil
- Photos de progression avec comparateur côte à côte
- Graphiques d'évolution (Chart.js)

### Sécurité & conformité
- Row Level Security PostgreSQL (isolation totale des données)
- Supabase Auth (email + Google OAuth) avec vérification email obligatoire
- Données hébergées en France (Supabase West Paris) — conformité RGPD
- Secrets via variables d'environnement, aucun credential dans le code

---

## Schéma de base de données

```
profiles          → profil utilisateur, objectifs, stats corporelles
coach_messages    → historique conversationnel IA
daily_logs        → tracking quotidien (repas, workouts, poids, eau)
progress_photos   → photos avec métadonnées
walking_routes    → trajets générés + données GPS
```

---

## Lancer le projet en local

```bash
# Cloner le repo
git clone https://github.com/iyadlhassani-stack/fitconnect-hub.git
cd fitconnect-hub

# Copier les variables d'environnement
cp .env.example .env
# Remplir les clés dans .env

# Installer les dépendances
npm install

# Lancer les deux services
npm run dev
```

### Variables d'environnement requises

```env
ANTHROPIC_API_KEY=
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_KEY=
OPENROUTESERVICE_API_KEY=
ONESIGNAL_APP_ID=
OPENWEATHERMAP_API_KEY=
DATABASE_URL=
```

---

## Roadmap

- [ ] Navigation GPS turn-by-turn intégrée
- [ ] Intégration smartwatch (Apple Watch, Garmin)
- [ ] App native iOS/Android (React Native)
- [ ] Tableau de bord coach (interface web pour coaches humains)

---

## Modèle économique

Freemium — 14 jours d'essai gratuit → **4,99€/mois** ou **39,99€/an**

---

*Développé par [Iyad L'Hassani](https://github.com/iyadlhassani-stack)*
