import { useEffect, useState } from 'react';
import { onIdTokenChanged } from 'firebase/auth';
import { auth } from '../firebase';

export function useIsSuperAdmin(): boolean {
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  useEffect(() => onIdTokenChanged(auth, async (user) => {
    if (!user) {
      setIsSuperAdmin(false);
      return;
    }
    try {
      const token = await user.getIdTokenResult();
      setIsSuperAdmin(token.claims.superAdmin === true);
    } catch (error) {
      console.error('Unable to read super-admin authorization claim:', error);
      setIsSuperAdmin(false);
    }
  }), []);

  return isSuperAdmin;
}
