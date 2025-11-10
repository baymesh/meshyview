import { useState, useEffect, useCallback, useRef } from 'react'
import './App.css'
import { MeshMap } from './components/MeshMap'
import { StatsDashboard } from './components/StatsDashboard'
import { Filters } from './components/Filters'
import { NodesList } from './components/NodesList'
import { ChatView } from './components/ChatView'
import { NodeDetail } from './components/NodeDetail'
import { PacketDetail } from './components/PacketDetail'
import { ChannelSelector } from './components/ChannelSelector'
import { TimeRangeSelector } from './components/TimeRangeSelector'
import { Toast } from './components/Toast'
import { api } from './api'
import type { Node, Stats } from './types'
import { NodeLookup } from './utils/nodeLookup'

interface FilterParams {
  role?: string;
  channel?: string;
  hw_model?: string;
  hasLocation?: boolean;
  limit?: number;
  days_active?: number;
}

function App() {
  // Dark mode state
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    const saved = localStorage.getItem('darkMode');
    return saved === 'true';
  });

  // Apply dark mode class to body
  useEffect(() => {
    if (darkMode) {
      document.body.classList.add('dark-mode');
    } else {
      document.body.classList.remove('dark-mode');
    }
  }, [darkMode]);

  // Toggle dark mode
  const toggleDarkMode = () => {
    const newMode = !darkMode;
    setDarkMode(newMode);
    localStorage.setItem('darkMode', String(newMode));
  };

  // Parse URL to determine current view
  const getViewFromUrl = (): { type: 'main' | 'node' | 'packet'; id?: string; tab?: 'map' | 'stats' | 'nodes' | 'chat'; channel?: string } => {
    const path = window.location.pathname;
    const params = new URLSearchParams(window.location.search);
    
    // Check for node or packet detail views
    const detailMatch = path.match(/^\/(node|packet)\/(.+)$/);
    if (detailMatch) {
      return { type: detailMatch[1] as 'node' | 'packet', id: detailMatch[2] };
    }
    
    // Check for main view with tab
    const tabMatch = path.match(/^\/(map|stats|nodes|chat)$/);
    if (tabMatch) {
      const tab = tabMatch[1] as 'map' | 'stats' | 'nodes' | 'chat';
      const channel = params.get('channel') || undefined;
      return { type: 'main', tab, channel };
    }
    
    return { type: 'main', tab: 'map' };
  };

  const [nodes, setNodes] = useState<Node[]>([])
  const [nodeLookup, setNodeLookup] = useState<NodeLookup | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [allTimeStats, setAllTimeStats] = useState<Stats | null>(null) // For channel selector
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'map' | 'stats' | 'nodes' | 'chat'>(() => {
    const initialView = getViewFromUrl();
    return initialView.tab || 'map';
  })
  const [filtersCollapsed, setFiltersCollapsed] = useState(false)
  const [globalChannel, setGlobalChannel] = useState<string>(() => {
    const initialView = getViewFromUrl();
    // Prioritize URL channel over localStorage
    if (initialView.channel) {
      return initialView.channel;
    }
    return localStorage.getItem('globalChannel') || 'MediumFast';
  })
  const [globalDaysActive, setGlobalDaysActive] = useState<number>(() => {
    const saved = localStorage.getItem('globalDaysActive');
    return saved ? parseFloat(saved) : 1; // Default to 1 day
  })
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [currentView, setCurrentView] = useState(getViewFromUrl());
  const [recentlyUpdatedNodes, setRecentlyUpdatedNodes] = useState<Map<number, number>>(new Map()); // node_id -> timestamp
  const wsRef = useRef<WebSocket | null>(null);
  
  // Handle channel selection
  const handleChannelChange = (channel: string) => {
    setGlobalChannel(channel)
    localStorage.setItem('globalChannel', channel)
    // Update URL with new channel
    updateUrl(activeTab, channel);
    // Re-fetch data with new channel
    fetchData({ channel: channel || undefined })
  }

  // Handle days active selection
  const handleDaysActiveChange = (daysActive: number) => {
    setGlobalDaysActive(daysActive)
    localStorage.setItem('globalDaysActive', daysActive.toString())
    // Re-fetch data with new days_active
    fetchData({ days_active: daysActive })
  }

  // Update URL based on tab and channel
  const updateUrl = (tab: 'map' | 'stats' | 'nodes' | 'chat', channel?: string) => {
    const channelParam = channel ? `?channel=${encodeURIComponent(channel)}` : '';
    const newPath = `/${tab}${channelParam}`;
    window.history.pushState({}, '', newPath);
  }

  // Handle tab change
  const handleTabChange = (tab: 'map' | 'stats' | 'nodes' | 'chat') => {
    setActiveTab(tab);
    updateUrl(tab, globalChannel);
  }

  // Handle browser back/forward
  useEffect(() => {
    const handlePopState = () => {
      const view = getViewFromUrl();
      setCurrentView(view);
      // Update active tab if main view
      if (view.type === 'main' && view.tab) {
        setActiveTab(view.tab);
      }
      // Update channel if specified in URL
      if (view.channel !== undefined) {
        setGlobalChannel(view.channel);
        localStorage.setItem('globalChannel', view.channel);
      }
    };
    
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Load all nodes once for lookup table
  useEffect(() => {
    const loadAllNodes = async () => {
      try {
        const data = await api.getNodes({ limit: 1000 })
        setNodeLookup(new NodeLookup(data.nodes))
      } catch (err) {
        console.error('Error loading nodes for lookup:', err)
      }
    }
    loadAllNodes()
  }, [])

  // Load all-time stats once for channel selector (no time filter)
  useEffect(() => {
    const loadAllTimeStats = async () => {
      try {
        const data = await api.getStats() // No filters - get all channels
        setAllTimeStats(data)
      } catch (err) {
        console.error('Error loading all-time stats:', err)
      }
    }
    loadAllTimeStats()
  }, [])

  const fetchData = useCallback(async (filters: FilterParams = {}) => {
    try {
      setLoading(true)
      setError(null)
      
      // Apply global filters
      const channelFilter = globalChannel || filters.channel
      const daysActiveFilter = filters.days_active !== undefined ? filters.days_active : globalDaysActive
      const apiFilters = { ...filters }
      if (channelFilter) {
        apiFilters.channel = channelFilter
      }
      apiFilters.days_active = daysActiveFilter
      
      const [nodesData, statsData] = await Promise.all([
        api.getNodes({ ...apiFilters, limit: apiFilters.limit || 1000 }),
        // Pass channel and days_active to stats as well
        api.getStats({ 
          channel: channelFilter || undefined,
          days_active: daysActiveFilter
        }),
      ])
      
      setNodes(nodesData.nodes)
      setStats(statsData)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data')
      console.error('Error fetching data:', err)
    } finally {
      setLoading(false)
    }
  }, [globalChannel, globalDaysActive])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // WebSocket connection for real-time node updates
  useEffect(() => {
    const params = new URLSearchParams();
    if (globalChannel) {
      params.append('channel', globalChannel);
    }
    
    const ws = new WebSocket(`wss://meshql.bayme.sh/ws?${params.toString()}`);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('WebSocket connected for node updates');
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        // Handle different message types
        if (data.type === 'connected') {
          console.log('Connected to MeshQL WebSocket:', data.filters);
        } else if (data.type === 'subscribed') {
          console.log('Subscribed to node updates:', data.filters);
        } else if (data.type === 'node') {
          // Mark this node as recently updated
          setRecentlyUpdatedNodes(prev => {
            const newMap = new Map(prev);
            newMap.set(data.node_id, Date.now());
            return newMap;
          });
          
          // Update node in the list if it exists, otherwise add it
          setNodes(prevNodes => {
            const nodeIndex = prevNodes.findIndex(n => n.node_id === data.node_id);
            if (nodeIndex !== -1) {
              // Node exists, update it with new data
              const updatedNodes = [...prevNodes];
              updatedNodes[nodeIndex] = {
                ...updatedNodes[nodeIndex],
                ...data,
                last_update: data.last_update || updatedNodes[nodeIndex].last_update
              };
              return updatedNodes;
            } else {
              // New node, add it to the list
              return [...prevNodes, data];
            }
          });
        }
      } catch (err) {
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
  }, [globalChannel]);

  const handleApplyFilters = (filters: FilterParams) => {
    // Force hasLocation=true for map view
    if (activeTab === 'map') {
      fetchData({ ...filters, hasLocation: true });
    } else {
      fetchData(filters);
    }
  }

  const handleNodeClick = (nodeId: string) => {
    window.history.pushState({}, '', `/node/${nodeId}`);
    setCurrentView({ type: 'node', id: nodeId });
    
    // Check if we need to show a channel mismatch notification
    checkChannelMismatch(nodeId, 'node');
  }

  const handlePacketClick = (packetId: number) => {
    window.history.pushState({}, '', `/packet/${packetId}`);
    setCurrentView({ type: 'packet', id: packetId.toString() });
    
    // We'll check for packet channel mismatch in the PacketDetail component
  }

  const handleBackToMain = () => {
    window.history.pushState({}, '', '/');
    setCurrentView({ type: 'main' });
  }

  // Check if the item being viewed is from a different channel
  const checkChannelMismatch = (nodeId: string, type: 'node') => {
    if (!globalChannel || !nodeLookup) return;
    
    // For nodes, check if the node's channel matches the selected channel
    if (type === 'node') {
      const nodeData = nodeLookup.getNode(nodeId);
      if (nodeData && nodeData.channel !== globalChannel) {
        setToastMessage(`This node is on channel "${nodeData.channel}", but you have "${globalChannel}" selected.`);
      }
    }
  }

  // Function to show channel mismatch (called from NodeDetail and PacketDetail)
  const showChannelMismatch = useCallback((channel: string, type: 'node' | 'packet') => {
    if (globalChannel && channel !== globalChannel) {
      const itemType = type === 'node' ? 'node' : 'packet';
      setToastMessage(`This ${itemType} is on channel "${channel}", but you have "${globalChannel}" selected.`);
    }
  }, [globalChannel]);

  if (currentView.type === 'packet' && currentView.id) {
    const packetId = parseInt(currentView.id, 10);
    return (
      <div className="app">
        <header className="app-header">
          <div className="header-content">
            <button 
              className="dark-mode-toggle"
              onClick={toggleDarkMode}
              aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {darkMode ? '☀️' : '🌙'}
            </button>
            <div className="header-main">
              <h1>Meshyview</h1>
              <p className="subtitle">Meshtastic Network Dashboard</p>
            </div>
            <ChannelSelector 
              selectedChannel={globalChannel}
              onChannelChange={handleChannelChange}
              stats={allTimeStats}
            />
            <TimeRangeSelector 
              selectedDaysActive={globalDaysActive}
              onDaysActiveChange={handleDaysActiveChange}
            />
          </div>
        </header>
        <div className="app-content">
          <PacketDetail 
            packetId={packetId} 
            nodeLookup={nodeLookup}
            onBack={handleBackToMain}
            onNodeClick={handleNodeClick}
            onChannelMismatch={showChannelMismatch}
          />
        </div>
        {toastMessage && (
          <Toast message={toastMessage} onClose={() => setToastMessage(null)} />
        )}
      </div>
    )
  }

  if (currentView.type === 'node' && currentView.id) {
    return (
      <div className="app">
        <header className="app-header">
          <div className="header-content">
            <button 
              className="dark-mode-toggle"
              onClick={toggleDarkMode}
              aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {darkMode ? '☀️' : '🌙'}
            </button>
            <div className="header-main">
              <h1>Meshyview</h1>
              <p className="subtitle">Meshtastic Network Dashboard</p>
            </div>
            <ChannelSelector 
              selectedChannel={globalChannel}
              onChannelChange={handleChannelChange}
              stats={allTimeStats}
            />
            <TimeRangeSelector 
              selectedDaysActive={globalDaysActive}
              onDaysActiveChange={handleDaysActiveChange}
            />
          </div>
        </header>
        <div className="app-content">
          <NodeDetail 
            nodeId={currentView.id} 
            nodeLookup={nodeLookup}
            onBack={handleBackToMain}
            onPacketClick={handlePacketClick}
            onNodeClick={handleNodeClick}
            onChannelMismatch={showChannelMismatch}
          />
        </div>
        {toastMessage && (
          <Toast message={toastMessage} onClose={() => setToastMessage(null)} />
        )}
      </div>
    )
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-content">
          <button 
            className="dark-mode-toggle"
            onClick={toggleDarkMode}
            aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {darkMode ? '☀️' : '🌙'}
          </button>
          <div className="header-main">
            <h1>Meshyview</h1>
            <p className="subtitle">Meshtastic Network Dashboard</p>
          </div>
          <ChannelSelector 
            selectedChannel={globalChannel}
            onChannelChange={handleChannelChange}
            stats={allTimeStats}
          />
          <TimeRangeSelector 
            selectedDaysActive={globalDaysActive}
            onDaysActiveChange={handleDaysActiveChange}
          />
        </div>
      </header>

      <nav className="app-nav">
        <button
          className={activeTab === 'map' ? 'active' : ''}
          onClick={() => handleTabChange('map')}
        >
          Map View
        </button>
        <button
          className={activeTab === 'stats' ? 'active' : ''}
          onClick={() => handleTabChange('stats')}
        >
          Statistics
        </button>
        <button
          className={activeTab === 'nodes' ? 'active' : ''}
          onClick={() => handleTabChange('nodes')}
        >
          Nodes List
        </button>
        <button
          className={activeTab === 'chat' ? 'active' : ''}
          onClick={() => handleTabChange('chat')}
        >
          Chat
        </button>
      </nav>

      <div className="app-content">
        {error && (
          <div className="error-banner">
            <strong>Error:</strong> {error}
            <button onClick={() => fetchData()}>Retry</button>
          </div>
        )}

        {activeTab === 'map' && (
          <div className="map-view">
            <div className="map-controls">
              <Filters 
                onApplyFilters={handleApplyFilters} 
                stats={stats}
                isCollapsed={filtersCollapsed}
                onToggleCollapse={() => setFiltersCollapsed(!filtersCollapsed)}
                activeTab="map"
              />
            </div>
            <div className="map-container">
              {loading ? (
                <div className="loading">Loading nodes...</div>
              ) : (
                <MeshMap 
                  nodes={nodes} 
                  onNodeClick={handleNodeClick} 
                  recentlyUpdatedNodes={recentlyUpdatedNodes}
                />
              )}
            </div>
            <div className="map-legend">
              <h4>Node Types:</h4>
              <div className="legend-items">
                <div className="legend-item"><span className="legend-color" style={{backgroundColor: '#ff4444'}}></span> Router</div>
                <div className="legend-item"><span className="legend-color" style={{backgroundColor: '#ff8844'}}></span> Router Client</div>
                <div className="legend-item"><span className="legend-color" style={{backgroundColor: '#4444ff'}}></span> Client</div>
                <div className="legend-item"><span className="legend-color" style={{backgroundColor: '#44ff44'}}></span> Client Base</div>
                <div className="legend-item"><span className="legend-color" style={{backgroundColor: '#ff44ff'}}></span> Repeater</div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'stats' && (
          <StatsDashboard stats={stats} loading={loading} globalChannel={globalChannel} />
        )}

        {activeTab === 'nodes' && (
          <div>
            <Filters 
              onApplyFilters={handleApplyFilters} 
              stats={stats}
              isCollapsed={filtersCollapsed}
              onToggleCollapse={() => setFiltersCollapsed(!filtersCollapsed)}
              activeTab="nodes"
            />
            {loading ? (
              <div className="loading">Loading nodes...</div>
            ) : (
              <NodesList nodes={nodes} onNodeClick={handleNodeClick} />
            )}
          </div>
        )}

        {activeTab === 'chat' && (
          <ChatView 
            nodeLookup={nodeLookup} 
            onNodeClick={handleNodeClick} 
            onPacketClick={handlePacketClick}
            globalChannel={globalChannel}
          />
        )}
      </div>

      {toastMessage && (
        <Toast message={toastMessage} onClose={() => setToastMessage(null)} />
      )}

      <footer className="app-footer">
        <p>
          Powered by <a href="https://meshql.bayme.sh/docs" target="_blank" rel="noopener noreferrer">MeshQL API</a>
          {' | '}
          <a href="https://github.com/baymesh" target="_blank" rel="noopener noreferrer">Github</a>
        </p>
      </footer>
    </div>
  )
}

export default App
