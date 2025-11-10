interface TimeRangeSelectorProps {
  selectedDaysActive: number;
  onDaysActiveChange: (daysActive: number) => void;
}

export function TimeRangeSelector({ selectedDaysActive, onDaysActiveChange }: TimeRangeSelectorProps) {
  return (
    <div className="time-range-selector">
      <label htmlFor="global-time-range-selector">Time Range:</label>
      <select
        id="global-time-range-selector"
        value={selectedDaysActive.toString()}
        onChange={(e) => onDaysActiveChange(parseFloat(e.target.value))}
        className="time-range-selector-dropdown"
      >
        <option value="1">Last 24 Hours</option>
        <option value="7">Last 7 Days</option>
        <option value="14">Last 14 Days</option>
      </select>
    </div>
  );
}
