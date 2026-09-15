import { useState, useEffect, useRef, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const LOCAL_ANSWERS_CACHE_PREFIX = '@rmc_exam_answers_';

export interface UseExamTimerOptions {
  examId: number;
  endsAt: string | Date;
  onTimeExpired: () => void;
}

export function useExamTimer({ examId, endsAt, onTimeExpired }: UseExamTimerOptions) {
  const [timeLeftMs, setTimeLeftMs] = useState<number>(0);
  const [isExpired, setIsExpired] = useState<boolean>(false);
  const intervalRef = useRef<any>(null);
  // Stable ref so the interval closure never captures a stale callback.
  const onExpiredRef = useRef(onTimeExpired);
  onExpiredRef.current = onTimeExpired;

  useEffect(() => {
    const targetTime = new Date(endsAt).getTime();
    const diff = targetTime - Date.now();

    setTimeLeftMs(Math.max(0, diff));
    if (diff <= 0) {
      setIsExpired(true);
      onExpiredRef.current();
      return;
    }

    intervalRef.current = setInterval(() => {
      const remaining = targetTime - Date.now();
      if (remaining <= 0) {
        setTimeLeftMs(0);
        setIsExpired(true);
        clearInterval(intervalRef.current);
        onExpiredRef.current();
      } else {
        setTimeLeftMs(remaining);
      }
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [endsAt]);

  const formatTime = useCallback(() => {
    if (timeLeftMs <= 0) return '00:00:00';
    const totalSecs = Math.floor(timeLeftMs / 1000);
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
  }, [timeLeftMs]);

  const isUrgent = timeLeftMs > 0 && timeLeftMs < 5 * 60 * 1000;

  const saveAnswersCache = useCallback(async (answers: Record<string, any>) => {
    try {
      await AsyncStorage.setItem(
        `${LOCAL_ANSWERS_CACHE_PREFIX}${examId}`,
        JSON.stringify({ answers, timestamp: Date.now() })
      );
    } catch (e) {
      console.error('Failed to cache answers', e);
    }
  }, [examId]);

  const loadAnswersCache = useCallback(async (): Promise<Record<string, any> | null> => {
    try {
      const raw = await AsyncStorage.getItem(`${LOCAL_ANSWERS_CACHE_PREFIX}${examId}`);
      if (raw) return JSON.parse(raw).answers;
    } catch (e) {
      console.error('Failed to load cached answers', e);
    }
    return null;
  }, [examId]);

  const clearAnswersCache = useCallback(async () => {
    try {
      await AsyncStorage.removeItem(`${LOCAL_ANSWERS_CACHE_PREFIX}${examId}`);
    } catch (e) {
      console.error('Failed to clear cached answers', e);
    }
  }, [examId]);

  return { timeLeftMs, isExpired, isUrgent, formatTime, saveAnswersCache, loadAnswersCache, clearAnswersCache };
}
