import { db } from './firebase';
import { collection, addDoc, getDocs, query, where, updateDoc, doc, getDoc } from 'firebase/firestore';

const CAMPAIGNS_COL = 'emailCampaigns';

export async function getAllCampaigns(userId) {
  const snap = await getDocs(query(collection(db, CAMPAIGNS_COL), where('userId', '==', userId)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getCampaign(campaignId) {
  const snap = await getDoc(doc(db, CAMPAIGNS_COL, campaignId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

export async function createCampaign(userId, data) {
  const campaign = {
    userId,
    ...data,
    status: 'draft',
    stats: { sent: 0, delivered: 0, failed: 0, opened: 0, clicked: 0, unsubscribed: 0, bounced: 0 },
    createdAt: new Date().toISOString(),
    sentAt: null,
  };
  const ref = await addDoc(collection(db, CAMPAIGNS_COL), campaign);
  return ref.id;
}

export async function updateCampaign(campaignId, data) {
  await updateDoc(doc(db, CAMPAIGNS_COL, campaignId), data);
}

// Personalization — replace {FirstName}, {City}, etc.
export function personalizeEmail(template, contact) {
  const mostRecentJob = (contact.jobHistory || []).sort((a, b) => new Date(b.jobDate) - new Date(a.jobDate))[0];
  const yearsSince = mostRecentJob ? new Date().getFullYear() - new Date(mostRecentJob.jobDate).getFullYear() : null;

  const replacements = {
    '{FirstName}': contact.firstName || 'there',
    '{LastName}': contact.lastName || '',
    '{Address}': contact.address?.street || 'your home',
    '{City}': contact.address?.city || 'your area',
    '{JobYear}': mostRecentJob ? new Date(mostRecentJob.jobDate).getFullYear().toString() : 'a few years ago',
    '{JobType}': mostRecentJob?.jobType || 'painting',
    '{YearsSince}': yearsSince ? yearsSince.toString() : 'a few',
  };

  let result = template;
  for (const [key, val] of Object.entries(replacements)) {
    result = result.replaceAll(key, val);
  }
  return result;
}
