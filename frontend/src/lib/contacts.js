import { db } from './firebase';
import { collection, addDoc, getDocs, query, where, updateDoc, doc, deleteDoc, getDoc, writeBatch } from 'firebase/firestore';

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

// Fast bulk import — loads all contacts once, checks duplicates in memory
export async function bulkUpsertContacts(userId, rows, listInfo, onProgress) {
  // Load all existing contacts once upfront
  if (onProgress) onProgress({ phase: 'loading', message: 'Loading existing contacts...' });
  const allExisting = await getAllContacts(userId);
  const emailMap = new Map();
  for (const c of allExisting) {
    if (c.email) emailMap.set(c.email.toLowerCase().trim(), c);
  }

  let created = 0, updated = 0, skipped = 0, failed = 0;
  const errors = [];

  for (let i = 0; i < rows.length; i++) {
    const contactData = rows[i];
    const email = contactData.email?.toLowerCase().trim();
    if (!email) { skipped++; errors.push({ row: i + 1, reason: 'no email' }); continue; }

    try {
      const existing = emailMap.get(email);
      if (existing) {
        const updates = {};
        if (!existing.firstName && contactData.firstName) updates.firstName = contactData.firstName;
        if (!existing.lastName && contactData.lastName) updates.lastName = contactData.lastName;
        if (!existing.phone && contactData.phone) updates.phone = contactData.phone;
        if (!existing.address?.street && contactData.address?.street) updates.address = contactData.address;
        const lists = existing.lists || [];
        if (listInfo && !lists.some(l => l.listId === listInfo.listId)) updates.lists = [...lists, listInfo];
        if (contactData.tags?.length) {
          const existingTags = new Set(existing.tags || []);
          contactData.tags.forEach(t => existingTags.add(t));
          updates.tags = [...existingTags];
        }
        if (contactData.jobHistory?.length) updates.jobHistory = [...(existing.jobHistory || []), ...contactData.jobHistory];
        updates.updatedAt = new Date().toISOString();
        if (Object.keys(updates).length > 0) {
          await updateDoc(doc(db, CONTACTS_COL, existing.id), updates);
        }
        updated++;
      } else {
        const newContact = {
          userId, email,
          firstName: contactData.firstName || '', lastName: contactData.lastName || '',
          phone: contactData.phone || '', address: contactData.address || {},
          lists: listInfo ? [listInfo] : [], tags: contactData.tags || [],
          jobHistory: contactData.jobHistory || [],
          intelligenceProfile: { personalNotes: '', colorPreferences: '', personalDetails: '', renovationPlans: '' },
          engagement: { campaignsReceived: 0, totalOpens: 0, totalClicks: 0, engagementScore: 0, engagementTrend: 'new' },
          unsubscribed: false, bounced: false, source: 'csv_import',
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        };
        const ref = await addDoc(collection(db, CONTACTS_COL), newContact);
        emailMap.set(email, { id: ref.id, ...newContact });
        created++;
      }
    } catch (e) {
      failed++;
      errors.push({ row: i + 1, reason: e.message });
    }

    // Report progress every 5 rows
    if (onProgress && ((i + 1) % 5 === 0 || i === rows.length - 1)) {
      onProgress({ phase: 'importing', processed: i + 1, total: rows.length, created, updated, skipped, failed });
    }
  }

  return { created, updated, skipped, failed, errors };
}

