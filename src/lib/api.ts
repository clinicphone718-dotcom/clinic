import { auth } from '../firebase';

const API_BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

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

  let response: Response;
  try {
    const token = await currentUser.getIdToken();
    response = await fetch(`${API_BASE_URL}/api${path.startsWith('/') ? path : `/${path}`}`, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${token}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
  } catch {
    throw new ApiError('Serveur indisponible, contactez l’administrateur');
  }

  if (response.status === 404) {
    throw new ApiError('Serveur indisponible, contactez l’administrateur', response.status);
  }
  if (!response.ok) {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.toLowerCase().includes('text/html')) {
      throw new ApiError('Serveur indisponible, contactez l’administrateur', response.status);
    }
    const payload: unknown = contentType.toLowerCase().includes('application/json')
      ? await response.json()
      : null;
    const message =
      typeof payload === 'object' &&
      payload !== null &&
      'error' in payload &&
      typeof payload.error === 'string'
        ? payload.error
        : 'La requête a échoué.';
    throw new ApiError(message, response.status);
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
  return response.json() as Promise<T>;
}
