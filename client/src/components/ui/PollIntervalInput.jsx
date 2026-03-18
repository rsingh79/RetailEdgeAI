import { useState, useEffect } from 'react';

const UNIT_TO_MINUTES = { minutes: 1, hours: 60, days: 1440, weeks: 10080 };
const UNITS = ['minutes', 'hours', 'days', 'weeks'];
const MIN_MINUTES = 15;

/**
 * Convert a total-minutes value into the best { amount, unit } pair.
 * Picks the largest unit that divides evenly, with fallback to minutes.
 */
function minutesToAmountUnit(totalMinutes) {
  if (totalMinutes >= 10080 && totalMinutes % 10080 === 0) return { amount: totalMinutes / 10080, unit: 'weeks' };
  if (totalMinutes >= 1440 && totalMinutes % 1440 === 0) return { amount: totalMinutes / 1440, unit: 'days' };
  if (totalMinutes >= 60 && totalMinutes % 60 === 0) return { amount: totalMinutes / 60, unit: 'hours' };
  return { amount: totalMinutes || 30, unit: 'minutes' };
}

/**
 * Format a poll interval in minutes as a human-readable string.
 * E.g. 120 → "every 2 hours", 30 → "every 30 minutes", 10080 → "every 1 week"
 */
export function formatPollInterval(minutes) {
  const { amount, unit } = minutesToAmountUnit(minutes);
  const label = amount === 1 ? unit.replace(/s$/, '') : unit;
  return `every ${amount} ${label}`;
}

/**
 * A controlled input for poll interval: "Check every [number] [unit dropdown]"
 *
 * @param {{ value: number, onChange: (minutes: number) => void, className?: string }} props
 */
export default function PollIntervalInput({ value, onChange, className }) {
  const initial = minutesToAmountUnit(value || 30);
  const [amount, setAmount] = useState(initial.amount);
  const [unit, setUnit] = useState(initial.unit);

  // Sync from external value changes
  useEffect(() => {
    const parsed = minutesToAmountUnit(value || 30);
    setAmount(parsed.amount);
    setUnit(parsed.unit);
  }, [value]);

  function handleAmountChange(newAmount) {
    const num = Math.max(1, parseInt(newAmount) || 1);
    setAmount(num);
    const minutes = num * UNIT_TO_MINUTES[unit];
    onChange(Math.max(MIN_MINUTES, minutes));
  }

  function handleUnitChange(newUnit) {
    setUnit(newUnit);
    const minutes = amount * UNIT_TO_MINUTES[newUnit];
    onChange(Math.max(MIN_MINUTES, minutes));
  }

  const effectiveMinutes = amount * UNIT_TO_MINUTES[unit];
  const isBelowMin = effectiveMinutes < MIN_MINUTES;

  return (
    <div className={className}>
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-600 whitespace-nowrap">Check every</span>
        <input
          type="number"
          min={1}
          value={amount}
          onChange={(e) => handleAmountChange(e.target.value)}
          className="w-16 px-2 py-1.5 border border-gray-300 rounded-lg text-sm text-center focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
        />
        <select
          value={unit}
          onChange={(e) => handleUnitChange(e.target.value)}
          className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
        >
          {UNITS.map((u) => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>
      </div>
      {isBelowMin && (
        <p className="text-xs text-red-500 mt-1">Minimum: 15 minutes</p>
      )}
    </div>
  );
}