// Delete a list and remove its reference from all contacts
export async function deleteList(userId, listId) {
  const allContacts = await getAllContacts(userId);
  const contactsWithList = allContacts.filter(c => c.lists?.some(l => l.listId === listId));
  const now = new Date().toISOString();

  // Batch contact updates — Firestore allows up to 500 writes per batch
  for (let i = 0; i < contactsWithList.length; i += 450) {
    const chunk = contactsWithList.slice(i, i + 450);
    const batch = writeBatch(db);
    for (const c of chunk) {
      const updatedLists = (c.lists || []).filter(l => l.listId !== listId);
      batch.update(doc(db, CONTACTS_COL, c.id), { lists: updatedLists, updatedAt: now });
    }
    await batch.commit();
  }

  // Delete the list doc last, so a mid-run failure leaves the list recoverable
  await deleteDoc(doc(db, LISTS_COL, listId));
  return { removed: contactsWithList.length };
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

// ── Engagement Tracking ──

export async function trackOpen(contactId) {
  const ref = doc(db, CONTACTS_COL, contactId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const data = snap.data();
  const eng = data.engagement || {};
  await updateDoc(ref, {
    'engagement.totalOpens': (eng.totalOpens || 0) + 1,
    'engagement.engagementScore': Math.min(100, (eng.engagementScore || 0) + 5),
    'engagement.lastOpenDate': new Date().toISOString(),
    'engagement.engagementTrend': calculateTrend(eng),
  });
}

export async function trackClick(contactId) {
  const ref = doc(db, CONTACTS_COL, contactId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const data = snap.data();
  const eng = data.engagement || {};
  await updateDoc(ref, {
    'engagement.totalClicks': (eng.totalClicks || 0) + 1,
    'engagement.engagementScore': Math.min(100, (eng.engagementScore || 0) + 15),
    'engagement.lastClickDate': new Date().toISOString(),
    'engagement.engagementTrend': calculateTrend(eng),
  });
}

export async function trackCampaignSent(contactId) {
  const ref = doc(db, CONTACTS_COL, contactId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const data = snap.data();
  await updateDoc(ref, {
    'engagement.campaignsReceived': (data.engagement?.campaignsReceived || 0) + 1,
  });
}

export async function updateRelationshipScore(contactId, score, recommendedSender) {
  await updateDoc(doc(db, CONTACTS_COL, contactId), {
    'engagement.relationshipScore': score,
    'engagement.recommendedSender': recommendedSender,
  });
}

function calculateTrend(eng) {
  const lastOpen = eng.lastOpenDate ? new Date(eng.lastOpenDate) : null;
  const daysSinceOpen = lastOpen ? (Date.now() - lastOpen.getTime()) / (1000 * 60 * 60 * 24) : 999;
  if (daysSinceOpen < 7) return 'rising';
  if (daysSinceOpen < 30) return 'stable';
  if (daysSinceOpen < 90) return 'cooling';
  return 'dormant';
}

// ── Cross-List Reclassification Engine ──

export async function reclassifyContacts(userId, newListId) {
  const allContacts = await getAllContacts(userId);
  const report = { newContacts: 0, updated: 0, reclassified: [], merged: 0, conflicts: [] };

  // Get contacts that belong to the new list
  const newListContacts = allContacts.filter(c => c.lists?.some(l => l.listId === newListId));

  for (const contact of newListContacts) {
    // Determine highest tier from all lists
    const tiers = (contact.lists || []).map(l => l.tier);
    const oldTier = contact.currentTier || 'general';
    let newTier = 'general';
    if (tiers.includes('personal')) newTier = 'personal';
    else if (tiers.includes('realtime')) newTier = 'realtime';

    // Determine recommended sender
    const sender = newTier === 'personal' ? 'amirz@northernstarpainters.com' : 'mary@northernstarpainters.com';
    const senderName = newTier === 'personal' ? 'Amir Zreik' : 'Mary Johnson';

    // Check if tier changed
    if (newTier !== oldTier) {
      report.reclassified.push({
        name: `${contact.firstName} ${contact.lastName}`,
        email: contact.email,
        from: oldTier,
        to: newTier,
        reason: `Appeared in ${(contact.lists || []).length} lists, highest tier: ${newTier}`,
      });

      await updateDoc(doc(db, CONTACTS_COL, contact.id), {
        currentTier: newTier,
        'engagement.recommendedSender': sender,
        'engagement.recommendedSenderName': senderName,
        updatedAt: new Date().toISOString(),
      });
    }

    // Count multi-list contacts as merged
    if ((contact.lists || []).length > 1) report.merged++;
  }

  return report;
}

// ── Get contact's full campaign history ──
export async function getContactCampaignHistory(userId, contactEmail) {
  // Query campaigns where this contact was in the audience
  const campSnap = await getDocs(query(collection(db, 'emailCampaigns'), where('userId', '==', userId)));
  const campaigns = campSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  return campaigns.filter(c => c.status === 'sent').map(c => ({
    id: c.id,
    name: c.name,
    sentAt: c.sentAt,
    subject: c.subject,
    fromName: c.fromName,
  }));
}
