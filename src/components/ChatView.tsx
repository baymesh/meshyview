import { useState, useEffect, useRef } from 'react';
import { api } from '../api';
import type { ChatMessage } from '../types';
import { formatCompactDateTime, formatNodeId } from '../utils/portNames';
import type { NodeLookup } from '../utils/nodeLookup';

interface ChatViewProps {
  nodeLookup: NodeLookup | null;
  onNodeClick: (nodeId: string) => void;
  onPacketClick: (packetId: number) => void;
  globalChannel?: string;
}

export function ChatView({ nodeLookup, onNodeClick, onPacketClick, globalChannel }: ChatViewProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Use global channel if provided, otherwise default to empty (all channels)
  const selectedChannel = globalChannel || '';

  // Scroll to bottom when messages change and autoScroll is enabled
  useEffect(() => {
    if (autoScroll && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, autoScroll]);

  // Fetch initial messages
  useEffect(() => {
    const fetchMessages = async () => {
      try {
        setLoading(true);
        setError(null);
        const params: { channel?: string; decode_payload: boolean; limit: number } = {
          decode_payload: true,
          limit: 25
        };
        if (selectedChannel) {
          params.channel = selectedChannel;
        }
        const data = await api.getChat(params);
        // Reverse the array so oldest messages are first (top) and newest are last (bottom)
        setMessages((data.packets || []).reverse());
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch messages');
        console.error('Error fetching messages:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchMessages();
  }, [selectedChannel]);

  // WebSocket subscription for real-time updates
  useEffect(() => {
    const params = new URLSearchParams();
    params.append('portnum', '1'); // Text messages
    if (selectedChannel) {
      params.append('channel', selectedChannel);
    }
    
    const ws = new WebSocket(`wss://meshql.bayme.sh/ws?${params.toString()}`);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('WebSocket connected for chat');
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        // Handle different message types
        if (data.type === 'connected') {
          console.log('Connected to MeshQL WebSocket:', data.filters);
        } else if (data.type === 'subscribed') {
          console.log('Subscribed to chat updates:', data.filters);
        } else if (data.type === 'packet') {
          // Add new chat message to the list
          const newMessage: ChatMessage = {
            id: data.id,
            from_node_id: data.from_node_id,
            to_node_id: data.to_node_id,
            channel: data.channel,
            portnum: data.portnum,
            import_time: data.import_time,
            payload: data.payload
          };
          
          // Only add if it's for the current channel (or all channels if none selected)
          if (!selectedChannel || newMessage.channel === selectedChannel) {
            setMessages(prev => {
              // Deduplicate: check if message with this ID already exists
              if (prev.some(msg => msg.id === newMessage.id)) {
                return prev;
              }
              return [...prev, newMessage];
            });
          }
        }
      } catch (err) {
        // Ignore non-JSON messages or parsing errors
        console.debug('WebSocket message parse error:', err);
      }
    };

    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
    };

    // Cleanup on unmount or when channel changes
    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    };
  }, [selectedChannel]);

  const getMessageText = (msg: ChatMessage): string => {
    if (typeof msg.payload === 'object' && msg.payload !== null) {
      if ('text' in msg.payload && msg.payload.text) {
        return msg.payload.text;
      }
      return `[${msg.payload.type || 'Unknown'}]`;
    }
    return msg.payload || '(empty message)';
  };

  const getNodeName = (nodeId: number): string => {
    if (!nodeLookup) return nodeId.toString(16).padStart(8, '0');
    return nodeLookup.getNodeName(nodeId);
  };

  return (
    <div className="chat-view">
      <div className="chat-header">
        <h2>Chat Messages</h2>
        <div className="chat-controls">
          <div className="autoscroll-control">
            <label htmlFor="autoScroll">
              <input
                type="checkbox"
                id="autoScroll"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
              />
              {' '}Auto-scroll
            </label>
          </div>
        </div>
      </div>

      {loading && <div className="loading">Loading messages...</div>}
      {error && <div className="error">Error: {error}</div>}

      {!loading && !error && (
        <div className="chat-messages-compact">
          {messages.length === 0 ? (
            <div className="no-messages">No messages found for this channel</div>
          ) : (
            <>
              {messages.map((msg) => (
                <div key={msg.id} className="chat-message-compact">
                  <a href="#" onClick={(e) => { e.preventDefault(); onPacketClick(msg.id); }} className="chat-timestamp">
                    {formatCompactDateTime(msg.import_time)}
                  </a>
                  {' '}
                  <a href="#" onClick={(e) => { e.preventDefault(); onNodeClick(formatNodeId(msg.from_node_id)); }} className="chat-node-name">
                    {getNodeName(msg.from_node_id)}
                  </a>
                  : {getMessageText(msg)}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
