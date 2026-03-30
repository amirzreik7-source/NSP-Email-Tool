import { db } from './firebase';
import { collection, addDoc, getDocs, query, where, updateDoc, doc, deleteDoc, getDoc } from 'firebase/firestore';

const CONTACTS_COL = 'emailContacts';
const LISTS_COL = 'emailLists';
const UNSUBSCRIBES_COL = 'emailUnsubscribes';

// ── Contact CRUD ──

export async function getAllContacts(userId) {
  const snap = await getDocs(query(collection(db, CONTACTS_COL), where('userId', '==', userId)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getContactsByList(userId, listId) {
  const all = await getAllContacts(userId);
  return all.filter(c => c.lists?.some(l => l.listId === listId));
}

export async function getContactByEmail(userId, email) {
  const snap = await getDocs(query(collection(db, CONTACTS_COL), where('userId', '==', userId), where('email', '==', email.toLowerCase().trim())));
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

export async function upsertContact(userId, contactData, listInfo) {
  const email = contactData.email?.toLowerCase().trim();
  if (!email) return { status: 'skipped', reason: 'no email' };

  const existing = await getContactByEmail(userId, email);

  if (existing) {
    // Merge — fill gaps, add list, never overwrite existing data
    const updates = {};
    if (!existing.firstName && contactData.firstName) updates.firstName = contactData.firstName;
    if (!existing.lastName && contactData.lastName) updates.lastName = contactData.lastName;
    if (!existing.phone && contactData.phone) updates.phone = contactData.phone;
    if (!existing.address?.street && contactData.address?.street) updates.address = contactData.address;

    // Add list if not already in lists array
    const lists = existing.lists || [];
    if (listInfo && !lists.some(l => l.listId === listInfo.listId)) {
      updates.lists = [...lists, listInfo];
    }

    // Merge tags
    if (contactData.tags?.length) {
      const existingTags = new Set(existing.tags || []);
      contactData.tags.forEach(t => existingTags.add(t));
      updates.tags = [...existingTags];
    }

    // Merge job history
    if (contactData.jobHistory?.length) {
      updates.jobHistory = [...(existing.jobHistory || []), ...contactData.jobHistory];
    }

    updates.updatedAt = new Date().toISOString();

    if (Object.keys(updates).length > 0) {
      await updateDoc(doc(db, CONTACTS_COL, existing.id), updates);
    }
    return { status: 'updated', id: existing.id };
  }

  // New contact
  const newContact = {
    userId,
    email,
    firstName: contactData.firstName || '',
    lastName: contactData.lastName || '',
    phone: contactData.phone || '',
    address: contactData.address || {},
    lists: listInfo ? [listInfo] : [],
    tags: contactData.tags || [],
    jobHistory: contactData.jobHistory || [],
    intelligenceProfile: { personalNotes: '', colorPreferences: '', personalDetails: '', renovationPlans: '' },
    engagement: { campaignsReceived: 0, totalOpens: 0, totalClicks: 0, engagementScore: 0, engagementTrend: 'new' },
    unsubscribed: false,
    bounced: false,
    source: 'csv_import',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const ref = await addDoc(collection(db, CONTACTS_COL), newContact);
  return { status: 'created', id: ref.id };
}

// ── List CRUD ──

export async function getAllLists(userId) {
  const snap = await getDocs(query(collection(db, LISTS_COL), where('userId', '==', userId)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function createList(userId, listData) {
  const ref = await addDoc(collection(db, LISTS_COL), { userId, ...listData, createdAt: new Date().toISOString() });
  return ref.id;
}

export async function updateList(listId, data) {
  await updateDoc(doc(db, LISTS_COL, listId), data);
}

export async function getList(listId) {
  const snap = await getDoc(doc(db, LISTS_COL, listId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

// ── Unsubscribe ──

export async function getUnsubscribes(userId) {
  const snap = await getDocs(query(collection(db, UNSUBSCRIBES_COL), where('userId', '==', userId)));
  return new Set(snap.docs.map(d => d.data().email));
}

export async function addUnsubscribe(userId, email, campaignId) {
  await addDoc(collection(db, UNSUBSCRIBES_COL), {
    userId, email: email.toLowerCase().trim(), unsubscribedDate: new Date().toISOString(), campaignId, reason: 'manual'
  });
}
