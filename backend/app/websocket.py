"""
WebSocket Connection Manager

Handles WebSocket connections and broadcasts for real-time updates.
"""

import json
import logging
import threading
import asyncio
from typing import Dict, Set
from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    """Manages WebSocket connections for real-time updates."""
    
    def __init__(self):
        # Maps channel names to sets of connected websockets
        self.active_connections: Dict[str, Set[WebSocket]] = {}
        self._lock = threading.Lock()
    
    async def connect(self, websocket: WebSocket, channel: str = "default"):
        """Accept a new WebSocket connection and add to channel."""
        await websocket.accept()
        with self._lock:
            if channel not in self.active_connections:
                self.active_connections[channel] = set()
            self.active_connections[channel].add(websocket)
        logger.info(f"[WS] Connected to '{channel}'. Total: {len(self.active_connections.get(channel, set()))}")
    
    async def disconnect(self, websocket: WebSocket, channel: str = "default"):
        """Remove a WebSocket connection from channel."""
        with self._lock:
            if channel in self.active_connections:
                self.active_connections[channel].discard(websocket)
                if not self.active_connections[channel]:
                    del self.active_connections[channel]
        logger.info(f"[WS] Disconnected from '{channel}'")
    
    async def broadcast(self, message: dict, channel: str = "default"):
        """Broadcast a message to all connections in a channel (async only)."""
        with self._lock:
            connections = self.active_connections.get(channel, set()).copy()
        
        if not connections:
            return
        
        disconnected = set()
        message_json = json.dumps(message)
        logger.info(f"[WS] Broadcasting to '{channel}': {message.get('type', 'unknown')}")
        
        for websocket in connections:
            try:
                await websocket.send_text(message_json)
            except Exception as e:
                logger.warning(f"[WS] Failed to send: {e}")
                disconnected.add(websocket)
        
        if disconnected:
            with self._lock:
                if channel in self.active_connections:
                    self.active_connections[channel] -= disconnected
    
    def broadcast_sync(self, message: dict, channel: str = "default"):
        """
        Broadcast a message from a synchronous context (e.g., background tasks).
        Creates a new event loop if needed.
        """
        with self._lock:
            connections = self.active_connections.get(channel, set()).copy()
        
        if not connections:
            logger.debug(f"[WS] No connections in '{channel}' to broadcast to")
            return
        
        message_json = json.dumps(message)
        logger.info(f"[WS] Broadcasting (sync) to '{channel}': {message.get('type', 'unknown')}")
        
        disconnected = set()
        
        # Try to get the running event loop, create one if not exists
        try:
            loop = asyncio.get_running_loop()
            # We're in an async context, schedule the broadcast
            for websocket in connections:
                loop.create_task(self._send_to_websocket(websocket, message_json, disconnected))
        except RuntimeError:
            # No running event loop - create a new one for this thread
            try:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                try:
                    for websocket in connections:
                        try:
                            loop.run_until_complete(websocket.send_text(message_json))
                        except Exception as e:
                            logger.warning(f"[WS] Failed to send (sync): {e}")
                            disconnected.add(websocket)
                finally:
                    loop.close()
            except Exception as e:
                logger.error(f"[WS] Failed to create event loop for broadcast: {e}")
        
        if disconnected:
            with self._lock:
                if channel in self.active_connections:
                    self.active_connections[channel] -= disconnected
    
    async def _send_to_websocket(self, websocket: WebSocket, message: str, disconnected: set):
        """Helper to send message to a single websocket."""
        try:
            await websocket.send_text(message)
        except Exception as e:
            logger.warning(f"[WS] Failed to send: {e}")
            disconnected.add(websocket)
    
    def get_connection_count(self, channel: str = "default") -> int:
        """Get the number of connections in a channel."""
        with self._lock:
            return len(self.active_connections.get(channel, set()))


# Global connection manager instance
manager = ConnectionManager()
