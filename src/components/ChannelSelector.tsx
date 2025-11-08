import type { Stats } from '../types';

interface ChannelSelectorProps {
  selectedChannel: string;
  onChannelChange: (channel: string) => void;
  stats: Stats | null;
}

export function ChannelSelector({ selectedChannel, onChannelChange, stats }: ChannelSelectorProps) {
  const channels = stats?.nodes_by_channel ? Object.keys(stats.nodes_by_channel).sort() : [];

  return (
    <div className="channel-selector">
      <label htmlFor="global-channel-selector">Channel:</label>
      <select
        id="global-channel-selector"
        value={selectedChannel}
        onChange={(e) => onChannelChange(e.target.value)}
        className="channel-selector-dropdown"
      >
        <option value="">All Channels</option>
        {channels.map(channel => (
          <option key={channel} value={channel}>
            {channel} ({stats?.nodes_by_channel[channel] || 0})
          </option>
        ))}
      </select>
    </div>
  );
}
