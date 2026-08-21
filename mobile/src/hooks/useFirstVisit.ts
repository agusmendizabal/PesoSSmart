import { useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = '@nomi/visited_';

/** Borra el flag de "ya visitado" de una pantalla para que su tour vuelva a mostrarse. */
export function resetFirstVisit(key: string): Promise<void> {
  return AsyncStorage.removeItem(PREFIX + key);
}

export function useFirstVisit(key: string) {
  const [isFirstVisit, setIsFirstVisit] = useState(false);
  const [ready,        setReady]        = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(PREFIX + key).then(val => {
      if (!val) setIsFirstVisit(true);
      setReady(true);
    });
  }, [key]);

  const markVisited = () => {
    AsyncStorage.setItem(PREFIX + key, 'true');
    setIsFirstVisit(false);
  };

  return { isFirstVisit: isFirstVisit && ready, markVisited };
}
