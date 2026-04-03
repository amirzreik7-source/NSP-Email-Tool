import express from 'express';
import cors from 'cors';
import nodemailer from 'nodemailer';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Try loading .env file manually (dotenv removed — Railway has issues with it)
try {
  const envPath = path.resolve(__dirname, '.env');
  if (existsSync(envPath)) {
    console.log('.env file found at', envPath);
    readFileSync(envPath, 'utf-8').split('\n').forEach(line => {
      const eq = line.indexOf('=');
      if (eq > 0) {
        const key = line.substring(0, eq).trim();
        const val = line.substring(eq + 1).trim();
        if (key && val && !process.env[key]) {
          process.env[key] = val;
        }
      }
    });
  } else {
    console.log('No .env file at', envPath);
  }
} catch(e) { console.log('.env load error:', e.message); }

// Log which keys are available
console.log('ENV CHECK:', {
  PORT: process.env.PORT || 'NOT SET',
  CLAUDE: process.env.CLAUDE_API_KEY ? 'SET (' + process.env.CLAUDE_API_KEY.substring(0,10) + '...)' : 'NOT SET',
  BREVO: process.env.BREVO_API_KEY ? 'SET' : 'NOT SET',
});

function getKey(name) {
  return process.env[name] || '';
}

let claude = null;
async function getClaude() {
  const key = getKey('CLAUDE_API_KEY');
  if (!claude && key) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    claude = new Anthropic({ apiKey: key });
  }
  return claude;
}

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Serve frontend build files
const distPath = path.resolve(__dirname, '..', 'frontend', 'dist');
app.use(express.static(distPath));

// ── Health check ──
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    phase: 8,
    hasClaudeKey: !!getKey('CLAUDE_API_KEY'),
    claudeKeyPrefix: getKey('CLAUDE_API_KEY') ? getKey('CLAUDE_API_KEY').substring(0, 10) + '...' : 'MISSING',
    hasBrevoKey: !!getKey('BREVO_API_KEY'),
    envSource: getKey('CLAUDE_API_KEY') ? (process.env.CLAUDE_API_KEY ? 'env' : 'file') : 'none',
  });
});

// ══════════════════════════════════════════
// PHASE 1: AI & SENDING
// ══════════════════════════════════════════

