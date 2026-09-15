import * as SecureStore from 'expo-secure-store';
import { getExamWebSocketUrl, STORAGE_EXAM_TOKEN } from './api';

export interface RealtimeEvent {
  type: string;
  timestamp: string;
  exam_id?: number | null;
  student_id?: number | null;
  attempt_id?: number | null;
  actor_role?: 'STUDENT' | 'TEACHER' | 'ADMIN' | 'SYSTEM' | null;
  payload?: Record<string, any> | null;
}

type EventCallback = (event: RealtimeEvent) => void;

class ExamWebSocketManager {
  private socket: WebSocket | null = null;
  private listeners: Map<string, Set<EventCallback>> = new Map();
  private globalListeners: Set<EventCallback> = new Set();
  private isConnecting = false;
  private reconnectTimeout: any = null;
  private intentionallyClosed = false;

  connect = async () => {
    if (this.socket || this.isConnecting) return;
    this.intentionallyClosed = false;
    this.isConnecting = true;

    try {
      const token = await SecureStore.getItemAsync(STORAGE_EXAM_TOKEN);
      if (!token) {
        console.warn('Cannot connect to exam WebSocket: no token stored.');
        this.isConnecting = false;
        return;
      }

      const url = `${getExamWebSocketUrl()}?token=${encodeURIComponent(token)}&client_version_code=30&client_version_name=1.5.14`;
      this.socket = new WebSocket(url);

      this.socket.onopen = () => {
        this.isConnecting = false;
        if (this.reconnectTimeout) {
          clearTimeout(this.reconnectTimeout);
          this.reconnectTimeout = null;
        }
      };

      this.socket.onmessage = (event) => {
        try {
          const parsed: RealtimeEvent = JSON.parse(event.data);
          this.trigger(parsed);
        } catch (err) {
          console.error('WebSocket parse error', err);
        }
      };

      this.socket.onclose = () => {
        this.socket = null;
        this.isConnecting = false;
        if (!this.intentionallyClosed) {
          this.scheduleReconnect();
        }
      };

      this.socket.onerror = () => {
        this.socket = null;
        this.isConnecting = false;
        if (!this.intentionallyClosed) {
          this.scheduleReconnect();
        }
      };
    } catch (e) {
      this.isConnecting = false;
      if (!this.intentionallyClosed) {
        this.scheduleReconnect();
      }
    }
  };

  disconnect = () => {
    this.intentionallyClosed = true;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  };

  private scheduleReconnect = () => {
    if (this.reconnectTimeout) return;
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect();
    }, 5000);
  };

  subscribe = (eventType: string, callback: EventCallback) => {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType)!.add(callback);
    return () => {
      const set = this.listeners.get(eventType);
      if (set) {
        set.delete(callback);
        if (set.size === 0) this.listeners.delete(eventType);
      }
    };
  };

  subscribeAll = (callback: EventCallback) => {
    this.globalListeners.add(callback);
    return () => { this.globalListeners.delete(callback); };
  };

  private trigger = (event: RealtimeEvent) => {
    this.globalListeners.forEach((cb) => cb(event));
    this.listeners.get(event.type)?.forEach((cb) => cb(event));
  };
}

export const examWs = new ExamWebSocketManager();
