/**
 * Customer session token + anonymous device id, kept on this device.
 * The token is an opaque bearer credential issued by the backend (/auth/login, /auth/register).
 */
const TOKEN_KEY = 'optafiles:session';
const DEVICE_KEY = 'optafiles:device';

export const getSessionToken = (): string | null => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};

export const setSessionToken = (token: string | null) => {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // private mode: the session lives only in memory for this tab
  }
};

/** Random id that identifies this browser. Used server-side to cap accounts per device. */
export const getDeviceId = (): string => {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
};