// ── AI: Analyze list ──
app.post('/api/ai/analyze-list', async (req, res) => {
  try {
    const ai = await getClaude();
    if (!ai) return res.status(500).json({ error: 'Claude API key not configured' });
    const { userContext, csvSample, totalCount, columns } = req.body;

    const message = await ai.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: `You are a marketing analyst for Northern Star Painters, a house painting company in Northern Virginia. Analyze contact lists and return ONLY valid JSON.`,
      messages: [{
        role: 'user',
        content: `Analyze this contact list and return JSON with demographics, patterns, persona, recommended sender, and segment opportunities.

Context from owner: "${userContext}"
Total contacts: ${totalCount}
Columns: ${columns.join(', ')}
Sample data (first 20 rows): ${JSON.stringify(csvSample)}

Return this exact JSON structure:
{
  "demographics": {
    "locations": {"CityName": count},
    "jobTypes": {"TypeName": count},
    "timeline": {"Year": count},
    "averageJobValue": number
  },
  "patterns": ["pattern1", "pattern2"],
  "persona": "One paragraph describing who these people are",
  "recommendedSender": "amirz@northernstarpainters.com" or "mary@northernstarpainters.com",
  "recommendedTone": "warm_personal" or "professional" or "friendly",
  "segmentOpportunities": [
    {"name": "Segment Name", "estimatedCount": number, "angle": "Messaging angle", "cities": ["city1"]}
  ]
}

ONLY return JSON. No other text.`
      }],
    });

    const text = message.content[0].text;
    const json = JSON.parse(text.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
    res.json(json);
  } catch (error) {
    console.error('AI analysis error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── AI: Generate email ──
app.post('/api/ai/generate-email', async (req, res) => {
  try {
    const ai = await getClaude();
    if (!ai) return res.status(500).json({ error: 'Claude API key not configured' });
    const { goal, persona, senderName, tone, personalizationFields } = req.body;

    const message = await ai.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: `You write emails for Northern Star Painters, a house painting company in Northern Virginia. Write emails that feel personal, not like marketing templates. Available personalization fields: ${personalizationFields.join(', ')}`,
      messages: [{
        role: 'user',
        content: `Write an email campaign.
Sender: ${senderName}
Tone: ${tone}
List persona: ${persona}
Goal: ${goal}

Return JSON:
{
  "subject": "Subject line with {FirstName} if appropriate",
  "previewText": "Preview text (50-90 chars)",
  "bodyHTML": "Full HTML email body with personalization fields",
  "bodyText": "Plain text version"
}

ONLY return JSON.`
      }],
    });

    const text = message.content[0].text;
    const json = JSON.parse(text.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
    res.json(json);
  } catch (error) {
    console.error('AI email gen error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ══════════════════════════════════════════
// PHASE 2: SMART OUTREACH ENGINE
// ══════════════════════════════════════════

// ── AI: Generate UNIQUE email per contact ──
app.post('/api/ai/generate-unique-email', async (req, res) => {
  try {
    const ai = await getClaude();
    if (!ai) return res.status(500).json({ error: 'Claude API key not configured' });
    const { contact, senderName, senderEmail, tone, goal, listPersona } = req.body;

    // Fetch sender profile
    let senderProfile = null;
    try {
      const db = await getAdminDb();
      if (db) {
        const snap = await db.collection('senderProfiles').where('email', '==', senderEmail).limit(1).get();
        if (!snap.empty) senderProfile = snap.docs[0].data();
      }
    } catch (e) {}
    const styleNotes = senderProfile?.styleNotes || '';

    const jobHistory = (contact.jobHistory || []).map(j =>
      `${j.jobType} in ${j.jobDate ? new Date(j.jobDate).getFullYear() : 'unknown'} ($${j.jobValue || 'unknown'}) with ${j.salesRep || 'unknown'}`
    ).join('; ');

    const notes = contact.intelligenceProfile?.personalNotes || '';

    const message = await ai.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: `You are ${senderName} from Northern Star Painters, a house painting company in Northern Virginia. Write a personal email to ONE specific person. This should read like a real human wrote it — not a template. No marketing language. No "Dear valued customer." Write like you're texting a friend about business.
${styleNotes ? 'WRITING STYLE: ' + styleNotes : ''}
Do NOT include a signature at the end — it will be added automatically.`,
      messages: [{
        role: 'user',
        content: `Write a personal email to this specific person:

Name: ${contact.firstName} ${contact.lastName}
City: ${contact.address?.city || 'Northern Virginia'}
Job History: ${jobHistory || 'None on record'}
Personal Notes: ${notes || 'None'}
Engagement: ${contact.engagement?.engagementTrend || 'new'} (score: ${contact.engagement?.engagementScore || 0})
List Context: ${listPersona || 'Painting customer in Northern Virginia'}

Sender: ${senderName} (${senderEmail})
Tone: ${tone}
Goal: ${goal}

Return JSON:
{
  "subject": "Personal subject line for this specific person",
  "bodyHTML": "HTML email body — personal, specific to this person",
  "bodyText": "Plain text version"
}

ONLY return JSON.`
      }],
    });

    const text = message.content[0].text;
    const json = JSON.parse(text.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
    res.json(json);
  } catch (error) {
    console.error('AI unique email error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── AI: Generate text message ──
app.post('/api/ai/generate-text', async (req, res) => {
  try {
    const ai = await getClaude();
    if (!ai) return res.status(500).json({ error: 'Claude API key not configured' });
    const { contact, senderName, goal, conversationHistory } = req.body;

    const notes = contact.intelligenceProfile?.personalNotes || '';
    const history = (conversationHistory || []).map(m => `${m.from}: ${m.text}`).join('\n');

    const message = await ai.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 256,
      system: `You are ${senderName} from Northern Star Painters. Write SHORT text messages (under 160 chars ideally, max 300). Sound like a real person texting — casual, friendly, no marketing speak. Never start with "Hi" followed by a comma.`,
      messages: [{
        role: 'user',
        content: `Write a text message to:
Name: ${contact.firstName} ${contact.lastName}
City: ${contact.address?.city || ''}
Personal Notes: ${notes || 'None'}
Goal: ${goal}
${history ? 'Conversation so far:\n' + history : 'This is the first message.'}

Return JSON:
{ "text": "The text message to send" }

ONLY return JSON.`
      }],
    });

    const text = message.content[0].text;
    const json = JSON.parse(text.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
    res.json(json);
  } catch (error) {
    console.error('AI text gen error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── AI: Draft reply to incoming text ──
app.post('/api/ai/draft-reply', async (req, res) => {
  try {
    const ai = await getClaude();
    if (!ai) return res.status(500).json({ error: 'Claude API key not configured' });
    const { contact, senderName, incomingMessage, conversationHistory } = req.body;

    const notes = contact.intelligenceProfile?.personalNotes || '';
    const history = (conversationHistory || []).map(m => `${m.from}: ${m.text}`).join('\n');

    const message = await ai.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 256,
      system: `You are ${senderName} from Northern Star Painters. Draft a reply to a customer's text message. Keep it short, personal, and aim to move toward booking an estimate. Sound natural — like a real person texting.`,
      messages: [{
        role: 'user',
        content: `Customer: ${contact.firstName} ${contact.lastName} (${contact.address?.city || ''})
Personal Notes: ${notes || 'None'}
Conversation:
${history}
${contact.firstName}: ${incomingMessage}

Draft ${senderName}'s reply. Return JSON:
{ "text": "The reply text" }

ONLY return JSON.`
      }],
    });

    const text = message.content[0].text;
    const json = JSON.parse(text.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
    res.json(json);
  } catch (error) {
    console.error('AI reply draft error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── AI: Calculate relationship score ──
app.post('/api/ai/relationship-score', async (req, res) => {
  try {
    const ai = await getClaude();
    if (!ai) return res.status(500).json({ error: 'Claude API key not configured' });
    const { contact } = req.body;

    const message = await ai.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 256,
      system: `Score the relationship strength between a painting company and a contact. Return a score 1-10 and recommended sender.`,
      messages: [{
        role: 'user',
        content: `Contact: ${contact.firstName} ${contact.lastName}
City: ${contact.address?.city || 'unknown'}
Lists: ${(contact.lists || []).map(l => l.listName + ' (' + l.tier + ')').join(', ')}
Job History: ${(contact.jobHistory || []).map(j => j.jobType + ' ' + j.jobDate + ' $' + j.jobValue + ' rep:' + j.salesRep).join('; ') || 'None'}
Personal Notes: ${contact.intelligenceProfile?.personalNotes || 'None'}
Engagement: score=${contact.engagement?.engagementScore || 0}, trend=${contact.engagement?.engagementTrend || 'new'}, opens=${contact.engagement?.totalOpens || 0}

Return JSON:
{
  "score": 1-10,
  "recommendedSender": "amirz@northernstarpainters.com" or "mary@northernstarpainters.com",
  "reasoning": "Brief explanation"
}

ONLY return JSON.`
      }],
    });

    const text = message.content[0].text;
    const json = JSON.parse(text.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
    res.json(json);
  } catch (error) {
    console.error('AI scoring error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── Send SMS via Brevo ──
app.post('/api/send/sms', async (req, res) => {
  try {
    const { to, text, sender } = req.body;

    const response = await fetch('https://api.brevo.com/v3/transactionalSMS/sms', {
      method: 'POST',
      headers: { 'accept': 'application/json', 'content-type': 'application/json', 'api-key': getKey('BREVO_API_KEY') },
      body: JSON.stringify({
        type: 'transactional',
        unicodeEnabled: true,
        sender: sender || 'NSPainters',
        recipient: to.replace(/[^0-9+]/g, ''),
        content: text,
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'SMS send failed');
    res.json({ success: true, messageId: data.reference });
  } catch (error) {
    console.error('SMS send error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ══════════════════════════════════════════
// PHASE 3: RELATIONSHIP LOOP
// ══════════════════════════════════════════

// ── AI: Generate BATCH of unique emails (one per contact) ──
app.post('/api/ai/generate-unique-emails-batch', async (req, res) => {
  try {
    const ai = await getClaude();
    if (!ai) return res.status(500).json({ error: 'Claude API key not configured' });
    const { contacts, senderName, senderEmail, tone, goal, listPersona } = req.body;
    const results = [];

    // Fetch sender profile for style notes
    let senderProfile = null;
    try {
      const db = await getAdminDb();
      if (db) {
        const snap = await db.collection('senderProfiles').where('email', '==', senderEmail).limit(1).get();
        if (!snap.empty) senderProfile = snap.docs[0].data();
      }
    } catch (e) {}

    const styleNotes = senderProfile?.styleNotes || '';
    const senderTitle = senderProfile?.title || '';

    for (let i = 0; i < contacts.length; i++) {
      const contact = contacts[i];
      try {
        const jobHistory = (contact.jobHistory || []).map(j =>
          `${j.jobType} in ${j.jobDate ? new Date(j.jobDate).getFullYear() : 'unknown'} ($${j.jobValue || 'unknown'}) rep:${j.salesRep || 'unknown'}`
        ).join('; ');
        const tier = (contact.lists || []).some(l => l.tier === 'personal') ? 'personal' : 'general';
        const notes = contact.intelligenceProfile?.personalNotes || '';

        const message = await ai.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1024,
          system: `You are ${senderName}${senderTitle ? ', ' + senderTitle : ''} from Northern Star Painters, Northern Virginia. Write a personal email to ONE person. Read like a real human wrote it. No marketing language. No templates.
${styleNotes ? 'WRITING STYLE: ' + styleNotes : ''}
CRITICAL RULES:
- If tier is "general" or "cold": NEVER claim you know them personally. Use "we know you were interested in painting" angle only.
- If tier is "personal": Reference specific job history naturally.
- Keep under 200 words. Email style, not letter style. No big buttons.
- Never repeat content from previous campaigns.
- Do NOT include a signature at the end of the email — it will be added automatically.`,
          messages: [{
            role: 'user',
            content: `Write email to:
Name: ${contact.firstName} ${contact.lastName}
City: ${contact.address?.city || 'Northern Virginia'}
Tier: ${tier}
Job History: ${jobHistory || 'None'}
Notes: ${notes || 'None'}
Engagement: ${contact.engagement?.engagementTrend || 'new'} (score:${contact.engagement?.engagementScore || 0})
Goal: ${goal}

Return JSON: {"subject":"...","bodyHTML":"...","bodyText":"..."}
ONLY JSON.`
          }],
        });

        const text = message.content[0].text;
        const json = JSON.parse(text.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
        results.push({ contactId: contact.id, email: contact.email, ...json, status: 'ok' });
      } catch (e) {
        results.push({ contactId: contact.id, email: contact.email, status: 'error', error: e.message });
      }
    }

    res.json({ results, total: contacts.length, success: results.filter(r => r.status === 'ok').length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── AI: Pre-send audit ──
app.post('/api/ai/audit-emails', async (req, res) => {
  try {
    const ai = await getClaude();
    if (!ai) return res.status(500).json({ error: 'Claude API key not configured' });
    const { emails, campaignSender, campaignTier } = req.body;

    const message = await ai.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: `You are a quality auditor for email campaigns. Check each email for issues and return JSON.`,
      messages: [{
        role: 'user',
        content: `Audit these ${emails.length} emails. Campaign sender: ${campaignSender}, tier: ${campaignTier}.

For each email, check:
1. Does it claim personal relationship for a cold/general tier contact? (CRITICAL)
2. Does it reference job history the contact doesn't have? (CRITICAL)
3. Did personalization fall back to generic placeholders like "there" or "your area"? (WARNING)
4. Is the tier/sender mismatch? Personal email from Mary or cold email from Amir? (WARNING)
5. Is it significantly shorter than 50 words? (WARNING)

Emails to audit:
${JSON.stringify(emails.slice(0, 50).map(e => ({
  email: e.email,
  tier: e.tier,
  subject: e.subject,
  bodySnippet: (e.bodyText || e.bodyHTML || '').substring(0, 300),
  hasJobHistory: !!(e.jobHistory && e.jobHistory.length),
  city: e.city
})))}

Return JSON:
{
  "passed": number,
  "warnings": [{"email":"...","issue":"...","severity":"warning"}],
  "critical": [{"email":"...","issue":"...","severity":"critical"}],
  "summary": "One line summary"
}
ONLY JSON.`
      }],
    });

    const text = message.content[0].text;
    const json = JSON.parse(text.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
    res.json(json);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── AI: Classify incoming text intent ──
app.post('/api/ai/classify-intent', async (req, res) => {
  try {
    const ai = await getClaude();
    if (!ai) return res.status(500).json({ error: 'Claude API key not configured' });
    const { message: incomingMsg, contactName } = req.body;

    const msg = await ai.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 256,
      system: `Classify the intent of a customer's text message reply. Return JSON only.`,
      messages: [{
        role: 'user',
        content: `${contactName} replied: "${incomingMsg}"

Classify intent. Return JSON:
{
  "intent": "interested" | "question" | "not_interested" | "scheduling" | "unsubscribe" | "other",
  "confidence": 0.0-1.0,
  "suggestedAction": "Brief recommended action"
}
ONLY JSON.`
      }],
    });

    const text = msg.content[0].text;
    const json = JSON.parse(text.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
    res.json(json);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── Tracking: Click redirect with Firestore logging ──
app.get('/api/track/click', (req, res) => {
  const { c: contactId, u: url, cam: campaignId } = req.query;
  console.log(`Click: contact=${contactId} campaign=${campaignId} url=${url}`);
  res.redirect(url || 'https://northernstarpainters.com');
});

// ── Tracking: Open pixel ──
app.get('/api/track/open', (req, res) => {
  const { c: contactId, cam: campaignId } = req.query;
  console.log(`Open: contact=${contactId} campaign=${campaignId}`);
  const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  res.set({ 'Content-Type': 'image/gif', 'Cache-Control': 'no-cache, no-store', 'Content-Length': pixel.length });
  res.end(pixel);
});

// ── Tracking: Page view from website ──
app.post('/api/track/pageview', express.text({ type: '*/*' }), (req, res) => {
  try {
    const data = JSON.parse(req.body);
    console.log(`Pageview: contact=${data.uid} page=${data.page} campaign=${data.cam}`);
    res.status(204).end();
  } catch(e) {
    res.status(204).end();
  }
});

// ── Webhook: Incoming SMS from Brevo ──
app.post('/api/webhook/sms-reply', (req, res) => {
  console.log('SMS webhook received:', JSON.stringify(req.body));
  // Store in memory for frontend to poll — in production use Firestore
  if (!global._smsReplies) global._smsReplies = [];
  global._smsReplies.push({ ...req.body, receivedAt: new Date().toISOString() });
  if (global._smsReplies.length > 100) global._smsReplies = global._smsReplies.slice(-100);
  res.status(200).json({ ok: true });
});

// ── Poll incoming SMS replies ──
app.get('/api/webhook/sms-replies', (req, res) => {
  res.json(global._smsReplies || []);
});

// ── Export contacts for ads (Google/Meta format) ──
app.post('/api/export/customer-match', (req, res) => {
  const { contacts, platform } = req.body;
  if (!contacts || !contacts.length) return res.status(400).json({ error: 'No contacts' });

  const rows = contacts.map(c => {
    if (platform === 'meta') {
      return [c.email || '', c.phone || '', c.firstName || '', c.lastName || '', c.address?.city || '', c.address?.state || '', c.address?.zip || '', 'US'].join(',');
    }
    return [c.email || '', c.phone || '', c.firstName || '', c.lastName || '', c.address?.city || '', c.address?.state || '', c.address?.zip || '', 'US'].join(',');
  });

  const header = platform === 'meta'
    ? 'email,phone,fn,ln,ct,st,zip,country'
    : 'Email,Phone,First Name,Last Name,City,State,Zip,Country';

  const csv = header + '\n' + rows.join('\n');
  res.set({ 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="customer-match-${platform}-${Date.now()}.csv"` });
  res.send(csv);
});

// ══════════════════════════════════════════
// PHASE 4: COMPETITIVE MOAT
// ══════════════════════════════════════════

// ── Win/Loss Logging ──
app.post('/api/win-loss/log', (req, res) => {
  // Frontend stores directly in Firestore — this endpoint for external integrations
  res.json({ ok: true, message: 'Use Firestore directly from frontend' });
});

// ── Competitive Map (aggregated from win/loss data) ──
app.post('/api/competitive/analyze', async (req, res) => {
  try {
    const ai = await getClaude();
    if (!ai) return res.status(500).json({ error: 'Claude API not configured' });
    const { wins, losses } = req.body;

    const msg = await ai.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: 'You analyze competitive data for a house painting company. Return actionable insights as JSON.',
      messages: [{ role: 'user', content: `Analyze ${wins.length} wins and ${losses.length} losses:\n\nWins: ${JSON.stringify(wins.slice(0, 30))}\n\nLosses: ${JSON.stringify(losses.slice(0, 30))}\n\nReturn JSON:\n{\n  "winRateByCity": {"city": rate},\n  "winRateByCompetitor": {"competitor": rate},\n  "topLossReasons": ["reason1"],\n  "topWinReasons": ["reason1"],\n  "insights": ["insight1"],\n  "campaignRecommendations": [{"city":"...","angle":"...","reason":"..."}]\n}\nONLY JSON.` }],
    });
    const text = msg.content[0].text;
    res.json(JSON.parse(text.replace(/```json?\n?/g, '').replace(/```/g, '').trim()));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Weather Check ──
app.post('/api/weather/check-cities', async (req, res) => {
  const { cities } = req.body;
  // NoVA city coordinates
  const coords = {
    'Vienna': { lat: 38.9012, lng: -77.2653 }, 'Arlington': { lat: 38.8816, lng: -77.0910 },
    'McLean': { lat: 38.9339, lng: -77.1773 }, 'Falls Church': { lat: 38.8829, lng: -77.1711 },
    'Ashburn': { lat: 39.0437, lng: -77.4875 }, 'Reston': { lat: 38.9587, lng: -77.3570 },
    'Herndon': { lat: 38.9696, lng: -77.3861 }, 'Fairfax': { lat: 38.8462, lng: -77.3064 },
    'Alexandria': { lat: 38.8048, lng: -77.0469 }, 'Manassas': { lat: 38.7509, lng: -77.4753 },
    'Springfield': { lat: 38.7893, lng: -77.1872 }, 'Oakton': { lat: 38.8810, lng: -77.3014 },
    'Great Falls': { lat: 38.9985, lng: -77.2883 }, 'Chantilly': { lat: 38.8943, lng: -77.4311 },
    'Leesburg': { lat: 39.1157, lng: -77.5636 }, 'Sterling': { lat: 39.0062, lng: -77.4286 },
  };

  const results = [];
  const citiesToCheck = cities || Object.keys(coords);

  for (const city of citiesToCheck) {
    const c = coords[city];
    if (!c) continue;
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lng}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max&temperature_unit=fahrenheit&timezone=America/New_York&forecast_days=7`;
      const r = await fetch(url);
      const data = await r.json();
      const daily = data.daily;
      if (!daily) continue;

      // Check painting conditions
      let consecutivePerfect = 0;
      let maxConsecutive = 0;
      const details = [];
      for (let i = 0; i < daily.time.length; i++) {
        const tempOk = daily.temperature_2m_max[i] >= 50 && daily.temperature_2m_max[i] <= 90;
        const dryOk = daily.precipitation_sum[i] === 0;
        const windOk = daily.wind_speed_10m_max[i] < 20;
        const perfect = tempOk && dryOk && windOk;
        if (perfect) { consecutivePerfect++; maxConsecutive = Math.max(maxConsecutive, consecutivePerfect); }
        else consecutivePerfect = 0;
        details.push({ date: daily.time[i], high: daily.temperature_2m_max[i], low: daily.temperature_2m_min[i], rain: daily.precipitation_sum[i], wind: daily.wind_speed_10m_max[i], perfect });
      }

      results.push({
        city,
        perfectDays: maxConsecutive,
        isPaintingWeather: maxConsecutive >= 5,
        tempRange: `${Math.round(Math.min(...daily.temperature_2m_min))}–${Math.round(Math.max(...daily.temperature_2m_max))}°F`,
        details,
      });
    } catch(e) { results.push({ city, error: e.message }); }
  }

  res.json({ alerts: results.filter(r => r.isPaintingWeather), allCities: results });
});

// ── Neighborhood Proximity Search ──
app.post('/api/neighborhood/find-nearby', async (req, res) => {
  const { jobAddress, contacts, radiusMiles } = req.body;
  const radius = radiusMiles || 0.5;

  // Simple geocoding using Open-Meteo's geocoding (free, no key)
  try {
    const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(jobAddress)}&count=1&language=en&format=json`);
    const geoData = await geoRes.json();
    if (!geoData.results?.length) return res.json({ nearby: [], error: 'Could not geocode job address' });

    const jobLat = geoData.results[0].latitude;
    const jobLng = geoData.results[0].longitude;

    // Calculate distance for each contact (Haversine formula)
    const nearby = [];
    for (const contact of contacts) {
      const addr = `${contact.address?.street || ''} ${contact.address?.city || ''} ${contact.address?.state || ''}`.trim();
      if (!addr || addr.length < 5) continue;

      try {
        const cRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(addr)}&count=1&language=en&format=json`);
        const cData = await cRes.json();
        if (!cData.results?.length) continue;

        const cLat = cData.results[0].latitude;
        const cLng = cData.results[0].longitude;
        const dist = haversine(jobLat, jobLng, cLat, cLng);

        if (dist <= radius) {
          nearby.push({ ...contact, distance: Math.round(dist * 100) / 100 });
        }
      } catch(e) { /* skip contacts that can't be geocoded */ }
    }

    nearby.sort((a, b) => a.distance - b.distance);
    res.json({ nearby, jobLat, jobLng, radius });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

function haversine(lat1, lon1, lat2, lon2) {
  const R = 3959; // miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Photo Analysis (Claude Vision) ──
app.post('/api/photos/analyze', async (req, res) => {
  try {
    const ai = await getClaude();
    if (!ai) return res.status(500).json({ error: 'Claude API not configured' });
    const { imageUrl } = req.body;

    const msg = await ai.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'url', url: imageUrl } },
        { type: 'text', text: `Analyze this house photo for a painting estimate. Return JSON:\n{\n  "condition": "Description of paint condition",\n  "issues": ["issue1", "issue2"],\n  "scopeEstimate": "Estimated scope description",\n  "estimatedDays": "3-4 days",\n  "talkingPoints": ["point1", "point2"],\n  "surfaces": ["siding", "trim", "shutters"]\n}\nONLY JSON.` }
      ]}],
    });
    const text = msg.content[0].text;
    res.json(JSON.parse(text.replace(/```json?\n?/g, '').replace(/```/g, '').trim()));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Voice Profile ──
app.post('/api/voice/analyze', async (req, res) => {
  try {
    const ai = await getClaude();
    if (!ai) return res.status(500).json({ error: 'Claude API not configured' });
    const { edits } = req.body;

    const msg = await ai.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: 'Analyze edit patterns between AI-generated messages and human-edited final versions. Extract the human\'s writing preferences.',
      messages: [{ role: 'user', content: `Analyze these ${edits.length} edit pairs (AI original → human edited):\n\n${JSON.stringify(edits.slice(-30))}\n\nReturn JSON:\n{\n  "preferredGreetings": ["Hey", "Hi"],\n  "wordsToAvoid": ["valued", "esteemed"],\n  "wordsPreferred": ["swing by", "take a look"],\n  "toneDescriptors": ["casual", "direct"],\n  "avgSentenceLength": "short",\n  "signOffStyle": "informal",\n  "exampleMessages": ["Best 3 approved messages verbatim"],\n  "summary": "One paragraph describing this person's writing voice"\n}\nONLY JSON.` }],
    });
    const text = msg.content[0].text;
    res.json(JSON.parse(text.replace(/```json?\n?/g, '').replace(/```/g, '').trim()));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Auto Audience Segments ──
app.post('/api/audience/generate-segments', (req, res) => {
  const { contacts } = req.body;
  const now = new Date();
  const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
  const ninetyDaysAgo = new Date(now - 90 * 24 * 60 * 60 * 1000);

  const segments = {
    'All Contacts': contacts,
    'Recent Openers (30 days)': contacts.filter(c => c.engagement?.lastOpenDate && new Date(c.engagement.lastOpenDate) > thirtyDaysAgo),
    'High Intent (clicked 30 days)': contacts.filter(c => c.engagement?.lastClickDate && new Date(c.engagement.lastClickDate) > thirtyDaysAgo),
    'Cold Contacts (90+ days)': contacts.filter(c => !c.engagement?.lastOpenDate || new Date(c.engagement.lastOpenDate) < ninetyDaysAgo),
    'Won Customers': contacts.filter(c => c.currentStage === 'won' || c.currentStage === 'completed'),
  };

  const result = Object.entries(segments).map(([name, list]) => ({
    name,
    count: list.length,
    contacts: list.map(c => ({ email: c.email, phone: c.phone, firstName: c.firstName, lastName: c.lastName, address: c.address })),
  }));

  res.json(result);
});

// ══════════════════════════════════════════
// PHASE 6: AUTOMATION LAYER
// ══════════════════════════════════════════

// ── Saturday Night Engine: New Lead Webhook ──
// THIS IS THE ONLY AUTO-SEND IN THE SYSTEM
app.post('/api/webhooks/new-lead', async (req, res) => {
  const secret = req.headers['x-webhook-secret'];
  const expectedSecret = getKey('WEBHOOK_SECRET');
  // Verify webhook if secret is configured
  if (expectedSecret && secret !== expectedSecret) {
    return res.status(401).json({ error: 'Invalid webhook secret' });
  }

  const { firstName, lastName, email, phone, address, serviceType, message, source } = req.body;
  if (!firstName && !email && !phone) return res.status(400).json({ error: 'Missing contact data' });

  const autoSendMinutes = parseInt(getKey('SNE_AUTO_SEND_MINUTES')) || 15;
  const autoSendTime = new Date(Date.now() + autoSendMinutes * 60 * 1000).toISOString();

  // Store in Saturday Night Queue
  if (!global._sneQueue) global._sneQueue = [];
  const queueItem = {
    id: 'sne_' + Date.now(),
    firstName: firstName || '',
    lastName: lastName || '',
    email: email || '',
    phone: phone || '',
    address: address || '',
    serviceType: serviceType || '',
    message: message || '',
    source: source || 'website_form',
    receivedAt: new Date().toISOString(),
    autoSendTime,
    autoSendMinutes,
    status: 'pending',
    aiResponse: null,
  };

  // Generate AI response immediately
  try {
    const ai = await getClaude();
    if (ai) {
      const msg = await ai.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 512,
        system: 'You are Amir from Northern Star Painters. Write a text message response to a website inquiry. Be personal, reference their specific needs, suggest a quick estimate visit. Under 300 characters.',
        messages: [{ role: 'user', content: `New website inquiry from ${firstName} ${lastName}. Email: ${email}. Phone: ${phone}. Address: ${address}. Service: ${serviceType}. Message: "${message}". Respond as Amir. Return JSON: {"text":"...","email":{"subject":"...","body":"..."}}\nONLY JSON.` }],
      });
      const text = msg.content[0].text;
      queueItem.aiResponse = JSON.parse(text.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
    }
  } catch(e) { console.error('SNE AI error:', e.message); }

  global._sneQueue.push(queueItem);

  // Set auto-send timer — THIS IS THE ONLY AUTO-SEND IN THE SYSTEM
  if (autoSendMinutes > 0 && queueItem.aiResponse) {
    setTimeout(async () => {
      const item = global._sneQueue.find(i => i.id === queueItem.id);
      if (item && item.status === 'pending') {
        // Auto-send text if phone available, otherwise email
        try {
          if (item.phone) {
            await fetch(`http://localhost:${PORT}/api/send/sms`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ to: item.phone, text: item.aiResponse.text, sender: 'NSPainters' }),
            });
          } else if (item.email) {
            await fetch(`http://localhost:${PORT}/api/send/brevo`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ fromEmail: 'amirz@northernstarpainters.com', fromName: 'Amir Zreik', toEmail: item.email, toName: item.firstName, subject: item.aiResponse.email?.subject || 'Northern Star Painters', htmlContent: `<p>${item.aiResponse.email?.body || item.aiResponse.text}</p>`, textContent: item.aiResponse.text }),
            });
          }
          item.status = 'auto_sent';
          item.sentAt = new Date().toISOString();
          console.log('SNE auto-sent to', item.firstName, item.lastName);
        } catch(e) { console.error('SNE auto-send error:', e.message); item.status = 'error'; }
      }
    }, autoSendMinutes * 60 * 1000);
  }

  res.json({ ok: true, queueId: queueItem.id, autoSendTime });
});

// ── Saturday Night Engine Queue ──
app.get('/api/saturday-night/queue', (req, res) => {
  res.json(global._sneQueue || []);
});

app.post('/api/saturday-night/send/:id', async (req, res) => {
  const item = (global._sneQueue || []).find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  if (!item.aiResponse) return res.status(400).json({ error: 'No AI response generated' });

  try {
    if (item.phone) {
      await fetch(`http://localhost:${PORT}/api/send/sms`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: item.phone, text: item.aiResponse.text, sender: 'NSPainters' }),
      });
    } else if (item.email) {
      await fetch(`http://localhost:${PORT}/api/send/brevo`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromEmail: 'amirz@northernstarpainters.com', fromName: 'Amir Zreik', toEmail: item.email, toName: item.firstName, subject: item.aiResponse.email?.subject || 'Re: Your Painting Inquiry', htmlContent: `<p>${item.aiResponse.email?.body || item.aiResponse.text}</p>`, textContent: item.aiResponse.text }),
      });
    }
    item.status = 'manual_sent';
    item.sentAt = new Date().toISOString();
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/saturday-night/dismiss/:id', (req, res) => {
  const item = (global._sneQueue || []).find(i => i.id === req.params.id);
  if (item) item.status = 'dismissed';
  res.json({ ok: true });
});

// ── System Health ──
app.get('/api/system-health', (req, res) => {
  res.json(global._systemHealth || {
    stormScore: { lastRun: null, status: 'idle', updated: 0 },
    fairfaxDeeds: { lastRun: null, status: 'idle', leadsFound: 0 },
    arlingtonDeeds: { lastRun: null, status: 'idle', leadsFound: 0 },
    loudounDeeds: { lastRun: null, status: 'idle', leadsFound: 0 },
    alexandriaDeeds: { lastRun: null, status: 'idle', leadsFound: 0 },
    mdSdat: { lastRun: null, status: 'idle', leadsFound: 0 },
    permits: { lastRun: null, status: 'idle', leadsFound: 0 },
    skipTrace: { lastRun: null, status: 'idle', processed: 0, matched: 0 },
    streetView: { lastRun: null, status: 'idle', analyzed: 0 },
    outreach: { lastRun: null, status: 'idle', generated: 0 },
    overallStatus: 'operational',
    lastLeadTime: null,
  });
});

// ── Manual Cron Trigger ──
app.post('/api/cron/run/:jobName', (req, res) => {
  const { jobName } = req.params;
  if (!global._systemHealth) global._systemHealth = {};
  global._systemHealth[jobName] = { status: 'running', startedAt: new Date().toISOString() };
  res.json({ status: 'started', job: jobName });
});

// ── Notifications ──
if (!global._notifications) global._notifications = [];

app.get('/api/notifications', (req, res) => {
  res.json(global._notifications.slice(-50));
});

app.post('/api/notifications', (req, res) => {
  const { type, title, body, actionUrl } = req.body;
  global._notifications.push({ id: 'n_' + Date.now(), type, title, body, actionUrl, read: false, timestamp: new Date().toISOString() });
  if (global._notifications.length > 200) global._notifications = global._notifications.slice(-200);
  res.json({ ok: true });
});

app.post('/api/notifications/:id/read', (req, res) => {
  const n = global._notifications.find(n => n.id === req.params.id);
  if (n) n.read = true;
  res.json({ ok: true });
});

// ── Daily Digest ──
app.post('/api/digest/send', async (req, res) => {
  const digestEmail = getKey('DAILY_DIGEST_EMAIL') || 'amirz@northernstarpainters.com';
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const sneQueue = (global._sneQueue || []).filter(i => i.status === 'pending').length;
  const health = global._systemHealth || {};

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">
      <div style="background:#1e3a8a;color:white;padding:20px;text-align:center;">
        <h1 style="margin:0;font-size:20px;">⭐ Northern Star Intelligence</h1>
        <p style="margin:5px 0 0;opacity:0.8;font-size:14px;">${today}</p>
      </div>
      <div style="padding:20px;">
        <h2 style="color:#1e3a8a;font-size:16px;">Today at a Glance</h2>
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="padding:10px;text-align:center;background:#f0f5ff;border-radius:8px;"><strong style="font-size:24px;color:#1e3a8a;">${health.fairfaxDeeds?.leadsFound || 0}</strong><br><span style="font-size:12px;color:#666;">New Leads</span></td>
            <td style="width:10px;"></td>
            <td style="padding:10px;text-align:center;background:#f0fdf4;border-radius:8px;"><strong style="font-size:24px;color:#16a34a;">${sneQueue}</strong><br><span style="font-size:12px;color:#666;">Pending Queue</span></td>
          </tr>
        </table>
        <h2 style="color:#1e3a8a;font-size:16px;margin-top:20px;">System Health</h2>
        <p style="font-size:14px;color:#666;">All systems: ${health.overallStatus || 'operational'}</p>
        <div style="text-align:center;margin-top:20px;">
          <a href="https://nsp-email-tool-production.up.railway.app" style="background:#1e3a8a;color:white;padding:12px 24px;text-decoration:none;border-radius:8px;font-size:14px;">Open Dashboard →</a>
        </div>
      </div>
    </div>`;

  try {
    await fetch(`http://localhost:${PORT}/api/send/brevo`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromEmail: 'amirz@northernstarpainters.com', fromName: 'NSP Intelligence', toEmail: digestEmail, toName: 'Amir', subject: `⭐ NSP Daily Update — ${today}`, htmlContent: html, textContent: 'Daily update from Northern Star Intelligence System' }),
    });
    res.json({ ok: true, sentTo: digestEmail });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Voicemail Drop (Slybroadcast placeholder) ──
app.post('/api/voicemail/drop/:contactId', async (req, res) => {
  const { templateId } = req.body;
  const username = getKey('SLYBROADCAST_USERNAME');
  const password = getKey('SLYBROADCAST_PASSWORD');
  const callerId = getKey('SLYBROADCAST_CALLER_ID');

  if (!username || !password) {
    return res.json({ status: 'not_configured', message: 'Slybroadcast not configured. Add SLYBROADCAST_USERNAME and SLYBROADCAST_PASSWORD.' });
  }

  // Slybroadcast API integration placeholder
  res.json({ status: 'ready', message: 'Slybroadcast configured — voicemail drop ready when template recordings are uploaded.' });
});

app.get('/api/voicemail/templates', (req, res) => {
  res.json([
    { id: 'new_home', name: 'New Home Buyer', description: 'For recently moved homeowners' },
    { id: 'estimate_followup', name: 'Estimate Follow-Up', description: 'After sending an estimate' },
    { id: 'reengagement', name: 'Re-engagement', description: 'Haven\'t heard from them in a while' },
    { id: 'post_storm', name: 'Post-Storm Check', description: 'After severe weather' },
    { id: 'general', name: 'General Outreach', description: 'General purpose' },
  ]);
});

// ── Google Ads Customer Match (placeholder) ──
app.post('/api/ads/sync/google', async (req, res) => {
  const clientId = getKey('GOOGLE_ADS_CLIENT_ID');
  if (!clientId) return res.json({ status: 'not_configured', message: 'Google Ads not connected. See Settings → Ad Platform Connections.' });
  // OAuth flow + Customer Match API would go here
  res.json({ status: 'ready', message: 'Google Ads configured — connect account in Settings to activate sync.' });
});

// ── Meta Ads Custom Audiences (placeholder) ──
app.post('/api/ads/sync/meta', async (req, res) => {
  const appId = getKey('META_APP_ID');
  if (!appId) return res.json({ status: 'not_configured', message: 'Meta Ads not connected. See Settings → Ad Platform Connections.' });
  res.json({ status: 'ready', message: 'Meta Ads configured — connect account in Settings to activate sync.' });
});

app.get('/api/ads/sync/status', (req, res) => {
  res.json({
    google: { connected: !!getKey('GOOGLE_ADS_CLIENT_ID'), lastSync: null, status: getKey('GOOGLE_ADS_CLIENT_ID') ? 'ready' : 'not_connected' },
    meta: { connected: !!getKey('META_APP_ID'), lastSync: null, status: getKey('META_APP_ID') ? 'ready' : 'not_connected' },
  });
});

// ══════════════════════════════════════════
// PHASE 5: LEAD INTELLIGENCE ENGINE
// ══════════════════════════════════════════

// ── Perfect Storm Score Calculator ──
function calculateStormScore(lead, nearbyJobs = [], weatherData = null) {
  let score = 0;
  const breakdown = {};

  // TIME SIGNALS (max 30)
  if (lead.propertyAnalysis?.estimatedLastPainted) {
    const paintYear = parseInt(lead.propertyAnalysis.estimatedLastPainted);
    const years = new Date().getFullYear() - paintYear;
    if (years >= 7) { score += 30; breakdown['Paint 7+ years'] = 30; }
    else if (years >= 5) { score += 25; breakdown['Paint 5-6 years'] = 25; }
    else if (years >= 4) { score += 15; breakdown['Paint 4 years'] = 15; }
    else if (years >= 3) { score += 8; breakdown['Paint 3 years'] = 8; }
  } else if (lead.yearBuilt && lead.yearBuilt < 2016) {
    score += 20; breakdown['Property pre-2016'] = 20;
  }
  const month = new Date().getMonth() + 1;
  if (month >= 3 && month <= 5) { score += 5; breakdown['Spring season'] = 5; }
  else if (month >= 9 && month <= 10) { score += 3; breakdown['Fall window'] = 3; }
  else if (month >= 6 && month <= 8) { score += 2; breakdown['Summer'] = 2; }

  // PROPERTY SIGNALS (max 25)
  if (lead.source === 'deed_record') { score += 20; breakdown['New home sale'] = 20; }
  if (lead.source === 'permit') { score += 15; breakdown['Permit filed'] = 15; }
  if (lead.propertyAnalysis?.paintCondition === 'poor' || lead.propertyAnalysis?.paintCondition === 'critical') {
    score += 15; breakdown['Poor paint condition'] = 15;
  } else if (lead.propertyAnalysis?.paintCondition === 'fair') {
    score += 8; breakdown['Fair paint condition'] = 8;
  }
  if (lead.yearBuilt && lead.yearBuilt < 2010) { score += 5; breakdown['Built before 2010'] = 5; }

  // NEIGHBORHOOD SIGNALS (max 20)
  const closest = nearbyJobs.sort((a, b) => a.distance - b.distance)[0];
  if (closest) {
    if (closest.distance <= 0.25) { score += 20; breakdown['NSP job within 0.25mi'] = 20; }
    else if (closest.distance <= 0.5) { score += 12; breakdown['NSP job within 0.5mi'] = 12; }
    else if (closest.distance <= 1) { score += 6; breakdown['NSP job within 1mi'] = 6; }
  }

  // ENGAGEMENT SIGNALS (max 15 — existing contacts)
  if (lead.engagement?.totalClicks > 0) { score += 15; breakdown['Clicked links'] = 15; }
  else if (lead.engagement?.totalOpens > 0) { score += 10; breakdown['Opened emails'] = 10; }
  if (lead.engagement?.engagementTrend === 'rising') { score += 8; breakdown['Rising engagement'] = 8; }

  // WEATHER SIGNAL (max 10)
  if (weatherData?.isPaintingWeather) { score += 10; breakdown['Perfect weather'] = 10; }

  // Cap at 100
  score = Math.min(100, score);
  return { score, breakdown };
}

// ── Lead CRUD endpoints ──
app.get('/api/leads', (req, res) => {
  // Frontend reads from Firestore directly — this endpoint for external use
  res.json({ message: 'Use Firestore directly from frontend for lead queries' });
});

app.post('/api/leads/calculate-score', (req, res) => {
  const { lead, nearbyJobs, weatherData } = req.body;
  const result = calculateStormScore(lead, nearbyJobs, weatherData);
  res.json(result);
});

// ── Shadow Estimate Generator ──
app.post('/api/shadow-estimate', async (req, res) => {
  try {
    const ai = await getClaude();
    if (!ai) return res.status(500).json({ error: 'Claude API not configured' });
    const { lead, competitiveData } = req.body;

    const analysis = lead.propertyAnalysis || {};
    const msg = await ai.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: 'You are a painting estimate preparation assistant. Generate a pre-visit briefing for a painting company owner.',
      messages: [{ role: 'user', content: `Generate a Shadow Estimate brief for this property:

Address: ${lead.address?.street}, ${lead.address?.city} ${lead.address?.state} ${lead.address?.zip}
Sale Price: $${lead.salePrice || 'unknown'}
Year Built: ${lead.yearBuilt || 'unknown'}
Property Type: ${lead.propertyType || 'unknown'}
Square Footage: ${lead.squareFootage || 'unknown'}

AI Property Assessment:
Condition: ${analysis.paintCondition || 'unknown'}
Last Painted: ${analysis.estimatedLastPainted || 'unknown'}
Surface: ${analysis.primarySurface || 'unknown'}
Issues: ${(analysis.visibleIssues || []).join(', ') || 'none detected'}
Scope: ${analysis.estimatedJobScope || 'unknown'}
Price Range: $${analysis.estimatedPriceRange?.low || '?'} - $${analysis.estimatedPriceRange?.high || '?'}

${competitiveData ? 'Competitive context for this area: ' + JSON.stringify(competitiveData) : ''}

Return JSON:
{
  "summary": "2-3 sentence overview",
  "scopeBreakdown": ["surface1: description", "surface2: description"],
  "riskFactors": ["risk1", "risk2"],
  "priceRange": {"low": number, "high": number},
  "confidence": "low|medium|high",
  "talkingPoints": ["point1", "point2", "point3"],
  "competitiveNotes": "any competitive context"
}
ONLY JSON.` }],
    });
    const text = msg.content[0].text;
    res.json(JSON.parse(text.replace(/```json?\n?/g, '').replace(/```/g, '').trim()));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── AI Outreach for Lead ──
app.post('/api/leads/generate-outreach', async (req, res) => {
  try {
    const ai = await getClaude();
    if (!ai) return res.status(500).json({ error: 'Claude API not configured' });
    const { lead, nearbyJobs } = req.body;

    const analysis = lead.propertyAnalysis || {};
    const nearbyText = (nearbyJobs || []).slice(0, 3).map(j => `${j.address} (${j.distance}mi away)`).join(', ');

    const msg = await ai.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: `You are Amir from Northern Star Painters. Write outreach for a new lead. Rules:
- Never claim a relationship that doesn't exist
- Reference something specific about their property or neighborhood
- Never reveal you found them through public records
- Natural, personal tone
- Include soft opt-out: "No pressure — let me know if you'd rather I not reach out"
- For new homeowners: lead with neighborhood social proof`,
      messages: [{ role: 'user', content: `Generate 3 outreach versions for:

Name: ${lead.ownerName}
Address: ${lead.address?.street}, ${lead.address?.city}
Source: ${lead.source === 'deed_record' ? 'Just bought this home' : lead.source === 'permit' ? 'Filed renovation permit' : 'Lead'}
Sale Price: $${lead.salePrice || 'unknown'}
Property Condition: ${analysis.paintCondition || 'unknown'} — ${analysis.aiAssessmentSummary || ''}
Nearby NSP Jobs: ${nearbyText || 'none nearby'}

Return JSON:
{
  "email": {"subject": "...", "body": "... (200 words max)"},
  "text": "... (under 160 chars)",
  "postcard": "... (75 words max for print)"
}
ONLY JSON.` }],
    });
    const text = msg.content[0].text;
    res.json(JSON.parse(text.replace(/```json?\n?/g, '').replace(/```/g, '').trim()));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Skip Trace (BeenVerified placeholder) ──
app.post('/api/skip-trace', async (req, res) => {
  const { name, address } = req.body;
  const apiKey = getKey('BEEN_VERIFIED_API_KEY');
  if (!apiKey) {
    return res.json({ status: 'not_configured', message: 'BeenVerified API key not set. Add BEEN_VERIFIED_API_KEY to environment variables.' });
  }
  // BeenVerified API integration — placeholder until key is configured
  try {
    // Real implementation would call BeenVerified API here
    // For now return placeholder
    res.json({ status: 'pending', message: 'BeenVerified API ready — configure key to activate' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Street View Image Pull ──
app.post('/api/streetview', async (req, res) => {
  const { address, lat, lng } = req.body;
  const apiKey = getKey('GOOGLE_STREET_VIEW_API_KEY');
  if (!apiKey) {
    return res.json({ status: 'not_configured', images: [], message: 'Google Street View API key not set' });
  }
  try {
    const images = [];
    for (const heading of [0, 90, 180, 270]) {
      const url = `https://maps.googleapis.com/maps/api/streetview?size=640x480&location=${lat},${lng}&heading=${heading}&fov=90&key=${apiKey}`;
      images.push({ heading, url });
    }
    res.json({ status: 'ok', images });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Geocode Address ──
app.post('/api/geocode', async (req, res) => {
  const { address } = req.body;
  try {
    // Use free Open-Meteo geocoding first
    const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(address)}&count=1&language=en&format=json`);
    const data = await r.json();
    if (data.results?.length) {
      return res.json({ lat: data.results[0].latitude, lng: data.results[0].longitude, source: 'open-meteo' });
    }
    // Fallback to Google if configured
    const gKey = getKey('GOOGLE_GEOCODING_API_KEY');
    if (gKey) {
      const gr = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${gKey}`);
      const gd = await gr.json();
      if (gd.results?.length) {
        const loc = gd.results[0].geometry.location;
        return res.json({ lat: loc.lat, lng: loc.lng, source: 'google' });
      }
    }
    res.json({ error: 'Could not geocode address' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Scraper Status ──
app.get('/api/scraper/status', (req, res) => {
  res.json(global._scraperStatus || {
    fairfax: { lastRun: null, leadsFound: 0, status: 'idle' },
    arlington: { lastRun: null, leadsFound: 0, status: 'idle' },
    loudoun: { lastRun: null, leadsFound: 0, status: 'idle' },
    permits: { lastRun: null, leadsFound: 0, status: 'idle' },
  });
});

// ── Manual Scraper Trigger ──
app.post('/api/scraper/run/:county', async (req, res) => {
  const { county } = req.params;
  if (!global._scraperStatus) global._scraperStatus = {};
  global._scraperStatus[county] = { status: 'running', startedAt: new Date().toISOString() };
  res.json({ status: 'started', county, message: `${county} scraper started. Check /api/scraper/status for progress. Note: Full Puppeteer scraping requires chromium on Railway — configure in deployment settings.` });
});

// ── Postcard PDF Generation ──
app.post('/api/leads/postcard-pdf', async (req, res) => {
  try {
    const { lead, nearestJobPhoto } = req.body;
    // Generate simple HTML postcard
    const html = `<!DOCTYPE html><html><head><style>
      @page{size:6in 4in;margin:0}
      body{font-family:Arial,sans-serif;margin:0;padding:0}
      .front{width:6in;height:4in;background:#1e3a8a;color:white;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;page-break-after:always}
      .front h1{font-size:24pt;margin:0 0 10px}
      .front p{font-size:12pt;opacity:0.9}
      .back{width:6in;height:4in;padding:0.3in;box-sizing:border-box;font-size:10pt}
      .back h2{color:#1e3a8a;margin:0 0 8px;font-size:14pt}
      .back .message{margin:10px 0;line-height:1.4}
      .back .contact{position:absolute;bottom:0.3in;left:0.3in;right:0.3in;border-top:1px solid #ddd;padding-top:8px;font-size:9pt;color:#666}
    </style></head><body>
    <div class="front">
      <p>⭐ ⭐ ⭐ ⭐ ⭐</p>
      <h1>Northern Star Painters</h1>
      <p>Professional Painting Services</p>
      <p style="margin-top:20px;font-size:14pt">Welcome to ${lead.address?.city || 'the neighborhood'}!</p>
    </div>
    <div class="back">
      <h2>Hi ${lead.ownerName?.split(',')[0]?.split(' ')[0] || 'Neighbor'},</h2>
      <div class="message">${lead.generatedOutreach?.postcard || 'We noticed you recently moved to the neighborhood. Northern Star Painters has been serving ' + (lead.address?.city || 'Northern Virginia') + ' families for years. If your new home needs a fresh look — interior or exterior — we would love to help. Call or scan the QR code below for a free estimate.'}</div>
      <div class="contact">
        <strong>Northern Star Painters</strong> | (202) 743-5072 | northernstarpainters.com<br>
        4600 South Four Mile Run Drive, Arlington, VA 22204
      </div>
    </div></body></html>`;

    res.set({ 'Content-Type': 'text/html' });
    res.send(html);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════
// PHASE 1: SENDING
// ══════════════════════════════════════════

// ── Send via Brevo ──
app.post('/api/send/brevo', async (req, res) => {
  try {
    const { fromEmail, fromName, toEmail, toName, subject, htmlContent, textContent } = req.body;

    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'accept': 'application/json', 'content-type': 'application/json', 'api-key': getKey('BREVO_API_KEY') },
      body: JSON.stringify({
        sender: { name: fromName, email: fromEmail },
        to: [{ email: toEmail, name: toName || '' }],
        subject,
        htmlContent: htmlContent + `<br><br><p style="font-size:11px;color:#999;text-align:center;">Northern Star Painters | 4600 South Four Mile Run Drive, Arlington, VA 22204<br><a href="{{unsubscribe_url}}" style="color:#999;">Unsubscribe</a></p>`,
        textContent,
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Brevo send failed');
    res.json({ success: true, messageId: data.messageId });
  } catch (error) {
    console.error('Brevo send error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── Send via Titan SMTP ──
app.post('/api/send/titan', async (req, res) => {
  // Titan SMTP unreliable from cloud — fallback to Brevo with same sender identity
  try {
    const { fromEmail, fromName, toEmail, toName, subject, htmlContent, textContent } = req.body;
    const footer = `<br><br><p style="font-size:11px;color:#999;text-align:center;">Northern Star Painters | 4600 South Four Mile Run Drive, Arlington, VA 22204</p>`;

    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'accept': 'application/json', 'content-type': 'application/json', 'api-key': getKey('BREVO_API_KEY') },
      body: JSON.stringify({
        sender: { name: fromName, email: fromEmail },
        to: [{ email: toEmail, name: toName || '' }],
        subject,
        htmlContent: htmlContent + footer,
        textContent,
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Send failed');
    res.json({ success: true, messageId: data.messageId });
  } catch (error) {
    console.error('Send error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── Batch send ──
app.post('/api/send/batch', async (req, res) => {
  const { method, fromEmail, fromName, subject, htmlTemplate, textTemplate, contacts } = req.body;
  const results = { sent: 0, failed: 0, errors: [] };

  const footer = `<br><br><p style="font-size:11px;color:#999;text-align:center;">Northern Star Painters | 4600 South Four Mile Run Drive, Arlington, VA 22204<br><a href="#" style="color:#999;">Unsubscribe</a></p>`;

  const batchSize = 50;
  for (let i = 0; i < contacts.length; i += batchSize) {
    const batch = contacts.slice(i, i + batchSize);

    for (const contact of batch) {
      try {
        const html = personalizeTemplate(htmlTemplate, contact) + footer;
        const text = personalizeTemplate(textTemplate, contact);
        const subj = personalizeTemplate(subject, contact);

        // Always use Brevo for reliable delivery — Brevo sends FROM any address
        // Titan SMTP has connectivity issues from cloud servers
        const brevoRes = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: { 'accept': 'application/json', 'content-type': 'application/json', 'api-key': getKey('BREVO_API_KEY') },
          body: JSON.stringify({ sender: { name: fromName, email: fromEmail }, to: [{ email: contact.email, name: contact.firstName || '' }], subject: subj, htmlContent: html, textContent: text }),
        });
        if (!brevoRes.ok) {
          const errData = await brevoRes.json().catch(() => ({}));
          throw new Error(errData.message || 'Brevo failed');
        }

        results.sent++;
      } catch (e) {
        results.failed++;
        results.errors.push({ email: contact.email, error: e.message });
      }
    }

    if (i + batchSize < contacts.length) await new Promise(r => setTimeout(r, 2000));
  }

  res.json(results);
});

function personalizeTemplate(template, contact) {
  if (!template) return '';
  const job = (contact.jobHistory || []).sort((a, b) => new Date(b.jobDate || 0) - new Date(a.jobDate || 0))[0];
  const yearsSince = job?.jobDate ? new Date().getFullYear() - new Date(job.jobDate).getFullYear() : null;
  return template
    .replaceAll('{FirstName}', contact.firstName || 'there')
    .replaceAll('{LastName}', contact.lastName || '')
    .replaceAll('{Address}', contact.address?.street || 'your home')
    .replaceAll('{City}', contact.address?.city || 'your area')
    .replaceAll('{JobYear}', job?.jobDate ? new Date(job.jobDate).getFullYear().toString() : 'a few years ago')
    .replaceAll('{JobType}', job?.jobType || 'painting')
    .replaceAll('{YearsSince}', yearsSince ? yearsSince.toString() : 'a few');
}

// ══════════════════════════════════════════
// PHASE 7: STRATEGY HUB + DESIGN HUB + UNIFIED FLOW
// ══════════════════════════════════════════

// ── Firebase Admin for server-side Firestore ──
let adminDb = null;
async function getAdminDb() {
  if (adminDb) return adminDb;
  try {
    const { initializeApp, cert, getApps } = await import('firebase-admin/app');
    const { getFirestore } = await import('firebase-admin/firestore');
    if (getApps().length === 0) {
      const serviceAccountPath = path.resolve(__dirname, 'service-account.json');
      if (existsSync(serviceAccountPath)) {
        const sa = JSON.parse(readFileSync(serviceAccountPath, 'utf-8'));
        initializeApp({ credential: cert(sa) });
      } else {
        // Fallback: use project ID directly (works on Railway with GOOGLE_APPLICATION_CREDENTIALS)
        initializeApp({ projectId: 'northern-star-painters' });
      }
    }
    adminDb = getFirestore();
    return adminDb;
  } catch (e) {
    console.error('Firebase Admin init error:', e.message);
    return null;
  }
}

// ── Strategy context cache ──
let _strategyContextCache = null;
let _strategyContextCacheTime = 0;
let _strategyContextCacheDate = null; // track which day was cached
const STRATEGY_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// ── Tracking settings cache ──
let _trackingSettingsCache = null;
let _trackingSettingsCacheTime = 0;
const TRACKING_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getTrackingSettings() {
  if (_trackingSettingsCache && Date.now() - _trackingSettingsCacheTime < TRACKING_CACHE_TTL) {
    return _trackingSettingsCache;
  }
  try {
    const db = await getAdminDb();
    if (!db) return { uniqueLinksEnabled: true, openPixelEnabled: true, websiteTrackingEnabled: false, googleAnalyticsId: '', websiteScriptInstalled: false };
    const doc = await db.collection('trackingSettings').doc('global').get();
    _trackingSettingsCache = doc.exists ? doc.data() : { uniqueLinksEnabled: true, openPixelEnabled: true, websiteTrackingEnabled: false, googleAnalyticsId: '', websiteScriptInstalled: false };
    _trackingSettingsCacheTime = Date.now();
    return _trackingSettingsCache;
  } catch (e) {
    return { uniqueLinksEnabled: true, openPixelEnabled: true, websiteTrackingEnabled: false, googleAnalyticsId: '', websiteScriptInstalled: false };
  }
}

// ── TRACKING & ANALYTICS ENDPOINTS ──

// Get global tracking settings
app.get('/api/tracking/settings', async (req, res) => {
  const settings = await getTrackingSettings();
  res.json(settings);
});

// Update global tracking settings
app.put('/api/tracking/settings', async (req, res) => {
  try {
    const db = await getAdminDb();
    const settings = {
      uniqueLinksEnabled: req.body.uniqueLinksEnabled ?? true,
      openPixelEnabled: req.body.openPixelEnabled ?? true,
      websiteTrackingEnabled: req.body.websiteTrackingEnabled ?? false,
      googleAnalyticsId: req.body.googleAnalyticsId || '',
      websiteScriptInstalled: req.body.websiteScriptInstalled ?? false,
      updatedAt: new Date().toISOString(),
    };
    if (db) {
      await db.collection('trackingSettings').doc('global').set(settings, { merge: true });
    }
    _trackingSettingsCache = settings;
    _trackingSettingsCacheTime = Date.now();
    res.json({ ok: true, settings });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Enhanced link redirect — logs click, appends params for website tracking
app.get('/r', async (req, res) => {
  const { c: contactId, l: campaignId, u: encodedUrl } = req.query;
  let url = 'https://northernstarpainters.com';
  try { url = Buffer.from(encodedUrl || '', 'base64').toString('utf-8') || url; } catch (e) {}

  // Append uid/cid to destination URL for website tracking script
  try {
    const destUrl = new URL(url);
    if (contactId) destUrl.searchParams.set('uid', contactId);
    if (campaignId) destUrl.searchParams.set('cid', campaignId);
    url = destUrl.toString();
  } catch (e) { /* not a valid URL, redirect as-is */ }

  // Redirect immediately
  res.redirect(url);

  // Log asynchronously — don't block redirect
  try {
    const db = await getAdminDb();
    if (db && contactId) {
      db.collection('trackingEvents').add({
        type: 'click', contactId, campaignId: campaignId || '', url, timestamp: new Date().toISOString(),
      });
      const contactRef = db.collection('emailContacts').doc(contactId);
      const contactDoc = await contactRef.get();
      if (contactDoc.exists) {
        const engagement = contactDoc.data().engagement || {};
        contactRef.update({
          'engagement.totalClicks': (engagement.totalClicks || 0) + 1,
          'engagement.lastClickDate': new Date().toISOString(),
          'engagement.engagementScore': Math.min(100, (engagement.engagementScore || 0) + 15),
          'engagement.engagementTrend': 'rising',
        });
      }
    }
  } catch (e) { console.error('Click tracking error:', e.message); }
});

// ── Unsubscribe endpoint ──
app.get('/api/unsubscribe', async (req, res) => {
  const { c: contactId } = req.query;
  if (!contactId) return res.send('<html><body><h2>Invalid unsubscribe link.</h2></body></html>');
  try {
    const db = await getAdminDb();
    if (db) {
      const contactRef = db.collection('emailContacts').doc(contactId);
      const contactDoc = await contactRef.get();
      if (contactDoc.exists) {
        await contactRef.update({ unsubscribed: true, unsubscribedAt: new Date().toISOString() });
        // Also add to unsubscribes collection
        const data = contactDoc.data();
        await db.collection('emailUnsubscribes').add({
          userId: data.userId, email: data.email, unsubscribedDate: new Date().toISOString(), reason: 'self_unsubscribe',
        });
      }
    }
  } catch (e) { console.error('Unsubscribe error:', e.message); }
  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:Arial,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f7f7f7;}
.card{background:white;border-radius:16px;padding:40px;text-align:center;max-width:400px;box-shadow:0 2px 8px rgba(0,0,0,0.1);}
h2{color:#1a1a1a;margin:0 0 12px;}p{color:#666;font-size:14px;}</style></head>
<body><div class="card"><h2>You've been unsubscribed</h2><p>You will no longer receive marketing emails from Northern Star Painters.</p>
<p style="margin-top:20px;font-size:12px;color:#999;">If this was a mistake, contact us at (202) 743-5072.</p></div></body></html>`);
});

// Enhanced open tracking pixel — logs to Firestore
app.get('/api/track/open-p7', async (req, res) => {
  const { c: contactId, l: campaignId } = req.query;
  // Return pixel immediately
  const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  res.set({ 'Content-Type': 'image/gif', 'Cache-Control': 'no-cache, no-store', 'Content-Length': pixel.length });
  res.end(pixel);

  // Log asynchronously
  try {
    const db = await getAdminDb();
    if (db && contactId) {
      db.collection('trackingEvents').add({
        type: 'open',
        contactId,
        campaignId: campaignId || '',
        timestamp: new Date().toISOString(),
      });
      const contactRef = db.collection('emailContacts').doc(contactId);
      const contactDoc = await contactRef.get();
      if (contactDoc.exists) {
        const engagement = contactDoc.data().engagement || {};
        contactRef.update({
          'engagement.totalOpens': (engagement.totalOpens || 0) + 1,
          'engagement.lastOpenDate': new Date().toISOString(),
          'engagement.engagementScore': Math.min(100, (engagement.engagementScore || 0) + 5),
        });
      }
    }
  } catch (e) { console.error('Open tracking error:', e.message); }
});

// Enhanced pageview tracking
app.post('/api/track/pageview-p7', async (req, res) => {
  res.status(204).end();
  try {
    const { contactId, campaignId, page, timestamp } = req.body;
    const db = await getAdminDb();
    if (db && contactId) {
      db.collection('trackingEvents').add({
        type: 'pageview',
        contactId,
        campaignId: campaignId || '',
        page: page || '/',
        timestamp: timestamp || new Date().toISOString(),
      });
    }
  } catch (e) { console.error('Pageview tracking error:', e.message); }
});

// ── STRATEGY HUB ENDPOINTS ──

// Assemble strategy context from all data sources
async function getStrategyContext(userId) {
  const todayKey = new Date().toISOString().split('T')[0];
  if (_strategyContextCache && Date.now() - _strategyContextCacheTime < STRATEGY_CACHE_TTL && _strategyContextCacheDate === todayKey) {
    return _strategyContextCache;
  }

  const db = await getAdminDb();
  if (!db) return { error: 'Database not available' };

  try {
    // Parallel fetch all data
    const [campaignsSnap, listsSnap, contactsSnap, objectivesSnap, leadsSnap] = await Promise.all([
      db.collection('emailCampaigns').where('userId', '==', userId).orderBy('createdAt', 'desc').limit(10).get(),
      db.collection('emailLists').where('userId', '==', userId).get(),
      db.collection('emailContacts').where('userId', '==', userId).get(),
      db.collection('objectives').where('userId', '==', userId).get(),
      db.collection('leads').where('userId', '==', userId).orderBy('detectedDate', 'desc').limit(20).get(),
    ]);

    // Process campaigns
    const campaigns = campaignsSnap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        name: data.name,
        listId: data.listId,
        fromName: data.fromName,
        sentAt: data.sentAt,
        audienceCount: data.audienceCount,
        stats: data.stats || {},
        openRate: data.stats?.sent ? Math.round((data.stats.opened || 0) / data.stats.sent * 100) : 0,
        clickRate: data.stats?.sent ? Math.round((data.stats.clicked || 0) / data.stats.sent * 100) : 0,
      };
    });

    // Process lists
    const lists = listsSnap.docs.map(d => {
      const data = d.data();
      return { id: d.id, name: data.name, tier: data.tier, contactCount: data.contactCount || 0, lastContacted: null };
    });

    // Calculate last contacted per list from campaigns
    for (const list of lists) {
      const listCampaigns = campaigns.filter(c => c.listId === list.id);
      if (listCampaigns.length) {
        list.lastContacted = listCampaigns[0].sentAt;
        list.daysSinceContact = list.lastContacted ? Math.floor((Date.now() - new Date(list.lastContacted).getTime()) / (1000 * 60 * 60 * 24)) : null;
      }
    }

    // Process contacts
    const contacts = contactsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const currentYear = new Date().getFullYear();

    // Contacts in repaint window by city
    const repaintWindow = {};
    contacts.forEach(c => {
      const city = c.address?.city || 'Unknown';
      const recentJob = (c.jobHistory || []).sort((a, b) => new Date(b.jobDate || 0) - new Date(a.jobDate || 0))[0];
      if (recentJob?.jobDate) {
        const years = currentYear - new Date(recentJob.jobDate).getFullYear();
        if (years >= 4 && years <= 8) {
          if (!repaintWindow[city]) repaintWindow[city] = 0;
          repaintWindow[city]++;
        }
      }
    });

    // City breakdown
    const contactsByCity = {};
    contacts.forEach(c => {
      const city = c.address?.city || 'Unknown';
      contactsByCity[city] = (contactsByCity[city] || 0) + 1;
    });

    // Tier breakdown
    const tierBreakdown = { personal: 0, general: 0, realtime: 0 };
    contacts.forEach(c => {
      const tiers = (c.lists || []).map(l => l.tier);
      if (tiers.includes('personal')) tierBreakdown.personal++;
      else if (tiers.includes('realtime')) tierBreakdown.realtime++;
      else tierBreakdown.general++;
    });

    // Objectives
    const objectives = objectivesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Weather for top 5 cities
    const topCities = Object.entries(contactsByCity).sort((a, b) => b[1] - a[1]).slice(0, 5).map(e => e[0]);
    let weatherData = [];
    try {
      const coords = {
        'Vienna': { lat: 38.9012, lng: -77.2653 }, 'Arlington': { lat: 38.8816, lng: -77.0910 },
        'McLean': { lat: 38.9339, lng: -77.1773 }, 'Falls Church': { lat: 38.8829, lng: -77.1711 },
        'Fairfax': { lat: 38.8462, lng: -77.3064 }, 'Alexandria': { lat: 38.8048, lng: -77.0469 },
        'Reston': { lat: 38.9587, lng: -77.3570 }, 'Herndon': { lat: 38.9696, lng: -77.3861 },
        'Oakton': { lat: 38.8810, lng: -77.3014 }, 'Great Falls': { lat: 38.9985, lng: -77.2883 },
        'Ashburn': { lat: 39.0437, lng: -77.4875 }, 'Springfield': { lat: 38.7893, lng: -77.1872 },
        'Chantilly': { lat: 38.8943, lng: -77.4311 }, 'Leesburg': { lat: 39.1157, lng: -77.5636 },
        'Sterling': { lat: 39.0062, lng: -77.4286 }, 'Manassas': { lat: 38.7509, lng: -77.4753 },
      };
      for (const city of topCities) {
        const c = coords[city];
        if (!c) continue;
        try {
          const url = `https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lng}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max&temperature_unit=fahrenheit&timezone=America/New_York&forecast_days=7`;
          const r = await fetch(url);
          const data = await r.json();
          if (data.daily) {
            let consecutive = 0, maxCon = 0;
            for (let i = 0; i < data.daily.time.length; i++) {
              const ok = data.daily.temperature_2m_max[i] >= 50 && data.daily.temperature_2m_max[i] <= 90 && data.daily.precipitation_sum[i] === 0 && data.daily.wind_speed_10m_max[i] < 20;
              if (ok) { consecutive++; maxCon = Math.max(maxCon, consecutive); } else consecutive = 0;
            }
            weatherData.push({
              city,
              perfectDays: maxCon,
              isPaintingWeather: maxCon >= 3,
              tempRange: `${Math.round(Math.min(...data.daily.temperature_2m_min))}-${Math.round(Math.max(...data.daily.temperature_2m_max))}°F`,
              startDate: maxCon >= 3 ? data.daily.time[data.daily.precipitation_sum.findIndex((p, i) => p === 0 && data.daily.temperature_2m_max[i] >= 50)] : null,
            });
          }
        } catch (e) { /* skip city */ }
      }
    } catch (e) { /* weather fetch failed */ }

    // Top storm score leads
    const stormLeads = leadsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(l => l.stormScore?.score >= 50)
      .sort((a, b) => (b.stormScore?.score || 0) - (a.stormScore?.score || 0))
      .slice(0, 5)
      .map(l => ({ name: l.ownerName, city: l.address?.city, score: l.stormScore?.score, source: l.source }));

    const context = {
      campaigns,
      lists,
      totalContacts: contacts.length,
      contactsByCity,
      tierBreakdown,
      repaintWindow,
      objectives,
      weather: weatherData,
      topStormLeads: stormLeads,
      todayDate: new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
      currentMonth: new Date().getMonth() + 1,
    };

    _strategyContextCache = context;
    _strategyContextCacheTime = Date.now();
    _strategyContextCacheDate = todayKey;
    return context;
  } catch (e) {
    console.error('Strategy context assembly error:', e.message);
    return { error: e.message };
  }
}

// Get strategy context
app.get('/api/strategy/context', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  const context = await getStrategyContext(userId);
  res.json(context);
});

// Strategy Hub chat
app.post('/api/strategy/chat', async (req, res) => {
  try {
    const ai = await getClaude();
    if (!ai) return res.status(500).json({ error: 'Claude API key not configured' });
    const { userId, messages, conversationId } = req.body;

    const context = await getStrategyContext(userId);

    // Build lean context
    const now = new Date();
    const todayStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const currentMonth = now.getMonth() + 1;
    const season = currentMonth >= 3 && currentMonth <= 5 ? 'spring — peak exterior season' :
                   currentMonth >= 6 && currentMonth <= 8 ? 'summer' :
                   currentMonth >= 9 && currentMonth <= 11 ? 'fall' : 'winter — interior season';

    // Compact list summary
    const listLines = (context.lists || []).map(l =>
      `"${l.name}" (${l.tier}) — ${l.contactCount} contacts${l.daysSinceContact != null ? `, last emailed ${l.daysSinceContact}d ago` : ''}`
    ).join('\n');

    const weatherLines = (context.weather || []).filter(w => w.isPaintingWeather).map(w =>
      `${w.city}: ${w.perfectDays} perfect days, ${w.tempRange}`
    ).join(', ') || 'No painting weather windows this week.';

    const repaintTotal = context.repaintWindow ? Object.values(context.repaintWindow).reduce((a, b) => a + b, 0) : 0;

    const systemPrompt = `You are Amir's marketing partner for Northern Star Painters, a painting company in Northern Virginia.

Today: ${todayStr}. Season: ${season}.

Amir's lists:
${listLines || 'No lists yet.'}

Total contacts: ${context.totalContacts || 0} (Personal: ${context.tierBreakdown?.personal || 0}, Cold: ${context.tierBreakdown?.general || 0})
In repaint window (5-7 yrs): ${repaintTotal}
Weather: ${weatherLines}

Help Amir plan campaigns. Be direct, use the data above, suggest subject lines with reasoning. When the plan is agreed, output a campaign brief with: target audience, subject line strategy, content direction, what to include/exclude, tone, and length.

Key rules: Personal lists send from Amir, cold lists from Mary. Don't over-email (14 days personal, 21 days cold). Exterior peaks March-May and Sep-Oct. Interior peaks Oct-Feb.`;

    const msg = await ai.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: (messages || []).slice(-20),
    });

    const aiResponse = msg.content[0].text;

    // Store conversation in Firestore
    try {
      const db = await getAdminDb();
      if (db && conversationId) {
        const convoRef = db.collection('strategyConversations').doc(conversationId);
        const convoDoc = await convoRef.get();
        if (convoDoc.exists) {
          const existingMessages = convoDoc.data().messages || [];
          await convoRef.update({
            messages: [...existingMessages, ...messages.slice(-2), { role: 'assistant', content: aiResponse }],
            updatedAt: new Date().toISOString(),
          });
        } else {
          await convoRef.set({
            userId,
            messages: [...messages, { role: 'assistant', content: aiResponse }],
            status: 'active',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        }
      }
    } catch (e) { console.error('Conversation save error:', e.message); }

    res.json({ response: aiResponse, conversationId });
  } catch (error) {
    console.error('Strategy chat error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Start new conversation
app.post('/api/strategy/new', async (req, res) => {
  const { userId } = req.body;
  const conversationId = 'strat_' + Date.now();
  try {
    const db = await getAdminDb();
    if (db) {
      await db.collection('strategyConversations').doc(conversationId).set({
        userId,
        messages: [],
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  } catch (e) { /* ok — will create on first message */ }
  res.json({ conversationId });
});

// Get conversation history
app.get('/api/strategy/conversation/:id', async (req, res) => {
  try {
    const db = await getAdminDb();
    if (!db) return res.json({ messages: [] });
    const doc = await db.collection('strategyConversations').doc(req.params.id).get();
    res.json(doc.exists ? doc.data() : { messages: [] });
  } catch (e) { res.json({ messages: [] }); }
});

// ── OBJECTIVES ENDPOINTS ──

app.post('/api/objectives', async (req, res) => {
  try {
    const db = await getAdminDb();
    if (!db) return res.status(500).json({ error: 'Database not available' });
    const { userId, description, targetList, targetCount, deadline } = req.body;
    const objective = {
      userId,
      description,
      targetList: targetList || '',
      targetCount: targetCount || 0,
      deadline: deadline || null,
      currentProgress: 0,
      status: 'on_track',
      campaigns: [],
      createdAt: new Date().toISOString(),
    };
    const ref = await db.collection('objectives').add(objective);
    res.json({ id: ref.id, ...objective });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/objectives', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  try {
    const db = await getAdminDb();
    if (!db) return res.json([]);
    const snap = await db.collection('objectives').where('userId', '==', userId).get();
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (e) { res.json([]); }
});

app.put('/api/objectives/:id', async (req, res) => {
  try {
    const db = await getAdminDb();
    if (!db) return res.status(500).json({ error: 'Database not available' });
    await db.collection('objectives').doc(req.params.id).update(req.body);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/objectives/:id/link', async (req, res) => {
  try {
    const db = await getAdminDb();
    if (!db) return res.status(500).json({ error: 'Database not available' });
    const { campaignId } = req.body;
    const docRef = db.collection('objectives').doc(req.params.id);
    const doc = await docRef.get();
    if (!doc.exists) return res.status(404).json({ error: 'Not found' });
    const campaigns = doc.data().campaigns || [];
    await docRef.update({ campaigns: [...campaigns, campaignId] });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/objectives/:id', async (req, res) => {
  try {
    const db = await getAdminDb();
    if (!db) return res.status(500).json({ error: 'Database not available' });
    await db.collection('objectives').doc(req.params.id).delete();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── CAMPAIGN FLOW ENDPOINTS ──

app.post('/api/campaign-flow/start', async (req, res) => {
  const { userId, strategyContext } = req.body;
  const draftId = 'flow_' + Date.now();
  try {
    const db = await getAdminDb();
    const draft = {
      userId,
      currentStep: 1,
      strategyContext: strategyContext || '',
      audienceConfig: {},
      emailDraft: {},
      designConfig: { style: 'personal' },
      trackingConfig: await getTrackingSettings(),
      status: 'draft',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (db) await db.collection('campaignFlowDrafts').doc(draftId).set(draft);
    res.json({ draftId, ...draft });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/campaign-flow/:id', async (req, res) => {
  try {
    const db = await getAdminDb();
    if (!db) return res.status(404).json({ error: 'Not found' });
    const doc = await db.collection('campaignFlowDrafts').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Not found' });
    res.json({ id: doc.id, ...doc.data() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/campaign-flow/:id', async (req, res) => {
  try {
    const db = await getAdminDb();
    if (!db) return res.json({ ok: true });
    await db.collection('campaignFlowDrafts').doc(req.params.id).update({
      ...req.body,
      updatedAt: new Date().toISOString(),
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/campaign-flow/:id/send', async (req, res) => {
  try {
    const db = await getAdminDb();
    if (db) {
      await db.collection('campaignFlowDrafts').doc(req.params.id).update({ status: 'sent', sentAt: new Date().toISOString() });
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── SMART CSV FIELD MAPPING ──

app.post('/api/ai/map-csv-fields', async (req, res) => {
  try {
    const ai = await getClaude();
    if (!ai) return res.status(500).json({ error: 'Claude API key not configured' });
    const { headers, sampleRows } = req.body;

    const msg = await ai.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: `You are a data mapping expert. Given CSV column headers and sample rows, determine which columns map to which contact fields for a painting company's CRM.

TARGET FIELDS (map CSV columns to these):
- email: Email address
- firstName: First name
- lastName: Last name
- phone: Phone number
- street: Street address
- city: City
- state: State
- zip: Zip/postal code
- jobType: Type of painting job (interior, exterior, etc.)
- jobDate: Date of job
- jobValue: Dollar value of job
- salesRep: Sales representative name
- company: Company name (previous employer like CertaPro)
- notes: Any personal notes or comments

RULES:
- A column might be named anything: "First", "fname", "Customer First Name", "FIRST_NAME" all map to firstName
- Full name in one column like "Customer Name" → split to firstName + lastName (set both to same column, frontend handles split)
- Full address in one column → map to street (frontend handles parsing)
- If a column has data like "$4,500" or "4500" → jobValue
- If a column has dates → jobDate
- If a column has "interior"/"exterior"/"painting" type data → jobType
- If unsure, use your best judgment based on sample data
- Not every column needs to map — skip irrelevant ones
- ALWAYS try to find an email column — it's the most important field

Return ONLY valid JSON.`,
      messages: [{
        role: 'user',
        content: `Map these CSV columns to contact fields.

Headers: ${JSON.stringify(headers)}

Sample rows (first 5):
${JSON.stringify(sampleRows.slice(0, 5), null, 2)}

Return JSON:
{
  "mapping": {
    "email": "CSV Column Name or null",
    "firstName": "CSV Column Name or null",
    "lastName": "CSV Column Name or null",
    "phone": "CSV Column Name or null",
    "street": "CSV Column Name or null",
    "city": "CSV Column Name or null",
    "state": "CSV Column Name or null",
    "zip": "CSV Column Name or null",
    "jobType": "CSV Column Name or null",
    "jobDate": "CSV Column Name or null",
    "jobValue": "CSV Column Name or null",
    "salesRep": "CSV Column Name or null",
    "company": "CSV Column Name or null",
    "notes": "CSV Column Name or null"
  },
  "confidence": "high" or "medium" or "low",
  "notes": "Brief explanation of any tricky mappings or columns that couldn't be mapped",
  "unmappedColumns": ["columns that don't map to any field"],
  "suggestedTier": "general" or "personal" or "realtime",
  "tierReason": "Why this tier was suggested based on the data"
}

ONLY return JSON.`
      }],
    });

    const text = msg.content[0].text;
    const json = JSON.parse(text.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
    res.json(json);
  } catch (error) {
    console.error('AI CSV mapping error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── CONTENT CHAT ENDPOINT ──

app.post('/api/content/chat', async (req, res) => {
  try {
    const ai = await getClaude();
    if (!ai) return res.status(500).json({ error: 'Claude API key not configured' });
    const { messages, listName, listTier, contactCount, sampleContact, fromName, fromEmail, goal } = req.body;

    const sampleData = sampleContact ? `
Sample contact from this list:
- Name: ${sampleContact.firstName} ${sampleContact.lastName}
- City: ${sampleContact.address?.city || 'Northern Virginia'}
- Job History: ${(sampleContact.jobHistory || []).map(j => `${j.jobType} in ${j.jobDate ? new Date(j.jobDate).getFullYear() : 'unknown'} ($${j.jobValue || 'unknown'})`).join('; ') || 'None on record'}
- Personal Notes: ${sampleContact.intelligenceProfile?.personalNotes || 'None'}
- Engagement: ${sampleContact.engagement?.engagementTrend || 'new'} (score: ${sampleContact.engagement?.engagementScore || 0})` : '';

    const systemPrompt = `You are the email content creator for Northern Star Painters, working with Amir to craft the perfect campaign email.

CONTEXT:
- List: ${listName || 'Unknown'} (${listTier || 'general'} tier)
- Contacts: ${contactCount || 0}
- Sender: ${fromName} <${fromEmail}>
- Campaign goal: ${goal || 'Not specified yet'}
${sampleData}

YOUR JOB:
1. First message: Ask 2-3 quick follow-up questions about what Amir wants in the email. Be specific: "Should I reference their property address? Mention how long since their last job? Include a specific offer or just reconnect?"
2. After Amir answers: Generate ONE sample email immediately. Show it as a formatted example with Subject and Body clearly labeled.
3. When Amir gives feedback ("more casual", "add the address", "shorter"): Revise and show the updated version inline.
4. When Amir approves: Say "Looks good! Click 'Approve & Generate All' to create unique versions for all ${contactCount} contacts."

RULES:
- Show sample emails formatted clearly with "**Subject:** ..." and "**Body:**" labels
- Use the sample contact data to make the example feel real
- Keep your non-email text to 2-3 sentences max
- When showing an email, make it look like the actual email Amir's contact would receive
- ${listTier === 'personal' ? 'This is a PERSONAL list — write like Amir knows these people. Reference specific job history.' : 'This is a COLD list — never claim a personal relationship.'}
- Never be sycophantic. Just respond to the substance.
- Emails should be under 200 words, casual, personal tone

TONE: Direct, collaborative. Like a copywriter working with Amir in real time.`;

    const msg = await ai.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      messages: (messages || []).slice(-20),
    });

    res.json({ response: msg.content[0].text });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── DESIGN HUB ENDPOINTS ──

app.post('/api/design/chat', async (req, res) => {
  try {
    const ai = await getClaude();
    if (!ai) return res.status(500).json({ error: 'Claude API key not configured' });
    const { messages, listTier, listType, draftBody, draftSubject } = req.body;

    const systemPrompt = `You are an email design consultant for Northern Star Painters.

Current email context:
- List tier: ${listTier || 'unknown'}
- List type: ${listType || 'unknown'}
- Draft subject: ${draftSubject || 'not set'}
- Draft body length: ${(draftBody || '').length} characters

Help Amir make design decisions that maximize inbox placement and response rate.

RULES:
1. Always recommend simplest design for the relationship tier
2. Tier "personal": strongly recommend plain text, no logo, no images — looks like a real email
3. Tier "general" cold: soft branding, small logo, one link only
4. For promotions only: full branding with header image and CTA button
5. Explain WHY behind every recommendation
6. When Amir asks for something that hurts deliverability, say so: "Adding heavy images will route this to Promotions tab — here's a better approach"
7. Offer A/B options when Amir is uncertain
8. Keep responses to 2-4 sentences max — this is a design conversation, not an essay

DESIGN PRINCIPLES:
- Plain text emails have 40% higher open rates than HTML blast emails
- Single-column layouts render correctly on all devices
- One CTA maximum per email
- Images increase spam score — use sparingly
- Subject lines under 40 characters for mobile
- Personal emails land in Primary inbox; branded emails go to Promotions

THREE STYLES:
1. Pure Personal — no logo, no buttons, just text + signature. For personal/Tier 2 lists.
2. Soft Branded — small logo top, clean text, one soft CTA link. For cold/Tier 1 lists.
3. Campaign Style — full branding, header image, CTA button, before/after photos. For promotions only.`;

    const msg = await ai.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 512,
      system: systemPrompt,
      messages: (messages || []).slice(-20),
    });

    res.json({ response: msg.content[0].text });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Generate email HTML preview
app.post('/api/design/preview', async (req, res) => {
  const { style, subject, body, fromName, fromEmail, logoUrl } = req.body;

  let html = '';
  if (style === 'personal') {
    html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:20px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a;background:#fff;">
${body || '<p>Email body here...</p>'}
<br>
<p style="margin:0;font-size:14px;">—</p>
<p style="margin:4px 0;font-size:14px;">${fromName || 'Amir Zreik'}</p>
<p style="margin:0;font-size:13px;color:#666;">Northern Star Painters</p>
<p style="margin:0;font-size:13px;color:#666;">(202) 743-5072</p>
</body></html>`;
  } else if (style === 'soft-branded') {
    html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;background:#f7f7f7;">
<div style="max-width:600px;margin:0 auto;background:#fff;">
  <div style="padding:20px 24px 12px;border-bottom:1px solid #eee;">
    <p style="margin:0;font-size:16px;font-weight:bold;color:#1e3a8a;">⭐ Northern Star Painters</p>
  </div>
  <div style="padding:24px;font-size:14px;line-height:1.6;color:#1a1a1a;">
    ${body || '<p>Email body here...</p>'}
    <br>
    <p style="margin:0;font-size:14px;">${fromName || 'Mary Johnson'}</p>
    <p style="margin:0;font-size:13px;color:#666;">Northern Star Painters</p>
  </div>
  <div style="padding:16px 24px;border-top:1px solid #eee;font-size:11px;color:#999;text-align:center;">
    Northern Star Painters | 4600 South Four Mile Run Drive, Arlington, VA 22204
  </div>
</div>
</body></html>`;
  } else {
    html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;background:#f7f7f7;">
<div style="max-width:600px;margin:0 auto;background:#fff;">
  <div style="background:#1e3a8a;padding:30px 24px;text-align:center;">
    <h1 style="margin:0;font-size:22px;color:#fff;">⭐ Northern Star Painters</h1>
    <p style="margin:8px 0 0;font-size:13px;color:rgba(255,255,255,0.8);">Professional Painting Services</p>
  </div>
  <div style="padding:30px 24px;font-size:14px;line-height:1.6;color:#1a1a1a;">
    ${body || '<p>Email body here...</p>'}
    <div style="text-align:center;margin:24px 0;">
      <a href="#" style="display:inline-block;background:#1e3a8a;color:#fff;padding:14px 32px;text-decoration:none;border-radius:8px;font-weight:bold;font-size:14px;">Get Your Free Estimate</a>
    </div>
  </div>
  <div style="padding:20px 24px;border-top:1px solid #eee;font-size:11px;color:#999;text-align:center;">
    Northern Star Painters | 4600 South Four Mile Run Drive, Arlington, VA 22204<br>
    <a href="#" style="color:#999;">Unsubscribe</a>
  </div>
</div>
</body></html>`;
  }

  res.json({ html, style });
});

// ── LIST INTELLIGENCE ENDPOINTS ──

// Fuzzy match contacts after CSV upload
app.post('/api/contacts/fuzzy-match', async (req, res) => {
  const { newContacts, userId } = req.body;
  if (!newContacts?.length) return res.json({ matches: [], conflicts: [] });

  try {
    const db = await getAdminDb();
    if (!db) return res.json({ matches: [], conflicts: [] });

    const existingSnap = await db.collection('emailContacts').where('userId', '==', userId).get();
    const existing = existingSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    const matches = [];
    const conflicts = [];

    for (const newContact of newContacts) {
      const nc = {
        firstName: (newContact.firstName || '').toLowerCase().trim(),
        lastName: (newContact.lastName || '').toLowerCase().trim(),
        city: (newContact.address?.city || newContact.city || '').toLowerCase().trim(),
        street: (newContact.address?.street || newContact.address || '').toLowerCase().trim(),
        email: (newContact.email || '').toLowerCase().trim(),
      };

      if (!nc.firstName || !nc.lastName) continue;

      for (const ex of existing) {
        const exFirst = (ex.firstName || '').toLowerCase().trim();
        const exLast = (ex.lastName || '').toLowerCase().trim();
        const exCity = (ex.address?.city || '').toLowerCase().trim();
        const exStreet = (ex.address?.street || '').toLowerCase().trim();
        const exEmail = (ex.email || '').toLowerCase().trim();

        // Skip if same email — already handled by normal upsert
        if (nc.email && nc.email === exEmail) continue;

        const nameMatch = nc.firstName === exFirst && nc.lastName === exLast;
        if (!nameMatch) continue;

        const cityMatch = nc.city && exCity && nc.city === exCity;
        const streetMatch = nc.street && exStreet && (nc.street.includes(exStreet) || exStreet.includes(nc.street));

        if (cityMatch || streetMatch) {
          matches.push({
            newContact,
            existingContact: { id: ex.id, firstName: ex.firstName, lastName: ex.lastName, email: ex.email, city: ex.address?.city, street: ex.address?.street },
            matchType: cityMatch ? 'name+city' : 'name+address',
            emailConflict: nc.email && exEmail && nc.email !== exEmail ? { newEmail: nc.email, existingEmail: exEmail } : null,
          });

          // Check for data conflicts
          if (newContact.jobHistory?.length && ex.jobHistory?.length) {
            const newJob = newContact.jobHistory[0];
            const exJob = ex.jobHistory[0];
            if (newJob.jobType && exJob.jobType && newJob.jobType !== exJob.jobType) {
              conflicts.push({
                contactId: ex.id,
                contactName: `${ex.firstName} ${ex.lastName}`,
                field: 'jobType',
                value1: exJob.jobType,
                source1: 'existing',
                value2: newJob.jobType,
                source2: 'new_import',
                resolved: false,
              });
            }
          }
          break; // Found match, move to next new contact
        }
      }
    }

    // Store conflicts in Firestore
    for (const conflict of conflicts) {
      try {
        await db.collection('contactDataConflicts').add({ ...conflict, userId, createdAt: new Date().toISOString() });
      } catch (e) { /* ignore individual conflict save errors */ }
    }

    res.json({ matches, conflicts, totalChecked: newContacts.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get unresolved data conflicts
app.get('/api/contacts/conflicts', async (req, res) => {
  const { userId } = req.query;
  try {
    const db = await getAdminDb();
    if (!db) return res.json([]);
    const snap = await db.collection('contactDataConflicts').where('userId', '==', userId).where('resolved', '==', false).get();
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (e) { res.json([]); }
});

// Fuzzy duplicate detection for a newly imported list
app.post('/api/contacts/fuzzy-match', async (req, res) => {
  try {
    const db = await getAdminDb();
    if (!db) return res.json({ possibleDuplicates: [] });
    const { userId, listId } = req.body;
    const snap = await db.collection('emailContacts').where('userId', '==', userId).get();
    const allContacts = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Get contacts in the new list
    const newListContacts = allContacts.filter(c => c.lists?.some(l => l.listId === listId));
    // Get contacts NOT in the new list (existing)
    const existingContacts = allContacts.filter(c => !c.lists?.some(l => l.listId === listId));

    const possibleDuplicates = [];
    for (const newC of newListContacts) {
      for (const existC of existingContacts) {
        // Skip if same email (already merged by upsert)
        if (newC.email === existC.email) continue;
        // Skip placeholder emails for matching
        if (newC.email?.includes('@placeholder.local') || existC.email?.includes('@placeholder.local')) continue;

        // Check name + city match
        const nameMatch = newC.firstName && existC.firstName &&
          newC.firstName.toLowerCase() === existC.firstName.toLowerCase() &&
          newC.lastName && existC.lastName &&
          newC.lastName.toLowerCase() === existC.lastName.toLowerCase();

        if (!nameMatch) continue;

        const cityMatch = newC.address?.city && existC.address?.city &&
          newC.address.city.toLowerCase() === existC.address.city.toLowerCase();
        const streetMatch = newC.address?.street && existC.address?.street &&
          newC.address.street.toLowerCase().includes(existC.address.street.toLowerCase().substring(0, 10));

        let confidence = 0;
        if (nameMatch) confidence += 0.5;
        if (cityMatch) confidence += 0.3;
        if (streetMatch) confidence += 0.2;

        if (confidence >= 0.6) {
          possibleDuplicates.push({
            existing: { id: existC.id, firstName: existC.firstName, lastName: existC.lastName, email: existC.email, address: existC.address, lists: existC.lists },
            new: { id: newC.id, firstName: newC.firstName, lastName: newC.lastName, email: newC.email, address: newC.address },
            confidence,
          });
        }
      }
    }

    // Auto-merge high-confidence matches (0.8+)
    let autoMerged = 0;
    const remaining = [];
    for (const dupe of possibleDuplicates) {
      if (dupe.confidence >= 0.8) {
        // Auto merge: add new list info to existing, delete new
        try {
          const existRef = db.collection('emailContacts').doc(dupe.existing.id);
          const newRef = db.collection('emailContacts').doc(dupe.new.id);
          const newDoc = await newRef.get();
          if (newDoc.exists) {
            const newData = newDoc.data();
            const existDoc = await existRef.get();
            const existData = existDoc.data();
            const mergedLists = [...(existData.lists || [])];
            for (const l of (newData.lists || [])) {
              if (!mergedLists.some(el => el.listId === l.listId)) mergedLists.push(l);
            }
            const mergedJobs = [...(existData.jobHistory || []), ...(newData.jobHistory || [])];
            await existRef.update({ lists: mergedLists, jobHistory: mergedJobs, updatedAt: new Date().toISOString() });
            await newRef.delete();
            autoMerged++;
          }
        } catch (e) { remaining.push(dupe); }
      } else {
        remaining.push(dupe);
      }
    }

    res.json({ possibleDuplicates: remaining, autoMerged, total: possibleDuplicates.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Merge two contacts manually
app.post('/api/contacts/merge', async (req, res) => {
  try {
    const db = await getAdminDb();
    if (!db) return res.json({ ok: true });
    const { keepId, mergeId } = req.body;
    const keepRef = db.collection('emailContacts').doc(keepId);
    const mergeRef = db.collection('emailContacts').doc(mergeId);
    const [keepDoc, mergeDoc] = await Promise.all([keepRef.get(), mergeRef.get()]);
    if (!keepDoc.exists || !mergeDoc.exists) return res.status(404).json({ error: 'Contact not found' });

    const keep = keepDoc.data();
    const merge = mergeDoc.data();

    // Merge lists
    const lists = [...(keep.lists || [])];
    for (const l of (merge.lists || [])) {
      if (!lists.some(el => el.listId === l.listId)) lists.push(l);
    }

    // Merge job history
    const jobHistory = [...(keep.jobHistory || []), ...(merge.jobHistory || [])];

    // Fill gaps in keep data from merge data
    const updates = { lists, jobHistory, updatedAt: new Date().toISOString() };
    if (!keep.firstName && merge.firstName) updates.firstName = merge.firstName;
    if (!keep.lastName && merge.lastName) updates.lastName = merge.lastName;
    if (!keep.phone && merge.phone) updates.phone = merge.phone;
    if (!keep.address?.street && merge.address?.street) updates.address = merge.address;

    // Promote tier
    const tiers = lists.map(l => l.tier);
    if (tiers.includes('personal')) updates.currentTier = 'personal';
    else if (tiers.includes('realtime')) updates.currentTier = 'realtime';

    await keepRef.update(updates);
    await mergeRef.delete();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Resolve a conflict
app.post('/api/contacts/conflicts/:id/resolve', async (req, res) => {
  try {
    const db = await getAdminDb();
    if (!db) return res.json({ ok: true });
    const { resolution, chosenValue } = req.body;
    await db.collection('contactDataConflicts').doc(req.params.id).update({
      resolved: true,
      resolution: resolution || chosenValue || 'manual',
      resolvedAt: new Date().toISOString(),
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Helper: Apply tracking to email HTML ──
async function applyTracking(html, contactId, campaignId, trackingOverrides = {}) {
  const settings = await getTrackingSettings();
  const uniqueLinks = trackingOverrides.uniqueLinksEnabled ?? settings.uniqueLinksEnabled;
  const openPixel = trackingOverrides.openPixelEnabled ?? settings.openPixelEnabled;
  const baseUrl = 'https://nsp-email-tool-production.up.railway.app';

  let result = html;

  // Wrap ONLY http/https links with tracking redirect (never # or mailto or relative)
  if (uniqueLinks) {
    result = result.replace(/href="(https?:\/\/[^"]+)"/g, (match, url) => {
      // Skip unsubscribe links — they already have the correct URL
      if (url.includes('/api/unsubscribe')) return match;
      const encoded = Buffer.from(url).toString('base64');
      return `href="${baseUrl}/r?c=${contactId}&l=${campaignId}&u=${encoded}"`;
    });
  }

  // Add open tracking pixel
  if (openPixel) {
    const pixelTag = `<img src="${baseUrl}/api/track/open-p7?c=${contactId}&l=${campaignId}" width="1" height="1" border="0" style="display:none;" />`;
    if (result.includes('</body>')) {
      result = result.replace('</body>', pixelTag + '</body>');
    } else {
      result += pixelTag;
    }
  }

  return result;
}

// ── Helper: Wrap email body in design style template ──
async function wrapInStyle(bodyHtml, style, fromName, fromEmail, contactId, senderProfile) {
  const baseUrl = 'https://nsp-email-tool-production.up.railway.app';
  const unsubUrl = `${baseUrl}/api/unsubscribe?c=${contactId}`;

  // Get brand profile (cached for 30 min)
  const brand = (await getBrandProfile()) || BRAND_DEFAULTS;
  const companyName = brand.companyName || BRAND_DEFAULTS.companyName;
  const primaryColor = brand.primaryColor || BRAND_DEFAULTS.primaryColor;
  const address = brand.address || BRAND_DEFAULTS.address;
  const phone = brand.phone || BRAND_DEFAULTS.phone;
  const tagline = brand.tagline || BRAND_DEFAULTS.tagline;
  const logoUrl = brand.logoUrl || '';

  const sig = senderProfile?.signature || (fromName === 'Amir Zreik'
    ? `—\nAmir Zreik\n${companyName}\n${phone}`
    : `—\nMary Johnson\n${companyName}\n${address}\n${phone}`);
  const sigHtml = sig.split('\n').map(l => `<p style="margin:0;font-size:13px;color:#666;">${l}</p>`).join('');

  const logoHtml = logoUrl ? `<img src="${logoUrl}" alt="${companyName}" style="max-width:200px;max-height:60px;margin-bottom:8px;" />` : '';
  const footerHtml = `<div style="padding:16px 24px;border-top:1px solid #eee;font-size:11px;color:#999;text-align:center;">
    ${companyName} | ${address}${phone ? ' | ' + phone : ''}<br>
    <a href="${unsubUrl}" style="color:#999;">Unsubscribe</a>
  </div>`;

  if (style === 'personal') {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:20px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a;background:#fff;">
${bodyHtml}
<br>${sigHtml}
<br><br><p style="font-size:11px;color:#999;text-align:center;">${companyName} | ${address}<br><a href="${unsubUrl}" style="color:#999;">Unsubscribe</a></p>
</body></html>`;
  } else if (style === 'soft-branded') {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;background:#f7f7f7;">
<div style="max-width:600px;margin:0 auto;background:#fff;">
  <div style="padding:20px 24px 12px;border-bottom:1px solid #eee;">
    ${logoHtml}
    <p style="margin:0;font-size:16px;font-weight:bold;color:${primaryColor};">${companyName}</p>
  </div>
  <div style="padding:24px;font-size:14px;line-height:1.6;color:#1a1a1a;">
    ${bodyHtml}
    <br>${sigHtml}
  </div>
  ${footerHtml}
</div></body></html>`;
  } else {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;background:#f7f7f7;">
<div style="max-width:600px;margin:0 auto;background:#fff;">
  <div style="background:${primaryColor};padding:30px 24px;text-align:center;">
    ${logoUrl ? `<img src="${logoUrl}" alt="${companyName}" style="max-width:200px;max-height:60px;margin-bottom:12px;" />` : ''}
    <h1 style="margin:0;font-size:22px;color:#fff;">${companyName}</h1>
    <p style="margin:8px 0 0;font-size:13px;color:rgba(255,255,255,0.8);">${tagline}</p>
  </div>
  <div style="padding:30px 24px;font-size:14px;line-height:1.6;color:#1a1a1a;">
    ${bodyHtml}
    <br>${sigHtml}
  </div>
  ${footerHtml}
</div></body></html>`;
  }
}

// ── AI: Rewrite customer notes ──
app.post('/api/ai/rewrite-notes', async (req, res) => {
  try {
    const ai = await getClaude();
    if (!ai) return res.status(500).json({ error: 'Claude API key not configured' });
    const { notes, contactName } = req.body;
    const message = await ai.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 512,
      system: 'Clean up and format customer notes for a painting contractor\'s CRM. Make them professional but conversational. Preserve all facts. Return only the rewritten notes, nothing else.',
      messages: [{ role: 'user', content: `Customer: ${contactName || 'Unknown'}\nNotes: ${notes}` }],
    });
    res.json({ rewritten: message.content[0].text });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Brand Profile endpoints ──
let _brandProfileCache = null;
let _brandProfileCacheTime = 0;
const BRAND_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

async function getBrandProfile() {
  if (_brandProfileCache && Date.now() - _brandProfileCacheTime < BRAND_CACHE_TTL) return _brandProfileCache;
  try {
    const db = await getAdminDb();
    if (!db) return null;
    const doc = await db.collection('brandProfile').doc('main').get();
    _brandProfileCache = doc.exists ? doc.data() : null;
    _brandProfileCacheTime = Date.now();
    return _brandProfileCache;
  } catch (e) { return null; }
}

const BRAND_DEFAULTS = {
  companyName: 'Northern Star Painters',
  primaryColor: '#1e3a8a',
  secondaryColor: '#ffffff',
  logoUrl: '',
  address: '4600 South Four Mile Run Drive, Arlington, VA 22204',
  phone: '(202) 743-5072',
  website: 'northernstarpainters.com',
  tagline: 'Professional Painting Services',
};

app.get('/api/brand-profile', async (req, res) => {
  const profile = await getBrandProfile();
  res.json(profile || BRAND_DEFAULTS);
});

app.put('/api/brand-profile', async (req, res) => {
  try {
    const db = await getAdminDb();
    if (!db) return res.status(500).json({ error: 'Database not available' });
    const data = { ...req.body, updatedAt: new Date().toISOString() };
    await db.collection('brandProfile').doc('main').set(data, { merge: true });
    _brandProfileCache = data;
    _brandProfileCacheTime = Date.now();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Endpoint: Apply style + tracking to an email for sending ──
app.post('/api/email/prepare', async (req, res) => {
  const { bodyHtml, style, fromName, fromEmail, contactId, campaignId, senderProfile, trackingOverrides } = req.body;

  // Fetch sender profile from Firestore if not provided
  let profile = senderProfile;
  if (!profile) {
    try {
      const db = await getAdminDb();
      if (db) {
        const snap = await db.collection('senderProfiles').where('email', '==', fromEmail).limit(1).get();
        if (!snap.empty) profile = snap.docs[0].data();
      }
    } catch (e) {}
  }

  // 1. Wrap in style template (now async for brand profile)
  let html = await wrapInStyle(bodyHtml || '', style || 'personal', fromName, fromEmail, contactId, profile);
  // 2. Apply tracking (unique links + open pixel)
  html = await applyTracking(html, contactId || '', campaignId || '', trackingOverrides || {});
  res.json({ html });
});

// ── Endpoint: Send test email ──
app.post('/api/send/test', async (req, res) => {
  try {
    const { toEmails, fromEmail, fromName, subject, html, textContent } = req.body;
    const results = [];
    for (const toEmail of (toEmails || [])) {
      try {
        const response = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: { 'accept': 'application/json', 'content-type': 'application/json', 'api-key': getKey('BREVO_API_KEY') },
          body: JSON.stringify({
            sender: { name: fromName, email: fromEmail },
            to: [{ email: toEmail }],
            subject: subject || 'Test Email',
            htmlContent: html,
            textContent: textContent || '',
          }),
        });
        const data = await response.json();
        results.push({ email: toEmail, ok: response.ok, messageId: data.messageId, error: data.message });
      } catch (e) { results.push({ email: toEmail, ok: false, error: e.message }); }
    }
    res.json({ results });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Expose applyTracking for campaign sends
app.post('/api/tracking/apply', async (req, res) => {
  const { html, contactId, campaignId, overrides } = req.body;
  const result = await applyTracking(html || '', contactId || '', campaignId || '', overrides || {});
  res.json({ html: result });
});

// ══════════════════════════════════════════
// PHASE 8: DATA FOUNDATIONS + UX RESTRUCTURE
// ══════════════════════════════════════════

// ── CAMPAIGN DELIVERY LOG ──

app.post('/api/deliveries/log', async (req, res) => {
  try {
    const db = await getAdminDb();
    if (!db) return res.json({ ok: true });
    const { contactId, campaignId, campaignName, status } = req.body;
    await db.collection('campaignDeliveries').add({
      contactId, campaignId, campaignName: campaignName || '',
      sentAt: new Date().toISOString(), status: status || 'sent',
      opened: false, openedAt: null, clicked: false, clickedAt: null, replied: false,
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/deliveries/contact/:contactId', async (req, res) => {
  try {
    const db = await getAdminDb();
    if (!db) return res.json([]);
    const snap = await db.collection('campaignDeliveries').where('contactId', '==', req.params.contactId).orderBy('sentAt', 'desc').limit(50).get();
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (e) { res.json([]); }
});

app.get('/api/deliveries/campaign/:campaignId', async (req, res) => {
  try {
    const db = await getAdminDb();
    if (!db) return res.json([]);
    const snap = await db.collection('campaignDeliveries').where('campaignId', '==', req.params.campaignId).get();
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (e) { res.json([]); }
});

// Batch log deliveries (called after campaign send)
app.post('/api/deliveries/batch', async (req, res) => {
  try {
    const db = await getAdminDb();
    if (!db) return res.json({ ok: true });
    const { deliveries } = req.body;
    const batch = db.batch();
    for (const d of (deliveries || [])) {
      const ref = db.collection('campaignDeliveries').doc();
      batch.set(ref, {
        contactId: d.contactId, campaignId: d.campaignId, campaignName: d.campaignName || '',
        sentAt: new Date().toISOString(), status: d.status || 'sent',
        opened: false, openedAt: null, clicked: false, clickedAt: null, replied: false,
      });
    }
    await batch.commit();
    res.json({ ok: true, logged: (deliveries || []).length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get contacts emailed in last X days (for exclusion filter)
app.get('/api/deliveries/recent', async (req, res) => {
  try {
    const db = await getAdminDb();
    if (!db) return res.json([]);
    const { days, userId } = req.query;
    const since = new Date(Date.now() - (parseInt(days) || 14) * 24 * 60 * 60 * 1000).toISOString();
    const snap = await db.collection('campaignDeliveries').where('sentAt', '>=', since).get();
    const contactIds = [...new Set(snap.docs.map(d => d.data().contactId))];
    res.json(contactIds);
  } catch (e) { res.json([]); }
});

// ── SENDER PROFILES ──

app.get('/api/sender-profiles', async (req, res) => {
  try {
    const db = await getAdminDb();
    if (!db) {
      // Return defaults
      return res.json([
        { id: 'amir', name: 'Amir Zreik', title: 'Owner', email: 'amirz@northernstarpainters.com', phone: '(202) 743-5072', signature: '—\nAmir Zreik\nNorthern Star Painters\n(202) 743-5072', styleNotes: 'Casual, direct. Uses "Hey" not "Dear". Signs off with first name only.', tier: 'personal' },
        { id: 'mary', name: 'Mary Johnson', title: 'Client Relations', email: 'mary@northernstarpainters.com', phone: '(202) 743-5072', signature: '—\nMary Johnson\nNorthern Star Painters\n4600 S Four Mile Run Dr, Arlington VA 22204\n(202) 743-5072', styleNotes: 'Professional but warm. Uses "Hi [Name]" greeting. Signs off with full name.', tier: 'general' },
      ]);
    }
    const snap = await db.collection('senderProfiles').get();
    if (snap.empty) {
      // Initialize defaults
      const defaults = [
        { name: 'Amir Zreik', title: 'Owner', email: 'amirz@northernstarpainters.com', phone: '(202) 743-5072', signature: '—\nAmir Zreik\nNorthern Star Painters\n(202) 743-5072', styleNotes: 'Casual, direct. Uses "Hey" not "Dear". Signs off with first name only.', tier: 'personal', isDefault: true },
        { name: 'Mary Johnson', title: 'Client Relations', email: 'mary@northernstarpainters.com', phone: '(202) 743-5072', signature: '—\nMary Johnson\nNorthern Star Painters\n4600 S Four Mile Run Dr, Arlington VA 22204\n(202) 743-5072', styleNotes: 'Professional but warm. Uses "Hi [Name]" greeting. Signs off with full name.', tier: 'general', isDefault: false },
      ];
      for (const p of defaults) await db.collection('senderProfiles').add(p);
      return res.json(defaults.map((p, i) => ({ id: `default_${i}`, ...p })));
    }
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/sender-profiles/:id', async (req, res) => {
  try {
    const db = await getAdminDb();
    if (!db) return res.json({ ok: true });
    await db.collection('senderProfiles').doc(req.params.id).update(req.body);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/sender-profiles', async (req, res) => {
  try {
    const db = await getAdminDb();
    if (!db) return res.json({ ok: true });
    const ref = await db.collection('senderProfiles').add(req.body);
    res.json({ id: ref.id, ...req.body });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── STORM SCORE FOR ALL CONTACTS ──

app.post('/api/storm-score/calculate-all', async (req, res) => {
  try {
    const db = await getAdminDb();
    if (!db) return res.status(500).json({ error: 'Database not available' });
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });

    const contactsSnap = await db.collection('emailContacts').where('userId', '==', userId).get();
    const contacts = contactsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Get weather for scoring
    let weatherData = null;
    try {
      const topCities = ['Vienna', 'Arlington', 'McLean', 'Fairfax', 'Alexandria'];
      const coords = { 'Vienna': { lat: 38.9012, lng: -77.2653 }, 'Arlington': { lat: 38.8816, lng: -77.0910 }, 'McLean': { lat: 38.9339, lng: -77.1773 }, 'Fairfax': { lat: 38.8462, lng: -77.3064 }, 'Alexandria': { lat: 38.8048, lng: -77.0469 } };
      const city = topCities[0];
      const c = coords[city];
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lng}&daily=temperature_2m_max,precipitation_sum,wind_speed_10m_max&temperature_unit=fahrenheit&timezone=America/New_York&forecast_days=7`;
      const r = await fetch(url);
      const data = await r.json();
      if (data.daily) {
        let consecutive = 0, maxCon = 0;
        for (let i = 0; i < data.daily.time.length; i++) {
          const ok = data.daily.temperature_2m_max[i] >= 50 && data.daily.temperature_2m_max[i] <= 90 && data.daily.precipitation_sum[i] === 0 && data.daily.wind_speed_10m_max[i] < 20;
          if (ok) { consecutive++; maxCon = Math.max(maxCon, consecutive); } else consecutive = 0;
        }
        weatherData = { isPaintingWeather: maxCon >= 3 };
      }
    } catch (e) { /* weather unavailable */ }

    let updated = 0;
    for (const contact of contacts) {
      const score = calculateStormScore(contact, [], weatherData);
      try {
        await db.collection('emailContacts').doc(contact.id).update({
          stormScore: { score: score.score, breakdown: score.breakdown, calculatedAt: new Date().toISOString() }
        });
        updated++;
      } catch (e) { /* skip individual errors */ }
    }

    res.json({ ok: true, updated, total: contacts.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get contacts by Storm Score threshold
app.get('/api/contacts/high-priority', async (req, res) => {
  try {
    const db = await getAdminDb();
    if (!db) return res.json([]);
    const { userId, minScore } = req.query;
    const threshold = parseInt(minScore) || 70;
    const snap = await db.collection('emailContacts').where('userId', '==', userId).get();
    const high = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(c => (c.stormScore?.score || 0) >= threshold).sort((a, b) => (b.stormScore?.score || 0) - (a.stormScore?.score || 0));
    res.json(high);
  } catch (e) { res.json([]); }
});

// ── GEOCODE CONTACTS ──

app.post('/api/contacts/geocode-batch', async (req, res) => {
  try {
    const db = await getAdminDb();
    if (!db) return res.status(500).json({ error: 'Database not available' });
    const { userId } = req.body;
    const snap = await db.collection('emailContacts').where('userId', '==', userId).get();
    const contacts = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(c => !c.coordinates && (c.address?.street || c.address?.city));

    let geocoded = 0, failed = 0;
    for (const contact of contacts) {
      const addr = `${contact.address?.street || ''} ${contact.address?.city || ''} ${contact.address?.state || ''}`.trim();
      if (addr.length < 3) { failed++; continue; }
      try {
        // Try Google Geocoding first if key available
        const gKey = getKey('GOOGLE_GEOCODING_API_KEY');
        if (gKey) {
          const gr = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(addr)}&key=${gKey}`);
          const gd = await gr.json();
          if (gd.results?.length) {
            const loc = gd.results[0].geometry.location;
            await db.collection('emailContacts').doc(contact.id).update({
              coordinates: { lat: loc.lat, lng: loc.lng, accuracy: 'street', geocodedAt: new Date().toISOString() }
            });
            geocoded++;
            continue;
          }
        }
        // Fallback: Open-Meteo city-level
        const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(addr)}&count=1&language=en&format=json`);
        const data = await r.json();
        if (data.results?.length) {
          await db.collection('emailContacts').doc(contact.id).update({
            coordinates: { lat: data.results[0].latitude, lng: data.results[0].longitude, accuracy: 'city', geocodedAt: new Date().toISOString() }
          });
          geocoded++;
        } else { failed++; }
      } catch (e) { failed++; }
      // Rate limit: small delay between requests
      if (geocoded % 10 === 0) await new Promise(r => setTimeout(r, 500));
    }
    res.json({ ok: true, geocoded, failed, total: contacts.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Nearby search using stored coordinates
app.post('/api/contacts/nearby', async (req, res) => {
  try {
    const { address, radiusMiles, userId } = req.body;
    const radius = radiusMiles || 0.5;

    // Geocode the search address
    let searchLat, searchLng;
    const gKey = getKey('GOOGLE_GEOCODING_API_KEY');
    if (gKey) {
      const gr = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${gKey}`);
      const gd = await gr.json();
      if (gd.results?.length) { searchLat = gd.results[0].geometry.location.lat; searchLng = gd.results[0].geometry.location.lng; }
    }
    if (!searchLat) {
      const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(address)}&count=1&language=en&format=json`);
      const data = await r.json();
      if (data.results?.length) { searchLat = data.results[0].latitude; searchLng = data.results[0].longitude; }
    }
    if (!searchLat) return res.json({ nearby: [], error: 'Could not geocode address' });

    // Find all contacts with coordinates
    const db = await getAdminDb();
    if (!db) return res.json({ nearby: [] });
    const snap = await db.collection('emailContacts').where('userId', '==', userId).get();
    const nearby = [];
    for (const doc of snap.docs) {
      const c = { id: doc.id, ...doc.data() };
      if (!c.coordinates?.lat) continue;
      const dist = haversine(searchLat, searchLng, c.coordinates.lat, c.coordinates.lng);
      if (dist <= radius) {
        nearby.push({ ...c, distance: Math.round(dist * 100) / 100 });
      }
    }
    nearby.sort((a, b) => a.distance - b.distance);
    res.json({ nearby, searchLat, searchLng, radius });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── MARK AS WON ──

app.post('/api/contacts/:id/mark-won', async (req, res) => {
  try {
    const db = await getAdminDb();
    if (!db) return res.json({ ok: true });
    const { jobValue, jobType, source, notes, campaignId } = req.body;
    await db.collection('emailContacts').doc(req.params.id).update({
      converted: {
        isCustomer: true, jobValue: parseFloat(jobValue) || 0, jobType: jobType || '',
        convertedAt: new Date().toISOString(), convertedFromSource: source || '',
        convertedFromCampaign: campaignId || '', notes: notes || '',
      },
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── LEAD FINDER: APPROVE/DISMISS LEADS ──

app.post('/api/leads/:id/approve', async (req, res) => {
  try {
    const db = await getAdminDb();
    if (!db) return res.json({ ok: true });
    const { listId, listName } = req.body;
    await db.collection('leads').doc(req.params.id).update({
      status: 'approved', approvedAt: new Date().toISOString(), approvedToList: listId || '', approvedToListName: listName || '',
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/leads/:id/dismiss', async (req, res) => {
  try {
    const db = await getAdminDb();
    if (!db) return res.json({ ok: true });
    await db.collection('leads').doc(req.params.id).update({
      status: 'dismissed', dismissedAt: new Date().toISOString(),
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── STRATEGY BRIEF JSON OUTPUT ──

app.post('/api/strategy/chat-with-brief', async (req, res) => {
  try {
    const ai = await getClaude();
    if (!ai) return res.status(500).json({ error: 'Claude API key not configured' });
    const { userId, messages, conversationId } = req.body;

    const context = await getStrategyContext(userId);
    const now = new Date();
    const todayStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const currentMonth = now.getMonth() + 1;
    const season = currentMonth >= 3 && currentMonth <= 5 ? 'spring — peak exterior season' :
                   currentMonth >= 6 && currentMonth <= 8 ? 'summer' :
                   currentMonth >= 9 && currentMonth <= 11 ? 'fall' : 'winter — interior season';

    const listLines = (context.lists || []).map(l =>
      `"${l.name}" (${l.tier}) — ${l.contactCount} contacts${l.daysSinceContact != null ? `, last emailed ${l.daysSinceContact}d ago` : ''}`
    ).join('\n');

    const weatherLines = (context.weather || []).filter(w => w.isPaintingWeather).map(w =>
      `${w.city}: ${w.perfectDays} perfect days, ${w.tempRange}`
    ).join(', ') || 'No painting weather this week.';

    const repaintTotal = context.repaintWindow ? Object.values(context.repaintWindow).reduce((a, b) => a + b, 0) : 0;

    const systemPrompt = `You are Amir's marketing partner for Northern Star Painters, a painting company in Northern Virginia.

Today: ${todayStr}. Season: ${season}.

Lists:
${listLines || 'No lists.'}

Total contacts: ${context.totalContacts || 0} (Personal: ${context.tierBreakdown?.personal || 0}, Cold: ${context.tierBreakdown?.general || 0})
In repaint window: ${repaintTotal}
Weather: ${weatherLines}

Help Amir plan campaigns. Be direct, suggest subject lines with reasoning.

IMPORTANT: When Amir agrees on a strategy or says to proceed, include a JSON block at the END of your message in this exact format:

\`\`\`json
{"campaignBrief":{"subjectStrategy":"personalize-city","subjectTemplate":"example template","contentDirection":"description of what to write","mustInclude":["address","yearsSince"],"mustExclude":["discounts"],"tone":"casual-personal","length":"medium"}}
\`\`\`

Valid values:
- subjectStrategy: "same-all", "personalize-name", "personalize-city", "fully-unique"
- mustInclude options: "address", "yearsSince", "paintColor", "weather", "seasonal"
- mustExclude options: "discounts", "dearValued", "hardCta", "images"
- tone: "casual-personal", "professional-warm", "friendly-checkin", "urgent"
- length: "short", "medium", "standard"

Only include the JSON when strategy is agreed. In early conversation messages, just chat normally.`;

    const msg = await ai.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: (messages || []).slice(-20),
    });

    const aiResponse = msg.content[0].text;

    // Try to extract JSON brief from response
    let briefJson = null;
    const jsonMatch = aiResponse.match(/```json\s*(\{[\s\S]*?\})\s*```/);
    if (jsonMatch) {
      try { briefJson = JSON.parse(jsonMatch[1]); } catch (e) { /* invalid JSON, ignore */ }
    }

    // Store conversation
    try {
      const db = await getAdminDb();
      if (db && conversationId) {
        const convoRef = db.collection('strategyConversations').doc(conversationId);
        const convoDoc = await convoRef.get();
        const allMsgs = convoDoc.exists ? [...(convoDoc.data().messages || []), { role: 'assistant', content: aiResponse }] : [...(messages || []), { role: 'assistant', content: aiResponse }];
        await convoRef.set({ userId, messages: allMsgs.slice(-30), status: briefJson ? 'brief_ready' : 'active', updatedAt: new Date().toISOString() }, { merge: true });
      }
    } catch (e) { /* ignore save errors */ }

    res.json({ response: aiResponse, brief: briefJson?.campaignBrief || null, conversationId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── SOURCE TRACKING MIGRATION ──

app.post('/api/contacts/backfill-sources', async (req, res) => {
  try {
    const db = await getAdminDb();
    if (!db) return res.status(500).json({ error: 'Database not available' });
    const { userId } = req.body;
    const snap = await db.collection('emailContacts').where('userId', '==', userId).get();
    let updated = 0;
    for (const doc of snap.docs) {
      const contact = doc.data();
      if (contact.sources && contact.sources.length > 0) continue; // Already has sources
      const sources = (contact.lists || []).map(l => ({
        name: l.listName || 'Unknown List', type: 'csv_import', listId: l.listId, addedAt: contact.createdAt || new Date().toISOString(),
      }));
      if (sources.length > 0) {
        await db.collection('emailContacts').doc(doc.id).update({ sources });
        updated++;
      }
    }
    res.json({ ok: true, updated, total: snap.size });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Catch-all: serve React app for any non-API route
app.get('{*path}', (req, res) => {
  res.sendFile(path.resolve(__dirname, '..', 'frontend', 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`NSP Email Tool backend running on port ${PORT}`);
});
// Phase 8 deployed
