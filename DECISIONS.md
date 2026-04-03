# NSP Email Tool — Technical Decisions Log

## Phase 7 Decisions

### D7-01: Strategy Hub replaces Today as home screen
- **Decision:** Strategy Hub becomes the default `/` route. Today.jsx preserved but no longer in sidebar.
- **Why:** The AI strategist is now the entry point. Amir should see one smart recommendation, not a dashboard of stats.
- **Trade-off:** Loses quick glance at SNE queue and hot leads on home. Mitigated by including situation panel in Strategy Hub left sidebar.

### D7-02: Campaigns removed from sidebar
- **Decision:** No more dedicated Campaigns sidebar item. All campaigns launch from Strategy Hub → Unified Flow.
- **Why:** Campaigns are a destination, not a starting point. The AI should guide Amir to the right campaign.
- **Trade-off:** Past campaigns still accessible via Reports tab.

### D7-03: Tracking settings stored in Firestore (not env vars)
- **Decision:** Global tracking toggles (open pixel, unique links, website tracking, GA ID) stored in `trackingSettings/global` Firestore doc.
- **Why:** Amir needs to toggle these from the UI. Env vars require redeployment. Firestore is instant.
- **Trade-off:** Backend reads Firestore on every send. Mitigated by caching settings in memory for 5 minutes.

### D7-04: Open tracking pixel uses existing endpoint pattern
- **Decision:** Enhanced existing `/api/track/open` to log to Firestore asynchronously and return proper 1x1 GIF.
- **Why:** Endpoint already existed from Phase 1 but only logged to console. Phase 7 adds Firestore persistence and engagement score updates.

### D7-05: Link redirect uses base64-encoded URLs
- **Decision:** `/r?c=[contactId]&l=[campaignId]&u=[base64url]` format for tracked links.
- **Why:** Base64 encoding prevents URL parameter conflicts and handles special characters in destination URLs.

### D7-06: Strategy Hub context cached 15 minutes
- **Decision:** `getStrategyContext()` assembles campaign history, list summaries, weather, objectives — cached in memory for 15 min.
- **Why:** Assembling context requires multiple Firestore reads + weather API calls. 15 min cache balances freshness with performance.

### D7-07: Claude Sonnet 4 for all AI conversations
- **Decision:** Strategy Hub and Design Hub both use `claude-sonnet-4-20250514` (same as all other AI endpoints).
- **Why:** Consistency. Sonnet is fast enough for conversational use and smart enough for marketing strategy.

### D7-08: Conversation history — last 20 messages passed to Claude
- **Decision:** Store full conversation in Firestore, pass last 20 messages to Claude API per call.
- **Why:** 20 messages gives enough context for strategy continuity without hitting token limits.

### D7-09: Fuzzy matching runs as background process
- **Decision:** After CSV upload, fuzzy matching (name+city, name+address) runs in background. UI shows progress.
- **Why:** Fuzzy matching against entire contact DB is O(n*m). Can't block upload UI.

### D7-10: Confidence scoring uses source hierarchy
- **Decision:** Data confidence: Official export (green) > Skip trace (yellow) > AI estimate (red).
- **Why:** Need a clear hierarchy when data conflicts exist. Official CertaPro exports are ground truth.

### D7-11: Design Hub recommends style based on list tier
- **Decision:** Personal lists → Pure Personal (no logo). Cold lists → Soft Branded. Promotions → Campaign Style.
- **Why:** Plain text emails have 40% higher open rates. Personal lists should look like personal emails.

### D7-12: Campaign flow drafts saved per-step
- **Decision:** `campaignFlowDrafts` collection saves state at every step. Resume from any point.
- **Why:** Building a campaign is a multi-step process. Amir shouldn't lose progress if he navigates away.

### D7-13: Optimal send time check at Step 6
- **Decision:** If send time is outside Tue-Thu 9-11am or 1-3pm, suggest scheduling instead.
- **Why:** Email marketing data shows 30% lower open rates outside these windows.

### D7-14: Firebase Admin SDK for backend Firestore access
- **Decision:** Backend uses firebase-admin for server-side Firestore reads/writes (tracking, context assembly).
- **Why:** Backend needs to read contacts, campaigns, lists for strategy context. Admin SDK has full access without auth token forwarding.
- **Implementation:** Initialize with application default credentials or service account.

## Phase 8 Decisions

### D8-01: Strategy Hub becomes inline, not sidebar item
- **Decision:** Strategy AI chat moves from sidebar page to inline "Let AI suggest" option inside campaign flow Step 1.
- **Why:** Strategy Hub as standalone page felt disconnected from the campaign flow. Users start campaigns, not strategy sessions.

### D8-02: Storm Score stored on contacts, not calculated on-demand
- **Decision:** Calculate Storm Score daily for all contacts, store on document. Previously only calculated for new leads on-demand.
- **Why:** Enables sorting, filtering, Hot Contacts tab, and AI recommendations by score without recalculating every time.

### D8-03: Campaign delivery log as Firestore collection
- **Decision:** New `campaignDeliveries` collection logs every email sent per contact per campaign.
- **Why:** Powers "exclude contacts emailed in last X days", per-contact campaign history, and engagement tracking.

### D8-04: Source tracking as array on contact document
- **Decision:** Add `sources[]` array to contacts instead of separate collection. Each source entry has name, type, listId, addedAt.
- **Why:** Sources are always read with the contact. Array on document avoids joins. Backfill from existing lists array.

