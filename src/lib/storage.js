// src/lib/storage.js
// Google Drive (AppData folder) — only your account can ever see this folder's contents.

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
const SCOPES = 'https://www.googleapis.com/auth/drive.appdata';

let tokenClient = null;
let gapiReady = false;
let _refreshTimer = null;

// --- Initialisation ----------------------------------------------------------

export function initGoogleDrive(onReady, onError) {
  if (typeof gapi === 'undefined' || typeof google === 'undefined') {
    onError(new Error('Google scripts have not loaded yet. Please refresh.'));
    return;
  }

  gapi.load('client', async () => {
    try {
      await gapi.client.init({
        discoveryDocs: [
          'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest',
        ],
      });
      gapiReady = true;

      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: () => {}, // overridden at call-time
      });

      onReady();
    } catch (e) {
      onError(e);
    }
  });
}

// --- Auth --------------------------------------------------------------------

/**
 * Schedule a silent token refresh 5 minutes before the token expires.
 * Google OAuth tokens last ~3600 seconds (1 hour).
 */
function scheduleTokenRefresh(expiresInSeconds) {
  if (_refreshTimer) clearTimeout(_refreshTimer);

  // Refresh 5 minutes before expiry (or after 50 min if no info)
  const refreshMs = ((expiresInSeconds || 3600) - 300) * 1000;
  if (refreshMs <= 0) return;

  _refreshTimer = setTimeout(() => {
    silentRefreshToken();
  }, refreshMs);
}

/**
 * Silently refresh the token without showing a popup.
 * This works as long as the user's Google session is still active in the browser.
 */
function silentRefreshToken() {
  if (!tokenClient) return;

  tokenClient.callback = (tokenResponse) => {
    if (!tokenResponse.error) {
      scheduleTokenRefresh(tokenResponse.expires_in);
    }
    // If silent refresh fails, the next API call will throw and the UI
    // will show a re-login prompt — no crash.
  };

  tokenClient.requestAccessToken({ prompt: '' });
}

/**
 * Trigger the OAuth popup.  Returns a Promise that resolves with the token.
 */
export function loginToGoogle() {
  return new Promise((resolve, reject) => {
    if (!tokenClient) {
      reject(new Error('Token client not initialised. Call initGoogleDrive first.'));
      return;
    }

    tokenClient.callback = (tokenResponse) => {
      if (tokenResponse.error !== undefined) {
        reject(new Error(tokenResponse.error_description || tokenResponse.error));
      } else {
        // Start the auto-refresh loop
        scheduleTokenRefresh(tokenResponse.expires_in);
        resolve(tokenResponse.access_token);
      }
    };

    const existingToken = gapi.client.getToken();
    tokenClient.requestAccessToken({ prompt: existingToken ? '' : 'consent' });
  });
}

/**
 * Try to silently acquire a token without any popup.
 * Returns true if successful (user's Google session was active), false otherwise.
 * This lets returning users skip the "Sign in with Google" button entirely.
 */
export function trySilentLogin() {
  return new Promise((resolve) => {
    if (!tokenClient) {
      resolve(false);
      return;
    }

    tokenClient.callback = (tokenResponse) => {
      if (tokenResponse.error) {
        resolve(false);
      } else {
        scheduleTokenRefresh(tokenResponse.expires_in);
        resolve(true);
      }
    };

    // prompt: '' means no popup — it either works silently or fails
    try {
      tokenClient.requestAccessToken({ prompt: '' });
    } catch {
      resolve(false);
    }
  });
}

export function logoutFromGoogle() {
  if (_refreshTimer) {
    clearTimeout(_refreshTimer);
    _refreshTimer = null;
  }
  const token = gapi.client.getToken();
  if (token) {
    google.accounts.oauth2.revoke(token.access_token, () => {});
    gapi.client.setToken(null);
  }
}

export function isLoggedIn() {
  return !!gapi.client.getToken();
}

