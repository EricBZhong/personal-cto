import { initializeApp, cert, getApps, type ServiceAccount } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import fs from 'fs';

// Initialize Firebase Admin SDK
function initFirebase() {
  if (getApps().length > 0) {
    return getFirestore();
  }

  // Option 1: GOOGLE_APPLICATION_CREDENTIALS env var (standard for GCP)
  // Option 2: FIREBASE_SERVICE_ACCOUNT_JSON env var (inline JSON)
  // Option 3: Local file for development
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const credentialsJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (credentialsJson) {
    const serviceAccount = JSON.parse(credentialsJson) as ServiceAccount;
    initializeApp({ credential: cert(serviceAccount) });
  } else if (credentialsPath && fs.existsSync(credentialsPath)) {
    const serviceAccount = JSON.parse(fs.readFileSync(credentialsPath, 'utf-8')) as ServiceAccount;
    initializeApp({ credential: cert(serviceAccount) });
  } else {
    // Default credentials (works on GCP Cloud Run with attached service account)
    initializeApp();
  }

  const firestore = getFirestore();
  return firestore;
}

export const db = initFirebase();
export { FieldValue, Timestamp };

// Collection references
export const collections = {
  tasks: db.collection('tasks'),
  chatThreads: db.collection('chatThreads'),
  dailySpend: db.collection('dailySpend'),
  dailyTokens: db.collection('dailyTokens'),
  errorEvents: db.collection('errorEvents'),
  clarificationRequests: db.collection('clarificationRequests'),
  strategyPolls: db.collection('strategyPolls'),
  slackMessageQueue: db.collection('slackMessageQueue'),
  dogfoodEvals: db.collection('dogfoodEvals'),
  dailyReports: db.collection('dailyReports'),
  config: db.collection('config'),
  configRevisions: db.collection('configRevisions'),
  activityLog: db.collection('activityLog'),
  // Autonomous project execution
  projects: db.collection('projects'),
  memory: db.collection('memory'),
  deploys: db.collection('deploys'),
} as const;

// Subcollection helpers
export function taskLogs(taskId: string) {
  return collections.tasks.doc(taskId).collection('logs');
}

export function chatMessages(threadId: string) {
  return collections.chatThreads.doc(threadId).collection('messages');
}

export function evalRuns(evalId: string) {
  return collections.dogfoodEvals.doc(evalId).collection('runs');
}

/** Convert Firestore Timestamp to ISO string */
export function toISOString(ts: Timestamp | string | undefined): string {
  if (!ts) return new Date().toISOString();
  if (typeof ts === 'string') return ts;
  return ts.toDate().toISOString();
}