### D8-05: Coordinates stored at import time
- **Decision:** Geocode addresses during CSV import (background job), store lat/lng on contact. Use Google Geocoding if key available, fall back to Open-Meteo city-level.
- **Why:** Proximity search requires coordinates. Geocoding on every search is too slow and rate-limited.

### D8-06: Exclusion filters as client-side filtering
- **Decision:** Audience exclusions (by list, city, engagement, specific contact) run client-side in the browser.
- **Why:** At Amir's scale (<10K contacts), client-side filtering is instant. Server-side adds complexity without benefit until 50K+.

### D8-07: Sender profiles in Firestore, injected into AI prompts
- **Decision:** Store sender profiles in `senderProfiles` collection. Inject name, style notes, and signature into AI generation prompt.
- **Why:** AI generates signature as part of email (flows naturally) instead of hardcoded footer append.

### D8-08: Strategy AI outputs structured JSON brief
- **Decision:** When strategy conversation reaches agreement, AI outputs JSON with subjectStrategy, tone, length, includes/excludes alongside conversational text.
- **Why:** Auto-fills ALL Campaign Brief fields, not just content direction textarea. Reduces manual work after strategy session.

### D8-09: Lead Finder validation inbox pattern
- **Decision:** Leads stay in pending queue until Amir explicitly approves into a list. Nothing auto-enters contacts database.
- **Why:** County record scraping can produce low-quality leads. Amir needs to validate before they pollute his contact database.

### D8-10: Nearby search uses stored coordinates with Haversine
- **Decision:** Nearby search calculates distance using stored lat/lng with Haversine formula. No API calls at search time.
- **Why:** Instant results. No rate limits. Accurate to street level if Google Geocoding was used at import.

## Pre-Launch Fix Sprint Decisions (April 2026)

### FIX-01: Client-side pagination replaces hard slice limits
- **Decision:** Contacts page and ListDetail now paginate 50 per page with Previous/Next controls. Removed all `slice(0, 100)` and `slice(0, 20)` hard limits.
- **Why:** 300 contacts uploaded but only 9-20 shown. Client-side pagination at 50/page handles <10K contacts instantly. No server-side pagination needed at Amir's scale.

### FIX-02: Dedicated contact profile page at /contacts/profile/:contactId
- **Decision:** Full profile page replaces inline ContactDetail panel. Accessible from all contact tables (Contacts, HotContacts, Nearby, ListDetail, campaign audience).
- **Why:** Profile needs editable notes, AI rewrite, Storm Score breakdown, full job history, campaign history, Mark as Won — too much for an inline panel.

### FIX-03: Fuzzy duplicate detection wired into CSV import
- **Decision:** After email-based upsert, run `/api/contacts/fuzzy-match` comparing new list contacts against existing contacts by name+city. Auto-merge at 80%+ confidence, flag 60-79% for manual review.
- **Why:** Same person in CertaPro list and NSP list with different emails was treated as two contacts. Could lead to embarrassing "not sure if you remember me" emails to known customers.

### FIX-04: Brand profile stored in Firestore, wrapInStyle() made dynamic
- **Decision:** New `brandProfile/main` Firestore doc stores company name, primary color, logo URL, address, phone, tagline. `wrapInStyle()` reads from brand profile (cached 30 min) instead of hardcoded values.
- **Why:** Changing company color or address required code changes and redeployment. Now configurable from Settings → Brand tab.

### FIX-05: Logo stored as base64 data URL
- **Decision:** Logo upload converts to base64 data URL stored in Firestore brand profile document (no separate file storage).
- **Why:** Avoids needing Firebase Storage setup, S3, or CDN configuration. At <2MB per logo, Firestore handles it fine. Trade-off: slightly larger document size.

### FIX-06: Sender profiles injected into AI generation prompts
- **Decision:** Email generation endpoints fetch sender profile from Firestore by email address, inject `styleNotes` and `title` into the system prompt. Added instruction "Do NOT include a signature" since wrapInStyle adds it.
- **Why:** AI was generating signatures that duplicated the hardcoded footer. Now AI writes the body only, wrapInStyle appends the signature from the sender profile.

### FIX-07: Auto-geocode triggered after CSV import
- **Decision:** After import completes, fire-and-forget call to `/api/contacts/geocode-batch` runs in background.
- **Why:** Nearby search returned zero results because contacts had no coordinates. Now geocoding happens automatically without blocking the import flow.

### FIX-08: Test email guard prevents empty sends
- **Decision:** Send Test Email button disabled when no generated emails exist. Shows message "Generate emails first (complete Step 4)".
- **Why:** Clicking Send Test before generating emails sent empty/placeholder content labeled "Test Email" which confused Amir.

### FIX-09: AI note rewriting with approval modal
- **Decision:** New `/api/ai/rewrite-notes` endpoint uses Claude to clean up raw notes. Shows before/after comparison. Amir approves before saving.
- **Why:** Amir types quick shorthand notes. AI formats them into clean CRM entries while preserving all facts. Approval step prevents unwanted changes.

### FIX-10: Contact merge endpoint for manual duplicate resolution
- **Decision:** `/api/contacts/merge` takes keepId and mergeId, combines lists, job history, fills data gaps from merge contact, promotes tier, deletes merged contact.
- **Why:** Fuzzy detection flags possible duplicates. Amir reviews side-by-side and clicks Merge or Keep Separate. System needs a way to combine two contacts cleanly.
