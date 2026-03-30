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
    phase: 3,
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

    const jobHistory = (contact.jobHistory || []).map(j =>
      `${j.jobType} in ${j.jobDate ? new Date(j.jobDate).getFullYear() : 'unknown'} ($${j.jobValue || 'unknown'}) with ${j.salesRep || 'unknown'}`
    ).join('; ');

    const notes = contact.intelligenceProfile?.personalNotes || '';

    const message = await ai.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: `You are ${senderName} from Northern Star Painters, a house painting company in Northern Virginia. Write a personal email to ONE specific person. This should read like a real human wrote it — not a template. No marketing language. No "Dear valued customer." Write like you're texting a friend about business.`,
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
          system: `You are ${senderName} from Northern Star Painters, Northern Virginia. Write a personal email to ONE person. Read like a real human wrote it. No marketing language. No templates.
CRITICAL RULES:
- If tier is "general" or "cold": NEVER claim you know them personally. Use "we know you were interested in painting" angle only.
- If tier is "personal": Reference specific job history naturally.
- Keep under 200 words. Email style, not letter style. No big buttons.
- Never repeat content from previous campaigns.`,
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
// PHASE 1: SENDING (unchanged)
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

// Catch-all: serve React app for any non-API route
app.get('{*path}', (req, res) => {
  res.sendFile(path.resolve(__dirname, '..', 'frontend', 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`NSP Email Tool backend running on port ${PORT}`);
});
// Phase 2 deployed
