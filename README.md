# Closet — paper catalog

Editorial wardrobe app. Photograph what you own. Dress from it.

This is the **paper-catalog redesign** of Closet.

- **`main`** — production Next.js + Supabase (closet-joeybats / Vercel ten-hazel). Leave it.
- **`paper-catalog`** — this tree. Paper-float tiles, paste-to-add, Daily Drop, stylist. Your photo stays your photo.

## Run it

```bash
git clone -b paper-catalog https://github.com/gallojo1819-sudo/Closet.git
cd Closet
npm install
cp .env.example .env.local
npm run dev
```

Opens on port 8080. Paste a garment photo on **Add**, then **Keep my photo**.

## What this build does

- Closet grid is catalog tiles on paper, not a camera roll.
- Upload / paste / camera uses *your* pixels. Nothing is generated as a stand-in.
- Sample wardrobe is labeled. First real keep replaces the samples.
- Daily Drop, Ask the Stylist, saved outfits.

## Env

| Key | Needed |
|---|---|
| `XAI_API_KEY` | Optional. Tags garments and powers the stylist. |
| Supabase / `FAL_KEY` | Still on `main`. Wire next, after this visual pass. |

## Stack

TanStack Start + Vite + React 19 + Tailwind v4. Closet data is local for this pass so the preview works without auth.
