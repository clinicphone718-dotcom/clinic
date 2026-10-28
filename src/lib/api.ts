import { auth } from '../firebase';

const API_BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');
const API_BASE_PATH = API_BASE_URL.endsWith('/api')
  ? API_BASE_URL
  : `${API_BASE_URL}/api`;

export class ApiError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new ApiError('Session invalide. Veuillez vous reconnecter.');

  let token: string;
  try {
    token = await currentUser.getIdToken();
  } catch {
    throw new ApiError('Impossible de renouveler votre session. Veuillez vous reconnecter.');
  }

  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_PATH}${path.startsWith('/') ? path : `/${path}`}`, {
      ...options,
      headers,
    });
  } catch {
    throw new ApiError('Serveur indisponible. Vérifiez votre connexion ou la configuration du serveur.');
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.toLowerCase().includes('text/html')) {
    throw new ApiError(
      'Le serveur a renvoyé une page HTML au lieu de l’API. Vérifiez le proxy du déploiement statique.',
      response.status,
    );
  }

  if (!response.ok) {
    const body = await response.text();
    let serverMessage = '';
    if (body && contentType.toLowerCase().includes('application/json')) {
      try {
        const payload: unknown = JSON.parse(body);
        if (
          typeof payload === 'object' &&
          payload !== null &&
          'error' in payload &&
          typeof payload.error === 'string'
        ) {
          serverMessage = payload.error;
        } else if (
          typeof payload === 'object' &&
          payload !== null &&
          'message' in payload &&
          typeof payload.message === 'string'
        ) {
          serverMessage = payload.message;
        }
      } catch {
        serverMessage = '';
      }
    } else if (body.trim()) {
      serverMessage = body.trim();
    }

    if (serverMessage) throw new ApiError(serverMessage, response.status);
    if (response.status === 401) {
      throw new ApiError('Session expirée ou invalide. Veuillez vous reconnecter.', response.status);
    }
    if (response.status === 403) {
      throw new ApiError('Accès refusé par le serveur.', response.status);
    }
    if (response.status === 404) {
      throw new ApiError('Route API introuvable (404). Vérifiez la version du serveur et sa configuration.', response.status);
    }
    throw new ApiError(`La requête a échoué (HTTP ${response.status}).`, response.status);
  }

  return response;
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await apiFetch(path, options);
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new ApiError('Réponse invalide du serveur.', response.status);
  }
  try {
    return await response.json() as T;
  } catch {
    throw new ApiError('Réponse invalide du serveur.', response.status);
  }
}

export async function checkApiHealth(): Promise<void> {
  await apiFetch('/healthz');
}
