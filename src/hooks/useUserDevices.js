import { useState, useEffect } from 'react';
import { ref, onValue } from 'firebase/database';
import { onAuthStateChanged } from 'firebase/auth';
import { db, auth } from '../lib/firebase';

export const useUserDevices = () => {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState(null);

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (user) {
        setUserId(user.uid);
      } else {
        setUserId(null);
        setDevices([]);
        setLoading(false);
      }
    });
    return () => unsubscribeAuth();
  }, []);

  useEffect(() => {
    if (!userId) return;

    const devicesRef = ref(db, `users/${userId}/owned_devices`);
    
    const unsubscribeDb = onValue(devicesRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        setDevices(Object.keys(data));
      } else {
        setDevices([]);
      }
      setLoading(false);
    }, (error) => {
      console.error("Firebase error fetching devices:", error);
      setLoading(false);
    });

    return () => unsubscribeDb();
  }, [userId]);

  return { devices, loading, userId };
};
