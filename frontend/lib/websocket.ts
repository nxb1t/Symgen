/**
 * WebSocket utilities for real-time updates
 */

import { useEffect, useRef, useState, useCallback } from "react";

// WebSocket URL - use the same origin with ws:// or wss://
const getWebSocketUrl = (path: string): string => {
  if (typeof window === "undefined") return "";
  
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.host;
  
  // If we have a custom API URL, use that host
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  if (apiUrl) {
    try {
      const url = new URL(apiUrl);
      return `${protocol}//${url.host}${path}`;
    } catch {
      // Fall through to default
    }
  }
  
  return `${protocol}//${host}${path}`;
};

export interface WebSocketMessage<T = unknown> {
  type: string;
  [key: string]: T | string;
}

export interface UseWebSocketOptions {
  /** WebSocket endpoint path (e.g., "/api/symgen/ws") */
  path: string;
  /** Callback when a message is received */
  onMessage?: (message: WebSocketMessage) => void;
  /** Callback when connection opens */
  onOpen?: () => void;
  /** Callback when connection closes */
  onClose?: () => void;
  /** Callback when an error occurs */
  onError?: (error: Event) => void;
  /** Whether to automatically reconnect on disconnect */
  reconnect?: boolean;
  /** Reconnection delay in ms */
  reconnectDelay?: number;
  /** Maximum reconnection attempts */
  maxReconnectAttempts?: number;
  /** Whether the WebSocket should be enabled */
  enabled?: boolean;
}

export interface UseWebSocketReturn {
  /** Whether the WebSocket is connected */
  isConnected: boolean;
  /** Send a message through the WebSocket */
  send: (data: string | object) => void;
  /** Manually close the connection */
  close: () => void;
  /** Manually reconnect */
  reconnect: () => void;
}

/**
 * Custom hook for WebSocket connections with auto-reconnect
 */
export function useWebSocket({
  path,
  onMessage,
  onOpen,
  onClose,
  onError,
  reconnect = true,
  reconnectDelay = 3000,
  maxReconnectAttempts = 10,
  enabled = true,
}: UseWebSocketOptions): UseWebSocketReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const [isConnected, setIsConnected] = useState(false);
  
  // Store callbacks in refs to avoid reconnection on callback change
  const onMessageRef = useRef(onMessage);
  const onOpenRef = useRef(onOpen);
  const onCloseRef = useRef(onClose);
  const onErrorRef = useRef(onError);
  
  // Store connect function in a ref to allow self-reference in reconnect logic
  const connectRef = useRef<() => void>(() => {});
  
  useEffect(() => {
    onMessageRef.current = onMessage;
    onOpenRef.current = onOpen;
    onCloseRef.current = onClose;
    onErrorRef.current = onError;
  }, [onMessage, onOpen, onClose, onError]);
  
  const connect = useCallback(() => {
    if (!enabled || typeof window === "undefined") return;
    
    // Clean up existing connection
    if (wsRef.current) {
      wsRef.current.close();
    }
    
    const url = getWebSocketUrl(path);
    if (!url) return;
    
    console.log(`[WebSocket] Connecting to ${url}...`);
    
    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;
      
      ws.onopen = () => {
        console.log(`[WebSocket ${path}] Connected`);
        setIsConnected(true);
        reconnectAttemptsRef.current = 0;
        onOpenRef.current?.();
      };
      
      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as WebSocketMessage;
          console.log(`[WebSocket ${path}] Message received:`, message.type);
          onMessageRef.current?.(message);
        } catch {
          // Handle non-JSON messages (like "pong")
          if (event.data !== "pong") {
            console.log(`[WebSocket ${path}] Received:`, event.data);
          }
        }
      };
      
      ws.onclose = (event) => {
        console.log(`[WebSocket ${path}] Disconnected (code: ${event.code})`);
        setIsConnected(false);
        wsRef.current = null;
        onCloseRef.current?.();
        
        // Auto-reconnect if enabled and not manually closed
        if (reconnect && event.code !== 1000 && reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current++;
          console.log(`[WebSocket ${path}] Reconnecting in ${reconnectDelay}ms (attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts})...`);
          reconnectTimeoutRef.current = setTimeout(() => connectRef.current(), reconnectDelay);
        }
      };
      
      ws.onerror = (error) => {
        console.error(`[WebSocket ${path}] Error:`, error);
        onErrorRef.current?.(error);
      };
    } catch (error) {
      console.error(`[WebSocket ${path}] Failed to connect:`, error);
    }
  }, [enabled, path, reconnect, reconnectDelay, maxReconnectAttempts]);
  
  // Keep connectRef in sync with the latest connect function
  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);
  
  const send = useCallback((data: string | object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const message = typeof data === "string" ? data : JSON.stringify(data);
      wsRef.current.send(message);
    }
  }, []);
  
  const close = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close(1000, "Closed by client");
      wsRef.current = null;
    }
    setIsConnected(false);
  }, []);
  
  const manualReconnect = useCallback(() => {
    reconnectAttemptsRef.current = 0;
    close();
    connect();
  }, [close, connect]);
  
  // Connect on mount, disconnect on unmount
  useEffect(() => {
    if (enabled) {
      connect();
    }
    
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close(1000, "Component unmounted");
      }
    };
  }, [enabled, connect]);
  
  // Send periodic pings to keep connection alive
  useEffect(() => {
    if (!isConnected) return;
    
    const pingInterval = setInterval(() => {
      send("ping");
    }, 30000); // Ping every 30 seconds
    
    return () => clearInterval(pingInterval);
  }, [isConnected, send]);
  
  return {
    isConnected,
    send,
    close,
    reconnect: manualReconnect,
  };
}
