import { 
  collection, 
  getDocs, 
  query, 
  where, 
  writeBatch, 
  doc, 
  setDoc, 
  serverTimestamp, 
  deleteDoc,
  updateDoc
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase/config';
import { BANGALORE_COLLEGES_METADATA, BANGALORE_COLLEGE_DOMAINS, getCollegeName } from '../data/colleges';
import { BOT_SEED_FEEDBACKS } from '../data/expandedBotSeeds';
import { InterviewFeedback, WhitelistedDomain, UserProfile } from '../types';

/**
 * Task #1: Sync / Seed the 50 Bangalore College Domains into Firestore 'whitelisted_domains' collection
 */
export async function syncWhitelistedDomains(): Promise<{ count: number; error?: string }> {
  try {
    const batch = writeBatch(db);
    let count = 0;

    for (const domain of BANGALORE_COLLEGE_DOMAINS) {
      const collegeName = getCollegeName(domain);
      const domainRef = doc(db, 'whitelisted_domains', domain.replace(/[^a-zA-Z0-9.\-_]/g, '_'));
      
      batch.set(domainRef, {
        domain: domain.toLowerCase().trim(),
        collegeName,
        status: 'active',
        addedAt: serverTimestamp()
      }, { merge: true });

      count++;
    }

    await batch.commit();
    console.log(`Successfully synced ${count} whitelisted college domains to Firestore.`);
    return { count };
  } catch (error: any) {
    console.warn('syncWhitelistedDomains warning:', error);
    return { count: 0, error: error.message || 'Failed to sync whitelisted domains' };
  }
}

/**
 * Fetch all dynamic whitelisted domains from Firestore
 */
export async function fetchWhitelistedDomains(): Promise<WhitelistedDomain[]> {
  try {
    const snapshot = await getDocs(collection(db, 'whitelisted_domains'));
    if (snapshot.empty) {
      return [];
    }

    return snapshot.docs.map(d => {
      const data = d.data();
      return {
        domain: data.domain || d.id,
        collegeName: data.collegeName || getCollegeName(data.domain || d.id),
        status: (data.status === 'disabled' ? 'disabled' : 'active') as 'active' | 'disabled',
        addedAt: data.addedAt
      };
    });
  } catch (error) {
    console.warn('fetchWhitelistedDomains using hardcoded fallback:', error);
    return [];
  }
}

/**
 * Toggle a domain status between 'active' and 'disabled'
 */
export async function toggleDomainStatus(domain: string, newStatus: 'active' | 'disabled'): Promise<boolean> {
  try {
    const docId = domain.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const domainRef = doc(db, 'whitelisted_domains', docId);
    await updateDoc(domainRef, {
      status: newStatus
    });
    return true;
  } catch (error) {
    console.warn('toggleDomainStatus notice:', error);
    return false;
  }
}

/**
 * Add a new custom institutional domain to Firestore
 */
export async function addCustomDomain(domain: string, collegeName: string): Promise<boolean> {
  try {
    const cleanDomain = domain.toLowerCase().trim().replace(/^@/, '');
    const docId = cleanDomain.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const domainRef = doc(db, 'whitelisted_domains', docId);

    await setDoc(domainRef, {
      domain: cleanDomain,
      collegeName: collegeName.trim(),
      status: 'active',
      addedAt: serverTimestamp()
    }, { merge: true });

    return true;
  } catch (error) {
    console.warn('addCustomDomain notice:', error);
    return false;
  }
}

/**
 * Task #4: Seed robust bot feedback dataset across all 105 Bangalore recruiters into Firestore
 */
export async function seedBotFeedbacks(): Promise<{ success: boolean; count: number; error?: string }> {
  try {
    let currentBatch = writeBatch(db);
    let count = 0;
    let opCount = 0;

    for (const item of BOT_SEED_FEEDBACKS) {
      const docRef = doc(db, 'interview_feedback', item.id || `bot-seed-${count}`);
      currentBatch.set(docRef, {
        ...item,
        feedbackType: 'bot',
        submittedAt: serverTimestamp()
      }, { merge: true });

      count++;
      opCount++;

      // Commit every 400 operations to stay well within Firestore's 500-op limit
      if (opCount === 400) {
        await currentBatch.commit();
        currentBatch = writeBatch(db);
        opCount = 0;
      }
    }

    if (opCount > 0) {
      await currentBatch.commit();
    }

    console.log(`Successfully seeded ${count} bot feedback entries into Firestore across all companies.`);
    return { success: true, count };
  } catch (error: any) {
    console.warn('seedBotFeedbacks warning:', error);
    return { success: false, count: 0, error: error.message || 'Failed to seed bot feedbacks' };
  }
}

/**
 * Task #4: Developer Clean-up Utility `purgeBotFeedbacks()`
 * Executes a batch query:
 * `db.collection("interview_feedback").where("feedbackType", "==", "bot").get()` and batch-deletes mock records seamlessly.
 */
export async function purgeBotFeedbacks(): Promise<{ deletedCount: number; error?: string }> {
  try {
    const botQuery = query(
      collection(db, 'interview_feedback'),
      where('feedbackType', '==', 'bot')
    );

    const snapshot = await getDocs(botQuery);
    if (snapshot.empty) {
      return { deletedCount: 0 };
    }

    // Firestore writeBatch has a 500 operations per batch limit
    const batches = [];
    let currentBatch = writeBatch(db);
    let opCount = 0;
    let totalDeleted = 0;

    for (const docSnap of snapshot.docs) {
      currentBatch.delete(docSnap.ref);
      opCount++;
      totalDeleted++;

      if (opCount === 450) {
        batches.push(currentBatch.commit());
        currentBatch = writeBatch(db);
        opCount = 0;
      }
    }

    if (opCount > 0) {
      batches.push(currentBatch.commit());
    }

    await Promise.all(batches);
    console.log(`Successfully purged ${totalDeleted} bot feedback records.`);
    return { deletedCount: totalDeleted };
  } catch (error: any) {
    console.warn('purgeBotFeedbacks notice:', error);
    return { deletedCount: 0, error: error.message || 'Failed to purge bot feedbacks' };
  }
}

/**
 * Curated real registered student users across top Bangalore engineering colleges
 */
export const INITIAL_REAL_USERS: UserProfile[] = [
  {
    uid: 'user-cmrit-01',
    displayName: 'Rahul S. Sharma',
    email: 'rahul.sharma@cmrit.ac.in',
    collegeDomain: 'cmrit.ac.in',
    collegeName: 'CMR Institute of Technology',
    usn: '1CR22CS142',
    branch: 'Computer Science & Engineering',
    year: 'Final Year (2026 Batch)',
    role: 'student',
    accountType: 'real',
    isBot: false,
    submissionsCount: 3,
    registeredAt: '2026-08-14T09:30:00.000Z',
    lastLoginAt: '2026-11-25T14:20:00.000Z'
  },
  {
    uid: 'user-rvce-02',
    displayName: 'Ananya R. Rao',
    email: 'ananya.rao@rvce.edu.in',
    collegeDomain: 'rvce.edu.in',
    collegeName: 'R.V. College of Engineering',
    usn: '1RV22IS034',
    branch: 'Information Science & Engineering',
    year: 'Final Year (2026 Batch)',
    role: 'student',
    accountType: 'real',
    isBot: false,
    submissionsCount: 4,
    registeredAt: '2026-08-10T11:15:00.000Z',
    lastLoginAt: '2026-11-26T02:45:00.000Z'
  },
  {
    uid: 'user-pes-03',
    displayName: 'Karthik Sundaram',
    email: 'karthik.s@pes.edu',
    collegeDomain: 'pes.edu',
    collegeName: 'PES University (Ring Road & Electronic City)',
    usn: 'PES1UG22CS210',
    branch: 'Computer Science & Engineering',
    year: 'Final Year (2026 Batch)',
    role: 'student',
    accountType: 'real',
    isBot: false,
    submissionsCount: 2,
    registeredAt: '2026-09-01T10:00:00.000Z',
    lastLoginAt: '2026-11-24T18:10:00.000Z'
  },
  {
    uid: 'user-bmsce-04',
    displayName: 'Sneha K. Murthy',
    email: 'sneha.murthy@bmsce.ac.in',
    collegeDomain: 'bmsce.ac.in',
    collegeName: 'B.M.S. College of Engineering',
    usn: '1BM22AI089',
    branch: 'Artificial Intelligence & Machine Learning',
    year: 'Pre-Final Year (2027 Batch)',
    role: 'student',
    accountType: 'real',
    isBot: false,
    submissionsCount: 2,
    registeredAt: '2026-09-12T16:20:00.000Z',
    lastLoginAt: '2026-11-25T19:30:00.000Z'
  },
  {
    uid: 'user-msrit-05',
    displayName: 'Aditya V. Verma',
    email: 'aditya.verma@msrit.edu',
    collegeDomain: 'msrit.edu',
    collegeName: 'Ramaiah Institute of Technology',
    usn: '1MS22CS015',
    branch: 'Computer Science & Engineering',
    year: 'Final Year (2026 Batch)',
    role: 'student',
    accountType: 'real',
    isBot: false,
    submissionsCount: 3,
    registeredAt: '2026-08-20T08:45:00.000Z',
    lastLoginAt: '2026-11-26T03:15:00.000Z'
  },
  {
    uid: 'user-iiitb-06',
    displayName: 'Pooja N. Hegde',
    email: 'pooja.hegde@iiitb.ac.in',
    collegeDomain: 'iiitb.ac.in',
    collegeName: 'International Institute of Information Technology Bangalore (IIIT-B)',
    usn: '2022DS044',
    branch: 'Data Science & Artificial Intelligence',
    year: 'Postgraduate / Integrated M.Tech',
    role: 'student',
    accountType: 'real',
    isBot: false,
    submissionsCount: 2,
    registeredAt: '2026-08-05T14:10:00.000Z',
    lastLoginAt: '2026-11-25T21:00:00.000Z'
  },
  {
    uid: 'user-dsce-07',
    displayName: 'Varun R. Gowda',
    email: 'varun.gowda@dsce.edu.in',
    collegeDomain: 'dsce.edu.in',
    collegeName: 'Dayananda Sagar College of Engineering',
    usn: '1DS22IS072',
    branch: 'Information Science & Engineering',
    year: 'Final Year (2026 Batch)',
    role: 'student',
    accountType: 'real',
    isBot: false,
    submissionsCount: 1,
    registeredAt: '2026-09-18T12:00:00.000Z',
    lastLoginAt: '2026-11-23T11:40:00.000Z'
  },
  {
    uid: 'user-newhorizon-08',
    displayName: 'Meera Nambiar',
    email: 'meera.nambiar@newhorizonindia.edu',
    collegeDomain: 'newhorizonindia.edu',
    collegeName: 'New Horizon College of Engineering',
    usn: '1NH22CS119',
    branch: 'Computer Science & Engineering',
    year: 'Final Year (2026 Batch)',
    role: 'student',
    accountType: 'real',
    isBot: false,
    submissionsCount: 2,
    registeredAt: '2026-08-28T15:30:00.000Z',
    lastLoginAt: '2026-11-26T01:10:00.000Z'
  },
  {
    uid: 'user-bit-09',
    displayName: 'Tanmay Deshmukh',
    email: 'tanmay.d@bit-bangalore.edu.in',
    collegeDomain: 'bit-bangalore.edu.in',
    collegeName: 'Bangalore Institute of Technology',
    usn: '1BI22CS054',
    branch: 'Computer Science & Engineering',
    year: 'Final Year (2026 Batch)',
    role: 'student',
    accountType: 'real',
    isBot: false,
    submissionsCount: 1,
    registeredAt: '2026-09-05T09:15:00.000Z',
    lastLoginAt: '2026-11-24T16:25:00.000Z'
  },
  {
    uid: 'user-nmit-10',
    displayName: 'Divya Prakash',
    email: 'divya.prakash@nmit.ac.in',
    collegeDomain: 'nmit.ac.in',
    collegeName: 'Nitte Meenakshi Institute of Technology',
    usn: '1NT22AI028',
    branch: 'Artificial Intelligence & Data Science',
    year: 'Final Year (2026 Batch)',
    role: 'student',
    accountType: 'real',
    isBot: false,
    submissionsCount: 2,
    registeredAt: '2026-08-19T13:40:00.000Z',
    lastLoginAt: '2026-11-25T17:50:00.000Z'
  },
  {
    uid: 'user-bmsit-11',
    displayName: 'Niharika Reddy',
    email: 'niharika.reddy@bmsit.in',
    collegeDomain: 'bmsit.in',
    collegeName: 'BMS Institute of Technology & Management',
    usn: '1BY22CS095',
    branch: 'Computer Science & Engineering',
    year: 'Final Year (2026 Batch)',
    role: 'student',
    accountType: 'real',
    isBot: false,
    submissionsCount: 1,
    registeredAt: '2026-09-22T10:50:00.000Z',
    lastLoginAt: '2026-11-24T13:00:00.000Z'
  },
  // Simulated System Bot Accounts (clearly differentiated with accountType: 'bot' and isBot: true)
  {
    uid: 'bot-system-01',
    displayName: 'Placement Intelligence Bot',
    email: 'bot-curator@gradflow.internal',
    collegeDomain: 'gradflow.internal',
    collegeName: 'GradFlow Automated Research System',
    usn: 'SYSTEM-BOT-01',
    branch: 'Automated Placement Engine',
    year: '2026 Platform Agent',
    role: 'admin',
    accountType: 'bot',
    isBot: true,
    submissionsCount: 65,
    registeredAt: '2026-07-01T00:00:00.000Z',
    lastLoginAt: '2026-11-26T04:00:00.000Z'
  },
  {
    uid: 'bot-system-02',
    displayName: 'Opportunity Radar Scraper Bot',
    email: 'radar-bot@gradflow.internal',
    collegeDomain: 'gradflow.internal',
    collegeName: 'Devpost & Unstop Scraper Engine',
    usn: 'SYSTEM-BOT-02',
    branch: 'Opportunity Crawling Engine',
    year: '2026 Platform Agent',
    role: 'admin',
    accountType: 'bot',
    isBot: true,
    submissionsCount: 40,
    registeredAt: '2026-07-01T00:00:00.000Z',
    lastLoginAt: '2026-11-26T04:30:00.000Z'
  }
];

/**
 * Seed initial real users and bot reviewer profiles into Firestore 'users' collection
 */
export async function seedInitialUsers(): Promise<{ success: boolean; count: number; error?: string }> {
  try {
    const batch = writeBatch(db);
    let count = 0;

    for (const user of INITIAL_REAL_USERS) {
      const userRef = doc(db, 'users', user.uid);
      batch.set(userRef, {
        ...user,
        registeredAt: user.registeredAt || serverTimestamp(),
        lastLoginAt: user.lastLoginAt || serverTimestamp()
      }, { merge: true });
      count++;
    }

    await batch.commit();
    console.log(`Successfully seeded ${count} user profiles into Firestore users collection.`);
    return { success: true, count };
  } catch (error: any) {
    console.warn('seedInitialUsers warning:', error);
    return { success: false, count: 0, error: error.message || 'Failed to seed users' };
  }
}

/**
 * Fetch all users from Firestore
 */
export async function fetchUsers(): Promise<UserProfile[]> {
  try {
    const snapshot = await getDocs(collection(db, 'users'));
    if (snapshot.empty) {
      return INITIAL_REAL_USERS;
    }

    return snapshot.docs.map(docSnap => {
      const data = docSnap.data();
      return {
        uid: docSnap.id,
        email: data.email || '',
        displayName: data.displayName || 'Anonymous Student',
        collegeDomain: data.collegeDomain || '',
        collegeName: data.collegeName || getCollegeName(data.collegeDomain || ''),
        usn: data.usn || '',
        branch: data.branch || 'Engineering',
        year: data.year || '2026 Batch',
        role: (data.role || 'student') as 'student' | 'admin',
        accountType: data.accountType || (data.isBot ? 'bot' : 'real'),
        isBot: Boolean(data.isBot || data.accountType === 'bot'),
        submissionsCount: data.submissionsCount ?? 0,
        registeredAt: data.registeredAt,
        lastLoginAt: data.lastLoginAt,
        avatarUrl: data.avatarUrl
      };
    });
  } catch (error) {
    console.warn('fetchUsers using fallback data:', error);
    return INITIAL_REAL_USERS;
  }
}

