interface TimeRangeSelectorProps {
  selectedDaysActive: number;
  onDaysActiveChange: (daysActive: number) => void;
}

const timeRanges = [
  { value: 1, label: '24h' },
  { value: 7, label: '7d' },
  { value: 14, label: '14d' },
];

export function TimeRangeSelector({ selectedDaysActive, onDaysActiveChange }: TimeRangeSelectorProps) {
  return (
    <div className="time-range-selector">
      <div className="filter-button-group">
        {timeRanges.map(({ value, label }) => (
          <button
            key={value}
            className={`filter-btn ${selectedDaysActive === value ? 'active' : ''}`}
            onClick={() => onDaysActiveChange(value)}
            title={`Last ${value === 1 ? '24 hours' : `${value} days`}`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
