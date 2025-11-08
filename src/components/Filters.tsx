import { useState } from 'react';
import type { Stats } from '../types';

interface FilterParams {
  role?: string;
  channel?: string;
  hw_model?: string;
  hasLocation?: boolean;
  limit?: number;
}

interface FiltersProps {
  onApplyFilters: (filters: FilterParams) => void;
  stats: Stats | null;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function Filters({ onApplyFilters, stats, isCollapsed, onToggleCollapse }: FiltersProps) {
  const [role, setRole] = useState('');
  const [hwModel, setHwModel] = useState('');
  const [hasLocation, setHasLocation] = useState<string>('all');
  const [limit, setLimit] = useState('1000');

  const handleApply = () => {
    const filters: FilterParams = {};
    if (role) filters.role = role;
    if (hwModel) filters.hw_model = hwModel;
    if (hasLocation !== 'all') filters.hasLocation = hasLocation === 'true';
    if (limit) filters.limit = parseInt(limit);
    
    onApplyFilters(filters);
  };

  const handleReset = () => {
    setRole('');
    setHwModel('');
    setHasLocation('all');
    setLimit('1000');
    onApplyFilters({});
  };

  return (
    <div className="filters">
      <div className="filters-header">
        <h3>Filters</h3>
        {onToggleCollapse && (
          <button 
            onClick={onToggleCollapse}
            className="collapse-toggle"
            aria-label={isCollapsed ? "Expand filters" : "Collapse filters"}
          >
            {isCollapsed ? '▼' : '▲'}
          </button>
        )}
      </div>
      
      {!isCollapsed && (
        <>
          <div className="filter-grid">
            <div className="filter-group">
              <label htmlFor="role">Role:</label>
              <select
                id="role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
              >
                <option value="">All Roles</option>
                {stats?.nodes_by_role && Object.keys(stats.nodes_by_role).sort().map(r => (
                  <option key={r} value={r}>{r} ({stats.nodes_by_role[r]})</option>
                ))}
              </select>
            </div>

            <div className="filter-group">
              <label htmlFor="hwModel">Hardware Model:</label>
              <select
                id="hwModel"
                value={hwModel}
                onChange={(e) => setHwModel(e.target.value)}
              >
                <option value="">All Hardware</option>
                {stats?.nodes_by_hardware && Object.entries(stats.nodes_by_hardware)
                  .sort((a, b) => b[1] - a[1])
                  .map(([hw, count]) => (
                    <option key={hw} value={hw}>{hw} ({count})</option>
                  ))}
              </select>
            </div>

            <div className="filter-group">
              <label htmlFor="hasLocation">Has Location:</label>
              <select
                id="hasLocation"
                value={hasLocation}
                onChange={(e) => setHasLocation(e.target.value)}
              >
                <option value="all">All</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </div>

            <div className="filter-group">
              <label htmlFor="limit">Limit:</label>
              <input
                id="limit"
                type="number"
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
                min="1"
                max="1000"
              />
            </div>
          </div>

          <div className="filter-actions">
            <button onClick={handleApply} className="btn-primary">Apply Filters</button>
            <button onClick={handleReset} className="btn-secondary">Reset</button>
          </div>
        </>
      )}
    </div>
  );
}
