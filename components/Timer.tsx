import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

type TimerProps = {
  targetTimestamp?: number | null;
  label?: string;
  onExpire?: () => void;
  compact?: boolean;
};

function computeRemainingSeconds(target?: number | null): number {
  if (typeof target !== 'number' || Number.isNaN(target)) {
    return 0;
  }
  const diff = Math.max(0, Math.ceil((target - Date.now()) / 1000));
  return diff;
}

function format(durationSeconds: number): string {
  const minutes = Math.floor(durationSeconds / 60);
  const seconds = durationSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

export default function Timer({ targetTimestamp, label, onExpire, compact }: TimerProps) {
  const [remaining, setRemaining] = useState(() => computeRemainingSeconds(targetTimestamp));

  useEffect(() => {
    if (typeof targetTimestamp !== 'number' || Number.isNaN(targetTimestamp)) {
      setRemaining(0);
      return undefined;
    }

    const tick = () => {
      setRemaining((prev) => {
        const next = computeRemainingSeconds(targetTimestamp);
        if (next === 0 && prev !== 0) {
          onExpire?.();
        }
        return next;
      });
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [targetTimestamp, onExpire]);

  const display = useMemo(() => {
    if (typeof targetTimestamp !== 'number' || Number.isNaN(targetTimestamp)) {
      return '--:--';
    }
    return format(remaining);
  }, [remaining, targetTimestamp]);

  return (
    <View style={[styles.container, compact ? styles.compactContainer : undefined]}>
      {/* {label ? <Text style={styles.label}>{label}</Text> : null} */}
      <Text style={[styles.timeText, compact ? styles.compactText : undefined]}>{display}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(239, 104, 104, 0.5)',
    borderColor: '#ef6868',
    padding: 6,
    borderRadius: 8,
    alignSelf: 'flex-start',
    borderWidth: 1,
  },
  compactContainer: {
    gap: 4,
  },
  label: {
    fontSize: 14,
    color: '#555',
    fontWeight: '600',
  },
  timeText: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111',
  },
  compactText: {
    fontSize: 18,
  },
});
