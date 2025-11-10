import type { Stats } from '../types';

interface ChannelSelectorProps {
  selectedChannel: string;
  onChannelChange: (channel: string) => void;
  stats: Stats | null;
}

export function ChannelSelector({ selectedChannel, onChannelChange, stats }: ChannelSelectorProps) {
  const channels = stats?.nodes_by_channel ? Object.keys(stats.nodes_by_channel).sort() : [];

  const getDisplayText = () => {
    if (!selectedChannel) return 'All Channels';
    const count = stats?.nodes_by_channel[selectedChannel] || 0;
    return `${selectedChannel} (${count})`;
  };

  return (
    <div className="channel-selector">
      <select
        value={selectedChannel}
        onChange={(e) => onChannelChange(e.target.value)}
        className="compact-select"
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
