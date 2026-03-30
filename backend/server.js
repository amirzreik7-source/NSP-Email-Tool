import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import nodemailer from 'nodemailer';
import path from 'path';
import { fileURLToPath } from 'url';

// Load keys from env OR from .env file on disk
import { readFileSync } from 'fs';
let envKeys = {};
try {
  const envFile = readFileSync(path.resolve(__dirname, '.env'), 'utf-8');
  envFile.split('\n').forEach(line => {
    const [k, ...v] = line.split('=');
    if (k && v.length) envKeys[k.trim()] = v.join('=').trim();
  });
} catch(e) {}

function getKey(name) {
  return process.env[name] || envKeys[name] || '';
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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
    phase: 2,
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

// ── Click tracking redirect ──
app.get('/api/track/click', (req, res) => {
  const { c: contactId, u: url, cam: campaignId } = req.query;
  // Log the click (frontend will store in Firestore)
  console.log(`Click: contact=${contactId} campaign=${campaignId} url=${url}`);
  // Redirect to actual URL
  res.redirect(url || 'https://northernstarpainters.com');
});

// ── Open tracking pixel ──
app.get('/api/track/open', (req, res) => {
  const { c: contactId, cam: campaignId } = req.query;
  console.log(`Open: contact=${contactId} campaign=${campaignId}`);
  // Return 1x1 transparent pixel
  const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  res.set({ 'Content-Type': 'image/gif', 'Cache-Control': 'no-cache, no-store', 'Content-Length': pixel.length });
  res.end(pixel);
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
  try {
    const { fromEmail, fromName, toEmail, toName, subject, htmlContent, textContent } = req.body;

    const isAmir = fromEmail.toLowerCase().includes('amirz');
    const smtpUser = isAmir ? getKey('TITAN_AMIR_EMAIL') : getKey('TITAN_MARY_EMAIL');
    const smtpPass = isAmir ? getKey('TITAN_AMIR_PASSWORD') : getKey('TITAN_MARY_PASSWORD');

    const transporter = nodemailer.createTransport({
      host: getKey('TITAN_SMTP_HOST') || 'smtp.titan.email',
      port: parseInt(getKey('TITAN_SMTP_PORT') || '465'),
      secure: true,
      auth: { user: smtpUser, pass: smtpPass },
    });

    const footer = `<br><br><p style="font-size:11px;color:#999;text-align:center;">Northern Star Painters | 4600 South Four Mile Run Drive, Arlington, VA 22204</p>`;

    const info = await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: toName ? `"${toName}" <${toEmail}>` : toEmail,
      subject,
      html: htmlContent + footer,
      text: textContent,
    });

    res.json({ success: true, messageId: info.messageId });
  } catch (error) {
    console.error('Titan send error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── Batch send ──
app.post('/api/send/batch', async (req, res) => {
  const { method, fromEmail, fromName, subject, htmlTemplate, textTemplate, contacts } = req.body;
  const results = { sent: 0, failed: 0, errors: [] };

  const batchSize = 50;
  for (let i = 0; i < contacts.length; i += batchSize) {
    const batch = contacts.slice(i, i + batchSize);

    for (const contact of batch) {
      try {
        const personalizedHtml = personalizeTemplate(htmlTemplate, contact);
        const personalizedText = personalizeTemplate(textTemplate, contact);
        const personalizedSubject = personalizeTemplate(subject, contact);

        const endpoint = method === 'titan' ? '/api/send/titan' : '/api/send/brevo';
        const sendRes = await fetch(`http://localhost:${PORT}${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fromEmail, fromName, toEmail: contact.email, toName: contact.firstName || '',
            subject: personalizedSubject, htmlContent: personalizedHtml, textContent: personalizedText,
          }),
        });

        if (sendRes.ok) results.sent++;
        else { results.failed++; results.errors.push({ email: contact.email, error: 'Send failed' }); }
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
