# Media Timeline App

Minimal timeline app for tracking media by `SETTING` and `PRODUCTION` dates.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:4173](http://localhost:4173).

## Seeded mode vs fresh-start mode

The app supports both:

- Seeded mode (your current dataset) for your own use now
- Fresh-start mode for future public users

Use `.env`:

```bash
cp .env.example .env
```

Set:

- `VITE_USE_SEED_DATA=true` to preload `src/initialData.json`
- `VITE_USE_SEED_DATA=false` to start empty

Notes:

- Existing saved local app data still loads first.
- Seed data is only used when there is no saved data (or saved data is invalid).

## Build

```bash
npm run build
```

## Publish this project to GitHub

Run these commands in this project folder:

```bash
git init
git add .
git commit -m "Initial commit: timeline app"
```

Create a new empty GitHub repository (via website), then connect and push:

```bash
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

## Optional: host quickly on Vercel

- Import the GitHub repo in Vercel
- Framework preset: `Vite`
- Build command: `npm run build`
- Output directory: `dist`
