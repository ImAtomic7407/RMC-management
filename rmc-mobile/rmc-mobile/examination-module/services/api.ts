import * as SecureStore from 'expo-secure-store';

export const STORAGE_EXAM_TOKEN = 'rmc_exam_jwt_token';
export const STORAGE_EXAM_USER = 'rmc_exam_user_profile';

let currentBaseUrl = 'https://riteshmathematics.in';

/**
 * Configure the root URL dynamically (usually called by the main App on launch)
 */
export const setExamBaseUrl = (url: string) => {
  if (url) {
    currentBaseUrl = url;
  }
};

let currentWsPort = 4200;

export const setExamWsPort = (port: number) => {
  currentWsPort = port;
};

export const getExamBaseUrl = () => {
  const cleanUrl = currentBaseUrl.replace(/\/$/, '');
  return `${cleanUrl}/api`;
};

export const getExamWebSocketUrl = () => {
  const cleanUrl = currentBaseUrl.replace(/\/$/, '');
  const isHttps = cleanUrl.startsWith('https');
  const wsProtocol = isHttps ? 'wss' : 'ws';
  const hostWithPort = cleanUrl.replace(/^https?:\/\//, '').split('/')[0];
  const hostname = hostWithPort.split(':')[0]; // strip any port already in the URL
  // Production (HTTPS via Cloudflare tunnel): WS is proxied over 443 on the same
  // host, so do NOT append a custom port. Local LAN (HTTP): append the exam port.
  return isHttps
    ? `${wsProtocol}://${hostname}/ws`
    : `${wsProtocol}://${hostname}:${currentWsPort}/ws`;
};

/**
 * Helper to fetch headers with the Bearer JWT token automatically
 */
export async function getExamHeaders(extraHeaders: Record<string, string> = {}): Promise<Record<string, string>> {
  const token = await SecureStore.getItemAsync(STORAGE_EXAM_TOKEN);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extraHeaders,
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

/**
 * Generic API Fetch Wrapper
 */
export async function examFetch<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const examBase = getExamBaseUrl();
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const url = `${examBase}${cleanPath}`;

  const defaultHeaders = await getExamHeaders((options.headers as Record<string, string>) || {});
  const config: RequestInit = {
    ...options,
    headers: defaultHeaders,
  };

  const response = await fetch(url, config);
  if (!response.ok) {
    let errMsg = `Request failed with status ${response.status}`;
    try {
      const errorJson = await response.json();
      if (errorJson.message || errorJson.error) {
        errMsg = errorJson.message || errorJson.error;
      }
    } catch (_) {}
    throw new Error(errMsg);
  }

  return response.json();
}
