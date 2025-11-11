import type { Stats } from '../types';

interface ChannelSelectorProps {
  selectedChannel: string;
  onChannelChange: (channel: string) => void;
  stats: Stats | null;
}

export function ChannelSelector({ selectedChannel, onChannelChange, stats }: ChannelSelectorProps) {
  // Sort channels by node count (descending), not alphabetically
  const channels = stats?.nodes_by_channel 
    ? Object.entries(stats.nodes_by_channel)
        .sort(([, countA], [, countB]) => countB - countA)
        .map(([channel]) => channel)
    : [];

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
            {channel}
          </option>
        ))}
      </select>
    </div>
  );
}
