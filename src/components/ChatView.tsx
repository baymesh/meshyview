import { useState, useEffect, useRef, useMemo } from 'react';
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
  const [replyMessages, setReplyMessages] = useState<Map<number, ChatMessage>>(new Map()); // Cache of reply messages by packet ID
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
          limit: 100
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

  // Fetch a reply message by packet ID if not already cached
  const fetchReplyMessage = async (replyId: number) => {
    if (replyMessages.has(replyId)) return; // Already cached
    
    // First check if the message is already in our loaded messages
    const existingMsg = messages.find(m => m.id === replyId);
    if (existingMsg) {
      setReplyMessages(prev => new Map(prev).set(replyId, existingMsg));
      return;
    }
    
    // If not found locally, fetch from API
    try {
      const packet = await api.getPacketDetail(replyId, { decode_payload: true });
      const replyMsg: ChatMessage = {
        id: packet.id,
        from_node_id: packet.from_node_id,
        to_node_id: packet.to_node_id,
        channel: packet.channel,
        portnum: packet.portnum,
        import_time: packet.import_time,
        payload: packet.payload
      };
      setReplyMessages(prev => new Map(prev).set(replyId, replyMsg));
    } catch (err) {
      console.error(`Failed to fetch reply message ${replyId}:`, err);
    }
  };

  // Get reply_id from a message if it exists
  const getReplyId = (msg: ChatMessage): number | null => {
    if (typeof msg.payload === 'object' && msg.payload !== null && 'reply_id' in msg.payload) {
      return msg.payload.reply_id as number;
    }
    return null;
  };

  // Check if a message is a reaction (has emoji field AND reply_id)
  const isReaction = (msg: ChatMessage): boolean => {
    if (typeof msg.payload === 'object' && msg.payload !== null) {
      // A reaction must have both emoji field and reply_id
      return 'emoji' in msg.payload && msg.payload.emoji !== undefined && 
             'reply_id' in msg.payload && msg.payload.reply_id !== undefined;
    }
    return false;
  };

  // Get emoji from reaction message
  const getEmoji = (msg: ChatMessage): string | null => {
    if (typeof msg.payload === 'object' && msg.payload !== null && 'emoji' in msg.payload) {
      // The emoji character is in the text field, not the emoji field
      if ('text' in msg.payload && msg.payload.text) {
        return msg.payload.text;
      }
    }
    return null;
  };

  // Group reactions by the message they're reacting to
  const messageReactions = useMemo(() => {
    const reactions = new Map<number, Array<{ emoji: string; from: number }>>();
    messages.forEach(msg => {
      if (isReaction(msg)) {
        const replyId = getReplyId(msg);
        const emoji = getEmoji(msg);
        if (replyId && emoji) {
          if (!reactions.has(replyId)) {
            reactions.set(replyId, []);
          }
          reactions.get(replyId)!.push({ emoji, from: msg.from_node_id });
        }
      }
    });
    return reactions;
  }, [messages]);

  // Filter out reaction messages from main display
  const nonReactionMessages = useMemo(() => {
    return messages.filter(msg => !isReaction(msg));
  }, [messages]);

  // Fetch reply messages for all messages that have reply_id
  useEffect(() => {
    nonReactionMessages.forEach(msg => {
      const replyId = getReplyId(msg);
      if (replyId && !replyMessages.has(replyId)) {
        fetchReplyMessage(replyId);
      }
    });
  }, [nonReactionMessages]);

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
          {nonReactionMessages.length === 0 ? (
            <div className="no-messages">No messages found for this channel</div>
          ) : (
            <>
              {nonReactionMessages.map((msg) => {
                const replyId = getReplyId(msg);
                const replyMsg = replyId ? replyMessages.get(replyId) : null;
                const reactions = messageReactions.get(msg.id);
                
                return (
                  <div key={msg.id} className="chat-message-compact">
                    <a href="#" onClick={(e) => { e.preventDefault(); onPacketClick(msg.id); }} className="chat-timestamp">
                      {formatCompactDateTime(msg.import_time)}
                    </a>
                    {' '}
                    <a href="#" onClick={(e) => { e.preventDefault(); onNodeClick(formatNodeId(msg.from_node_id)); }} className="chat-node-name">
                      {getNodeName(msg.from_node_id)}
                    </a>
                    : {getMessageText(msg)}
                    {replyMsg && (
                      <div className="chat-reply-context">
                        ↪ replying to{' '}
                        <a href="#" onClick={(e) => { e.preventDefault(); onNodeClick(formatNodeId(replyMsg.from_node_id)); }} className="chat-node-name">
                          {getNodeName(replyMsg.from_node_id)}
                        </a>
                        : {getMessageText(replyMsg)}
                      </div>
                    )}
                    {reactions && reactions.length > 0 && (
                      <div className="chat-reactions">
                        {Array.from(
                          reactions.reduce((acc, r) => {
                            const existing = acc.get(r.emoji);
                            if (existing) {
                              existing.count++;
                              existing.names.push(getNodeName(r.from));
                            } else {
                              acc.set(r.emoji, { count: 1, names: [getNodeName(r.from)] });
                            }
                            return acc;
                          }, new Map<string, { count: number; names: string[] }>())
                        ).map(([emoji, data]) => (
                          <span 
                            key={emoji} 
                            className="chat-reaction" 
                            title={data.names.join(', ')}
                          >
                            {emoji} {data.count > 1 && data.count}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
