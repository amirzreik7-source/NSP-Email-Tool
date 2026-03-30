import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import nodemailer from 'nodemailer';
import path from 'path';
import { fileURLToPath } from 'url';

// Lazy-load Anthropic only when needed (avoids crash if key missing)
let claude = null;
async function getClaude() {
  if (!claude && process.env.CLAUDE_API_KEY) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    claude = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
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

// Claude initialized lazily via getClaude()

// ── Health check ──
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

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
  "persona": "One paragraph describing who these people are and their relationship to the business",
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

// ── Send via Brevo ──
app.post('/api/send/brevo', async (req, res) => {
  try {
    const { fromEmail, fromName, toEmail, toName, subject, htmlContent, textContent } = req.body;

    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'accept': 'application/json', 'content-type': 'application/json', 'api-key': process.env.BREVO_API_KEY },
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

    // Pick credentials based on sender
    const isAmir = fromEmail.toLowerCase().includes('amirz');
    const smtpUser = isAmir ? process.env.TITAN_AMIR_EMAIL : process.env.TITAN_MARY_EMAIL;
    const smtpPass = isAmir ? process.env.TITAN_AMIR_PASSWORD : process.env.TITAN_MARY_PASSWORD;

    const transporter = nodemailer.createTransport({
      host: process.env.TITAN_SMTP_HOST || 'smtp.titan.email',
      port: parseInt(process.env.TITAN_SMTP_PORT || '465'),
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

    // 2-second delay between batches
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