// --- Drive helpers -----------------------------------------------------------

function getAuthHeader() {
  const token = gapi.client.getToken();
  if (!token) throw new Error('Not authenticated with Google.');
  return { Authorization: 'Bearer ' + token.access_token };
}

async function findFileInAppData(name) {
  const response = await gapi.client.drive.files.list({
    spaces: 'appDataFolder',
    fields: 'files(id, name)',
    pageSize: 5,
    q: `name='${name}'`,
  });
  const files = response.result.files;
  return files && files.length > 0 ? files[0].id : null;
}

// --- Messages ----------------------------------------------------------------

export async function loadMessages() {
  const fileId = await findFileInAppData('smm_messages.json');
  if (!fileId) return [];

  const response = await gapi.client.drive.files.get({
    fileId,
    alt: 'media',
  });

  return Array.isArray(response.result) ? response.result : [];
}

export async function saveMessages(messages) {
  const fileId = await findFileInAppData('smm_messages.json');
  const json = JSON.stringify(messages);
  const blob = new Blob([json], { type: 'application/json' });
  const authHeaders = getAuthHeader();

  if (fileId) {
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify({ name: 'smm_messages.json' })], { type: 'application/json' }));
    form.append('file', blob);

    const res = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`,
      { method: 'PATCH', headers: new Headers(authHeaders), body: form }
    );
    if (!res.ok) throw new Error(`Drive save failed: ${res.status} ${await res.text()}`);
    return await res.json();
  } else {
    const metadata = { name: 'smm_messages.json', parents: ['appDataFolder'] };
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', blob);

    const res = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
      { method: 'POST', headers: new Headers(authHeaders), body: form }
    );
    if (!res.ok) throw new Error(`Drive create failed: ${res.status} ${await res.text()}`);
    return await res.json();
  }
}

// --- PBKDF2 salt (stored on Drive for portability across devices) ------------

const SALT_FILE_NAME = 'smm_salt.txt';

export async function loadSaltFromDrive() {
  try {
    const fileId = await findFileInAppData(SALT_FILE_NAME);
    if (!fileId) return null;

    const response = await gapi.client.drive.files.get({
      fileId,
      alt: 'media',
    });

    const salt = typeof response.result === 'string'
      ? response.result
      : response.body;
    return salt && salt.length > 0 ? salt.trim() : null;
  } catch {
    return null;
  }
}

export async function saveSaltToDrive(saltBase64) {
  const blob = new Blob([saltBase64], { type: 'text/plain' });
  const metadata = { name: SALT_FILE_NAME, parents: ['appDataFolder'] };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', blob);

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
    { method: 'POST', headers: new Headers(getAuthHeader()), body: form }
  );
  if (!res.ok) throw new Error(`Salt save failed: ${res.status}`);
}

// --- Encrypted files (images, videos, attachments) ---------------------------

const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100 MB safety limit

export async function uploadEncryptedFile(encryptedBlob, fileName) {
  if (encryptedBlob.size > MAX_FILE_BYTES) {
    throw new Error('File is too large (max 100 MB).');
  }

  const metadata = { name: fileName, parents: ['appDataFolder'] };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', encryptedBlob);

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
    { method: 'POST', headers: new Headers(getAuthHeader()), body: form }
  );

  if (!res.ok) throw new Error(`File upload failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.id;
}

export async function downloadEncryptedFile(fileId) {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: new Headers(getAuthHeader()) }
  );
  if (!res.ok) throw new Error(`File download failed: ${res.status}`);
  return await res.blob();
}

// --- File deletion (for message delete) --------------------------------------

export async function deleteFileFromDrive(fileId) {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}`,
    { method: 'DELETE', headers: new Headers(getAuthHeader()) }
  );
  // 204 No Content = success, 404 = already deleted (both are fine)
  if (!res.ok && res.status !== 404) {
    throw new Error(`File deletion failed: ${res.status}`);
  }
}
