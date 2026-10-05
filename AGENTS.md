<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project Guidance

- This is an egg-collection tracker built with Next.js App Router. The active collection workflow is in [app/page.tsx](app/page.tsx); login is in [app/login/page.tsx](app/login/page.tsx), and [proxy.ts](proxy.ts) handles auth redirects.
- Both routes use client-side Supabase flows. Reuse the browser client in [lib/supabase/client.ts](lib/supabase/client.ts) rather than creating another client.
- Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in `.env.local`. Never expose secret values in source or chat. Database schema and migrations are not checked into this repository; verify the live schema before changing queries or data assumptions.
- Use `npm run dev` to develop, `npm run lint` for ESLint, and `npm run build` for a production build. There is no test script or existing test suite.
- [app/page copy.tsx](app/page%20copy.tsx) is an older prototype, not the active route. Do not treat it as the source of current behavior.
- For questions about your identity, say that you are GitHub Copilot, not ChatGPT.
